import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { initializeDatabase } from '../db'
import { VpsRepository } from '../db/vpsRepository'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { DesktopControllerInstallations } from './desktopControllerInstallation'
import { DesktopControllerUpgrades, type DesktopUpgradeOptions } from './desktopControllerUpgrade'
import { ControllerBootstrapError } from './controllerSshBootstrap'
import * as releaseModule from './controllerRelease'
import { DesktopControllerVault } from './desktopControllerVault'
import { DesktopControllerService } from './desktopControllerService'
import type { ControllerInstallationResult } from '../../../../docs/contracts/product-controller-installation'
import type { ControllerUpgradeResult } from '../../../../docs/contracts/product-controller-upgrade'

const cid = randomUUID(),
  tool = Buffer.from('private fixture updater bytes'),
  toolPin = createHash('sha256').update(tool).digest('hex')
const old = {
  release_id: 'old',
  release_directory: join(tmpdir(), 'old-release'),
  installer_path: join(tmpdir(), 'old-tool'),
  release_sha256: 'a'.repeat(64),
  installer_sha256: toolPin
}
const target = {
  ...old,
  release_id: 'new',
  release_directory: join(tmpdir(), 'new-release'),
  release_sha256: 'd'.repeat(64)
}
const ssh = { openProductBootstrapChannel: vi.fn() }
const root = '/opt/fixture/installation'
let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  installations: DesktopControllerInstallations,
  upgrades: DesktopControllerUpgrades,
  installKey: string,
  cipher: AesGcmCredentialCipher
const remote = new Map<string, ControllerUpgradeResult>()
const transport = {
  call: vi.fn<NonNullable<DesktopUpgradeOptions['transport']>['call']>(),
  upgrade: vi.fn<NonNullable<DesktopUpgradeOptions['transport']>['upgrade']>(),
  transfer: vi.fn<NonNullable<DesktopUpgradeOptions['transport']>['transfer']>()
}
const original = (key: string): ControllerInstallationResult => ({
  format: 1,
  request_key: key,
  phase: 'installed',
  controller_id: cid,
  service_state: 'running',
  runtime_uid: 1001,
  service_enabled: true,
  artifact_path: root + '/runtime/payload/control-plane.cjs',
  node_path: root + '/runtime/node',
  data_directory: '/var/lib/fixture',
  payload_sha256: 'c'.repeat(64)
})
const installationTransport = {
  discover: vi.fn(async () => ({ state: 'absent' as const })),
  transfer: vi.fn(async (input: Parameters<typeof transport.transfer>[0]) => ({
    state: 'verified' as const,
    ...input.locator,
    completed_files: 1,
    total_files: 1
  })),
  call: vi.fn(async (input: Parameters<typeof transport.call>[0]) =>
    input.operation === 'status'
      ? { state: 'verified' as const, ...input.locator, completed_files: 1, total_files: 1 }
      : {
          state: 'installation_result' as const,
          request_key: input.locator.request_key,
          installation: original(input.locator.request_key)
        }
  )
}
function reopen(): void {
  db.close()
  db = initializeDatabase(directory)
  installations = new DesktopControllerInstallations(db, ssh, [old], {
    transport: installationTransport
  })
  upgrades = new DesktopControllerUpgrades(db, installations, ssh, [target], {
    transport,
    sessionId: randomUUID()
  })
}
async function prepared(): Promise<string> {
  return upgrades.prepare((await upgrades.plan(installKey, target.release_id)).plan_id).request_key
}
async function transferred(): Promise<string> {
  const key = await prepared()
  await upgrades.send(key, 'transfer', true)
  return key
}
beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  remote.clear()
  vi.spyOn(releaseModule, 'verifyControllerRelease').mockReturnValue({
    payload_sha256: 'e'.repeat(64)
  } as ReturnType<typeof releaseModule.verifyControllerRelease>)
  vi.spyOn(releaseModule, 'readReleaseFile').mockReturnValue(tool)
  directory = mkdtempSync(join(tmpdir(), 'opspilot-upgrade-journal-'))
  db = initializeDatabase(directory)
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  new VpsRepository(db).create({
    name: 'fixture',
    host: 'controller.test',
    port: 22,
    username: 'root',
    host_fingerprint: 'SHA256:' + 'A'.repeat(43),
    auth_type: 'key',
    credential: cipher.encrypt(randomBytes(32).toString('base64url'))
  })
  installations = new DesktopControllerInstallations(db, ssh, [old], {
    transport: installationTransport
  })
  installKey = installations.prepare(
    (await installations.plan(1, old.release_id)).plan_id
  ).request_key
  await installations.send(installKey, 'transfer', true)
  await installations.send(installKey, 'install', true)
  transport.transfer.mockImplementation(async (input) => {
    input.assertCurrent()
    expect(
      db
        .prepare('SELECT state FROM desktop_controller_upgrade WHERE request_key=?')
        .get(input.locator.request_key)
    ).toEqual({ state: 'in_flight' })
    return { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
  })
  transport.call.mockImplementation(async (input) => ({
    state: 'verified',
    ...input.locator,
    completed_files: 1,
    total_files: 1
  }))
  transport.upgrade.mockImplementation(async (input) => {
    input.assertCurrent()
    const r = input.request
    if (r.operation === 'inspect-upgrade') {
      const found = remote.get(r.request_key)
      if (!found) throw new ControllerBootstrapError('BOOTSTRAP_NOT_FOUND')
      return found
    }
    const actual = r.operation === 'rollback-upgrade' ? r.parent_upgrade_key : r.request_key
    const runtime = actual ? `${root}/revisions/${actual}/runtime` : `${root}/runtime`
    const result: ControllerUpgradeResult = {
      format: 1,
      request_key: r.request_key,
      installation_request_key: r.installation_request_key,
      controller_id: r.controller_id,
      parent_upgrade_key: r.parent_upgrade_key,
      parent_release_sha256: r.parent_release_sha256,
      release_sha256: r.release_sha256,
      payload_sha256: 'e'.repeat(64),
      runtime_release_sha256: actual === r.request_key ? r.release_sha256 : r.parent_release_sha256,
      runtime_payload_sha256: actual ? 'e'.repeat(64) : 'c'.repeat(64),
      runtime_upgrade_key: actual,
      phase: r.operation === 'rollback-upgrade' ? 'rolled_back' : 'active',
      is_current: true,
      service_state: 'running',
      runtime_uid: 1001,
      artifact_path: runtime + '/payload/control-plane.cjs',
      node_path: runtime + '/node',
      data_directory: '/var/lib/fixture'
    }
    remote.set(r.request_key, result)
    return result
  })
  upgrades = new DesktopControllerUpgrades(db, installations, ssh, [target], { transport })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (db.open) db.close()
  expect(directory.startsWith(join(tmpdir(), 'opspilot-upgrade-journal-'))).toBe(true)
  rmSync(directory, { recursive: true })
})
it('persists UUID/parent/pins before transfer, idempotent prepare and no token binding write', async () => {
  const plan = await upgrades.plan(installKey, target.release_id),
    first = upgrades.prepare(plan.plan_id)
  expect(upgrades.prepare(plan.plan_id).request_key).toBe(first.request_key)
  expect(first.parent_upgrade_key).toBeNull()
  expect(first.parent_release_sha256).toBe(old.release_sha256)
  await upgrades.send(first.request_key, 'transfer', true)
  const result = await upgrades.send(first.request_key, 'upgrade', true)
  expect(result).toMatchObject({ state: 'active', is_current: true })
  expect(db.prepare('SELECT COUNT(*) n FROM desktop_controller_binding').get()).toEqual({ n: 0 })
  await expect(upgrades.send(first.request_key, 'upgrade', true)).rejects.toMatchObject({
    code: 'UPGRADE_INSPECT_REQUIRED'
  })
})
it('explicit runtime refresh preserves the existing token/client/scopes and fences old or unknown epochs', async () => {
  const vault = new DesktopControllerVault(db, cipher),
    bindingId = randomUUID()
  const intent = installations.bindingIntent(installKey, bindingId, 'fixture binding', true)
  vault.prepare(intent)
  const token = 'opspilot_' + randomBytes(32).toString('base64url'),
    expires = new Date(Date.now() + 86400000).toISOString()
  const client = {
    client_id: randomUUID(),
    controller_id: cid,
    display_name: intent.display_name,
    scopes: intent.requested_scopes,
    created_at: new Date().toISOString(),
    revoked_at: null,
    token_expires_at: expires
  }
  vault.activate(bindingId, 1, {
    state: 'issued_once',
    controller_id: cid,
    client,
    credential: { access_token: token, token_type: 'Bearer', expires_at: expires }
  })
  const key = await transferred()
  await upgrades.send(key, 'upgrade', true)
  expect(() => vault.resolve(bindingId)).toThrow('BINDING_UNAVAILABLE')
  const next = upgrades.bindingIntent(key, vault.storedIntent(bindingId))
  expect(() => vault.refreshRuntime(bindingId, 2, { ...next, requested_scopes: ['read'] })).toThrow(
    'BINDING_CHANGED'
  )
  const refreshed = vault.refreshRuntime(bindingId, 2, next)
  expect(refreshed).toMatchObject({ revision: 3, remote_client_id: client.client_id })
  expect(vault.resolve(bindingId)).toMatchObject({ accessToken: token, revision: 3 })
  expect(vault.storedIntent(bindingId).installation).toEqual(intent.installation)
  expect(() => vault.refreshRuntime(bindingId, 2, next)).toThrow('BINDING_CHANGED')
  const before = upgrades.list(installKey)[0]
  db.prepare(
    "UPDATE desktop_controller_upgrade SET state='outcome_unknown' WHERE request_key=?"
  ).run(key)
  expect(() => vault.resolve(bindingId)).toThrow('BINDING_UNAVAILABLE')
  db.prepare('UPDATE desktop_controller_upgrade SET state=? WHERE request_key=?').run(
    before.state,
    key
  )
  await upgrades.send(key, 'rollback', true)
  expect(() => vault.resolve(bindingId)).toThrow('BINDING_UNAVAILABLE')
  const restored = upgrades.bindingIntent(key, vault.storedIntent(bindingId))
  expect(restored.node_path).toBe(intent.node_path)
  vault.refreshRuntime(bindingId, 3, restored)
  expect(vault.resolve(bindingId)).toMatchObject({ accessToken: token, revision: 4 })
  expect(vault.get(bindingId).remote_client_id).toBe(client.client_id)
})
it('Main requires a fresh ephemeral review and explicit consent before preserving a runtime binding token', async () => {
  const vault = new DesktopControllerVault(db, cipher),
    bindingId = randomUUID(),
    intent = installations.bindingIntent(installKey, bindingId, 'Main refresh')
  vault.prepare(intent)
  const token = 'opspilot_' + randomBytes(32).toString('base64url'),
    expires = new Date(Date.now() + 86400000).toISOString()
  vault.activate(bindingId, 1, {
    state: 'issued_once',
    controller_id: cid,
    client: {
      client_id: randomUUID(),
      controller_id: cid,
      display_name: intent.display_name,
      scopes: ['read'],
      created_at: new Date().toISOString(),
      revoked_at: null,
      token_expires_at: expires
    },
    credential: { access_token: token, token_type: 'Bearer', expires_at: expires }
  })
  const key = await transferred()
  await upgrades.send(key, 'upgrade', true)
  const main = new DesktopControllerService(
    db,
    cipher,
    ssh as never,
    undefined,
    [old, target],
    undefined,
    { installation: { transport: installationTransport }, upgrade: { transport } }
  )
  const original = db
    .prepare('SELECT * FROM desktop_controller_installation WHERE request_key=?')
    .get(installKey)
  for (const work of [
    () => main.inspectInstallation(installKey),
    () => main.sendInstallation(installKey, 'recover', true),
    () => main.sendInstaller({ request_key: installKey, operation: 'recover', consent: true }),
    () => main.rebindInstallation(randomUUID(), installKey, true),
    () => main.rebindInstaller({ plan_id: randomUUID(), request_key: installKey, confirm: true }),
    () =>
      main.prepareInstalledRegistration({
        installation_request_key: installKey,
        display_name: 'Stale installation'
      }),
    () =>
      main.registerInstalled({
        installation_request_key: installKey,
        binding_id: randomUUID(),
        display_name: 'Stale installation'
      })
  ])
    await expect(work()).rejects.toMatchObject({
      context: { cause: { message: 'UPGRADE_INSPECT_REQUIRED' } }
    })
  expect(
    db.prepare('SELECT * FROM desktop_controller_installation WHERE request_key=?').get(installKey)
  ).toEqual(original)
  const review = await main.reviewUpgradeBinding({ binding_id: bindingId, request_key: key })
  expect(vault.get(bindingId).revision).toBe(2)
  await expect(
    main.refreshUpgradeBinding({ plan_id: review.plan_id, consent: false as true })
  ).rejects.toThrow()
  expect(vault.get(bindingId).revision).toBe(2)
  vi.useFakeTimers()
  vi.setSystemTime(Date.now() + 61000)
  await expect(
    main.refreshUpgradeBinding({ plan_id: review.plan_id, consent: true })
  ).rejects.toThrow()
  vi.useRealTimers()
  const fresh = await main.reviewUpgradeBinding({ binding_id: bindingId, request_key: key })
  await main.refreshUpgradeBinding({ plan_id: fresh.plan_id, consent: true })
  expect(vault.resolve(bindingId)).toMatchObject({ revision: 3, accessToken: token })
  await expect(
    main.refreshUpgradeBinding({ plan_id: fresh.plan_id, consent: true })
  ).rejects.toThrow()
})
it('lost upgrade reply survives cold SQLite reopen and inspect never replays upgrade', async () => {
  const key = await transferred(),
    work = transport.upgrade.getMockImplementation()!
  transport.upgrade.mockImplementationOnce(async (input) => {
    await work(input)
    throw new ControllerBootstrapError('BOOTSTRAP_OUTCOME_UNKNOWN', true)
  })
  await expect(upgrades.send(key, 'upgrade', true)).rejects.toMatchObject({
    code: 'BOOTSTRAP_OUTCOME_UNKNOWN'
  })
  reopen()
  expect(upgrades.list(installKey)[0].state).toBe('outcome_unknown')
  expect((await upgrades.inspect(key)).state).toBe('active')
  expect(
    transport.upgrade.mock.calls.filter(([i]) => i.request.operation === 'upgrade')
  ).toHaveLength(1)
})
it('cold abandoned in-flight requires inspection, same UUID preserved', async () => {
  const key = await transferred()
  db.prepare(
    "UPDATE desktop_controller_upgrade SET state='in_flight',operation_id=?,owner_session=? WHERE request_key=?"
  ).run(randomUUID(), randomUUID(), key)
  reopen()
  expect(upgrades.list(installKey)[0]).toMatchObject({ request_key: key, state: 'outcome_unknown' })
  expect((await upgrades.inspect(key)).state).toBe('transferred')
})
it('cannot reset attempted after missing remote staging or explicit re-transfer', async () => {
  const key = await transferred()
  transport.upgrade.mockRejectedValueOnce(
    new ControllerBootstrapError('BOOTSTRAP_OUTCOME_UNKNOWN', true)
  )
  await expect(upgrades.send(key, 'upgrade', true)).rejects.toThrow()
  transport.call.mockResolvedValueOnce({
    state: 'absent',
    request_key: key,
    release_sha256: target.release_sha256,
    installer_sha256: toolPin,
    completed_files: 0,
    total_files: 0
  })
  expect((await upgrades.inspect(key)).state).toBe('outcome_unknown')
  expect((await upgrades.send(key, 'transfer', true)).state).toBe('outcome_unknown')
  await expect(upgrades.send(key, 'upgrade', true)).rejects.toMatchObject({
    code: 'UPGRADE_INSPECT_REQUIRED'
  })
})
it('explicit recover and rollback use same authority and preserve original receipt', async () => {
  const key = await transferred(),
    before = db.prepare('SELECT * FROM desktop_controller_installation').all()
  transport.upgrade.mockRejectedValueOnce(
    new ControllerBootstrapError('BOOTSTRAP_OUTCOME_UNKNOWN', true)
  )
  await expect(upgrades.send(key, 'upgrade', true)).rejects.toThrow()
  expect((await upgrades.send(key, 'recover', true)).state).toBe('active')
  expect((await upgrades.send(key, 'rollback', true)).state).toBe('rolled_back')
  expect(db.prepare('SELECT * FROM desktop_controller_installation').all()).toEqual(before)
})
it('rejects changed credentials before dispatch and discards late result after authority changes', async () => {
  const key = await transferred(),
    work = transport.upgrade.getMockImplementation()!
  transport.upgrade.mockImplementationOnce(async (input) => {
    const result = await work(input)
    db.prepare('UPDATE vps SET encrypted_secret=? WHERE id=1').run(randomBytes(32))
    return result
  })
  await expect(upgrades.send(key, 'upgrade', true)).rejects.toMatchObject({
    code: 'UPGRADE_AUTHORITY_CHANGED'
  })
  expect(upgrades.list(installKey)[0]).toMatchObject({
    state: 'outcome_unknown',
    last_result: null
  })
  const count = transport.upgrade.mock.calls.length
  await expect(upgrades.inspect(key)).rejects.toMatchObject({ code: 'UPGRADE_AUTHORITY_CHANGED' })
  expect(transport.upgrade).toHaveBeenCalledTimes(count)
})
it('rejects wrong result pins and non-current evidence without adoption', async () => {
  const key = await transferred(),
    work = transport.upgrade.getMockImplementation()!
  transport.upgrade.mockImplementationOnce(async (input) => ({
    ...(await work(input)),
    runtime_release_sha256: 'f'.repeat(64)
  }))
  await expect(upgrades.send(key, 'upgrade', true)).rejects.toMatchObject({
    code: 'UPGRADE_CONFLICT'
  })
  const valid = remote.get(key)!
  transport.upgrade.mockResolvedValueOnce({ ...valid, is_current: false })
  await expect(upgrades.inspect(key)).rejects.toMatchObject({ code: 'UPGRADE_CONFLICT' })
  expect(upgrades.list(installKey)[0].is_current).toBe(false)
})
it('chains a second revision to the attested parent while historical operations stay read-only', async () => {
  const second = { ...target, release_id: 'second', release_sha256: 'f'.repeat(64) }
  upgrades = new DesktopControllerUpgrades(db, installations, ssh, [target, second], { transport })
  const first = await transferred()
  await upgrades.send(first, 'upgrade', true)
  const plan = await upgrades.plan(installKey, second.release_id)
  expect(plan.parent_upgrade_key).toBe(first)
  const next = upgrades.prepare(plan.plan_id)
  expect(next.parent_release_sha256).toBe(target.release_sha256)
  await upgrades.send(next.request_key, 'transfer', true)
  await upgrades.send(next.request_key, 'upgrade', true)
  expect(upgrades.list(installKey).map((v) => v.is_current)).toEqual([false, true])
  await expect(upgrades.inspect(first)).rejects.toMatchObject({ code: 'UPGRADE_INSPECT_REQUIRED' })
  const rollback = await upgrades.send(next.request_key, 'rollback', true)
  expect(rollback.last_result?.runtime_upgrade_key).toBe(first)
})
it('one pending intent, expiry and monotonic authority/attempt constraints', async () => {
  const plan = await upgrades.plan(installKey, target.release_id),
    key = upgrades.prepare(plan.plan_id).request_key
  await expect(upgrades.plan(installKey, target.release_id)).rejects.toMatchObject({
    code: 'UPGRADE_BUSY'
  })
  expect(() =>
    db
      .prepare('UPDATE desktop_controller_upgrade SET parent_release_sha256=? WHERE request_key=?')
      .run('f'.repeat(64), key)
  ).toThrow('DESKTOP_UPGRADE_IMMUTABLE')
  expect(upgrades.cancel(key).state).toBe('cancelled')
  const next = await upgrades.plan(installKey, target.release_id)
  vi.useFakeTimers()
  vi.setSystemTime(Date.now() + 61000)
  expect(() => upgrades.prepare(next.plan_id)).toThrow('UPGRADE_PLAN_EXPIRED')
})
