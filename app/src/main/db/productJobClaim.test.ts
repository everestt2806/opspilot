import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  PRODUCT_HEARTBEAT_INTERVAL_MS,
  PRODUCT_LEASE_TTL_MS
} from '../../../../docs/contracts/product-auto-deploy'
import { closeDatabase, initializeDatabase } from './index'
import { ProductDeployRepository } from './productDeployRepository'

const CONTROLLER = 'claim-controller'
const HASH = 'a'.repeat(64)
const SHA_A = '1'.repeat(40)
const NOW = Date.parse('2026-10-22T12:00:00.000Z')

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('Product atomic claim and lease repository', () => {
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
})

function createHarness(): {
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
    INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret)
      VALUES (1,'claim-vps','claim.example.test','deploy','key',X'00');
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
    repository: ProductDeployRepository.withClockForTest(database, () => clock.value),
    clock
  }
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
