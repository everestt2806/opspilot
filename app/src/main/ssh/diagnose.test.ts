import * as net from 'node:net'

import { describe, expect, it, vi } from 'vitest'

import {
  classifyNetError,
  diagnoseFromProbe,
  diagnoseFromSshError,
  probeHost,
  probeTcp,
  type TcpProbeOutcome
} from './diagnose'
import type { SshConnectionInfo } from './manager'

const CONFIG: SshConnectionInfo = {
  host: '221.121.1.79',
  port: 22,
  username: 'deploy',
  authType: 'key',
  secret: 'dummy'
}

describe('classifyNetError', () => {
  it('phan loai du cac ma loi mang thuong gap', () => {
    expect(classifyNetError(new Error('connect ECONNREFUSED 1.2.3.4:22'))).toBe('refused')
    expect(classifyNetError(new Error('getaddrinfo ENOTFOUND ten-sai.invalid'))).toBe(
      'resolve_failed'
    )
    expect(classifyNetError(new Error('getaddrinfo EAI_AGAIN'))).toBe('resolve_failed')
    expect(classifyNetError(new Error('connect EHOSTUNREACH 1.2.3.4:22'))).toBe('unreachable')
    expect(classifyNetError(new Error('connect ENETUNREACH 1.2.3.4:22'))).toBe('unreachable')
    expect(classifyNetError('bat ky loi nao khac')).toBe('unreachable')
  })
})

describe('diagnoseFromProbe', () => {
  it('resolve_failed va unreachable deu ra HOST_NOT_FOUND', () => {
    for (const primary of ['resolve_failed', 'unreachable'] as TcpProbeOutcome[]) {
      const diagnosis = diagnoseFromProbe({ primary, secondaryResponded: false })
      expect(diagnosis?.code).toBe('HOST_NOT_FOUND')
      expect(diagnosis?.fixes.length).toBeGreaterThan(0)
    }
  })

  it('refused ra PORT_CLOSED voi goi y kiem tra cong SSH', () => {
    const diagnosis = diagnoseFromProbe({ primary: 'refused', secondaryResponded: false })
    expect(diagnosis?.code).toBe('PORT_CLOSED')
    expect(diagnosis?.fixes[0]).toContain('22')
  })

  it('case mau WiService: timeout moi cong, khong cong nao tra loi -> PORT_TIMEOUT + firewall', () => {
    const diagnosis = diagnoseFromProbe({ primary: 'timeout', secondaryResponded: false })
    expect(diagnosis?.code).toBe('PORT_TIMEOUT')
    expect(diagnosis?.title).toContain('firewall')
    expect(diagnosis?.cause).toContain('Không cổng nào')
    expect(diagnosis?.fixes.some((fix) => fix.includes('Running'))).toBe(true)
    expect(diagnosis?.fixes.some((fix) => fix.includes('WiService'))).toBe(true)
  })

  it('timeout nhung may con song (80/443 tra loi) -> PORT_TIMEOUT chi SSH bi chan', () => {
    const diagnosis = diagnoseFromProbe({ primary: 'timeout', secondaryResponded: true })
    expect(diagnosis?.code).toBe('PORT_TIMEOUT')
    expect(diagnosis?.title).toContain('máy còn sống')
  })

  it('open -> null de sang buoc thu SSH', () => {
    expect(diagnoseFromProbe({ primary: 'open', secondaryResponded: false })).toBeNull()
  })
})

describe('diagnoseFromSshError', () => {
  it('AUTH_FAILED giai thich du cho ca nguoi dung key', () => {
    const diagnosis = diagnoseFromSshError('SSH_AUTH_FAILED')
    expect(diagnosis?.code).toBe('SSH_AUTH_FAILED')
    expect(diagnosis?.fixes.some((fix) => fix.includes('BEGIN/END'))).toBe(true)
  })

  it('timeout o tang SSH -> SSH_HANDSHAKE_TIMEOUT (cong mo nhung khong phai SSH)', () => {
    const diagnosis = diagnoseFromSshError('SSH_TIMEOUT')
    expect(diagnosis?.code).toBe('SSH_HANDSHAKE_TIMEOUT')
    expect(diagnosis?.cause).toContain('không trả lời bản tin SSH')
  })

  it('mat ket noi giua chung -> PORT_CLOSED', () => {
    expect(diagnoseFromSshError('SSH_HOST_UNREACHABLE')?.code).toBe('PORT_CLOSED')
  })

  it('ma khong nhan dang duoc -> null (khong doan bua)', () => {
    expect(diagnoseFromSshError('UNKNOWN')).toBeNull()
  })
})

describe('probeHost', () => {
  it('cong chinh refused thi khong probe cong phu', async () => {
    const probe = vi.fn(async () => 'refused' as TcpProbeOutcome)
    const result = await probeHost(CONFIG, probe)
    expect(result).toEqual({ primary: 'refused', secondaryResponded: false })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('cong chinh timeout thi probe them 80 va 443 voi timeout ngan hon', async () => {
    const probe = vi.fn<typeof probeTcp>(async (_host, port) => {
      return port === 22 ? 'timeout' : 'open'
    })
    const result = await probeHost(CONFIG, probe)
    expect(result).toEqual({ primary: 'timeout', secondaryResponded: true })
    expect(probe).toHaveBeenCalledTimes(3)
    expect(probe).toHaveBeenNthCalledWith(1, CONFIG.host, 22)
    expect(probe).toHaveBeenNthCalledWith(2, CONFIG.host, 80, 2_000)
    expect(probe).toHaveBeenNthCalledWith(3, CONFIG.host, 443, 2_000)
  })

  it('timeout moi cong -> secondaryResponded false (case firewall chan het)', async () => {
    const probe = vi.fn(async () => 'timeout' as TcpProbeOutcome)
    const result = await probeHost(CONFIG, probe)
    expect(result.secondaryResponded).toBe(false)
  })
})

describe('probeTcp voi loopback that (khong can mock socket)', () => {
  it('cong dang nghe -> open', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('khong lay duoc cong loopback')
    }
    expect(await probeTcp('127.0.0.1', address.port)).toBe('open')
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('cong da dong -> refused', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('khong lay duoc cong loopback')
    }
    const port = address.port
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect(await probeTcp('127.0.0.1', port)).toBe('refused')
  })
})
