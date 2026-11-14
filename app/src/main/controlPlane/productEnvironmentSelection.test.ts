import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { fixture } from '../../../scripts/product-environment-desktop-lab/fixture'
import { closeDatabase } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { ProductEnvironmentSelection } from './productEnvironmentSelection'
import { canonicalH2Json } from './productH2Proof'
import { executeProductDeployPipeline } from './productRuntimePipeline'
import type {
  ProductEnvironmentSelectionInput,
  ProductEnvironmentScope
} from '../../../../docs/contracts/product-environment'

let root: string,
  f: Awaited<ReturnType<typeof fixture>>,
  selection: ProductEnvironmentSelection,
  scope: ProductEnvironmentScope,
  hash: string
const secret = 'SYNTHETIC_SELECTION_ONLY_VALUE_4937'
const input = (): ProductEnvironmentSelectionInput => ({
  format: 1,
  request_key: randomUUID(),
  scope: structuredClone(scope),
  expected_source_generation: 1,
  expected_source_config_sha256: hash,
  expected_latest_revision: 1,
  environment_revision: 1
})
const count = (table: string): number =>
  (f.remote.prepare('SELECT count(*) n FROM ' + table).get() as { n: number }).n
function job(state = 'queued'): void {
  f.remote
    .prepare(
      `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,trigger,idempotency_key,ref,target_sha,state,available_at,created_at,updated_at)
    VALUES('job',?,42,1,1,?,'manual_redeploy','key','main',?,?, '2026-11-14T00:00:00Z','2026-11-14T00:00:00Z','2026-11-14T00:00:00Z')`
    )
    .run(f.controllerId, hash, 'a'.repeat(40), state)
}
function attempt(): void {
  job('failed')
  f.remote.prepare('INSERT INTO product_app_fence VALUES(42,1)').run()
  f.remote
    .prepare(
      `INSERT INTO product_app_lease VALUES(42,'lease',?,1,1,'job','2026-11-14T00:00:00Z','2026-11-14T00:01:00Z','2026-11-14T00:00:00Z','2026-11-14T00:01:00Z')`
    )
    .run(f.controllerId)
  f.remote
    .prepare(
      `INSERT INTO product_worker_lease VALUES('build','worker',?,1,'job','2026-11-14T00:00:00Z','2026-11-14T00:01:00Z','2026-11-14T00:00:00Z','2026-11-14T00:01:00Z')`
    )
    .run(f.controllerId)
  f.remote.exec(
    "INSERT INTO product_deploy_attempt(attempt_id,job_id,attempt_number,lease_id,fencing_token,build_slot_lease_id,build_slot_fence,state,remote_outcome,started_at) VALUES('attempt','job',1,'lease',1,'worker',1,'failed','not_started','2026-11-14T00:00:00Z')"
  )
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-env-selection-'))
  f = await fixture(root)
  f.remote.exec(
    "UPDATE app SET source_type='git',source_path=NULL,git_repo_url='https://github.com/example/app.git',git_ref='main',git_root='.';UPDATE product_app_control SET auto_deploy_paused=1,pause_reason='operator',pause_policy_provenance='explicit'"
  )
  const context = await f.admin.environmentContext(f.bindingId, {
    format: 1,
    controller_id: f.controllerId,
    app_id: 42,
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    expected_source_config_sha256: (
      f.remote.prepare('SELECT config_sha256 FROM product_source_config').get() as {
        config_sha256: string
      }
    ).config_sha256,
    expected_target_security_revision: 1
  })
  scope = context.scope
  hash = context.source_config_sha256
  f.repo.append({
    scope,
    expected_latest_revision: null,
    expected_source_generation: 1,
    expected_source_config_sha256: hash,
    values: {
      runtime_env: { APP_TOKEN: secret },
      public_build_args: { NEXT_PUBLIC_TITLE: 'Sổ Đọc' }
    }
  })
  selection = new ProductEnvironmentSelection(f.remote, f.remoteCipher)
})
afterEach(() => {
  closeDatabase()
  f.remote.close()
  rmSync(root, { recursive: true })
  vi.restoreAllMocks()
})

it('selects an immutable reference in a new canonical source while preserving pause, live deployment and secret confidentiality', () => {
  f.remote.exec(
    "INSERT INTO deployment(id,app_id,version,image_tag,status) VALUES(1,42,1,'env-ui:v1','running');UPDATE app SET current_deployment_id=1"
  )
  const before = f.remote
    .prepare(
      'SELECT auto_deploy_paused,pause_reason,pause_policy_provenance FROM product_app_control'
    )
    .get()
  const request = input(),
    result = selection.select(request, f.controllerId, 'unix:1000')
  expect(result).toMatchObject({
    state: 'selected',
    source_generation: 2,
    environment: { revision: 1 },
    deployment_started: false,
    execution: 'requires_environment_runtime'
  })
  const row = f.remote
    .prepare('SELECT deploy_config_json FROM product_source_config WHERE source_generation=2')
    .get() as { deploy_config_json: string }
  const config = JSON.parse(row.deploy_config_json)
  expect(config.environment).toEqual({
    controller_id: f.controllerId,
    ownership_generation: 1,
    revision: 1
  })
  expect(createHash('sha256').update(canonicalH2Json(config)).digest('hex')).toBe(
    result.source_config_sha256
  )
  expect(f.remote.prepare('SELECT current_deployment_id FROM app').get()).toEqual({
    current_deployment_id: 1
  })
  expect(
    f.remote
      .prepare(
        'SELECT auto_deploy_paused,pause_reason,pause_policy_provenance FROM product_app_control'
      )
      .get()
  ).toEqual(before)
  expect(count('product_deploy_job')).toBe(0)
  expect(count('product_history_event')).toBe(1)
  const visible = JSON.stringify({
    result,
    row,
    bindings: f.remote.prepare('SELECT * FROM product_source_environment').all(),
    history: f.remote.prepare('SELECT * FROM product_history_event').all()
  })
  for (const value of [
    secret,
    'Sổ Đọc',
    'APP_TOKEN',
    'NEXT_PUBLIC_TITLE',
    createHash('sha256').update(secret).digest('hex')
  ])
    expect(visible).not.toContain(value)
  expect(f.remote.pragma('foreign_key_check')).toEqual([])
})
it('replays the exact selection after reopening the connection without creating a generation or audit twice', () => {
  const request = input(),
    first = selection.select(request, f.controllerId, 'unix:1000')
  f.remote.close()
  f.remote = new Database(join(root, 'remote.db'))
  selection = new ProductEnvironmentSelection(f.remote, f.remoteCipher)
  expect(selection.select(request, f.controllerId, 'unix:1000')).toEqual({
    ...first,
    state: 'already_selected'
  })
  expect(count('product_source_config')).toBe(2)
  expect(count('product_source_environment')).toBe(1)
  expect(count('product_history_event')).toBe(1)
})
it('serializes selection CAS across two connections and does not overwrite caller state', () => {
  const other = new Database(join(root, 'remote.db'))
  try {
    const concurrent = new ProductEnvironmentSelection(other, f.remoteCipher),
      request = input()
    const selected = selection.select(request, f.controllerId, 'unix:1000')
    expect(() => concurrent.select({ ...input() }, f.controllerId, 'unix:1000')).toThrow(
      'PRODUCT_ENVIRONMENT_SOURCE_CHANGED'
    )
    expect(concurrent.select(request, f.controllerId, 'unix:1000')).toEqual({
      ...selected,
      state: 'already_selected'
    })
    expect(count('product_source_environment')).toBe(1)
  } finally {
    other.close()
  }
})
it('refuses corrupted binding/request metadata when replaying a previously selected source', () => {
  const request = input()
  selection.select(request, f.controllerId, 'unix:1000')
  f.remote.exec('DROP TRIGGER product_source_environment_immutable')
  f.remote.exec(
    "UPDATE product_source_environment SET request_json=json_set(request_json,'$.environment_revision',9)"
  )
  expect(() => selection.select(request, f.controllerId, 'unix:1000')).toThrow(
    /PRODUCT_ENVIRONMENT_/
  )
  expect(count('product_source_config')).toBe(2)
})
it('refuses another body/principal UUID replay and preserves historical source/binding rows', () => {
  const request = input()
  selection.select(request, f.controllerId, 'unix:1000')
  expect(() =>
    selection.select({ ...request, expected_latest_revision: 2 }, f.controllerId, 'unix:1000')
  ).toThrow('PRODUCT_ENVIRONMENT_IDEMPOTENCY_CONFLICT')
  expect(() => selection.select(request, f.controllerId, 'unix:1001')).toThrow(
    'PRODUCT_ENVIRONMENT_SOURCE_CHANGED'
  )
  expect(() => f.remote.exec('DELETE FROM product_source_environment')).toThrow(
    'PRODUCT_SOURCE_ENVIRONMENT_IMMUTABLE'
  )
  expect(() =>
    f.remote.exec("UPDATE product_source_environment SET request_key='changed'")
  ).toThrow('PRODUCT_SOURCE_ENVIRONMENT_IMMUTABLE')
})
it('allows explicit historical revision selection on a later source and fences a superseded replay', () => {
  const firstRequest = input(),
    first = selection.select(firstRequest, f.controllerId, 'unix:1000')
  f.repo.append({
    scope,
    expected_latest_revision: 1,
    expected_source_generation: first.source_generation,
    expected_source_config_sha256: first.source_config_sha256,
    values: { runtime_env: { APP_TOKEN: 'new' }, public_build_args: {} }
  })
  const next = selection.select(
    {
      ...input(),
      expected_source_generation: 2,
      expected_source_config_sha256: first.source_config_sha256,
      expected_latest_revision: 2,
      environment_revision: 1
    },
    f.controllerId,
    'unix:1000'
  )
  expect(next.source_generation).toBe(3)
  expect(next.environment.revision).toBe(1)
  expect(() => selection.select(firstRequest, f.controllerId, 'unix:1000')).toThrow(
    'PRODUCT_ENVIRONMENT_SOURCE_CHANGED'
  )
})
it.each(['queued', 'claimed', 'deploying', 'retry_wait', 'uncertain'])(
  'blocks %s jobs with no source or history change',
  (state) => {
    job(state)
    expect(() => selection.select(input(), f.controllerId, 'unix:1000')).toThrow(
      'PRODUCT_ENVIRONMENT_REQUIRES_QUIESCENCE'
    )
    expect(count('product_source_config')).toBe(1)
    expect(count('product_source_environment')).toBe(0)
  }
)
it.each([
  'paused',
  'app_lease',
  'worker_lease',
  'unknown_attempt',
  'runtime_no_terminal',
  'terminal_unsettled'
])('blocks %s even with expired leases or terminal failed jobs', (kind) => {
  if (kind === 'paused')
    f.remote.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
  else {
    attempt()
    if (kind === 'app_lease') f.remote.exec('UPDATE product_app_lease SET released_at=NULL')
    if (kind === 'worker_lease') f.remote.exec('UPDATE product_worker_lease SET released_at=NULL')
    if (kind === 'unknown_attempt')
      f.remote.exec("UPDATE product_deploy_attempt SET remote_outcome='unknown'")
    if (kind.startsWith('runtime') || kind.startsWith('terminal')) {
      f.remote.exec(
        "INSERT INTO deployment(id,app_id,version,image_tag,status) VALUES(1,42,1,'env-ui:v1','failed');UPDATE product_deploy_attempt SET deployment_id=1;INSERT INTO product_runtime_execution(attempt_id,deployment_id,context_json,context_sha256,created_at) VALUES('attempt',1,'{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-11-14T00:00:00Z')"
      )
      if (kind === 'terminal_unsettled')
        f.remote.exec(
          "INSERT INTO product_runtime_terminal(attempt_id,commit_id,receipt_sha256,context_sha256,envelope_json,committed_at) VALUES('attempt','commit','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','2026-11-14T00:00:00Z')"
        )
    }
  }
  expect(() => selection.select(input(), f.controllerId, 'unix:1000')).toThrow(
    'PRODUCT_ENVIRONMENT_REQUIRES_QUIESCENCE'
  )
  expect(count('product_source_config')).toBe(1)
})
it.each(['latest', 'source', 'target', 'owner', 'controller', 'key'] as const)(
  'refuses stale %s before selection',
  (kind) => {
    const request = input()
    if (kind === 'latest') request.expected_latest_revision = 2
    if (kind === 'source') request.expected_source_generation = 9
    if (kind === 'target') request.scope.target.port = 2222
    if (kind === 'owner') request.scope.ownership_generation = 2
    if (kind === 'controller') f.remote.exec("UPDATE product_controller SET status='maintenance'")
    if (kind === 'key')
      selection = new ProductEnvironmentSelection(
        f.remote,
        new AesGcmCredentialCipher(randomBytes(32))
      )
    expect(() => selection.select(request, f.controllerId, 'unix:1000')).toThrow(
      /PRODUCT_ENVIRONMENT_/
    )
    expect(count('product_source_config')).toBe(1)
  }
)
it('rolls back source, binding, pointer and audit on late SQLite failure without surfacing values', () => {
  f.remote.exec(
    "CREATE TRIGGER fail_env_audit BEFORE INSERT ON product_history_event BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SELECTION_ONLY_VALUE_4937'); END"
  )
  expect(() => selection.select(input(), f.controllerId, 'unix:1000')).toThrow(
    'PRODUCT_ENVIRONMENT_STORAGE_UNAVAILABLE'
  )
  expect(count('product_source_config')).toBe(1)
  expect(count('product_source_environment')).toBe(0)
  expect(f.remote.prepare('SELECT source_generation FROM product_app_control').get()).toEqual({
    source_generation: 1
  })
})
it('detects source or authority mutation during decrypt and aborts the entire transaction', () => {
  const original = f.remoteCipher.decrypt.bind(f.remoteCipher)
  let calls = 0
  vi.spyOn(f.remoteCipher, 'decrypt').mockImplementation((row) => {
    if (++calls === 2) f.remote.exec("UPDATE product_controller SET status='maintenance'")
    return original(row)
  })
  expect(() => selection.select(input(), f.controllerId, 'unix:1000')).toThrow(
    /PRODUCT_ENVIRONMENT_/
  )
  expect(count('product_source_config')).toBe(1)
  expect(count('product_source_environment')).toBe(0)
  expect(f.remote.prepare('SELECT status FROM product_controller').get()).toEqual({
    status: 'active'
  })
})
it('requires explicit CLI principal and rejects nested transactions/unknown fields', () => {
  expect(() =>
    selection.select({ ...input(), values: { APP_TOKEN: secret } }, f.controllerId, 'unix:1000')
  ).toThrow('PRODUCT_ENVIRONMENT_INPUT_INVALID')
  expect(() => selection.select(input(), f.controllerId, 'payload:admin')).toThrow(
    'PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED'
  )
  f.remote.exec('BEGIN')
  try {
    expect(() => selection.select(input(), f.controllerId, 'unix:1000')).toThrow(
      'PRODUCT_ENVIRONMENT_INPUT_INVALID'
    )
  } finally {
    f.remote.exec('ROLLBACK')
  }
})
it('fails before opening SSH for a source requiring the pending environment runtime', async () => {
  const selected = selection.select(input(), f.controllerId, 'unix:1000'),
    open = vi.fn()
  await expect(
    executeProductDeployPipeline(
      f.remote,
      {} as never,
      {} as never,
      { openProductBootstrapChannel: open } as never,
      {
        claim: {
          app_id: 42,
          source_generation: selected.source_generation,
          source_config_sha256: selected.source_config_sha256
        },
        rootDirectory: join(root, 'not-present')
      } as never,
      { vps_id: 77, target_helper_path: '/unused', target_state_root: '/unused' }
    )
  ).rejects.toThrow('PRODUCT_SOURCE_RENDER_UNSUPPORTED_PLAN')
  expect(open).not.toHaveBeenCalled()
  f.remote.pragma('wal_checkpoint(TRUNCATE)')
  expect(readFileSync(join(root, 'remote.db')).includes(Buffer.from(secret))).toBe(false)
})
