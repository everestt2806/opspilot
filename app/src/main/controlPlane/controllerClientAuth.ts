import type Database from 'better-sqlite3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  PRODUCT_CONTROLLER_API_TOKEN_TTL_SECONDS,
  type ProductApiErrorCode,
  type ProductApiScope,
  type ProductDesktopClientIdentity,
  type ProductDesktopEnrollmentResponse,
  type ProductDesktopEnrollmentReplay
} from '../../../../docs/contracts/product-controller-api'
import { canonicalH2Json } from './productH2Proof'

const requestKey = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const scopes = ['read', 'deploy:manual', 'policy:write'] as const
const enrollmentSchema = z.strictObject({
  request_key: requestKey,
  display_name: z
    .string()
    .min(1)
    .max(128)
    .refine(
      (value) =>
        value.trim() === value &&
        [...value].every(
          (character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127
        )
    ),
  requested_scopes: z
    .array(z.enum(scopes))
    .min(1)
    .max(3)
    .refine((value) => value[0] === 'read' && new Set(value).size === value.length)
})
const revocationSchema = z.strictObject({ request_key: requestKey, client_id: z.string().uuid() })
type ClientRow = {
  client_id: string
  controller_id: string
  display_name: string
  scopes_json: string
  created_at: string
  revoked_at: string | null
}
type RequestRow = {
  operation: string
  body_sha256: string
  client_id: string
  result_json: string | null
}

export class ControllerClientAuthError extends Error {
  constructor(readonly code: ProductApiErrorCode) {
    super(code)
  }
}

/** Không giữ bearer trong repository hoặc SQLite; mọi admin mutation cùng transaction IMMEDIATE. */
export class ControllerClientAuth {
  constructor(
    private readonly database: Database.Database,
    private readonly controllerId: string,
    private readonly administratorIdentity: string,
    private readonly now: () => number = Date.now
  ) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(controllerId) ||
      !/^unix:(?:0|[1-9][0-9]{0,9})$/.test(administratorIdentity)
    )
      throw new ControllerClientAuthError('REQUEST_INVALID')
  }

  enroll(input: unknown): ProductDesktopEnrollmentResponse | ProductDesktopEnrollmentReplay {
    const parsed = enrollmentSchema.safeParse(input)
    if (!parsed.success) throw new ControllerClientAuthError('REQUEST_INVALID')
    const request = parsed.data
    // Stable canonical body: order of permissions is not a second authority.
    const granted = scopes.filter((scope) => request.requested_scopes.includes(scope))
    const body = { display_name: request.display_name, requested_scopes: granted }
    return this.mutate(() => {
      this.assertController()
      const previous = this.replay(request.request_key, 'enroll-desktop-client', body)
      if (previous)
        return {
          state: 'credential_delivery_unknown',
          controller_id: this.controllerId,
          client_id: previous.client_id
        }
      const clientId = randomUUID(),
        credentialId = randomUUID(),
        token = `opspilot_${randomBytes(32).toString('base64url')}`
      const now = this.time(),
        created = new Date(now).toISOString(),
        expires = new Date(now + PRODUCT_CONTROLLER_API_TOKEN_TTL_SECONDS * 1000).toISOString()
      this.database
        .prepare(`INSERT INTO product_desktop_client VALUES(?,?,?,?,?,NULL)`)
        .run(clientId, this.controllerId, request.display_name, JSON.stringify(granted), created)
      this.database
        .prepare(`INSERT INTO product_desktop_credential VALUES(?,?,?,?,?,NULL)`)
        .run(credentialId, clientId, this.digest(token), created, expires)
      this.record(request.request_key, 'enroll-desktop-client', body, clientId, created, null)
      return {
        state: 'issued_once',
        controller_id: this.controllerId,
        client: {
          client_id: clientId,
          controller_id: this.controllerId,
          display_name: request.display_name,
          scopes: granted,
          created_at: created,
          revoked_at: null,
          token_expires_at: expires
        },
        credential: { access_token: token, token_type: 'Bearer', expires_at: expires }
      }
    })
  }

  revoke(input: unknown): { client_id: string; revoked_at: string } {
    const parsed = revocationSchema.safeParse(input)
    if (!parsed.success) throw new ControllerClientAuthError('REQUEST_INVALID')
    const request = parsed.data,
      body = { client_id: request.client_id }
    return this.mutate(() => {
      this.assertController()
      const previous = this.replay(request.request_key, 'revoke-desktop-client', body)
      if (previous) {
        const result = JSON.parse(previous.result_json!) as {
          client_id: string
          revoked_at: string
        }
        if (
          !result ||
          Object.keys(result).sort().join(',') !== 'client_id,revoked_at' ||
          result.client_id !== request.client_id ||
          !this.validTimestamp(result.revoked_at)
        )
          throw new ControllerClientAuthError('INTERNAL_ERROR')
        return result
      }
      const client = this.database
        .prepare('SELECT * FROM product_desktop_client WHERE controller_id=? AND client_id=?')
        .get(this.controllerId, request.client_id) as ClientRow | undefined
      if (!client) throw new ControllerClientAuthError('NOT_FOUND')
      const timestamp = new Date(this.time()).toISOString(),
        revoked = client.revoked_at ?? timestamp
      this.database
        .prepare(
          'UPDATE product_desktop_client SET revoked_at=? WHERE client_id=? AND revoked_at IS NULL'
        )
        .run(revoked, client.client_id)
      this.database
        .prepare(
          'UPDATE product_desktop_credential SET revoked_at=? WHERE client_id=? AND revoked_at IS NULL'
        )
        .run(timestamp, client.client_id)
      const result = { client_id: client.client_id, revoked_at: revoked }
      this.record(
        request.request_key,
        'revoke-desktop-client',
        body,
        client.client_id,
        timestamp,
        JSON.stringify(result)
      )
      return result
    })
  }

  authenticate(
    authorization: unknown,
    requiredScope: ProductApiScope = 'read'
  ): ProductDesktopClientIdentity {
    if (
      typeof authorization !== 'string' ||
      !/^Bearer opspilot_[A-Za-z0-9_-]{43}$/.test(authorization)
    )
      throw new ControllerClientAuthError('AUTH_REQUIRED')
    if (!scopes.includes(requiredScope)) throw new ControllerClientAuthError('SCOPE_REQUIRED')
    // Một statement cho coherent current credential/client/controller snapshot; caller rechecks tại write transaction.
    const row = this.database
      .prepare(
        `SELECT c.*,k.expires_at,k.revoked_at AS credential_revoked_at,pc.status AS controller_status
      FROM product_desktop_credential k JOIN product_desktop_client c ON c.client_id=k.client_id
      JOIN product_controller pc ON pc.controller_id=c.controller_id WHERE c.controller_id=? AND k.token_sha256=?`
      )
      .get(this.controllerId, this.digest(authorization.slice(7))) as
      | (ClientRow & {
          expires_at: string
          credential_revoked_at: string | null
          controller_status: string
        })
      | undefined
    if (!row || !['active', 'maintenance'].includes(row.controller_status))
      throw new ControllerClientAuthError('AUTH_REQUIRED')
    if (row.revoked_at) throw new ControllerClientAuthError('CLIENT_REVOKED')
    if (row.credential_revoked_at) throw new ControllerClientAuthError('CREDENTIAL_REVOKED')
    if (
      !this.validTimestamp(row.created_at) ||
      !this.validTimestamp(row.expires_at) ||
      Date.parse(row.created_at) > this.time() ||
      Date.parse(row.expires_at) <= this.time()
    )
      throw new ControllerClientAuthError('CREDENTIAL_EXPIRED')
    let permissions: unknown
    try {
      permissions = JSON.parse(row.scopes_json)
    } catch {
      throw new ControllerClientAuthError('AUTH_REQUIRED')
    }
    if (
      !Array.isArray(permissions) ||
      !permissions.includes('read') ||
      permissions.some((scope) => !scopes.includes(scope)) ||
      new Set(permissions).size !== permissions.length
    )
      throw new ControllerClientAuthError('AUTH_REQUIRED')
    if (!permissions.includes(requiredScope)) throw new ControllerClientAuthError('SCOPE_REQUIRED')
    return {
      client_id: row.client_id,
      controller_id: this.controllerId,
      display_name: row.display_name,
      scopes: permissions as ProductApiScope[],
      created_at: row.created_at,
      revoked_at: null,
      token_expires_at: row.expires_at
    }
  }

  private mutate<T>(operation: () => T): T {
    if (this.database.inTransaction) throw new ControllerClientAuthError('REQUEST_INVALID')
    return this.database.transaction(operation).immediate()
  }
  private assertController(): void {
    if (
      !this.database
        .prepare("SELECT 1 FROM product_controller WHERE controller_id=? AND status='active'")
        .get(this.controllerId)
    )
      throw new ControllerClientAuthError('CONTROLLER_MISMATCH')
  }
  private replay(key: string, operation: string, body: unknown): RequestRow | undefined {
    const row = this.database
      .prepare(
        'SELECT * FROM product_desktop_admin_request WHERE controller_id=? AND administrator_identity=? AND request_key=?'
      )
      .get(this.controllerId, this.administratorIdentity, key) as RequestRow | undefined
    if (
      row &&
      (row.operation !== operation || row.body_sha256 !== this.digest(canonicalH2Json(body)))
    )
      throw new ControllerClientAuthError('IDEMPOTENCY_CONFLICT')
    return row
  }
  private record(
    key: string,
    operation: string,
    body: unknown,
    clientId: string,
    created: string,
    result: string | null
  ): void {
    this.database
      .prepare('INSERT INTO product_desktop_admin_request VALUES(?,?,?,?,?,?,?,?)')
      .run(
        this.controllerId,
        this.administratorIdentity,
        key,
        operation,
        this.digest(canonicalH2Json(body)),
        clientId,
        created,
        result
      )
  }
  private digest(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }
  private time(): number {
    const now = this.now()
    if (!Number.isSafeInteger(now) || now < 0) throw new ControllerClientAuthError('INTERNAL_ERROR')
    return now
  }
  private validTimestamp(value: string): boolean {
    const ms = Date.parse(value)
    return Number.isFinite(ms) && new Date(ms).toISOString() === value
  }
}
