import { getEventListeners } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Duplex, PassThrough } from 'node:stream'
import type { ClientChannel } from 'ssh2'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import {
  GuardedSshFrameDecoder,
  GuardedSshProtocolError,
  encodeGuardedSshFrame
} from './guardedSshProtocol'
import { GuardedSshExecutionSession, GuardedSshSessionError } from './guardedSshSession'
import * as guardedSession from './guardedSshSession'
import {
  executeProductBuildWithSession,
  redactSecrets,
  stageProductSourceAndRender
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

describe('Leader retest POST-004..006', () => {
  it.each([
    '{"token":"REVIEW_FAKE_SECRET"}',
    "password='REVIEW_FAKE_SECRET'",
    'GITHUB_TOKEN=REVIEW_FAKE_SECRET',
    '-----BEGIN PRIVATE KEY-----\nREVIEW_FAKE_SECRET\n-----END PRIVATE KEY-----',
    'arbitrary unlabelled REVIEW_FAKE_SECRET',
    'truncated-token-fragment-REVIEW_FAKE_SECRET'
  ])('POST-004: arbitrary build output is withheld (%#)', (value) => {
    expect(redactSecrets(value)).toBe('[REDACTED BUILD OUTPUT]')
  })

  it.each([undefined, 'b'.repeat(40), 'a'.repeat(40)])(
    'POST-006: validates receipt revision against full canonical source (%#)',
    async (revision) => {
      let requestedSha: unknown
      const channel = createFakeChannel((request) => {
        if (request.operation === 'start_build') requestedSha = request.source_sha
        return {
          version: 1,
          request_id: request.request_id,
          sequence: request.sequence,
          state: 'accepted',
          deployment_id: 101,
          ...(request.operation === 'poll_build'
            ? {
                build_state: 'succeeded',
                exit_code: 0,
                image_id: `sha256:${'a'.repeat(64)}`,
                image_tag: 'example:v1',
                labels: {
                  'opspilot.app_id': '1',
                  'opspilot.deployment_id': '101',
                  ...(revision ? { 'org.opencontainers.image.revision': revision } : {})
                }
              }
            : {})
        }
      })
      const claim = createClaim()
      const session = new GuardedSshExecutionSession(
        channel as unknown as ClientChannel,
        {
          readGitDispatchTargetBinding: () => ({ state: 'ready', binding: mockBinding })
        } as never,
        claim,
        101,
        mockBinding
      )
      const database = {
        prepare: () => ({
          get: () => ({
            id: 101,
            app_id: 1,
            image_tag: 'example:v1',
            status: 'building',
            git_commit_sha: 'a'.repeat(40)
          })
        })
      }
      try {
        await session.open('/fixture/state')
        const result = executeProductBuildWithSession(
          session,
          database as never,
          {
            claim,
            metadata: { commitSha: 'a'.repeat(40) }
          } as never
        )
        if (revision === 'a'.repeat(40))
          await expect(result).resolves.toMatchObject({ state: 'build_succeeded' })
        else
          await expect(result).rejects.toMatchObject({
            code: 'PRODUCT_SOURCE_RENDER_INVALID_DEPLOYMENT'
          })
        expect(requestedSha).toBe('a'.repeat(40))
      } finally {
        session.failClosed()
      }
    }
  )

  it.each(['oversize', 'bad-name', 'collector-missing'])(
    'POST-005: rejects local %s before opening dispatch',
    async (scenario) => {
      const root = mkdtempSync(join(tmpdir(), 'opspilot-preflight-review-'))
      const open = vi.spyOn(guardedSession, 'openProductGuardedSshSession')
      try {
        writeFileSync(
          join(root, 'package.json'),
          JSON.stringify({
            main: 'server.js',
            scripts: { start: 'node server.js' },
            dependencies: { express: '^4.21.2' }
          })
        )
        writeFileSync(join(root, 'server.js'), "require('express')().listen(3000)")
        if (scenario === 'oversize') {
          writeFileSync(join(root, 'large.bin'), '')
          truncateSync(join(root, 'large.bin'), 9 * 1024 * 1024)
        }
        const database = {
          prepare: () => ({
            get: () => ({
              id: 1,
              framework: 'express',
              needs_db: 0,
              name: scenario === 'bad-name' ? 'bad/name' : 'example',
              host_port: 30000,
              container_port: 3000,
              healthcheck_path: '/health'
            })
          })
        }
        await expect(
          stageProductSourceAndRender(
            database as never,
            {} as never,
            {} as never,
            {
              claim: createClaim(),
              rootDirectory: root
            } as never,
            {
              vps_id: 1,
              target_helper_path: '/fixture/helper',
              target_state_root: '/fixture/state',
              collector_directory: scenario === 'collector-missing' ? join(root, 'missing') : root
            }
          )
        ).rejects.toBeDefined()
        expect(open).not.toHaveBeenCalled()
      } finally {
        open.mockRestore()
        rmSync(root, { recursive: true, force: true })
      }
    }
  )
})

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
          image_id: 'sha256:' + 'a'.repeat(64),
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

    await session.startBuild('opspilot-app:v1', 'a'.repeat(40))

    const settleRes = await session.pollBuildUntilSettled({
      pollIntervalMs: 10,
      timeoutMs: 5000
    })
    expect(settleRes.state).toBe('succeeded')
    if (settleRes.state === 'succeeded') {
      expect(settleRes.imageId).toBe('sha256:' + 'a'.repeat(64))
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
    await session.startBuild('opspilot-app:v1', 'a'.repeat(40))

    const settleRes = await session.pollBuildUntilSettled({
      pollIntervalMs: 10,
      timeoutMs: 5000
    })
    expect(settleRes.state).toBe('failed')
    if (settleRes.state === 'failed') {
      expect(settleRes.exitCode).toBe(1)
      expect(settleRes.errorTail).toBe('[REDACTED BUILD OUTPUT]')
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
    await expect(session.startBuild('opspilot-app:v1', 'a'.repeat(40))).rejects.toThrowError(
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
    await session.startBuild('opspilot-app:v1', 'a'.repeat(40))

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
          image_id: 'sha256:' + 'b'.repeat(64),
          image_tag: recordedImageTag,
          labels: {
            'opspilot.app_id': '1',
            'opspilot.deployment_id': '101',
            'org.opencontainers.image.revision': 'e'.repeat(40)
          }
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

    const result = await executeProductBuildWithSession(session, mockDb as never, snapshot, {
      pollIntervalMs: 10,
      timeoutMs: 2000
    })

    expect(result.state).toBe('build_succeeded')
    if (result.state === 'build_succeeded') {
      expect(result.image_tag).toBe('opspilot-app-1:20261026-001')
      expect(result.image_id).toBe('sha256:' + 'b'.repeat(64))
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

    const result = await executeProductBuildWithSession(session, mockDb as never, snapshot, {
      pollIntervalMs: 10,
      timeoutMs: 2000
    })

    expect(result.state).toBe('build_failed_definite')
    if (result.state === 'build_failed_definite') {
      expect(result.exit_code).toBe(137)
      expect(result.error_tail).toBe('[REDACTED BUILD OUTPUT]')
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

  it('H1-R01 & H1-R02: rejects invalid image ID, non-zero exit code, or wrong image tag on succeeded', async () => {
    const runHarness = async (
      overrides: Record<string, unknown>
    ): ReturnType<GuardedSshExecutionSession['pollBuildUntilSettled']> => {
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
            build_state: 'succeeded',
            exit_code: 0,
            image_id: 'sha256:' + 'c'.repeat(64),
            image_tag: 'opspilot-app:v1',
            labels: { 'opspilot.app_id': '1' },
            ...overrides
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
        201,
        mockBinding
      )
      await session.open('/var/run/opspilot')
      await session.startBuild('opspilot-app:v1', 'a'.repeat(40))
      return session.pollBuildUntilSettled({ pollIntervalMs: 5, timeoutMs: 1000 })
    }

    // Malformed image ID
    await expect(runHarness({ image_id: 'invalid-image-id' })).rejects.toThrowError(
      'SSH_BUILD_FAILED'
    )
    // Non-zero exit code on succeeded
    await expect(runHarness({ exit_code: 99 })).rejects.toThrowError('SSH_BUILD_FAILED')
    // Wrong image tag
    await expect(runHarness({ image_tag: 'wrong-tag:v999' })).rejects.toThrowError(
      'SSH_BUILD_FAILED'
    )
  })

  it('H1-R02: decoder rejects labels array as SSH_PROTOCOL_MALFORMED', () => {
    const decoder = new GuardedSshFrameDecoder()
    const malformedPayload = Buffer.from(
      JSON.stringify({
        version: 1,
        request_id: 'req-1',
        sequence: 1,
        state: 'accepted',
        labels: ['array-is-not-allowed']
      }),
      'utf8'
    )
    const frame = Buffer.allocUnsafe(4 + malformedPayload.length)
    frame.writeUInt32BE(malformedPayload.length, 0)
    malformedPayload.copy(frame, 4)

    expect(() => decoder.push(frame)).toThrowError(GuardedSshProtocolError)
    expect(() => decoder.push(frame)).toThrowError('SSH_PROTOCOL_MALFORMED')
  })

  it('H1-R02: executeProductBuildWithSession fails closed when identity labels are missing or mismatch', async () => {
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
          build_state: 'succeeded',
          exit_code: 0,
          image_id: 'sha256:' + 'd'.repeat(64),
          image_tag: 'opspilot-app-1:20261026-004',
          labels: {} // Missing opspilot.app_id and deployment_id
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
      202,
      mockBinding
    )
    await session.open('/var/run/opspilot')

    const mockDb = {
      prepare: () => ({
        get: () => ({
          id: 202,
          app_id: 1,
          version: 8,
          image_tag: 'opspilot-app-1:20261026-004',
          status: 'building',
          git_commit_sha: 'c'.repeat(40)
        })
      })
    }
    const snapshot = {
      claim,
      metadata: { commitSha: 'c'.repeat(40) }
    } as unknown as PreparedProductGitSnapshot

    await expect(
      executeProductBuildWithSession(session, mockDb as never, snapshot, {
        pollIntervalMs: 5,
        timeoutMs: 1000
      })
    ).rejects.toThrowError('PRODUCT_SOURCE_RENDER_INVALID_DEPLOYMENT')

    expect(session.state).toBe('reconciliation_required')
  })

  it('H1-R03: redacts credentials, private keys, bearer tokens and secrets from error_tail', async () => {
    let currentSequence = 0
    const rawSecretLog =
      'DATABASE_URL=postgres://app_user:SUPER_SECRET_PASSWORD@db.internal:5432/prod\n' +
      'TOKEN=ghp_SecretTokenValue123456\n' +
      'Authorization: Bearer my-secret-jwt-token\n' +
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----\n'

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
          error_tail: rawSecretLog
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
      203,
      mockBinding
    )
    await session.open('/var/run/opspilot')

    const mockDb = {
      prepare: () => ({
        get: () => ({
          id: 203,
          app_id: 1,
          version: 9,
          image_tag: 'opspilot-app-1:20261026-005',
          status: 'building',
          git_commit_sha: 'd'.repeat(40)
        })
      })
    }
    const snapshot = {
      claim,
      metadata: { commitSha: 'd'.repeat(40) }
    } as unknown as PreparedProductGitSnapshot

    const result = await executeProductBuildWithSession(session, mockDb as never, snapshot, {
      pollIntervalMs: 5,
      timeoutMs: 1000
    })

    expect(result.state).toBe('build_failed_definite')
    if (result.state === 'build_failed_definite') {
      expect(result.error_tail).toBeDefined()
      expect(result.error_tail).not.toContain('SUPER_SECRET_PASSWORD')
      expect(result.error_tail).not.toContain('ghp_SecretTokenValue123456')
      expect(result.error_tail).not.toContain('my-secret-jwt-token')
      expect(result.error_tail).not.toContain('MIIEowIBAAKCAQEA...')
      expect(result.error_tail).toBe('[REDACTED BUILD OUTPUT]')
    }
  })

  it('H1-R04: poll interval timer does not leak abort event listeners on signal', async () => {
    let polls = 0
    let currentSequence = 0
    const abort = new AbortController()

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
        polls++
        if (polls < 6) {
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
          image_id: 'sha256:' + 'e'.repeat(64),
          image_tag: 'opspilot-app:v1',
          labels: { 'opspilot.app_id': '1' }
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
      204,
      mockBinding,
      abort.signal
    )

    const initialListeners = getEventListeners(abort.signal, 'abort').length
    await session.open('/var/run/opspilot')
    await session.startBuild('opspilot-app:v1', 'a'.repeat(40))
    await session.pollBuildUntilSettled({ timeoutMs: 2000, pollIntervalMs: 5 })

    const finalListeners = getEventListeners(abort.signal, 'abort').length
    // No abort listener leakage after 6 poll sleep cycles
    expect(finalListeners).toBe(initialListeners)
  })

  it('H1-R05: preflight validation rejects unsupported app before opening SSH session or creating deployment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opspilot-h1-preflight-'))
    const openSpy = vi.spyOn(guardedSession, 'openProductGuardedSshSession')

    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          main: 'server.js',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.21.2' }
        })
      )
      writeFileSync(join(root, 'server.js'), "require('express')().listen(3000)\n")

      const claim = createClaim()
      const mockDb = {
        prepare: () => ({
          get: () => ({ id: 1, framework: 'vite', needs_db: 0 })
        })
      }
      const snapshot = {
        claim,
        rootDirectory: root
      } as unknown as PreparedProductGitSnapshot

      await expect(
        stageProductSourceAndRender(mockDb as never, {} as never, {} as never, snapshot, {
          vps_id: 1,
          target_helper_path: '/fixture/helper',
          target_state_root: '/fixture/state'
        })
      ).rejects.toMatchObject({ code: 'PRODUCT_SOURCE_RENDER_UNSUPPORTED_PLAN' })

      // Crucial: SSH session opener was never called because preflight stopped it
      expect(openSpy).toHaveBeenCalledTimes(0)
    } finally {
      openSpy.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
