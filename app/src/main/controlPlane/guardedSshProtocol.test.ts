import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { H2TerminalReceipt } from '../../../../docs/contracts/product-h2-runtime'
import { hashH2, signH2 } from './productH2Proof'
import { Duplex, PassThrough } from 'node:stream'
import type { ClientChannel } from 'ssh2'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import { GuardedSshExecutionSession } from './guardedSshSession'

import type { GuardedSshResponse } from '../../../../docs/contracts/product-guarded-ssh-session'
import {
  encodeGuardedSshFrame,
  GuardedSshFrameDecoder,
  GuardedSshProtocolError,
  requireSingleGuardedSshResponse
} from './guardedSshProtocol'

const response: GuardedSshResponse = {
  version: 1,
  request_id: 'request-1',
  sequence: 1,
  state: 'accepted',
  deployment_id: 7
}

describe('guarded SSH framed protocol', () => {
  it.each(['activate', 'configure', 'authorize'] as const)(
    'chặn gửi mutation %s sau khi receipt đã seal',
    async (operation) => {
      const receipt = JSON.parse(
        readFileSync(
          new URL('../../../scripts/product-h2-review/fixtures.json', import.meta.url),
          'utf8'
        )
      ).succeeded as H2TerminalReceipt
      const context = receipt.context
      const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => i))
      const terminal = {
        receipt,
        receipt_sha256: hashH2(receipt),
        signature: signH2('receipt', receipt, secret)
      }
      const operations: unknown[] = []
      const channel = createFakeChannel((req) => {
        operations.push(req.operation)
        return {
          version: 1,
          request_id: req.request_id,
          sequence: req.sequence,
          state: 'accepted',
          deployment_id: context.deployment_id,
          ...(req.operation === 'seal_runtime' ? { terminal } : {})
        }
      })
      const repository = {
        readGitDispatchTargetBinding: () => ({ state: 'ready', binding: context.target })
      }
      const session = new GuardedSshExecutionSession(
        channel as ClientChannel,
        repository as never,
        context.claim,
        context.deployment_id,
        context.target,
        undefined,
        1000
      )
      try {
        await session.open('/tmp/target-state')
        await session.sealRuntime()
        const before = operations.length
        const request =
          operation === 'activate'
            ? session.startRuntimeStep('activate')
            : operation === 'configure'
              ? session.runtimeConfigure(context)
              : session.authorizeWritePhase('activate')
        await expect(request).rejects.toMatchObject({ code: 'SSH_RUNTIME_REJECTED' })
        expect(operations.length).toBe(before)
      } finally {
        session.failClosed()
      }
    }
  )
  it('round trips a bounded length-prefixed response and supports partial chunks', () => {
    const frame = encodeGuardedSshFrame(response)
    const decoder = new GuardedSshFrameDecoder()
    expect(decoder.push(frame.subarray(0, 3))).toEqual([])
    expect(decoder.push(frame.subarray(3))).toEqual([response])
    decoder.finish()
  })

  it('rejects malformed, zero-length, oversized, and truncated frames', () => {
    const decoder = new GuardedSshFrameDecoder()
    expect(() => decoder.push(Buffer.from([0, 0, 0, 1, 0xff])).length).toThrow(
      new GuardedSshProtocolError('SSH_PROTOCOL_MALFORMED')
    )
    expect(() => new GuardedSshFrameDecoder().push(Buffer.from([0, 0, 0, 0]))).toThrow(
      new GuardedSshProtocolError('SSH_PROTOCOL_MALFORMED')
    )
    expect(() => new GuardedSshFrameDecoder().push(Buffer.from([0, 0, 0, 1, 0x7b]))).toThrow(
      new GuardedSshProtocolError('SSH_PROTOCOL_MALFORMED')
    )
    const truncated = new GuardedSshFrameDecoder()
    truncated.push(Buffer.from([0, 0, 0, 8, 0x7b]))
    expect(() => truncated.finish()).toThrow(new GuardedSshProtocolError('SSH_PROTOCOL_TRUNCATED'))
    expect(() => encodeGuardedSshFrame('x'.repeat(40 * 1024 + 1))).toThrow(
      new GuardedSshProtocolError('SSH_PROTOCOL_LIMIT')
    )
  })

  it('rejects duplicate responses to one outstanding request', () => {
    const decoder = new GuardedSshFrameDecoder()
    const responses = decoder.push(
      Buffer.concat([encodeGuardedSshFrame(response), encodeGuardedSshFrame(response)])
    )
    expect(() => requireSingleGuardedSshResponse(responses)).toThrow(
      new GuardedSshProtocolError('SSH_PROTOCOL_DUPLICATE')
    )
  })

  it('timeout and abort stop the channel and keep the session reconciliation-required', async () => {
    const claim = {
      controller_id: 'controller',
      app_id: 1,
      job_id: 'job',
      attempt_id: 'attempt',
      attempt_number: 1,
      ownership_generation: 1,
      source_generation: 1,
      source_config_sha256: 'a'.repeat(64),
      app_lease_id: 'app-lease',
      app_fence: 1,
      build_slot_lease_id: 'build-lease',
      build_slot_fence: 1,
      expires_at: new Date(Date.now() + 60_000).toISOString()
    } satisfies ProductClaimToken
    const binding = {
      vps_id: 1,
      host: 'target.test',
      port: 22,
      host_fingerprint: `SHA256:${'A'.repeat(43)}`,
      username: 'deploy',
      auth_type: 'key' as const,
      ssh_security_revision: 1
    }
    const repository = {
      readGitDispatchTargetBinding: () => ({ state: 'ready', binding })
    }
    const timeoutChannel = createSilentChannel()
    const timedOut = new GuardedSshExecutionSession(
      timeoutChannel as ClientChannel,
      repository as never,
      claim,
      1,
      binding,
      undefined,
      20
    )
    await expect(timedOut.open('/tmp/target-state')).rejects.toMatchObject({
      code: 'SSH_SESSION_TIMEOUT'
    })
    expect(timedOut.state).toBe('reconciliation_required')
    expect(timeoutChannel.destroyed).toBe(true)

    const controller = new AbortController()
    const abortChannel = createSilentChannel()
    const aborted = new GuardedSshExecutionSession(
      abortChannel as ClientChannel,
      repository as never,
      claim,
      2,
      binding,
      controller.signal,
      1_000
    )
    const opening = aborted.open('/tmp/target-state')
    controller.abort()
    await expect(opening).rejects.toMatchObject({ code: 'SSH_SESSION_ABORTED' })
    expect(aborted.state).toBe('reconciliation_required')
    expect(abortChannel.destroyed).toBe(true)
  })

  it('pollRuntimeUntilSettled fails closed if target reports a mismatched step', async () => {
    const claim = {
      controller_id: 'controller',
      app_id: 1,
      job_id: 'job',
      attempt_id: 'attempt',
      attempt_number: 1,
      ownership_generation: 1,
      source_generation: 1,
      source_config_sha256: 'a'.repeat(64),
      app_lease_id: 'app-lease',
      app_fence: 1,
      build_slot_lease_id: 'build-lease',
      build_slot_fence: 1,
      expires_at: new Date(Date.now() + 60_000).toISOString()
    } satisfies ProductClaimToken
    const binding = {
      vps_id: 1,
      host: 'target.test',
      port: 22,
      host_fingerprint: `SHA256:${'A'.repeat(43)}`,
      username: 'deploy',
      auth_type: 'key' as const,
      ssh_security_revision: 1
    }
    const repository = {
      readGitDispatchTargetBinding: () => ({ state: 'ready', binding })
    }

    const channel = createFakeChannel((req) => {
      const runtime =
        req.operation === 'poll_runtime'
          ? {
              state: 'step_succeeded',
              step: 'prepare', // mismatched step when caller expects 'activate'
              remote_quiescent: true
            }
          : undefined
      return {
        version: 1,
        request_id: req.request_id,
        sequence: req.sequence,
        state: 'accepted',
        deployment_id: 1,
        ...(runtime ? { runtime } : {})
      }
    })

    const session = new GuardedSshExecutionSession(
      channel as ClientChannel,
      repository as never,
      claim,
      1,
      binding,
      undefined,
      1000
    )

    await session.open('/tmp/target-state')
    await expect(session.pollRuntimeUntilSettled('activate')).rejects.toMatchObject({
      code: 'SSH_RUNTIME_REJECTED'
    })
    expect(session.state).toBe('reconciliation_required')
  })
})

function createSilentChannel(): Duplex {
  const channel = new Duplex({
    read() {
      this.push(Buffer.alloc(0))
    },
    write(_chunk, _encoding, callback) {
      callback()
    }
  })
  Object.defineProperty(channel, 'stderr', { value: new PassThrough() })
  return channel
}

function createFakeChannel(
  responder: (frame: Record<string, unknown>) => Record<string, unknown> | null
): Duplex {
  let buffered = Buffer.alloc(0)
  const channel = new Duplex({
    read() {
      // no-op
    },
    write(chunk: Buffer, _encoding, callback) {
      try {
        buffered = Buffer.concat([buffered, chunk])
        while (buffered.length >= 4) {
          const length = buffered.readUInt32BE(0)
          if (buffered.length < length + 4) break
          const payload = buffered.subarray(4, length + 4)
          buffered = buffered.subarray(length + 4)
          const request = JSON.parse(payload.toString('utf8'))
          const resp = responder(request)
          if (resp) {
            this.push(encodeGuardedSshFrame(resp))
          }
        }
        callback()
      } catch (err) {
        callback(err as Error)
      }
    }
  })
  Object.defineProperty(channel, 'stderr', { value: new PassThrough() })
  return channel
}
