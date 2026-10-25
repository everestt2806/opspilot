import { describe, expect, it } from 'vitest'
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
    expect(() => encodeGuardedSshFrame('x'.repeat(20_000))).toThrow(
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
