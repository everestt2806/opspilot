import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, it, expect, vi } from 'vitest'
import { fixture } from '../../../scripts/product-environment-desktop-lab/fixture'
import { closeDatabase } from '../db'
import { DesktopEnvironmentSelections } from './desktopEnvironmentSelections'
import { ProductEnvironmentSelection } from './productEnvironmentSelection'
import { canonicalH2Json } from './productH2Proof'
let root: string, f: Awaited<ReturnType<typeof fixture>>, subject: DesktopEnvironmentSelections
const make = (): DesktopEnvironmentSelections =>
  new DesktopEnvironmentSelections(f.db, f.cipher, f.vault, f.projects, f.main, f.admin)
const stage = async (value = 'SYNTHETIC_STAGE_ONLY_9421'): Promise<void> => {
  const context = await f.main.context(f.projectKey)
  const row = await f.main.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: 2,
    expected_latest_revision: context.latest?.revision ?? null,
    runtime_env: { APP_TOKEN: value },
    public_build_args: { NEXT_PUBLIC_TITLE: 'Public title' }
  })
  await f.main.send(row.request_key)
}
const prepare = async (): ReturnType<DesktopEnvironmentSelections['prepare']> => {
  const c = await f.main.context(f.projectKey)
  return subject.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: 2,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    expected_latest_revision: c.latest!.revision,
    environment_revision: c.latest!.revision
  })
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-desktop-selection-'))
  f = await fixture(root)
  subject = make()
  await stage()
})
afterEach(() => {
  closeDatabase()
  f.remote.close()
  rmSync(root, { recursive: true })
  vi.restoreAllMocks()
})
it('selects via immutable Main journal and reviews new current source without rewriting original registration', async () => {
  const before = f.projects.registeredContext(f.projectKey),
    row = await prepare()
  expect(row).toMatchObject({ state: 'prepared', source_generation: 1, environment_revision: 1 })
  const result = await subject.send(row.request_key)
  expect(result).toMatchObject({
    state: 'selected',
    result: { source_generation: 2, environment: { revision: 1 }, deployment_started: false }
  })
  expect(await f.main.context(f.projectKey)).toMatchObject({
    source_generation: 2,
    latest: { revision: 1 },
    selected: { revision: 1 },
    auto_deploy_paused: true
  })
  expect(f.projects.registeredContext(f.projectKey)).toEqual(before)
  expect(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
  expect(f.remote.prepare('SELECT current_deployment_id n FROM app').get()).toEqual({ n: null })
  const metadata = JSON.stringify({ row, result, list: subject.list(f.projectKey) })
  for (const value of [
    'SYNTHETIC_STAGE_ONLY',
    'runtime_env',
    'public_build_args',
    'target_binding_json',
    'encrypted_secret'
  ])
    expect(metadata).not.toContain(value)
  f.db.pragma('wal_checkpoint(TRUNCATE)')
  expect(
    readFileSync(join(root, 'desktop/opspilot.db')).includes(Buffer.from('SYNTHETIC_STAGE_ONLY'))
  ).toBe(false)
})
it('continues staging and selecting after the first source generation change', async () => {
  await subject.send((await prepare()).request_key)
  await stage('SYNTHETIC_SECOND_REVISION')
  expect(await f.main.context(f.projectKey)).toMatchObject({
    source_generation: 2,
    selected: { revision: 1 },
    latest: { revision: 2 }
  })
  const result = await subject.send((await prepare()).request_key)
  expect(result.result).toMatchObject({ source_generation: 3, environment: { revision: 2 } })
  expect(await f.main.context(f.projectKey)).toMatchObject({
    source_generation: 3,
    selected: { revision: 2 },
    latest: { revision: 2 }
  })
})
it('recovers lost reply via read-only receipt lookup after recreating Main without a second source mutation', async () => {
  const row = await prepare()
  f.behavior.lost = true
  await expect(subject.send(row.request_key)).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
  expect(subject.list(f.projectKey)[0].state).toBe('outcome_unknown')
  subject = make()
  const checked = await subject.check(row.request_key)
  expect(checked.state).toBe('selected')
  expect(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get()).toEqual({
    n: 1
  })
  expect(await subject.send(row.request_key)).toEqual(checked)
})
it('retries the same UUID/body after lost reply without adding a source generation', async () => {
  const row = await prepare()
  f.behavior.lost = true
  await expect(subject.send(row.request_key)).rejects.toThrow()
  const result = await make().send(row.request_key)
  expect(result).toMatchObject({
    request_key: row.request_key,
    state: 'selected',
    result: { state: 'already_selected' }
  })
  expect(f.remote.prepare('SELECT count(*) n FROM product_source_config').get()).toEqual({ n: 2 })
})
it('returns missing receipt safely and allows cancelling only an unsent request', async () => {
  const row = await prepare()
  expect((await subject.check(row.request_key)).state).toBe('prepared')
  expect(subject.cancel(row.request_key).state).toBe('cancelled')
  expect(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get()).toEqual({
    n: 0
  })
})
it('keeps unknown after a pre-delivery failure and refuses cancellation', async () => {
  vi.spyOn(f.admin, 'selectEnvironment').mockRejectedValue(Error('SYNTHETIC_FAILURE'))
  const row = await prepare()
  await expect(subject.send(row.request_key)).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
  expect((await subject.check(row.request_key)).state).toBe('outcome_unknown')
  expect(() => subject.cancel(row.request_key)).toThrow('ENVIRONMENT_CONFLICT')
})
it('releases a stale request only after authoritative negative proof, then allows a fresh request', async () => {
  const row = await prepare(),
    reviewed = await f.main.remoteContext(f.projectKey)
  f.repo.append({
    scope: reviewed.remote.scope,
    expected_source_generation: 1,
    expected_source_config_sha256: reviewed.remote.source_config_sha256,
    expected_latest_revision: 1,
    values: { runtime_env: { APP_TOKEN: 'SYNTHETIC_OTHER_ADMIN' }, public_build_args: {} }
  })
  await expect(subject.send(row.request_key)).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
  expect(subject.list(f.projectKey)[0].state).toBe('outcome_unknown')
  const confirmed = await subject.check(row.request_key)
  expect(confirmed.state).toBe('not_applied')
  expect((await prepare()).request_key).not.toBe(row.request_key)
  expect(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get()).toEqual({
    n: 0
  })
})
it('blocks overlapping stage/selection and preserves the original immutable request', async () => {
  const row = await prepare()
  expect((await prepare()).request_key).toBe(row.request_key)
  await expect(stage()).rejects.toThrow('ENVIRONMENT_CONFLICT')
  expect(() =>
    f.db.prepare("UPDATE desktop_environment_selection SET context_json='{}'").run()
  ).toThrow('DESKTOP_ENVIRONMENT_SELECTION_IMMUTABLE')
})
it('refuses selection while an encrypted stage intent is pending', async () => {
  await f.main.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: 2,
    expected_latest_revision: 1,
    runtime_env: {},
    public_build_args: {}
  })
  await expect(prepare()).rejects.toThrow('ENVIRONMENT_CONFLICT')
})
it('rejects changed source/binding/latest CAS and unpaused selection before writing an intent', async () => {
  const c = await f.main.context(f.projectKey)
  for (const changed of [
    { expected_source_generation: 9 },
    { expected_source_config_sha256: 'f'.repeat(64) },
    { expected_binding_revision: 1 },
    { expected_latest_revision: 2 }
  ]) {
    await expect(
      subject.prepare({
        project_request_key: f.projectKey,
        expected_binding_revision: 2,
        expected_source_generation: c.source_generation,
        expected_source_config_sha256: c.source_config_sha256,
        expected_latest_revision: 1,
        environment_revision: 1,
        ...changed
      })
    ).rejects.toThrow('ENVIRONMENT_CHANGED')
  }
  f.remote.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
  await expect(prepare()).rejects.toThrow('ENVIRONMENT_CHANGED')
  expect(subject.list(f.projectKey)).toEqual([])
})
it('refuses a changed binding during the remote write and retains unknown delivery evidence', async () => {
  const original = f.admin.selectEnvironment
  vi.spyOn(f.admin, 'selectEnvironment').mockImplementation(async (...args) => {
    const result = await original(...args)
    f.db.exec('UPDATE desktop_controller_binding SET revision=revision+1')
    return result
  })
  const row = await prepare()
  await expect(subject.send(row.request_key)).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
  expect(f.db.prepare('SELECT state FROM desktop_environment_selection').get()).toEqual({
    state: 'outcome_unknown'
  })
})
it('rejects forged controller result identities without marking selected', async () => {
  const original = f.admin.selectEnvironment
  vi.spyOn(f.admin, 'selectEnvironment').mockImplementation(async (...args) => ({
    ...(await original(...args)),
    app_id: 999
  }))
  const row = await prepare()
  await expect(subject.send(row.request_key)).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
  expect(subject.list(f.projectKey)[0].state).toBe('outcome_unknown')
})
it('reads an existing selection receipt while queued work prevents another mutation', async () => {
  const row = await prepare(),
    result = await subject.send(row.request_key)
  const request = JSON.parse(
    (
      f.remote.prepare('SELECT request_json FROM product_source_environment').get() as {
        request_json: string
      }
    ).request_json
  )
  f.remote
    .prepare(
      `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,trigger,idempotency_key,ref,target_sha,state,available_at,created_at,updated_at) VALUES('busy',?,42,1,2,?,'manual_redeploy','busy','main',?,'queued',?,?,?)`
    )
    .run(
      f.controllerId,
      result.result!.source_config_sha256,
      'a'.repeat(40),
      ...Array(3).fill(new Date().toISOString())
    )
  const selection = new ProductEnvironmentSelection(f.remote, f.remoteCipher)
  expect(selection.lookup(request, f.controllerId, 'unix:1000').result?.request_key).toBe(
    row.request_key
  )
  expect(() => selection.select(request, f.controllerId, 'unix:1000')).toThrow(
    'PRODUCT_ENVIRONMENT_REQUIRES_QUIESCENCE'
  )
})
it('rejects repository/plan drift and corrupt anchor without adopting a new project source', async () => {
  f.remote.exec("UPDATE app SET git_repo_url='https://github.com/example/other.git'")
  await expect(f.main.context(f.projectKey)).rejects.toThrow()
})
it('refuses a valid but unrelated current source plan instead of implicitly adopting it', async () => {
  const basis = f.remote.prepare('SELECT * FROM product_source_config').get() as {
    deploy_config_json: string
  }
  const config = JSON.parse(basis.deploy_config_json)
  config.host_port = 30001
  const body = canonicalH2Json(config),
    hash = createHash('sha256').update(body).digest('hex')
  f.remote
    .prepare(
      "INSERT INTO product_source_config VALUES(42,2,'https://github.com/example/app.git','main','.',?,?,?)"
    )
    .run(body, hash, new Date().toISOString())
  f.remote
    .prepare('UPDATE product_app_control SET source_generation=2,source_config_sha256=?')
    .run(hash)
  f.remote.exec('UPDATE app SET host_port=30001')
  await expect(f.main.context(f.projectKey)).rejects.toThrow('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
})
it('refuses an unbound generation even when its config bytes match the registered basis', async () => {
  f.remote.exec(
    'INSERT INTO product_source_config SELECT app_id,2,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at FROM product_source_config WHERE source_generation=1;UPDATE product_app_control SET source_generation=2'
  )
  await expect(f.main.context(f.projectKey)).rejects.toThrow('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
})
it('rejects authenticated envelope tampering even if SQL immutability is bypassed', async () => {
  const row = await prepare()
  f.db.exec('DROP TRIGGER desktop_environment_selection_immutable')
  const stored = f.db.prepare('SELECT context_json FROM desktop_environment_selection').get() as {
    context_json: string
  }
  const request = JSON.parse(stored.context_json)
  request.environment_revision = 2
  f.db
    .prepare('UPDATE desktop_environment_selection SET context_json=?')
    .run(canonicalH2Json(request))
  expect(() => subject.list(f.projectKey)).toThrow('ENVIRONMENT_UNAVAILABLE')
  await expect(subject.send(row.request_key)).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
})
it('authenticates stored result metadata and rejects a forged success', async () => {
  const row = await prepare()
  await subject.send(row.request_key)
  f.db.prepare("UPDATE desktop_environment_selection SET result_json='{}'").run()
  expect(() => subject.list(f.projectKey)).toThrow('ENVIRONMENT_UNAVAILABLE')
})
it('accepts a valid selected source whose hash stays the same when selecting the same revision', async () => {
  const first = await subject.send((await prepare()).request_key)
  const next = await subject.send((await prepare()).request_key)
  expect(next.result?.source_generation).toBe(3)
  expect(next.result?.source_config_sha256).toBe(first.result?.source_config_sha256)
})
it('checks a historical stage receipt after another administrator selected its source', async () => {
  const context = await f.main.context(f.projectKey)
  const stageRow = await f.main.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: 2,
    expected_latest_revision: 1,
    runtime_env: { APP_TOKEN: 'SYNTHETIC_EXTERNAL_SELECTION' },
    public_build_args: {}
  })
  f.behavior.lost = true
  await expect(f.main.send(stageRow.request_key)).rejects.toThrow()
  const remote = new ProductEnvironmentSelection(f.remote, f.remoteCipher)
  const reviewed = await f.admin.environmentReview(f.bindingId, {
    format: 1,
    controller_id: f.controllerId,
    app_id: 42,
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    expected_source_config_sha256: context.source_config_sha256,
    expected_target_security_revision: 1
  })
  remote.select(
    {
      format: 1,
      request_key: 'e0411e32-6d6b-4c92-b9f8-1f24c22a423e',
      scope: reviewed.scope,
      expected_source_generation: 1,
      expected_source_config_sha256: context.source_config_sha256,
      expected_latest_revision: 2,
      environment_revision: 2
    },
    f.controllerId,
    'unix:1000'
  )
  expect((await f.main.check(stageRow.request_key)).state).toBe('staged')
})
