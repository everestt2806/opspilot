import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import type {
  H2BuildEvidence,
  H2Context,
  H2MetricBoundary,
  H2RuntimeIdentity,
  H2SealedReceipt,
  H2SettlementAck,
  H2TerminalReceipt
} from '../../../../docs/contracts/product-h2-runtime'
import { hashH2, signH2 } from '../controlPlane/productH2Proof'
import { closeDatabase, initializeDatabase } from './index'
import { ProductRuntimeRepository, ProductRuntimeRepositoryError } from './productRuntimeRepository'

const SECRET = Buffer.alloc(32, 0x42)
const CONTROLLER = 'h2-controller'
const TARGET_PIN = `SHA256:${'A'.repeat(43)}`
const SHA_A = '1'.repeat(40)
const SHA_B = '2'.repeat(40)
const HASH = 'a'.repeat(64)
const NOW = Date.parse('2026-10-27T12:00:00.000Z')

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

interface Harness {
  database: ReturnType<typeof initializeDatabase>
  repository: ProductRuntimeRepository
  clock: { value: number; advance: (ms: number) => void }
  claim: ProductClaimToken
  buildEvidence: H2BuildEvidence
  deploymentId: number
}

function setupHarness(
  options: {
    withPrevious?: boolean
    deploymentStatus?: string
    buildState?: 'build_succeeded' | 'build_failed_definite'
    framework?: string
    needsDb?: number
  } = {}
): Harness {
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-product-runtime-'))
  const database = initializeDatabase(testDirectory)
  const clock = {
    value: NOW,
    advance(ms: number) {
      this.value += ms
    }
  }

  database.exec(`
    INSERT INTO vps (id, name, host, port, host_fingerprint, username, auth_type, encrypted_secret, ssh_security_revision)
      VALUES (1, 'vps-1', 'target.example.test', 2222, '${TARGET_PIN}', 'deploy', 'key', X'00', 1);
    INSERT INTO app (id, vps_id, name, framework, host_port, container_port, healthcheck_path, source_type, git_repo_url, git_ref, git_root, current_deployment_id)
      VALUES (1, 1, 'my-express-app', '${options.framework ?? 'express'}', 30001, 3000, '/healthz', 'git', 'https://example.test/repo.git', 'main', '.', ${options.withPrevious ? 1 : 'NULL'});
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
  database
    .prepare(
      `
    INSERT INTO deployment (id, app_id, version, image_tag, git_commit_sha, status, started_at)
      VALUES (?, 1, ?, 'my-express-app:v2', '${SHA_B}', ?, '2026-10-27T11:00:00.000Z')
  `
    )
    .run(deploymentId, deploymentId, options.deploymentStatus ?? 'building')

  const claim: ProductClaimToken = {
    job_id: 'job-100',
    controller_id: CONTROLLER,
    ownership_generation: 1,
    app_id: 1,
    source_generation: 1,
    source_config_sha256: HASH,
    app_lease_id: 'lease-app-1',
    app_fence: 1,
    build_slot_lease_id: 'lease-slot-1',
    build_slot_fence: 1,
    attempt_id: 'attempt-100-1',
    attempt_number: 1,
    expires_at: new Date(NOW + 60_000).toISOString()
  }

  database.exec(`
    INSERT INTO product_deploy_job
      (job_id, controller_id, app_id, ownership_generation, source_generation, source_config_sha256,
       trigger, idempotency_key, ref, target_sha, observation_sequence, reconcile_epoch, state,
       attempt_count, max_attempts, available_at, created_at, updated_at)
      VALUES ('job-100', '${CONTROLLER}', 1, 1, 1, '${HASH}',
       'manual_redeploy', 'manual:job-100', 'main', '${SHA_B}', NULL, NULL, 'deploying',
       1, 3, '2026-10-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z');

    INSERT INTO product_app_fence (app_id, last_fence) VALUES (1, 1);

    INSERT INTO product_app_lease
      (app_id, lease_id, controller_id, ownership_generation, fence, job_id, expires_at, acquired_at, heartbeat_at)
      VALUES (1, 'lease-app-1', '${CONTROLLER}', 1, 1, 'job-100', '${new Date(NOW + 60_000).toISOString()}', '2026-10-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z');

    INSERT INTO product_worker_lease
      (slot_name, lease_id, controller_id, fence, job_id, expires_at, acquired_at, heartbeat_at)
      VALUES ('build', 'lease-slot-1', '${CONTROLLER}', 1, 'job-100', '${new Date(NOW + 60_000).toISOString()}', '2026-10-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z');

    INSERT INTO product_deploy_attempt
      (attempt_id, job_id, deployment_id, attempt_number, lease_id, fencing_token,
       build_slot_lease_id, build_slot_fence, state, remote_outcome, started_at)
      VALUES ('attempt-100-1', 'job-100', ${deploymentId}, 1, 'lease-app-1', 1,
       'lease-slot-1', 1, 'deploying', 'unknown', '2026-10-27T11:00:00.000Z');
  `)

  const buildEvidence: H2BuildEvidence =
    options.buildState === 'build_failed_definite'
      ? {
          state: 'build_failed_definite',
          target_sha: SHA_B,
          image_tag: 'my-express-app:v2',
          exit_code: 1
        }
      : {
          state: 'build_succeeded',
          target_sha: SHA_B,
          image_tag: 'my-express-app:v2',
          image_id: `sha256:${'c'.repeat(64)}`
        }

  const repository = new ProductRuntimeRepository(database, {
    secret: SECRET,
    clock: () => clock.value
  })

  return { database, repository, clock, claim, buildEvidence, deploymentId }
}

describe('ProductRuntimeRepository C0 Barrier & Lifecycle', () => {
  it('throws H2_SECRET_INVALID if secret is not 32-byte buffer', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-runtime-secret-'))
    const db = initializeDatabase(testDirectory)
    expect(() => new ProductRuntimeRepository(db, { secret: Buffer.alloc(16) })).toThrow(
      ProductRuntimeRepositoryError
    )
    expect(
      () => new ProductRuntimeRepository(db, { secret: 'not-a-buffer' as unknown as Buffer })
    ).toThrow(ProductRuntimeRepositoryError)
  })

  describe('createContext', () => {
    it('creates H2Context successfully for initial deployment', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness()
      const context = repository.createContext(claim, deploymentId, buildEvidence)

      expect(context.version).toBe(1)
      expect(context.deployment_id).toBe(deploymentId)
      expect(context.app_name).toBe('my-express-app')
      expect(context.build_state).toBe('build_succeeded')
      expect(context.candidate_image_tag).toBe('my-express-app:v2')
      expect(context.candidate_image_id).toBe(buildEvidence.image_id)
      expect(context.previous).toBeNull()
      expect(context.activation_id).toBeNull()

      const row = database
        .prepare('SELECT * FROM product_runtime_execution WHERE attempt_id=?')
        .get(claim.attempt_id)
      expect(row).toBeDefined()
    })

    it('creates H2Context with previous runtime info when previous deployment exists', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      const context = repository.createContext(claim, deploymentId, buildEvidence)

      expect(context.previous).toEqual({
        deployment_id: 1,
        image_tag: 'my-express-app:v1',
        source_sha: SHA_A
      })
    })

    it('is idempotent on duplicate call with matching claim and build evidence', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness()
      const first = repository.createContext(claim, deploymentId, buildEvidence)
      const second = repository.createContext(claim, deploymentId, buildEvidence)

      expect(second).toEqual(first)
    })

    it('fails with H2_CONTEXT_MISMATCH on duplicate call with conflicting build evidence', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness()
      repository.createContext(claim, deploymentId, buildEvidence)

      const conflictingBuild: H2BuildEvidence = {
        ...buildEvidence,
        image_id: `sha256:${'f'.repeat(64)}`
      }
      expect(() => repository.createContext(claim, deploymentId, conflictingBuild)).toThrowError(
        new ProductRuntimeRepositoryError('H2_CONTEXT_MISMATCH')
      )
    })

    it('fails with H2_BUILD_INVALID if framework is not express', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        framework: 'nextjs'
      })
      expect(() => repository.createContext(claim, deploymentId, buildEvidence)).toThrowError(
        new ProductRuntimeRepositoryError('H2_BUILD_INVALID')
      )
    })

    it('fails with H2_BUILD_INVALID if deployment status is not building', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        deploymentStatus: 'deploying'
      })
      expect(() => repository.createContext(claim, deploymentId, buildEvidence)).toThrowError(
        new ProductRuntimeRepositoryError('H2_BUILD_INVALID')
      )
    })

    it('fails with H2_ACTIVATION_MISMATCH if active activation does not match app current_deployment_id', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      database
        .prepare(
          `INSERT INTO deployment (id, app_id, version, image_tag, git_commit_sha, status, started_at)
         VALUES (3, 1, 3, 'my-express-app:v0', '${SHA_A}', 'stopped', '2026-10-27T09:00:00.000Z')`
        )
        .run()
      database.prepare('UPDATE deployment_activation SET deployment_id=3 WHERE id=10').run()

      expect(() => repository.createContext(claim, deploymentId, buildEvidence)).toThrowError(
        new ProductRuntimeRepositoryError('H2_ACTIVATION_MISMATCH')
      )
    })

    it('fails with H2_AUTHORITY_STALE if lease is expired', () => {
      const { repository, claim, buildEvidence, deploymentId, clock } = setupHarness()
      clock.advance(100_000)

      expect(() => repository.createContext(claim, deploymentId, buildEvidence)).toThrowError(
        new ProductRuntimeRepositoryError('H2_AUTHORITY_STALE')
      )
    })
  })

  describe('beginActivationBarrier (C0)', () => {
    it('creates prepared activation, updates execution context, and transitions deployment to deploying', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      const initialContext = repository.createContext(claim, deploymentId, buildEvidence)

      const updatedContext = repository.beginActivationBarrier(initialContext)

      expect(updatedContext.activation_id).not.toBeNull()
      expect(typeof updatedContext.activation_id).toBe('number')

      const activation = database
        .prepare('SELECT * FROM deployment_activation WHERE id=?')
        .get(updatedContext.activation_id) as Record<string, unknown>
      expect(activation).toBeDefined()
      expect(activation.app_id).toBe(1)
      expect(activation.deployment_id).toBe(deploymentId)
      expect(activation.state).toBe('prepared')
      expect(activation.stream_generation).toBe(`h2-pending:${claim.attempt_id}`)
      expect(activation.start_offset).toBe(1)

      const deployment = database
        .prepare('SELECT status FROM deployment WHERE id=?')
        .get(deploymentId) as { status: string }
      expect(deployment.status).toBe('deploying')

      const history = database
        .prepare("SELECT * FROM product_history_event WHERE kind='runtime_activation_prepared'")
        .get()
      expect(history).toBeDefined()
    })

    it('is idempotent when called repeatedly with prepared context', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness()
      const initialContext = repository.createContext(claim, deploymentId, buildEvidence)
      const preparedContext = repository.beginActivationBarrier(initialContext)
      const secondCall = repository.beginActivationBarrier(preparedContext)

      expect(secondCall).toEqual(preparedContext)
      const count = database
        .prepare("SELECT COUNT(*) n FROM deployment_activation WHERE state='prepared'")
        .get() as { n: number }
      expect(count.n).toBe(1)
    })

    it('fails with H2_BARRIER_NOT_REQUIRED if build did not succeed', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        buildState: 'build_failed_definite'
      })
      const context = repository.createContext(claim, deploymentId, buildEvidence)

      expect(() => repository.beginActivationBarrier(context)).toThrowError(
        new ProductRuntimeRepositoryError('H2_BARRIER_NOT_REQUIRED')
      )
    })

    it('fails with H2_ACTIVATION_BUSY if an activation is already prepared for the app', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness()
      const context = repository.createContext(claim, deploymentId, buildEvidence)

      database
        .prepare(
          "INSERT INTO deployment_activation (app_id, deployment_id, stream_generation, start_offset, reason, state) VALUES (1, 1, 'other-pending', 1, 'deploy', 'prepared')"
        )
        .run()

      expect(() => repository.beginActivationBarrier(context)).toThrowError(
        new ProductRuntimeRepositoryError('H2_ACTIVATION_BUSY')
      )
    })

    it('rolls back completely if deployment status CAS fails', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness()
      const context = repository.createContext(claim, deploymentId, buildEvidence)

      // Chuyển status của deployment sang khác 'building'
      database.prepare("UPDATE deployment SET status='failed' WHERE id=?").run(deploymentId)

      expect(() => repository.beginActivationBarrier(context)).toThrowError(
        new ProductRuntimeRepositoryError('H2_CAS_FAILED')
      )

      // Không có dòng activation nào được lưu lại
      const activations = database
        .prepare('SELECT COUNT(*) n FROM deployment_activation')
        .get() as { n: number }
      expect(activations.n).toBe(0)
    })
  })

  describe('bindActivationBoundary (B0)', () => {
    it('binds metric boundary to prepared activation and execution', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness()
      const initialContext = repository.createContext(claim, deploymentId, buildEvidence)
      const preparedContext = repository.beginActivationBarrier(initialContext)

      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }

      repository.bindActivationBoundary(preparedContext, boundary)

      const activation = database
        .prepare('SELECT stream_generation, start_offset FROM deployment_activation WHERE id=?')
        .get(preparedContext.activation_id) as { stream_generation: string; start_offset: number }
      expect(activation.stream_generation).toBe('stream-gen-1')
      expect(activation.start_offset).toBe(501)

      const execution = database
        .prepare('SELECT boundary_json FROM product_runtime_execution WHERE attempt_id=?')
        .get(claim.attempt_id) as { boundary_json: string }
      expect(JSON.parse(execution.boundary_json)).toEqual(boundary)
    })

    it('is idempotent when re-binding the identical boundary', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness()
      const prepared = repository.beginActivationBarrier(
        repository.createContext(claim, deploymentId, buildEvidence)
      )
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }

      repository.bindActivationBoundary(prepared, boundary)
      expect(() => repository.bindActivationBoundary(prepared, boundary)).not.toThrow()
    })

    it('fails with H2_BOUNDARY_MISMATCH on re-binding a conflicting boundary', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness()
      const prepared = repository.beginActivationBarrier(
        repository.createContext(claim, deploymentId, buildEvidence)
      )
      const boundary1: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      const boundary2: H2MetricBoundary = {
        generation: 'stream-gen-2',
        device: 100,
        inode: 200,
        next_offset: 601
      }

      repository.bindActivationBoundary(prepared, boundary1)
      expect(() => repository.bindActivationBoundary(prepared, boundary2)).toThrowError(
        new ProductRuntimeRepositoryError('H2_BOUNDARY_MISMATCH')
      )
    })

    it('fails with H2_BARRIER_MISSING if activation_id is null', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness()
      const initialContext = repository.createContext(claim, deploymentId, buildEvidence)
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }

      expect(() => repository.bindActivationBoundary(initialContext, boundary)).toThrowError(
        new ProductRuntimeRepositoryError('H2_BARRIER_MISSING')
      )
    })
  })

  describe('readSettlementAuthority (H2-DB-002 post-T1 authority audit)', () => {
    it('returns rejected when no terminal record exists for context', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness()
      const context = repository.createContext(claim, deploymentId, buildEvidence)
      expect(repository.readSettlementAuthority(context)).toBe('rejected')
    })

    it('returns ready when terminal record is committed and authority matches', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      repository.finalize(sealedReceipt)

      expect(repository.readSettlementAuthority(context)).toBe('ready')
    })

    it('returns rejected if controller is not active', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      repository.finalize(sealedReceipt)

      database
        .prepare("UPDATE product_controller SET status='revoked' WHERE controller_id=?")
        .run(CONTROLLER)
      expect(repository.readSettlementAuthority(context)).toBe('rejected')
    })

    it('returns rejected if canonical app fields drift after T1', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      repository.finalize(sealedReceipt)

      database.prepare("UPDATE app SET name='renamed-app' WHERE id=1").run()
      expect(repository.readSettlementAuthority(context)).toBe('rejected')

      database.prepare("UPDATE app SET name='my-express-app', host_port=39999 WHERE id=1").run()
      expect(repository.readSettlementAuthority(context)).toBe('rejected')
    })

    it('returns rejected if deployment fields drift after T1', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      repository.finalize(sealedReceipt)

      database.prepare("UPDATE deployment SET status='failed' WHERE id=?").run(deploymentId)
      expect(repository.readSettlementAuthority(context)).toBe('rejected')

      database
        .prepare("UPDATE deployment SET status='running', image_tag='tampered:tag' WHERE id=?")
        .run(deploymentId)
      expect(repository.readSettlementAuthority(context)).toBe('rejected')
    })
  })

  describe('finalize (T1 terminal commit)', () => {
    it('commits succeeded terminal record and updates deployment, activation, app, attempt, and job', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      const terminalRecord = repository.finalize(sealedReceipt)

      expect(terminalRecord.commit_id).toBeDefined()
      expect(terminalRecord.envelope).toEqual(sealedReceipt)

      // Deployment updated to running
      const deployment = database
        .prepare('SELECT status, finished_at FROM deployment WHERE id=?')
        .get(deploymentId) as { status: string; finished_at: string }
      expect(deployment.status).toBe('running')
      expect(deployment.finished_at).not.toBeNull()

      // Previous deployment stopped
      const prevDeployment = database.prepare('SELECT status FROM deployment WHERE id=1').get() as {
        status: string
      }
      expect(prevDeployment.status).toBe('stopped')

      // App current_deployment_id updated to 2
      const app = database.prepare('SELECT current_deployment_id FROM app WHERE id=1').get() as {
        current_deployment_id: number
      }
      expect(app.current_deployment_id).toBe(deploymentId)

      // Previous activation closed at next_offset
      const prevActivation = database
        .prepare('SELECT state, end_offset FROM deployment_activation WHERE id=10')
        .get() as { state: string; end_offset: number }
      expect(prevActivation.state).toBe('closed')
      expect(prevActivation.end_offset).toBe(501)

      // Candidate activation active
      const candActivation = database
        .prepare('SELECT state FROM deployment_activation WHERE id=?')
        .get(context.activation_id) as { state: string }
      expect(candActivation.state).toBe('active')

      // Attempt and job succeeded
      const attempt = database
        .prepare('SELECT state, remote_outcome FROM product_deploy_attempt WHERE attempt_id=?')
        .get(claim.attempt_id) as { state: string; remote_outcome: string }
      expect(attempt.state).toBe('succeeded')
      expect(attempt.remote_outcome).toBe('applied')

      const job = database
        .prepare('SELECT state FROM product_deploy_job WHERE job_id=?')
        .get(claim.job_id) as { state: string }
      expect(job.state).toBe('succeeded')

      // Terminal row stored
      const terminal = database
        .prepare('SELECT * FROM product_runtime_terminal WHERE attempt_id=?')
        .get(claim.attempt_id) as Record<string, unknown>
      expect(terminal).toBeDefined()
    })

    it('commits rolled_back terminal record, restores previous deployment and creates restored activation', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      const boundaryB0: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      const boundaryR0: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 750
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundaryB0)

      const sealedReceipt = createValidReceipt(context, {
        outcome: 'rolled_back',
        failedStep: 'DEPLOY',
        boundary: boundaryR0
      })
      const terminalRecord = repository.finalize(sealedReceipt)

      expect(terminalRecord.commit_id).toBeDefined()

      // Deployment updated to rolled_back
      const deployment = database
        .prepare('SELECT status, failed_step FROM deployment WHERE id=?')
        .get(deploymentId) as { status: string; failed_step: string }
      expect(deployment.status).toBe('rolled_back')
      expect(deployment.failed_step).toBe('DEPLOY')

      // Previous deployment remains running and current
      const prevDeployment = database.prepare('SELECT status FROM deployment WHERE id=1').get() as {
        status: string
      }
      expect(prevDeployment.status).toBe('running')

      const app = database.prepare('SELECT current_deployment_id FROM app WHERE id=1').get() as {
        current_deployment_id: number
      }
      expect(app.current_deployment_id).toBe(1)

      // Prepared activation aborted
      const candActivation = database
        .prepare('SELECT state FROM deployment_activation WHERE id=?')
        .get(context.activation_id) as { state: string }
      expect(candActivation.state).toBe('aborted')

      // Restored activation created for previous deployment at R0 boundary
      const restored = database
        .prepare("SELECT * FROM deployment_activation WHERE deployment_id=1 AND state='active'")
        .get() as { stream_generation: string; start_offset: number }
      expect(restored.stream_generation).toBe('stream-gen-1')
      expect(restored.start_offset).toBe(750)
    })

    it('rejects with H2_SIGNATURE_INVALID if signature is forged', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const forged = createValidReceipt(context, { boundary, wrongSignature: true })
      expect(() => repository.finalize(forged)).toThrowError(
        new ProductRuntimeRepositoryError('H2_RECEIPT_INVALID')
      )
    })

    it('rejects with H2_RECEIPT_STALE if sealed_at is past lease TTL', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      // Sealed 10 minutes ago
      const staleSealedAt = new Date(NOW - 600_000).toISOString()
      const staleReceipt = createValidReceipt(context, { boundary, sealedAt: staleSealedAt })

      expect(() => repository.finalize(staleReceipt)).toThrowError(
        new ProductRuntimeRepositoryError('H2_RECEIPT_STALE')
      )
    })

    it('is idempotent on duplicate call with identical receipt', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      const first = repository.finalize(sealedReceipt)
      const second = repository.finalize(sealedReceipt)

      expect(second).toEqual(first)
    })

    it('fails with H2_TERMINAL_CONFLICT on duplicate call with conflicting receipt', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const receipt1 = createValidReceipt(context, {
        boundary,
        sealedAt: new Date(NOW).toISOString()
      })
      const receipt2 = createValidReceipt(context, {
        boundary,
        sealedAt: new Date(NOW + 1000).toISOString()
      })

      repository.finalize(receipt1)
      expect(() => repository.finalize(receipt2)).toThrowError(
        new ProductRuntimeRepositoryError('H2_TERMINAL_CONFLICT')
      )
    })

    it('rolls back entire transaction atomically if deployment CAS fails', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })

      // Concurrently alter deployment status so CAS fails
      database.prepare("UPDATE deployment SET status='failed' WHERE id=?").run(deploymentId)

      expect(() => repository.finalize(sealedReceipt)).toThrowError(
        new ProductRuntimeRepositoryError('H2_CAS_FAILED')
      )

      // Verify no terminal row was committed
      const terminal = database
        .prepare('SELECT COUNT(*) n FROM product_runtime_terminal WHERE attempt_id=?')
        .get(claim.attempt_id) as { n: number }
      expect(terminal.n).toBe(0)
    })
  })

  describe('commitAttestation (Signer)', () => {
    it('emits valid signed commit attestation for committed terminal row', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      repository.finalize(sealedReceipt)

      const attestation = repository.commitAttestation(claim.attempt_id)
      expect(attestation.payload.kind).toBe('product-h2-commit')
      expect(attestation.payload.attempt_id).toBe(claim.attempt_id)
      expect(attestation.payload.deployment_id).toBe(deploymentId)
      expect(attestation.payload.outcome).toBe('succeeded')
      expect(attestation.signature).toBeDefined()
    })

    it('fails with H2_TERMINAL_MISSING if attempt was not finalized', () => {
      const { repository, claim } = setupHarness()
      expect(() => repository.commitAttestation(claim.attempt_id)).toThrowError(
        new ProductRuntimeRepositoryError('H2_TERMINAL_MISSING')
      )
    })

    it('fails with H2_UNCOMMITTED_TRANSACTION if called inside an uncommitted transaction', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      repository.finalize(sealedReceipt)

      database.transaction(() => {
        expect(() => repository.commitAttestation(claim.attempt_id)).toThrowError(
          new ProductRuntimeRepositoryError('H2_UNCOMMITTED_TRANSACTION')
        )
      })()
    })
  })

  describe('completeSettlement (T2 lease release)', () => {
    it('releases exact committed leases and records settlement on terminal row', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      const terminalRecord = repository.finalize(sealedReceipt)
      const attestation = repository.commitAttestation(claim.attempt_id)

      const settlementPayload = {
        version: 1 as const,
        kind: 'product-h2-settlement' as const,
        commit_id: terminalRecord.commit_id,
        receipt_sha256: attestation.payload.receipt_sha256,
        context_sha256: attestation.payload.context_sha256,
        execution_nonce: attestation.payload.execution_nonce,
        attempt_id: claim.attempt_id,
        deployment_id: deploymentId,
        settled_at: new Date(NOW).toISOString()
      }
      const settlementAck: H2SettlementAck = {
        payload: settlementPayload,
        signature: signH2('settlement', settlementPayload, SECRET)
      }

      repository.completeSettlement(context, settlementAck)

      // Leases released
      const appLease = database
        .prepare('SELECT released_at FROM product_app_lease WHERE lease_id=?')
        .get(claim.app_lease_id) as { released_at: string | null }
      expect(appLease.released_at).not.toBeNull()

      const workerLease = database
        .prepare('SELECT released_at FROM product_worker_lease WHERE lease_id=?')
        .get(claim.build_slot_lease_id) as { released_at: string | null }
      expect(workerLease.released_at).not.toBeNull()

      // Terminal row updated
      const updatedTerminal = repository.getTerminal(claim.attempt_id)!
      expect(updatedTerminal.settled_at).toBe(settlementPayload.settled_at)
      expect(updatedTerminal.leases_released_at).not.toBeNull()

      // Idempotent re-run
      expect(() => repository.completeSettlement(context, settlementAck)).not.toThrow()
    })

    it('fails with H2_ACK_INVALID if ACK signature is invalid', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      const terminalRecord = repository.finalize(sealedReceipt)
      const attestation = repository.commitAttestation(claim.attempt_id)

      const settlementPayload = {
        version: 1 as const,
        kind: 'product-h2-settlement' as const,
        commit_id: terminalRecord.commit_id,
        receipt_sha256: attestation.payload.receipt_sha256,
        context_sha256: attestation.payload.context_sha256,
        execution_nonce: attestation.payload.execution_nonce,
        attempt_id: claim.attempt_id,
        deployment_id: deploymentId,
        settled_at: new Date(NOW).toISOString()
      }
      const invalidAck: H2SettlementAck = {
        payload: settlementPayload,
        signature: '0'.repeat(64)
      }

      expect(() => repository.completeSettlement(context, invalidAck)).toThrowError(
        new ProductRuntimeRepositoryError('H2_ACK_INVALID')
      )
    })

    it('does not release newer or unrelated leases during settlement', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      database.exec(`
        INSERT INTO app (id, vps_id, name, framework, host_port, container_port, healthcheck_path, source_type, git_repo_url, git_ref, git_root, current_deployment_id)
          VALUES (2, 1, 'other-app', 'express', 30002, 3000, '/healthz', 'git', 'https://example.test/repo.git', 'main', '.', NULL);
        INSERT INTO product_source_config VALUES
          (2, 1, 'https://example.test/repo.git', 'main', '.', '{}', '${HASH}', '2026-10-27T10:00:00.000Z');
        INSERT INTO product_app_fence (app_id, last_fence) VALUES (2, 1);
        INSERT INTO product_deploy_job
          (job_id, controller_id, app_id, ownership_generation, source_generation, source_config_sha256,
           trigger, idempotency_key, ref, target_sha, observation_sequence, reconcile_epoch, state,
           attempt_count, max_attempts, available_at, created_at, updated_at)
          VALUES ('job-other', '${CONTROLLER}', 2, 1, 1, '${HASH}',
           'manual_redeploy', 'manual:job-other', 'main', '${SHA_B}', NULL, NULL, 'deploying',
           1, 3, '2026-10-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z');
        INSERT INTO product_app_lease
          (app_id, lease_id, controller_id, ownership_generation, fence, job_id, expires_at, acquired_at, heartbeat_at)
          VALUES (2, 'lease-app-unrelated', '${CONTROLLER}', 1, 1, 'job-other', '${new Date(NOW + 120_000).toISOString()}', '2026-10-27T12:00:00.000Z', '2026-10-27T12:00:00.000Z');
      `)
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      const terminalRecord = repository.finalize(sealedReceipt)
      const attestation = repository.commitAttestation(claim.attempt_id)

      const settlementPayload = {
        version: 1 as const,
        kind: 'product-h2-settlement' as const,
        commit_id: terminalRecord.commit_id,
        receipt_sha256: attestation.payload.receipt_sha256,
        context_sha256: attestation.payload.context_sha256,
        execution_nonce: attestation.payload.execution_nonce,
        attempt_id: claim.attempt_id,
        deployment_id: deploymentId,
        settled_at: new Date(NOW).toISOString()
      }
      const settlementAck: H2SettlementAck = {
        payload: settlementPayload,
        signature: signH2('settlement', settlementPayload, SECRET)
      }

      repository.completeSettlement(context, settlementAck)

      // Committed leases released
      const appLease = database
        .prepare('SELECT released_at FROM product_app_lease WHERE lease_id=?')
        .get(claim.app_lease_id) as { released_at: string | null }
      expect(appLease.released_at).not.toBeNull()

      // Unrelated lease on app 2 remains unreleased
      const unrelatedApp = database
        .prepare('SELECT released_at FROM product_app_lease WHERE lease_id=?')
        .get('lease-app-unrelated') as { released_at: string | null }
      expect(unrelatedApp.released_at).toBeNull()
    })

    it('rejects with H2_ACK_MISMATCH if replayed with conflicting settlement ACK', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      const terminalRecord = repository.finalize(sealedReceipt)
      const attestation = repository.commitAttestation(claim.attempt_id)

      const settlementPayload = {
        version: 1 as const,
        kind: 'product-h2-settlement' as const,
        commit_id: terminalRecord.commit_id,
        receipt_sha256: attestation.payload.receipt_sha256,
        context_sha256: attestation.payload.context_sha256,
        execution_nonce: attestation.payload.execution_nonce,
        attempt_id: claim.attempt_id,
        deployment_id: deploymentId,
        settled_at: new Date(NOW).toISOString()
      }
      const settlementAck: H2SettlementAck = {
        payload: settlementPayload,
        signature: signH2('settlement', settlementPayload, SECRET)
      }

      repository.completeSettlement(context, settlementAck)

      // Replay with different settled_at
      const conflictingPayload = {
        ...settlementPayload,
        settled_at: new Date(NOW + 1000).toISOString()
      }
      const conflictingAck: H2SettlementAck = {
        payload: conflictingPayload,
        signature: signH2('settlement', conflictingPayload, SECRET)
      }

      expect(() => repository.completeSettlement(context, conflictingAck)).toThrowError(
        new ProductRuntimeRepositoryError('H2_ACK_MISMATCH')
      )
    })
  })

  describe('Desired Branch Reconciliation & Pause (H2-C)', () => {
    it('marks desired branch reconciliation as pending if target drifted while in-flight', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      database
        .prepare(
          "UPDATE product_deploy_job SET trigger='branch_poll', observation_sequence=5, reconcile_epoch=1 WHERE job_id=?"
        )
        .run(claim.job_id)
      database
        .prepare(
          `INSERT INTO product_desired_branch
            (app_id, source_generation, ref, desired_sha, desired_observation_sequence, reconcile_epoch, reconciliation_state, auto_paused, updated_at)
            VALUES (1, 1, 'main', '${'c'.repeat(40)}', 6, 2, 'pending', 0, '2026-10-27T10:00:00.000Z')`
        )
        .run()

      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      repository.finalize(sealedReceipt)

      const branch = database
        .prepare(
          'SELECT reconciliation_state, auto_paused FROM product_desired_branch WHERE app_id=1 AND ref=?'
        )
        .get('main') as { reconciliation_state: string; auto_paused: number }
      expect(branch.reconciliation_state).toBe('pending')
      expect(branch.auto_paused).toBe(0)
    })

    it('preserves paused reconciliation state when auto_deploy_paused is set on control', () => {
      const { repository, claim, buildEvidence, deploymentId, database } = setupHarness({
        withPrevious: true
      })
      database
        .prepare(
          "UPDATE product_app_control SET auto_deploy_paused=1, pause_reason='operator' WHERE app_id=1"
        )
        .run()
      database
        .prepare(
          "UPDATE product_deploy_job SET trigger='branch_poll', observation_sequence=5, reconcile_epoch=1 WHERE job_id=?"
        )
        .run(claim.job_id)
      database
        .prepare(
          `INSERT INTO product_desired_branch
            (app_id, source_generation, ref, desired_sha, desired_observation_sequence, reconcile_epoch, reconciliation_state, auto_paused, pause_reason, updated_at)
            VALUES (1, 1, 'main', '${SHA_B}', 5, 1, 'pending', 0, NULL, '2026-10-27T10:00:00.000Z')`
        )
        .run()

      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      repository.finalize(sealedReceipt)

      const branch = database
        .prepare(
          'SELECT reconciliation_state, auto_paused, pause_reason FROM product_desired_branch WHERE app_id=1 AND ref=?'
        )
        .get('main') as { reconciliation_state: string; auto_paused: number; pause_reason: string }
      expect(branch.reconciliation_state).toBe('paused')
      expect(branch.auto_paused).toBe(1)
      expect(branch.pause_reason).toBe('operator')
    })
  })

  describe('Crash Matrix & Recovery (H2-C)', () => {
    it('crash before seal: no terminal row exists, recovery is rejected and attestation fails', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)

      // Simulate crash before seal: no finalize called
      expect(repository.readSettlementAuthority(context)).toBe('rejected')
      expect(() => repository.commitAttestation(claim.attempt_id)).toThrowError(
        new ProductRuntimeRepositoryError('H2_TERMINAL_MISSING')
      )
    })

    it('crash after T1 before settlement: terminal row is committed, recovery readSettlementAuthority is ready and completeSettlement finishes durable settlement', () => {
      const { repository, claim, buildEvidence, deploymentId } = setupHarness({
        withPrevious: true
      })
      const boundary: H2MetricBoundary = {
        generation: 'stream-gen-1',
        device: 100,
        inode: 200,
        next_offset: 501
      }
      let context = repository.createContext(claim, deploymentId, buildEvidence)
      context = repository.beginActivationBarrier(context)
      repository.bindActivationBoundary(context, boundary)

      const sealedReceipt = createValidReceipt(context, { boundary })
      const terminalRecord = repository.finalize(sealedReceipt)

      // Simulate process crash/disconnect right after T1 commit.
      // Re-read terminal authority on recovery:
      expect(repository.readSettlementAuthority(context)).toBe('ready')

      // Recovery signer can obtain attestation
      const attestation = repository.commitAttestation(claim.attempt_id)
      expect(attestation.payload.commit_id).toBe(terminalRecord.commit_id)

      // Recovery settles and releases leases
      const settlementPayload = {
        version: 1 as const,
        kind: 'product-h2-settlement' as const,
        commit_id: terminalRecord.commit_id,
        receipt_sha256: attestation.payload.receipt_sha256,
        context_sha256: attestation.payload.context_sha256,
        execution_nonce: attestation.payload.execution_nonce,
        attempt_id: claim.attempt_id,
        deployment_id: deploymentId,
        settled_at: new Date(NOW).toISOString()
      }
      const settlementAck: H2SettlementAck = {
        payload: settlementPayload,
        signature: signH2('settlement', settlementPayload, SECRET)
      }

      repository.completeSettlement(context, settlementAck)

      const terminal = repository.getTerminal(claim.attempt_id)!
      expect(terminal.settled_at).toBe(settlementPayload.settled_at)
      expect(terminal.leases_released_at).not.toBeNull()

      // Post-settlement authority is still ready (or consistent) and idempotent
      expect(() => repository.completeSettlement(context, settlementAck)).not.toThrow()
    })
  })
})

function createValidReceipt(
  context: H2Context,
  options: {
    outcome?: 'succeeded' | 'failed' | 'rolled_back'
    failedStep?: 'BUILD' | 'DEPLOY' | null
    sealedAt?: string
    boundary?: H2MetricBoundary | null
    wrongSignature?: boolean
  } = {}
): H2SealedReceipt {
  const outcome = options.outcome ?? 'succeeded'
  const failedStep =
    options.failedStep !== undefined
      ? options.failedStep
      : outcome === 'succeeded'
        ? null
        : 'DEPLOY'
  const sealedAt = options.sealedAt ?? new Date(NOW).toISOString()
  const boundary =
    options.boundary !== undefined
      ? options.boundary
      : context.activation_id
        ? {
            generation: 'stream-gen-1',
            device: 100,
            inode: 200,
            next_offset: 501
          }
        : null

  const candidateRuntime: H2RuntimeIdentity = {
    deployment_id: context.deployment_id,
    image_tag: context.candidate_image_tag,
    image_id: context.candidate_image_id ?? `sha256:${'b'.repeat(64)}`,
    source_sha: context.source_sha,
    container_id: 'c'.repeat(64),
    collector_container_id: 'd'.repeat(64),
    collector_image_id: `sha256:${'e'.repeat(64)}`,
    config_sha256: 'f'.repeat(64),
    health: outcome === 'succeeded' ? 'healthy' : 'unhealthy',
    http_status: outcome === 'succeeded' ? 200 : 500
  }

  const previousRuntime: H2RuntimeIdentity | null = context.previous
    ? {
        deployment_id: context.previous.deployment_id,
        image_tag: context.previous.image_tag,
        image_id: `sha256:${'1'.repeat(64)}`,
        source_sha: context.previous.source_sha,
        container_id: '1'.repeat(64),
        collector_container_id: '2'.repeat(64),
        collector_image_id: `sha256:${'2'.repeat(64)}`,
        config_sha256: '3'.repeat(64),
        health: 'healthy',
        http_status: 200
      }
    : null

  const activeRuntime = outcome === 'succeeded' ? candidateRuntime : previousRuntime

  const receipt: H2TerminalReceipt = {
    version: 1,
    context,
    outcome,
    failed_step: failedStep,
    active_runtime: activeRuntime,
    candidate_runtime: context.build_state === 'build_failed_definite' ? null : candidateRuntime,
    previous_runtime: previousRuntime,
    boundary,
    exposure_status: 'not_checked',
    remote_quiescent: true,
    sealed_at: sealedAt
  }

  const signature = options.wrongSignature ? '0'.repeat(64) : signH2('receipt', receipt, SECRET)

  return {
    receipt,
    receipt_sha256: hashH2(receipt),
    signature
  }
}
