import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { initializeDatabase, closeDatabase, runMigrations } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { DesktopControllerVault } from './desktopControllerVault'
import { DesktopTargetSetups } from './desktopTargetSetup'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  cipher: AesGcmCredentialCipher,
  vault: DesktopControllerVault,
  targets: DesktopTargetSetups,
  binding: string,
  secret: string
const admin = { registerVps: vi.fn<DesktopControllerEnrollment['registerVps']>() },
  delivered: string[] = []
const prepare = (): ReturnType<DesktopTargetSetups['prepare']> =>
  targets.prepare({ binding_id: binding, local_vps_id: 2 })
const send = (key: string): ReturnType<DesktopTargetSetups['send']> =>
  targets.send({ request_key: key, confirm_transfer: true })
beforeEach(() => {
  vi.resetAllMocks()
  delivered.length = 0
  directory = mkdtempSync(join(tmpdir(), 'opspilot-target-setup-'))
  db = initializeDatabase(directory)
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  vault = new DesktopControllerVault(db, cipher)
  binding = randomUUID()
  secret = randomBytes(32).toString('base64url')
  db.prepare(
    "INSERT INTO vps(id,name,host,username,auth_type,host_fingerprint,encrypted_secret) VALUES(1,'controller','controller.test','operator','key',?,X'01')"
  ).run('SHA256:' + 'A'.repeat(43))
  const encrypted = cipher.encrypt(secret)
  db.prepare(
    "INSERT INTO vps(id,name,host,port,username,auth_type,host_fingerprint,crypto_scheme,encrypted_secret,iv,auth_tag) VALUES(2,'target','target.test',22,'root','password',?,'aes_256_gcm',?,?,?)"
  ).run('SHA256:' + 'B'.repeat(43), encrypted.encrypted_secret, encrypted.iv, encrypted.auth_tag)
  vault.prepare({
    binding_id: binding,
    controller_id: 'unit-controller',
    vps_id: 1,
    ssh_security_revision: 1,
    principal: {
      vpsId: 1,
      host: 'controller.test',
      port: 22,
      username: 'operator',
      authType: 'key',
      hostFingerprint: 'SHA256:' + 'A'.repeat(43)
    },
    artifact_path: '/opt/unit/control-plane.cjs',
    node_path: '/opt/unit/node',
    data_directory: '/var/lib/unit',
    manifest_sha256: 'a'.repeat(64),
    display_name: 'Unit',
    requested_scopes: ['read', 'deploy:manual', 'policy:write']
  })
  const expiry = new Date(Date.now() + 86400000).toISOString()
  vault.activate(binding, 1, {
    state: 'issued_once',
    controller_id: 'unit-controller',
    client: {
      client_id: randomUUID(),
      controller_id: 'unit-controller',
      display_name: 'Unit',
      scopes: ['read', 'deploy:manual', 'policy:write'],
      created_at: new Date().toISOString(),
      revoked_at: null,
      token_expires_at: expiry
    },
    credential: {
      access_token: 'opspilot_' + randomBytes(32).toString('base64url'),
      token_type: 'Bearer',
      expires_at: expiry
    }
  })
  admin.registerVps.mockImplementation(async (_binding, input, guard) => {
    guard()
    delivered.push(input.request_key)
    expect(input.secret).toBe(secret)
    return {
      state: 'registered',
      request_key: input.request_key,
      controller_id: input.controller_id,
      vps_id: 19,
      ssh_security_revision: 1,
      profile: input.profile,
      created_at: new Date().toISOString()
    }
  })
  targets = new DesktopTargetSetups(db, cipher, vault, admin)
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
it('matches shared metadata contract exactly', () => {
  const read = (path: string): string =>
    readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  expect(read('../../shared/desktopTargetRegistration.ts')).toBe(
    read('../../../../docs/contracts/desktop-target-registration.ts')
  )
})
it('rejects caller-supplied credential or profile fields before creating an intent', () => {
  for (const extra of [
    { secret: 'SYNTHETIC_REJECTED_INPUT' },
    { profile: { host: 'other.test' } },
    { request_key: randomUUID() }
  ])
    expect(() =>
      targets.prepare({ binding_id: binding, local_vps_id: 2, ...extra } as never)
    ).toThrow('TARGET_SETUP_REQUEST_INVALID')
  expect(targets.list(binding)).toEqual([])
  expect(admin.registerVps).not.toHaveBeenCalled()
})
it('rejects read-only bindings and leaves a caller transaction intact', () => {
  db.exec('BEGIN')
  expect(() => prepare()).toThrow('TARGET_SETUP_REQUEST_INVALID')
  expect(db.inTransaction).toBe(true)
  db.exec('ROLLBACK')
  const client = vault.get(binding).client!
  db.prepare('UPDATE desktop_controller_binding SET client_json=? WHERE binding_id=?').run(
    JSON.stringify({ ...client, scopes: ['read'] }),
    binding
  )
  expect(() => prepare()).toThrow()
  expect(admin.registerVps).not.toHaveBeenCalled()
})
it('persists review UUID without decrypt/transport and exposes no credential or ciphertext digest', () => {
  const review = prepare()
  expect(review.state).toBe('prepared')
  expect(prepare()).toEqual(review)
  expect(admin.registerVps).not.toHaveBeenCalled()
  const serialized = JSON.stringify(targets.list(binding))
  expect(serialized).not.toContain(secret)
  expect(serialized).not.toContain('credential_digest')
  expect(JSON.stringify(db.prepare('SELECT * FROM desktop_target_setup').all())).not.toContain(
    secret
  )
  expect(() => db.exec("UPDATE desktop_target_setup SET profile_json='{}'")).toThrow(
    'DESKTOP_TARGET_SETUP_IMMUTABLE'
  )
})
it('requires explicit consent and keeps secret only in the trusted admin transport', async () => {
  const review = prepare()
  await expect(
    targets.send({ request_key: review.request_key, confirm_transfer: false } as never)
  ).rejects.toThrow('TARGET_SETUP_REQUEST_INVALID')
  expect(admin.registerVps).not.toHaveBeenCalled()
  const result = await send(review.request_key)
  expect(result).toMatchObject({
    state: 'registered',
    remote_vps_id: 19,
    remote_security_revision: 1
  })
  expect(delivered).toEqual([review.request_key])
  expect(prepare()).toEqual(result)
  expect(JSON.stringify(result)).not.toContain(secret)
  expect(JSON.stringify(db.prepare('SELECT * FROM desktop_target_setup').all())).not.toContain(
    secret
  )
})
it('recovers lost reply by same UUID in a fresh main instance and blocks unknown cancellation', async () => {
  const review = prepare()
  admin.registerVps.mockRejectedValueOnce(new Error('SYNTHETIC_LOST_REPLY'))
  await expect(send(review.request_key)).rejects.toThrow('SYNTHETIC_LOST_REPLY')
  expect(targets.list(binding)[0].state).toBe('outcome_unknown')
  expect(() => targets.cancel(review.request_key)).toThrow('TARGET_SETUP_CONFLICT')
  targets = new DesktopTargetSetups(db, cipher, vault, admin)
  expect((await send(review.request_key)).remote_vps_id).toBe(19)
  expect(admin.registerVps.mock.calls.map((call) => call[1].request_key)).toEqual([
    review.request_key,
    review.request_key
  ])
})
it('recovers cold in_flight without automatically sending', () => {
  const review = prepare()
  db.prepare("UPDATE desktop_target_setup SET state='in_flight' WHERE request_key=?").run(
    review.request_key
  )
  targets = new DesktopTargetSetups(db, cipher, vault, admin)
  expect(targets.list(binding)[0].state).toBe('outcome_unknown')
  expect(admin.registerVps).not.toHaveBeenCalled()
})
it.each([
  'UPDATE vps SET ssh_security_revision=2 WHERE id=2',
  "UPDATE vps SET host='changed.test' WHERE id=2",
  "UPDATE vps SET encrypted_secret=X'0102' WHERE id=2",
  "UPDATE vps SET archived_at='2026-11-08T00:00:00Z' WHERE id=2"
])('refuses local changes before dispatch: %s', async (sql) => {
  const review = prepare()
  db.exec(sql)
  await expect(send(review.request_key)).rejects.toThrow()
  expect(admin.registerVps).not.toHaveBeenCalled()
  expect(targets.list(binding)[0].state).toBe('prepared')
})
it('checks profile and binding again immediately before stdin and after reply', async () => {
  const review = prepare()
  admin.registerVps.mockImplementationOnce(async (_binding, _input, guard) => {
    db.exec("UPDATE vps SET username='other' WHERE id=2")
    guard()
    throw new Error('UNREACHABLE')
  })
  await expect(send(review.request_key)).rejects.toThrow('TARGET_SETUP_CHANGED')
  expect(delivered).toEqual([])
  expect(targets.list(binding)[0].state).toBe('outcome_unknown')
})
it('does not accept a reply after binding was disabled', async () => {
  const review = prepare(),
    original = admin.registerVps.getMockImplementation()!
  admin.registerVps.mockImplementationOnce(async (...args) => {
    const result = await original(...args)
    vault.disable(binding, vault.get(binding).revision)
    return result
  })
  await expect(send(review.request_key)).rejects.toThrow()
  expect(targets.list(binding)[0].state).toBe('outcome_unknown')
})
it('locks duplicate dispatch and only permits prepared cancellation', async () => {
  const review = prepare(),
    first = send(review.request_key)
  await expect(send(review.request_key)).rejects.toThrow('TARGET_SETUP_BUSY')
  await first
  expect(admin.registerVps).toHaveBeenCalledOnce()
  expect(() => targets.cancel(review.request_key)).toThrow('TARGET_SETUP_CONFLICT')
})
it('cancels prepared intent without sending and retains the tombstone', () => {
  const review = prepare()
  expect(targets.cancel(review.request_key).state).toBe('cancelled')
  expect(prepare().request_key).not.toBe(review.request_key)
  expect(db.prepare('SELECT count(*) AS n FROM desktop_target_setup').get()).toEqual({ n: 2 })
  expect(admin.registerVps).not.toHaveBeenCalled()
})
it('fails closed for missing pin or unreadable local ciphertext', async () => {
  db.exec('UPDATE vps SET host_fingerprint=NULL WHERE id=2')
  expect(() => prepare()).toThrow('TARGET_SETUP_CHANGED')
  db.prepare('UPDATE vps SET host_fingerprint=?,encrypted_secret=? WHERE id=2').run(
    'SHA256:' + 'B'.repeat(43),
    Buffer.from('not-encrypted')
  )
  const review = prepare()
  await expect(send(review.request_key)).rejects.toThrow('TARGET_CREDENTIAL_UNAVAILABLE')
  expect(admin.registerVps).not.toHaveBeenCalled()
})
it('rejects a response for another request and never stores success', async () => {
  const review = prepare(),
    original = admin.registerVps.getMockImplementation()!
  admin.registerVps.mockImplementationOnce(async (...args) => ({
    ...(await original(...args)),
    request_key: randomUUID()
  }))
  await expect(send(review.request_key)).rejects.toThrow('TARGET_SETUP_RESPONSE_INVALID')
  expect(targets.list(binding)[0].state).toBe('outcome_unknown')
})
it('upgrades populated v027 without altering saved profiles or sending anything', () => {
  const before = db.prepare('SELECT * FROM vps').all(),
    bindings = db.prepare('SELECT * FROM desktop_controller_binding').all()
  db.exec(
    'DROP TABLE IF EXISTS desktop_controller_installation;DELETE FROM schema_version WHERE version=29;DROP TABLE desktop_target_setup;DROP TABLE product_vps_registration;DELETE FROM schema_version WHERE version=28'
  )
  runMigrations(db)
  expect(db.prepare('SELECT * FROM vps').all()).toEqual(before)
  expect(db.prepare('SELECT * FROM desktop_controller_binding').all()).toEqual(bindings)
  expect(targets.list(binding)).toEqual([])
  expect(db.pragma('foreign_key_check')).toEqual([])
  expect(admin.registerVps).not.toHaveBeenCalled()
})
