import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase, initializeDatabase } from './index'
import {
  ProductDeployRepository,
  ProductDeployRepositoryError,
  type ProductObserveTipInput,
  type ProductReconcileIdentity
} from './productDeployRepository'

const CONTROLLER_ID = 'controller-test'
const CONFIG_HASH = 'a'.repeat(64)
const CONFIG_HASH_NEXT = 'b'.repeat(64)
const SHA_A = '1'.repeat(40)
const SHA_B = '2'.repeat(40)

let testDirectory: string | null = null
const extraConnections: Database.Database[] = []

afterEach(() => {
  for (const connection of extraConnections.splice(0)) connection.close()
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('Product desired reconciliation transactions', () => {
  it('does not duplicate repeated polls across connections or after reopen', () => {
    const harness = createHarness()
    const first = harness.repository.observeTip(observation(harness.identity, null, SHA_B))
    expect(first).toMatchObject({
      observationSequence: 1,
      observationCreated: true,
      desiredSha: SHA_B,
      reconciliation: { state: 'queued', reason: 'queued' }
    })
    const jobId = first.reconciliation.jobId

    const secondDb = new Database(join(testDirectory!, 'opspilot.db'))
    secondDb.pragma('foreign_keys = ON')
    extraConnections.push(secondDb)
    const secondRepository = new ProductDeployRepository(secondDb)
    const repeated = secondRepository.observeTip(observation(harness.identity, 1, SHA_B))
    expect(repeated).toMatchObject({
      observationSequence: 1,
      observationCreated: false,
      reconciliation: { state: 'queued', reason: 'already_queued', jobId }
    })
    expect(count(secondDb, 'product_branch_observation')).toBe(1)
    expect(count(secondDb, 'product_deploy_job')).toBe(1)

    closeDatabase()
    const reopened = initializeDatabase(testDirectory!)
    const result = new ProductDeployRepository(reopened).reconcileDesired(harness.identity)
    expect(result).toEqual({ state: 'queued', reason: 'already_queued', jobId })
    expect(count(reopened, 'product_branch_observation')).toBe(1)
    expect(count(reopened, 'product_deploy_job')).toBe(1)
  })

  it('supersedes queued B when desired returns to canonical live A without enqueueing A', () => {
    const harness = createHarness()
    seedCanonicalProductDeployment(harness.database, 'live-a', SHA_A, 101, 1)

    const queuedB = harness.repository.observeTip(observation(harness.identity, null, SHA_B))
    expect(queuedB.reconciliation.state).toBe('queued')
    const desiredA = harness.repository.observeTip(observation(harness.identity, 1, SHA_A))

    expect(desiredA).toMatchObject({
      observationSequence: 2,
      observationCreated: true,
      reconciliation: { state: 'satisfied', reason: 'live_matches', jobId: null }
    })
    expect(
      harness.database
        .prepare("SELECT state FROM product_deploy_job WHERE trigger='branch_poll'")
        .get()
    ).toEqual({ state: 'superseded' })
    expect(count(harness.database, 'product_deploy_job')).toBe(2) // canonical live job + superseded B
  })

  it('keeps B mutation alive and recovers desired A after B succeeds and the database reopens', () => {
    const harness = createHarness()
    seedCanonicalProductDeployment(harness.database, 'live-a', SHA_A, 101, 1)
    const queuedB = harness.repository.observeTip(observation(harness.identity, null, SHA_B))
    const jobB = queuedB.reconciliation.jobId!
    harness.database
      .prepare("UPDATE product_deploy_job SET state='deploying', attempt_count=1 WHERE job_id=?")
      .run(jobB)
    expect(harness.repository.reconcileDesired(harness.identity)).toEqual({
      state: 'in_progress',
      reason: 'active_job',
      jobId: jobB
    })

    const desiredA = harness.repository.observeTip(observation(harness.identity, 1, SHA_A))
    expect(desiredA.reconciliation).toEqual({ state: 'pending', reason: 'active_job', jobId: null })
    expect(
      harness.database.prepare('SELECT state FROM product_deploy_job WHERE job_id=?').get(jobB)
    ).toEqual({
      state: 'deploying'
    })
    expect(harness.repository.getDesiredState(1, 1, 'main')).toMatchObject({
      kind: 'present',
      value: { desired_sha: SHA_A, reconciliation_state: 'pending' }
    })

    finalizeExistingJobAsSucceeded(harness.database, jobB, SHA_B, 102, 2)
    closeDatabase()
    const reopened = initializeDatabase(testDirectory!)
    const repository = new ProductDeployRepository(reopened)
    const recovered = repository.reconcileDesired(harness.identity)
    expect(recovered).toMatchObject({ state: 'queued', reason: 'queued' })
    expect(
      reopened.prepare('SELECT state FROM product_deploy_job WHERE job_id=?').get(jobB)
    ).toEqual({
      state: 'succeeded'
    })
    expect(
      reopened
        .prepare('SELECT COUNT(*) AS count FROM product_deploy_job WHERE trigger=?')
        .get('branch_poll')
    ).toEqual({
      count: 2
    })
    const unchangedTip = repository.observeTip(observation(harness.identity, 2, SHA_A))
    expect(unchangedTip).toMatchObject({
      observationSequence: 2,
      observationCreated: false,
      reconciliation: { state: 'queued', reason: 'already_queued', jobId: recovered.jobId }
    })
    const next = repository.reconcileDesired(harness.identity)
    expect(next).toEqual({ ...recovered, reason: 'already_queued' })
    expect(count(reopened, 'product_deploy_job')).toBe(3) // canonical A, completed B, desired A
  })

  it('preserves manual jobs and manual pause while superseding only obsolete auto jobs', () => {
    const harness = createHarness()
    harness.database.exec(`
      INSERT INTO product_branch_observation VALUES (1,1,'main',1,'${SHA_A}','now');
      INSERT INTO product_desired_branch
        (app_id,source_generation,ref,desired_observation_sequence,desired_sha,reconcile_epoch,
         reconciliation_state,auto_paused,pause_reason,updated_at)
        VALUES (1,1,'main',1,'${SHA_A}',0,'paused',1,'manual_action','now');
    `)
    seedJob(harness.database, {
      jobId: 'auto-old',
      trigger: 'branch_poll',
      key: 'auto:1:1:0',
      sha: SHA_A,
      observationSequence: 1,
      reconcileEpoch: 0
    })
    seedJob(harness.database, {
      jobId: 'manual-job',
      trigger: 'manual_redeploy',
      key: 'manual-request-id',
      sha: SHA_A
    })

    const result = harness.repository.observeTip(observation(harness.identity, 1, SHA_B))
    expect(result.reconciliation).toEqual({ state: 'paused', reason: 'manual_pause', jobId: null })
    expect(
      harness.database
        .prepare('SELECT state FROM product_deploy_job WHERE job_id=?')
        .get('auto-old')
    ).toEqual({
      state: 'superseded'
    })
    expect(
      harness.database
        .prepare('SELECT state FROM product_deploy_job WHERE job_id=?')
        .get('manual-job')
    ).toEqual({
      state: 'queued'
    })
    expect(
      harness.database.prepare('SELECT auto_paused, pause_reason FROM product_desired_branch').get()
    ).toEqual({
      auto_paused: 1,
      pause_reason: 'manual_action'
    })
    expect(count(harness.database, 'product_deploy_job')).toBe(2)
  })

  it.each([
    ['failed', 'failed'],
    ['rolled_back', 'failed'],
    ['uncertain', 'uncertain']
  ] as const)(
    'does not replay terminal %s job for the same desired revision',
    (jobState, resultState) => {
      const harness = createHarness()
      const first = harness.repository.observeTip(observation(harness.identity, null, SHA_B))
      harness.database
        .prepare('UPDATE product_deploy_job SET state=? WHERE job_id=?')
        .run(jobState, first.reconciliation.jobId)
      const before = count(harness.database, 'product_deploy_job')

      const result = harness.repository.reconcileDesired(harness.identity)
      expect(result).toMatchObject({ state: resultState, jobId: first.reconciliation.jobId })
      expect(count(harness.database, 'product_deploy_job')).toBe(before)
      const repeat = harness.repository.observeTip(observation(harness.identity, 1, SHA_B))
      expect(repeat.reconciliation.state).toBe(resultState)
      expect(count(harness.database, 'product_deploy_job')).toBe(before)
    }
  )

  it('requires DB-canonical live deployment proof and ignores caller-supplied verification claims', () => {
    const noProof = createHarness()
    seedUnlinkedLiveDeployment(noProof.database, SHA_A, 100)
    const withUntrustedClaim = {
      ...observation(noProof.identity, null, SHA_A),
      verified: true,
      liveSha: SHA_A
    } as ReturnType<typeof observation>
    expect(noProof.repository.observeTip(withUntrustedClaim).reconciliation.state).toBe('queued')
    expect(count(noProof.database, 'product_deploy_job')).toBe(1)

    const canonical = createHarness()
    seedCanonicalProductDeployment(canonical.database, 'live-a', SHA_A, 101, 1)
    expect(
      canonical.repository.observeTip(observation(canonical.identity, null, SHA_A)).reconciliation
    ).toEqual({ state: 'satisfied', reason: 'live_matches', jobId: null })
    expect(count(canonical.database, 'product_deploy_job')).toBe(1) // only the canonical succeeded job
  })

  it('rejects stale sequences, generations, config/ref/app, inactive controller and archived VPS without writes', () => {
    const harness = createHarness()
    const first = harness.repository.observeTip(observation(harness.identity, null, SHA_B))
    const initialCounts = [
      count(harness.database, 'product_branch_observation'),
      count(harness.database, 'product_deploy_job')
    ]
    expectCode(
      () => harness.repository.observeTip(observation(harness.identity, null, SHA_A)),
      'STALE_OBSERVATION'
    )
    expectCode(
      () =>
        harness.repository.observeTip({
          ...observation(harness.identity, 1, SHA_A),
          ownershipGeneration: 2
        }),
      'PRODUCT_STATE_CONFLICT'
    )
    expectCode(
      () =>
        harness.repository.observeTip({
          ...observation(harness.identity, 1, SHA_A),
          sourceGeneration: 2,
          configSha256: CONFIG_HASH_NEXT
        }),
      'PRODUCT_STATE_CONFLICT'
    )
    expectCode(
      () =>
        harness.repository.observeTip({
          ...observation(harness.identity, 1, SHA_A),
          configSha256: 'c'.repeat(64)
        }),
      'PRODUCT_STATE_CONFLICT'
    )
    expectCode(
      () =>
        harness.repository.observeTip({
          ...observation(harness.identity, 1, SHA_A),
          ref: 'release'
        }),
      'PRODUCT_STATE_CONFLICT'
    )
    expectCode(
      () =>
        harness.repository.observeTip({
          ...observation(harness.identity, 1, SHA_A),
          appId: 2
        }),
      'PRODUCT_STATE_CONFLICT'
    )
    harness.database
      .prepare("UPDATE product_controller SET status='maintenance' WHERE controller_id=?")
      .run(CONTROLLER_ID)
    expectCode(() => harness.repository.reconcileDesired(harness.identity), 'CONTROLLER_NOT_ACTIVE')
    harness.database
      .prepare("UPDATE product_controller SET status='active' WHERE controller_id=?")
      .run(CONTROLLER_ID)
    harness.database.prepare("UPDATE vps SET archived_at='archived' WHERE id=1").run()
    expectCode(
      () => harness.repository.reconcileDesired(harness.identity),
      'PRODUCT_APP_NOT_ELIGIBLE'
    )
    expect(harness.repository.getLatestObservation(1, 1, 'main')).toMatchObject({
      kind: 'present',
      value: { observation_sequence: 1, observed_sha: SHA_B }
    })
    expect([
      count(harness.database, 'product_branch_observation'),
      count(harness.database, 'product_deploy_job')
    ]).toEqual(initialCounts)
    expect(first.reconciliation.state).toBe('queued')
  })

  it('rolls back observation, desired change and supersede when enqueue fails mid-transaction', () => {
    const harness = createHarness()
    const first = harness.repository.observeTip(observation(harness.identity, null, SHA_B))
    harness.database.exec(`
      CREATE TRIGGER fail_product_auto_enqueue
      BEFORE INSERT ON product_deploy_job WHEN NEW.trigger='branch_poll'
      BEGIN SELECT RAISE(ABORT, 'injected enqueue failure'); END;
    `)

    expect(() => harness.repository.observeTip(observation(harness.identity, 1, SHA_A))).toThrow(
      'injected enqueue failure'
    )
    expect(harness.repository.getLatestObservation(1, 1, 'main')).toMatchObject({
      kind: 'present',
      value: { observation_sequence: 1, observed_sha: SHA_B }
    })
    expect(harness.repository.getDesiredState(1, 1, 'main')).toMatchObject({
      kind: 'present',
      value: { desired_observation_sequence: 1, desired_sha: SHA_B, reconciliation_state: 'queued' }
    })
    expect(
      harness.database
        .prepare('SELECT state FROM product_deploy_job WHERE job_id=?')
        .get(first.reconciliation.jobId)
    ).toEqual({
      state: 'queued'
    })
    expect(count(harness.database, 'product_branch_observation')).toBe(1)
    expect(count(harness.database, 'product_deploy_job')).toBe(1)
  })
})

function createHarness(): {
  database: ReturnType<typeof initializeDatabase>
  repository: ProductDeployRepository
  identity: ProductReconcileIdentity
} {
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-product-reconcile-'))
  const database = initializeDatabase(testDirectory)
  database.exec(`
    INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
      VALUES (1, 'vps-one', 'example.test', 'deploy', 'key', X'00');
    INSERT INTO app (id, vps_id, name, framework, host_port, container_port, source_type,
      git_repo_url, git_ref, git_root) VALUES
      (1, 1, 'app-one', 'express', 30001, 3000, 'git', 'https://example.test/repo.git', 'main', '.');
    INSERT INTO app (id, vps_id, name, framework, host_port, container_port, source_type,
      git_repo_url, git_ref, git_root) VALUES
      (2, 1, 'app-two', 'express', 30002, 3000, 'git', 'https://example.test/other.git', 'main', '.');
    INSERT INTO product_controller VALUES ('${CONTROLLER_ID}', 'now', 'active');
    INSERT INTO product_source_config VALUES
      (1, 1, 'https://example.test/repo.git', 'main', '.', '{}', '${CONFIG_HASH}', 'now'),
      (1, 2, 'https://example.test/repo.git', 'release', '.', '{}', '${CONFIG_HASH_NEXT}', 'now');
    INSERT INTO product_app_control VALUES
      (1, 'product', '${CONTROLLER_ID}', 1, 1, '${CONFIG_HASH}', 'now');
  `)
  const identity: ProductReconcileIdentity = {
    controllerId: CONTROLLER_ID,
    appId: 1,
    ownershipGeneration: 1,
    sourceGeneration: 1,
    configSha256: CONFIG_HASH,
    ref: 'main'
  }
  return { database, repository: new ProductDeployRepository(database), identity }
}

function observation(
  identity: ProductReconcileIdentity,
  expectedObservationSequence: number | null,
  tipSha: string
): ProductObserveTipInput {
  return { ...identity, expectedObservationSequence, tipSha }
}

function seedCanonicalProductDeployment(
  database: ReturnType<typeof initializeDatabase>,
  jobId: string,
  sha: string,
  deploymentId: number,
  fence: number
): void {
  seedJob(database, {
    jobId,
    trigger: 'manual_redeploy',
    key: `canonical-${jobId}`,
    sha,
    state: 'succeeded',
    attemptCount: 1
  })
  addSuccessfulAttempt(database, jobId, sha, deploymentId, fence)
}

function seedUnlinkedLiveDeployment(
  database: ReturnType<typeof initializeDatabase>,
  sha: string,
  deploymentId: number
): void {
  database
    .prepare(
      `INSERT INTO deployment
      (id, app_id, version, image_tag, git_repo_url, git_commit_sha, status)
      VALUES (?, 1, ?, ?, 'https://example.test/repo.git', ?, 'running')`
    )
    .run(deploymentId, deploymentId, `legacy:${sha.slice(0, 8)}`, sha)
  database.prepare('UPDATE app SET current_deployment_id=? WHERE id=1').run(deploymentId)
}

function seedJob(
  database: ReturnType<typeof initializeDatabase>,
  input: {
    jobId: string
    trigger: 'branch_poll' | 'manual_redeploy'
    key: string
    sha: string
    state?: string
    observationSequence?: number
    reconcileEpoch?: number
    attemptCount?: number
  }
): void {
  database
    .prepare(
      `INSERT INTO product_deploy_job
       (job_id, controller_id, app_id, ownership_generation, source_generation,
        source_config_sha256, trigger, idempotency_key, ref, target_sha,
        observation_sequence, reconcile_epoch, state, attempt_count, max_attempts,
        available_at, created_at, updated_at, finished_at)
       VALUES (?, ?, 1, 1, 1, ?, ?, ?, 'main', ?, ?, ?, ?, ?, 3,
               'now', 'now', 'now', CASE WHEN ? IN ('succeeded','failed','rolled_back') THEN 'now' ELSE NULL END)`
    )
    .run(
      input.jobId,
      CONTROLLER_ID,
      CONFIG_HASH,
      input.trigger,
      input.key,
      input.sha,
      input.observationSequence ?? null,
      input.reconcileEpoch ?? null,
      input.state ?? 'queued',
      input.attemptCount ?? 0,
      input.state ?? 'queued'
    )
}

function addSuccessfulAttempt(
  database: ReturnType<typeof initializeDatabase>,
  jobId: string,
  sha: string,
  deploymentId: number,
  fence: number
): void {
  database
    .prepare(
      'INSERT INTO product_app_fence (app_id, last_fence) VALUES (1, ?) ON CONFLICT(app_id) DO UPDATE SET last_fence=MAX(last_fence, excluded.last_fence)'
    )
    .run(fence)
  database
    .prepare(
      `INSERT INTO deployment (id, app_id, version, image_tag, git_repo_url, git_commit_sha, status)
              VALUES (?, 1, ?, ?, 'https://example.test/repo.git', ?, 'running')`
    )
    .run(deploymentId, deploymentId, `app:${sha.slice(0, 8)}`, sha)
  database
    .prepare(
      `INSERT INTO product_app_lease
      (app_id, lease_id, controller_id, ownership_generation, fence, job_id, acquired_at, expires_at, heartbeat_at, released_at)
      VALUES (1, ?, ?, 1, ?, ?, 'now', 'later', 'now', 'released')`
    )
    .run(`app-lease-${jobId}`, CONTROLLER_ID, fence, jobId)
  database
    .prepare(
      `INSERT INTO product_worker_lease
      (slot_name, lease_id, controller_id, fence, job_id, acquired_at, expires_at, heartbeat_at, released_at)
      VALUES ('build', ?, ?, ?, ?, 'now', 'later', 'now', 'released')`
    )
    .run(`build-lease-${jobId}`, CONTROLLER_ID, fence, jobId)
  database
    .prepare(
      `INSERT INTO product_deploy_attempt
      (attempt_id, job_id, attempt_number, lease_id, fencing_token,
       build_slot_lease_id, build_slot_fence, state, deployment_id, remote_outcome,
       started_at, finished_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, 'succeeded', ?, 'applied', 'now', 'now')`
    )
    .run(
      `attempt-${jobId}`,
      jobId,
      `app-lease-${jobId}`,
      fence,
      `build-lease-${jobId}`,
      fence,
      deploymentId
    )
  database
    .prepare(
      "UPDATE product_deploy_job SET state='succeeded', attempt_count=1, finished_at='now' WHERE job_id=?"
    )
    .run(jobId)
  database.prepare('UPDATE app SET current_deployment_id=? WHERE id=1').run(deploymentId)
}

function finalizeExistingJobAsSucceeded(
  database: ReturnType<typeof initializeDatabase>,
  jobId: string,
  sha: string,
  deploymentId: number,
  fence: number
): void {
  addSuccessfulAttempt(database, jobId, sha, deploymentId, fence)
  database.prepare("UPDATE deployment SET status='stopped' WHERE id=101").run()
}

function count(database: ReturnType<typeof initializeDatabase>, table: string): number {
  if (!/^product_[a-z_]+$/.test(table)) throw new Error('invalid test table')
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action()
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(ProductDeployRepositoryError)
    expect((error as ProductDeployRepositoryError).code).toBe(code)
  }
}
