import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, it, expect } from 'vitest'
import { fixture } from '../../../scripts/product-project-reconnection-ui-lab/fixture'
import { closeDatabase } from '../db'
import type { DesktopReconnectedPostgresInspectionInput } from '@shared/desktopReconnectedPostgresInspection'

let f: Awaited<ReturnType<typeof fixture>>,
  directory: string,
  input: DesktopReconnectedPostgresInspectionInput
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-reconnection-inspector-'))
  f = await fixture(directory)
  const plan = await f.subject.review({ binding_id: f.bindingId, app_id: 42 })
  const r = await f.subject.confirm({ plan_id: plan.plan_id, consent: true })
  input = {
    reconnection_request_key: r.request_key,
    expected_binding_revision: r.binding_revision,
    expected_snapshot_sha256: r.snapshot_sha256,
    database_id: f.pg.metadata.database_id,
    read: { operation: 'tables' }
  }
})
afterEach(() => {
  f?.remote.close()
  closeDatabase()
  rmSync(directory, { recursive: true })
})
it('reads source2 PG through authenticated reconnection without adding registration/selection receipts or samples', async () => {
  const old = f.db.serialize(),
    remote = f.remote.serialize()
  const result = await f.reader.read(input)
  expect(result.context.source_generation).toBe(2)
  expect(result.reconnection_request_key).toBe(input.reconnection_request_key)
  expect(result.snapshot_sha256).toBe(input.expected_snapshot_sha256)
  expect(result.data).toHaveLength(1)
  expect(f.db.serialize()).toEqual(old)
  expect(f.remote.serialize()).toEqual(remote)
  expect(
    f.db
      .prepare('SELECT 1 FROM desktop_project_setup WHERE request_key=?')
      .get(input.reconnection_request_key)
  ).toBeUndefined()
})
it('rejects foreign receipt, database, revision, digest and caller fields before target read', async () => {
  for (const changed of [
    { ...input, reconnection_request_key: f.projectKey },
    { ...input, database_id: '99999999-9999-4999-8999-999999999999' },
    { ...input, expected_binding_revision: 99 },
    { ...input, expected_snapshot_sha256: 'f'.repeat(64) },
    { ...input, artifact: '/tmp/caller' },
    { ...input, read: { operation: 'sql', query: 'SELECT 1' } }
  ])
    await expect(f.reader.read(changed as never)).rejects.toThrow()
  expect(f.reads.count).toBe(0)
})
it('does not release rows after remote policy drift during target I/O', async () => {
  f.reads.after = () => {
    f.remote.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
  }
  await expect(f.reader.read(input)).rejects.toThrow('RECONNECTION_CHANGED')
})
it('does not release rows after local binding is disabled during target I/O', async () => {
  f.reads.after = () => {
    f.vault.disable(f.bindingId, f.vault.get(f.bindingId).revision)
  }
  await expect(f.reader.read(input)).rejects.toThrow()
})
it('does not release data when the final metadata reply is unavailable', async () => {
  let n = 0
  f.behavior.beforeReply = () => {
    if (++n === 2) throw Error('SYNTHETIC_REPLY_LOST')
  }
  await expect(f.reader.read(input)).rejects.toThrow('RECONNECTION_UNAVAILABLE')
})
it('validates exact target response and bounded finite operations', async () => {
  const { DesktopReconnectedPostgresInspection } =
    await import('./desktopReconnectedPostgresInspection')
  const subject = new DesktopReconnectedPostgresInspection(f.subject, {
    inspectPostgres: async (...args) => {
      const result = await f.inspector.inspectPostgres(...args)
      return {
        ...result,
        instance: { ...result.instance, database_id: '99999999-9999-4999-8999-999999999999' }
      }
    }
  })
  await expect(subject.read(input)).rejects.toThrow('POSTGRES_INSPECTION_AUTHORITY_CHANGED')
  await expect(
    f.reader.read({
      ...input,
      read: { operation: 'rows', schema: 'public', table: 'notes', limit: 101 }
    })
  ).rejects.toThrow('POSTGRES_REQUEST_INVALID')
  const result = await f.reader.read({
    ...input,
    read: { operation: 'rows', schema: 'public', table: 'notes', limit: 10 }
  })
  expect(result.data).toHaveLength(2)
})
