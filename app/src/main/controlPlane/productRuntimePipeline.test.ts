import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClientChannel } from 'ssh2'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import type {
  H2MetricBoundary,
  H2RuntimeIdentity,
  H2RuntimeStep,
  H2TerminalReceipt
} from '../../../../docs/contracts/product-h2-runtime'
import { closeDatabase, initializeDatabase } from '../db/index'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { ProductRuntimeRepository } from '../db/productRuntimeRepository'
import type { SshManager } from '../ssh/manager'
import { encodeGuardedSshFrame } from './guardedSshProtocol'
import { hashH2, signH2 } from './productH2Proof'
import {
  executeProductDeployPipeline,
  recoverProductRuntimeSession
} from './productRuntimePipeline'
import type { PreparedProductGitSnapshot } from './productSnapshotPreparation'

const SECRET = Buffer.alloc(32, 0x42)
const CONTROLLER = 'h2-pipeline-controller'
const TARGET_PIN = `SHA256:${'A'.repeat(43)}`
const SHA_A = '1'.repeat(40)
const SHA_B = '2'.repeat(40)
const HASH = 'a'.repeat(64)
const IMAGE_ID_B = `sha256:${'b'.repeat(64)}`
const NOW = Date.parse('2026-10-27T12:00:00.000Z')

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

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

interface TestSetup {
  database: ReturnType<typeof initializeDatabase>
  runtimeRepository: ProductRuntimeRepository
  deployRepository: ProductDeployRepository
  claim: ProductClaimToken
  snapshot: PreparedProductGitSnapshot
  rootDirectory: string
  deploymentId: number
}

function setupTestEnvironment(
  options: {
    withPrevious?: boolean
    buildFails?: boolean
  } = {}
): TestSetup {
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-pipeline-test-'))
  const database = initializeDatabase(testDirectory)
  const runtimeRepository = new ProductRuntimeRepository(database, {
    secret: SECRET,
    clock: () => NOW
  })
  const deployRepository = ProductDeployRepository.withClockForTest(database, () => NOW)

  const rootDirectory = join(testDirectory, 'source-repo')
  mkdirSync(rootDirectory, { recursive: true })
  writeFileSync(
    join(rootDirectory, 'package.json'),
    JSON.stringify({
      main: 'server.js',
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4.21.2' }
    })
  )
  writeFileSync(join(rootDirectory, 'server.js'), "require('express')().listen(3000)")

  const collectorDir = join(testDirectory, 'collector')
  mkdirSync(collectorDir, { recursive: true })
  writeFileSync(join(collectorDir, 'Dockerfile'), 'FROM alpine\n')

  database.exec(`
    INSERT INTO vps (id, name, host, port, host_fingerprint, username, auth_type, encrypted_secret, ssh_security_revision)
      VALUES (1, 'vps-1', 'target.example.test', 2222, '${TARGET_PIN}', 'deploy', 'key', X'00', 1);
    INSERT INTO app (id, vps_id, name, framework, host_port, container_port, healthcheck_path, source_type, git_repo_url, git_ref, git_root, current_deployment_id)
      VALUES (1, 1, 'my-express-app', 'express', 30001, 3000, '/healthz', 'git', 'https://example.test/repo.git', 'main', '.', ${options.withPrevious ? 1 : 'NULL'});
    INSERT INTO product_controller VALUES ('${CONTROLLER}', '2026-10-27T10:00:00.000Z', 'active');
    INSERT INTO product_source_config VALUES
      (1, 1, 'https://example.test/repo.git', 'main', '.', '{}', '${HASH}', '2026-10-27T10:00:00.000Z');
    INSERT INTO product_app_control
      (app_id, mode, controller_id, ownership_generation, source_generation, source_config_sha256, changed_at)
      VALUES (1, 'product', '${CONTROLLER}', 1, 1, '${HASH}', '2026-10-27T10:00:00.000Z');
  `)

  if (options.withPrevious) {
    database.exec(`
      INSERT INTO deployment (id, app_id, version, image_tag, git_commit_sha, status, started_at)
        VALUES (1, 1, 1, 'my-express-app:v1', '${SHA_A}', 'running', '2026-10-27T10:00:00.000Z');
      INSERT INTO deployment_activation (id, app_id, deployment_id, stream_generation, start_offset, reason, state, activated_at)
        VALUES (10, 1, 1, 'gen-prev', 1, 'deploy', 'active', '2026-10-27T10:05:00.000Z');
    `)
  }

  const deploymentId = options.withPrevious ? 2 : 1

  const claim: ProductClaimToken = {
    job_id: 'job-pipeline-1',
    controller_id: CONTROLLER,
    ownership_generation: 1,
    app_id: 1,
    source_generation: 1,
    source_config_sha256: HASH,
    app_lease_id: 'lease-app-1',
    app_fence: 1,
    build_slot_lease_id: 'lease-slot-1',
    build_slot_fence: 1,
    attempt_id: 'attempt-pipeline-1',
    attempt_number: 1,
    expires_at: new Date(NOW + 60_000).toISOString()
  }

  database.exec(`
    INSERT INTO product_deploy_job
      (job_id, controller_id, app_id, ownership_generation, source_generation, source_config_sha256,
       trigger, idempotency_key, ref, target_sha, observation_sequence, reconcile_epoch, state,
       attempt_count, max_attempts, available_at, created_at, updated_at)
      VALUES ('job-pipeline-1', '${CONTROLLER}', 1, 1, 1, '${HASH}',
       'manual_redeploy', 'manual:job-1', 'main', '${SHA_B}', NULL, NULL, 'claimed',
       1, 3, '2026-10-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z');

    INSERT INTO product_app_fence (app_id, last_fence) VALUES (1, 1);

    INSERT INTO product_app_lease
      (app_id, lease_id, controller_id, ownership_generation, fence, job_id, expires_at, acquired_at, heartbeat_at)
      VALUES (1, 'lease-app-1', '${CONTROLLER}', 1, 1, 'job-pipeline-1', '${new Date(NOW + 60_000).toISOString()}', '2026-10-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z');

    INSERT INTO product_worker_lease
      (slot_name, lease_id, controller_id, fence, job_id, expires_at, acquired_at, heartbeat_at)
      VALUES ('build', 'lease-slot-1', '${CONTROLLER}', 1, 'job-pipeline-1', '${new Date(NOW + 60_000).toISOString()}', '2026-10-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z');

    INSERT INTO product_deploy_attempt
      (attempt_id, job_id, deployment_id, attempt_number, lease_id, fencing_token,
       build_slot_lease_id, build_slot_fence, state, remote_outcome, started_at)
      VALUES ('attempt-pipeline-1', 'job-pipeline-1', NULL, 1, 'lease-app-1', 1,
       'lease-slot-1', 1, 'snapshot_verified', 'not_started', '2026-10-27T11:00:00.000Z');
  `)

  const snapshot: PreparedProductGitSnapshot = {
    claim,
    rootDirectory,
    snapshotDirectory: rootDirectory,
    cleanup() {
      // no-op
    },
    metadata: {
      commitSha: SHA_B,
      repositoryUrl: 'https://example.test/repo.git',
      repositoryRoot: '.',
      sourceConfigSha256: HASH
    }
  }

  return {
    database,
    runtimeRepository,
    deployRepository,
    claim,
    snapshot,
    rootDirectory,
    deploymentId
  }
}

describe('Product Runtime Pipeline (H2-B)', () => {
  it('happy path V1 -> V2 succeeds and settles in single session', async () => {
    const env = setupTestEnvironment({ withPrevious: true })
    const boundaryB0: H2MetricBoundary = {
      generation: 'gen-v2',
      device: 10,
      inode: 20,
      next_offset: 100
    }

    let configuredContext: Record<string, unknown> | null = null
    let activeRuntimeStep: H2RuntimeStep = 'prepare'

    const fakeChannel = createFakeChannel((req) => {
      const op = req.operation as string
      const seq = req.sequence as number
      const depId = req.deployment_id as number

      if (
        op === 'open' ||
        op === 'authorize_phase' ||
        op === 'begin_scope' ||
        op === 'begin_file' ||
        op === 'file_chunk' ||
        op === 'finish_file' ||
        op === 'complete_scope' ||
        op === 'start_build' ||
        op === 'close'
      ) {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'poll_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          build_state: 'succeeded',
          exit_code: 0,
          image_id: IMAGE_ID_B,
          image_tag: `my-express-app:v${depId}`,
          labels: {
            'opspilot.app_id': '1',
            'opspilot.deployment_id': String(depId),
            'org.opencontainers.image.revision': SHA_B
          }
        }
      }

      if (op === 'runtime_configure') {
        configuredContext = req.context as Record<string, unknown>
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'start_runtime_step') {
        activeRuntimeStep = (req as Record<string, unknown>).step as H2RuntimeStep
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'poll_runtime') {
        // Return progress based on what step was started
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          runtime: {
            state: 'step_succeeded',
            step: activeRuntimeStep,
            remote_quiescent: true,
            boundary: boundaryB0,
            candidate: {
              deployment_id: depId,
              image_tag: `my-express-app:v${depId}`,
              image_id: IMAGE_ID_B,
              source_sha: SHA_B,
              container_id: 'c'.repeat(64),
              collector_container_id: 'd'.repeat(64),
              collector_image_id: `sha256:${'e'.repeat(64)}`,
              config_sha256: 'f'.repeat(64),
              health: 'healthy',
              http_status: 200
            }
          }
        }
      }

      if (op === 'seal_runtime') {
        const candidateRuntime: H2RuntimeIdentity = {
          deployment_id: depId,
          image_tag: `my-express-app:v${depId}`,
          image_id: IMAGE_ID_B,
          source_sha: SHA_B,
          container_id: 'c'.repeat(64),
          collector_container_id: 'd'.repeat(64),
          collector_image_id: `sha256:${'e'.repeat(64)}`,
          config_sha256: 'f'.repeat(64),
          health: 'healthy',
          http_status: 200
        }
        const previousRuntime: H2RuntimeIdentity = {
          deployment_id: 1,
          image_tag: 'my-express-app:v1',
          image_id: `sha256:${'1'.repeat(64)}`,
          source_sha: SHA_A,
          container_id: '1'.repeat(64),
          collector_container_id: '2'.repeat(64),
          collector_image_id: `sha256:${'2'.repeat(64)}`,
          config_sha256: '3'.repeat(64),
          health: 'healthy',
          http_status: 200
        }
        const receipt: H2TerminalReceipt = {
          version: 1,
          context: configuredContext as never,
          outcome: 'succeeded',
          failed_step: null,
          active_runtime: candidateRuntime,
          candidate_runtime: candidateRuntime,
          previous_runtime: previousRuntime,
          boundary: boundaryB0,
          exposure_status: 'not_checked',
          remote_quiescent: true,
          sealed_at: new Date(NOW).toISOString()
        }
        const receiptSha = hashH2(receipt)
        const signature = signH2('receipt', receipt, SECRET)
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          terminal: {
            receipt,
            receipt_sha256: receiptSha,
            signature
          }
        }
      }

      if (op === 'settle_runtime') {
        const attestation = req.attestation as { payload: Record<string, unknown> }
        const payload = {
          version: 1,
          kind: 'product-h2-settlement',
          commit_id: attestation.payload.commit_id,
          receipt_sha256: attestation.payload.receipt_sha256,
          context_sha256: attestation.payload.context_sha256,
          execution_nonce: attestation.payload.execution_nonce,
          attempt_id: attestation.payload.attempt_id,
          deployment_id: depId,
          settled_at: new Date(NOW).toISOString()
        }
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          settlement: {
            payload,
            signature: signH2('settlement', payload, SECRET)
          }
        }
      }

      return null
    })

    const sshManagerMock: SshManager = {
      openGuardedExecutionChannelWithIdentity: async () => ({
        channel: fakeChannel as unknown as ClientChannel,
        identity: {
          vpsId: 1,
          host: 'target.example.test',
          port: 2222,
          hostFingerprint: TARGET_PIN,
          username: 'deploy',
          authType: 'key' as const
        }
      })
    } as unknown as SshManager

    const result = await executeProductDeployPipeline(
      env.database,
      env.runtimeRepository,
      env.deployRepository,
      sshManagerMock,
      env.snapshot,
      {
        vps_id: 1,
        target_helper_path: '/usr/local/bin/helper',
        target_state_root: '/var/lib/opspilot'
      }
    )

    expect(result.state).toBe('succeeded')
    expect(result.deployment_id).toBe(2)
    expect(result.terminal.settled_at).toBeDefined()
    expect(result.terminal.leases_released_at).toBeDefined()

    // Verify DB state after T1 & T2
    const deployment = env.database.prepare('SELECT status FROM deployment WHERE id=2').get() as {
      status: string
    }
    expect(deployment.status).toBe('running')

    const previousDeployment = env.database
      .prepare('SELECT status FROM deployment WHERE id=1')
      .get() as { status: string }
    expect(previousDeployment.status).toBe('stopped')

    const app = env.database.prepare('SELECT current_deployment_id FROM app WHERE id=1').get() as {
      current_deployment_id: number
    }
    expect(app.current_deployment_id).toBe(2)

    // Check leases are released
    const appLease = env.database
      .prepare('SELECT released_at FROM product_app_lease WHERE lease_id=?')
      .get('lease-app-1') as { released_at: string | null }
    expect(appLease.released_at).not.toBeNull()
  })

  it('definite build failure preserves previous deployment without activation barrier', async () => {
    const env = setupTestEnvironment({ withPrevious: true, buildFails: true })
    let configuredContext: Record<string, unknown> | null = null

    const fakeChannel = createFakeChannel((req) => {
      const op = req.operation as string
      const seq = req.sequence as number
      const depId = req.deployment_id as number

      if (
        op === 'open' ||
        op === 'authorize_phase' ||
        op === 'begin_scope' ||
        op === 'begin_file' ||
        op === 'file_chunk' ||
        op === 'finish_file' ||
        op === 'complete_scope' ||
        op === 'start_build' ||
        op === 'start_runtime_step' ||
        op === 'close'
      ) {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'poll_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          build_state: 'failed',
          exit_code: 1,
          error_code: 'SSH_BUILD_FAILED',
          error_tail: '[REDACTED BUILD OUTPUT]'
        }
      }

      if (op === 'runtime_configure') {
        configuredContext = req.context as Record<string, unknown>
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'poll_runtime') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          runtime: {
            state: 'step_succeeded',
            step: 'prepare',
            remote_quiescent: true
          }
        }
      }

      if (op === 'seal_runtime') {
        const previousRuntime: H2RuntimeIdentity = {
          deployment_id: 1,
          image_tag: 'my-express-app:v1',
          image_id: `sha256:${'1'.repeat(64)}`,
          source_sha: SHA_A,
          container_id: '1'.repeat(64),
          collector_container_id: '2'.repeat(64),
          collector_image_id: `sha256:${'2'.repeat(64)}`,
          config_sha256: '3'.repeat(64),
          health: 'healthy',
          http_status: 200
        }
        const receipt: H2TerminalReceipt = {
          version: 1,
          context: configuredContext as never,
          outcome: 'failed',
          failed_step: 'BUILD',
          active_runtime: previousRuntime,
          candidate_runtime: null,
          previous_runtime: previousRuntime,
          boundary: null,
          exposure_status: 'not_checked',
          remote_quiescent: true,
          sealed_at: new Date(NOW).toISOString()
        }
        const receiptSha = hashH2(receipt)
        const signature = signH2('receipt', receipt, SECRET)
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          terminal: {
            receipt,
            receipt_sha256: receiptSha,
            signature
          }
        }
      }

      if (op === 'settle_runtime') {
        const attestation = req.attestation as { payload: Record<string, unknown> }
        const payload = {
          version: 1,
          kind: 'product-h2-settlement',
          commit_id: attestation.payload.commit_id,
          receipt_sha256: attestation.payload.receipt_sha256,
          context_sha256: attestation.payload.context_sha256,
          execution_nonce: attestation.payload.execution_nonce,
          attempt_id: attestation.payload.attempt_id,
          deployment_id: depId,
          settled_at: new Date(NOW).toISOString()
        }
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          settlement: {
            payload,
            signature: signH2('settlement', payload, SECRET)
          }
        }
      }

      return null
    })

    const sshManagerMock: SshManager = {
      openGuardedExecutionChannelWithIdentity: async () => ({
        channel: fakeChannel as unknown as ClientChannel,
        identity: {
          vpsId: 1,
          host: 'target.example.test',
          port: 2222,
          hostFingerprint: TARGET_PIN,
          username: 'deploy',
          authType: 'key' as const
        }
      })
    } as unknown as SshManager

    const result = await executeProductDeployPipeline(
      env.database,
      env.runtimeRepository,
      env.deployRepository,
      sshManagerMock,
      env.snapshot,
      {
        vps_id: 1,
        target_helper_path: '/usr/local/bin/helper',
        target_state_root: '/var/lib/opspilot'
      }
    )

    expect(result.state).toBe('failed')
    if (result.state === 'failed') {
      expect(result.failed_step).toBe('BUILD')
    }

    // Verify DB state
    const deployment = env.database
      .prepare('SELECT status, failed_step FROM deployment WHERE id=2')
      .get() as { status: string; failed_step: string }
    expect(deployment.status).toBe('failed')
    expect(deployment.failed_step).toBe('BUILD')

    // Previous remains running and current!
    const previousDeployment = env.database
      .prepare('SELECT status FROM deployment WHERE id=1')
      .get() as { status: string }
    expect(previousDeployment.status).toBe('running')

    const app = env.database.prepare('SELECT current_deployment_id FROM app WHERE id=1').get() as {
      current_deployment_id: number
    }
    expect(app.current_deployment_id).toBe(1)
  })

  it('unhealthy candidate rolls back to previous and captures R0 boundary', async () => {
    const env = setupTestEnvironment({ withPrevious: true })
    const boundaryB0: H2MetricBoundary = {
      generation: 'gen-v2',
      device: 10,
      inode: 20,
      next_offset: 100
    }
    const boundaryR0: H2MetricBoundary = {
      generation: 'gen-v2',
      device: 10,
      inode: 20,
      next_offset: 250
    }

    let configuredContext: Record<string, unknown> | null = null
    let currentStep = ''

    const fakeChannel = createFakeChannel((req) => {
      const op = req.operation as string
      const seq = req.sequence as number
      const depId = req.deployment_id as number

      if (
        op === 'open' ||
        op === 'authorize_phase' ||
        op === 'begin_scope' ||
        op === 'begin_file' ||
        op === 'file_chunk' ||
        op === 'finish_file' ||
        op === 'complete_scope' ||
        op === 'start_build' ||
        op === 'close'
      ) {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'start_runtime_step') {
        currentStep = req.step as string
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'poll_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          build_state: 'succeeded',
          exit_code: 0,
          image_id: IMAGE_ID_B,
          image_tag: `my-express-app:v${depId}`,
          labels: {
            'opspilot.app_id': '1',
            'opspilot.deployment_id': String(depId),
            'org.opencontainers.image.revision': SHA_B
          }
        }
      }

      if (op === 'runtime_configure') {
        configuredContext = req.context as Record<string, unknown>
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'poll_runtime') {
        if (currentStep === 'prepare') {
          return {
            version: 1,
            request_id: req.request_id,
            sequence: seq,
            state: 'accepted',
            deployment_id: depId,
            runtime: {
              state: 'step_succeeded',
              step: 'prepare',
              remote_quiescent: true,
              boundary: boundaryB0
            }
          }
        }
        if (currentStep === 'health') {
          // Unhealthy!
          return {
            version: 1,
            request_id: req.request_id,
            sequence: seq,
            state: 'accepted',
            deployment_id: depId,
            runtime: {
              state: 'step_failed',
              step: 'health',
              remote_quiescent: true,
              candidate: {
                deployment_id: depId,
                image_tag: `my-express-app:v${depId}`,
                image_id: IMAGE_ID_B,
                source_sha: SHA_B,
                container_id: 'c'.repeat(64),
                collector_container_id: 'd'.repeat(64),
                collector_image_id: `sha256:${'e'.repeat(64)}`,
                config_sha256: 'f'.repeat(64),
                health: 'unhealthy',
                http_status: 500
              }
            }
          }
        }
        // Rollback or activate
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          runtime: {
            state: 'step_succeeded',
            step: currentStep,
            remote_quiescent: true,
            boundary: boundaryR0
          }
        }
      }

      if (op === 'seal_runtime') {
        const candidateRuntime: H2RuntimeIdentity = {
          deployment_id: depId,
          image_tag: `my-express-app:v${depId}`,
          image_id: IMAGE_ID_B,
          source_sha: SHA_B,
          container_id: 'c'.repeat(64),
          collector_container_id: 'd'.repeat(64),
          collector_image_id: `sha256:${'e'.repeat(64)}`,
          config_sha256: 'f'.repeat(64),
          health: 'unhealthy',
          http_status: 500
        }
        const previousRuntime: H2RuntimeIdentity = {
          deployment_id: 1,
          image_tag: 'my-express-app:v1',
          image_id: `sha256:${'1'.repeat(64)}`,
          source_sha: SHA_A,
          container_id: '1'.repeat(64),
          collector_container_id: '2'.repeat(64),
          collector_image_id: `sha256:${'2'.repeat(64)}`,
          config_sha256: '3'.repeat(64),
          health: 'healthy',
          http_status: 200
        }
        const receipt: H2TerminalReceipt = {
          version: 1,
          context: configuredContext as never,
          outcome: 'rolled_back',
          failed_step: 'DEPLOY',
          active_runtime: previousRuntime,
          candidate_runtime: candidateRuntime,
          previous_runtime: previousRuntime,
          boundary: boundaryR0,
          exposure_status: 'not_checked',
          remote_quiescent: true,
          sealed_at: new Date(NOW).toISOString()
        }
        const receiptSha = hashH2(receipt)
        const signature = signH2('receipt', receipt, SECRET)
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          terminal: {
            receipt,
            receipt_sha256: receiptSha,
            signature
          }
        }
      }

      if (op === 'settle_runtime') {
        const attestation = req.attestation as { payload: Record<string, unknown> }
        const payload = {
          version: 1,
          kind: 'product-h2-settlement',
          commit_id: attestation.payload.commit_id,
          receipt_sha256: attestation.payload.receipt_sha256,
          context_sha256: attestation.payload.context_sha256,
          execution_nonce: attestation.payload.execution_nonce,
          attempt_id: attestation.payload.attempt_id,
          deployment_id: depId,
          settled_at: new Date(NOW).toISOString()
        }
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          settlement: {
            payload,
            signature: signH2('settlement', payload, SECRET)
          }
        }
      }

      return null
    })

    const sshManagerMock: SshManager = {
      openGuardedExecutionChannelWithIdentity: async () => ({
        channel: fakeChannel as unknown as ClientChannel,
        identity: {
          vpsId: 1,
          host: 'target.example.test',
          port: 2222,
          hostFingerprint: TARGET_PIN,
          username: 'deploy',
          authType: 'key' as const
        }
      })
    } as unknown as SshManager

    const result = await executeProductDeployPipeline(
      env.database,
      env.runtimeRepository,
      env.deployRepository,
      sshManagerMock,
      env.snapshot,
      {
        vps_id: 1,
        target_helper_path: '/usr/local/bin/helper',
        target_state_root: '/var/lib/opspilot'
      }
    )

    expect(result.state).toBe('rolled_back')
    if (result.state === 'rolled_back') {
      expect(result.failed_step).toBe('DEPLOY')
    }

    // Verify DB state
    const deployment = env.database
      .prepare('SELECT status, failed_step FROM deployment WHERE id=2')
      .get() as { status: string; failed_step: string }
    expect(deployment.status).toBe('rolled_back')
    expect(deployment.failed_step).toBe('DEPLOY')

    // Previous remains running and current!
    const previousDeployment = env.database
      .prepare('SELECT status FROM deployment WHERE id=1')
      .get() as { status: string }
    expect(previousDeployment.status).toBe('running')

    const app = env.database.prepare('SELECT current_deployment_id FROM app WHERE id=1').get() as {
      current_deployment_id: number
    }
    expect(app.current_deployment_id).toBe(1)
  })

  it('recovers settlement across crash/disconnect after T1 committed', async () => {
    const env = setupTestEnvironment({ withPrevious: true })

    // Insert an already committed terminal record in DB
    const boundaryB0: H2MetricBoundary = {
      generation: 'gen-v2',
      device: 10,
      inode: 20,
      next_offset: 100
    }
    const buildEvidence = {
      state: 'build_succeeded' as const,
      image_tag: 'my-express-app:v2',
      target_sha: SHA_B,
      image_id: IMAGE_ID_B
    }
    env.database.exec(`
      INSERT INTO deployment (id, app_id, version, image_tag, git_commit_sha, status, started_at)
        VALUES (2, 1, 2, 'my-express-app:v2', '${SHA_B}', 'building', '2026-10-27T11:00:00.000Z');
      UPDATE product_deploy_job SET state='deploying' WHERE job_id='job-pipeline-1';
      UPDATE product_deploy_attempt SET state='deploying', remote_outcome='unknown', deployment_id=2 WHERE attempt_id='attempt-pipeline-1';
    `)
    let context = env.runtimeRepository.createContext(env.claim, 2, buildEvidence)
    context = env.runtimeRepository.beginActivationBarrier(context)
    env.runtimeRepository.bindActivationBoundary(context, boundaryB0)

    const candidateRuntime: H2RuntimeIdentity = {
      deployment_id: 2,
      image_tag: 'my-express-app:v2',
      image_id: IMAGE_ID_B,
      source_sha: SHA_B,
      container_id: 'c'.repeat(64),
      collector_container_id: 'd'.repeat(64),
      collector_image_id: `sha256:${'e'.repeat(64)}`,
      config_sha256: 'f'.repeat(64),
      health: 'healthy',
      http_status: 200
    }
    const previousRuntime: H2RuntimeIdentity = {
      deployment_id: 1,
      image_tag: 'my-express-app:v1',
      image_id: `sha256:${'1'.repeat(64)}`,
      source_sha: SHA_A,
      container_id: '1'.repeat(64),
      collector_container_id: '2'.repeat(64),
      collector_image_id: `sha256:${'2'.repeat(64)}`,
      config_sha256: '3'.repeat(64),
      health: 'healthy',
      http_status: 200
    }
    const receipt: H2TerminalReceipt = {
      version: 1,
      context,
      outcome: 'succeeded',
      failed_step: null,
      active_runtime: candidateRuntime,
      candidate_runtime: candidateRuntime,
      previous_runtime: previousRuntime,
      boundary: boundaryB0,
      exposure_status: 'not_checked',
      remote_quiescent: true,
      sealed_at: new Date(NOW).toISOString()
    }
    const sealedReceipt = {
      receipt,
      receipt_sha256: hashH2(receipt),
      signature: signH2('receipt', receipt, SECRET)
    }

    // T1 finalize succeeds!
    env.runtimeRepository.finalize(sealedReceipt)

    // Now recovery session is invoked
    const fakeChannel = createFakeChannel((req) => {
      const op = req.operation as string
      const seq = req.sequence as number
      const depId = req.deployment_id as number

      if (op === 'open_recovery' || op === 'close') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'settle_runtime') {
        const attestation = req.attestation as { payload: Record<string, unknown> }
        const payload = {
          version: 1,
          kind: 'product-h2-settlement',
          commit_id: attestation.payload.commit_id,
          receipt_sha256: attestation.payload.receipt_sha256,
          context_sha256: attestation.payload.context_sha256,
          execution_nonce: attestation.payload.execution_nonce,
          attempt_id: attestation.payload.attempt_id,
          deployment_id: depId,
          settled_at: new Date(NOW).toISOString()
        }
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          settlement: {
            payload,
            signature: signH2('settlement', payload, SECRET)
          }
        }
      }

      return null
    })

    const sshManagerMock: SshManager = {
      openGuardedExecutionChannelWithIdentity: async () => ({
        channel: fakeChannel as unknown as ClientChannel,
        identity: {
          vpsId: 1,
          host: 'target.example.test',
          port: 2222,
          hostFingerprint: TARGET_PIN,
          username: 'deploy',
          authType: 'key' as const
        }
      })
    } as unknown as SshManager

    const recovered = await recoverProductRuntimeSession(
      env.runtimeRepository,
      sshManagerMock,
      env.snapshot,
      {
        vps_id: 1,
        target_helper_path: '/usr/local/bin/helper',
        target_state_root: '/var/lib/opspilot'
      }
    )

    expect(recovered.state).toBe('settled')
    expect(recovered.terminal.settled_at).toBeDefined()
    expect(recovered.terminal.leases_released_at).toBeDefined()

    // Calling recovery again is idempotent
    const secondRecovery = await recoverProductRuntimeSession(
      env.runtimeRepository,
      sshManagerMock,
      env.snapshot,
      {
        vps_id: 1,
        target_helper_path: '/usr/local/bin/helper',
        target_state_root: '/var/lib/opspilot'
      }
    )
    expect(secondRecovery.state).toBe('already_settled')
  })

  it('first deploy (no previous) health failure seals failed DEPLOY without rollback', async () => {
    const env = setupTestEnvironment({ withPrevious: false })
    const boundaryB0: H2MetricBoundary = {
      generation: 'gen-first',
      device: 10,
      inode: 20,
      next_offset: 50
    }
    let configuredContext: Record<string, unknown> | null = null
    let currentStep = ''

    const fakeChannel = createFakeChannel((req) => {
      const op = req.operation as string
      const seq = req.sequence as number
      const depId = req.deployment_id as number

      if (
        op === 'open' ||
        op === 'authorize_phase' ||
        op === 'begin_scope' ||
        op === 'begin_file' ||
        op === 'file_chunk' ||
        op === 'finish_file' ||
        op === 'complete_scope' ||
        op === 'start_build' ||
        op === 'close'
      ) {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'start_runtime_step') {
        currentStep = req.step as string
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'poll_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          build_state: 'succeeded',
          exit_code: 0,
          image_id: IMAGE_ID_B,
          image_tag: 'my-express-app:v1',
          labels: {
            'opspilot.app_id': '1',
            'opspilot.deployment_id': String(depId),
            'org.opencontainers.image.revision': SHA_B
          }
        }
      }

      if (op === 'runtime_configure') {
        configuredContext = req.context as Record<string, unknown>
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'poll_runtime') {
        if (currentStep === 'prepare') {
          return {
            version: 1,
            request_id: req.request_id,
            sequence: seq,
            state: 'accepted',
            deployment_id: depId,
            runtime: {
              state: 'step_succeeded',
              step: 'prepare',
              remote_quiescent: true,
              boundary: boundaryB0
            }
          }
        }
        if (currentStep === 'health') {
          return {
            version: 1,
            request_id: req.request_id,
            sequence: seq,
            state: 'accepted',
            deployment_id: depId,
            runtime: {
              state: 'step_failed',
              step: 'health',
              remote_quiescent: true,
              candidate: {
                deployment_id: depId,
                image_tag: 'my-express-app:v1',
                image_id: IMAGE_ID_B,
                source_sha: SHA_B,
                container_id: 'c'.repeat(64),
                collector_container_id: 'd'.repeat(64),
                collector_image_id: `sha256:${'e'.repeat(64)}`,
                config_sha256: 'f'.repeat(64),
                health: 'unhealthy',
                http_status: 500
              }
            }
          }
        }
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          runtime: {
            state: 'step_succeeded',
            step: currentStep,
            remote_quiescent: true
          }
        }
      }

      if (op === 'seal_runtime') {
        const candidateRuntime: H2RuntimeIdentity = {
          deployment_id: depId,
          image_tag: 'my-express-app:v1',
          image_id: IMAGE_ID_B,
          source_sha: SHA_B,
          container_id: 'c'.repeat(64),
          collector_container_id: 'd'.repeat(64),
          collector_image_id: `sha256:${'e'.repeat(64)}`,
          config_sha256: 'f'.repeat(64),
          health: 'unhealthy',
          http_status: 500
        }
        const receipt: H2TerminalReceipt = {
          version: 1,
          context: configuredContext as never,
          outcome: 'failed',
          failed_step: 'DEPLOY',
          active_runtime: null,
          candidate_runtime: candidateRuntime,
          previous_runtime: null,
          boundary: boundaryB0,
          exposure_status: 'not_checked',
          remote_quiescent: true,
          sealed_at: new Date(NOW).toISOString()
        }
        const receiptSha = hashH2(receipt)
        const signature = signH2('receipt', receipt, SECRET)
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          terminal: {
            receipt,
            receipt_sha256: receiptSha,
            signature
          }
        }
      }

      if (op === 'settle_runtime') {
        const attestation = req.attestation as { payload: Record<string, unknown> }
        const payload = {
          version: 1,
          kind: 'product-h2-settlement',
          commit_id: attestation.payload.commit_id,
          receipt_sha256: attestation.payload.receipt_sha256,
          context_sha256: attestation.payload.context_sha256,
          execution_nonce: attestation.payload.execution_nonce,
          attempt_id: attestation.payload.attempt_id,
          deployment_id: depId,
          settled_at: new Date(NOW).toISOString()
        }
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          settlement: {
            payload,
            signature: signH2('settlement', payload, SECRET)
          }
        }
      }

      return null
    })

    const sshManagerMock: SshManager = {
      openGuardedExecutionChannelWithIdentity: async () => ({
        channel: fakeChannel as unknown as ClientChannel,
        identity: {
          vpsId: 1,
          host: 'target.example.test',
          port: 2222,
          hostFingerprint: TARGET_PIN,
          username: 'deploy',
          authType: 'key' as const
        }
      })
    } as unknown as SshManager

    const result = await executeProductDeployPipeline(
      env.database,
      env.runtimeRepository,
      env.deployRepository,
      sshManagerMock,
      env.snapshot,
      {
        vps_id: 1,
        target_helper_path: '/usr/local/bin/helper',
        target_state_root: '/var/lib/opspilot'
      }
    )

    expect(result.state).toBe('failed')
    if (result.state === 'failed') {
      expect(result.failed_step).toBe('DEPLOY')
    }

    const deployment = env.database
      .prepare('SELECT status, failed_step FROM deployment WHERE id=1')
      .get() as { status: string; failed_step: string }
    expect(deployment.status).toBe('failed')
    expect(deployment.failed_step).toBe('DEPLOY')
  })

  it('fails closed when target rejects runtime step', async () => {
    const env = setupTestEnvironment({ withPrevious: true })

    const fakeChannel = createFakeChannel((req) => {
      const op = req.operation as string
      const seq = req.sequence as number
      const depId = req.deployment_id as number

      if (
        op === 'open' ||
        op === 'authorize_phase' ||
        op === 'begin_scope' ||
        op === 'begin_file' ||
        op === 'file_chunk' ||
        op === 'finish_file' ||
        op === 'complete_scope' ||
        op === 'start_build'
      ) {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'poll_build') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId,
          build_state: 'succeeded',
          exit_code: 0,
          image_id: IMAGE_ID_B,
          image_tag: 'my-express-app:v2',
          labels: {
            'opspilot.app_id': '1',
            'opspilot.deployment_id': String(depId),
            'org.opencontainers.image.revision': SHA_B
          }
        }
      }

      if (op === 'runtime_configure') {
        // Target rejects with SSH_RUNTIME_REJECTED
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'rejected',
          error_code: 'SSH_RUNTIME_REJECTED',
          deployment_id: depId
        }
      }

      return null
    })

    const sshManagerMock: SshManager = {
      openGuardedExecutionChannelWithIdentity: async () => ({
        channel: fakeChannel as unknown as ClientChannel,
        identity: {
          vpsId: 1,
          host: 'target.example.test',
          port: 2222,
          hostFingerprint: TARGET_PIN,
          username: 'deploy',
          authType: 'key' as const
        }
      })
    } as unknown as SshManager

    await expect(
      executeProductDeployPipeline(
        env.database,
        env.runtimeRepository,
        env.deployRepository,
        sshManagerMock,
        env.snapshot,
        {
          vps_id: 1,
          target_helper_path: '/usr/local/bin/helper',
          target_state_root: '/var/lib/opspilot'
        }
      )
    ).rejects.toMatchObject({
      code: 'SSH_RUNTIME_REJECTED'
    })
  })

  it('fails closed when abort signal triggers during execution', async () => {
    const env = setupTestEnvironment({ withPrevious: true })
    const controller = new AbortController()

    const fakeChannel = createFakeChannel((req) => {
      const op = req.operation as string
      const seq = req.sequence as number
      const depId = req.deployment_id as number

      if (op === 'open' || op === 'authorize_phase') {
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      if (op === 'begin_scope') {
        // Abort right here!
        controller.abort()
        return {
          version: 1,
          request_id: req.request_id,
          sequence: seq,
          state: 'accepted',
          deployment_id: depId
        }
      }

      return null
    })

    const sshManagerMock: SshManager = {
      openGuardedExecutionChannelWithIdentity: async () => ({
        channel: fakeChannel as unknown as ClientChannel,
        identity: {
          vpsId: 1,
          host: 'target.example.test',
          port: 2222,
          hostFingerprint: TARGET_PIN,
          username: 'deploy',
          authType: 'key' as const
        }
      })
    } as unknown as SshManager

    await expect(
      executeProductDeployPipeline(
        env.database,
        env.runtimeRepository,
        env.deployRepository,
        sshManagerMock,
        env.snapshot,
        {
          vps_id: 1,
          target_helper_path: '/usr/local/bin/helper',
          target_state_root: '/var/lib/opspilot',
          signal: controller.signal
        }
      )
    ).rejects.toMatchObject({
      code: 'SSH_SESSION_ABORTED'
    })
  })
})
