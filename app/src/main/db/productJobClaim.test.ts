import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex, PassThrough } from 'node:stream'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  PRODUCT_HEARTBEAT_INTERVAL_MS,
  PRODUCT_LEASE_TTL_MS,
  PRODUCT_MAX_ATTEMPTS,
  PRODUCT_RETRY_BACKOFF_MS,
  PRODUCT_RETRY_JITTER_MAX_MS
} from '../../../../docs/contracts/product-auto-deploy'
import { closeDatabase, initializeDatabase } from './index'
import { ProductDeployRepository } from './productDeployRepository'
import { VpsRepository } from './vpsRepository'
import { openProductGuardedSshSession } from '../controlPlane/guardedSshSession'
import { encodeGuardedSshFrame } from '../controlPlane/guardedSshProtocol'
import type { PreparedProductGitSnapshot } from '../controlPlane/productSnapshotPreparation'

const CONTROLLER = 'claim-controller'
const HASH = 'a'.repeat(64)
const SHA_A = '1'.repeat(40)
const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const TARGET_PIN = `SHA256:${'A'.repeat(43)}`

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('Product atomic claim and lease repository', () => {
  it('prepares the exact job SHA after branch movement and verifies only fetched checkout metadata', async () => {
    const harness = createHarness()
    const { execFileSync } = await import('node:child_process')
    const { mkdirSync } = await import('node:fs')
    const { pathToFileURL } = await import('node:url')
    const { prepareProductGitSnapshotFromLocalFixture } =
      await import('../controlPlane/productSnapshotPreparation')
    const working = join(testDirectory!, 'source')
    const bare = join(testDirectory!, 'source.git')
    execFileSync('git', ['init', '--quiet', '--bare', bare])
    mkdirSync(working)
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: working, encoding: 'utf8' }).trim()
    git('init', '--quiet', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    mkdirSync(join(working, 'app'))
    writeFileSync(join(working, 'app', 'marker.txt'), 'snapshot A')
    git('add', '.')
    git('commit', '--quiet', '-m', 'A')
    const shaA = git('rev-parse', 'HEAD')
    git('remote', 'add', 'origin', bare)
    git('push', '--quiet', 'origin', 'main')
    const url = pathToFileURL(bare).toString()
    harness.database.prepare('UPDATE app SET git_repo_url=?,git_root=? WHERE id=1').run(url, 'app')
    harness.database
      .prepare('UPDATE product_source_config SET repository_url=?,repository_root=? WHERE app_id=1')
      .run(url, 'app')
    seedManualJob(harness.database, 'snapshot-job', 1)
    harness.database
      .prepare('UPDATE product_deploy_job SET target_sha=? WHERE job_id=?')
      .run(shaA, 'snapshot-job')
    writeFileSync(join(working, 'app', 'marker.txt'), 'snapshot B')
    git('add', '.')
    git('commit', '--quiet', '-m', 'B')
    git('push', '--quiet', 'origin', 'main')

    const result = harness.repository.claimNextJob(CONTROLLER)
    expect(result.state).toBe('claimed')
    if (result.state !== 'claimed') return
    const snapshot = await prepareProductGitSnapshotFromLocalFixture(
      harness.repository,
      result.claim,
      {
        tempDirectory: testDirectory!
      }
    )
    const directory = snapshot.snapshotDirectory
    try {
      expect(snapshot.metadata.commitSha).toBe(shaA)
      expect(readFileSync(join(snapshot.rootDirectory, 'marker.txt'), 'utf8')).toBe('snapshot A')
      expect(harness.repository.readClaimExecutionState(result.claim)).toBe('prewrite')
      const { readdirSync } = await import('node:fs')
      const priorSnapshots = readdirSync(testDirectory!).filter((name) =>
        name.startsWith('opspilot-git-')
      )
      const stalePreparation = prepareProductGitSnapshotFromLocalFixture(
        harness.repository,
        result.claim,
        { tempDirectory: testDirectory! }
      )
      const deadline = Date.now() + 2_000
      let newSnapshotStarted = false
      while (Date.now() < deadline && !newSnapshotStarted) {
        newSnapshotStarted = readdirSync(testDirectory!).some(
          (name) => name.startsWith('opspilot-git-') && !priorSnapshots.includes(name)
        )
        if (!newSnapshotStarted) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(newSnapshotStarted).toBe(true)
      harness.database
        .prepare(
          'UPDATE product_app_control SET ownership_generation=ownership_generation+1 WHERE app_id=1'
        )
        .run()
      await expect(stalePreparation).rejects.toMatchObject({ code: 'snapshot_source_changed' })
      expect(
        readdirSync(testDirectory!).filter((name) => name.startsWith('opspilot-git-'))
      ).toEqual(priorSnapshots)
      harness.database
        .prepare('UPDATE product_app_control SET ownership_generation=1 WHERE app_id=1')
        .run()
    } finally {
      snapshot.cleanup()
      snapshot.cleanup()
      expect(existsSync(directory)).toBe(false)
    }
  })

  it('rejects a snapshot authority read after either lease expires or ownership changes', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'authority-job', 1)
    const claimResult = harness.repository.claimNextJob(CONTROLLER)
    expect(claimResult.state).toBe('claimed')
    if (claimResult.state !== 'claimed') return
    expect(harness.repository.readGitSnapshotAuthority(claimResult.claim).state).toBe('ready')
    harness.clock.advance(PRODUCT_LEASE_TTL_MS + 1)
    expect(harness.repository.readGitSnapshotAuthority(claimResult.claim)).toEqual({
      state: 'rejected',
      reason: 'expired_lease'
    })

    const secondHarness = createHarness()
    seedManualJob(secondHarness.database, 'changed-authority-job', 1)
    const secondClaim = secondHarness.repository.claimNextJob(CONTROLLER)
    if (secondClaim.state !== 'claimed') throw new Error('expected snapshot authority claim')
    secondHarness.database
      .prepare(
        'UPDATE product_app_control SET ownership_generation=ownership_generation+1 WHERE app_id=1'
      )
      .run()
    expect(secondHarness.repository.readGitSnapshotAuthority(secondClaim.claim)).toEqual({
      state: 'rejected',
      reason: 'ownership_changed'
    })
  })
  it('prefers manual jobs and atomically creates one attempt, app lease, build slot and fences', () => {
    expect(PRODUCT_LEASE_TTL_MS).toBe(60_000)
    expect(PRODUCT_HEARTBEAT_INTERVAL_MS).toBe(15_000)
    const harness = createHarness()
    seedAutoJob(harness.database, 'auto-job', 1)
    seedManualJob(harness.database, 'manual-job', 1)

    const claim = harness.repository.claimNextJob(CONTROLLER)
    expect(claim).toMatchObject({
      state: 'claimed',
      claim: { job_id: 'manual-job', attempt_number: 1 }
    })
    if (claim.state !== 'claimed') throw new Error('expected claim')
    expect(
      harness.database
        .prepare('SELECT state, attempt_count FROM product_deploy_job WHERE job_id=?')
        .get('manual-job')
    ).toEqual({ state: 'claimed', attempt_count: 1 })
    expect(
      harness.database
        .prepare('SELECT state, remote_outcome FROM product_deploy_attempt WHERE attempt_id=?')
        .get(claim.claim.attempt_id)
    ).toEqual({ state: 'claimed', remote_outcome: 'not_started' })
    expect(
      harness.database
        .prepare('SELECT COUNT(*) AS count FROM product_app_lease WHERE released_at IS NULL')
        .get()
    ).toEqual({ count: 1 })
    expect(
      harness.database
        .prepare('SELECT COUNT(*) AS count FROM product_worker_lease WHERE released_at IS NULL')
        .get()
    ).toEqual({ count: 1 })
    expect(
      harness.database.prepare('SELECT last_fence FROM product_app_fence WHERE app_id=1').get()
    ).toEqual({ last_fence: 1 })
    expect(
      harness.database
        .prepare('SELECT fence FROM product_worker_lease WHERE lease_id=?')
        .get(claim.claim.build_slot_lease_id)
    ).toEqual({ fence: 1 })
    expect(
      harness.database
        .prepare('SELECT reconciliation_state FROM product_desired_branch WHERE app_id=1')
        .get()
    ).toEqual({ reconciliation_state: 'queued' })

    closeDatabase()
    const auto = createHarness()
    seedAutoJob(auto.database, 'auto-claim', 1)
    expect(auto.repository.claimNextJob(CONTROLLER)).toMatchObject({
      state: 'claimed',
      claim: { job_id: 'auto-claim' }
    })
    expect(
      auto.database
        .prepare('SELECT reconciliation_state,reconciliation_job_id FROM product_desired_branch')
        .get()
    ).toEqual({ reconciliation_state: 'in_progress', reconciliation_job_id: 'auto-claim' })
  })

  it('allows one controller-wide build slot across apps and does not reuse expired leases', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'app-one', 1)
    seedManualJob(harness.database, 'app-two', 2)
    const first = harness.repository.claimNextJob(CONTROLLER)
    expect(first).toMatchObject({ state: 'claimed', claim: { app_id: 1 } })
    expect(harness.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'blocked',
      reason: 'build_slot_busy'
    })

    harness.clock.advance(60_000)
    expect(harness.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'blocked',
      reason: 'reconciliation_required'
    })
    expect(
      harness.database.prepare('SELECT COUNT(*) AS count FROM product_deploy_attempt').get()
    ).toEqual({ count: 1 })
    expect(
      harness.database.prepare('SELECT last_fence FROM product_app_fence WHERE app_id=2').get()
    ).toBeUndefined()
  })

  it('respects available_at and claims a retry only after its durable delay', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'not-yet-available', 1, {
      state: 'retry_wait',
      attemptCount: 1
    })
    harness.database
      .prepare('UPDATE product_deploy_job SET available_at=? WHERE job_id=?')
      .run('2026-10-22T12:00:30.000Z', 'not-yet-available')
    expect(harness.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'none',
      reason: 'no_eligible_job'
    })
    expect(harness.database.prepare('SELECT attempt_count FROM product_deploy_job').get()).toEqual({
      attempt_count: 1
    })
    harness.clock.advance(30_000)
    expect(harness.repository.claimNextJob(CONTROLLER)).toMatchObject({
      state: 'claimed',
      claim: { attempt_number: 2 }
    })
  })

  it('does not claim paused, obsolete, or uncertain auto work and does not consume retry budget', () => {
    const paused = createHarness()
    seedAutoJob(paused.database, 'paused-auto', 1)
    paused.database
      .prepare(
        `UPDATE product_app_control SET auto_deploy_paused=1,
      pause_reason='manual_action', pause_policy_provenance='explicit' WHERE app_id=1`
      )
      .run()
    expect(paused.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'none',
      reason: 'no_eligible_job'
    })
    expect(count(paused.database, 'product_deploy_attempt')).toBe(0)

    closeDatabase()
    const obsolete = createHarness()
    seedAutoJob(obsolete.database, 'obsolete-auto', 1)
    obsolete.database
      .prepare(`UPDATE product_desired_branch SET desired_sha=? WHERE app_id=1`)
      .run('2'.repeat(40))
    expect(obsolete.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'none',
      reason: 'no_eligible_job'
    })

    closeDatabase()
    const staleGeneration = createHarness()
    seedManualJob(staleGeneration.database, 'old-generation-manual', 1)
    staleGeneration.database
      .prepare(`UPDATE product_app_control SET ownership_generation=2 WHERE app_id=1`)
      .run()
    expect(staleGeneration.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'none',
      reason: 'no_eligible_job'
    })

    closeDatabase()
    const uncertain = createHarness()
    seedAutoJob(uncertain.database, 'auto-behind-uncertain', 1)
    seedManualJob(uncertain.database, 'uncertain-manual', 1)
    uncertain.database
      .prepare(`UPDATE product_deploy_job SET state='uncertain' WHERE job_id=?`)
      .run('uncertain-manual')
    expect(uncertain.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'none',
      reason: 'no_eligible_job'
    })

    closeDatabase()
    const exhausted = createHarness()
    seedManualJob(exhausted.database, 'retry-exhausted', 1, {
      state: 'retry_wait',
      attemptCount: 2,
      maxAttempts: 2
    })
    expect(exhausted.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'none',
      reason: 'no_eligible_job'
    })
    expect(
      exhausted.database.prepare('SELECT attempt_count FROM product_deploy_job').get()
    ).toEqual({ attempt_count: 2 })
  })

  it('heartbeat renews both exact leases, then rejects stale token, changed ownership and expired lease', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'heartbeat-job', 1)
    const result = harness.repository.claimNextJob(CONTROLLER)
    if (result.state !== 'claimed') throw new Error('expected claim')
    harness.clock.advance(15_000)

    const renewed = harness.repository.heartbeatClaim(result.claim)
    expect(renewed).toEqual({ state: 'renewed', expires_at: '2026-10-22T12:01:15.000Z' })
    if (renewed.state !== 'renewed') throw new Error('expected heartbeat renewal')
    expect(
      harness.database
        .prepare('SELECT expires_at FROM product_app_lease WHERE lease_id=?')
        .get(result.claim.app_lease_id)
    ).toEqual({ expires_at: renewed.expires_at })
    expect(
      harness.database
        .prepare('SELECT expires_at FROM product_worker_lease WHERE lease_id=?')
        .get(result.claim.build_slot_lease_id)
    ).toEqual({ expires_at: renewed.expires_at })
    expect(harness.repository.heartbeatClaim({ ...result.claim, app_fence: 999 })).toEqual({
      state: 'rejected',
      reason: 'stale_claim'
    })
    expect(harness.repository.heartbeatClaim({ ...result.claim, build_slot_fence: 999 })).toEqual({
      state: 'rejected',
      reason: 'stale_claim'
    })

    harness.database
      .prepare('UPDATE product_app_control SET ownership_generation=2 WHERE app_id=1')
      .run()
    expect(harness.repository.heartbeatClaim(result.claim)).toEqual({
      state: 'rejected',
      reason: 'ownership_changed'
    })

    harness.database
      .prepare('UPDATE product_app_control SET ownership_generation=1 WHERE app_id=1')
      .run()
    harness.clock.advance(60_000)
    expect(harness.repository.heartbeatClaim(result.claim)).toEqual({
      state: 'rejected',
      reason: 'expired_lease'
    })
  })

  it('rejects a heartbeat that waits past expiry without changing either lease', async () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'lock-expired-heartbeat', 1)
    const claim = harness.repository.claimNextJob(CONTROLLER)
    if (claim.state !== 'claimed') throw new Error('expected claim')
    const appBefore = harness.database
      .prepare('SELECT heartbeat_at,expires_at FROM product_app_lease WHERE lease_id=?')
      .get(claim.claim.app_lease_id)
    const buildBefore = harness.database
      .prepare('SELECT heartbeat_at,expires_at FROM product_worker_lease WHERE lease_id=?')
      .get(claim.claim.build_slot_lease_id)
    await runOperationBehindWriteLock('heartbeat', claim.claim, NOW + PRODUCT_LEASE_TTL_MS + 1)

    const verify = new Database(join(testDirectory!, 'opspilot.db'))
    expect(
      verify
        .prepare('SELECT heartbeat_at,expires_at FROM product_app_lease WHERE lease_id=?')
        .get(claim.claim.app_lease_id)
    ).toEqual(appBefore)
    expect(
      verify
        .prepare('SELECT heartbeat_at,expires_at FROM product_worker_lease WHERE lease_id=?')
        .get(claim.claim.build_slot_lease_id)
    ).toEqual(buildBefore)
    verify.close()
    // The child result is persisted by the helper for assertions and the claim remains expired.
    expect(JSON.parse(readFileSync(join(testDirectory!, 'operation.result'), 'utf8'))).toEqual({
      state: 'rejected',
      reason: 'expired_lease'
    })
  })

  it('renews both leases when a waiting heartbeat gets the lock before expiry', async () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'lock-valid-heartbeat', 1)
    const claim = harness.repository.claimNextJob(CONTROLLER)
    if (claim.state !== 'claimed') throw new Error('expected claim')
    await runOperationBehindWriteLock('heartbeat', claim.claim, NOW + 15_000)
    expect(JSON.parse(readFileSync(join(testDirectory!, 'operation.result'), 'utf8'))).toEqual({
      state: 'renewed',
      expires_at: new Date(NOW + 15_000 + PRODUCT_LEASE_TTL_MS).toISOString()
    })
    const verify = new Database(join(testDirectory!, 'opspilot.db'))
    const expected = {
      heartbeat_at: new Date(NOW + 15_000).toISOString(),
      expires_at: new Date(NOW + 15_000 + PRODUCT_LEASE_TTL_MS).toISOString()
    }
    expect(
      verify
        .prepare('SELECT heartbeat_at,expires_at FROM product_app_lease WHERE lease_id=?')
        .get(claim.claim.app_lease_id)
    ).toEqual(expected)
    expect(
      verify
        .prepare('SELECT heartbeat_at,expires_at FROM product_worker_lease WHERE lease_id=?')
        .get(claim.claim.build_slot_lease_id)
    ).toEqual(expected)
    verify.close()
  })

  it('starts a queued job lease from the time the waiting claim obtains the lock', async () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'lock-waiting-claim', 1)
    await runOperationBehindWriteLock('claim', null, NOW + 5_000)
    expect(
      JSON.parse(readFileSync(join(testDirectory!, 'operation.result'), 'utf8'))
    ).toMatchObject({
      state: 'claimed',
      claim: { expires_at: new Date(NOW + 5_000 + PRODUCT_LEASE_TTL_MS).toISOString() }
    })
  })

  it('releases a valid pre-write claim into retry_wait and claims the same job with a higher fence', () => {
    const harness = createHarness(() => 0.5)
    seedManualJob(harness.database, 'prewrite-retry', 1)
    const first = harness.repository.claimNextJob(CONTROLLER)
    if (first.state !== 'claimed') throw new Error('expected first claim')

    const finished = harness.repository.finishPrewriteAttempt({
      claim: first.claim,
      disposition: 'transient_failure',
      safeErrorCode: 'GIT_UNAVAILABLE'
    })
    const jitter = Math.floor(PRODUCT_RETRY_JITTER_MAX_MS * 0.5)
    const firstAvailableAt = new Date(NOW + PRODUCT_RETRY_BACKOFF_MS[0] + jitter).toISOString()
    expect(finished).toEqual({ state: 'retry_scheduled', available_at: firstAvailableAt })
    expect(
      harness.database
        .prepare('SELECT state,attempt_count,available_at FROM product_deploy_job')
        .get()
    ).toEqual({ state: 'retry_wait', attempt_count: 1, available_at: firstAvailableAt })
    expect(
      harness.database
        .prepare('SELECT state,remote_outcome,finished_at FROM product_deploy_attempt')
        .get()
    ).toEqual({ state: 'failed', remote_outcome: 'not_started', finished_at: harness.clock.iso() })
    expect(
      harness.database
        .prepare('SELECT COUNT(*) AS count FROM product_app_lease WHERE released_at IS NULL')
        .get()
    ).toEqual({ count: 0 })
    expect(
      harness.database
        .prepare('SELECT COUNT(*) AS count FROM product_worker_lease WHERE released_at IS NULL')
        .get()
    ).toEqual({ count: 0 })
    expect(
      harness.database.prepare('SELECT last_fence FROM product_app_fence WHERE app_id=1').get()
    ).toEqual({ last_fence: 1 })
    expect(harness.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'none',
      reason: 'no_eligible_job'
    })

    harness.clock.value = Date.parse(firstAvailableAt)
    const second = harness.repository.claimNextJob(CONTROLLER)
    expect(second).toMatchObject({ state: 'claimed', claim: { attempt_number: 2, app_fence: 2 } })
  })

  it('uses bounded backoff and stops after three total attempts', () => {
    const harness = createHarness(() => 1)
    seedManualJob(harness.database, 'prewrite-budget', 1, { maxAttempts: 3 })
    expect(PRODUCT_MAX_ATTEMPTS).toBe(3)
    for (let attemptNumber = 1; attemptNumber <= PRODUCT_MAX_ATTEMPTS; attemptNumber += 1) {
      const claim = harness.repository.claimNextJob(CONTROLLER)
      expect(claim).toMatchObject({ state: 'claimed', claim: { attempt_number: attemptNumber } })
      if (claim.state !== 'claimed') throw new Error('expected claim')
      const result = harness.repository.finishPrewriteAttempt({
        claim: claim.claim,
        disposition: 'transient_failure',
        safeErrorCode: 'SSH_PREFLIGHT_TIMEOUT'
      })
      if (attemptNumber < PRODUCT_MAX_ATTEMPTS) {
        const base = PRODUCT_RETRY_BACKOFF_MS[attemptNumber - 1]
        const availableAt = new Date(
          harness.clock.value + base + PRODUCT_RETRY_JITTER_MAX_MS
        ).toISOString()
        expect(result).toEqual({ state: 'retry_scheduled', available_at: availableAt })
        harness.clock.value = Date.parse(availableAt)
      } else {
        expect(result).toEqual({ state: 'failed' })
      }
    }
    expect(harness.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'none',
      reason: 'no_eligible_job'
    })
    expect(
      harness.database.prepare('SELECT attempt_count,state FROM product_deploy_job').get()
    ).toEqual({ attempt_count: 3, state: 'failed' })
    expect(
      harness.database.prepare('SELECT COUNT(*) AS count FROM product_deploy_attempt').get()
    ).toEqual({ count: 3 })
  })

  it('marks a non-retryable pre-write failure terminal without creating another attempt', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'prewrite-permanent', 1)
    const claim = harness.repository.claimNextJob(CONTROLLER)
    if (claim.state !== 'claimed') throw new Error('expected claim')
    expect(
      harness.repository.finishPrewriteAttempt({
        claim: claim.claim,
        disposition: 'permanent_failure',
        safeErrorCode: 'INVALID_SOURCE_CONFIG'
      })
    ).toEqual({ state: 'failed' })
    expect(
      harness.database.prepare('SELECT state,attempt_count FROM product_deploy_job').get()
    ).toEqual({ state: 'failed', attempt_count: 1 })
    expect(harness.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'none',
      reason: 'no_eligible_job'
    })
    expect(count(harness.database, 'product_deploy_attempt')).toBe(1)
  })

  it('rejects unknown and disposition-mismatched error codes before any database mutation', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'prewrite-error-allowlist', 1)
    const claim = harness.repository.claimNextJob(CONTROLLER)
    if (claim.state !== 'claimed') throw new Error('expected claim')
    const before = readPrewriteRows(harness.database)
    const sentinel = 'UNRECOGNIZED_SECRET_SENTINEL'
    const unknown = harness.repository.finishPrewriteAttempt({
      claim: claim.claim,
      disposition: 'transient_failure',
      safeErrorCode: sentinel
    } as never)
    expect(unknown).toEqual({ state: 'rejected', reason: 'unrecognized_error_code' })
    expect(JSON.stringify(unknown)).not.toContain(sentinel)
    expect(readPrewriteRows(harness.database)).toEqual(before)

    const mismatch = harness.repository.finishPrewriteAttempt({
      claim: claim.claim,
      disposition: 'transient_failure',
      safeErrorCode: 'INVALID_SOURCE_CONFIG'
    } as never)
    expect(mismatch).toEqual({ state: 'rejected', reason: 'error_code_disposition_mismatch' })
    expect(readPrewriteRows(harness.database)).toEqual(before)
  })

  it('rejects stale, expired and post-dispatch pre-write completion without changing rows', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'prewrite-stale', 1)
    const initial = harness.repository.claimNextJob(CONTROLLER)
    if (initial.state !== 'claimed') throw new Error('expected claim')
    const staleSnapshot = readPrewriteRows(harness.database)
    expect(
      harness.repository.finishPrewriteAttempt({
        claim: { ...initial.claim, app_fence: initial.claim.app_fence + 1 },
        disposition: 'transient_failure',
        safeErrorCode: 'NETWORK_ERROR'
      })
    ).toEqual({ state: 'rejected', reason: 'stale_claim' })
    expect(readPrewriteRows(harness.database)).toEqual(staleSnapshot)

    harness.clock.advance(PRODUCT_LEASE_TTL_MS)
    const expiredSnapshot = readPrewriteRows(harness.database)
    expect(
      harness.repository.finishPrewriteAttempt({
        claim: initial.claim,
        disposition: 'transient_failure',
        safeErrorCode: 'NETWORK_ERROR'
      })
    ).toEqual({ state: 'rejected', reason: 'expired_lease' })
    expect(readPrewriteRows(harness.database)).toEqual(expiredSnapshot)

    closeDatabase()
    const dispatched = createHarness()
    seedManualJob(dispatched.database, 'prewrite-dispatched', 1)
    const claim = dispatched.repository.claimNextJob(CONTROLLER)
    if (claim.state !== 'claimed') throw new Error('expected claim')
    dispatched.database
      .prepare("UPDATE product_deploy_job SET state='deploying' WHERE job_id=?")
      .run(claim.claim.job_id)
    dispatched.database
      .prepare(
        "UPDATE product_deploy_attempt SET state='deploying',remote_outcome='unknown' WHERE attempt_id=?"
      )
      .run(claim.claim.attempt_id)
    const dispatchSnapshot = readPrewriteRows(dispatched.database)
    expect(
      dispatched.repository.finishPrewriteAttempt({
        claim: claim.claim,
        disposition: 'transient_failure',
        safeErrorCode: 'GIT_UNAVAILABLE'
      })
    ).toEqual({ state: 'rejected', reason: 'reconciliation_required' })
    expect(readPrewriteRows(dispatched.database)).toEqual(dispatchSnapshot)
  })

  it('preserves a newer auto desired revision and the owner manual pause when superseding pre-write work', () => {
    const harness = createHarness()
    seedAutoJob(harness.database, 'obsolete-prewrite', 1)
    const claim = harness.repository.claimNextJob(CONTROLLER)
    if (claim.state !== 'claimed') throw new Error('expected claim')
    const currentSnapshot = readPrewriteRows(harness.database)
    expect(
      harness.repository.finishPrewriteAttempt({
        claim: claim.claim,
        disposition: 'check_obsolete'
      })
    ).toEqual({ state: 'rejected', reason: 'not_obsolete' })
    expect(readPrewriteRows(harness.database)).toEqual(currentSnapshot)
    harness.database
      .prepare(
        `UPDATE product_desired_branch SET desired_sha=?,desired_observation_sequence=2,
      reconciliation_job_id=NULL,reconciliation_state='pending' WHERE app_id=1`
      )
      .run('2'.repeat(40))
    harness.database
      .prepare(
        `UPDATE product_app_control SET auto_deploy_paused=1,
      pause_reason='manual_action',pause_policy_provenance='explicit' WHERE app_id=1`
      )
      .run()
    const desiredBefore = harness.database
      .prepare('SELECT * FROM product_desired_branch WHERE app_id=1')
      .get()
    const result = harness.repository.finishPrewriteAttempt({
      claim: claim.claim,
      disposition: 'check_obsolete'
    })
    expect(result).toEqual({ state: 'superseded' })
    expect(
      harness.database
        .prepare('SELECT state FROM product_deploy_job WHERE job_id=?')
        .get(claim.claim.job_id)
    ).toEqual({ state: 'superseded' })
    expect(
      harness.database.prepare('SELECT * FROM product_desired_branch WHERE app_id=1').get()
    ).toEqual(desiredBefore)
    expect(
      harness.database
        .prepare('SELECT auto_deploy_paused,pause_reason FROM product_app_control WHERE app_id=1')
        .get()
    ).toEqual({ auto_deploy_paused: 1, pause_reason: 'manual_action' })
  })

  it('does not let double completion release a newer attempt lease', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'prewrite-double', 1)
    const first = harness.repository.claimNextJob(CONTROLLER)
    if (first.state !== 'claimed') throw new Error('expected first claim')
    const finish = (): ReturnType<ProductDeployRepository['finishPrewriteAttempt']> =>
      harness.repository.finishPrewriteAttempt({
        claim: first.claim,
        disposition: 'transient_failure',
        safeErrorCode: 'NETWORK_ERROR'
      })
    expect(finish()).toMatchObject({ state: 'retry_scheduled' })
    harness.clock.value = Date.parse(
      (
        harness.database.prepare('SELECT available_at FROM product_deploy_job').get() as {
          available_at: string
        }
      ).available_at
    )
    const second = harness.repository.claimNextJob(CONTROLLER)
    if (second.state !== 'claimed') throw new Error('expected second claim')
    const secondLease = harness.database
      .prepare('SELECT * FROM product_app_lease WHERE lease_id=?')
      .get(second.claim.app_lease_id)
    expect(finish()).toEqual({ state: 'rejected', reason: 'stale_claim' })
    expect(
      harness.database
        .prepare('SELECT * FROM product_app_lease WHERE lease_id=?')
        .get(second.claim.app_lease_id)
    ).toEqual(secondLease)
    expect(
      (
        harness.database
          .prepare('SELECT released_at FROM product_worker_lease WHERE lease_id=?')
          .get(second.claim.build_slot_lease_id) as { released_at: string | null }
      ).released_at
    ).toBeNull()
  })

  it('rolls back attempt, job, both lease releases and history if a pre-write release fails', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'prewrite-rollback', 1)
    const claim = harness.repository.claimNextJob(CONTROLLER)
    if (claim.state !== 'claimed') throw new Error('expected claim')
    harness.database
      .exec(`CREATE TRIGGER fail_prewrite_build_release BEFORE UPDATE OF released_at ON product_worker_lease
      WHEN NEW.released_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected prewrite release failure'); END`)
    const before = readPrewriteRows(harness.database)
    expect(() =>
      harness.repository.finishPrewriteAttempt({
        claim: claim.claim,
        disposition: 'transient_failure',
        safeErrorCode: 'NETWORK_ERROR'
      })
    ).toThrow(/injected prewrite release failure/)
    expect(readPrewriteRows(harness.database)).toEqual(before)
  })

  it('does not renew an attempt whose durable job outcome changed to uncertain', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'uncertain-heartbeat', 1)
    const result = harness.repository.claimNextJob(CONTROLLER)
    if (result.state !== 'claimed') throw new Error('expected claim')
    harness.database
      .prepare(`UPDATE product_deploy_job SET state='uncertain' WHERE job_id=?`)
      .run(result.claim.job_id)
    harness.database
      .prepare(
        `UPDATE product_deploy_attempt SET state='uncertain', remote_outcome='unknown'
      WHERE attempt_id=?`
      )
      .run(result.claim.attempt_id)

    expect(harness.repository.heartbeatClaim(result.claim)).toEqual({
      state: 'rejected',
      reason: 'stale_claim'
    })
    expect(
      harness.database
        .prepare('SELECT expires_at FROM product_app_lease WHERE lease_id=?')
        .get(result.claim.app_lease_id)
    ).toEqual({ expires_at: result.claim.expires_at })
  })

  it('keeps fences monotonic across released attempts and database reopen; does not claim when controller is inactive', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'fence-job', 1, { maxAttempts: 2 })
    const first = harness.repository.claimNextJob(CONTROLLER)
    if (first.state !== 'claimed') throw new Error('expected first claim')
    harness.database
      .prepare(`UPDATE product_deploy_job SET state='retry_wait', available_at=? WHERE job_id=?`)
      .run(harness.clock.iso(), first.claim.job_id)
    harness.database
      .prepare(`UPDATE product_deploy_attempt SET state='failed', finished_at=? WHERE attempt_id=?`)
      .run(harness.clock.iso(), first.claim.attempt_id)
    harness.database
      .prepare(`UPDATE product_app_lease SET released_at=? WHERE lease_id=?`)
      .run(harness.clock.iso(), first.claim.app_lease_id)
    harness.database
      .prepare(`UPDATE product_worker_lease SET released_at=? WHERE lease_id=?`)
      .run(harness.clock.iso(), first.claim.build_slot_lease_id)

    closeDatabase()
    const reopened = initializeDatabase(testDirectory!)
    const repository = ProductDeployRepository.withClockForTest(reopened, () => harness.clock.value)
    const second = repository.claimNextJob(CONTROLLER)
    expect(second).toMatchObject({
      state: 'claimed',
      claim: { attempt_number: 2, app_fence: 2, build_slot_fence: 2 }
    })
    if (second.state !== 'claimed') throw new Error('expected second claim')
    reopened
      .prepare(`UPDATE product_controller SET status='maintenance' WHERE controller_id=?`)
      .run(CONTROLLER)
    expect(() => repository.claimNextJob(CONTROLLER)).toThrow(/CONTROLLER_NOT_ACTIVE/)
    expect(repository.heartbeatClaim(second.claim)).toEqual({
      state: 'rejected',
      reason: 'controller_inactive'
    })
  })

  it('rolls back lease rows and fence increments if attempt creation fails', () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'rollback-job', 1)
    harness.database.exec(`CREATE TRIGGER fail_claim_attempt BEFORE INSERT ON product_deploy_attempt
      BEGIN SELECT RAISE(ABORT, 'injected attempt insert failure'); END`)

    expect(() => harness.repository.claimNextJob(CONTROLLER)).toThrow(
      /injected attempt insert failure/
    )
    expect(count(harness.database, 'product_app_lease')).toBe(0)
    expect(count(harness.database, 'product_worker_lease')).toBe(0)
    expect(count(harness.database, 'product_deploy_attempt')).toBe(0)
    expect(count(harness.database, 'product_app_fence')).toBe(0)
    expect(
      harness.database
        .prepare('SELECT state,attempt_count FROM product_deploy_job WHERE job_id=?')
        .get('rollback-job')
    ).toEqual({ state: 'queued', attempt_count: 0 })
  })

  it('serializes two real Node worker processes claiming the same file-backed SQLite queue', async () => {
    const harness = createHarness()
    seedManualJob(harness.database, 'contended-job', 1)
    const databasePath = join(testDirectory!, 'opspilot.db')
    closeDatabase()

    const readyOne = join(testDirectory!, 'worker-one.ready')
    const readyTwo = join(testDirectory!, 'worker-two.ready')
    const go = join(testDirectory!, 'go')
    const resultOne = join(testDirectory!, 'worker-one.result')
    const resultTwo = join(testDirectory!, 'worker-two.result')
    const workerSource = `
      const fs=require('node:fs');
      const ts=require('typescript');
      require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
        compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
      }).outputText,f);
      const [dbPath,readyPath,goPath,resultPath]=process.argv.slice(1);
      fs.writeFileSync(readyPath,'ready');
      const wait=new Int32Array(new SharedArrayBuffer(4));
      while(!fs.existsSync(goPath)) Atomics.wait(wait,0,0,5);
      const Database=require('better-sqlite3');
      const db=new Database(dbPath); db.pragma('foreign_keys=ON'); db.pragma('busy_timeout=10000');
      const {ProductDeployRepository}=require('./src/main/db/productDeployRepository.ts');
      const result=ProductDeployRepository.withClockForTest(
        db,()=>Date.parse('2026-10-22T12:00:00.000Z')
      ).claimNextJob('${CONTROLLER}');
      fs.writeFileSync(resultPath,JSON.stringify(result)); db.close();
    `
    const children = [
      spawn(process.execPath, ['-e', workerSource, databasePath, readyOne, go, resultOne], {
        cwd: join(process.cwd()),
        stdio: 'ignore'
      }),
      spawn(process.execPath, ['-e', workerSource, databasePath, readyTwo, go, resultTwo], {
        cwd: join(process.cwd()),
        stdio: 'ignore'
      })
    ]
    try {
      await waitFor(() => existsSync(readyOne) && existsSync(readyTwo))
      writeFileSync(go, 'go')
      await Promise.all(children.map((child) => waitForChild(child)))
      const outcomes = [
        JSON.parse(readFileSync(resultOne, 'utf8')),
        JSON.parse(readFileSync(resultTwo, 'utf8'))
      ]
      expect(outcomes).toHaveLength(2)
      expect(outcomes.filter((outcome) => outcome.state === 'claimed')).toHaveLength(1)
      expect(
        outcomes.filter(
          (outcome) =>
            outcome.state === 'none' ||
            (outcome.state === 'blocked' && outcome.reason === 'build_slot_busy')
        )
      ).toHaveLength(1)
      const verify = new Database(databasePath)
      expect(verify.prepare('SELECT COUNT(*) AS count FROM product_deploy_attempt').get()).toEqual({
        count: 1
      })
      expect(
        verify
          .prepare('SELECT COUNT(*) AS count FROM product_worker_lease WHERE released_at IS NULL')
          .get()
      ).toEqual({ count: 1 })
      verify.close()
    } finally {
      writeFileSync(go, 'stop')
      for (const child of children) if (child.exitCode === null) child.kill()
    }
  })

  it('verifies Git snapshot identity and commits one durable dispatch marker without moving the live pointer', () => {
    const harness = createDispatchReadyHarness()
    const { claim, snapshot } = harness
    expect(harness.repository.markGitSnapshotVerified(claim, snapshot)).toEqual({
      state: 'snapshot_verified'
    })
    expect(harness.database.prepare('SELECT state FROM product_deploy_attempt').get()).toEqual({
      state: 'snapshot_verified'
    })

    const result = harness.repository.beginGitDispatch(claim, snapshot)
    expect(result).toMatchObject({
      state: 'dispatch_authorized',
      version: 1,
      image_tag: 'claim-app-1:v1'
    })
    expect(
      harness.database
        .prepare('SELECT id,version,status,git_repo_url,git_commit_sha FROM deployment')
        .get()
    ).toMatchObject({
      id: (result as { deployment_id: number }).deployment_id,
      version: 1,
      status: 'building',
      git_repo_url: snapshot.repositoryUrl,
      git_commit_sha: snapshot.commitSha
    })
    expect(
      harness.database
        .prepare('SELECT state,remote_outcome,deployment_id FROM product_deploy_attempt')
        .get()
    ).toMatchObject({
      state: 'deploying',
      remote_outcome: 'unknown',
      deployment_id: (result as { deployment_id: number }).deployment_id
    })
    expect(harness.database.prepare('SELECT state FROM product_deploy_job').get()).toEqual({
      state: 'deploying'
    })
    expect(harness.database.prepare('SELECT kind FROM product_history_event').all()).toEqual([
      { kind: 'git_snapshot_metadata_matched' },
      { kind: 'remote_dispatch_marker_committed' }
    ])
    expect(
      harness.database.prepare('SELECT current_deployment_id FROM app WHERE id=1').get()
    ).toEqual({
      current_deployment_id: null
    })
    expect(harness.database.prepare('SELECT released_at FROM product_app_lease').get()).toEqual({
      released_at: null
    })
  })

  it('rejects repository/root/SHA/config mismatches without mutating durable rows', () => {
    for (const [field, value] of [
      ['repositoryUrl', 'https://attacker.test/wrong.git'],
      ['repositoryRoot', 'subdir'],
      ['commitSha', '2'.repeat(40)],
      ['sourceConfigSha256', 'b'.repeat(64)]
    ] as const) {
      const harness = createDispatchReadyHarness()
      const badSnapshot = { ...harness.snapshot, [field]: value }
      const before = readDispatchRows(harness.database)
      expect(harness.repository.markGitSnapshotVerified(harness.claim, badSnapshot)).toEqual({
        state: 'rejected',
        reason: 'snapshot_mismatch'
      })
      expect(readDispatchRows(harness.database)).toEqual(before)
      closeDatabase()
    }
  })

  it('rejects stale and expired dispatch tokens without changing rows', () => {
    const stale = createDispatchReadyHarness()
    const staleToken = { ...stale.claim, app_fence: stale.claim.app_fence + 1 }
    const beforeStale = readDispatchRows(stale.database)
    expect(stale.repository.markGitSnapshotVerified(staleToken, stale.snapshot)).toMatchObject({
      state: 'rejected'
    })
    expect(readDispatchRows(stale.database)).toEqual(beforeStale)

    closeDatabase()
    const expired = createDispatchReadyHarness()
    expired.repository.markGitSnapshotVerified(expired.claim, expired.snapshot)
    expired.clock.advance(PRODUCT_LEASE_TTL_MS)
    const beforeExpired = readDispatchRows(expired.database)
    expect(expired.repository.beginGitDispatch(expired.claim, expired.snapshot)).toEqual({
      state: 'rejected',
      reason: 'expired_lease'
    })
    expect(readDispatchRows(expired.database)).toEqual(beforeExpired)
  })

  it('blocks auto dispatch when desired SHA changes or current owner pauses', () => {
    const changed = createDispatchReadyHarness('branch_poll')
    changed.repository.markGitSnapshotVerified(changed.claim, changed.snapshot)
    changed.database
      .prepare('UPDATE product_desired_branch SET desired_sha=? WHERE app_id=1')
      .run('2'.repeat(40))
    const changedBefore = readDispatchRows(changed.database)
    expect(changed.repository.beginGitDispatch(changed.claim, changed.snapshot)).toEqual({
      state: 'rejected',
      reason: 'desired_changed'
    })
    expect(readDispatchRows(changed.database)).toEqual(changedBefore)

    closeDatabase()
    const paused = createDispatchReadyHarness('branch_poll')
    paused.repository.markGitSnapshotVerified(paused.claim, paused.snapshot)
    paused.database
      .prepare(
        "UPDATE product_app_control SET auto_deploy_paused=1,pause_reason='operator',pause_policy_provenance='explicit' WHERE app_id=1"
      )
      .run()
    const pausedBefore = readDispatchRows(paused.database)
    expect(paused.repository.beginGitDispatch(paused.claim, paused.snapshot)).toEqual({
      state: 'rejected',
      reason: 'auto_paused'
    })
    expect(readDispatchRows(paused.database)).toEqual(pausedBefore)
  })

  it('rejects auto snapshot preparation when desired state is obsolete or paused', () => {
    const obsolete = createDispatchReadyHarness('branch_poll')
    obsolete.database
      .prepare('UPDATE product_desired_branch SET desired_sha=? WHERE app_id=1')
      .run('2'.repeat(40))
    expect(obsolete.repository.readGitSnapshotAuthority(obsolete.claim)).toEqual({
      state: 'rejected',
      reason: 'snapshot_state_invalid'
    })

    closeDatabase()
    const paused = createDispatchReadyHarness('branch_poll')
    paused.database
      .prepare(
        "UPDATE product_app_control SET auto_deploy_paused=1,pause_reason='operator',pause_policy_provenance='explicit' WHERE app_id=1"
      )
      .run()
    expect(paused.repository.readGitSnapshotAuthority(paused.claim)).toEqual({
      state: 'rejected',
      reason: 'snapshot_state_invalid'
    })
  })

  it('blocks dispatch when uncertain work exists or ownership/config identity changes', () => {
    const uncertain = createDispatchReadyHarness()
    uncertain.repository.markGitSnapshotVerified(uncertain.claim, uncertain.snapshot)
    seedJob(uncertain.database, 'uncertain-peer', 1, 'manual_redeploy', { state: 'uncertain' })
    const before = readDispatchRows(uncertain.database)
    expect(uncertain.repository.beginGitDispatch(uncertain.claim, uncertain.snapshot)).toEqual({
      state: 'reconciliation_required',
      reason: 'uncertain_work'
    })
    expect(readDispatchRows(uncertain.database)).toEqual(before)

    closeDatabase()
    const staleIdentity = createDispatchReadyHarness()
    staleIdentity.repository.markGitSnapshotVerified(staleIdentity.claim, staleIdentity.snapshot)
    staleIdentity.database
      .prepare('UPDATE vps SET archived_at=? WHERE id=1')
      .run('2026-10-22T12:00:01.000Z')
    const staleBefore = readDispatchRows(staleIdentity.database)
    expect(
      staleIdentity.repository.beginGitDispatch(staleIdentity.claim, staleIdentity.snapshot)
    ).toMatchObject({
      state: 'rejected',
      reason: 'ownership_changed'
    })
    expect(readDispatchRows(staleIdentity.database)).toEqual(staleBefore)
  })

  it('returns reconciliation-required after marker, including reopen, and never retries prewrite or dispatch', () => {
    const harness = createDispatchReadyHarness()
    harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
    const first = harness.repository.beginGitDispatch(harness.claim, harness.snapshot)
    expect(first.state).toBe('dispatch_authorized')
    if (first.state !== 'dispatch_authorized') throw new Error('expected dispatch authorization')
    expect(
      harness.repository.readGitDispatchSessionAuthority(harness.claim, first.deployment_id)
    ).toBe('ready')
    const afterMarker = readDispatchRows(harness.database)
    expect(harness.repository.beginGitDispatch(harness.claim, harness.snapshot)).toEqual({
      state: 'reconciliation_required',
      reason: 'dispatch_marker_exists'
    })
    expect(
      harness.repository.finishPrewriteAttempt({
        claim: harness.claim,
        disposition: 'transient_failure',
        safeErrorCode: 'NETWORK_ERROR'
      })
    ).toEqual({ state: 'rejected', reason: 'reconciliation_required' })
    closeDatabase()
    const reopened = initializeDatabase(testDirectory!)
    const repository = ProductDeployRepository.withClockForTest(reopened, () => NOW)
    expect(repository.readGitDispatchSessionAuthority(harness.claim, first.deployment_id)).toBe(
      'ready'
    )
    expect(repository.beginGitDispatch(harness.claim, harness.snapshot)).toEqual({
      state: 'reconciliation_required',
      reason: 'dispatch_marker_exists'
    })
    expect(
      repository.finishPrewriteAttempt({
        claim: harness.claim,
        disposition: 'transient_failure',
        safeErrorCode: 'NETWORK_ERROR'
      })
    ).toEqual({ state: 'rejected', reason: 'reconciliation_required' })
    expect(readDispatchRows(reopened)).toEqual(afterMarker)
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({ count: 1 })
  })

  it('commits canonical dispatch before opening the channel and never opens again after marker', async () => {
    const harness = createDispatchReadyHarness()
    harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
    let channelOpens = 0
    const ssh = {
      async openGuardedExecutionChannelWithIdentity() {
        channelOpens += 1
        expect(
          harness.database
            .prepare('SELECT state FROM product_deploy_job WHERE job_id=?')
            .get(harness.claim.job_id)
        ).toEqual({ state: 'deploying' })
        expect(
          (
            harness.database.prepare('SELECT COUNT(*) AS count FROM deployment').get() as {
              count: number
            }
          ).count
        ).toBe(1)
        return {
          channel: createFakeGuardedChannel(),
          identity: {
            vpsId: 1,
            host: 'claim.example.test',
            port: 2222,
            hostFingerprint: TARGET_PIN,
            username: 'deploy',
            authType: 'key'
          }
        }
      }
    }
    const prepared = {
      claim: harness.claim,
      metadata: harness.snapshot,
      rootDirectory: '/scratch/repo',
      snapshotDirectory: '/scratch/snapshot',
      cleanup() {
        return undefined
      }
    }
    const options = {
      vps_id: 1,
      target_helper_path: '/opt/opspilot/target_guarded_ssh_helper.py',
      target_state_root: '/var/lib/opspilot/target-guard'
    }
    const session = await openProductGuardedSshSession(
      harness.repository,
      ssh as never,
      prepared,
      options
    )
    expect(session.deploymentId).toBe(1)
    await session.authorizeWritePhase('prepare')
    await session.authorizeWritePhase('build')
    await session.close()
    expect(session.state).toBe('closed')
    expect(
      harness.database.prepare('SELECT remote_outcome FROM product_deploy_attempt').get()
    ).toEqual({
      remote_outcome: 'unknown'
    })
    await expect(
      openProductGuardedSshSession(harness.repository, ssh as never, prepared, options)
    ).rejects.toMatchObject({ code: 'SSH_DISPATCH_RECONCILIATION_REQUIRED' })
    expect(channelOpens).toBe(1)
    expect(
      (
        harness.database.prepare('SELECT COUNT(*) AS count FROM deployment').get() as {
          count: number
        }
      ).count
    ).toBe(1)
  })

  it('stops a phase when Product lease authority expires during the guarded session', async () => {
    const harness = createDispatchReadyHarness()
    harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
    const channel = createFakeGuardedChannel()
    const session = await openProductGuardedSshSession(
      harness.repository,
      {
        async openGuardedExecutionChannelWithIdentity() {
          return {
            channel,
            identity: {
              vpsId: 1,
              host: 'claim.example.test',
              port: 2222,
              hostFingerprint: TARGET_PIN,
              username: 'deploy',
              authType: 'key'
            }
          }
        }
      } as never,
      {
        claim: harness.claim,
        metadata: harness.snapshot,
        rootDirectory: '/scratch/repo',
        snapshotDirectory: '/scratch/snapshot',
        cleanup() {
          return undefined
        }
      },
      {
        vps_id: 1,
        target_helper_path: '/opt/opspilot/target_guarded_ssh_helper.py',
        target_state_root: '/var/lib/opspilot/target-guard'
      }
    )
    harness.clock.advance(61_000)
    await expect(session.authorizeWritePhase('build')).rejects.toMatchObject({
      code: 'SSH_AUTHORITY_STALE'
    })
    expect(session.state).toBe('reconciliation_required')
    expect(
      harness.database.prepare('SELECT remote_outcome FROM product_deploy_attempt').get()
    ).toEqual({
      remote_outcome: 'unknown'
    })
    expect(channel.destroyed).toBe(true)
  })

  it('rejects an expected VPS mismatch before the dispatch marker or channel open', async () => {
    const harness = createDispatchReadyHarness()
    harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
    let opens = 0
    await expect(
      openProductGuardedSshSession(
        harness.repository,
        {
          async openGuardedExecutionChannelWithIdentity() {
            opens += 1
            throw new Error('unexpected')
          }
        } as never,
        preparedSnapshot(harness),
        {
          vps_id: 2,
          target_helper_path: '/opt/opspilot/helper.py',
          target_state_root: '/var/lib/opspilot/guard'
        }
      )
    ).rejects.toMatchObject({ code: 'SSH_DISPATCH_REJECTED' })
    expect(opens).toBe(0)
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({
      count: 0
    })
    expect(
      harness.database.prepare('SELECT state,remote_outcome FROM product_deploy_attempt').get()
    ).toMatchObject({
      state: 'snapshot_verified',
      remote_outcome: 'not_started'
    })
  })

  it('does not send open when the lease expires during asynchronous SSH channel open', async () => {
    const harness = createDispatchReadyHarness()
    harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
    const channel = createFakeGuardedChannel()
    let entered!: () => void
    let release!: () => void
    const openEntered = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ssh = {
      async openGuardedExecutionChannelWithIdentity() {
        entered()
        await gate
        return {
          channel,
          identity: {
            vpsId: 1,
            host: 'claim.example.test',
            port: 2222,
            hostFingerprint: TARGET_PIN,
            username: 'deploy',
            authType: 'key'
          }
        }
      }
    }
    const opening = openProductGuardedSshSession(
      harness.repository,
      ssh as never,
      preparedSnapshot(harness),
      {
        vps_id: 1,
        target_helper_path: '/opt/opspilot/helper.py',
        target_state_root: '/var/lib/opspilot/guard'
      }
    )
    await openEntered
    harness.clock.advance(PRODUCT_LEASE_TTL_MS)
    release()
    await expect(opening).rejects.toMatchObject({ code: 'SSH_AUTHORITY_STALE' })
    expect(channel.receivedOperations).toEqual([])
    expect(channel.destroyed).toBe(true)
    expect(
      harness.database.prepare('SELECT state,remote_outcome FROM product_deploy_attempt').get()
    ).toMatchObject({
      state: 'deploying',
      remote_outcome: 'unknown'
    })
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({
      count: 1
    })
  })

  it('rejects an opened connection whose resolved endpoint or verified pin differs from SQLite', async () => {
    for (const identity of [
      { vpsId: 1, host: 'other.example.test', port: 2222, hostFingerprint: TARGET_PIN, username: 'deploy', authType: 'key' as const },
      {
        vpsId: 1,
        host: 'claim.example.test',
        port: 2222,
        hostFingerprint: `SHA256:${'B'.repeat(43)}`,
        username: 'deploy',
        authType: 'key' as const
      },
      {
        vpsId: 1,
        host: 'claim.example.test',
        port: 2222,
        hostFingerprint: TARGET_PIN,
        username: 'principal-old',
        authType: 'password' as const
      }
    ]) {
      const harness = createDispatchReadyHarness()
      harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
      const channel = createFakeGuardedChannel()
      await expect(
        openProductGuardedSshSession(
          harness.repository,
          {
            async openGuardedExecutionChannelWithIdentity() {
              return { channel, identity }
            }
          } as never,
          preparedSnapshot(harness),
          {
            vps_id: 1,
            target_helper_path: '/opt/opspilot/helper.py',
            target_state_root: '/var/lib/opspilot/guard'
          }
        )
      ).rejects.toMatchObject({ code: 'SSH_AUTHORITY_STALE' })
      expect(channel.receivedOperations).toEqual([])
      expect(channel.destroyed).toBe(true)
      expect(harness.database.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({
        count: 1
      })
      closeDatabase()
    }
  })

  it('rejects target profile or app target changes during channel open without sending open', async () => {
    for (const change of ['profile', 'app_target', 'source'] as const) {
      const harness = createDispatchReadyHarness()
      harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
      const channel = createFakeGuardedChannel()
      let entered!: () => void
      let release!: () => void
      const openEntered = new Promise<void>((resolve) => {
        entered = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const ssh = {
        async openGuardedExecutionChannelWithIdentity() {
          entered()
          await gate
          return {
            channel,
            identity: {
              vpsId: 1,
              host: 'claim.example.test',
              port: 2222,
              hostFingerprint: TARGET_PIN,
              username: 'deploy',
              authType: 'key'
            }
          }
        }
      }
      const opening = openProductGuardedSshSession(
        harness.repository,
        ssh as never,
        preparedSnapshot(harness),
        {
          vps_id: 1,
          target_helper_path: '/opt/opspilot/helper.py',
          target_state_root: '/var/lib/opspilot/guard'
        }
      )
      await openEntered
      if (change === 'profile') {
        new VpsRepository(harness.database).update(1, { host: 'changed.example.test' })
      } else if (change === 'app_target') {
        harness.database.prepare('UPDATE app SET vps_id=2 WHERE id=1').run()
      } else {
        harness.database
          .prepare(
            "INSERT INTO product_source_config (app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at) VALUES (1,2,'https://example.test/repo.git','main','.','{}',?,'created')"
          )
          .run('b'.repeat(64))
        harness.database
          .prepare(
            'UPDATE product_app_control SET source_generation=2,source_config_sha256=? WHERE app_id=1'
          )
          .run('b'.repeat(64))
      }
      release()
      await expect(opening).rejects.toMatchObject({ code: 'SSH_AUTHORITY_STALE' })
      expect(channel.receivedOperations).toEqual([])
      expect(channel.destroyed).toBe(true)
      expect(harness.database.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({
        count: 1
      })
      closeDatabase()
    }
  })

  it('invalidates same-second username, auth-method and credential changes during channel open', async () => {
    const changes = [
      { patch: { username: 'principal-new' }, actual: { username: 'deploy', authType: 'key' as const } },
      { patch: { auth_type: 'password' as const }, actual: { username: 'deploy', authType: 'key' as const } },
      {
        patch: {
          credential: {
            crypto_scheme: 'aes_256_gcm' as const,
            encrypted_secret: Buffer.from('rotated-ciphertext'),
            iv: Buffer.alloc(12, 3),
            auth_tag: Buffer.alloc(16, 4)
          }
        },
        actual: { username: 'deploy', authType: 'key' as const }
      }
    ]
    for (const { patch: securityPatch, actual } of changes) {
      const harness = createDispatchReadyHarness()
      harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
      const channel = createFakeGuardedChannel()
      let entered!: () => void
      let release!: () => void
      const openEntered = new Promise<void>((resolve) => { entered = resolve })
      const gate = new Promise<void>((resolve) => { release = resolve })
      const ssh = {
        async openGuardedExecutionChannelWithIdentity() {
          entered()
          await gate
          return {
            channel,
            identity: {
              vpsId: 1,
              host: 'claim.example.test',
              port: 2222,
              hostFingerprint: TARGET_PIN,
              ...actual
            }
          }
        }
      }
      const before = harness.database
        .prepare('SELECT updated_at,ssh_security_revision FROM vps WHERE id=1')
        .get() as { updated_at: string | null; ssh_security_revision: number }
      harness.database.exec(`CREATE TRIGGER freeze_profile_updated_at AFTER UPDATE OF
        username,auth_type,encrypted_secret,crypto_scheme,iv,auth_tag ON vps
        WHEN NEW.id=1 BEGIN UPDATE vps SET updated_at='fixed-same-second' WHERE id=NEW.id; END`)
      const opening = openProductGuardedSshSession(
        harness.repository,
        ssh as never,
        preparedSnapshot(harness),
        {
          vps_id: 1,
          target_helper_path: '/opt/opspilot/helper.py',
          target_state_root: '/var/lib/opspilot/guard'
        }
      )
      await openEntered
      const vpsRepository = new VpsRepository(harness.database)
      vpsRepository.update(1, securityPatch)
      const after = harness.database
        .prepare('SELECT updated_at,ssh_security_revision FROM vps WHERE id=1')
        .get() as { updated_at: string | null; ssh_security_revision: number }
      expect(after.updated_at).toBe('fixed-same-second')
      expect(after.ssh_security_revision).toBe(before.ssh_security_revision + 1)
      release()
      await expect(opening).rejects.toMatchObject({ code: 'SSH_AUTHORITY_STALE' })
      expect(channel.receivedOperations).toEqual([])
      expect(channel.destroyed).toBe(true)
      expect(harness.database.prepare('SELECT remote_outcome FROM product_deploy_attempt').get()).toEqual({
        remote_outcome: 'unknown'
      })
      expect(harness.database.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({ count: 1 })
      closeDatabase()
    }
  })

  it('revokes the next phase after SSH profile edits but ignores last_seen/status telemetry', async () => {
    const changed = createDispatchReadyHarness()
    changed.repository.markGitSnapshotVerified(changed.claim, changed.snapshot)
    const changedChannel = createFakeGuardedChannel()
    const changedSession = await openProductGuardedSshSession(
      changed.repository,
      { async openGuardedExecutionChannelWithIdentity() {
        return { channel: changedChannel, identity: { vpsId: 1, host: 'claim.example.test', port: 2222,
          hostFingerprint: TARGET_PIN, username: 'deploy', authType: 'key' } }
      } } as never,
      preparedSnapshot(changed),
      { vps_id: 1, target_helper_path: '/opt/opspilot/helper.py', target_state_root: '/var/lib/opspilot/guard' }
    )
    new VpsRepository(changed.database).update(1, { username: 'principal-new' })
    await expect(changedSession.authorizeWritePhase('build')).rejects.toMatchObject({ code: 'SSH_AUTHORITY_STALE' })
    expect(changedChannel.receivedOperations).toEqual(['open'])
    expect(changedChannel.destroyed).toBe(true)
    expect(changed.database.prepare('SELECT remote_outcome FROM product_deploy_attempt').get()).toEqual({ remote_outcome: 'unknown' })

    closeDatabase()
    const telemetry = createDispatchReadyHarness()
    telemetry.repository.markGitSnapshotVerified(telemetry.claim, telemetry.snapshot)
    const telemetryChannel = createFakeGuardedChannel()
    const telemetrySession = await openProductGuardedSshSession(
      telemetry.repository,
      { async openGuardedExecutionChannelWithIdentity() {
        return { channel: telemetryChannel, identity: { vpsId: 1, host: 'claim.example.test', port: 2222,
          hostFingerprint: TARGET_PIN, username: 'deploy', authType: 'key' } }
      } } as never,
      preparedSnapshot(telemetry),
      { vps_id: 1, target_helper_path: '/opt/opspilot/helper.py', target_state_root: '/var/lib/opspilot/guard' }
    )
    new VpsRepository(telemetry.database).update(1, {
      last_status: 'online', last_seen_at: new Date().toISOString()
    })
    await telemetrySession.authorizeWritePhase('build')
    expect(telemetryChannel.receivedOperations).toEqual(['open', 'authorize_phase'])
    expect(telemetrySession.state).toBe('active')
    await telemetrySession.close()
  })

  it('blocks later phases after the app target changes, preserving the one held session lock', async () => {
    const harness = createDispatchReadyHarness()
    harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
    const channel = createFakeGuardedChannel()
    const session = await openProductGuardedSshSession(
      harness.repository,
      {
        async openGuardedExecutionChannelWithIdentity() {
          return {
            channel,
            identity: {
              vpsId: 1,
              host: 'claim.example.test',
              port: 2222,
              hostFingerprint: TARGET_PIN,
              username: 'deploy',
              authType: 'key'
            }
          }
        }
      } as never,
      preparedSnapshot(harness),
      {
        vps_id: 1,
        target_helper_path: '/opt/opspilot/helper.py',
        target_state_root: '/var/lib/opspilot/guard'
      }
    )
    expect(channel.receivedOperations).toEqual(['open'])
    harness.database.prepare('UPDATE app SET vps_id=2 WHERE id=1').run()
    await expect(session.authorizeWritePhase('build')).rejects.toMatchObject({
      code: 'SSH_AUTHORITY_STALE'
    })
    expect(channel.receivedOperations).toEqual(['open'])
    expect(channel.destroyed).toBe(true)
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({
      count: 1
    })
  })

  it('serializes two real workers so only one can obtain the dispatch result', async () => {
    const harness = createDispatchReadyHarness()
    harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
    const databasePath = join(testDirectory!, 'opspilot.db')
    const readyOne = join(testDirectory!, 'dispatch-one.ready')
    const readyTwo = join(testDirectory!, 'dispatch-two.ready')
    const go = join(testDirectory!, 'dispatch.go')
    const resultOne = join(testDirectory!, 'dispatch-one.result')
    const resultTwo = join(testDirectory!, 'dispatch-two.result')
    const claim = JSON.stringify(harness.claim)
    const snapshot = JSON.stringify(harness.snapshot)
    closeDatabase()
    const source = `
      const fs=require('node:fs'); const ts=require('typescript');
      require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
        compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
      }).outputText,f);
      const [dbPath,ready,goPath,resultPath]=process.argv.slice(1);
      fs.writeFileSync(ready,'ready'); const wait=new Int32Array(new SharedArrayBuffer(4));
      const deadline=Date.now()+8000; while(!fs.existsSync(goPath) && Date.now()<deadline) Atomics.wait(wait,0,0,5);
      if(!fs.existsSync(goPath)) process.exit(4);
      const Database=require('better-sqlite3'); const db=new Database(dbPath); db.pragma('foreign_keys=ON'); db.pragma('busy_timeout=10000');
      const {ProductDeployRepository}=require('./src/main/db/productDeployRepository.ts');
      const repo=ProductDeployRepository.withClockForTest(db,()=>${NOW});
      const result=repo.beginGitDispatch(${claim},${snapshot}); fs.writeFileSync(resultPath,JSON.stringify(result)); db.close();
    `
    const children = [
      spawn(process.execPath, ['-e', source, databasePath, readyOne, go, resultOne], {
        cwd: process.cwd(),
        stdio: 'ignore'
      }),
      spawn(process.execPath, ['-e', source, databasePath, readyTwo, go, resultTwo], {
        cwd: process.cwd(),
        stdio: 'ignore'
      })
    ]
    try {
      await waitFor(() => existsSync(readyOne) && existsSync(readyTwo))
      writeFileSync(go, 'dispatch')
      await Promise.all(children.map(waitForChild))
      const outcomes = [
        JSON.parse(readFileSync(resultOne, 'utf8')),
        JSON.parse(readFileSync(resultTwo, 'utf8'))
      ]
      expect(outcomes.filter((item) => item.state === 'dispatch_authorized')).toHaveLength(1)
      expect(outcomes.filter((item) => item.state === 'reconciliation_required')).toHaveLength(1)
      const verify = new Database(databasePath)
      expect(verify.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({ count: 1 })
      expect(
        verify
          .prepare(
            "SELECT COUNT(*) AS count FROM product_history_event WHERE kind='remote_dispatch_marker_committed'"
          )
          .get()
      ).toEqual({ count: 1 })
      verify.close()
    } finally {
      writeFileSync(go, 'stop')
      for (const child of children) if (child.exitCode === null) child.kill()
    }
  })

  it('rolls back deployment version, link, state and history if any dispatch write fails', () => {
    const harness = createDispatchReadyHarness()
    harness.repository.markGitSnapshotVerified(harness.claim, harness.snapshot)
    harness.database
      .exec(`CREATE TRIGGER fail_product_dispatch_history BEFORE INSERT ON product_history_event
      WHEN NEW.kind='remote_dispatch_marker_committed' BEGIN SELECT RAISE(ABORT,'injected dispatch history failure'); END`)
    const before = readDispatchRows(harness.database)
    expect(() => harness.repository.beginGitDispatch(harness.claim, harness.snapshot)).toThrow(
      /injected dispatch history failure/
    )
    expect(readDispatchRows(harness.database)).toEqual(before)
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({
      count: 0
    })
    expect(
      harness.database.prepare('SELECT MAX(version) AS max FROM deployment WHERE app_id=1').get()
    ).toEqual({ max: null })
  })

  it('blocks manual rollback from Git snapshot and dispatch operations', () => {
    const harness = createHarness()
    harness.database
      .prepare(
        `INSERT INTO deployment(app_id,version,image_tag,status) VALUES(1,1,'claim-app-1:v1','running')`
      )
      .run()
    const targetId = Number(
      (harness.database.prepare('SELECT id FROM deployment').get() as { id: number }).id
    )
    harness.database
      .prepare(
        `INSERT INTO product_deploy_job
      (job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
       trigger,idempotency_key,ref,target_sha,target_deployment_id,state,attempt_count,max_attempts,available_at,created_at,updated_at)
       VALUES('rollback-job','${CONTROLLER}',1,1,1,'${HASH}','manual_rollback','manual:rollback','main','${SHA_A}',?,'queued',0,3,'${new Date(NOW).toISOString()}','${new Date(NOW).toISOString()}','${new Date(NOW).toISOString()}')`
      )
      .run(targetId)
    expect(harness.repository.claimNextJob(CONTROLLER)).toEqual({
      state: 'blocked',
      reason: 'unsupported_trigger'
    })
    expect(count(harness.database, 'product_deploy_attempt')).toBe(0)
  })
})

function createHarness(jitter: () => number = () => 0): {
  database: ReturnType<typeof initializeDatabase>
  repository: ProductDeployRepository
  clock: { value: number; advance: (milliseconds: number) => void; iso: () => string }
} {
  if (testDirectory) {
    closeDatabase()
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-product-claim-'))
  const database = initializeDatabase(testDirectory)
  database.exec(`
    INSERT INTO vps (id,name,host,port,host_fingerprint,username,auth_type,encrypted_secret)
      VALUES (1,'claim-vps','claim.example.test',2222,'${TARGET_PIN}','deploy','key',X'00'),
             (2,'other-vps','other.example.test',2222,'${TARGET_PIN}','deploy','key',X'00');
    INSERT INTO app (id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
      VALUES (1,1,'claim-app-1','express',30001,3000,'git','https://example.test/repo.git','main','.'),
             (2,1,'claim-app-2','express',30002,3000,'git','https://example.test/other.git','main','.');
    INSERT INTO product_controller VALUES ('${CONTROLLER}','created','active');
    INSERT INTO product_source_config VALUES
      (1,1,'https://example.test/repo.git','main','.','{}','${HASH}','created'),
      (2,1,'https://example.test/other.git','main','.','{}','${HASH}','created');
    INSERT INTO product_app_control
      (app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at)
      VALUES (1,'product','${CONTROLLER}',1,1,'${HASH}','created'),
             (2,'product','${CONTROLLER}',1,1,'${HASH}','created');
  `)
  const clock = {
    value: NOW,
    advance(milliseconds: number) {
      this.value += milliseconds
    },
    iso() {
      return new Date(this.value).toISOString()
    }
  }
  return {
    database,
    repository: ProductDeployRepository.withClockForTest(database, () => clock.value, jitter),
    clock
  }
}

function preparedSnapshot(
  harness: ReturnType<typeof createDispatchReadyHarness>
): PreparedProductGitSnapshot {
  return {
    claim: harness.claim,
    metadata: harness.snapshot,
    rootDirectory: '/scratch/repo',
    snapshotDirectory: '/scratch/snapshot',
    cleanup() {
      return undefined
    }
  }
}

function createDispatchReadyHarness(
  trigger: 'manual_redeploy' | 'branch_poll' = 'manual_redeploy'
): ReturnType<typeof createHarness> & {
  claim: import('../../../../docs/contracts/product-auto-deploy').ProductClaimToken
  snapshot: import('../../../../docs/contracts/product-auto-deploy').ProductGitSnapshotMetadata
} {
  const harness = createHarness()
  if (trigger === 'branch_poll') seedAutoJob(harness.database, 'dispatch-job', 1)
  else seedManualJob(harness.database, 'dispatch-job', 1)
  const claimed = harness.repository.claimNextJob(CONTROLLER)
  if (claimed.state !== 'claimed') throw new Error('expected dispatch claim')
  return {
    ...harness,
    claim: claimed.claim,
    snapshot: {
      repositoryUrl: 'https://example.test/repo.git',
      repositoryRoot: '.',
      commitSha: SHA_A,
      sourceConfigSha256: HASH
    }
  }
}

function createFakeGuardedChannel(): Duplex & { receivedOperations: string[] } {
  const receivedOperations: string[] = []
  const channel = new Duplex({
    read() {
      this.push(Buffer.alloc(0))
    },
    write(chunk, _encoding, callback) {
      const frame = Buffer.from(chunk)
      const size = frame.readUInt32BE(0)
      const request = JSON.parse(frame.subarray(4, 4 + size).toString('utf8')) as {
        request_id: string
        sequence: number
        deployment_id: number
        operation: string
      }
      receivedOperations.push(request.operation)
      const response = encodeGuardedSshFrame({
        version: 1,
        request_id: request.request_id,
        sequence: request.sequence,
        state: 'accepted',
        deployment_id: request.deployment_id
      })
      queueMicrotask(() => {
        this.push(response)
        if (JSON.parse(frame.subarray(4, 4 + size).toString('utf8')).operation === 'close') {
          this.push(null)
          this.emit('close')
        }
      })
      callback()
    },
    final(callback) {
      this.push(null)
      callback()
    }
  })
  Object.defineProperty(channel, 'stderr', { value: new PassThrough() })
  Object.defineProperty(channel, 'receivedOperations', { value: receivedOperations })
  return channel as Duplex & { receivedOperations: string[] }
}

function seedAutoJob(
  database: ReturnType<typeof initializeDatabase>,
  jobId: string,
  appId: number
): void {
  seedJob(database, jobId, appId, 'branch_poll')
  database
    .prepare(
      `INSERT INTO product_branch_observation
    (app_id,source_generation,ref,observation_sequence,observed_sha,observed_at)
    VALUES (?,1,'main',1,?,'${new Date(NOW).toISOString()}')`
    )
    .run(appId, SHA_A)
  database
    .prepare(
      `INSERT INTO product_desired_branch
    (app_id,source_generation,ref,desired_observation_sequence,desired_sha,reconcile_epoch,
     reconciliation_state,reconciliation_job_id,auto_paused,updated_at)
    VALUES (?,1,'main',1,?,0,'queued',?,0,'${new Date(NOW).toISOString()}')`
    )
    .run(appId, SHA_A, jobId)
}

function seedManualJob(
  database: ReturnType<typeof initializeDatabase>,
  jobId: string,
  appId: number,
  options: { state?: string; attemptCount?: number; maxAttempts?: number } = {}
): void {
  seedJob(database, jobId, appId, 'manual_redeploy', options)
}

function seedJob(
  database: ReturnType<typeof initializeDatabase>,
  jobId: string,
  appId: number,
  trigger: 'branch_poll' | 'manual_redeploy',
  options: { state?: string; attemptCount?: number; maxAttempts?: number } = {}
): void {
  database
    .prepare(
      `INSERT INTO product_deploy_job
    (job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
     trigger,idempotency_key,ref,target_sha,observation_sequence,reconcile_epoch,state,
     attempt_count,max_attempts,available_at,created_at,updated_at)
    VALUES (?, '${CONTROLLER}', ?, 1, 1, '${HASH}', ?, ?, 'main', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      jobId,
      appId,
      trigger,
      trigger === 'branch_poll' ? 'auto:1:1:0' : `manual:${jobId}`,
      SHA_A,
      trigger === 'branch_poll' ? 1 : null,
      trigger === 'branch_poll' ? 0 : null,
      options.state ?? 'queued',
      options.attemptCount ?? 0,
      options.maxAttempts ?? 3,
      new Date(NOW).toISOString(),
      new Date(NOW).toISOString(),
      new Date(NOW).toISOString()
    )
}

function count(database: ReturnType<typeof initializeDatabase>, table: string): number {
  if (!/^product_[a-z_]+$/.test(table)) throw new Error('invalid test table')
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count
}

function readPrewriteRows(database: ReturnType<typeof initializeDatabase>): unknown {
  return {
    job: database.prepare('SELECT * FROM product_deploy_job ORDER BY job_id').all(),
    attempts: database
      .prepare('SELECT * FROM product_deploy_attempt ORDER BY attempt_number')
      .all(),
    appLeases: database.prepare('SELECT * FROM product_app_lease ORDER BY fence').all(),
    buildLeases: database.prepare('SELECT * FROM product_worker_lease ORDER BY fence').all(),
    desired: database
      .prepare('SELECT * FROM product_desired_branch ORDER BY app_id,source_generation,ref')
      .all(),
    history: database.prepare('SELECT * FROM product_history_event ORDER BY event_id').all(),
    fences: database.prepare('SELECT * FROM product_app_fence ORDER BY app_id').all()
  }
}

function readDispatchRows(database: ReturnType<typeof initializeDatabase>): unknown {
  return {
    jobs: database.prepare('SELECT * FROM product_deploy_job ORDER BY job_id').all(),
    attempts: database
      .prepare('SELECT * FROM product_deploy_attempt ORDER BY attempt_number')
      .all(),
    deployments: database.prepare('SELECT * FROM deployment ORDER BY id').all(),
    app: database.prepare('SELECT current_deployment_id FROM app WHERE id=1').get(),
    appLeases: database.prepare('SELECT * FROM product_app_lease ORDER BY fence').all(),
    buildLeases: database.prepare('SELECT * FROM product_worker_lease ORDER BY fence').all(),
    history: database.prepare('SELECT * FROM product_history_event ORDER BY event_id').all()
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for concurrent claim worker')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function waitForChild(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`claim worker exited with code ${String(code)}`))
    })
  })
}

async function runOperationBehindWriteLock(
  operation: 'claim' | 'heartbeat',
  claim: import('../../../../docs/contracts/product-auto-deploy').ProductClaimToken | null,
  operationTime: number
): Promise<void> {
  const databasePath = join(testDirectory!, 'opspilot.db')
  const lockReady = join(testDirectory!, 'lock.ready')
  const operationStarted = join(testDirectory!, 'operation.started')
  const releaseLock = join(testDirectory!, 'release.lock')
  const clockPath = join(testDirectory!, 'clock.txt')
  const resultPath = join(testDirectory!, 'operation.result')
  writeFileSync(clockPath, String(NOW))
  closeDatabase()

  const lockSource = `
    const fs=require('node:fs'); const Database=require('better-sqlite3');
    const [dbPath,ready,release]=process.argv.slice(1);
    const db=new Database(dbPath); db.pragma('busy_timeout=8000'); db.exec('BEGIN IMMEDIATE');
    fs.writeFileSync(ready,'locked');
    const wait=new Int32Array(new SharedArrayBuffer(4)); const deadline=Date.now()+8000;
    while(!fs.existsSync(release) && Date.now()<deadline) Atomics.wait(wait,0,0,5);
    if(!fs.existsSync(release)) { db.exec('ROLLBACK'); db.close(); process.exit(3); }
    db.exec('COMMIT'); db.close();
  `
  const claimLiteral = JSON.stringify(claim)
  const operationSource = `
    const fs=require('node:fs'); const ts=require('typescript');
    require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
    }).outputText,f);
    const [dbPath,started,clockPath,resultPath]=process.argv.slice(1);
    const Database=require('better-sqlite3'); const db=new Database(dbPath);
    db.pragma('foreign_keys=ON'); db.pragma('busy_timeout=8000');
    const {ProductDeployRepository}=require('./src/main/db/productDeployRepository.ts');
    const repo=ProductDeployRepository.withClockForTest(db,()=>Number(fs.readFileSync(clockPath,'utf8')));
    fs.writeFileSync(started,'calling');
    const outcome=${
      operation === 'claim'
        ? `repo.claimNextJob('${CONTROLLER}')`
        : `repo.heartbeatClaim(${claimLiteral})`
    };
    fs.writeFileSync(resultPath,JSON.stringify(outcome)); db.close();
  `
  const lockChild = spawn(
    process.execPath,
    ['-e', lockSource, databasePath, lockReady, releaseLock],
    {
      cwd: process.cwd(),
      stdio: 'ignore'
    }
  )
  let operationChild: ReturnType<typeof spawn> | null = null
  try {
    await waitFor(() => existsSync(lockReady))
    operationChild = spawn(
      process.execPath,
      ['-e', operationSource, databasePath, operationStarted, clockPath, resultPath],
      { cwd: process.cwd(), stdio: 'ignore' }
    )
    await waitFor(() => existsSync(operationStarted))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(existsSync(resultPath)).toBe(false)
    writeFileSync(clockPath, String(operationTime))
    writeFileSync(releaseLock, 'release')
    await Promise.all([waitForChild(lockChild), waitForChild(operationChild)])
  } finally {
    writeFileSync(releaseLock, 'release')
    for (const child of [lockChild, operationChild]) {
      if (child && child.exitCode === null) child.kill()
    }
    if (lockChild.exitCode === null) await waitForChild(lockChild)
    if (operationChild && operationChild.exitCode === null) await waitForChild(operationChild)
  }
}
