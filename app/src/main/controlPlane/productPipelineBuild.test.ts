import { describe, expect, it } from 'vitest'
import { Duplex, PassThrough } from 'node:stream'
import type { ClientChannel } from 'ssh2'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import {
  encodeGuardedSshFrame
} from './guardedSshProtocol'
import { GuardedSshExecutionSession, GuardedSshSessionError } from './guardedSshSession'
import {
  executeProductBuildWithSession
} from './productPipelineSourceRender'
import type { PreparedProductGitSnapshot } from './productSnapshotPreparation'

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
            if (request.operation === 'close') {
              process.nextTick(() => {
                this.emit('close')
              })
            }
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

function createClaim(appId = 1, attemptId = 'attempt-1'): ProductClaimToken {
  return {
    controller_id: 'controller-1',
    app_id: appId,
    job_id: 'job-1',
    attempt_id: attemptId,
    attempt_number: 1,
    ownership_generation: 1,
    source_generation: 1,
    source_config_sha256: 'a'.repeat(64),
    app_lease_id: 'app-lease-1',
    app_fence: 1,
    build_slot_lease_id: 'build-lease-1',
    build_slot_fence: 1,
    expires_at: new Date(Date.now() + 60_000).toISOString()
  }
}

const mockBinding = {
  vps_id: 1,
  host: 'target.test',
  port: 22,
  host_fingerprint: `SHA256:${'A'.repeat(43)}`,
  username: 'deploy',
  auth_type: 'key' as const,
  ssh_security_revision: 1
}

describe('H1 Guarded SSH Build Protocol & Session Lifecycle', () => {
  it('startBuild and pollBuild settle cleanly when docker build succeeds', async () => {
    let currentSequence = 0
    let pollCount = 0

    const channel = createFakeChannel((req) => {
      currentSequence = req.sequence as number
      const op = req.operation as string
      if (op === 'open' || op === 'authorize_phase') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id
        }
      }
      if (op === 'start_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id,
          build_state: 'started'
        }
      }
      if (op === 'poll_build') {
        pollCount++
        if (pollCount < 2) {
          return {
            version: 1,
            request_id: req.request_id,
            sequence: currentSequence,
            state: 'accepted',
            deployment_id: req.deployment_id,
            build_state: 'running'
          }
        }
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id,
          build_state: 'succeeded',
          exit_code: 0,
          image_id: 'sha256:fedcba9876543210',
          image_tag: req.image_tag || 'opspilot-app:v1',
          labels: { 'opspilot.app_id': '1' }
        }
      }
      if (op === 'close') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id
        }
      }
      return null
    })

    const claim = createClaim()
    const repository = {
      readGitDispatchTargetBinding: () => ({ state: 'ready', binding: mockBinding })
    }

    const session = new GuardedSshExecutionSession(
      channel as unknown as ClientChannel,
      repository as never,
      claim,
      42,
      mockBinding
    )

    await session.open('/var/run/opspilot')
    expect(session.state).toBe('active')

    await session.startBuild('opspilot-app:v1')

    const settleRes = await session.pollBuildUntilSettled({
      pollIntervalMs: 10,
      timeoutMs: 5000
    })
    expect(settleRes.state).toBe('succeeded')
    if (settleRes.state === 'succeeded') {
      expect(settleRes.imageId).toBe('sha256:fedcba9876543210')
    }

    await session.close()
    expect(session.state).toBe('closed')
  })

  it('pollBuild settles with definite failure and bounded error_tail on build error', async () => {
    let currentSequence = 0

    const channel = createFakeChannel((req) => {
      currentSequence = req.sequence as number
      const op = req.operation as string
      if (op === 'open' || op === 'authorize_phase') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id
        }
      }
      if (op === 'start_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id,
          build_state: 'started'
        }
      }
      if (op === 'poll_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id,
          build_state: 'failed',
          exit_code: 1,
          error_tail: 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1'
        }
      }
      return null
    })

    const claim = createClaim()
    const repository = {
      readGitDispatchTargetBinding: () => ({ state: 'ready', binding: mockBinding })
    }

    const session = new GuardedSshExecutionSession(
      channel as unknown as ClientChannel,
      repository as never,
      claim,
      42,
      mockBinding
    )

    await session.open('/var/run/opspilot')
    await session.startBuild('opspilot-app:v1')

    const settleRes = await session.pollBuildUntilSettled({
      pollIntervalMs: 10,
      timeoutMs: 5000
    })
    expect(settleRes.state).toBe('failed')
    if (settleRes.state === 'failed') {
      expect(settleRes.exitCode).toBe(1)
      expect(settleRes.errorTail).toContain('ELIFECYCLE')
    }
  })

  it('rejects startBuild when server returns SSH_BUILD_REJECTED', async () => {
    let currentSequence = 0
    const channel = createFakeChannel((req) => {
      currentSequence = req.sequence as number
      if (req.operation === 'open' || req.operation === 'authorize_phase') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id
        }
      }
      if (req.operation === 'start_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'rejected',
          error_code: 'SSH_BUILD_REJECTED'
        }
      }
      return null
    })

    const claim = createClaim()
    const repository = {
      readGitDispatchTargetBinding: () => ({ state: 'ready', binding: mockBinding })
    }

    const session = new GuardedSshExecutionSession(
      channel as unknown as ClientChannel,
      repository as never,
      claim,
      42,
      mockBinding
    )

    await session.open('/var/run/opspilot')
    await expect(session.startBuild('opspilot-app:v1')).rejects.toThrowError(
      new GuardedSshSessionError('SSH_BUILD_REJECTED')
    )
  })

  it('marks session reconciliation_required when channel disconnects during build poll', async () => {
    let currentSequence = 0
    const channel = createFakeChannel((req) => {
      currentSequence = req.sequence as number
      if (req.operation === 'open' || req.operation === 'authorize_phase') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id
        }
      }
      if (req.operation === 'start_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id,
          build_state: 'started'
        }
      }
      // Drop connection on poll
      return null
    })

    const claim = createClaim()
    const repository = {
      readGitDispatchTargetBinding: () => ({ state: 'ready', binding: mockBinding })
    }

    const session = new GuardedSshExecutionSession(
      channel as unknown as ClientChannel,
      repository as never,
      claim,
      42,
      mockBinding,
      undefined,
      100 // short timeout
    )

    await session.open('/var/run/opspilot')
    await session.startBuild('opspilot-app:v1')

    await expect(session.pollBuild()).rejects.toMatchObject({
      code: 'SSH_SESSION_TIMEOUT'
    })
    expect(session.state).toBe('reconciliation_required')
  })
})

describe('executeProductBuildWithSession', () => {
  it('executes build with canonical deployment image tag and returns build_succeeded', async () => {
    let currentSequence = 0
    let recordedImageTag = ''

    const channel = createFakeChannel((req) => {
      currentSequence = req.sequence as number
      const op = req.operation as string
      if (op === 'open' || op === 'authorize_phase') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id
        }
      }
      if (op === 'start_build') {
        recordedImageTag = req.image_tag as string
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id,
          build_state: 'started'
        }
      }
      if (op === 'poll_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id,
          build_state: 'succeeded',
          exit_code: 0,
          image_id: 'sha256:1122334455667788',
          image_tag: recordedImageTag,
          labels: { 'opspilot.deployment_id': '101' }
        }
      }
      if (op === 'close') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id
        }
      }
      return null
    })

    const claim = createClaim()
    const repository = {
      readGitDispatchTargetBinding: () => ({ state: 'ready', binding: mockBinding })
    }

    const session = new GuardedSshExecutionSession(
      channel as unknown as ClientChannel,
      repository as never,
      claim,
      101,
      mockBinding
    )
    await session.open('/var/run/opspilot')

    const mockDb = {
      prepare: () => ({
        get: () => ({
          id: 101,
          app_id: 1,
          version: 5,
          image_tag: 'opspilot-app-1:20261026-001',
          status: 'building',
          git_commit_sha: 'e'.repeat(40)
        })
      })
    }

    const snapshot = {
      claim,
      metadata: {
        commitSha: 'e'.repeat(40),
        commitShaFull: 'e'.repeat(40),
        branch: 'main'
      },
      rootDirectory: '/tmp/repo',
      snapshotDirectory: '/tmp/repo',
      cleanup: () => {}
    } as unknown as PreparedProductGitSnapshot

    const result = await executeProductBuildWithSession(
      session,
      mockDb as never,
      snapshot,
      { pollIntervalMs: 10, timeoutMs: 2000 }
    )

    expect(result.state).toBe('build_succeeded')
    if (result.state === 'build_succeeded') {
      expect(result.image_tag).toBe('opspilot-app-1:20261026-001')
      expect(result.image_id).toBe('sha256:1122334455667788')
      expect(recordedImageTag).toBe('opspilot-app-1:20261026-001')
    }
  })

  it('returns build_failed_definite when build returns non-zero returncode without promoting deployment', async () => {
    let currentSequence = 0

    const channel = createFakeChannel((req) => {
      currentSequence = req.sequence as number
      const op = req.operation as string
      if (op === 'open' || op === 'authorize_phase') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id
        }
      }
      if (op === 'start_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id,
          build_state: 'started'
        }
      }
      if (op === 'poll_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: currentSequence,
          state: 'accepted',
          deployment_id: req.deployment_id,
          build_state: 'failed',
          exit_code: 137,
          error_tail: 'Killed: out of memory'
        }
      }
      return null
    })

    const claim = createClaim()
    const repository = {
      readGitDispatchTargetBinding: () => ({ state: 'ready', binding: mockBinding })
    }

    const session = new GuardedSshExecutionSession(
      channel as unknown as ClientChannel,
      repository as never,
      claim,
      102,
      mockBinding
    )
    await session.open('/var/run/opspilot')

    const mockDb = {
      prepare: () => ({
        get: () => ({
          id: 102,
          app_id: 1,
          version: 6,
          image_tag: 'opspilot-app-1:20261026-002',
          status: 'building',
          git_commit_sha: 'f'.repeat(40)
        })
      })
    }

    const snapshot = {
      claim,
      metadata: {
        commitSha: 'f'.repeat(40),
        commitShaFull: 'f'.repeat(40),
        branch: 'main'
      },
      rootDirectory: '/tmp/repo',
      snapshotDirectory: '/tmp/repo',
      cleanup: () => {}
    } as unknown as PreparedProductGitSnapshot

    const result = await executeProductBuildWithSession(
      session,
      mockDb as never,
      snapshot,
      { pollIntervalMs: 10, timeoutMs: 2000 }
    )

    expect(result.state).toBe('build_failed_definite')
    if (result.state === 'build_failed_definite') {
      expect(result.exit_code).toBe(137)
      expect(result.error_tail).toContain('Killed')
    }
  })

  it('rejects execution when deployment status is not building or commit sha mismatches', async () => {
    const channel = createFakeChannel((req) => {
      return {
        version: 1,
        request_id: req.request_id,
        sequence: req.sequence,
        state: 'accepted',
        deployment_id: req.deployment_id
      }
    })

    const claim = createClaim()
    const repository = {
      readGitDispatchTargetBinding: () => ({ state: 'ready', binding: mockBinding })
    }

    const session = new GuardedSshExecutionSession(
      channel as unknown as ClientChannel,
      repository as never,
      claim,
      103,
      mockBinding
    )
    await session.open('/var/run/opspilot')

    // Mismatched commit sha
    const mockDb = {
      prepare: () => ({
        get: () => ({
          id: 103,
          app_id: 1,
          version: 7,
          image_tag: 'opspilot-app-1:20261026-003',
          status: 'building',
          git_commit_sha: 'different-sha'
        })
      })
    }

    const snapshot = {
      claim,
      metadata: {
        commitSha: 'expected-sha',
        commitShaFull: 'expected-sha',
        branch: 'main'
      },
      rootDirectory: '/tmp/repo',
      snapshotDirectory: '/tmp/repo',
      cleanup: () => {}
    } as unknown as PreparedProductGitSnapshot

    await expect(
      executeProductBuildWithSession(session, mockDb as never, snapshot)
    ).rejects.toThrowError('PRODUCT_SOURCE_RENDER_INVALID_DEPLOYMENT')
  })
})
