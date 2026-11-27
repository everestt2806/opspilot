import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type {
  DesktopPostgresContext,
  DesktopPostgresIntent,
  DesktopPostgresIntentInput
} from '@shared/desktopProductPostgres'
import type {
  ProductProjectConfigurationContext,
  ProductPostgresPrepareResult,
  ProductPostgresSelectionResult
} from '../../../../docs/contracts/product-postgres'
import type { DesktopProjectSetups } from './desktopProjectSetup'
import type { DesktopControllerVault } from './desktopControllerVault'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import { canonicalH2Json } from './productH2Proof'
import {
  postgresPrepareSchema,
  postgresSelectionSchema,
  postgresPrepareResultSchema,
  postgresSelectionResultSchema,
  postgresPrepareLookupSchema,
  postgresSelectionLookupSchema,
  projectConfigurationContextSchema
} from './productPostgres'

const uuid = z.uuidv4(),
  positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const base = z.strictObject({
  project_request_key: uuid,
  expected_binding_revision: positive,
  expected_source_generation: positive,
  expected_source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/)
})
const inputSchema = z.discriminatedUnion('operation', [
  base.extend({ operation: z.literal('prepare') }),
  base.extend({ operation: z.literal('select'), database_id: uuid })
])
const envelopeSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('prepare'), input: postgresPrepareSchema }),
  z.strictObject({
    operation: z.literal('select'),
    input: postgresSelectionSchema,
    expected_result_config_sha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
])
const rowSchema = z.strictObject({
  request_key: uuid,
  project_request_key: uuid,
  binding_id: uuid,
  binding_revision: positive,
  controller_id: z.string().min(1).max(128),
  app_id: positive,
  operation: z.enum(['prepare', 'select']),
  context_json: z.string().max(32768),
  crypto_scheme: z.literal('aes_256_gcm'),
  encrypted_secret: z.instanceof(Buffer),
  iv: z.instanceof(Buffer),
  auth_tag: z.instanceof(Buffer),
  state: z.enum([
    'prepared',
    'in_flight',
    'outcome_unknown',
    'resource_prepared',
    'selected',
    'not_applied',
    'cancelled'
  ]),
  result_json: z.string().max(32768).nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})
type Row = z.output<typeof rowSchema>
type Envelope = z.output<typeof envelopeSchema>
type Result = ProductPostgresPrepareResult | ProductPostgresSelectionResult
const purpose = 'opspilot-desktop-postgres-intent-v1'
export class DesktopPostgresError extends Error {
  constructor(
    readonly code:
      | 'POSTGRES_REQUEST_INVALID'
      | 'POSTGRES_CHANGED'
      | 'POSTGRES_CONFLICT'
      | 'POSTGRES_BUSY'
      | 'POSTGRES_UNAVAILABLE'
      | 'POSTGRES_UNSUPPORTED'
  ) {
    super(code)
  }
}
/** Local authenticated intent journal only. Every server effect is guarded SSH admin;
 * no credentials, runtime claims, source auto-adoption or replay on unknown delivery.
 */
export class DesktopProductPostgres {
  private readonly busy = new Set<string>()
  constructor(
    private readonly db: Database.Database,
    private readonly cipher: AesGcmCredentialCipher,
    private readonly vault: Pick<DesktopControllerVault, 'resolve' | 'get'>,
    private readonly projects: Pick<DesktopProjectSetups, 'registeredContextSnapshot'>,
    private readonly admin: Pick<
      DesktopControllerEnrollment,
      | 'postgresContext'
      | 'preparePostgres'
      | 'postgresPrepareState'
      | 'reviewPostgres'
      | 'selectPostgres'
      | 'postgresSelectionState'
    >
  ) {}
  async context(key: string): Promise<DesktopPostgresContext> {
    const { project, remote } = await this.remote(key)
    return {
      project_request_key: key,
      binding_id: project.setup.binding_id,
      binding_revision: project.setup.binding_revision,
      controller_id: project.setup.controller_id,
      app_id: project.registration.app_id,
      ownership_generation: remote.scope.ownership_generation,
      source_generation: remote.source_generation,
      source_config_sha256: remote.source_config_sha256,
      database: remote.database,
      environment: remote.environment,
      auto_deploy_paused: remote.auto_deploy_paused
    }
  }
  async prepare(input: DesktopPostgresIntentInput): Promise<DesktopPostgresIntent> {
    this.outsideTransaction()
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) throw new DesktopPostgresError('POSTGRES_REQUEST_INVALID')
    const value = parsed.data,
      { project, remote } = await this.remote(value.project_request_key)
    if (project.setup.framework === 'static-spa')
      throw new DesktopPostgresError('POSTGRES_UNSUPPORTED')
    if (
      project.setup.binding_revision !== value.expected_binding_revision ||
      remote.source_generation !== value.expected_source_generation ||
      remote.source_config_sha256 !== value.expected_source_config_sha256 ||
      !remote.auto_deploy_paused
    )
      throw new DesktopPostgresError('POSTGRES_CHANGED')
    if (value.operation === 'select' && remote.database.prepared?.database_id !== value.database_id)
      throw new DesktopPostgresError('POSTGRES_CHANGED')
    const request = {
      format: 1 as const,
      request_key: randomUUID(),
      scope: remote.scope,
      expected_source_generation: remote.source_generation,
      expected_source_config_sha256: remote.source_config_sha256
    }
    const envelope: Envelope =
      value.operation === 'prepare'
        ? { operation: 'prepare', input: request }
        : {
            operation: 'select',
            input: { ...request, database_id: value.database_id },
            expected_result_config_sha256: createHash('sha256')
              .update(
                canonicalH2Json({
                  framework: project.setup.framework,
                  host_port: project.setup.host_port,
                  container_port: project.setup.container_port,
                  healthcheck_path: project.setup.healthcheck_path,
                  needs_db: true,
                  database: {
                    controller_id: remote.scope.controller_id,
                    ownership_generation: remote.scope.ownership_generation,
                    database_id: value.database_id
                  },
                  ...(remote.environment.selected
                    ? {
                        environment: {
                          controller_id: remote.scope.controller_id,
                          ownership_generation: remote.scope.ownership_generation,
                          revision: remote.environment.selected.revision
                        }
                      }
                    : {})
                })
              )
              .digest('hex')
          }
    // Readonly helper/source review before persisting a new selection. Unsupported
    // retained helpers fail here without creating a permanently unknown local intent.
    if (envelope.operation === 'select') {
      await this.admin.reviewPostgres(project.setup.binding_id, envelope.input)
      const after = await this.remote(value.project_request_key)
      if (canonicalH2Json(after) !== canonicalH2Json({ project, remote }))
        throw new DesktopPostgresError('POSTGRES_CHANGED')
    }
    return this.mutate(() => {
      this.project(value.project_request_key, project.setup.binding_revision)
      if (
        this.db
          .prepare(
            `SELECT 1 FROM desktop_environment_intent WHERE controller_id=? AND app_id=? AND state IN ('prepared','in_flight','outcome_unknown')
        UNION ALL SELECT 1 FROM desktop_environment_selection WHERE controller_id=? AND app_id=? AND state IN ('prepared','in_flight','outcome_unknown') LIMIT 1`
          )
          .get(
            project.setup.controller_id,
            project.registration.app_id,
            project.setup.controller_id,
            project.registration.app_id
          )
      )
        throw new DesktopPostgresError('POSTGRES_CONFLICT')
      const pending = this.db
        .prepare(
          "SELECT * FROM desktop_postgres_intent WHERE controller_id=? AND app_id=? AND state IN ('prepared','in_flight','outcome_unknown')"
        )
        .get(project.setup.controller_id, project.registration.app_id)
      if (pending) {
        const old = this.valid(pending),
          body = this.request(old)
        if (
          old.project_request_key !== value.project_request_key ||
          canonicalH2Json({
            ...body,
            input: { ...body.input, request_key: request.request_key }
          }) !== canonicalH2Json(envelope)
        )
          throw new DesktopPostgresError('POSTGRES_CONFLICT')
        return this.metadata(this.recover(old))
      }
      const stamp = new Date().toISOString(),
        binding = {
          request_key: request.request_key,
          project_request_key: value.project_request_key,
          binding_id: project.setup.binding_id,
          binding_revision: project.setup.binding_revision,
          controller_id: project.setup.controller_id,
          app_id: project.registration.app_id,
          operation: envelope.operation,
          context_json: canonicalH2Json(envelope),
          created_at: stamp
        }
      const encrypted = this.cipher.encrypt(
        canonicalH2Json({ purpose, binding, request: envelope })
      )
      this.project(value.project_request_key, binding.binding_revision)
      this.db
        .prepare(
          `INSERT INTO desktop_postgres_intent(request_key,project_request_key,binding_id,binding_revision,controller_id,app_id,operation,
        context_json,crypto_scheme,encrypted_secret,iv,auth_tag,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)`
        )
        .run(
          binding.request_key,
          binding.project_request_key,
          binding.binding_id,
          binding.binding_revision,
          binding.controller_id,
          binding.app_id,
          binding.operation,
          binding.context_json,
          encrypted.crypto_scheme,
          encrypted.encrypted_secret,
          encrypted.iv,
          encrypted.auth_tag,
          stamp,
          stamp
        )
      return this.metadata(this.row(request.request_key))
    })
  }
  list(key: string): DesktopPostgresIntent[] {
    this.project(key)
    return this.mutate(() =>
      this.db
        .prepare(
          `SELECT * FROM desktop_postgres_intent WHERE project_request_key=?
      ORDER BY CASE WHEN state IN ('prepared','in_flight','outcome_unknown') THEN 0 ELSE 1 END,created_at DESC,request_key LIMIT 30`
        )
        .all(key)
        .map((value) => this.metadata(this.recover(this.valid(value))))
    )
  }
  cancel(key: string): DesktopPostgresIntent {
    return this.mutate(() => {
      const row = this.row(key)
      this.request(row)
      if (!['prepared', 'cancelled'].includes(row.state) || this.busy.has(key))
        throw new DesktopPostgresError('POSTGRES_CONFLICT')
      this.update(row, 'cancelled')
      return this.metadata(this.row(key))
    })
  }
  async send(key: string): Promise<DesktopPostgresIntent> {
    return this.operation(key, false)
  }
  async check(key: string): Promise<DesktopPostgresIntent> {
    return this.operation(key, true)
  }
  /** Positive current exact-body receipt is required before Main follows a selected source. */
  async confirmsSource(key: string, remote: ProductProjectConfigurationContext): Promise<boolean> {
    this.outsideTransaction()
    const project = this.project(key)
    const parsed = projectConfigurationContextSchema.safeParse(remote)
    if (!parsed.success) return false
    const checked = parsed.data
    if (
      checked.controller_id !== project.setup.controller_id ||
      checked.scope.app_id !== project.registration.app_id ||
      checked.scope.ownership_generation !== project.registration.ownership_generation ||
      checked.scope.target.vps_id !== project.setup.target_vps_id ||
      checked.scope.target.ssh_security_revision !== project.setup.target_security_revision
    )
      return false
    const rows = this.db
      .prepare(
        "SELECT * FROM desktop_postgres_intent WHERE project_request_key=? AND operation='select' AND state='selected' ORDER BY json_extract(context_json,'$.input.expected_source_generation') DESC,created_at DESC LIMIT 30"
      )
      .all(key)
    for (const value of rows) {
      const row = this.valid(value),
        envelope = this.request(row),
        saved = this.result(row)
      if (
        envelope.operation !== 'select' ||
        !saved ||
        !('source_generation' in saved) ||
        saved.source_generation !== remote.source_generation ||
        saved.source_config_sha256 !== remote.source_config_sha256
      )
        continue
      const lookup = postgresSelectionLookupSchema.parse(
        await this.admin.postgresSelectionState(row.binding_id, envelope.input)
      )
      if (lookup.result) this.validateResult(envelope, lookup.result)
      if (canonicalH2Json(this.project(key)) !== canonicalH2Json(project))
        throw new DesktopPostgresError('POSTGRES_CHANGED')
      return !!(
        lookup.is_current &&
        lookup.result &&
        canonicalH2Json({ ...lookup.result, state: 'selected' }) ===
          canonicalH2Json({ ...saved, state: 'selected' })
      )
    }
    return false
  }
  private async operation(key: string, check: boolean): Promise<DesktopPostgresIntent> {
    this.outsideTransaction()
    const initial = this.row(key),
      envelope = this.request(initial)
    if (['resource_prepared', 'selected', 'not_applied', 'cancelled'].includes(initial.state))
      return this.metadata(initial)
    if (this.busy.has(key)) throw new DesktopPostgresError('POSTGRES_BUSY')
    if (!check && initial.state !== 'prepared') throw new DesktopPostgresError('POSTGRES_CONFLICT')
    this.busy.add(key)
    const guard = (): void => {
      if (canonicalH2Json(this.request(this.row(key))) !== canonicalH2Json(envelope))
        throw new DesktopPostgresError('POSTGRES_CHANGED')
    }
    let ownsDispatch = false
    const beforeSend = (): void =>
      this.mutate(() => {
        guard()
        const row = this.row(key)
        if (!ownsDispatch) {
          if (row.state !== 'prepared') throw new DesktopPostgresError('POSTGRES_CONFLICT')
          this.update(row, 'in_flight')
          ownsDispatch = true
        } else if (!['in_flight', 'outcome_unknown'].includes(row.state))
          throw new DesktopPostgresError('POSTGRES_CONFLICT')
      })
    try {
      let result: Result | null = null,
        unapplied = false
      if (check) {
        if (envelope.operation === 'prepare') {
          const value = postgresPrepareLookupSchema.parse(
            await this.admin.postgresPrepareState(initial.binding_id, envelope.input)
          )
          result = value.result
          unapplied = value.definitively_unapplied
        } else {
          const value = postgresSelectionLookupSchema.parse(
            await this.admin.postgresSelectionState(initial.binding_id, envelope.input)
          )
          result = value.result
          unapplied = value.definitively_unapplied
        }
      } else {
        // Transport commits the durable barrier only after verified open and before
        // its first command byte. Before that point the request is still unsent.
        result =
          envelope.operation === 'prepare'
            ? await this.admin.preparePostgres(initial.binding_id, envelope.input, beforeSend)
            : await this.admin.selectPostgres(initial.binding_id, envelope.input, beforeSend)
      }
      if (!check && !ownsDispatch) throw new DesktopPostgresError('POSTGRES_CONFLICT')
      guard()
      return this.mutate(() => {
        guard()
        let row = this.row(key)
        if (result) {
          this.validateResult(envelope, result)
          if (row.state === 'prepared') {
            this.update(row, 'in_flight')
            row = this.row(key)
          }
          this.update(
            row,
            envelope.operation === 'prepare' ? 'resource_prepared' : 'selected',
            result
          )
        } else if (unapplied) this.update(row, 'not_applied')
        else if (row.state === 'in_flight') this.update(row, 'outcome_unknown')
        return this.metadata(this.row(key))
      })
    } catch {
      this.mutate(() => {
        const row = this.row(key)
        if (ownsDispatch && row.state === 'in_flight') this.update(row, 'outcome_unknown')
      })
      throw new DesktopPostgresError('POSTGRES_UNAVAILABLE')
    } finally {
      this.busy.delete(key)
    }
  }
  private async remote(key: string): Promise<{
    project: ReturnType<DesktopProjectSetups['registeredContextSnapshot']>
    remote: ProductProjectConfigurationContext
  }> {
    this.outsideTransaction()
    const project = this.project(key),
      s = project.setup,
      r = project.registration
    const remote = projectConfigurationContextSchema.parse(
      await this.admin.postgresContext(s.binding_id, {
        format: 1,
        controller_id: s.controller_id,
        app_id: r.app_id,
        expected_ownership_generation: r.ownership_generation,
        expected_source_generation: r.source_generation,
        expected_source_config_sha256: r.source_config_sha256,
        expected_target_security_revision: s.target_security_revision
      })
    )
    if (
      canonicalH2Json(this.project(key)) !== canonicalH2Json(project) ||
      remote.controller_id !== s.controller_id ||
      remote.scope.app_id !== r.app_id ||
      remote.scope.ownership_generation !== r.ownership_generation ||
      remote.scope.target.vps_id !== s.target_vps_id ||
      remote.scope.target.ssh_security_revision !== s.target_security_revision ||
      remote.basis_source_generation !== r.source_generation ||
      remote.basis_source_config_sha256 !== r.source_config_sha256 ||
      [
        remote.database.prepared,
        remote.database.selected,
        remote.environment.latest,
        remote.environment.selected
      ].some((value) => value && value.framework !== s.framework)
    )
      throw new DesktopPostgresError('POSTGRES_CHANGED')
    return { project, remote }
  }
  private project(
    key: string,
    revision?: number
  ): ReturnType<DesktopProjectSetups['registeredContextSnapshot']> {
    if (!uuid.safeParse(key).success) throw new DesktopPostgresError('POSTGRES_REQUEST_INVALID')
    const project = this.projects.registeredContextSnapshot(key),
      binding = this.vault.resolve(project.setup.binding_id),
      scopes = this.vault.get(project.setup.binding_id).client?.scopes ?? []
    if (
      binding.controllerId !== project.setup.controller_id ||
      binding.revision !== project.setup.binding_revision ||
      (revision !== undefined && binding.revision !== revision) ||
      !scopes.includes('deploy:manual') ||
      !scopes.includes('policy:write')
    )
      throw new DesktopPostgresError('POSTGRES_CHANGED')
    return project
  }
  private binding(row: Row): object {
    return {
      request_key: row.request_key,
      project_request_key: row.project_request_key,
      binding_id: row.binding_id,
      binding_revision: row.binding_revision,
      controller_id: row.controller_id,
      app_id: row.app_id,
      operation: row.operation,
      context_json: row.context_json,
      created_at: row.created_at
    }
  }
  private request(row: Row): Envelope {
    try {
      const project = this.project(row.project_request_key, row.binding_revision),
        value = JSON.parse(this.cipher.decrypt(row))
      if (
        Object.keys(value).sort().join(',') !== 'binding,purpose,request' ||
        value.purpose !== purpose ||
        canonicalH2Json(value.binding) !== canonicalH2Json(this.binding(row))
      )
        throw Error()
      const envelope = envelopeSchema.parse(value.request),
        request = envelope.input
      if (
        canonicalH2Json(envelope) !== row.context_json ||
        envelope.operation !== row.operation ||
        request.request_key !== row.request_key ||
        project.setup.binding_id !== row.binding_id ||
        project.setup.controller_id !== row.controller_id ||
        project.registration.app_id !== row.app_id ||
        request.scope.controller_id !== row.controller_id ||
        request.scope.app_id !== row.app_id ||
        request.scope.ownership_generation !== project.registration.ownership_generation ||
        request.scope.target.vps_id !== project.setup.target_vps_id ||
        request.scope.target.ssh_security_revision !== project.setup.target_security_revision
      )
        throw Error()
      return envelope
    } catch {
      throw new DesktopPostgresError('POSTGRES_UNAVAILABLE')
    }
  }
  private validateResult(envelope: Envelope, value: Result): void {
    const result =
      envelope.operation === 'prepare'
        ? postgresPrepareResultSchema.parse(value)
        : postgresSelectionResultSchema.parse(value)
    const input = envelope.input
    if (result.request_key !== input.request_key)
      throw new DesktopPostgresError('POSTGRES_UNAVAILABLE')
    if ('metadata' in result) {
      const project = this.project(this.row(input.request_key).project_request_key)
      if (result.metadata.framework !== project.setup.framework)
        throw new DesktopPostgresError('POSTGRES_UNAVAILABLE')
      if (
        result.metadata.controller_id !== input.scope.controller_id ||
        result.metadata.app_id !== input.scope.app_id ||
        result.metadata.ownership_generation !== input.scope.ownership_generation
      )
        throw new DesktopPostgresError('POSTGRES_UNAVAILABLE')
    } else {
      if (
        envelope.operation !== 'select' ||
        result.controller_id !== input.scope.controller_id ||
        result.app_id !== input.scope.app_id ||
        result.ownership_generation !== input.scope.ownership_generation ||
        result.source_config_sha256 !== envelope.expected_result_config_sha256 ||
        result.database.database_id !== envelope.input.database_id ||
        result.database.controller_id !== input.scope.controller_id ||
        result.database.ownership_generation !== input.scope.ownership_generation ||
        ![input.expected_source_generation, input.expected_source_generation + 1].includes(
          result.source_generation
        ) ||
        (result.source_generation === input.expected_source_generation &&
          result.source_config_sha256 !== input.expected_source_config_sha256)
      )
        throw new DesktopPostgresError('POSTGRES_UNAVAILABLE')
    }
  }
  private metadata(row: Row): DesktopPostgresIntent {
    const envelope = this.request(row),
      result = this.result(row)
    if (['resource_prepared', 'selected'].includes(row.state) !== (result !== null))
      throw new DesktopPostgresError('POSTGRES_UNAVAILABLE')
    if (result) this.validateResult(envelope, result)
    return {
      request_key: row.request_key,
      project_request_key: row.project_request_key,
      binding_id: row.binding_id,
      binding_revision: row.binding_revision,
      controller_id: row.controller_id,
      app_id: row.app_id,
      operation: row.operation,
      source_generation: envelope.input.expected_source_generation,
      source_config_sha256: envelope.input.expected_source_config_sha256,
      database_id:
        envelope.operation === 'select'
          ? envelope.input.database_id
          : result && 'metadata' in result
            ? result.metadata.database_id
            : null,
      state: row.state,
      result,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }
  private valid(value: unknown): Row {
    const parsed = rowSchema.safeParse(value)
    if (!parsed.success) throw new DesktopPostgresError('POSTGRES_UNAVAILABLE')
    return parsed.data
  }
  private row(key: string): Row {
    if (!uuid.safeParse(key).success) throw new DesktopPostgresError('POSTGRES_REQUEST_INVALID')
    return this.valid(
      this.db.prepare('SELECT * FROM desktop_postgres_intent WHERE request_key=?').get(key)
    )
  }
  private recover(row: Row): Row {
    this.request(row)
    if (row.state === 'in_flight' && !this.busy.has(row.request_key)) {
      this.update(row, 'outcome_unknown')
      return this.row(row.request_key)
    }
    return row
  }
  private update(row: Row, state: Row['state'], result?: Result): void {
    let encoded: string | null = null
    if (result) {
      const encrypted = this.cipher.encrypt(
        canonicalH2Json({ purpose: purpose + '-result', binding: this.binding(row), result })
      )
      encoded = canonicalH2Json({
        crypto_scheme: encrypted.crypto_scheme,
        encrypted_secret: encrypted.encrypted_secret.toString('base64'),
        iv: encrypted.iv.toString('base64'),
        auth_tag: encrypted.auth_tag.toString('base64')
      })
    }
    this.db
      .prepare(
        'UPDATE desktop_postgres_intent SET state=?,result_json=?,updated_at=? WHERE request_key=?'
      )
      .run(state, encoded, new Date().toISOString(), row.request_key)
  }
  private result(row: Row): Result | null {
    if (row.result_json === null) return null
    try {
      const encrypted = z
        .strictObject({
          crypto_scheme: z.literal('aes_256_gcm'),
          encrypted_secret: z.string().max(32768),
          iv: z.string().max(32),
          auth_tag: z.string().max(32)
        })
        .parse(JSON.parse(row.result_json))
      const value = JSON.parse(
        this.cipher.decrypt({
          crypto_scheme: encrypted.crypto_scheme,
          encrypted_secret: Buffer.from(encrypted.encrypted_secret, 'base64'),
          iv: Buffer.from(encrypted.iv, 'base64'),
          auth_tag: Buffer.from(encrypted.auth_tag, 'base64')
        })
      )
      if (
        Object.keys(value).sort().join(',') !== 'binding,purpose,result' ||
        value.purpose !== purpose + '-result' ||
        canonicalH2Json(value.binding) !== canonicalH2Json(this.binding(row))
      )
        throw Error()
      return row.operation === 'prepare'
        ? postgresPrepareResultSchema.parse(value.result)
        : postgresSelectionResultSchema.parse(value.result)
    } catch {
      throw new DesktopPostgresError('POSTGRES_UNAVAILABLE')
    }
  }
  private outsideTransaction(): void {
    if (this.db.inTransaction) throw new DesktopPostgresError('POSTGRES_REQUEST_INVALID')
  }
  private mutate<T>(operation: () => T): T {
    this.outsideTransaction()
    return this.db.transaction(operation).immediate()
  }
}
