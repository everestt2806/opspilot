import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { isAbsolute, posix } from 'node:path'
import { z } from 'zod'
import type { SshManager } from '../ssh/manager'
import type { DesktopControllerInstallations } from './desktopControllerInstallation'
import type {
  DesktopUpgrade,
  DesktopUpgradeOperation,
  DesktopUpgradePlan,
  DesktopUpgradeRelease
} from '../../../../docs/contracts/desktop-controller-upgrade'
import type {
  ControllerUpgradeRequest,
  ControllerUpgradeResult
} from '../../../../docs/contracts/product-controller-upgrade'
import { canonicalH2Json } from './productH2Proof'
import { verifyControllerRelease, readReleaseFile, releaseSha256 } from './controllerRelease'
import {
  callControllerBootstrap,
  callControllerUpgrade,
  transferControllerRelease,
  ControllerBootstrapError
} from './controllerSshBootstrap'
import { controllerUpgradeResultSchema } from './controllerUpgradeProtocol'
import type { ProductDesktopControllerBindingIntent } from '../../../../docs/contracts/product-controller-api'
import type {
  ControllerAuthorityReview,
  ControllerAuthorityResult
} from '@shared/controllerAuthority'
import { bindingAtAuthority } from './desktopControllerAuthority'

const session = randomUUID()
const uuid = z.uuidv4().refine((v) => v === v.toLowerCase())
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const rowSchema = z.strictObject({
  sequence: z.number().int().positive(),
  request_key: uuid,
  installation_request_key: uuid,
  controller_id: uuid,
  vps_id: z.number().int().positive(),
  authority_revision: z.number().int().positive(),
  installation_authority_json: z.string().max(4096),
  parent_upgrade_key: uuid.nullable(),
  parent_release_sha256: hash,
  release_id: z.string().min(1).max(128),
  release_sha256: hash,
  installer_sha256: hash,
  state: z.enum([
    'prepared',
    'transferred',
    'in_flight',
    'outcome_unknown',
    'active',
    'rolled_back',
    'cancelled'
  ]),
  last_operation: z.enum(['none', 'transfer', 'upgrade', 'inspect', 'recover', 'rollback']),
  operation_id: uuid.nullable(),
  owner_session: uuid.nullable(),
  ever_dispatched: z.union([z.literal(0), z.literal(1)]),
  upgrade_attempted: z.union([z.literal(0), z.literal(1)]),
  is_current: z.union([z.literal(0), z.literal(1)]),
  result_json: z.string().max(4096).nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})
type Row = z.output<typeof rowSchema>
type Base = ReturnType<DesktopControllerInstallations['upgradeAuthority']>
type Plan = {
  id: string
  key: string
  base: Base
  authority: string
  release: DesktopUpgradeRelease
  head: string | null
  parent: string | null
  pin: string
  expires: number
}
export type DesktopUpgradeOptions = {
  sessionId?: string
  bootstrapScript?: { text: string; sha256: string }
  transport?: {
    call: typeof callControllerBootstrap
    upgrade: typeof callControllerUpgrade
    transfer: typeof transferControllerRelease
  }
}
export class DesktopUpgradeError extends Error {
  constructor(
    readonly code:
      | 'UPGRADE_INPUT_INVALID'
      | 'UPGRADE_AUTHORITY_CHANGED'
      | 'UPGRADE_BUSY'
      | 'UPGRADE_CONFLICT'
      | 'UPGRADE_INSPECT_REQUIRED'
      | 'UPGRADE_PLAN_EXPIRED'
      | 'UPGRADE_UNAVAILABLE'
  ) {
    super(code)
  }
}

/** Nhật ký Main; mọi kết quả remote vẫn cần attestation, không đổi API binding/token. */
export class DesktopControllerUpgrades {
  private readonly session: string
  private readonly catalog: readonly DesktopUpgradeRelease[]
  private readonly transport: NonNullable<DesktopUpgradeOptions['transport']>
  private readonly plans = new Map<string, Plan>()
  private readonly authorityReviews = new Map<
    string,
    {
      before: string
      next: string
      snapshot: string
      key: string
      result: ControllerUpgradeResult
      review: ControllerAuthorityReview
    }
  >()
  constructor(
    private readonly db: Database.Database,
    private readonly installations: DesktopControllerInstallations,
    private readonly ssh: Pick<SshManager, 'openProductBootstrapChannel'>,
    catalog: readonly DesktopUpgradeRelease[],
    private readonly options: DesktopUpgradeOptions = {}
  ) {
    this.session = uuid.parse(options.sessionId ?? session)
    this.catalog = catalog.map((v) =>
      Object.freeze(
        z
          .strictObject({
            release_id: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
            release_directory: z.string().max(1024).refine(isAbsolute),
            installer_path: z.string().max(1024).refine(isAbsolute),
            release_sha256: hash,
            installer_sha256: hash
          })
          .parse(v)
      )
    )
    if (new Set(this.catalog.map((v) => v.release_id)).size !== this.catalog.length)
      throw new DesktopUpgradeError('UPGRADE_INPUT_INVALID')
    this.transport = options.transport ?? {
      call: callControllerBootstrap,
      upgrade: callControllerUpgrade,
      transfer: transferControllerRelease
    }
  }
  private authority(base: Base): string {
    const i = base.installation,
      r = i.last_result!
    return canonicalH2Json({
      installation_request_key: i.request_key,
      controller_id: i.controller_id,
      vps_id: i.vps_id,
      authority_revision: i.authority_revision,
      principal: base.principal,
      credential_digest: base.credential_digest,
      ssh_security_revision: base.ssh_security_revision,
      release_sha256: i.release_sha256,
      installer_sha256: i.installer_sha256,
      runtime_uid: r.runtime_uid,
      artifact_path: r.artifact_path,
      node_path: r.node_path,
      data_directory: r.data_directory,
      payload_sha256: r.payload_sha256
    })
  }
  async reviewAuthority(
    installationKey: string,
    vpsId: number
  ): Promise<ControllerAuthorityReview> {
    uuid.parse(installationKey)
    this.list(installationKey)
    const before = this.authority(this.installations.retainedUpgradeAuthority(installationKey)),
      candidate = this.installations.candidateUpgradeAuthority(installationKey, vpsId),
      next = this.authority(candidate),
      rows = this.db
        .prepare(
          "SELECT * FROM desktop_controller_upgrade WHERE installation_request_key=? AND state<>'cancelled' ORDER BY sequence"
        )
        .all(installationKey) as Row[],
      latest = rows.at(-1)
    if (
      !latest ||
      !latest.upgrade_attempted ||
      rows.some((r) => r.state === 'in_flight' || r.installation_authority_json !== before)
    )
      throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
    const snapshot = canonicalH2Json(rows)
    const assertCurrent = (): void => {
      if (
        this.authority(this.installations.retainedUpgradeAuthority(installationKey)) !== before ||
        this.authority(this.installations.candidateUpgradeAuthority(installationKey, vpsId)) !==
          next ||
        canonicalH2Json(
          this.db
            .prepare(
              "SELECT * FROM desktop_controller_upgrade WHERE installation_request_key=? AND state<>'cancelled' ORDER BY sequence"
            )
            .all(installationKey)
        ) !== snapshot
      )
        throw new DesktopUpgradeError('UPGRADE_AUTHORITY_CHANGED')
    }
    this.release(latest.release_id)
    const input = {
      ssh: this.ssh,
      vpsId,
      expectedIdentity: candidate.principal,
      locator: {
        request_key: latest.request_key,
        release_sha256: latest.release_sha256,
        installer_sha256: latest.installer_sha256
      },
      purpose: 'upgrade' as const,
      assertCurrent,
      bootstrapScript: this.options.bootstrapScript
    }
    const status = await this.transport.call({ ...input, operation: 'status' })
    assertCurrent()
    if (status.state !== 'verified') throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
    const result = controllerUpgradeResultSchema.parse(
      await this.transport.upgrade({
        ...input,
        request: {
          format: 1,
          request_key: latest.request_key,
          installation_request_key: installationKey,
          controller_id: latest.controller_id,
          parent_upgrade_key: latest.parent_upgrade_key,
          parent_release_sha256: latest.parent_release_sha256,
          release_sha256: latest.release_sha256,
          operation: 'inspect-upgrade'
        }
      })
    )
    assertCurrent()
    this.correlate(latest, result)
    if (
      !result.is_current ||
      result.service_state !== 'running' ||
      !['active', 'rolled_back'].includes(result.phase)
    )
      throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
    for (const [id, plan] of this.authorityReviews)
      if (Date.parse(plan.review.expires_at) <= Date.now()) this.authorityReviews.delete(id)
    if (this.authorityReviews.size >= 32) throw new DesktopUpgradeError('UPGRADE_BUSY')
    const review: ControllerAuthorityReview = {
      plan_id: randomUUID(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      installation_request_key: installationKey,
      upgrade_request_key: latest.request_key,
      controller_id: latest.controller_id,
      previous_vps_id: latest.vps_id,
      vps_id: vpsId,
      host: candidate.principal.host,
      username: candidate.principal.username,
      host_fingerprint: candidate.principal.hostFingerprint,
      from_revision: latest.authority_revision,
      to_revision: candidate.installation.authority_revision
    }
    this.authorityReviews.set(review.plan_id, {
      before,
      next,
      snapshot,
      key: installationKey,
      result,
      review
    })
    return review
  }
  confirmAuthority(planId: string, consent: true): ControllerAuthorityResult {
    if (consent !== true) throw new DesktopUpgradeError('UPGRADE_INPUT_INVALID')
    return this.mutate(() => {
      const plan = this.authorityReviews.get(uuid.parse(planId))
      if (!plan || Date.parse(plan.review.expires_at) <= Date.now())
        throw new DesktopUpgradeError('UPGRADE_PLAN_EXPIRED')
      const { review, key } = plan
      if (
        this.authority(this.installations.retainedUpgradeAuthority(key)) !== plan.before ||
        this.authority(this.installations.candidateUpgradeAuthority(key, review.vps_id)) !==
          plan.next ||
        canonicalH2Json(
          this.db
            .prepare(
              "SELECT * FROM desktop_controller_upgrade WHERE installation_request_key=? AND state<>'cancelled' ORDER BY sequence"
            )
            .all(key)
        ) !== plan.snapshot
      )
        throw new DesktopUpgradeError('UPGRADE_AUTHORITY_CHANGED')
      const requestKey = randomUUID(),
        now = new Date().toISOString(),
        next = JSON.parse(plan.next)
      this.db
        .prepare(
          `INSERT INTO desktop_controller_authority_rebind
        (request_key,installation_request_key,upgrade_request_key,from_revision,to_revision,previous_authority_json,next_authority_json,result_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`
        )
        .run(
          requestKey,
          key,
          review.upgrade_request_key,
          review.from_revision,
          review.to_revision,
          plan.before,
          plan.next,
          canonicalH2Json(plan.result),
          now
        )
      this.db
        .prepare(
          `UPDATE desktop_controller_installation SET vps_id=?,authority_revision=?,ssh_security_revision=?,principal_json=?,credential_digest=?,updated_at=? WHERE request_key=?`
        )
        .run(
          review.vps_id,
          review.to_revision,
          next.ssh_security_revision,
          canonicalH2Json(next.principal),
          next.credential_digest,
          now,
          key
        )
      this.db
        .prepare(
          `UPDATE desktop_controller_upgrade SET vps_id=?,authority_revision=?,installation_authority_json=?,updated_at=? WHERE installation_request_key=? AND state<>'cancelled'`
        )
        .run(review.vps_id, review.to_revision, plan.next, now, key)
      this.db
        .prepare(
          'UPDATE desktop_controller_upgrade SET is_current=0 WHERE installation_request_key=?'
        )
        .run(key)
      this.db
        .prepare(
          `UPDATE desktop_controller_upgrade SET is_current=1,state=?,result_json=?,operation_id=NULL,owner_session=NULL,updated_at=? WHERE request_key=?`
        )
        .run(plan.result.phase, canonicalH2Json(plan.result), now, review.upgrade_request_key)
      this.authorityReviews.delete(planId)
      return {
        request_key: requestKey,
        installation_request_key: key,
        upgrade_request_key: review.upgrade_request_key,
        vps_id: review.vps_id,
        authority_revision: review.to_revision,
        binding_refresh_required: true
      }
    })
  }
  private base(key: string): Base {
    try {
      return this.installations.upgradeAuthority(key)
    } catch {
      throw new DesktopUpgradeError('UPGRADE_AUTHORITY_CHANGED')
    }
  }
  private current(row: Row): Base {
    const base = this.base(row.installation_request_key)
    if (this.authority(base) !== row.installation_authority_json)
      throw new DesktopUpgradeError('UPGRADE_AUTHORITY_CHANGED')
    return base
  }
  private release(id: string): DesktopUpgradeRelease {
    const release = this.catalog.find((v) => v.release_id === id)
    if (!release) throw new DesktopUpgradeError('UPGRADE_UNAVAILABLE')
    verifyControllerRelease(release.release_directory, release.release_sha256)
    if (
      releaseSha256(readReleaseFile(release.installer_path, 1024 * 1024)) !==
      release.installer_sha256
    )
      throw new DesktopUpgradeError('UPGRADE_UNAVAILABLE')
    return release
  }
  private row(key: string): Row {
    if (!uuid.safeParse(key).success) throw new DesktopUpgradeError('UPGRADE_INPUT_INVALID')
    const parsed = rowSchema.safeParse(
      this.db.prepare('SELECT * FROM desktop_controller_upgrade WHERE request_key=?').get(key)
    )
    if (!parsed.success) throw new DesktopUpgradeError('UPGRADE_UNAVAILABLE')
    const r = parsed.data
    if (r.result_json) {
      const result = controllerUpgradeResultSchema.parse(JSON.parse(r.result_json))
      this.correlate(r, result)
      if (
        (r.state === 'active' && result.phase !== 'active') ||
        (r.state === 'rolled_back' && result.phase !== 'rolled_back')
      )
        throw new DesktopUpgradeError('UPGRADE_CONFLICT')
    }
    if (r.state === 'in_flight' && (!r.operation_id || !r.owner_session))
      throw new DesktopUpgradeError('UPGRADE_CONFLICT')
    return r
  }
  private cold(row: Row): Row {
    if (row.state === 'in_flight' && row.owner_session !== this.session) {
      this.db
        .prepare(
          "UPDATE desktop_controller_upgrade SET state='outcome_unknown',operation_id=NULL,owner_session=NULL,updated_at=? WHERE request_key=? AND state='in_flight' AND operation_id=?"
        )
        .run(new Date().toISOString(), row.request_key, row.operation_id)
      return this.row(row.request_key)
    }
    return row
  }
  private pending(key: string): Row | undefined {
    const value = this.db
      .prepare(
        "SELECT request_key FROM desktop_controller_upgrade WHERE installation_request_key=? AND state IN ('prepared','transferred','in_flight','outcome_unknown')"
      )
      .get(key) as { request_key: string } | undefined
    return value ? this.cold(this.row(value.request_key)) : undefined
  }
  private head(key: string): Row | undefined {
    const value = this.db
      .prepare(
        'SELECT request_key FROM desktop_controller_upgrade WHERE installation_request_key=? AND is_current=1'
      )
      .get(key) as { request_key: string } | undefined
    return value ? this.cold(this.row(value.request_key)) : undefined
  }
  private meta(row: Row): DesktopUpgrade {
    return {
      request_key: row.request_key,
      installation_request_key: row.installation_request_key,
      controller_id: row.controller_id,
      vps_id: row.vps_id,
      authority_revision: row.authority_revision,
      parent_upgrade_key: row.parent_upgrade_key,
      parent_release_sha256: row.parent_release_sha256,
      release_id: row.release_id,
      release_sha256: row.release_sha256,
      installer_sha256: row.installer_sha256,
      state: row.state,
      is_current: row.is_current === 1,
      last_result: row.result_json ? JSON.parse(row.result_json) : null,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }
  list(installationKey: string): DesktopUpgrade[] {
    if (!uuid.safeParse(installationKey).success)
      throw new DesktopUpgradeError('UPGRADE_INPUT_INVALID')
    return (
      this.db
        .prepare(
          'SELECT request_key FROM desktop_controller_upgrade WHERE installation_request_key=? ORDER BY sequence'
        )
        .all(installationKey) as { request_key: string }[]
    ).map((v) => this.meta(this.cold(this.row(v.request_key))))
  }
  all(): DesktopUpgrade[] {
    return (
      this.db
        .prepare('SELECT request_key FROM desktop_controller_upgrade ORDER BY sequence')
        .all() as { request_key: string }[]
    ).map((v) => this.meta(this.cold(this.row(v.request_key))))
  }
  /** Must follow a fresh inspect in the calling review. No caller paths/pins. */
  bindingIntent(
    key: string,
    original: ProductDesktopControllerBindingIntent
  ): ProductDesktopControllerBindingIntent {
    const row = this.cold(this.row(key)),
      base = this.current(row)
    if (
      !row.is_current ||
      !['active', 'rolled_back'].includes(row.state) ||
      !row.result_json ||
      this.pending(row.installation_request_key)
    )
      throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
    const result = controllerUpgradeResultSchema.parse(JSON.parse(row.result_json))
    this.correlate(row, result)
    original = bindingAtAuthority(this.db, original, row.authority_revision)
    if (
      !result.is_current ||
      result.service_state !== 'running' ||
      original.installation?.request_key !== row.installation_request_key ||
      original.installation.authority_revision !== row.authority_revision ||
      original.controller_id !== row.controller_id ||
      original.vps_id !== row.vps_id ||
      canonicalH2Json(original.principal) !== canonicalH2Json(base.principal) ||
      original.ssh_security_revision !== base.ssh_security_revision
    )
      throw new DesktopUpgradeError('UPGRADE_AUTHORITY_CHANGED')
    return {
      ...original,
      artifact_path: result.artifact_path,
      node_path: result.node_path,
      data_directory: result.data_directory,
      manifest_sha256: result.runtime_payload_sha256,
      upgrade: {
        request_key: key,
        authority_revision: row.authority_revision,
        release_sha256: row.release_sha256,
        installer_sha256: row.installer_sha256,
        parent_upgrade_key: row.parent_upgrade_key,
        parent_release_sha256: row.parent_release_sha256
      }
    }
  }
  async plan(installationKey: string, releaseId: string): Promise<DesktopUpgradePlan> {
    if (this.pending(installationKey)) throw new DesktopUpgradeError('UPGRADE_BUSY')
    let base = this.base(installationKey)
    const release = this.release(releaseId),
      before = this.authority(base),
      head = this.head(installationKey)
    let parent: string | null = null,
      pin = base.installation.release_sha256
    if (head) {
      await this.inspect(head.request_key)
      const current = this.head(installationKey)
      if (
        !current ||
        current.request_key !== head.request_key ||
        !['active', 'rolled_back'].includes(current.state) ||
        !current.result_json
      )
        throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
      const result = controllerUpgradeResultSchema.parse(JSON.parse(current.result_json))
      if (!result.is_current || result.service_state !== 'running')
        throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
      parent = result.runtime_upgrade_key
      pin = result.runtime_release_sha256
    } else {
      await this.installations.inspect(installationKey)
      base = this.base(installationKey)
      if (base.installation.last_result?.service_state !== 'running')
        throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
    }
    if (
      before !== this.authority(this.base(installationKey)) ||
      this.pending(installationKey) ||
      (this.head(installationKey)?.request_key ?? null) !== (head?.request_key ?? null)
    )
      throw new DesktopUpgradeError('UPGRADE_AUTHORITY_CHANGED')
    if (pin === release.release_sha256) throw new DesktopUpgradeError('UPGRADE_CONFLICT')
    for (const [id, p] of this.plans) if (p.expires < Date.now()) this.plans.delete(id)
    if (this.plans.size >= 32) throw new DesktopUpgradeError('UPGRADE_BUSY')
    const p: Plan = {
      id: randomUUID(),
      key: randomUUID(),
      base,
      authority: before,
      release,
      head: head?.request_key ?? null,
      parent,
      pin,
      expires: Date.now() + 60_000
    }
    this.plans.set(p.id, p)
    return {
      plan_id: p.id,
      expires_at: new Date(p.expires).toISOString(),
      installation_request_key: installationKey,
      controller_id: base.installation.controller_id!,
      vps_id: base.installation.vps_id,
      host: base.principal.host,
      release_id: releaseId,
      parent_upgrade_key: parent
    }
  }
  prepare(planId: string): DesktopUpgrade {
    return this.mutate(() => {
      const p = this.plans.get(planId)
      if (!p || p.expires < Date.now()) throw new DesktopUpgradeError('UPGRADE_PLAN_EXPIRED')
      if (
        this.authority(this.base(p.base.installation.request_key)) !== p.authority ||
        (this.head(p.base.installation.request_key)?.request_key ?? null) !== p.head
      )
        throw new DesktopUpgradeError('UPGRADE_AUTHORITY_CHANGED')
      this.release(p.release.release_id)
      const previous = this.db
        .prepare('SELECT request_key FROM desktop_controller_upgrade WHERE request_key=?')
        .get(p.key)
      if (previous) return this.meta(this.row(p.key))
      if (this.pending(p.base.installation.request_key))
        throw new DesktopUpgradeError('UPGRADE_BUSY')
      const now = new Date().toISOString(),
        i = p.base.installation
      this.db
        .prepare(
          `INSERT INTO desktop_controller_upgrade(request_key,installation_request_key,controller_id,vps_id,authority_revision,installation_authority_json,
        parent_upgrade_key,parent_release_sha256,release_id,release_sha256,installer_sha256,state,last_operation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'prepared','none',?,?)`
        )
        .run(
          p.key,
          i.request_key,
          i.controller_id,
          i.vps_id,
          i.authority_revision,
          p.authority,
          p.parent,
          p.pin,
          p.release.release_id,
          p.release.release_sha256,
          p.release.installer_sha256,
          now,
          now
        )
      return this.meta(this.row(p.key))
    })
  }
  cancel(key: string): DesktopUpgrade {
    return this.mutate(() => {
      const row = this.cold(this.row(key))
      this.current(row)
      if (row.state !== 'prepared' || row.ever_dispatched)
        throw new DesktopUpgradeError('UPGRADE_CONFLICT')
      this.db
        .prepare(
          "UPDATE desktop_controller_upgrade SET state='cancelled',updated_at=? WHERE request_key=?"
        )
        .run(new Date().toISOString(), key)
      return this.meta(this.row(key))
    })
  }
  inspect(key: string): Promise<DesktopUpgrade> {
    return this.dispatch(key, 'inspect')
  }
  send(
    key: string,
    operation: Exclude<DesktopUpgradeOperation, 'inspect'>,
    consent: true
  ): Promise<DesktopUpgrade> {
    if (consent !== true || !['transfer', 'upgrade', 'recover', 'rollback'].includes(operation))
      return Promise.reject(new DesktopUpgradeError('UPGRADE_INPUT_INVALID'))
    return this.dispatch(key, operation)
  }
  private correlate(row: Row, result: ControllerUpgradeResult): void {
    for (const key of [
      'request_key',
      'installation_request_key',
      'controller_id',
      'parent_upgrade_key',
      'parent_release_sha256',
      'release_sha256'
    ] as const)
      if (row[key] !== result[key]) throw new DesktopUpgradeError('UPGRADE_CONFLICT')
    const base = JSON.parse(row.installation_authority_json) as {
      runtime_uid: number
      data_directory: string
    }
    if (result.runtime_uid !== base.runtime_uid || result.data_directory !== base.data_directory)
      throw new DesktopUpgradeError('UPGRADE_CONFLICT')
    const expectedKey =
      result.phase === 'active'
        ? row.request_key
        : result.phase === 'rolled_back'
          ? row.parent_upgrade_key
          : result.runtime_upgrade_key
    if (
      ![row.request_key, row.parent_upgrade_key].includes(result.runtime_upgrade_key) ||
      result.runtime_upgrade_key !== expectedKey ||
      result.runtime_release_sha256 !==
        (result.runtime_upgrade_key === row.request_key
          ? row.release_sha256
          : row.parent_release_sha256)
    )
      throw new DesktopUpgradeError('UPGRADE_CONFLICT')
    const original = JSON.parse(row.installation_authority_json) as {
      artifact_path: string
      node_path: string
    }
    const root = posix.dirname(posix.dirname(posix.dirname(original.artifact_path)))
    const runtime = result.runtime_upgrade_key
      ? posix.join(root, 'revisions', result.runtime_upgrade_key, 'runtime')
      : posix.dirname(original.node_path)
    if (
      result.artifact_path !== posix.join(runtime, 'payload/control-plane.cjs') ||
      result.node_path !== posix.join(runtime, 'node')
    )
      throw new DesktopUpgradeError('UPGRADE_CONFLICT')
  }
  private async dispatch(key: string, operation: DesktopUpgradeOperation): Promise<DesktopUpgrade> {
    const row = this.mutate(() => {
      const r = this.cold(this.row(key))
      this.current(r)
      if (r.state === 'in_flight') throw new DesktopUpgradeError('UPGRADE_BUSY')
      if (r.state === 'cancelled') throw new DesktopUpgradeError('UPGRADE_CONFLICT')
      const pending = this.pending(r.installation_request_key),
        head = this.head(r.installation_request_key)
      if (pending && pending.request_key !== key) throw new DesktopUpgradeError('UPGRADE_BUSY')
      if (!pending && head && head.request_key !== key)
        throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
      if (operation === 'upgrade' && (r.state !== 'transferred' || r.upgrade_attempted))
        throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
      if (['recover', 'rollback'].includes(operation) && !r.upgrade_attempted)
        throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
      if (operation === 'recover' && r.state !== 'outcome_unknown')
        throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
      if (operation === 'transfer' && ['active', 'rolled_back'].includes(r.state))
        throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
      this.release(r.release_id)
      this.db
        .prepare(
          `UPDATE desktop_controller_upgrade SET state='in_flight',last_operation=?,operation_id=?,owner_session=?,ever_dispatched=1,
        upgrade_attempted=max(upgrade_attempted,?),updated_at=? WHERE request_key=?`
        )
        .run(
          operation,
          randomUUID(),
          this.session,
          operation === 'upgrade' ? 1 : 0,
          new Date().toISOString(),
          key
        )
      return this.row(key)
    })
    const assertCurrent = (): void => {
      const now = this.row(key)
      if (
        now.state !== 'in_flight' ||
        now.operation_id !== row.operation_id ||
        now.owner_session !== this.session
      )
        throw new DesktopUpgradeError('UPGRADE_AUTHORITY_CHANGED')
      this.current(now)
    }
    try {
      const base = this.current(row),
        release = this.release(row.release_id)
      const input = {
        ssh: this.ssh,
        vpsId: row.vps_id,
        expectedIdentity: base.principal,
        locator: {
          request_key: key,
          release_sha256: row.release_sha256,
          installer_sha256: row.installer_sha256
        },
        purpose: 'upgrade' as const,
        assertCurrent,
        bootstrapScript: this.options.bootstrapScript
      }
      let state: Row['state'] = 'outcome_unknown',
        result: ControllerUpgradeResult | undefined
      if (operation === 'transfer') {
        const status = await this.transport.transfer({
          ...input,
          consent: true,
          artifacts: release
        })
        assertCurrent()
        if (status.state !== 'verified') throw new DesktopUpgradeError('UPGRADE_CONFLICT')
        if (!row.upgrade_attempted) state = 'transferred'
      } else {
        let available = true
        if (operation === 'inspect') {
          const status = await this.transport.call({ ...input, operation: 'status' })
          assertCurrent()
          available = status.state === 'verified'
        }
        if (available) {
          const common = {
            format: 1 as const,
            request_key: key,
            installation_request_key: row.installation_request_key,
            controller_id: row.controller_id,
            parent_upgrade_key: row.parent_upgrade_key,
            parent_release_sha256: row.parent_release_sha256,
            release_sha256: row.release_sha256
          }
          const request: ControllerUpgradeRequest =
            operation === 'upgrade'
              ? {
                  ...common,
                  operation: 'upgrade',
                  consent: true,
                  release_directory: '/derived-by-receiver'
                }
              : operation === 'inspect'
                ? { ...common, operation: 'inspect-upgrade' }
                : {
                    ...common,
                    operation: operation === 'recover' ? 'recover-upgrade' : 'rollback-upgrade',
                    consent: true
                  }
          try {
            result = controllerUpgradeResultSchema.parse(
              await this.transport.upgrade({ ...input, request })
            )
          } catch (error) {
            if (!(
              operation === 'inspect' &&
              !row.upgrade_attempted &&
              error instanceof ControllerBootstrapError &&
              error.code === 'BOOTSTRAP_NOT_FOUND'
            ))
              throw error
            state = 'transferred'
          }
        }
      }
      assertCurrent()
      if (result) {
        this.correlate(row, result)
        if (!result.is_current) throw new DesktopUpgradeError('UPGRADE_CONFLICT')
        state =
          result.phase === 'active'
            ? 'active'
            : result.phase === 'rolled_back'
              ? 'rolled_back'
              : 'outcome_unknown'
      }
      return this.mutate(() => {
        assertCurrent()
        if (result)
          this.db
            .prepare(
              'UPDATE desktop_controller_upgrade SET is_current=0 WHERE installation_request_key=? AND request_key<>?'
            )
            .run(row.installation_request_key, key)
        this.db
          .prepare(
            `UPDATE desktop_controller_upgrade SET state=?,result_json=coalesce(?,result_json),is_current=CASE WHEN ? THEN 1 ELSE is_current END,
          operation_id=NULL,owner_session=NULL,updated_at=? WHERE request_key=?`
          )
          .run(
            state,
            result ? canonicalH2Json(result) : null,
            result ? 1 : 0,
            new Date().toISOString(),
            key
          )
        return this.meta(this.row(key))
      })
    } catch (error) {
      this.mutate(() =>
        this.db
          .prepare(
            `UPDATE desktop_controller_upgrade SET state='outcome_unknown',operation_id=NULL,owner_session=NULL,updated_at=?
        WHERE request_key=? AND operation_id=? AND owner_session=?`
          )
          .run(new Date().toISOString(), key, row.operation_id, this.session)
      )
      throw error
    }
  }
  private mutate<T>(action: () => T): T {
    if (this.db.inTransaction) throw new DesktopUpgradeError('UPGRADE_BUSY')
    return this.db.transaction(action).immediate()
  }
}
