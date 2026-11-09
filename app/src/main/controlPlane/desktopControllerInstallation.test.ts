import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { initializeDatabase, closeDatabase, runMigrations } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { VpsRepository } from '../db/vpsRepository'
import {
  DesktopControllerInstallations,
  type DesktopInstallationOptions
} from './desktopControllerInstallation'
import { ControllerBootstrapError } from './controllerSshBootstrap'
import { DesktopControllerService } from './desktopControllerService'
import type { SshManager } from '../ssh/manager'
import type { ControllerInstallationResult } from '../../../../docs/contracts/product-controller-installation'

let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  journal: DesktopControllerInstallations,
  vps: VpsRepository,
  cipher: AesGcmCredentialCipher
const transport = {
  discover: vi.fn<NonNullable<DesktopInstallationOptions['transport']>['discover']>(),
  call: vi.fn<NonNullable<DesktopInstallationOptions['transport']>['call']>(),
  transfer: vi.fn<NonNullable<DesktopInstallationOptions['transport']>['transfer']>()
}
const release = {
  release_id: 'unit-linux22',
  release_directory: join(tmpdir(), 'catalog-release'),
  installer_path: join(tmpdir(), 'catalog-installer.cjs'),
  release_sha256: 'a'.repeat(64),
  installer_sha256: 'b'.repeat(64)
}
const ssh = { openProductBootstrapChannel: vi.fn() }
const cid = randomUUID()
function result(key: string): ControllerInstallationResult {
  return {
    format: 1,
    request_key: key,
    phase: 'installed',
    controller_id: cid,
    service_state: 'running',
    runtime_uid: 1001,
    service_enabled: true,
    artifact_path: '/opt/controller/payload/control-plane.cjs',
    node_path: '/opt/controller/node',
    data_directory: '/var/lib/controller',
    payload_sha256: 'c'.repeat(64)
  }
}
function createVps(): number {
  return vps.create({
    name: 'fixture',
    host: 'controller.test',
    port: 22,
    username: 'root',
    host_fingerprint: 'SHA256:' + 'A'.repeat(43),
    auth_type: 'key',
    credential: cipher.encrypt(randomBytes(32).toString('base64url'))
  }).id
}
async function prepare(): Promise<string> {
  return journal.prepare((await journal.plan(1, release.release_id)).plan_id).request_key
}
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'opspilot-install-journal-'))
  db = initializeDatabase(directory)
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  vps = new VpsRepository(db)
  createVps()
  transport.discover.mockResolvedValue({ state: 'absent' })
  transport.transfer.mockImplementation(async (input) => {
    input.assertCurrent()
    expect(
      db
        .prepare('SELECT state FROM desktop_controller_installation WHERE request_key=?')
        .get(input.locator.request_key)
    ).toMatchObject({ state: 'in_flight' })
    return { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
  })
  transport.call.mockImplementation(async (input) => {
    input.assertCurrent()
    if (input.operation === 'status')
      return { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
    return {
      state: 'installation_result',
      request_key: input.locator.request_key,
      installation: result(input.locator.request_key)
    }
  })
  journal = new DesktopControllerInstallations(db, ssh, [release], { transport })
})
afterEach(() => {
  vi.useRealTimers()
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
})

it('persists before dispatch, completes once, separates service state and prevents automatic replay', async () => {
  const key = await prepare()
  expect(transport.transfer).not.toHaveBeenCalled()
  await expect(journal.send(key, 'install', true)).rejects.toMatchObject({
    code: 'INSTALL_INSPECT_REQUIRED'
  })
  expect((await journal.send(key, 'transfer', true)).state).toBe('transferred')
  const installed = await journal.send(key, 'install', true)
  expect(installed).toMatchObject({ state: 'installed', controller_id: cid })
  await expect(journal.send(key, 'install', true)).rejects.toMatchObject({
    code: 'INSTALL_INSPECT_REQUIRED'
  })
  transport.call.mockImplementation(async (input) =>
    input.operation === 'status'
      ? { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
      : {
          state: 'installation_result',
          request_key: key,
          installation: { ...result(key), service_state: 'stopped' }
        }
  )
  expect((await journal.inspect(key)).last_result?.service_state).toBe('stopped')
  expect(transport.call.mock.calls.filter(([v]) => v.operation === 'install')).toHaveLength(1)
})
it('lost reply stays unknown until explicit inspect using the same UUID', async () => {
  const key = await prepare()
  await journal.send(key, 'transfer', true)
  transport.call.mockRejectedValueOnce(
    new ControllerBootstrapError('BOOTSTRAP_OUTCOME_UNKNOWN', true)
  )
  await expect(journal.send(key, 'install', true)).rejects.toMatchObject({
    code: 'BOOTSTRAP_OUTCOME_UNKNOWN'
  })
  expect(journal.list()[0].state).toBe('outcome_unknown')
  await expect(journal.send(key, 'install', true)).rejects.toMatchObject({
    code: 'INSTALL_INSPECT_REQUIRED'
  })
  expect((await journal.inspect(key)).controller_id).toBe(cid)
  expect(transport.call.mock.calls.filter(([v]) => v.operation === 'install')).toHaveLength(1)
})
it('discovery preserves existing UUID, requires BOTH catalog hashes, never executes candidate', async () => {
  const key = randomUUID()
  transport.discover.mockResolvedValue({
    state: 'discovered',
    request_key: key,
    release_sha256: release.release_sha256,
    installer_sha256: 'f'.repeat(64)
  })
  await expect(journal.plan(1, release.release_id)).rejects.toMatchObject({
    code: 'INSTALL_CATALOG_UNKNOWN'
  })
  expect(journal.list()).toEqual([])
  expect(transport.call).not.toHaveBeenCalled()
  transport.discover.mockResolvedValue({
    state: 'discovered',
    request_key: key,
    release_sha256: release.release_sha256,
    installer_sha256: release.installer_sha256
  })
  const plan = await journal.plan(1, release.release_id)
  expect(journal.prepare(plan.plan_id)).toMatchObject({
    request_key: key,
    state: 'outcome_unknown'
  })
  await expect(journal.send(key, 'install', true)).rejects.toMatchObject({
    code: 'INSTALL_INSPECT_REQUIRED'
  })
  expect((await journal.inspect(key)).request_key).toBe(key)
})
it('absence of staging never resets known identity or creates a fresh UUID', async () => {
  const key = await prepare()
  await journal.send(key, 'transfer', true)
  await journal.send(key, 'install', true)
  transport.call.mockImplementation(async (input) => ({
    state: 'absent',
    ...input.locator,
    completed_files: 0,
    total_files: 0
  }))
  expect(await journal.inspect(key)).toMatchObject({ state: 'outcome_unknown', controller_id: cid })
  const plan = await journal.plan(1, release.release_id)
  expect(plan.request_key).toBe(key)
  expect(journal.prepare(plan.plan_id).state).toBe('outcome_unknown')
  await journal.send(key, 'transfer', true)
  expect(journal.list()[0].state).toBe('outcome_unknown')
})
it('only definite installer NOT_FOUND with verified staging permits same-key install', async () => {
  const key = await prepare()
  transport.call.mockImplementation(async (input) => {
    if (input.operation === 'status')
      return { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
    throw new ControllerBootstrapError('BOOTSTRAP_NOT_FOUND')
  })
  expect((await journal.inspect(key)).state).toBe('transferred')
  expect(journal.list()[0].request_key).toBe(key)
})
it('partial install requires explicit recover and retains controller identity', async () => {
  const key = await prepare()
  await journal.send(key, 'transfer', true)
  transport.call.mockResolvedValueOnce({
    state: 'installation_result',
    request_key: key,
    installation: { ...result(key), phase: 'unit_pending', service_state: 'not_installed' }
  })
  expect((await journal.send(key, 'install', true)).state).toBe('outcome_unknown')
  expect((await journal.send(key, 'recover', true)).state).toBe('installed')
  expect(transport.call.mock.calls.at(-1)?.[0]).toMatchObject({
    operation: 'recover',
    locator: { request_key: key }
  })
})
it('archive/re-add requires explicit fresh rebind, preserves UUID and CID and fences old authority', async () => {
  const key = await prepare()
  await journal.send(key, 'transfer', true)
  await journal.send(key, 'install', true)
  vps.delete(1)
  expect(journal.list()[0].controller_id).toBe(cid)
  await expect(journal.inspect(key)).rejects.toMatchObject({ code: 'INSTALL_AUTHORITY_CHANGED' })
  expect(createVps()).toBe(1)
  transport.discover.mockResolvedValue({
    state: 'discovered',
    request_key: key,
    release_sha256: release.release_sha256,
    installer_sha256: release.installer_sha256
  })
  const plan = await journal.plan(1, release.release_id)
  expect(plan.rebind_required).toBe(true)
  expect(() => journal.prepare(plan.plan_id)).toThrow('INSTALL_REBIND_REQUIRED')
  expect(journal.rebind(plan.plan_id, key, true)).toMatchObject({
    request_key: key,
    controller_id: cid,
    authority_revision: 2,
    state: 'outcome_unknown'
  })
  expect((await journal.inspect(key)).state).toBe('installed')
})
it('same-process instances serialize while a different session fences a suspended actor', async () => {
  const key = await prepare()
  let resolve!: () => void
  const wait = new Promise<void>((done) => {
    resolve = done
  })
  transport.transfer.mockImplementationOnce(async (input) => {
    await wait
    input.assertCurrent()
    return { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
  })
  const pending = journal.send(key, 'transfer', true)
  const db2 = new Database(join(directory, 'opspilot.db'))
  try {
    const same = new DesktopControllerInstallations(db2, ssh, [release], { transport })
    expect(same.list()[0].state).toBe('in_flight')
    await expect(same.send(key, 'transfer', true)).rejects.toMatchObject({ code: 'INSTALL_BUSY' })
    const cold = new DesktopControllerInstallations(db2, ssh, [release], {
      transport,
      sessionId: randomUUID()
    })
    expect(cold.list()[0].state).toBe('outcome_unknown')
    resolve()
    await expect(pending).rejects.toMatchObject({ code: 'INSTALL_AUTHORITY_CHANGED' })
    expect(cold.list()[0].state).toBe('outcome_unknown')
  } finally {
    resolve()
    db2.close()
  }
})
it.each(['cipher', 'revision', 'host', 'pin', 'principal', 'archived'] as const)(
  'rejects %s changes after review and before sending bytes',
  async (field) => {
    const key = await prepare()
    const changes = {
      cipher: "encrypted_secret=X'02'",
      revision: 'ssh_security_revision=ssh_security_revision+1',
      host: "host='other.test'",
      pin: "host_fingerprint='SHA256:" + 'B'.repeat(43) + "'",
      principal: "username='other'",
      archived: "archived_at='2026-11-08T00:00:00Z'"
    }
    db.exec('UPDATE vps SET ' + changes[field] + ' WHERE id=1')
    await expect(journal.send(key, 'transfer', true)).rejects.toMatchObject({
      code: 'INSTALL_AUTHORITY_CHANGED'
    })
    expect(transport.transfer).not.toHaveBeenCalled()
  }
)
it('rechecks authority after discovery await and expires plan without durable or remote writes', async () => {
  transport.discover.mockImplementationOnce(async (input) => {
    db.exec('UPDATE vps SET ssh_security_revision=ssh_security_revision+1 WHERE id=1')
    input.assertCurrent()
    return { state: 'absent' }
  })
  await expect(journal.plan(1, release.release_id)).rejects.toMatchObject({
    code: 'INSTALL_AUTHORITY_CHANGED'
  })
  const plan = await journal.plan(1, release.release_id)
  vi.useFakeTimers()
  vi.setSystemTime(Date.now() + 61000)
  expect(() => journal.prepare(plan.plan_id)).toThrow('INSTALL_PLAN_EXPIRED')
  expect(journal.list()).toEqual([])
})
it('rejects a late successful transfer after ciphertext changes and records unknown', async () => {
  const key = await prepare()
  transport.transfer.mockImplementationOnce(async (input) => {
    db.exec("UPDATE vps SET encrypted_secret=X'02' WHERE id=1")
    return { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
  })
  await expect(journal.send(key, 'transfer', true)).rejects.toMatchObject({
    code: 'INSTALL_AUTHORITY_CHANGED'
  })
  expect(journal.list()[0].state).toBe('outcome_unknown')
  expect(transport.call).not.toHaveBeenCalled()
})
it('does not accept a different controller ID after a known receipt or reset metadata on NOT_FOUND', async () => {
  const key = await prepare()
  await journal.send(key, 'transfer', true)
  await journal.send(key, 'install', true)
  transport.call
    .mockImplementationOnce(async (input) => ({
      state: 'verified',
      ...input.locator,
      completed_files: 1,
      total_files: 1
    }))
    .mockResolvedValueOnce({
      state: 'installation_result',
      request_key: key,
      installation: { ...result(key), controller_id: randomUUID() }
    })
  await expect(journal.inspect(key)).rejects.toMatchObject({ code: 'INSTALL_CONFLICT' })
  expect(journal.list()[0]).toMatchObject({ state: 'outcome_unknown', controller_id: cid })
  transport.call.mockImplementation(async (input) => {
    if (input.operation === 'status')
      return { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
    throw new ControllerBootstrapError('BOOTSTRAP_NOT_FOUND')
  })
  await expect(journal.inspect(key)).rejects.toMatchObject({ code: 'BOOTSTRAP_NOT_FOUND' })
  expect(journal.list()[0].controller_id).toBe(cid)
  await expect(journal.send(key, 'install', true)).rejects.toMatchObject({
    code: 'INSTALL_INSPECT_REQUIRED'
  })
})
it('requires a fresh same-identity rebind plan and does not alter API token bindings', async () => {
  const key = await prepare()
  const old = await journal.plan(1, release.release_id)
  db.exec('UPDATE vps SET ssh_security_revision=ssh_security_revision+1 WHERE id=1')
  expect(() => journal.rebind(old.plan_id, key, true)).toThrow('INSTALL_AUTHORITY_CHANGED')
  const fresh = await journal.plan(1, release.release_id)
  journal.rebind(fresh.plan_id, key, true)
  expect(() => journal.rebind(fresh.plan_id, key, true)).toThrow('INSTALL_PLAN_EXPIRED')
  expect(db.prepare('SELECT count(*) n FROM desktop_controller_binding').get()).toEqual({ n: 0 })
  expect(journal.list()[0]).toMatchObject({
    request_key: key,
    authority_revision: 2,
    state: 'outcome_unknown'
  })
})
it('respects caller transaction ownership and requires explicit consent', async () => {
  const plan = await journal.plan(1, release.release_id)
  db.exec('BEGIN')
  try {
    expect(() => journal.prepare(plan.plan_id)).toThrow('INSTALL_BUSY')
    expect(db.inTransaction).toBe(true)
  } finally {
    db.exec('ROLLBACK')
  }
  const row = journal.prepare(plan.plan_id)
  await expect(journal.send(row.request_key, 'transfer', false as true)).rejects.toMatchObject({
    code: 'INSTALL_INPUT_INVALID'
  })
  expect(transport.transfer).not.toHaveBeenCalled()
})
it('cancels only never-dispatched intent; sanitized metadata excludes credentials and local paths', async () => {
  const key = await prepare()
  expect(journal.cancel(key).state).toBe('cancelled')
  const second = await prepare()
  expect(second).not.toBe(key)
  await journal.send(second, 'transfer', true)
  expect(() => journal.cancel(second)).toThrow('INSTALL_CONFLICT')
  const text = JSON.stringify(journal.list())
  for (const forbidden of [
    'principal_json',
    'credential_digest',
    'encrypted_secret',
    'catalog-installer',
    'catalog-release'
  ])
    expect(text).not.toContain(forbidden)
})
it('DB constraints retain tombstones and reject pin/key/CID changes, invalid authority and state rollback', async () => {
  const key = await prepare()
  await journal.send(key, 'transfer', true)
  await journal.send(key, 'install', true)
  for (const set of [
    "release_sha256='" + 'f'.repeat(64) + "'",
    "controller_id='" + randomUUID() + "'",
    "state='prepared'",
    'authority_revision=authority_revision+2',
    'ever_dispatched=0'
  ])
    expect(() => db.exec('UPDATE desktop_controller_installation SET ' + set)).toThrow()
  vps.delete(1)
  expect(journal.list()[0]).toMatchObject({ request_key: key, controller_id: cid })
})
it('migration028 upgrade preserves data and agrees with cumulative schema029', async () => {
  db.exec('DROP TABLE desktop_controller_installation;DELETE FROM schema_version WHERE version=29')
  runMigrations(db)
  expect(db.prepare('SELECT max(version) n FROM schema_version').get()).toEqual({ n: 29 })
  expect(vps.getById(1).name).toBe('fixture')
  const reference = new Database(':memory:')
  try {
    reference.exec(readFileSync(join(__dirname, '../../../../docs/contracts/schema.sql'), 'utf8'))
    expect(db.pragma('table_info(desktop_controller_installation)')).toEqual(
      reference.pragma('table_info(desktop_controller_installation)')
    )
    const triggers = (sql: Database.Database): unknown =>
      sql
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE tbl_name='desktop_controller_installation' AND type='trigger' ORDER BY name"
        )
        .all()
    expect(triggers(db)).toEqual(triggers(reference))
  } finally {
    reference.close()
  }
})
it('Main service exposes journal metadata and stable errors without opening SSH for an unknown release', async () => {
  const service = new DesktopControllerService(
    db,
    cipher,
    ssh as unknown as SshManager,
    undefined,
    [release]
  )
  const key = await prepare()
  expect(await service.listInstallations()).toMatchObject([{ request_key: key, state: 'prepared' }])
  await expect(service.planInstallation(1, 'unknown')).rejects.toMatchObject({
    context: { cause: { message: 'INSTALL_CATALOG_UNKNOWN' } }
  })
  expect(ssh.openProductBootstrapChannel).not.toHaveBeenCalled()
  expect((await service.cancelInstallation(key)).state).toBe('cancelled')
})
