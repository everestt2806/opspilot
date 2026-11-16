import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture } from '../../../scripts/product-environment-desktop-lab/fixture'
import { closeDatabase } from '../db'
import { ProductPostgresRepository } from '../db/productPostgresRepository'
import { ProductPostgresSelection } from './productPostgresSelection'
import { readProjectConfigurationContext } from './projectConfigurationContext'
import { DesktopProductPostgres } from './desktopProductPostgres'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import type {
  DesktopPostgresIntent,
  DesktopPostgresIntentInput
} from '@shared/desktopProductPostgres'
let root: string,
  f: Awaited<ReturnType<typeof fixture>>,
  subject: DesktopProductPostgres,
  store: ProductPostgresRepository,
  admin: Pick<
    DesktopControllerEnrollment,
    | 'postgresContext'
    | 'preparePostgres'
    | 'postgresPrepareState'
    | 'reviewPostgres'
    | 'selectPostgres'
    | 'postgresSelectionState'
  >,
  lostPrepare: boolean,
  lostSelect: boolean,
  failBefore: boolean
let prepareCalls = 0,
  selectCalls = 0
const make = (): DesktopProductPostgres =>
  new DesktopProductPostgres(f.db, f.cipher, f.vault, f.projects, admin)
const prepare = async (
  operation: 'prepare' | 'select' = 'prepare'
): Promise<DesktopPostgresIntent> => {
  const c = await subject.context(f.projectKey)
  const input = {
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256
  }
  return subject.prepare(
    operation === 'prepare'
      ? { ...input, operation }
      : { ...input, operation, database_id: c.database.prepared!.database_id }
  )
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-desktop-pg-'))
  f = await fixture(root)
  lostPrepare = false
  lostSelect = false
  failBefore = false
  prepareCalls = 0
  selectCalls = 0
  store = new ProductPostgresRepository(f.remote, f.remoteCipher)
  admin = {
    postgresContext: async (_id, input) =>
      readProjectConfigurationContext(f.remote, f.remoteCipher, f.controllerId, 'unix:1000', input),
    preparePostgres: async (_id, input, guard) => {
      guard()
      prepareCalls++
      if (failBefore) throw Error('SYNTHETIC_TRANSPORT_FAILURE')
      const result = store.prepare(input, f.controllerId, 'unix:1000')
      if (lostPrepare) {
        lostPrepare = false
        throw Error('SYNTHETIC_LOST_REPLY')
      }
      return result
    },
    postgresPrepareState: async (_id, input) =>
      store.lookupPrepare(input, f.controllerId, 'unix:1000'),
    reviewPostgres: async (_id, input) =>
      new ProductPostgresSelection(f.remote, f.remoteCipher).review(
        input,
        f.controllerId,
        'unix:1000'
      ),
    selectPostgres: async (_id, input, guard) => {
      guard()
      selectCalls++
      const result = new ProductPostgresSelection(f.remote, f.remoteCipher).select(
        input,
        f.controllerId,
        'unix:1000'
      )
      if (lostSelect) {
        lostSelect = false
        throw Error('SYNTHETIC_LOST_REPLY')
      }
      return result
    },
    postgresSelectionState: async (_id, input) =>
      new ProductPostgresSelection(f.remote, f.remoteCipher).lookup(
        input,
        f.controllerId,
        'unix:1000'
      )
  }
  subject = make()
})
afterEach(() => {
  closeDatabase()
  f.remote.close()
  rmSync(root, { recursive: true })
  vi.restoreAllMocks()
})
it('prepares stable server metadata through an authenticated local journal without exposing a credential or provisioning app', async () => {
  const row = await prepare(),
    result = await subject.send(row.request_key)
  expect(result).toMatchObject({
    operation: 'prepare',
    state: 'resource_prepared',
    result: { metadata: { provisioning: 'prepared', engine: 'postgresql' } }
  })
  expect(prepareCalls).toBe(1)
  const context = await subject.context(f.projectKey)
  expect(context.database.prepared?.database_id).toBe(result.database_id)
  expect(context.database.selected).toBeNull()
  const scope = readProjectConfigurationContext(
    f.remote,
    f.remoteCipher,
    f.controllerId,
    'unix:1000',
    {
      format: 1,
      controller_id: f.controllerId,
      app_id: 42,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: f.projects.registeredContext(f.projectKey).registration
        .source_config_sha256,
      expected_target_security_revision: 1
    }
  ).scope
  const credentials = store.readCredentials(scope, result.database_id!)
  const dto = JSON.stringify({ row, result, context, list: subject.list(f.projectKey) })
  for (const value of Object.values(credentials)) {
    expect(dto).not.toContain(value)
    expect(f.db.serialize().includes(Buffer.from(value))).toBe(false)
  }
  expect(dto).not.toContain('encrypted_secret')
  expect(dto).not.toContain('target_binding_json')
  expect(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
})
it('cold-recovers a lost prepare reply through exact lookup, preserving UUID and refusing resend', async () => {
  const row = await prepare()
  lostPrepare = true
  await expect(subject.send(row.request_key)).rejects.toThrow('POSTGRES_UNAVAILABLE')
  subject = make()
  expect(subject.list(f.projectKey)[0].state).toBe('outcome_unknown')
  await expect(subject.send(row.request_key)).rejects.toThrow('POSTGRES_CONFLICT')
  expect((await subject.check(row.request_key)).state).toBe('resource_prepared')
  expect(prepareCalls).toBe(1)
  expect(f.remote.prepare('SELECT count(*) n FROM product_managed_postgres_request').get()).toEqual(
    { n: 1 }
  )
})
it('does not cancel or resend unknown absence, but accepts definitive source-advance negative proof', async () => {
  const row = await prepare()
  failBefore = true
  await expect(subject.send(row.request_key)).rejects.toThrow('POSTGRES_UNAVAILABLE')
  expect((await subject.check(row.request_key)).state).toBe('outcome_unknown')
  expect(() => subject.cancel(row.request_key)).toThrow('POSTGRES_CONFLICT')
  const basis = readProjectConfigurationContext(
    f.remote,
    f.remoteCipher,
    f.controllerId,
    'unix:1000',
    {
      format: 1,
      controller_id: f.controllerId,
      app_id: 42,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: row.source_config_sha256,
      expected_target_security_revision: 1
    }
  )
  const input = {
    format: 1 as const,
    request_key: randomUUID(),
    scope: basis.scope,
    expected_source_generation: 1,
    expected_source_config_sha256: row.source_config_sha256
  }
  const resource = store.prepare(input, f.controllerId, 'unix:1000')
  new ProductPostgresSelection(f.remote, f.remoteCipher).select(
    { ...input, request_key: randomUUID(), database_id: resource.metadata.database_id },
    f.controllerId,
    'unix:1000'
  )
  expect((await subject.check(row.request_key)).state).toBe('not_applied')
  expect(prepareCalls).toBe(1)
})
it('selects with an authenticated expected source hash and proves its own current receipt before adoption', async () => {
  await subject.send((await prepare()).request_key)
  const basis = f.projects.registeredContext(f.projectKey)
  const row = await prepare('select'),
    result = await subject.send(row.request_key)
  expect(result.state).toBe('selected')
  expect(selectCalls).toBe(1)
  const remote = await admin.postgresContext(f.bindingId, {
    format: 1,
    controller_id: f.controllerId,
    app_id: 42,
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    expected_source_config_sha256: basis.registration.source_config_sha256,
    expected_target_security_revision: 1
  })
  expect(await subject.confirmsSource(f.projectKey, remote)).toBe(true)
  expect(
    await subject.confirmsSource(f.projectKey, { ...remote, source_config_sha256: '0'.repeat(64) })
  ).toBe(false)
  expect(
    await subject.confirmsSource(f.projectKey, {
      ...remote,
      scope: { ...remote.scope, app_id: 43 }
    })
  ).toBe(false)
  expect(f.projects.registeredContext(f.projectKey)).toEqual(basis)
  expect(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
})
it('cold-recovers selection without another source generation or a second select request', async () => {
  await subject.send((await prepare()).request_key)
  const row = await prepare('select')
  lostSelect = true
  await expect(subject.send(row.request_key)).rejects.toThrow('POSTGRES_UNAVAILABLE')
  subject = make()
  expect((await subject.check(row.request_key)).state).toBe('selected')
  expect(selectCalls).toBe(1)
  expect(f.remote.prepare('SELECT source_generation FROM product_app_control').get()).toEqual({
    source_generation: 2
  })
})
it('reuses an identical prepared intent, cancels only before dispatch and enforces immutable SQL fields', async () => {
  const row = await prepare()
  expect((await prepare()).request_key).toBe(row.request_key)
  expect(() => f.db.prepare("UPDATE desktop_postgres_intent SET context_json='{}'").run()).toThrow(
    'DESKTOP_POSTGRES_INTENT_IMMUTABLE'
  )
  expect(subject.cancel(row.request_key).state).toBe('cancelled')
  expect((await prepare()).request_key).not.toBe(row.request_key)
})
it('rejects stale UI context and caller target/path/credential injection before creating an intent', async () => {
  const c = await subject.context(f.projectKey)
  const input: DesktopPostgresIntentInput = {
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    operation: 'prepare'
  }
  await expect(subject.prepare({ ...input, expected_source_generation: 2 })).rejects.toThrow(
    'POSTGRES_CHANGED'
  )
  await expect(
    subject.prepare({ ...input, artifact: '/bin/sh' } as DesktopPostgresIntentInput)
  ).rejects.toThrow('POSTGRES_REQUEST_INVALID')
  expect(f.db.prepare('SELECT count(*) n FROM desktop_postgres_intent').get()).toEqual({ n: 0 })
})
it('does not publish a success after the binding is disabled while the server reply is in flight', async () => {
  const row = await prepare(),
    original = admin.preparePostgres
  admin.preparePostgres = async (...args) => {
    const result = await original(...args)
    f.vault.disable(f.bindingId, 2)
    return result
  }
  await expect(subject.send(row.request_key)).rejects.toThrow('POSTGRES_UNAVAILABLE')
  expect(f.db.prepare('SELECT state FROM desktop_postgres_intent').get()).toEqual({
    state: 'outcome_unknown'
  })
})
it('authenticates stored results and leaves neither server credentials nor journal plaintext in SQLite', async () => {
  const row = await prepare(),
    result = await subject.send(row.request_key)
  const record = f.db.prepare('SELECT result_json FROM desktop_postgres_intent').get() as {
    result_json: string
  }
  expect(record.result_json).not.toContain(result.database_id!)
  f.db
    .prepare("UPDATE desktop_postgres_intent SET result_json='{}' WHERE request_key=?")
    .run(row.request_key)
  expect(() => subject.list(f.projectKey)).toThrow('POSTGRES_UNAVAILABLE')
  f.db.pragma('wal_checkpoint(TRUNCATE)')
  expect(
    readFileSync(join(root, 'desktop/opspilot.db')).includes(Buffer.from('administrator_password'))
  ).toBe(false)
})

it('keeps an unsent intent prepared when opening transport fails before its dispatch barrier', async () => {
  const row = await prepare(),
    original = admin.preparePostgres
  admin.preparePostgres = async () => {
    throw Error('SYNTHETIC_UNSENT_OPEN_FAILURE')
  }
  await expect(subject.send(row.request_key)).rejects.toThrow('POSTGRES_UNAVAILABLE')
  expect(subject.list(f.projectKey)[0].state).toBe('prepared')
  expect(prepareCalls).toBe(0)
  admin.preparePostgres = original
  expect((await subject.send(row.request_key)).state).toBe('resource_prepared')
  expect(prepareCalls).toBe(1)
})
