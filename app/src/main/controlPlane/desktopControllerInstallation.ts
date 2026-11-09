import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { SshManager, SshVerifiedConnectionIdentity } from '../ssh/manager'
import type {
  DesktopControllerRelease,
  DesktopInstallation,
  DesktopInstallationOperation,
  DesktopInstallationPlan
} from '../../../../docs/contracts/desktop-controller-installation'
import {
  callControllerBootstrap,
  discoverControllerBootstrap,
  transferControllerRelease,
  controllerInstallationResultSchema,
  ControllerBootstrapError
} from './controllerSshBootstrap'
import { controllerVpsEnrollmentSchema } from './controllerEnrollment'
import { canonicalH2Json } from './productH2Proof'

const session = randomUUID()
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const uuid = z.uuidv4().refine((v) => v === v.toLowerCase())
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const profileFields = controllerVpsEnrollmentSchema.shape.profile.shape
const principalSchema = z.strictObject({
  vpsId: positive,
  host: profileFields.host,
  port: profileFields.port,
  hostFingerprint: profileFields.host_fingerprint,
  username: profileFields.username,
  authType: profileFields.auth_type
})
const rowSchema = z.strictObject({
  request_key: uuid,
  vps_id: positive,
  authority_revision: positive,
  ssh_security_revision: positive,
  principal_json: z.string().max(2048),
  identity_key: sha,
  credential_digest: sha,
  release_id: z.string().min(1).max(128),
  release_sha256: sha,
  installer_sha256: sha,
  state: z.enum([
    'prepared',
    'in_flight',
    'outcome_unknown',
    'transferred',
    'installed',
    'cancelled'
  ]),
  last_operation: z.enum(['none', 'transfer', 'install', 'recover', 'inspect']),
  operation_id: uuid.nullable(),
  owner_session: uuid.nullable(),
  ever_dispatched: z.union([z.literal(0), z.literal(1)]),
  install_attempted: z.union([z.literal(0), z.literal(1)]),
  discovery_existing: z.union([z.literal(0), z.literal(1)]),
  controller_id: uuid.nullable(),
  result_json: z.string().max(4096).nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})
type Row = z.output<typeof rowSchema>
type Local = {
  principal: SshVerifiedConnectionIdentity
  revision: number
  digest: string
  identity: string
}
type Plan = {
  local: Local
  release: DesktopControllerRelease
  key: string
  remote: boolean
  existing: Row | undefined
  expires: number
}
type Transport = {
  discover: typeof discoverControllerBootstrap
  call: typeof callControllerBootstrap
  transfer: typeof transferControllerRelease
}
export type DesktopInstallationOptions = {
  /** Internal executable composition/test seams. Never accept these through IPC. */
  transport?: Transport
  bootstrapScript?: { text: string; sha256: string }
  sessionId?: string
}
export class DesktopInstallationError extends Error {
  constructor(
    readonly code:
      | 'INSTALL_INPUT_INVALID'
      | 'INSTALL_UNAVAILABLE'
      | 'INSTALL_AUTHORITY_CHANGED'
      | 'INSTALL_CONFLICT'
      | 'INSTALL_BUSY'
      | 'INSTALL_PLAN_EXPIRED'
      | 'INSTALL_REBIND_REQUIRED'
      | 'INSTALL_INSPECT_REQUIRED'
      | 'INSTALL_CATALOG_UNKNOWN'
  ) {
    super(code)
  }
}

/** Desktop journal coordinates a single remote UUID; it never duplicates controller state. */
export class DesktopControllerInstallations {
  private readonly catalog: readonly DesktopControllerRelease[]
  private readonly transport: Transport
  private readonly session: string
  private readonly plans = new Map<string, Plan>()
  constructor(
    private readonly db: Database.Database,
    private readonly ssh: Pick<SshManager, 'openProductBootstrapChannel'>,
    catalog: readonly DesktopControllerRelease[],
    private readonly options: DesktopInstallationOptions = {}
  ) {
    this.session = uuid.parse(options.sessionId ?? session)
    this.catalog = catalog.map((value) =>
      Object.freeze(
        z
          .strictObject({
            release_id: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
            release_directory: z.string().min(1).max(1024).refine(isAbsolute),
            installer_path: z.string().min(1).max(1024).refine(isAbsolute),
            release_sha256: sha,
            installer_sha256: sha
          })
          .parse(value)
      )
    )
    if (
      new Set(this.catalog.map((v) => v.release_id)).size !== this.catalog.length ||
      new Set(this.catalog.map((v) => v.release_sha256 + v.installer_sha256)).size !==
        this.catalog.length
    )
      throw new DesktopInstallationError('INSTALL_INPUT_INVALID')
    this.transport = options.transport ?? {
      discover: discoverControllerBootstrap,
      call: callControllerBootstrap,
      transfer: transferControllerRelease
    }
  }

  async plan(vpsId: number, releaseId: string): Promise<DesktopInstallationPlan> {
    const local = this.local(vpsId)
    let release = this.catalog.find((v) => v.release_id === releaseId)
    if (!release) throw new DesktopInstallationError('INSTALL_CATALOG_UNKNOWN')
    const discovered = await this.transport.discover({
      ssh: this.ssh,
      vpsId,
      expectedIdentity: local.principal,
      assertCurrent: () => this.assertLocal(local),
      bootstrapScript: this.options.bootstrapScript
    })
    this.assertLocal(local)
    const existing = this.db
      .prepare(
        "SELECT * FROM desktop_controller_installation WHERE identity_key=? AND state<>'cancelled'"
      )
      .get(local.identity)
    const row = existing ? this.cold(this.valid(existing)) : undefined
    if (discovered.state === 'discovered') {
      release = this.catalog.find(
        (v) =>
          v.release_sha256 === discovered.release_sha256 &&
          v.installer_sha256 === discovered.installer_sha256
      )
      if (!release) throw new DesktopInstallationError('INSTALL_CATALOG_UNKNOWN')
      if (
        row &&
        (row.request_key !== discovered.request_key ||
          row.release_sha256 !== discovered.release_sha256 ||
          row.installer_sha256 !== discovered.installer_sha256)
      )
        throw new DesktopInstallationError('INSTALL_CONFLICT')
    } else if (row) {
      release = this.release(row)
    }
    const key =
      row?.request_key ??
      (discovered.state === 'discovered' ? discovered.request_key : randomUUID())
    const plan: Plan = {
      local,
      release,
      key,
      remote: discovered.state === 'discovered',
      existing: row,
      expires: Date.now() + 60000
    }
    for (const [id, old] of this.plans) if (old.expires < Date.now()) this.plans.delete(id)
    if (this.plans.size >= 128) throw new DesktopInstallationError('INSTALL_BUSY')
    const id = randomUUID()
    this.plans.set(id, plan)
    return {
      plan_id: id,
      expires_at: new Date(plan.expires).toISOString(),
      vps_id: vpsId,
      host: local.principal.host,
      username: local.principal.username,
      host_fingerprint: local.principal.hostFingerprint,
      release_id: release.release_id,
      request_key: key,
      remote_existing: plan.remote,
      rebind_required: !!row && !this.matches(row, local)
    }
  }

  prepare(planId: string): DesktopInstallation {
    return this.mutate(() => {
      const plan = this.review(planId)
      const old = this.db
        .prepare(
          "SELECT * FROM desktop_controller_installation WHERE identity_key=? AND state<>'cancelled'"
        )
        .get(plan.local.identity)
      if (old) {
        const row = this.cold(this.valid(old))
        if (row.request_key !== plan.key) throw new DesktopInstallationError('INSTALL_CONFLICT')
        if (!this.matches(row, plan.local))
          throw new DesktopInstallationError('INSTALL_REBIND_REQUIRED')
        this.plans.delete(planId)
        return this.metadata(row)
      }
      // A cancelled/mismatched row cannot be silently overwritten by a discovered hint.
      if (
        plan.existing ||
        this.db
          .prepare('SELECT 1 FROM desktop_controller_installation WHERE request_key=?')
          .get(plan.key)
      )
        throw new DesktopInstallationError('INSTALL_CONFLICT')
      const now = new Date().toISOString()
      this.db
        .prepare(
          `INSERT INTO desktop_controller_installation
        (request_key,vps_id,authority_revision,ssh_security_revision,principal_json,identity_key,credential_digest,
         release_id,release_sha256,installer_sha256,state,last_operation,discovery_existing,created_at,updated_at)
        VALUES(?,?,1,?,?,?,?,?,?,?,?,'none',?,?,?)`
        )
        .run(
          plan.key,
          plan.local.principal.vpsId,
          plan.local.revision,
          canonicalH2Json(plan.local.principal),
          plan.local.identity,
          plan.local.digest,
          plan.release.release_id,
          plan.release.release_sha256,
          plan.release.installer_sha256,
          plan.remote ? 'outcome_unknown' : 'prepared',
          plan.remote ? 1 : 0,
          now,
          now
        )
      this.plans.delete(planId)
      return this.metadata(this.row(plan.key))
    })
  }

  rebind(planId: string, requestKey: string, confirm: true): DesktopInstallation {
    if (confirm !== true) throw new DesktopInstallationError('INSTALL_INPUT_INVALID')
    return this.mutate(() => {
      const plan = this.review(planId),
        row = this.cold(this.row(requestKey))
      if (row.state === 'in_flight') throw new DesktopInstallationError('INSTALL_BUSY')
      if (
        row.state === 'cancelled' ||
        plan.key !== row.request_key ||
        plan.local.identity !== row.identity_key ||
        plan.release.release_sha256 !== row.release_sha256 ||
        plan.release.installer_sha256 !== row.installer_sha256
      )
        throw new DesktopInstallationError('INSTALL_CONFLICT')
      if (!plan.existing || plan.existing.authority_revision !== row.authority_revision)
        throw new DesktopInstallationError('INSTALL_AUTHORITY_CHANGED')
      this.db
        .prepare(
          `UPDATE desktop_controller_installation SET vps_id=?,ssh_security_revision=?,
        principal_json=?,credential_digest=?,authority_revision=authority_revision+1,
        state='outcome_unknown',operation_id=NULL,owner_session=NULL,updated_at=? WHERE request_key=?`
        )
        .run(
          plan.local.principal.vpsId,
          plan.local.revision,
          canonicalH2Json(plan.local.principal),
          plan.local.digest,
          new Date().toISOString(),
          requestKey
        )
      this.plans.delete(planId)
      return this.metadata(this.row(requestKey))
    })
  }

  list(): DesktopInstallation[] {
    return this.mutate(() =>
      this.db
        .prepare('SELECT * FROM desktop_controller_installation ORDER BY created_at,request_key')
        .all()
        .map((v) => this.metadata(this.cold(this.valid(v))))
    )
  }
  cancel(key: string): DesktopInstallation {
    return this.mutate(() => {
      const row = this.cold(this.row(key))
      this.current(row)
      if (row.state !== 'prepared' || row.ever_dispatched || row.discovery_existing)
        throw new DesktopInstallationError('INSTALL_CONFLICT')
      this.db
        .prepare(
          "UPDATE desktop_controller_installation SET state='cancelled',updated_at=? WHERE request_key=?"
        )
        .run(new Date().toISOString(), key)
      return this.metadata(this.row(key))
    })
  }
  inspect(key: string): Promise<DesktopInstallation> {
    return this.dispatch(key, 'inspect')
  }
  send(
    key: string,
    operation: Exclude<DesktopInstallationOperation, 'inspect'>,
    consent: true
  ): Promise<DesktopInstallation> {
    if (consent !== true || !['transfer', 'install', 'recover'].includes(operation))
      return Promise.reject(new DesktopInstallationError('INSTALL_INPUT_INVALID'))
    return this.dispatch(key, operation)
  }

  private async dispatch(
    key: string,
    operation: DesktopInstallationOperation
  ): Promise<DesktopInstallation> {
    const claimed = this.mutate(() => {
      const row = this.cold(this.row(key))
      this.current(row)
      if (row.state === 'in_flight') throw new DesktopInstallationError('INSTALL_BUSY')
      if (row.state === 'cancelled') throw new DesktopInstallationError('INSTALL_CONFLICT')
      if (operation === 'install' && row.state !== 'transferred')
        throw new DesktopInstallationError('INSTALL_INSPECT_REQUIRED')
      if (
        operation === 'recover' &&
        (row.state !== 'outcome_unknown' || (!row.install_attempted && !row.discovery_existing))
      )
        throw new DesktopInstallationError('INSTALL_INSPECT_REQUIRED')
      if (operation === 'transfer' && row.state === 'installed')
        throw new DesktopInstallationError('INSTALL_CONFLICT')
      this.release(row)
      this.db
        .prepare(
          `UPDATE desktop_controller_installation SET state='in_flight',last_operation=?,operation_id=?,
        owner_session=?,ever_dispatched=1,install_attempted=max(install_attempted,?),updated_at=? WHERE request_key=?`
        )
        .run(
          operation,
          randomUUID(),
          this.session,
          ['install', 'recover'].includes(operation) ? 1 : 0,
          new Date().toISOString(),
          key
        )
      return this.row(key)
    })
    const assertCurrent = (): void => {
      const row = this.row(key)
      if (
        row.state !== 'in_flight' ||
        row.owner_session !== this.session ||
        row.operation_id !== claimed.operation_id ||
        row.authority_revision !== claimed.authority_revision
      )
        throw new DesktopInstallationError('INSTALL_AUTHORITY_CHANGED')
      this.current(row)
    }
    const input = {
      ssh: this.ssh,
      vpsId: claimed.vps_id,
      expectedIdentity: JSON.parse(claimed.principal_json) as SshVerifiedConnectionIdentity,
      locator: {
        request_key: key,
        release_sha256: claimed.release_sha256,
        installer_sha256: claimed.installer_sha256
      },
      assertCurrent,
      bootstrapScript: this.options.bootstrapScript
    }
    try {
      let state: Row['state'] = 'outcome_unknown'
      let result: z.output<typeof controllerInstallationResultSchema> | undefined
      if (operation === 'transfer') {
        const transferred = await this.transport.transfer({
          ...input,
          artifacts: this.release(claimed),
          consent: true
        })
        assertCurrent()
        if (transferred.state !== 'verified') throw new DesktopInstallationError('INSTALL_CONFLICT')
        if (!claimed.install_attempted && !claimed.discovery_existing) state = 'transferred'
      } else if (operation === 'inspect') {
        const status = await this.transport.call({ ...input, operation: 'status' })
        assertCurrent()
        if (status.state === 'verified') {
          try {
            const inspected = await this.transport.call({ ...input, operation: 'inspect' })
            if (inspected.state !== 'installation_result')
              throw new DesktopInstallationError('INSTALL_CONFLICT')
            result = inspected.installation
          } catch (error) {
            if (
              !(error instanceof ControllerBootstrapError) ||
              error.code !== 'BOOTSTRAP_NOT_FOUND' ||
              claimed.controller_id
            )
              throw error
            state = 'transferred'
          }
        }
        // Absent staging is not evidence that an installed service/DB is absent.
      } else {
        const reply = await this.transport.call({ ...input, operation, consent: true })
        if (reply.state !== 'installation_result')
          throw new DesktopInstallationError('INSTALL_CONFLICT')
        result = reply.installation
      }
      assertCurrent()
      if (result) {
        result = controllerInstallationResultSchema.parse(result)
        if (
          result.request_key !== key ||
          (claimed.controller_id && result.controller_id !== claimed.controller_id)
        )
          throw new DesktopInstallationError('INSTALL_CONFLICT')
        state = result.phase === 'installed' ? 'installed' : 'outcome_unknown'
      }
      return this.mutate(() => {
        assertCurrent()
        this.db
          .prepare(
            `UPDATE desktop_controller_installation SET state=?,controller_id=coalesce(?,controller_id),
          result_json=coalesce(?,result_json),operation_id=NULL,owner_session=NULL,updated_at=? WHERE request_key=?`
          )
          .run(
            state,
            result?.controller_id ?? null,
            result ? canonicalH2Json(result) : null,
            new Date().toISOString(),
            key
          )
        return this.metadata(this.row(key))
      })
    } catch (error) {
      this.mutate(() =>
        this.db
          .prepare(
            `UPDATE desktop_controller_installation SET state='outcome_unknown',
        operation_id=NULL,owner_session=NULL,updated_at=? WHERE request_key=? AND state='in_flight'
        AND operation_id=? AND owner_session=? AND authority_revision=?`
          )
          .run(
            new Date().toISOString(),
            key,
            claimed.operation_id,
            this.session,
            claimed.authority_revision
          )
      )
      if (error instanceof DesktopInstallationError || error instanceof ControllerBootstrapError)
        throw error
      throw new DesktopInstallationError('INSTALL_UNAVAILABLE')
    }
  }

  private review(id: string): Plan {
    const plan = this.plans.get(id)
    if (!plan || plan.expires < Date.now())
      throw new DesktopInstallationError('INSTALL_PLAN_EXPIRED')
    this.assertLocal(plan.local)
    return plan
  }
  private release(row: Row): DesktopControllerRelease {
    const value = this.catalog.find(
      (v) =>
        v.release_id === row.release_id &&
        v.release_sha256 === row.release_sha256 &&
        v.installer_sha256 === row.installer_sha256
    )
    if (!value) throw new DesktopInstallationError('INSTALL_CATALOG_UNKNOWN')
    return value
  }
  private local(id: number): Local {
    if (!positive.safeParse(id).success) throw new DesktopInstallationError('INSTALL_INPUT_INVALID')
    const row = this.db
      .prepare(
        `SELECT name,host,port,username,auth_type,host_fingerprint,ssh_security_revision,
      crypto_scheme,encrypted_secret,iv,auth_tag,archived_at FROM vps WHERE id=?`
      )
      .get(id) as Record<string, unknown> | undefined
    if (
      !row ||
      row.archived_at !== null ||
      row.crypto_scheme !== 'aes_256_gcm' ||
      !Buffer.isBuffer(row.encrypted_secret) ||
      row.encrypted_secret.length < 1 ||
      row.encrypted_secret.length > 512 * 1024 ||
      !Buffer.isBuffer(row.iv) ||
      row.iv.length !== 12 ||
      !Buffer.isBuffer(row.auth_tag) ||
      row.auth_tag.length !== 16
    )
      throw new DesktopInstallationError('INSTALL_AUTHORITY_CHANGED')
    const profile = controllerVpsEnrollmentSchema.shape.profile.safeParse({
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      auth_type: row.auth_type,
      host_fingerprint: row.host_fingerprint
    })
    if (!profile.success || !positive.safeParse(row.ssh_security_revision).success)
      throw new DesktopInstallationError('INSTALL_AUTHORITY_CHANGED')
    const principal: SshVerifiedConnectionIdentity = {
      vpsId: id,
      host: profile.data.host,
      port: profile.data.port,
      hostFingerprint: profile.data.host_fingerprint,
      username: profile.data.username,
      authType: profile.data.auth_type
    }
    const digest = this.hash({
      crypto_scheme: row.crypto_scheme,
      ciphertext: row.encrypted_secret.toString('base64'),
      iv: row.iv.toString('base64'),
      tag: row.auth_tag.toString('base64')
    })
    return {
      principal,
      revision: row.ssh_security_revision as number,
      digest,
      identity: this.hash({
        host: principal.host.toLowerCase(),
        port: principal.port,
        hostFingerprint: principal.hostFingerprint,
        username: principal.username
      })
    }
  }
  private hash(value: unknown): string {
    return createHash('sha256').update(canonicalH2Json(value)).digest('hex')
  }
  private matches(row: Row, local: Local): boolean {
    return (
      row.vps_id === local.principal.vpsId &&
      row.ssh_security_revision === local.revision &&
      row.credential_digest === local.digest &&
      row.principal_json === canonicalH2Json(local.principal)
    )
  }
  private assertLocal(local: Local): void {
    const current = this.local(local.principal.vpsId)
    if (
      current.revision !== local.revision ||
      current.digest !== local.digest ||
      canonicalH2Json(current.principal) !== canonicalH2Json(local.principal)
    )
      throw new DesktopInstallationError('INSTALL_AUTHORITY_CHANGED')
  }
  private current(row: Row): void {
    if (!this.matches(row, this.local(row.vps_id)))
      throw new DesktopInstallationError('INSTALL_AUTHORITY_CHANGED')
  }
  private valid(value: unknown): Row {
    const parsed = rowSchema.safeParse(value)
    if (!parsed.success) throw new DesktopInstallationError('INSTALL_UNAVAILABLE')
    const row = parsed.data
    try {
      const principal = principalSchema.parse(JSON.parse(row.principal_json))
      if (
        canonicalH2Json(principal) !== row.principal_json ||
        principal.vpsId !== row.vps_id ||
        this.hash({
          host: principal.host.toLowerCase(),
          port: principal.port,
          hostFingerprint: principal.hostFingerprint,
          username: principal.username
        }) !== row.identity_key ||
        (row.state === 'in_flight' && (!row.operation_id || !row.owner_session)) ||
        (row.state === 'installed' && (!row.controller_id || !row.result_json))
      )
        throw Error()
      if (row.result_json !== null) {
        const result = controllerInstallationResultSchema.parse(JSON.parse(row.result_json))
        if (
          result.request_key !== row.request_key ||
          result.controller_id !== row.controller_id ||
          (row.state === 'installed' && result.phase !== 'installed')
        )
          throw Error()
      }
    } catch {
      throw new DesktopInstallationError('INSTALL_UNAVAILABLE')
    }
    return row
  }
  private row(key: string): Row {
    if (!uuid.safeParse(key).success) throw new DesktopInstallationError('INSTALL_INPUT_INVALID')
    return this.valid(
      this.db.prepare('SELECT * FROM desktop_controller_installation WHERE request_key=?').get(key)
    )
  }
  private cold(row: Row): Row {
    if (row.state === 'in_flight' && row.owner_session !== this.session) {
      this.db
        .prepare(
          `UPDATE desktop_controller_installation SET state='outcome_unknown',operation_id=NULL,
        owner_session=NULL,updated_at=? WHERE request_key=? AND state='in_flight' AND operation_id=?`
        )
        .run(new Date().toISOString(), row.request_key, row.operation_id)
      return this.row(row.request_key)
    }
    return row
  }
  private metadata(row: Row): DesktopInstallation {
    return {
      request_key: row.request_key,
      release_sha256: row.release_sha256,
      installer_sha256: row.installer_sha256,
      vps_id: row.vps_id,
      authority_revision: row.authority_revision,
      release_id: row.release_id,
      state: row.state,
      controller_id: row.controller_id,
      last_result: row.result_json ? JSON.parse(row.result_json) : null,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }
  private mutate<T>(work: () => T): T {
    if (this.db.inTransaction) throw new DesktopInstallationError('INSTALL_BUSY')
    return this.db.transaction(work).immediate()
  }
}
