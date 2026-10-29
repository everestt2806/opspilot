import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { closeDatabase, initializeDatabase } from '../db'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { PublicBranchQueryError, type PublicBranchTip } from '../git/publicBranch'
import { calculateControlPlanePollDelay, ControlPlaneGitPoller } from './gitPoller'

const CONTROLLER_ID = 'control-plane-test'
const REPOSITORY_URL = 'https://github.com/octocat/Hello-World.git'
const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const CONFIG_A = '1'.repeat(64)
const CONFIG_B = '2'.repeat(64)

let directory: string | null = null
let database: Database.Database | null = null

afterEach(() => {
  if (database?.open) database.close()
  database = null
  closeDatabase()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
})

describe('Product controller Git poller', () => {
  it('records a new full tip and reconciles the same tip without duplicate observation or job', async () => {
    const repository = createFixture()
    const fetchTip = vi.fn(async () => ({ state: 'found', sha: SHA_A }) satisfies PublicBranchTip)
    const poller = createPoller(repository, fetchTip)

    expect(await poller.pollOnce(new AbortController().signal)).toMatchObject({
      sourceCount: 1,
      repositoryRefCount: 1,
      fetchedCount: 1,
      observedCount: 1,
      queuedCount: 1,
      errorCount: 0
    })
    expect(await poller.pollOnce(new AbortController().signal)).toMatchObject({
      observedCount: 0,
      queuedCount: 1,
      errorCount: 0
    })
    expect(fetchTip).toHaveBeenCalledTimes(2)
    expect(count('product_branch_observation')).toBe(1)
    expect(count('product_deploy_job')).toBe(1)
  })

  it('coalesces apps sharing a public repository and production branch in one cycle', async () => {
    const repository = createFixture(true)
    const fetchTip = vi.fn(async () => ({ state: 'found', sha: SHA_B }) satisfies PublicBranchTip)
    const summary = await createPoller(repository, fetchTip).pollOnce(new AbortController().signal)

    expect(summary).toMatchObject({ sourceCount: 2, repositoryRefCount: 1, fetchedCount: 1 })
    expect(fetchTip).toHaveBeenCalledTimes(1)
    expect(count('product_branch_observation')).toBe(2)
    expect(count('product_deploy_job')).toBe(2)
  })

  it('does not replace desired state or create observations when the remote branch is missing', async () => {
    const repository = createFixture()
    const poller = createPoller(repository, async () => ({ state: 'found', sha: SHA_A }))
    await poller.pollOnce(new AbortController().signal)
    const before = database!.prepare('SELECT desired_sha FROM product_desired_branch').get()

    const missing = createPoller(repository, async () => ({ state: 'missing' }))
    expect(await missing.pollOnce(new AbortController().signal)).toMatchObject({
      missingBranchCount: 1,
      errorCount: 1,
      lastErrorCode: 'GIT_BRANCH_MISSING'
    })
    expect(database!.prepare('SELECT desired_sha FROM product_desired_branch').get()).toEqual(
      before
    )
    expect(count('product_branch_observation')).toBe(1)
    expect(count('product_deploy_job')).toBe(1)
  })

  it('keeps desired state unchanged and backs off after a network timeout', async () => {
    const repository = createFixture()
    const fetchTip = vi.fn(async () => {
      throw new PublicBranchQueryError('GIT_TIMEOUT')
    })
    const poller = createPoller(repository, fetchTip)
    const result = await poller.pollOnce(new AbortController().signal)
    expect(result).toMatchObject({ errorCount: 1, lastErrorCode: 'GIT_TIMEOUT', observedCount: 0 })
    expect(count('product_branch_observation')).toBe(0)
    expect(count('product_deploy_job')).toBe(0)
    expect(calculateControlPlanePollDelay(30_000, 300_000, 5_000, 1, 0)).toBe(60_000)
    expect(calculateControlPlanePollDelay(30_000, 300_000, 5_000, 12, 0.99)).toBe(300_000)
  })

  it('rejects a late fetch after ownership changes without writing the old identity', async () => {
    const repository = createFixture()
    const fetchTip = vi.fn(async () => {
      database!
        .prepare('UPDATE product_app_control SET ownership_generation=2 WHERE app_id=1')
        .run()
      return { state: 'found', sha: SHA_A } satisfies PublicBranchTip
    })
    const result = await createPoller(repository, fetchTip).pollOnce(new AbortController().signal)
    expect(result).toMatchObject({ staleCount: 1, observedCount: 0 })
    expect(count('product_branch_observation')).toBe(0)
    expect(count('product_deploy_job')).toBe(0)
  })

  it('rejects a late fetch after a newer tip observation advances the captured sequence', async () => {
    const repository = createFixture()
    const fetchTip = vi.fn(async () => {
      repository.observeTip({
        controllerId: CONTROLLER_ID,
        appId: 1,
        ownershipGeneration: 1,
        sourceGeneration: 1,
        configSha256: CONFIG_A,
        ref: 'main',
        expectedObservationSequence: null,
        tipSha: SHA_B
      })
      return { state: 'found', sha: SHA_A } satisfies PublicBranchTip
    })

    const result = await createPoller(repository, fetchTip).pollOnce(new AbortController().signal)

    expect(result).toMatchObject({ staleCount: 1, observedCount: 0 })
    expect(database!.prepare('SELECT observed_sha FROM product_branch_observation').all()).toEqual([
      { observed_sha: SHA_B }
    ])
    expect(database!.prepare('SELECT desired_sha FROM product_desired_branch').all()).toEqual([
      { desired_sha: SHA_B }
    ])
    expect(count('product_deploy_job')).toBe(1)
  })

  it('rejects a late fetch after repository root changes without writing the prior source config', async () => {
    const repository = createFixture()
    const fetchTip = vi.fn(async () => {
      database!.prepare("UPDATE app SET git_root='new-root' WHERE id=1").run()
      return { state: 'found', sha: SHA_A } satisfies PublicBranchTip
    })
    const result = await createPoller(repository, fetchTip).pollOnce(new AbortController().signal)
    expect(result).toMatchObject({ staleCount: 1, observedCount: 0 })
    expect(count('product_branch_observation')).toBe(0)
    expect(count('product_deploy_job')).toBe(0)
  })

  it('records observations while preserving explicit auto-deploy pause', async () => {
    const repository = createFixture()
    database!
      .prepare(
        `UPDATE product_app_control SET auto_deploy_paused=1, pause_reason='manual_action',
         pause_policy_provenance='explicit' WHERE app_id=1`
      )
      .run()
    const result = await createPoller(repository, async () => ({
      state: 'found',
      sha: SHA_A
    })).pollOnce(new AbortController().signal)
    expect(result.observedCount).toBe(1)
    expect(
      database!
        .prepare('SELECT auto_paused, reconciliation_state FROM product_desired_branch')
        .get()
    ).toEqual({ auto_paused: 1, reconciliation_state: 'paused' })
    expect(count('product_deploy_job')).toBe(0)
  })

  it('reconciles durable pending intent on startup even when the fetched tip is unchanged', async () => {
    const repository = createFixture()
    repository.observeTip({
      controllerId: CONTROLLER_ID,
      appId: 1,
      ownershipGeneration: 1,
      sourceGeneration: 1,
      configSha256: CONFIG_A,
      ref: 'main',
      expectedObservationSequence: null,
      tipSha: SHA_A
    })
    database!.exec(`
      UPDATE product_desired_branch SET reconciliation_job_id=NULL,
        reconciliation_state='pending', reconciled_observation_sequence=NULL,
        reconciled_epoch=NULL WHERE app_id=1;
      DELETE FROM product_deploy_job WHERE app_id=1;
    `)
    const result = await createPoller(repository, async () => ({
      state: 'found',
      sha: SHA_A
    })).pollOnce(new AbortController().signal)
    expect(result).toMatchObject({ observedCount: 0, queuedCount: 1, errorCount: 0 })
    expect(count('product_branch_observation')).toBe(1)
    expect(count('product_deploy_job')).toBe(1)
  })

  it('shares an in-flight cycle instead of starting overlapping Git requests', async () => {
    const repository = createFixture()
    let releaseFetch!: (value: PublicBranchTip) => void
    let fetchStarted!: () => void
    const started = new Promise<void>((resolve) => (fetchStarted = resolve))
    const fetchTip = vi.fn(
      () =>
        new Promise<PublicBranchTip>((resolve) => {
          releaseFetch = resolve
          fetchStarted()
        })
    )
    const poller = createPoller(repository, fetchTip)
    const first = poller.pollOnce(new AbortController().signal)
    await started
    const second = poller.pollOnce(new AbortController().signal)
    expect(second).toBe(first)
    releaseFetch({ state: 'found', sha: SHA_A })
    await Promise.all([first, second])
    expect(fetchTip).toHaveBeenCalledTimes(1)
  })
})

function createPoller(
  repository: ProductDeployRepository,
  fetchTip: (repositoryUrl: string, branch: string, signal: AbortSignal) => Promise<PublicBranchTip>
): ControlPlaneGitPoller {
  return new ControlPlaneGitPoller({
    repository,
    controllerId: CONTROLLER_ID,
    fetchTip,
    now: () => 1_800_000_000_000,
    random: () => 0
  })
}

function createFixture(twoApps = false): ProductDeployRepository {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-control-poller-'))
  database = initializeDatabase(directory)
  database.exec(`
    INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
      VALUES (1, 'controller-target', 'example.invalid', 'deploy', 'key', X'00');
    INSERT INTO app (id, vps_id, name, framework, host_port, container_port, source_type,
      git_repo_url, git_ref, git_root) VALUES
      (1, 1, 'first-app', 'express', 30001, 3000, 'git', '${REPOSITORY_URL}', 'main', '.');
    INSERT INTO product_controller VALUES ('${CONTROLLER_ID}', 'created', 'active');
    INSERT INTO product_source_config VALUES
      (1, 1, '${REPOSITORY_URL}', 'main', '.', '{}', '${CONFIG_A}', 'created');
    INSERT INTO product_app_control
      (app_id, mode, controller_id, ownership_generation, source_generation,
       source_config_sha256, changed_at)
      VALUES (1, 'product', '${CONTROLLER_ID}', 1, 1, '${CONFIG_A}', 'created');
  `)
  if (twoApps) {
    database.exec(`
      INSERT INTO app (id, vps_id, name, framework, host_port, container_port, source_type,
        git_repo_url, git_ref, git_root) VALUES
        (2, 1, 'second-app', 'express', 30002, 3000, 'git', '${REPOSITORY_URL}', 'main', '.');
      INSERT INTO product_source_config VALUES
        (2, 1, '${REPOSITORY_URL}', 'main', '.', '{}', '${CONFIG_B}', 'created');
      INSERT INTO product_app_control
        (app_id, mode, controller_id, ownership_generation, source_generation,
         source_config_sha256, changed_at)
        VALUES (2, 'product', '${CONTROLLER_ID}', 1, 1, '${CONFIG_B}', 'created');
    `)
  }
  return new ProductDeployRepository(database)
}

function count(table: 'product_branch_observation' | 'product_deploy_job'): number {
  return (database!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count
}
