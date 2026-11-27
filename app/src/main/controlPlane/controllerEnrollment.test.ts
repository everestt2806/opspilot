import { randomUUID } from 'node:crypto'
import migration028 from '../db/migrations/028_desktop_target_registration.sql?raw'
import { registerControllerVps } from './vpsRegistration'
import Database from 'better-sqlite3'
import { createHash, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { SshManager } from '../ssh/manager'
import { loadControllerCredentialCipher } from './controllerSecrets'
import { enrollControllerVps } from './controllerEnrollment'
import { createControllerSshResolver } from './controllerSshResolver'

vi.mock('./controllerSecrets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./controllerSecrets')>()),
  loadControllerCredentialCipher: vi.fn()
}))
vi.mock('../ssh/manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ssh/manager')>()),
  SshManager: vi.fn()
}))

const hostKey = Buffer.from('SYNTHETIC_PUBLIC_HOST_KEY')
const controllerId = 'test-controller'
const request = {
  format: 1 as const,
  controller_id: controllerId,
  profile: {
    name: 'Lab target',
    host: 'target.example.test',
    port: 22,
    username: 'deploy',
    auth_type: 'key' as const,
    host_fingerprint: `SHA256:${createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`
  },
  secret: 'SYNTHETIC_UNIT_MATERIAL'
}
let database: Database.Database
let cipher: AesGcmCredentialCipher
let ssh: {
  connect: ReturnType<typeof vi.fn>
  disconnectAll: ReturnType<typeof vi.fn>
  getVerifiedHostKey: ReturnType<typeof vi.fn>
  exec: ReturnType<typeof vi.fn>
}
const enroll = (
  input: unknown = request,
  signal?: AbortSignal
): ReturnType<typeof enrollControllerVps> =>
  enrollControllerVps(database, controllerId, '/unit-private', input, signal)

beforeEach(() => {
  vi.clearAllMocks()
  database = new Database(':memory:')
  database.exec(`CREATE TABLE product_controller(controller_id TEXT PRIMARY KEY,status TEXT);
    INSERT INTO product_controller VALUES ('test-controller','active');
    CREATE TABLE vps(id INTEGER PRIMARY KEY,name TEXT UNIQUE,host TEXT,port INTEGER,
      username TEXT,auth_type TEXT,host_fingerprint TEXT,ssh_security_revision INTEGER,
      crypto_scheme TEXT,encrypted_secret BLOB,iv BLOB,auth_tag BLOB,
      archived_at TEXT DEFAULT NULL,last_status TEXT,last_seen_at TEXT)`)
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  vi.mocked(loadControllerCredentialCipher).mockReturnValue(cipher)
  ssh = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnectAll: vi.fn().mockResolvedValue(undefined),
    getVerifiedHostKey: vi.fn().mockReturnValue(hostKey),
    exec: vi.fn()
  }
  vi.mocked(SshManager).mockImplementation(function () {
    return ssh as unknown as SshManager
  })
})
afterEach(() => {
  if (database.open) database.close()
})

describe('Controller explicit VPS credential enrollment', () => {
  it('passes password authentication only in memory and encrypts it with the same binding', async () => {
    const input = { ...request, profile: { ...request.profile, auth_type: 'password' } }
    const result = await enroll(input)
    const resolver = vi.mocked(SshManager).mock.calls[0][0]
    expect(await resolver(1)).toMatchObject({ authType: 'password', secret: request.secret })
    expect(
      createControllerSshResolver(database, controllerId, '/unit-private')(result.vps_id)
    ).toMatchObject({ authType: 'password', secret: request.secret })
  })
  it('authenticates before any write, persists only bound ciphertext, and replays without writes', async () => {
    ssh.connect.mockImplementation(async () => {
      expect(database.prepare('SELECT COUNT(*) AS n FROM vps').get()).toEqual({ n: 0 })
      expect(database.inTransaction).toBe(false)
    })
    const result = await enroll()
    expect(result).toEqual({
      state: 'enrolled',
      controller_id: controllerId,
      vps_id: 1,
      host_fingerprint: request.profile.host_fingerprint
    })
    const row = database.prepare('SELECT * FROM vps').get() as { encrypted_secret: Buffer }
    expect(row.encrypted_secret.toString()).not.toContain(request.secret)
    expect(createControllerSshResolver(database, controllerId, '/unit-private')(1)).toMatchObject({
      secret: request.secret,
      hostFingerprint: request.profile.host_fingerprint
    })
    ssh.connect.mockResolvedValue(undefined)
    const before = database.prepare('SELECT total_changes() AS n').get()
    expect(await enroll()).toEqual({ ...result, state: 'already_enrolled' })
    expect(database.prepare('SELECT total_changes() AS n').get()).toEqual(before)
    expect(ssh.connect).toHaveBeenCalledTimes(2)
    expect(ssh.disconnectAll).toHaveBeenCalledTimes(2)
    expect(ssh.exec).not.toHaveBeenCalled()
  })

  it.each([
    { ...request, extra: 'unknown' },
    { ...request, controller_id: 'test-controller\n' },
    { ...request, secret: '' },
    { ...request, secret: 'x'.repeat(256 * 1024 + 1) },
    { ...request, profile: { ...request.profile, host_fingerprint: null } },
    {
      ...request,
      profile: { ...request.profile, host_fingerprint: request.profile.host_fingerprint + '\n' }
    },
    { ...request, profile: { ...request.profile, port: 65536 } },
    { ...request, profile: { ...request.profile, username: 'deploy\nroot' } },
    { ...request, profile: { ...request.profile, host: 'host other' } },
    { ...request, profile: { ...request.profile, auth_type: 'agent' } }
  ])('refuses invalid input before filesystem/network/write %#', async (input) => {
    await expect(enroll(input)).rejects.toThrow(/^CONTROLLER_VPS_INPUT_INVALID$/)
    expect(SshManager).not.toHaveBeenCalled()
    expect(loadControllerCredentialCipher).not.toHaveBeenCalled()
    expect(database.prepare('SELECT COUNT(*) AS n FROM vps').get()).toEqual({ n: 0 })
  })

  it('refuses wrong controller, disabled authority and missing key before connecting', async () => {
    await expect(enroll({ ...request, controller_id: 'other' })).rejects.toThrow(
      'CONTROLLER_VPS_CONTROLLER_MISMATCH'
    )
    database.prepare("UPDATE product_controller SET status='disabled'").run()
    await expect(enroll()).rejects.toThrow('CONTROLLER_VPS_CONTROLLER_MISMATCH')
    database.prepare("UPDATE product_controller SET status='active'").run()
    vi.mocked(loadControllerCredentialCipher).mockImplementation(() => {
      throw new Error('SECRET_PATH')
    })
    await expect(enroll()).rejects.toThrow(/^CONTROLLER_VPS_CREDENTIAL_STORE_UNAVAILABLE$/)
    expect(SshManager).not.toHaveBeenCalled()
  })

  it.each(['auth_error', 'missing_pin', 'wrong_pin'])(
    'never writes after failed SSH verification: %s',
    async (kind) => {
      if (kind === 'auth_error') ssh.connect.mockRejectedValue(new Error(`raw_${request.secret}`))
      if (kind === 'missing_pin') ssh.getVerifiedHostKey.mockReturnValue(null)
      if (kind === 'wrong_pin') ssh.getVerifiedHostKey.mockReturnValue(Buffer.from('OTHER_HOST'))
      await expect(enroll()).rejects.toThrow(/^CONTROLLER_VPS_SSH_VERIFICATION_FAILED$/)
      expect(database.prepare('SELECT COUNT(*) AS n FROM vps').get()).toEqual({ n: 0 })
      expect(ssh.disconnectAll).toHaveBeenCalledOnce()
      expect(ssh.exec).not.toHaveBeenCalled()
    }
  )

  it('refuses endpoint/name/credential conflicts and archived replay without reconnecting', async () => {
    await enroll()
    ssh.connect.mockClear()
    for (const input of [
      { ...request, secret: 'DIFFERENT_UNIT_MATERIAL' },
      { ...request, profile: { ...request.profile, name: 'Other name' } },
      { ...request, profile: { ...request.profile, host: 'other.example.test' } },
      { ...request, profile: { ...request.profile, auth_type: 'password' } }
    ])
      await expect(enroll(input)).rejects.toThrow(/^CONTROLLER_VPS_ENROLLMENT_CONFLICT$/)
    database.prepare("UPDATE vps SET archived_at='2026-11-06T00:00:00Z'").run()
    await expect(enroll()).rejects.toThrow(/^CONTROLLER_VPS_ENROLLMENT_CONFLICT$/)
    expect(ssh.connect).not.toHaveBeenCalled()
  })

  it('converges two concurrent identical enrollments to one row and stable ID', async () => {
    const results = await Promise.all([enroll(), enroll()])
    expect(results.map((result) => result.state).sort()).toEqual(['already_enrolled', 'enrolled'])
    expect(results.map((result) => result.vps_id)).toEqual([1, 1])
    expect(database.prepare('SELECT COUNT(*) AS n FROM vps').get()).toEqual({ n: 1 })
  })

  it('rechecks controller authority after the SSH await', async () => {
    ssh.connect.mockImplementation(async () => {
      database.prepare("UPDATE product_controller SET status='disabled'").run()
    })
    await expect(enroll()).rejects.toThrow(/^CONTROLLER_VPS_CONTROLLER_MISMATCH$/)
    expect(database.prepare('SELECT COUNT(*) AS n FROM vps').get()).toEqual({ n: 0 })
  })

  it('rolls back the new row if key loading fails after verified authentication', async () => {
    vi.mocked(loadControllerCredentialCipher)
      .mockReturnValueOnce(cipher)
      .mockImplementation(() => {
        throw new Error(`raw_${request.secret}`)
      })
    await expect(enroll()).rejects.toThrow(/^CONTROLLER_VPS_ENROLLMENT_UNAVAILABLE$/)
    expect(database.prepare('SELECT COUNT(*) AS n FROM vps').get()).toEqual({ n: 0 })
    expect(database.inTransaction).toBe(false)
  })

  it('preserves caller transaction and refuses abort before/during authentication', async () => {
    database.exec('BEGIN IMMEDIATE')
    await expect(enroll()).rejects.toThrow(/^CONTROLLER_BOOTSTRAP_TRANSACTION_ACTIVE$/)
    expect(database.inTransaction).toBe(true)
    database.exec('ROLLBACK')
    const controller = new AbortController()
    controller.abort()
    await expect(enroll(request, controller.signal)).rejects.toThrow(
      /^CONTROLLER_VPS_ENROLLMENT_ABORTED$/
    )
    const during = new AbortController()
    ssh.connect.mockImplementation(async () => {
      during.abort()
    })
    await expect(enroll(request, during.signal)).rejects.toThrow(
      /^CONTROLLER_VPS_ENROLLMENT_ABORTED$/
    )
    expect(database.prepare('SELECT COUNT(*) AS n FROM vps').get()).toEqual({ n: 0 })
    expect(ssh.disconnectAll).toHaveBeenCalled()
  })
})

describe('Atomic controller VPS registration receipt', () => {
  beforeEach(() => database.exec(migration028))
  const register = (input: unknown, key = randomUUID()): ReturnType<typeof registerControllerVps> =>
    registerControllerVps(database, controllerId, '/unit-private', 'unix:1000', {
      ...request,
      request_key: key,
      ...(input as object)
    })
  it('persists metadata receipt with encrypted target and retries the same UUID without changing ciphertext', async () => {
    const key = randomUUID(),
      first = await register({}, key),
      before = database.prepare('SELECT * FROM vps').get()
    expect(await register({}, key)).toEqual(first)
    expect(database.prepare('SELECT * FROM vps').get()).toEqual(before)
    expect(database.prepare('SELECT count(*) AS n FROM product_vps_registration').get()).toEqual({
      n: 1
    })
    expect(
      JSON.stringify(database.prepare('SELECT * FROM product_vps_registration').all())
    ).not.toContain(request.secret)
    expect(ssh.connect).toHaveBeenCalledTimes(2)
    expect(ssh.exec).not.toHaveBeenCalled()
  })
  it('rolls back VPS and ciphertext when receipt insert fails', async () => {
    database.exec(
      "CREATE TRIGGER reject_receipt BEFORE INSERT ON product_vps_registration BEGIN SELECT RAISE(ABORT,'UNIT_RECEIPT_REJECTED'); END"
    )
    await expect(register({})).rejects.toThrow('CONTROLLER_VPS_ENROLLMENT_UNAVAILABLE')
    expect(database.prepare('SELECT count(*) AS n FROM vps').get()).toEqual({ n: 0 })
    expect(database.prepare('SELECT count(*) AS n FROM product_vps_registration').get()).toEqual({
      n: 0
    })
  })
  it('rejects same UUID with changed profile or credential and never rotates existing credentials', async () => {
    const key = randomUUID()
    await register({}, key)
    const before = database.prepare('SELECT * FROM vps').get(),
      calls = ssh.connect.mock.calls.length
    await expect(
      register({ profile: { ...request.profile, name: 'changed' } }, key)
    ).rejects.toThrow('VPS_REGISTRATION_CONFLICT')
    await expect(register({ secret: 'DIFFERENT_SYNTHETIC_UNIT_MATERIAL' }, key)).rejects.toThrow(
      'CONTROLLER_VPS_ENROLLMENT_CONFLICT'
    )
    expect(ssh.connect).toHaveBeenCalledTimes(calls)
    expect(database.prepare('SELECT * FROM vps').get()).toEqual(before)
  })
  it('refuses changed recorded security revision before connecting', async () => {
    const key = randomUUID()
    await register({}, key)
    database.exec('UPDATE vps SET ssh_security_revision=2')
    await expect(register({}, key)).rejects.toThrow('VPS_REGISTRATION_CHANGED')
    expect(ssh.connect).toHaveBeenCalledOnce()
  })
  it('concurrent identical registration converges to one VPS and one immutable receipt', async () => {
    const key = randomUUID(),
      results = await Promise.all([register({}, key), register({}, key)])
    expect(results[0]).toEqual(results[1])
    expect(database.prepare('SELECT count(*) AS n FROM vps').get()).toEqual({ n: 1 })
    expect(() => database.exec("UPDATE product_vps_registration SET profile_json='{}'")).toThrow(
      'PRODUCT_VPS_REGISTRATION_IMMUTABLE'
    )
  })
})
