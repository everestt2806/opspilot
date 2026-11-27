import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { closeDatabase, runMigrations } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { fixture } from '../../../scripts/product-project-reconnection-desktop-lab/fixture'
import { DesktopProjectReconnections } from './desktopProjectReconnection'
import { ProductPostgresRepository } from '../db/productPostgresRepository'
import { ProductPostgresSelection } from './productPostgresSelection'

let directory: string, f: Awaited<ReturnType<typeof fixture>>
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-reconnection-main-'))
  f = await fixture(directory)
})
afterEach(() => {
  f?.remote.close()
  closeDatabase()
  rmSync(directory, { recursive: true })
})
const review = (): ReturnType<DesktopProjectReconnections['review']> =>
  f.subject.review({ binding_id: f.bindingId, app_id: 42 })
const confirm = async (): ReturnType<DesktopProjectReconnections['confirm']> =>
  f.subject.confirm({ plan_id: (await review()).plan_id, consent: true })
const rows = (): number =>
  (f.db.prepare('SELECT count(*) n FROM desktop_project_reconnection').get() as { n: number }).n
const legacy = (): string =>
  JSON.stringify(
    [
      'desktop_project_setup',
      'desktop_environment_intent',
      'desktop_environment_selection',
      'desktop_postgres_intent'
    ].map((name) => f.db.prepare(`SELECT * FROM ${name}`).all())
  )

it('applies039 only to Desktop; upgrading038 preserves all legacy rows and is idempotent', () => {
  expect(f.db.prepare('SELECT max(version) v FROM schema_version').get()).toEqual({ v: 39 })
  expect(f.remote.prepare('SELECT max(version) v FROM schema_version').get()).toEqual({ v: 37 })
  expect(
    f.remote
      .prepare("SELECT name FROM sqlite_master WHERE name='desktop_project_reconnection'")
      .get()
  ).toBeUndefined()
  const old = legacy()
  f.db.exec('DROP TABLE desktop_project_reconnection;DELETE FROM schema_version WHERE version=39')
  runMigrations(f.db)
  runMigrations(f.db)
  expect(legacy()).toBe(old)
  expect(rows()).toBe(0)
  expect(f.db.pragma('foreign_key_check')).toEqual([])
})
it('reviews without writing then requires explicit consent before creating authenticated provenance', async () => {
  const before = legacy(),
    p = await review()
  expect(rows()).toBe(0)
  await expect(f.subject.confirm({ plan_id: p.plan_id, consent: false } as never)).rejects.toThrow(
    'RECONNECTION_REQUEST_INVALID'
  )
  expect(rows()).toBe(0)
  const result = await f.subject.confirm({ plan_id: p.plan_id, consent: true })
  expect(result).toMatchObject({
    provenance: 'explicit_reconnection_v1',
    app_id: 42,
    execution: 'fresh_review_required',
    context: p.context
  })
  expect(result.request_key).not.toBe(f.projectKey)
  expect(
    f.db.prepare('SELECT 1 FROM desktop_project_setup WHERE request_key=?').get(result.request_key)
  ).toBeUndefined()
  expect(legacy()).toBe(before)
  expect(f.subject.get(result.request_key)).toEqual(result)
  expect(f.subject.latest(f.bindingId, 42)).toEqual(result)
  expect(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
})
it('keeps history encrypted and makes confirmation idempotent across plans and process recreation', async () => {
  const result = await confirm()
  const r = f.db.prepare('SELECT * FROM desktop_project_reconnection').get() as {
    encrypted_secret: Buffer
  }
  expect(r.encrypted_secret.toString()).not.toContain('github.com')
  f.subject = f.make()
  expect(f.subject.get(result.request_key)).toEqual(result)
  expect(await f.subject.current(result.request_key)).toEqual(result)
  expect((await confirm()).request_key).toBe(result.request_key)
  expect(rows()).toBe(1)
})
it('expires plans before dispatch and after slow remote review, and loses unconfirmed plans on restart', async () => {
  const p = await review(),
    reads = f.calls.reads
  f.clock.now += 60000
  await expect(f.subject.confirm({ plan_id: p.plan_id, consent: true })).rejects.toThrow(
    'RECONNECTION_REVIEW_EXPIRED'
  )
  expect(f.calls.reads).toBe(reads)
  const next = await review()
  f.behavior.beforeReply = () => {
    f.clock.now += 60000
  }
  await expect(f.subject.confirm({ plan_id: next.plan_id, consent: true })).rejects.toThrow(
    'RECONNECTION_REVIEW_EXPIRED'
  )
  expect(rows()).toBe(0)
  f.behavior.beforeReply = undefined
  const old = await review()
  f.subject = f.make()
  await expect(f.subject.confirm({ plan_id: old.plan_id, consent: true })).rejects.toThrow(
    'RECONNECTION_REVIEW_EXPIRED'
  )
})
it('does not write a journal on lost read replies; the same plan can safely recheck', async () => {
  const p = await review()
  f.behavior.fail = true
  await expect(f.subject.confirm({ plan_id: p.plan_id, consent: true })).rejects.toThrow(
    'RECONNECTION_UNAVAILABLE'
  )
  expect(rows()).toBe(0)
  f.behavior.fail = false
  await f.subject.confirm({ plan_id: p.plan_id, consent: true })
  expect(rows()).toBe(1)
})
it('refuses a changed binding/token scope during an async reply without committing', async () => {
  const p = await review()
  f.behavior.beforeReply = () => {
    f.vault.disable(f.bindingId, f.vault.get(f.bindingId).revision)
  }
  await expect(f.subject.confirm({ plan_id: p.plan_id, consent: true })).rejects.toThrow(
    'RECONNECTION_CHANGED'
  )
  expect(rows()).toBe(0)
})
it('refuses remote policy/owner/source/target drift rather than silently accepting a new snapshot', async () => {
  const p = await review()
  f.remote.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
  await expect(f.subject.confirm({ plan_id: p.plan_id, consent: true })).rejects.toThrow(
    'RECONNECTION_CHANGED'
  )
  expect(rows()).toBe(0)
})
it('keeps old confirmation as history but refuses to use it after source advances elsewhere', async () => {
  const result = await confirm(),
    c = result.context
  const request = {
    format: 1 as const,
    request_key: randomUUID(),
    scope: c.scope,
    expected_source_generation: c.source.generation,
    expected_source_config_sha256: c.source.config_sha256
  }
  const pg = new ProductPostgresRepository(f.remote, f.remoteCipher).prepare(
    request,
    f.controllerId,
    'unix:1000'
  )
  new ProductPostgresSelection(f.remote, f.remoteCipher).select(
    { ...request, database_id: pg.metadata.database_id },
    f.controllerId,
    'unix:1000'
  )
  expect(f.subject.get(result.request_key)).toEqual(result)
  await expect(f.subject.current(result.request_key)).rejects.toThrow('RECONNECTION_CHANGED')
  expect(rows()).toBe(1)
})
it('finds an authenticated matching consent after policy A to B to A without treating latest history as current', async () => {
  const a = await confirm()
  f.remote.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
  const b = await confirm()
  f.remote.exec("UPDATE product_app_control SET auto_deploy_paused=1,pause_reason='operator'")
  expect(f.subject.latest(f.bindingId, 42)?.request_key).toBe(b.request_key)
  const plan = await review()
  expect(plan.matching_confirmation_key).toBe(a.request_key)
  expect((await f.subject.current(plan.matching_confirmation_key!)).request_key).toBe(a.request_key)
  expect((await f.subject.confirm({ plan_id: plan.plan_id, consent: true })).request_key).toBe(
    a.request_key
  )
  expect(rows()).toBe(2)
})
it('requires another consent for a new valid source and preserves both records', async () => {
  const first = await confirm()
  f.remote.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
  const next = await confirm()
  expect(next.request_key).not.toBe(first.request_key)
  expect(rows()).toBe(2)
})
it('bounds pending reviews and rejects caller-owned snapshots/paths', async () => {
  await expect(
    f.subject.review({ binding_id: f.bindingId, app_id: 42, artifact: '/untrusted' } as never)
  ).rejects.toThrow('RECONNECTION_REQUEST_INVALID')
  for (let i = 0; i < 64; i++) await review()
  await expect(review()).rejects.toThrow('RECONNECTION_BUSY')
  f.clock.now += 60000
  await expect(review()).resolves.toHaveProperty('plan_id')
})
it('prevents concurrent confirmation of one plan and deduplicates distinct plans atomically', async () => {
  const p = await review()
  let release!: () => void
  f.behavior.beforeReply = () =>
    new Promise<void>((resolve) => {
      release = resolve
    })
  const first = f.subject.confirm({ plan_id: p.plan_id, consent: true })
  await Promise.resolve()
  await expect(f.subject.confirm({ plan_id: p.plan_id, consent: true })).rejects.toThrow(
    'RECONNECTION_BUSY'
  )
  release()
  await first
  f.behavior.beforeReply = undefined
  const a = await review(),
    b = await review()
  const [x, y] = await Promise.all([
    f.subject.confirm({ plan_id: a.plan_id, consent: true }),
    f.subject.confirm({ plan_id: b.plan_id, consent: true })
  ])
  expect(x.request_key).toBe(y.request_key)
  expect(rows()).toBe(1)
})
it('retains append-only records and detects SQL outer-row/ciphertext copying or foreign purposes', async () => {
  const r = await confirm()
  expect(() => f.db.prepare('DELETE FROM desktop_project_reconnection').run()).toThrow(
    'DESKTOP_PROJECT_RECONNECTION_RETAIN'
  )
  expect(() => f.db.prepare('UPDATE desktop_project_reconnection SET app_id=43').run()).toThrow(
    'DESKTOP_PROJECT_RECONNECTION_IMMUTABLE'
  )
  f.db.exec('DROP TRIGGER desktop_project_reconnection_immutable')
  f.db.prepare('UPDATE desktop_project_reconnection SET app_id=43').run()
  expect(() => f.subject.get(r.request_key)).toThrow('RECONNECTION_UNAVAILABLE')
})
it('refuses another cipher after restart and refuses using a confirmed record after binding is disabled', async () => {
  const r = await confirm()
  const foreign = new DesktopProjectReconnections(
    f.db,
    new AesGcmCredentialCipher(randomBytes(32)),
    f.vault,
    f.admin
  )
  expect(() => foreign.get(r.request_key)).toThrow('RECONNECTION_UNAVAILABLE')
  f.vault.disable(f.bindingId, f.vault.get(f.bindingId).revision)
  expect(() => f.subject.get(r.request_key)).toThrow('RECONNECTION_UNAVAILABLE')
})
it('rejects copying a valid encrypted record to another request or app', async () => {
  await confirm()
  const copyKey = randomUUID()
  f.db
    .prepare(
      `INSERT INTO desktop_project_reconnection
    SELECT ?,provenance,binding_id,binding_revision,controller_id,app_id+1,snapshot_sha256,
    crypto_scheme,encrypted_secret,iv,auth_tag,confirmed_at FROM desktop_project_reconnection`
    )
    .run(copyKey)
  expect(() => f.subject.get(copyKey)).toThrow('RECONNECTION_UNAVAILABLE')
})
it.each(['ciphertext', 'purpose'])(
  'refuses %s tampering without exposing crypto errors',
  async (kind) => {
    const result = await confirm()
    const row = f.db.prepare('SELECT * FROM desktop_project_reconnection').get() as {
      crypto_scheme: 'aes_256_gcm'
      encrypted_secret: Buffer
      iv: Buffer
      auth_tag: Buffer
    }
    f.db.exec('DROP TRIGGER desktop_project_reconnection_immutable')
    if (kind === 'ciphertext')
      f.db.exec('UPDATE desktop_project_reconnection SET auth_tag=zeroblob(16)')
    else {
      const packet = JSON.parse(f.cipher.decrypt(row))
      packet.purpose = 'different-authenticated-purpose'
      const next = f.cipher.encrypt(JSON.stringify(packet))
      f.db
        .prepare('UPDATE desktop_project_reconnection SET encrypted_secret=?,iv=?,auth_tag=?')
        .run(next.encrypted_secret, next.iv, next.auth_tag)
    }
    expect(() => f.subject.get(result.request_key)).toThrow('RECONNECTION_UNAVAILABLE')
  }
)
it('rejects confirmation inside a caller transaction without committing their work', async () => {
  const p = await review()
  f.db.exec('BEGIN')
  try {
    await expect(f.subject.confirm({ plan_id: p.plan_id, consent: true })).rejects.toThrow(
      'RECONNECTION_REQUEST_INVALID'
    )
    expect(f.db.inTransaction).toBe(true)
  } finally {
    f.db.exec('ROLLBACK')
  }
  expect(rows()).toBe(0)
})
