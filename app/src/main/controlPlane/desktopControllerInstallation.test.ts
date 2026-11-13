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
import { DesktopControllerVault } from './desktopControllerVault'
import * as releaseModule from './controllerRelease'
import { evaluateControllerHost } from './controllerHostPreflight'
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
  vi.restoreAllMocks()
  vi.useRealTimers()
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
})

it('onboarding binding preparation reuses the durable UUID across separate SQLite connections', async () => {
  const key = await prepare()
  await journal.send(key, 'transfer', true)
  await journal.send(key, 'install', true)
  const db2 = new Database(join(directory, 'opspilot.db'))
  try {
    const a = new DesktopControllerService(db, cipher, ssh as unknown as SshManager, undefined, [
      release
    ])
    const b = new DesktopControllerService(db2, cipher, ssh as unknown as SshManager, undefined, [
      release
    ])
    const input = { installation_request_key: key, display_name: 'wizard', allow_write: false }
    const [first, second] = await Promise.all([
      a.prepareInstalledRegistration(input),
      b.prepareInstalledRegistration(input)
    ])
    expect(first.binding_id).toBe(second.binding_id)
    expect(first.installation).toEqual({ request_key: key, authority_revision: 1 })
    expect(db.prepare('SELECT count(*) n FROM desktop_controller_binding').get()).toEqual({ n: 1 })
    expect(ssh.openProductBootstrapChannel).not.toHaveBeenCalled()
    await expect(
      a.prepareInstalledRegistration({ ...input, allow_write: true })
    ).rejects.toMatchObject({ context: { cause: { message: 'IDEMPOTENCY_CONFLICT' } } })
    expect(db.prepare('SELECT count(*) n FROM desktop_controller_binding').get()).toEqual({ n: 1 })
  } finally {
    db2.close()
  }
})
it('onboarding does not silently pick among existing manual installed bindings', async () => {
  const { key, intent, vault } = await installedBinding()
  vault.prepare({ ...intent, binding_id: randomUUID() })
  const service = new DesktopControllerService(
    db,
    cipher,
    ssh as unknown as SshManager,
    undefined,
    [release]
  )
  await expect(
    service.prepareInstalledRegistration({
      installation_request_key: key,
      display_name: 'unit-service',
      allow_write: true
    })
  ).rejects.toMatchObject({ context: { cause: { message: 'IDEMPOTENCY_CONFLICT' } } })
  expect(db.prepare('SELECT count(*) n FROM desktop_controller_binding').get()).toEqual({ n: 2 })
})
const hostFacts = {
  format: 1 as const,
  system: 'Linux',
  architecture: 'x86_64',
  libc: 'glibc',
  libc_version: '2.39',
  uid: 0,
  available_memory_bytes: 1024 ** 3,
  free_disk_bytes: 8 * 1024 ** 3,
  systemd_system: true,
  systemd_user_bus: false,
  user_linger: false,
  installation_conflict: false
}
it.each(['fresh', 'nonroot', 'memory', 'existing', 'manual', 'changed'] as const)(
  'readonly preflight handles %s without granting a blocked install plan',
  async (kind) => {
    const manifest = { platform: 'linux-x64-glibc' as const, minimum_glibc: '2.39' }
    vi.spyOn(releaseModule, 'verifyControllerRelease').mockReturnValue(
      manifest as ReturnType<typeof releaseModule.verifyControllerRelease>
    )
    const facts = { ...hostFacts }
    if (kind === 'nonroot') {
      facts.uid = 1000
      facts.systemd_user_bus = true
      facts.user_linger = true
    }
    if (kind === 'memory') facts.available_memory_bytes = 100
    if (kind === 'existing' || kind === 'manual') facts.installation_conflict = true
    if (kind === 'existing')
      transport.discover.mockResolvedValue({
        state: 'discovered',
        request_key: randomUUID(),
        release_sha256: release.release_sha256,
        installer_sha256: release.installer_sha256
      })
    if (kind === 'manual')
      transport.discover.mockRejectedValue(new ControllerBootstrapError('BOOTSTRAP_CONFLICT'))
    const hostProbe = vi.fn(async () => {
      if (kind === 'changed')
        db.exec('UPDATE vps SET ssh_security_revision=ssh_security_revision+1 WHERE id=1')
      return evaluateControllerHost(facts, manifest)
    })
    const value = new DesktopControllerInstallations(db, ssh, [release], { transport, hostProbe })
    if (kind === 'changed')
      await expect(value.preflight(1, release.release_id)).rejects.toMatchObject({
        code: 'INSTALL_AUTHORITY_CHANGED'
      })
    else {
      const result = await value.preflight(1, release.release_id)
      expect(result.next).toBe(
        kind === 'fresh' ? 'install' : kind === 'existing' ? 'inspect_existing' : 'blocked'
      )
      if (result.next === 'blocked') expect(result.plan).toBeNull()
      expect(result.root_required).toBe(kind === 'nonroot')
    }
    expect(value.list()).toEqual([])
    expect(transport.transfer).not.toHaveBeenCalled()
    expect(transport.call).not.toHaveBeenCalled()
  }
)

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
it('migration028 upgrade preserves data and agrees with cumulative schema031', async () => {
  db.exec(
    'DROP TABLE IF EXISTS desktop_controller_authority_rebind;DELETE FROM schema_version WHERE version=31;DROP TABLE IF EXISTS desktop_controller_upgrade;DELETE FROM schema_version WHERE version=30;DROP TABLE desktop_controller_installation;DELETE FROM schema_version WHERE version=29'
  )
  runMigrations(db)
  expect(db.prepare('SELECT max(version) n FROM schema_version').get()).toEqual({ n: 33 })
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

async function installedBinding(): Promise<{
  key: string
  binding: string
  vault: DesktopControllerVault
  intent: ReturnType<DesktopControllerInstallations['bindingIntent']>
}> {
  const key = await prepare()
  await journal.send(key, 'transfer', true)
  await journal.send(key, 'install', true)
  const binding = randomUUID(),
    vault = new DesktopControllerVault(db, cipher)
  const intent = journal.bindingIntent(key, binding, 'unit-service', true)
  vault.prepare(intent)
  const created = new Date().toISOString(),
    expiry = new Date(Date.now() + 86400000).toISOString()
  vault.activate(binding, 1, {
    state: 'issued_once',
    controller_id: cid,
    client: {
      client_id: randomUUID(),
      controller_id: cid,
      display_name: 'unit-service',
      scopes: ['read', 'deploy:manual', 'policy:write'],
      created_at: created,
      revoked_at: null,
      token_expires_at: expiry
    },
    credential: {
      access_token: 'opspilot_' + randomBytes(32).toString('base64url'),
      token_type: 'Bearer',
      expires_at: expiry
    }
  })
  return { key, binding, vault, intent }
}
it('derives installed binding entirely from current journal and encrypts installation-bound token', async () => {
  const { key, binding, vault, intent } = await installedBinding()
  expect(intent.installation).toEqual({
    request_key: key,
    authority_revision: 1,
    release_sha256: release.release_sha256,
    installer_sha256: release.installer_sha256,
    runtime_uid: 1001
  })
  expect(vault.resolve(binding)).toMatchObject({ controllerId: cid })
  const token = vault.resolve(binding).accessToken
  const raw = db
    .prepare(
      'SELECT encrypted_secret,intent_json FROM desktop_controller_binding WHERE binding_id=?'
    )
    .get(binding) as { encrypted_secret: Buffer; intent_json: string }
  expect(raw.encrypted_secret.includes(Buffer.from(token))).toBe(false)
  expect(raw.intent_json).not.toContain(token)
})
it.each(['cipher', 'generation', 'unknown'] as const)(
  'fences installed binding when %s changes without silently rotating credentials',
  async (kind) => {
    const { key, binding, vault } = await installedBinding()
    const before = db
      .prepare('SELECT encrypted_secret FROM desktop_controller_binding WHERE binding_id=?')
      .get(binding)
    if (kind === 'cipher') db.exec("UPDATE vps SET encrypted_secret=X'02' WHERE id=1")
    if (kind === 'generation') {
      const plan = await journal.plan(1, release.release_id)
      journal.rebind(plan.plan_id, key, true)
    }
    if (kind === 'unknown') {
      transport.call.mockImplementation(async (input) => ({
        state: 'absent',
        ...input.locator,
        completed_files: 0,
        total_files: 0
      }))
      await journal.inspect(key)
    }
    expect(() => vault.intent(binding)).toThrow('BINDING_CHANGED')
    expect(() => vault.resolve(binding)).toThrow()
    expect(
      db
        .prepare('SELECT encrypted_secret FROM desktop_controller_binding WHERE binding_id=?')
        .get(binding)
    ).toEqual(before)
  }
)
it.each(['uid', 'pin', 'paths', 'request'] as const)(
  'rejects forged installed %s binding before prepare',
  async (kind) => {
    const { intent, vault } = await installedBinding()
    const forged = structuredClone(intent)
    forged.binding_id = randomUUID()
    if (kind === 'uid') forged.installation!.runtime_uid++
    if (kind === 'pin') forged.installation!.installer_sha256 = 'f'.repeat(64)
    if (kind === 'paths') forged.artifact_path = '/foreign/control-plane.cjs'
    if (kind === 'request') forged.installation!.request_key = randomUUID()
    expect(() => vault.prepare(forged)).toThrow('BINDING_CHANGED')
    expect(db.prepare('SELECT count(*) n FROM desktop_controller_binding').get()).toEqual({ n: 1 })
  }
)
