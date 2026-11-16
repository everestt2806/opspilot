import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { fixture } from '../../../scripts/product-postgres-desktop-lab/fixture'
import { closeDatabase } from '../db'
import { ProductEnvironmentSelection } from './productEnvironmentSelection'
import { ProductEnvironmentRepository } from '../db/productEnvironmentRepository'
let root: string, f: Awaited<ReturnType<typeof fixture>>
const database = async (): Promise<void> => {
  let c = await f.postgres.context(f.projectKey)
  const prepared = await f.postgres.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    operation: 'prepare'
  })
  await f.postgres.send(prepared.request_key)
  c = await f.postgres.context(f.projectKey)
  const selected = await f.postgres.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    operation: 'select',
    database_id: c.database.prepared!.database_id
  })
  await f.postgres.send(selected.request_key)
}
const environment = async (): Promise<void> => {
  let c = await f.main.context(f.projectKey)
  const staged = await f.main.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_latest_revision: c.latest?.revision ?? null,
    runtime_env: { APP_TOKEN: 'SYNTHETIC_COMBINED_ENV' },
    public_build_args: { NEXT_PUBLIC_TITLE: 'Combined fixture' }
  })
  await f.main.send(staged.request_key)
  c = await f.main.context(f.projectKey)
  const selected = await f.environmentSelections.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    expected_latest_revision: c.latest!.revision,
    environment_revision: c.latest!.revision
  })
  await f.environmentSelections.send(selected.request_key)
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-pg-env-main-'))
  f = await fixture(root)
})
afterEach(() => {
  closeDatabase()
  f.remote.close()
  rmSync(root, { recursive: true })
})
it.each(['database-first', 'environment-first'])(
  'follows only own authenticated source receipts through %s and keeps registration immutable',
  async (order) => {
    const before = f.projects.registeredContext(f.projectKey)
    if (order === 'database-first') {
      await database()
      await environment()
    } else {
      await environment()
      await database()
    }
    const current = await f.projects.currentContext(f.projectKey)
    expect(current.registration.source_generation).toBe(3)
    expect(f.projects.registeredContext(f.projectKey)).toEqual(before)
    expect(await f.main.context(f.projectKey)).toMatchObject({
      source_generation: 3,
      selected: { revision: 1 }
    })
    expect(await f.postgres.context(f.projectKey)).toMatchObject({
      source_generation: 3,
      database: { selected: { provisioning: 'prepared' } }
    })
    await environment()
    expect((await f.projects.currentContext(f.projectKey)).registration.source_generation).toBe(4)
    expect((await f.main.context(f.projectKey)).selected?.revision).toBe(2)
    expect(f.remote.prepare('SELECT count(*) n FROM product_managed_postgres').get()).toEqual({
      n: 1
    })
    expect(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
  }
)
it('blocks changes made elsewhere even when a stale positive own receipt remains', async () => {
  await database()
  await environment()
  const basis = f.projects.registeredContext(f.projectKey),
    remote = await f.pgAdmin.postgresContext(f.bindingId, {
      format: 1,
      controller_id: f.controllerId,
      app_id: 42,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: basis.registration.source_config_sha256,
      expected_target_security_revision: 1
    })
  const vault = new ProductEnvironmentRepository(f.remote, f.remoteCipher)
  vault.append({
    scope: remote.scope,
    expected_source_generation: remote.source_generation,
    expected_source_config_sha256: remote.source_config_sha256,
    expected_latest_revision: 1,
    values: { runtime_env: { APP_TOKEN: 'OTHER_OPERATOR_SYNTHETIC' }, public_build_args: {} }
  })
  new ProductEnvironmentSelection(f.remote, f.remoteCipher).select(
    {
      format: 1,
      request_key: randomUUID(),
      scope: remote.scope,
      expected_source_generation: remote.source_generation,
      expected_source_config_sha256: remote.source_config_sha256,
      expected_latest_revision: 2,
      environment_revision: 2
    },
    f.controllerId,
    'unix:1000'
  )
  await expect(f.projects.currentContext(f.projectKey)).rejects.toThrow('POSTGRES_CHANGED')
  await expect(f.main.context(f.projectKey)).rejects.toThrow('POSTGRES_CHANGED')
  // Explicitly reconfirming the displayed database is a new authenticated user intent,
  // not silently adopting another operator source or fabricating an ENV receipt.
  const c = await f.postgres.context(f.projectKey)
  const intent = await f.postgres.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    operation: 'select',
    database_id: c.database.selected!.database_id
  })
  await f.postgres.send(intent.request_key)
  expect((await f.projects.currentContext(f.projectKey)).registration.source_generation).toBe(4)
})
it('blocks ENV edits while a local database intent is pending', async () => {
  const c = await f.postgres.context(f.projectKey)
  await f.postgres.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    operation: 'prepare'
  })
  await expect(
    f.main.prepare({
      project_request_key: f.projectKey,
      expected_binding_revision: c.binding_revision,
      expected_latest_revision: null,
      runtime_env: { APP_TOKEN: 'SYNTHETIC_BLOCKED' },
      public_build_args: {}
    })
  ).rejects.toThrow('ENVIRONMENT_CONFLICT')
  expect(f.db.prepare('SELECT count(*) n FROM desktop_environment_intent').get()).toEqual({ n: 0 })
})
