import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const { clients } = vi.hoisted(() => ({
  clients: [] as Array<{
    emit: (event: string, ...args: unknown[]) => void
    end: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
  }>
}))

vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events')
  class MockClient extends EventEmitter {
    end = vi.fn()
    connect = vi.fn()
    exec = vi.fn()

    constructor() {
      super()
      clients.push(this)
    }
  }
  return { Client: MockClient }
})

import {
  isRetryableConnectionError,
  mapSshError,
  shouldRetryCommandAfterDisconnect
} from './errorMapping'
import { shellQuote } from './shellQuote'
import {
  relayStreams,
  SshAbortedError,
  SshHostIdentityChangedError,
  SshManager,
  SshOutputLimitError
} from './manager'

describe('SshManager disconnect race', () => {
  it('does not pool or report online when ready arrives after disconnect', async () => {
    clients.length = 0
    const manager = new SshManager(() => ({
      host: 'example.invalid',
      port: 22,
      hostFingerprint: `SHA256:${'A'.repeat(43)}`,
      username: 'test',
      authType: 'password',
      secret: 'fixture'
    }))
    const statuses: string[] = []
    manager.on('status', ({ status }) => statuses.push(status))

    const connecting = manager.connect(42)
    await vi.waitFor(() => expect(clients).toHaveLength(1))
    const staleClient = clients[0]!

    await manager.disconnect(42)
    staleClient.emit('ready')
    staleClient.emit('close')

    await expect(connecting).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })
    expect(statuses).not.toContain('online')
    expect(staleClient.end).toHaveBeenCalled()
  })
})

describe('SshManager bounded command output', () => {
  it('destroys a command channel and rejects when stdout exceeds its byte budget', async () => {
    clients.length = 0
    const manager = new SshManager(() => ({
      host: 'example.invalid',
      port: 22,
      hostFingerprint: `SHA256:${'A'.repeat(43)}`,
      username: 'test',
      authType: 'password',
      secret: 'fixture'
    }))
    const channel = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      destroyed: false,
      destroy: vi.fn(function (this: EventEmitter & { destroyed: boolean }) {
        this.destroyed = true
      })
    })

    const execution = manager.execWithHostIdentity(8, 'fixed-read-command', {
      maxStdoutBytes: 4,
      retryOnReconnect: false
    })
    await vi.waitFor(() => expect(clients).toHaveLength(1))
    const client = clients[0]!
    client.exec.mockImplementation((_command, callback) => callback(null, channel))
    client.emit('ready')
    await vi.waitFor(() => expect(client.exec).toHaveBeenCalledOnce())
    channel.emit('data', Buffer.from('12345'))

    await expect(execution).rejects.toBeInstanceOf(SshOutputLimitError)
    expect(channel.destroy).toHaveBeenCalledOnce()
  })

  it('rejects results if the resolved VPS endpoint changes while a command is running', async () => {
    clients.length = 0
    let resolverCalls = 0
    const manager = new SshManager(() => {
      resolverCalls += 1
      return {
        host: resolverCalls === 1 ? 'first.example.invalid' : 'changed.example.invalid',
        port: 22,
        hostFingerprint: `SHA256:${'A'.repeat(43)}`,
        username: 'test',
        authType: 'password',
        secret: 'fixture'
      }
    })
    const channel = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      destroyed: false,
      destroy: vi.fn()
    })
    const execution = manager.execWithHostIdentity(9, 'fixed-read-command')
    await vi.waitFor(() => expect(clients).toHaveLength(1))
    const client = clients[0]!
    client.exec.mockImplementation((_command, callback) => callback(null, channel))
    client.emit('ready')
    await vi.waitFor(() => expect(client.exec).toHaveBeenCalledOnce())
    channel.emit('close', 0)

    await expect(execution).rejects.toBeInstanceOf(SshHostIdentityChangedError)
  })
})

describe('relayStreams', () => {
  it('preserves multi-chunk bytes and reports progress', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const chunks: Buffer[] = []
    output.on('data', (chunk) => chunks.push(chunk))
    const progress: number[] = []
    const transfer = relayStreams(input, output, { onProgress: (bytes) => progress.push(bytes) })
    input.end(Buffer.from([0, 1, 255, 2]))
    await expect(transfer).resolves.toEqual({ bytes: 4 })
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 1, 255, 2]))
    expect(progress.at(-1)).toBe(4)
  })

  it('fails and destroys both streams on abort', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const controller = new AbortController()
    const transfer = relayStreams(input, output, { signal: controller.signal })
    controller.abort()
    await expect(transfer).rejects.toBeInstanceOf(SshAbortedError)
    expect(input.destroyed).toBe(true)
    expect(output.destroyed).toBe(true)
  })
})

describe('shellQuote', () => {
  it('boc binh thuong', () => {
    expect(shellQuote('app-demo')).toBe("'app-demo'")
  })

  it('this co don nhan don', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })

  it('vo hieu hoa $ ; & va xuong dong (nam trong single quote nen la chu thuong)', () => {
    const input = '$(rm -rf /); echo pwned'
    expect(shellQuote(input)).toBe(`'$(rm -rf /); echo pwned'`)
  })

  it('chuoi rong van hop le', () => {
    expect(shellQuote('')).toBe("''")
  })
})

describe('mapSshError', () => {
  it('nhan dang AUTH_FAILED', () => {
    expect(mapSshError(new Error('All configured authentication methods failed'))).toBe(
      'SSH_AUTH_FAILED'
    )
  })

  it('nhan dang TIMEOUT', () => {
    expect(mapSshError(new Error('connect ETIMEDOUT 192.168.1.5:22'))).toBe('SSH_TIMEOUT')
    expect(mapSshError(new Error('Timed out while waiting for handshake'))).toBe('SSH_TIMEOUT')
  })

  it('nhan dang HOST_UNREACHABLE', () => {
    expect(mapSshError(new Error('connect ECONNREFUSED 203.0.113.5:22'))).toBe(
      'SSH_HOST_UNREACHABLE'
    )
    expect(mapSshError(new Error('connect EHOSTUNREACH 203.0.113.9:22'))).toBe(
      'SSH_HOST_UNREACHABLE'
    )
    expect(mapSshError(new Error('getaddrinfo ENOTFOUND khong-ton-tai.local'))).toBe(
      'SSH_HOST_UNREACHABLE'
    )
  })

  it('con lai la UNKNOWN', () => {
    expect(mapSshError(new Error('something else entirely'))).toBe('UNKNOWN')
    expect(mapSshError('not even an error')).toBe('UNKNOWN')
  })
})

describe('isRetryableConnectionError', () => {
  it('chi retry loi mang, khong retry AUTH_FAILED', () => {
    expect(isRetryableConnectionError('SSH_TIMEOUT')).toBe(true)
    expect(isRetryableConnectionError('SSH_HOST_UNREACHABLE')).toBe(true)
    expect(isRetryableConnectionError('SSH_AUTH_FAILED')).toBe(false)
    expect(isRetryableConnectionError('UNKNOWN')).toBe(false)
  })
})

describe('shouldRetryCommandAfterDisconnect', () => {
  it('chi reconnect/retry probe duoc phep, khong retry lenh side effect', () => {
    expect(shouldRetryCommandAfterDisconnect('SSH_TIMEOUT', false, true)).toBe(true)
    expect(shouldRetryCommandAfterDisconnect('SSH_HOST_UNREACHABLE', false, undefined)).toBe(true)
    expect(shouldRetryCommandAfterDisconnect('SSH_TIMEOUT', false, false)).toBe(false)
    expect(shouldRetryCommandAfterDisconnect('SSH_TIMEOUT', true, true)).toBe(false)
    expect(shouldRetryCommandAfterDisconnect('SSH_AUTH_FAILED', false, true)).toBe(false)
  })
})
