import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import type {
  ProductExposureContext,
  ProductExposureObservation,
  ProductExposureView
} from '../../../../docs/contracts/product-exposure'
import { ControllerClientAuth, ControllerClientAuthError } from './controllerClientAuth'
import { canonicalH2Json, h2ContextSchema, hashH2 } from './productH2Proof'
import {
  exposureInputSchema,
  exposureObservationSchema,
  EXPOSURE_DISPLAY_TTL_MS,
  EXPOSURE_FUTURE_TOLERANCE_MS,
  EXPOSURE_OBSERVATION_MAX_AGE_MS
} from './controllerExposureSchemas'

type Row = {
  app_id: number
  current_deployment_id: number | null
  deployment_status: string | null
  source_generation: number
  ownership_generation: number
  source_config_sha256: string
  vps_id: number
  host: string
  port: number
  host_fingerprint: string | null
  username: string
  auth_type: string
  ssh_security_revision: number
  host_port: number
  app_name: string
  container_port: number
  healthcheck_path: string
  image_tag: string | null
  git_commit_sha: string | null
  finished_at: string | null
  exposure_evidence_json: string | null
  settled_at: string | null
  leases_released_at: string | null
  context_json: string | null
  execution_context_sha256: string | null
  terminal_context_sha256: string | null
  attempt_state: string | null
  job_state: string | null
}
const hash = (value: unknown): string =>
  createHash('sha256').update(canonicalH2Json(value)).digest('hex')
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const keySchema = z.uuid().transform((v) => v.toLowerCase())
const storedSchema = z.strictObject({
  kind: z.literal('product_exposure_observation'),
  observation: exposureObservationSchema,
  status: z.enum(['reachable', 'degraded', 'not_checked']),
  url: z.string().max(512),
  external_probe: z.enum(['reachable', 'unreachable', 'not_run']),
  ufw_state: z.literal('not_checked'),
  ufw_reconciled: z.literal(false),
  cloud_firewall: z.literal('not_configured'),
  diagnosis: z.null(),
  checked_at: z.iso.datetime()
})

/** Controller owns the sole Product metadata write; no runtime/H2/lease mutation. */
export class ControllerExposure {
  private readonly auth: ControllerClientAuth
  constructor(
    private readonly db: Database.Database,
    private readonly controllerId: string,
    private readonly ready: () => boolean,
    private readonly now: () => number = Date.now
  ) {
    this.auth = new ControllerClientAuth(db, controllerId, `unix:${process.getuid?.() ?? 0}`, now)
  }

  read(authorization: unknown, appId: number): ProductExposureView {
    const work = (): ProductExposureView => {
      this.auth.authenticate(authorization, 'read')
      return this.view(this.row(appId))
    }
    return this.db.inTransaction ? work() : this.db.transaction(work)()
  }

  record(authorization: unknown, key: unknown, appId: number, input: unknown): ProductExposureView {
    const parsed = exposureInputSchema.safeParse(input),
      id = keySchema.safeParse(key)
    if (!parsed.success || !id.success || this.db.inTransaction) this.fail('REQUEST_INVALID')
    const body = parsed.data,
      bodyHash = hash(body)
    return this.db
      .transaction(() => {
        const client = this.auth.authenticate(authorization, 'policy:write')
        const row = this.row(appId),
          view = this.view(row),
          context = view.context
        if (
          !context ||
          context.deployment_id !== body.deployment_id ||
          context.authority_sha256 !== body.authority_sha256
        )
          this.fail('EXPOSURE_CONTEXT_CHANGED')
        const previous = view.observation
        // Even a replay must match current runtime/owner/target authority first.
        if (previous?.observation_id === id.data) {
          if (previous.client_id !== client.client_id || previous.body_sha256 !== bodyHash)
            this.fail('IDEMPOTENCY_CONFLICT')
          return view
        }
        if (!this.ready()) this.fail('CAPABILITY_BLOCKED')
        if (context.previous_observation_id !== body.previous_observation_id)
          this.fail('EXPOSURE_CONTEXT_CHANGED')
        const now = this.now(),
          started = Date.parse(body.started_at),
          checked = Date.parse(body.checked_at)
        if (
          checked < started ||
          now - started > EXPOSURE_OBSERVATION_MAX_AGE_MS ||
          started > now + EXPOSURE_FUTURE_TOLERANCE_MS ||
          checked > now + EXPOSURE_FUTURE_TOLERANCE_MS ||
          (previous && started < Date.parse(previous.checked_at))
        )
          this.fail('EXPOSURE_OBSERVATION_STALE')
        const status =
          body.outcome === 'reachable'
            ? 'reachable'
            : body.outcome === 'unreachable'
              ? 'degraded'
              : 'not_checked'
        const observation: ProductExposureObservation = {
          ...body,
          format: 1,
          app_id: appId,
          observation_id: id.data,
          client_id: client.client_id,
          body_sha256: bodyHash,
          url: context.url,
          status,
          received_at: new Date(now).toISOString()
        }
        const evidence = {
          kind: 'product_exposure_observation',
          observation,
          status,
          url: context.url,
          external_probe: body.outcome,
          ufw_state: 'not_checked',
          ufw_reconciled: false,
          cloud_firewall: 'not_configured',
          diagnosis: null,
          checked_at: body.checked_at
        }
        const encoded = canonicalH2Json(evidence)
        if (Buffer.byteLength(encoded) > 8192) this.fail('REQUEST_INVALID')
        const changed = this.db
          .prepare(
            `UPDATE deployment SET exposure_status=?,exposure_evidence_json=?
        WHERE id=? AND app_id=? AND status='running' AND exposure_evidence_json IS ?`
          )
          .run(
            status,
            encoded,
            row.current_deployment_id,
            appId,
            row.exposure_evidence_json
          ).changes
        if (changed !== 1) this.fail('EXPOSURE_CONTEXT_CHANGED')
        return this.view(this.row(appId))
      })
      .immediate()
  }

  private row(appId: number): Row {
    if (!positive.safeParse(appId).success) this.fail('REQUEST_INVALID')
    const row = this.db
      .prepare(
        `SELECT a.id AS app_id,a.current_deployment_id,a.vps_id,a.host_port,a.name AS app_name,a.container_port,a.healthcheck_path,
      c.ownership_generation,c.source_generation,c.source_config_sha256,
      v.host,v.port,v.host_fingerprint,v.username,v.auth_type,v.ssh_security_revision,
      d.status AS deployment_status,d.image_tag,d.git_commit_sha,d.finished_at,d.exposure_evidence_json,
      t.settled_at,t.leases_released_at,e.context_json,e.context_sha256 AS execution_context_sha256,
      t.context_sha256 AS terminal_context_sha256,p.state AS attempt_state,j.state AS job_state
      FROM app a JOIN vps v ON v.id=a.vps_id AND v.archived_at IS NULL
      JOIN product_app_control c ON c.app_id=a.id AND c.mode='product' AND c.controller_id=?
      JOIN product_source_config s ON s.app_id=c.app_id AND s.source_generation=c.source_generation AND s.config_sha256=c.source_config_sha256
      LEFT JOIN deployment d ON d.id=a.current_deployment_id AND d.app_id=a.id
      LEFT JOIN product_runtime_execution e ON e.deployment_id=d.id
      LEFT JOIN product_runtime_terminal t ON t.attempt_id=e.attempt_id
      LEFT JOIN product_deploy_attempt p ON p.attempt_id=e.attempt_id
      LEFT JOIN product_deploy_job j ON j.job_id=p.job_id
      WHERE a.id=?`
      )
      .get(this.controllerId, appId) as Row | undefined
    if (!row) this.fail('APP_NOT_FOUND')
    return row
  }

  private view(row: Row): ProductExposureView {
    const base: ProductExposureView = {
      app_id: row.app_id,
      deployment_id: row.current_deployment_id,
      context: null,
      status: 'not_checked',
      freshness: 'not_checked',
      observation: null,
      unavailable_reason: null
    }
    if (row.current_deployment_id === null || row.deployment_status !== 'running')
      return { ...base, unavailable_reason: 'no_running_deployment' }
    if (
      row.settled_at === null ||
      row.leases_released_at === null ||
      row.finished_at === null ||
      row.attempt_state !== 'succeeded' ||
      row.job_state !== 'succeeded'
    )
      return { ...base, unavailable_reason: 'runtime_unsettled' }
    if (!this.runtimeMatches(row)) return { ...base, unavailable_reason: 'authority_changed' }
    if (
      this.db
        .prepare(
          `SELECT 1 FROM product_deploy_job WHERE app_id=? AND state IN ('queued','claimed','deploying','retry_wait','uncertain')
       UNION ALL SELECT 1 FROM product_app_lease WHERE app_id=? AND released_at IS NULL
       UNION ALL SELECT 1 FROM deployment_activation WHERE app_id=? AND state='prepared' LIMIT 1`
        )
        .get(row.app_id, row.app_id, row.app_id)
    )
      return { ...base, unavailable_reason: 'execution_active' }
    const ipv6 = isIP(row.host) === 6
    if (
      (!isIP(row.host) &&
        !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(row.host)) ||
      !Number.isInteger(row.host_port) ||
      row.host_port < 30000 ||
      row.host_port > 30999 ||
      !row.host_fingerprint ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(row.host_fingerprint)
    )
      return { ...base, unavailable_reason: 'invalid_target' }
    const url = `http://${ipv6 ? `[${row.host}]` : row.host}:${row.host_port}`
    const identity: Record<string, unknown> = { ...row }
    delete identity.exposure_evidence_json
    const authority = hash({ controller_id: this.controllerId, ...identity })
    const observation = this.stored(
      row.exposure_evidence_json,
      row.app_id,
      row.current_deployment_id,
      authority,
      url
    )
    const context: ProductExposureContext = {
      app_id: row.app_id,
      deployment_id: row.current_deployment_id,
      authority_sha256: authority,
      previous_observation_id: observation?.observation_id ?? null,
      url
    }
    const age = observation ? this.now() - Date.parse(observation.checked_at) : null
    const current =
      age !== null && age >= -EXPOSURE_FUTURE_TOLERANCE_MS && age <= EXPOSURE_DISPLAY_TTL_MS
    return {
      ...base,
      context,
      observation,
      freshness: observation ? (current ? 'current' : 'stale') : 'not_checked',
      status: current ? observation!.status : 'not_checked'
    }
  }

  private stored(
    raw: string | null,
    app: number,
    deployment: number,
    authority: string,
    url: string
  ): ProductExposureObservation | null {
    if (!raw || Buffer.byteLength(raw) > 8192) return null
    try {
      const parsed = storedSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) return null
      const v = parsed.data,
        o = v.observation
      const input = exposureInputSchema.safeParse(
        Object.fromEntries(
          Object.keys(exposureInputSchema.shape).map((key) => [key, o[key as keyof typeof o]])
        )
      )
      if (!input.success || hash(input.data) !== o.body_sha256) return null
      if (
        o.app_id !== app ||
        o.deployment_id !== deployment ||
        o.authority_sha256 !== authority ||
        o.url !== url ||
        v.url !== url ||
        v.status !== o.status ||
        v.checked_at !== o.checked_at ||
        v.external_probe !== o.outcome ||
        o.status !==
          (o.outcome === 'reachable'
            ? 'reachable'
            : o.outcome === 'unreachable'
              ? 'degraded'
              : 'not_checked')
      )
        return null
      return o
    } catch {
      return null
    }
  }
  private runtimeMatches(row: Row): boolean {
    if (!row.context_json || Buffer.byteLength(row.context_json) > 48 * 1024) return false
    try {
      const context = h2ContextSchema.parse(JSON.parse(row.context_json))
      if (
        hashH2(context) !== row.execution_context_sha256 ||
        row.execution_context_sha256 !== row.terminal_context_sha256
      )
        return false
      return (
        context.claim.controller_id === this.controllerId &&
        context.claim.app_id === row.app_id &&
        context.claim.ownership_generation === row.ownership_generation &&
        context.claim.source_generation === row.source_generation &&
        context.claim.source_config_sha256 === row.source_config_sha256 &&
        context.deployment_id === row.current_deployment_id &&
        context.source_sha === row.git_commit_sha &&
        context.candidate_image_tag === row.image_tag &&
        context.host_port === row.host_port &&
        context.app_name === row.app_name &&
        context.container_port === row.container_port &&
        context.healthcheck_path === row.healthcheck_path &&
        canonicalH2Json(context.target) ===
          canonicalH2Json({
            vps_id: row.vps_id,
            host: row.host,
            port: row.port,
            host_fingerprint: row.host_fingerprint,
            username: row.username,
            auth_type: row.auth_type,
            ssh_security_revision: row.ssh_security_revision
          })
      )
    } catch {
      return false
    }
  }
  private fail(code: ConstructorParameters<typeof ControllerClientAuthError>[0]): never {
    throw new ControllerClientAuthError(code)
  }
}
