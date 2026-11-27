import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { ControllerClientAuth } from './controllerClientAuth'
import { PRODUCT_CONTROLLER_API_TOKEN_TTL_SECONDS } from '../../../../docs/contracts/product-controller-api'

let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  auth: ControllerClientAuth,
  now: number
const request = (): { request_key: string; display_name: string; requested_scopes: string[] } => ({
  request_key: randomUUID(),
  display_name: 'Desktop unit',
  requested_scopes: ['read']
})
function issue(input: unknown = request()): { token: string; client: string } {
  const result = auth.enroll(input)
  if (result.state !== 'issued_once') throw new Error('UNIT_ISSUE_EXPECTED')
  return { token: result.credential.access_token, client: result.client.client_id }
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-client-auth-'))
  db = initializeDatabase(directory)
  now = Date.parse('2026-11-06T00:00:00.000Z')
  db.prepare('INSERT INTO product_controller VALUES(?,?,?)').run(
    'unit-controller',
    new Date(now).toISOString(),
    'active'
  )
  auth = new ControllerClientAuth(db, 'unit-controller', 'unix:1000', () => now)
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
describe('Controller client credentials', () => {
  it('issues random opaque bearer once, persists only digest and returns exact TTL identity', () => {
    const input = request(),
      result = auth.enroll(input)
    expect(result.state).toBe('issued_once')
    if (result.state !== 'issued_once') return
    expect(result.credential.access_token).toMatch(/^opspilot_[A-Za-z0-9_-]{43}$/)
    expect(Date.parse(result.credential.expires_at) - now).toBe(
      PRODUCT_CONTROLLER_API_TOKEN_TTL_SECONDS * 1000
    )
    const row = db.prepare('SELECT * FROM product_desktop_credential').get()
    expect(row).toMatchObject({
      token_sha256: createHash('sha256').update(result.credential.access_token).digest('hex')
    })
    for (const table of [
      'product_desktop_credential',
      'product_desktop_client',
      'product_desktop_admin_request'
    ])
      expect(JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all())).not.toContain(
        result.credential.access_token
      )
    expect(auth.authenticate(`Bearer ${result.credential.access_token}`)).toEqual(result.client)
    expect(auth.enroll(input)).toEqual({
      state: 'credential_delivery_unknown',
      controller_id: 'unit-controller',
      client_id: result.client.client_id
    })
    expect(db.prepare('SELECT count(*) AS n FROM product_desktop_credential').get()).toEqual({
      n: 1
    })
  })
  it('serializes replay across a fresh SQLite connection without secret regeneration', () => {
    const input = request(),
      first = issue(input),
      cold = new Database(join(directory, 'opspilot.db'))
    try {
      const other = new ControllerClientAuth(cold, 'unit-controller', 'unix:1000', () => now)
      expect(other.enroll(input)).toEqual({
        state: 'credential_delivery_unknown',
        controller_id: 'unit-controller',
        client_id: first.client
      })
      expect(other.authenticate(`Bearer ${first.token}`).client_id).toBe(first.client)
      expect(cold.prepare('SELECT count(*) AS n FROM product_desktop_client').get()).toEqual({
        n: 1
      })
    } finally {
      cold.close()
    }
  })
  it('binds admin request keys to immutable operation/body and to the trusted admin namespace', () => {
    const input = request(),
      first = issue(input)
    expect(() => auth.enroll({ ...input, display_name: 'Changed' })).toThrow('IDEMPOTENCY_CONFLICT')
    expect(() => auth.enroll({ ...input, requested_scopes: ['read', 'policy:write'] })).toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
    expect(() => auth.revoke({ request_key: input.request_key, client_id: first.client })).toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
    const another = new ControllerClientAuth(db, 'unit-controller', 'unix:1001', () => now)
    expect(another.enroll(input).state).toBe('issued_once')
    expect(db.prepare('SELECT count(*) AS n FROM product_desktop_client').get()).toEqual({ n: 2 })
  })
  it.each([
    {},
    null,
    { ...request(), administrator_identity: 'unix:0' },
    { ...request(), requested_scopes: ['deploy:manual'] },
    { ...request(), requested_scopes: ['read', 'read'] },
    { ...request(), requested_scopes: ['read', 'admin'] },
    { ...request(), display_name: ' spaced ' },
    { ...request(), display_name: 'line\nbreak' },
    { ...request(), request_key: 'not-a-uuid' }
  ])('rejects malformed or body-actor enrollment %j', (input) => {
    expect(() => auth.enroll(input)).toThrow('REQUEST_INVALID')
    expect(db.prepare('SELECT count(*) AS n FROM product_desktop_client').get()).toEqual({ n: 0 })
  })
  it('checks token syntax, scope, expiry boundary, and current controller identity', () => {
    const { token, client } = issue()
    for (const header of [
      undefined,
      '',
      token,
      `bearer ${token}`,
      `Bearer ${token} `,
      `Bearer ${token}, ${token}`,
      `Bearer opspilot_${'A'.repeat(43)}`
    ])
      expect(() => auth.authenticate(header)).toThrow('AUTH_REQUIRED')
    expect(() => auth.authenticate(`Bearer ${token}`, 'deploy:manual')).toThrow('SCOPE_REQUIRED')
    const privileged = issue({
      ...request(),
      requested_scopes: ['read', 'policy:write', 'deploy:manual']
    })
    expect(auth.authenticate(`Bearer ${privileged.token}`, 'deploy:manual').scopes).toEqual([
      'read',
      'deploy:manual',
      'policy:write'
    ])
    const other = new ControllerClientAuth(db, 'different-controller', 'unix:1000', () => now)
    expect(() => other.enroll(request())).toThrow('CONTROLLER_MISMATCH')
    expect(() => other.authenticate(`Bearer ${token}`)).toThrow('AUTH_REQUIRED')
    expect(auth.authenticate(`Bearer ${token}`).client_id).toBe(client)
    now += PRODUCT_CONTROLLER_API_TOKEN_TTL_SECONDS * 1000
    expect(() => auth.authenticate(`Bearer ${token}`)).toThrow('CREDENTIAL_EXPIRED')
  })
  it('reauthorizes current controller before replay and never silently reactivates revoked clients', () => {
    const input = request(),
      issued = issue(input)
    db.exec("UPDATE product_controller SET status='revoked'")
    expect(() => auth.enroll(input)).toThrow('CONTROLLER_MISMATCH')
    expect(() => auth.authenticate(`Bearer ${issued.token}`)).toThrow('AUTH_REQUIRED')
    db.exec("UPDATE product_controller SET status='active'")
    const revoke = { request_key: randomUUID(), client_id: issued.client }
    const result = auth.revoke(revoke)
    expect(() => auth.authenticate(`Bearer ${issued.token}`)).toThrow('CLIENT_REVOKED')
    now += 10000
    expect(auth.revoke(revoke)).toEqual(result)
    expect(auth.revoke({ ...revoke, request_key: randomUUID() })).toEqual(result)
    expect(auth.enroll(input)).toMatchObject({
      state: 'credential_delivery_unknown',
      client_id: issued.client
    })
    expect(db.prepare('SELECT revoked_at FROM product_desktop_credential').get()).toMatchObject({
      revoked_at: result.revoked_at
    })
  })
  it('fails closed for damaged permissions/timestamps and credential-level revocation', () => {
    const { token } = issue()
    for (const broken of ['[]', '["read","admin"]', '{bad', '["read","read"]']) {
      db.prepare('UPDATE product_desktop_client SET scopes_json=?').run(broken)
      expect(() => auth.authenticate(`Bearer ${token}`)).toThrow('AUTH_REQUIRED')
    }
    db.exec(
      `UPDATE product_desktop_client SET scopes_json='["read"]';UPDATE product_desktop_credential SET revoked_at='2026-11-06T00:00:00.000Z'`
    )
    expect(() => auth.authenticate(`Bearer ${token}`)).toThrow('CREDENTIAL_REVOKED')
    db.exec("UPDATE product_desktop_credential SET revoked_at=NULL,expires_at='invalid'")
    expect(() => auth.authenticate(`Bearer ${token}`)).toThrow('CREDENTIAL_EXPIRED')
  })
  it('does not consume caller transactions or auto-create data on malformed revoke', () => {
    db.exec('BEGIN IMMEDIATE')
    expect(() => auth.enroll(request())).toThrow('REQUEST_INVALID')
    expect(db.inTransaction).toBe(true)
    db.exec('ROLLBACK')
    expect(() => auth.revoke({ request_key: randomUUID(), client_id: 'bad' })).toThrow(
      'REQUEST_INVALID'
    )
    expect(() => auth.revoke({ request_key: randomUUID(), client_id: randomUUID() })).toThrow(
      'NOT_FOUND'
    )
    expect(db.prepare('SELECT count(*) AS n FROM product_desktop_admin_request').get()).toEqual({
      n: 0
    })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
