import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { initializeDatabase, closeDatabase, runMigrations } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { DesktopControllerVault } from './desktopControllerVault'
import type {
  ProductDesktopControllerBindingIntent,
  ProductDesktopEnrollmentResponse
} from '../../../../docs/contracts/product-controller-api'

let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  key: Buffer,
  vault: DesktopControllerVault,
  intent: ProductDesktopControllerBindingIntent,
  issued: ProductDesktopEnrollmentResponse
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-vault-'))
  db = initializeDatabase(directory)
  db.prepare(
    `INSERT INTO vps(id,name,host,port,host_fingerprint,username,auth_type,encrypted_secret)
    VALUES(1,'unit','controller.test',22,?,'operator','key',X'0102')`
  ).run('SHA256:' + 'A'.repeat(43))
  key = randomBytes(32)
  vault = new DesktopControllerVault(db, new AesGcmCredentialCipher(key))
  intent = {
    binding_id: randomUUID(),
    controller_id: 'remote-controller',
    vps_id: 1,
    ssh_security_revision: 1,
    principal: {
      vpsId: 1,
      host: 'controller.test',
      port: 22,
      hostFingerprint: 'SHA256:' + 'A'.repeat(43),
      username: 'operator',
      authType: 'key'
    },
    artifact_path: '/opt/opspilot/payload/control-plane.cjs',
    data_directory: '/var/lib/opspilot/controller',
    node_path: '/opt/opspilot/node',
    manifest_sha256: 'a'.repeat(64),
    display_name: 'Vault unit',
    requested_scopes: ['read', 'deploy:manual', 'policy:write']
  }
  const expires = new Date(Date.now() + 30 * 86400000).toISOString()
  issued = {
    state: 'issued_once',
    controller_id: intent.controller_id,
    client: {
      client_id: randomUUID(),
      controller_id: intent.controller_id,
      display_name: intent.display_name,
      scopes: intent.requested_scopes,
      created_at: new Date().toISOString(),
      revoked_at: null,
      token_expires_at: expires
    },
    credential: {
      access_token: 'opspilot_' + randomBytes(32).toString('base64url'),
      token_type: 'Bearer',
      expires_at: expires
    }
  }
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
const active = (): void => {
  vault.prepare(intent)
  vault.activate(intent.binding_id, 1, issued)
}
describe('Desktop controller encrypted vault', () => {
  it('upgrades populated v023 without changing the VPS or implicitly enrolling a controller', () => {
    const before = db.prepare('SELECT * FROM vps').all()
    db.exec(
      'DROP TABLE IF EXISTS product_project_registration;DELETE FROM schema_version WHERE version=26;DROP TABLE desktop_controller_command;DELETE FROM schema_version WHERE version=25;DROP TABLE desktop_controller_binding;DELETE FROM schema_version WHERE version=24'
    )
    runMigrations(db)
    runMigrations(db)
    expect(db.prepare('SELECT * FROM vps').all()).toEqual(before)
    expect(db.prepare('SELECT count(*) AS n FROM desktop_controller_binding').get()).toEqual({
      n: 0
    })
    expect(db.prepare('SELECT MAX(version) AS n FROM schema_version').get()).toEqual({ n: 26 })
    expect(db.pragma('foreign_key_check')).toEqual([])
  })
  it('persists a pending enrollment once and rejects altered content with the same UUID', () => {
    const before = vault.prepare(intent)
    expect(before).toMatchObject({
      state: 'pending',
      revision: 1,
      remote_client_id: null,
      client: null
    })
    expect(vault.prepare(intent)).toEqual(before)
    expect(() => vault.prepare({ ...intent, manifest_sha256: 'b'.repeat(64) })).toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
    expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
  })
  it('encrypts bearer and binds the full context, returning only public metadata', () => {
    active()
    const rows = db.prepare('SELECT * FROM desktop_controller_binding').all()
    expect(JSON.stringify(rows)).not.toContain(issued.credential.access_token)
    expect(JSON.stringify(vault.get(intent.binding_id))).not.toContain(
      issued.credential.access_token
    )
    expect(vault.resolve(intent.binding_id)).toEqual({
      controllerId: intent.controller_id,
      revision: 2,
      principal: intent.principal,
      accessToken: issued.credential.access_token
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_controller').get()).toEqual({ n: 0 })
  })
  it('reopens the encrypted binding with the same Desktop key and rejects another machine key', () => {
    active()
    closeDatabase()
    db = initializeDatabase(directory)
    const cold = new DesktopControllerVault(db, new AesGcmCredentialCipher(key))
    expect(cold.resolve(intent.binding_id).accessToken).toBe(issued.credential.access_token)
    const foreign = new DesktopControllerVault(db, new AesGcmCredentialCipher(randomBytes(32)))
    expect(() => foreign.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
  })
  it('rejects ciphertext swaps between bindings and revisions changed outside the envelope', () => {
    active()
    const other = { ...intent, binding_id: randomUUID(), display_name: 'Other unit' }
    vault.prepare(other)
    vault.activate(other.binding_id, 1, {
      ...issued,
      client: { ...issued.client, client_id: randomUUID(), display_name: other.display_name }
    })
    db.prepare(
      `UPDATE desktop_controller_binding SET encrypted_secret=(SELECT encrypted_secret FROM desktop_controller_binding WHERE binding_id=?),
      iv=(SELECT iv FROM desktop_controller_binding WHERE binding_id=?),auth_tag=(SELECT auth_tag FROM desktop_controller_binding WHERE binding_id=?) WHERE binding_id=?`
    ).run(intent.binding_id, intent.binding_id, intent.binding_id, other.binding_id)
    expect(() => vault.resolve(other.binding_id)).toThrow('BINDING_UNAVAILABLE')
    db.prepare('UPDATE desktop_controller_binding SET revision=revision+1 WHERE binding_id=?').run(
      intent.binding_id
    )
    expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
  })
  it('rejects public authority and granted metadata tampering even if JSON remains valid', () => {
    active()
    db.prepare('UPDATE desktop_controller_binding SET intent_json=? WHERE binding_id=?').run(
      JSON.stringify({ ...intent, manifest_sha256: 'b'.repeat(64) }),
      intent.binding_id
    )
    expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
    db.prepare(
      'UPDATE desktop_controller_binding SET intent_json=?,client_json=? WHERE binding_id=?'
    ).run(
      JSON.stringify(intent),
      JSON.stringify({ ...issued.client, display_name: 'tampered' }),
      intent.binding_id
    )
    expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
  })
  it('refuses archived VPS, changed endpoint and changed SSH security revision', () => {
    active()
    db.exec("UPDATE vps SET archived_at='2026-11-06T00:00:00Z' WHERE id=1")
    expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
    db.exec('UPDATE vps SET archived_at=NULL,ssh_security_revision=2 WHERE id=1')
    expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
    db.exec("UPDATE vps SET host='foreign.test' WHERE id=1")
    expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
  })
  it('preserves unknown delivery/client identity and prevents activation after local disable', () => {
    vault.prepare(intent)
    expect(vault.deliveryUnknown(intent.binding_id, 1, issued.client.client_id)).toMatchObject({
      state: 'delivery_unknown',
      revision: 2,
      remote_client_id: issued.client.client_id
    })
    expect(() =>
      vault.activate(intent.binding_id, 2, {
        ...issued,
        client: { ...issued.client, client_id: randomUUID() }
      })
    ).toThrow('BINDING_CHANGED')
    expect(vault.activate(intent.binding_id, 2, issued).state).toBe('active')
    expect(vault.disable(intent.binding_id, 3).state).toBe('disabled')
    expect(() => vault.activate(intent.binding_id, 3, issued)).toThrow('BINDING_CHANGED')
    expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
    expect(
      db.prepare('SELECT encrypted_secret,iv,auth_tag FROM desktop_controller_binding').get()
    ).toEqual({ encrypted_secret: null, iv: null, auth_tag: null })
  })
  it('rejects expired credentials and inconsistent remote controller, scopes and timestamps', () => {
    vault.prepare(intent)
    for (const response of [
      { ...issued, controller_id: 'foreign-controller' },
      { ...issued, client: { ...issued.client, scopes: ['read'] as const } },
      { ...issued, credential: { ...issued.credential, expires_at: new Date(0).toISOString() } }
    ])
      expect(() => vault.activate(intent.binding_id, 1, response)).toThrow('BINDING_CHANGED')
    vault.activate(intent.binding_id, 1, issued)
    const expired = new DesktopControllerVault(
      db,
      new AesGcmCredentialCipher(key),
      () => Date.now() + 31 * 86400000
    )
    expect(() => expired.resolve(intent.binding_id)).toThrow('CREDENTIAL_EXPIRED')
  })
  it('never activates an invalid blob shape and preserves caller transaction ownership', () => {
    vault.prepare(intent)
    expect(() =>
      db
        .prepare(
          "UPDATE desktop_controller_binding SET state='active',remote_client_id=?,client_json=?,encrypted_secret=X'01',iv=NULL,auth_tag=NULL"
        )
        .run(issued.client.client_id, JSON.stringify(issued.client))
    ).toThrow()
    db.exec('BEGIN IMMEDIATE')
    expect(() => vault.activate(intent.binding_id, 1, issued)).toThrow('REQUEST_INVALID')
    expect(db.inTransaction).toBe(true)
    db.exec('ROLLBACK')
    db.prepare('DELETE FROM vps WHERE id=1').run()
    expect(db.prepare('SELECT count(*) AS n FROM desktop_controller_binding').get()).toEqual({
      n: 0
    })
  })
})
