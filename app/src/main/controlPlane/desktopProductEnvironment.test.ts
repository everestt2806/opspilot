import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture } from '../../../scripts/product-environment-desktop-lab/fixture'
import { DesktopProductEnvironment } from './desktopProductEnvironment'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from '../db'

let root: string, f: Awaited<ReturnType<typeof fixture>>
const secret = 'SYNTHETIC_DESKTOP_ENV_ONLY_27941'
const prepare = async (): ReturnType<DesktopProductEnvironment['prepare']> =>
  f.main.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: 2,
    expected_latest_revision: null,
    runtime_env: { APP_TOKEN: secret },
    public_build_args: { NEXT_PUBLIC_NAME: 'Sổ Đọc' }
  })
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-desktop-env-'))
  f = await fixture(root)
})
afterEach(() => {
  closeDatabase()
  f?.remote.close()
  rmSync(root, { recursive: true })
  vi.restoreAllMocks()
})
it('stages through current project context with encrypted local replay and metadata-only DTOs', async () => {
  const context = await f.main.context(f.projectKey)
  expect(context).toMatchObject({ latest: null, binding_revision: 2, app_id: 42 })
  const before = f.remote.prepare('SELECT * FROM product_app_control').get(),
    row = await prepare()
  expect(row).toMatchObject({
    state: 'prepared',
    runtime_keys: ['APP_TOKEN'],
    public_build_keys: ['NEXT_PUBLIC_NAME']
  })
  const saved = await f.main.send(row.request_key)
  expect(saved).toMatchObject({ state: 'staged', result: { revision: 1, activation: 'staged' } })
  expect(f.main.list(f.projectKey)).toEqual([saved])
  const output = JSON.stringify({ context, row, saved })
  for (const field of [
    secret,
    'Sổ Đọc',
    'encrypted_secret',
    'auth_tag',
    'runtime_env',
    'public_build_args'
  ])
    expect(output).not.toContain(field)
  f.db.pragma('wal_checkpoint(TRUNCATE)')
  expect(readFileSync(join(root, 'desktop', 'opspilot.db')).includes(Buffer.from(secret))).toBe(
    false
  )
  expect(f.remote.prepare('SELECT * FROM product_app_control').get()).toEqual(before)
  expect(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
})
it('reconciles a lost reply after cold reopen and does not create a duplicate revision', async () => {
  const row = await prepare()
  f.behavior.lost = true
  await expect(f.main.send(row.request_key)).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
  expect(f.main.list(f.projectKey)[0].state).toBe('outcome_unknown')
  closeDatabase()
  f.db = initializeDatabase(join(root, 'desktop'))
  // Vault/projects retain the closed connection, so rebuild their complete fixture composition from persisted data.
  const { DesktopControllerVault } = await import('./desktopControllerVault')
  const { DesktopProjectSetups } = await import('./desktopProjectSetup')
  const vault = new DesktopControllerVault(f.db, f.cipher),
    projects = new DesktopProjectSetups(f.db, vault, {} as never)
  f.main = new DesktopProductEnvironment(f.db, f.cipher, vault, projects, f.admin)
  expect((await f.main.check(row.request_key)).state).toBe('staged')
  expect((await f.main.send(row.request_key)).result?.revision).toBe(1)
  expect(f.remote.prepare('SELECT count(*) n FROM product_environment_revision').get()).toEqual({
    n: 1
  })
})
it('retries exactly the encrypted original after delivery failed before reaching the controller', async () => {
  const row = await prepare()
  f.behavior.failBefore = true
  await expect(f.main.send(row.request_key)).rejects.toThrow()
  expect((await f.main.check(row.request_key)).state).toBe('outcome_unknown')
  expect(() => f.main.cancel(row.request_key)).toThrow('ENVIRONMENT_CONFLICT')
  f.behavior.failBefore = false
  expect((await f.main.send(row.request_key)).state).toBe('staged')
  expect(f.remote.prepare('SELECT count(*) n FROM product_environment_revision').get()).toEqual({
    n: 1
  })
})
it('reuses same prepared body and refuses another body, then permits cancel only before sending', async () => {
  const row = await prepare()
  expect((await prepare()).request_key).toBe(row.request_key)
  await expect(
    f.main.prepare({
      project_request_key: f.projectKey,
      expected_binding_revision: 2,
      expected_latest_revision: null,
      runtime_env: { APP_TOKEN: 'different' },
      public_build_args: {}
    })
  ).rejects.toThrow('ENVIRONMENT_CONFLICT')
  expect(f.main.cancel(row.request_key).state).toBe('cancelled')
  const next = await prepare()
  expect(next.request_key).not.toBe(row.request_key)
})
it.each(['target', 'owner', 'source', 'revision'] as const)(
  'rejects changed remote %s context',
  async (change) => {
    const row = await prepare()
    if (change === 'target') f.remote.exec("UPDATE vps SET archived_at='2026-11-14T00:00:00Z'")
    if (change === 'owner') f.remote.exec('UPDATE product_app_control SET ownership_generation=2')
    if (change === 'source')
      f.remote.exec(
        'INSERT INTO product_source_config SELECT app_id,2,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at FROM product_source_config;UPDATE product_app_control SET source_generation=2'
      )
    if (change === 'revision') f.remote.exec('UPDATE vps SET port=2222')
    await expect(f.main.send(row.request_key)).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
    expect(f.remote.prepare('SELECT count(*) n FROM product_environment_revision').get()).toEqual({
      n: 0
    })
  }
)
it('checks binding and permissions after awaited context and before any local encrypt', async () => {
  const original = f.admin.environmentReview
  vi.spyOn(f.admin, 'environmentReview').mockImplementation(async (...args) => {
    const result = await original(...args)
    f.vault.disable(f.bindingId, 2)
    return result
  })
  const cipher = vi.spyOn(f.cipher, 'encrypt')
  await expect(prepare()).rejects.toThrow()
  expect(cipher).not.toHaveBeenCalled()
  expect(f.db.prepare('SELECT count(*) n FROM desktop_environment_intent').get()).toEqual({ n: 0 })
})
it('ignores a success reply after binding changes during send and preserves unknown', async () => {
  const row = await prepare(),
    original = f.admin.stageEnvironment
  vi.spyOn(f.admin, 'stageEnvironment').mockImplementation(async (...args) => {
    const result = await original(...args)
    f.vault.disable(f.bindingId, 2)
    return result
  })
  await expect(f.main.send(row.request_key)).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
  expect(f.db.prepare('SELECT state,result_json FROM desktop_environment_intent').get()).toEqual({
    state: 'outcome_unknown',
    result_json: null
  })
})
it.each(['key', 'tag', 'scope'] as const)(
  'rejects local %s tamper before remote mutation',
  async (change) => {
    const row = await prepare(),
      send = vi.spyOn(f.admin, 'stageEnvironment')
    if (change === 'key')
      f.main = new DesktopProductEnvironment(
        f.db,
        new AesGcmCredentialCipher(randomBytes(32)),
        f.vault,
        f.projects,
        f.admin
      )
    else {
      f.db.exec('DROP TRIGGER desktop_environment_intent_immutable')
      if (change === 'tag') f.db.exec('UPDATE desktop_environment_intent SET auth_tag=zeroblob(16)')
      else
        f.db.exec(
          "UPDATE desktop_environment_intent SET context_json=json_set(context_json,'$.request.expected_latest_revision',9)"
        )
    }
    await expect(f.main.send(row.request_key)).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
    expect(send).not.toHaveBeenCalled()
  }
)
it('does not accept unexpected metadata or duplicate concurrent sends', async () => {
  const row = await prepare(),
    original = f.admin.stageEnvironment
  let finish!: () => void
  vi.spyOn(f.admin, 'stageEnvironment').mockImplementation(async (...args) => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return { ...(await original(...args)), request_key: '11111111-1111-4111-8111-111111111111' }
  })
  const first = f.main.send(row.request_key)
  await expect(f.main.send(row.request_key)).rejects.toThrow('ENVIRONMENT_BUSY')
  finish()
  await expect(first).rejects.toThrow('ENVIRONMENT_UNAVAILABLE')
  expect(f.main.list(f.projectKey)[0].state).toBe('outcome_unknown')
})
it('blocks caller transactions and retains journal immutability', async () => {
  const row = await prepare()
  expect(() => f.db.exec('UPDATE desktop_environment_intent SET binding_revision=9')).toThrow(
    'DESKTOP_ENVIRONMENT_INTENT_IMMUTABLE'
  )
  f.db.exec('BEGIN')
  try {
    await expect(f.main.send(row.request_key)).rejects.toThrow('ENVIRONMENT_REQUEST_INVALID')
    await expect(prepare()).rejects.toThrow('ENVIRONMENT_REQUEST_INVALID')
  } finally {
    f.db.exec('ROLLBACK')
  }
})
