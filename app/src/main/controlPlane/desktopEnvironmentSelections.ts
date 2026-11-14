import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type {
  DesktopEnvironmentSelectionIntent,
  DesktopEnvironmentSelectionPrepareInput
} from '@shared/desktopProductEnvironment'
import type {
  ProductEnvironmentSelectionInput,
  ProductEnvironmentSelectionResult
} from '../../../../docs/contracts/product-environment'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type { DesktopControllerVault } from './desktopControllerVault'
import type { DesktopProjectSetups } from './desktopProjectSetup'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import {
  DesktopEnvironmentError,
  type DesktopProductEnvironment
} from './desktopProductEnvironment'
import { environmentSelectionSchema, environmentSelectionResultSchema } from './productEnvironment'
import { canonicalH2Json } from './productH2Proof'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  uuid = z.uuidv4()
const prepareSchema = z.strictObject({
  project_request_key: uuid,
  expected_binding_revision: positive,
  expected_source_generation: positive,
  expected_source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expected_latest_revision: positive,
  environment_revision: positive
})
const rowSchema = z.strictObject({
  request_key: uuid,
  project_request_key: uuid,
  binding_id: uuid,
  binding_revision: positive,
  controller_id: z.string(),
  app_id: positive,
  context_json: z.string().max(32768),
  crypto_scheme: z.literal('aes_256_gcm'),
  encrypted_secret: z.instanceof(Buffer),
  iv: z.instanceof(Buffer),
  auth_tag: z.instanceof(Buffer),
  state: z.enum([
    'prepared',
    'in_flight',
    'outcome_unknown',
    'selected',
    'not_applied',
    'cancelled'
  ]),
  result_json: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})
type Row = z.output<typeof rowSchema>
const purpose = 'opspilot-desktop-environment-selection-v1'
/** Main-only, immutable authenticated body; no user environment values in this journal. */
export class DesktopEnvironmentSelections {
  private readonly busy = new Set<string>()
  constructor(
    private readonly db: Database.Database,
    private readonly cipher: AesGcmCredentialCipher,
    private readonly vault: Pick<DesktopControllerVault, 'resolve' | 'get'>,
    private readonly projects: Pick<DesktopProjectSetups, 'registeredContextSnapshot'>,
    private readonly environment: Pick<DesktopProductEnvironment, 'remoteContext'>,
    private readonly admin: Pick<
      DesktopControllerEnrollment,
      'selectEnvironment' | 'environmentSelectionState'
    >
  ) {}
  async prepare(
    input: DesktopEnvironmentSelectionPrepareInput
  ): Promise<DesktopEnvironmentSelectionIntent> {
    const parsed = prepareSchema.safeParse(input)
    if (!parsed.success) throw new DesktopEnvironmentError('ENVIRONMENT_REQUEST_INVALID')
    const value = parsed.data,
      { project, remote } = await this.environment.remoteContext(value.project_request_key)
    if (
      project.setup.binding_revision !== value.expected_binding_revision ||
      remote.source_generation !== value.expected_source_generation ||
      remote.source_config_sha256 !== value.expected_source_config_sha256 ||
      remote.latest?.revision !== value.expected_latest_revision ||
      value.environment_revision > value.expected_latest_revision ||
      !remote.auto_deploy_paused
    )
      throw new DesktopEnvironmentError('ENVIRONMENT_CHANGED')
    return this.mutate(() => {
      this.project(value.project_request_key, project.setup.binding_revision)
      if (
        this.db
          .prepare(
            "SELECT 1 FROM desktop_environment_intent WHERE controller_id=? AND app_id=? AND state IN ('prepared','in_flight','outcome_unknown')"
          )
          .get(project.setup.controller_id, project.registration.app_id)
      )
        throw new DesktopEnvironmentError('ENVIRONMENT_CONFLICT')
      const pending = this.db
        .prepare(
          "SELECT * FROM desktop_environment_selection WHERE controller_id=? AND app_id=? AND state IN ('prepared','in_flight','outcome_unknown')"
        )
        .get(project.setup.controller_id, project.registration.app_id)
      const request: ProductEnvironmentSelectionInput = {
        format: 1,
        request_key: randomUUID(),
        scope: remote.scope,
        expected_source_generation: remote.source_generation,
        expected_source_config_sha256: remote.source_config_sha256,
        expected_latest_revision: value.expected_latest_revision,
        environment_revision: value.environment_revision
      }
      if (pending) {
        const old = this.valid(pending),
          body = this.request(old)
        if (
          old.project_request_key !== value.project_request_key ||
          canonicalH2Json({ ...body, request_key: request.request_key }) !==
            canonicalH2Json(request)
        )
          throw new DesktopEnvironmentError('ENVIRONMENT_CONFLICT')
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
          context_json: canonicalH2Json(request),
          created_at: stamp
        }
      const encrypted = this.cipher.encrypt(canonicalH2Json({ purpose, binding, request }))
      this.project(value.project_request_key, project.setup.binding_revision)
      this.db
        .prepare(
          "INSERT INTO desktop_environment_selection(request_key,project_request_key,binding_id,binding_revision,controller_id,app_id,context_json,crypto_scheme,encrypted_secret,iv,auth_tag,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)"
        )
        .run(
          binding.request_key,
          binding.project_request_key,
          binding.binding_id,
          binding.binding_revision,
          binding.controller_id,
          binding.app_id,
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
  list(key: string): DesktopEnvironmentSelectionIntent[] {
    this.project(key)
    return this.mutate(() =>
      this.db
        .prepare(
          "SELECT * FROM desktop_environment_selection WHERE project_request_key=? ORDER BY CASE WHEN state IN ('prepared','in_flight','outcome_unknown') THEN 0 ELSE 1 END,created_at DESC,request_key LIMIT 20"
        )
        .all(key)
        .map((value) => this.metadata(this.recover(this.valid(value))))
    )
  }
  cancel(key: string): DesktopEnvironmentSelectionIntent {
    return this.mutate(() => {
      const row = this.row(key)
      this.request(row)
      if (!['prepared', 'cancelled'].includes(row.state) || this.busy.has(key))
        throw new DesktopEnvironmentError('ENVIRONMENT_CONFLICT')
      this.update(key, 'cancelled')
      return this.metadata(this.row(key))
    })
  }
  async send(key: string): Promise<DesktopEnvironmentSelectionIntent> {
    return this.operation(key, false)
  }
  async check(key: string): Promise<DesktopEnvironmentSelectionIntent> {
    return this.operation(key, true)
  }
  private async operation(key: string, check: boolean): Promise<DesktopEnvironmentSelectionIntent> {
    if (this.db.inTransaction) throw new DesktopEnvironmentError('ENVIRONMENT_REQUEST_INVALID')
    const initial = this.row(key),
      request = this.request(initial)
    if (['selected', 'not_applied', 'cancelled'].includes(initial.state))
      return this.metadata(initial)
    if (this.busy.has(key)) throw new DesktopEnvironmentError('ENVIRONMENT_BUSY')
    this.busy.add(key)
    const guard = (): void => {
      if (canonicalH2Json(this.request(this.row(key))) !== canonicalH2Json(request))
        throw new DesktopEnvironmentError('ENVIRONMENT_CHANGED')
    }
    try {
      if (!check)
        this.mutate(() => {
          guard()
          this.update(key, 'in_flight')
        })
      let result: ProductEnvironmentSelectionResult | null,
        unapplied = false
      if (check) {
        const value = z
          .strictObject({
            result: environmentSelectionResultSchema.nullable(),
            definitively_unapplied: z.boolean()
          })
          .parse(await this.admin.environmentSelectionState(initial.binding_id, request))
        result = value.result
        unapplied = value.definitively_unapplied
        if (result && unapplied) throw new DesktopEnvironmentError('ENVIRONMENT_RESPONSE_INVALID')
      } else
        result = environmentSelectionResultSchema.parse(
          await this.admin.selectEnvironment(initial.binding_id, request, guard)
        )
      guard()
      return this.mutate(() => {
        guard()
        const row = this.row(key)
        if (result) {
          this.validateResult(result, request)
          if (row.state === 'prepared') this.update(key, 'in_flight')
          this.update(key, 'selected', result)
        } else if (unapplied) this.update(key, 'not_applied')
        else if (row.state === 'in_flight') this.update(key, 'outcome_unknown')
        return this.metadata(this.row(key))
      })
    } catch {
      this.mutate(() => {
        if (this.row(key).state === 'in_flight') this.update(key, 'outcome_unknown')
      })
      throw new DesktopEnvironmentError('ENVIRONMENT_UNAVAILABLE')
    } finally {
      this.busy.delete(key)
    }
  }
  private project(
    key: string,
    revision?: number
  ): ReturnType<DesktopProjectSetups['registeredContextSnapshot']> {
    if (!uuid.safeParse(key).success)
      throw new DesktopEnvironmentError('ENVIRONMENT_REQUEST_INVALID')
    const project = this.projects.registeredContextSnapshot(key),
      binding = this.vault.resolve(project.setup.binding_id),
      scopes = this.vault.get(project.setup.binding_id).client?.scopes ?? []
    if (
      binding.revision !== project.setup.binding_revision ||
      binding.controllerId !== project.setup.controller_id ||
      (revision !== undefined && binding.revision !== revision) ||
      !scopes.includes('deploy:manual') ||
      !scopes.includes('policy:write')
    )
      throw new DesktopEnvironmentError('ENVIRONMENT_CHANGED')
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
      context_json: row.context_json,
      created_at: row.created_at
    }
  }
  private request(row: Row): ProductEnvironmentSelectionInput {
    try {
      const project = this.project(row.project_request_key, row.binding_revision),
        value = JSON.parse(this.cipher.decrypt(row))
      if (
        Object.keys(value).sort().join(',') !== 'binding,purpose,request' ||
        value.purpose !== purpose ||
        canonicalH2Json(value.binding) !== canonicalH2Json(this.binding(row))
      )
        throw Error()
      const request = environmentSelectionSchema.parse(value.request)
      if (
        canonicalH2Json(request) !== row.context_json ||
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
      return request
    } catch {
      throw new DesktopEnvironmentError('ENVIRONMENT_UNAVAILABLE')
    }
  }
  private validateResult(
    value: ProductEnvironmentSelectionResult,
    request: ProductEnvironmentSelectionInput
  ): void {
    const project = this.project(this.row(request.request_key).project_request_key).setup
    const expectedHash = createHash('sha256')
      .update(
        canonicalH2Json({
          framework: project.framework,
          host_port: project.host_port,
          container_port: project.container_port,
          healthcheck_path: project.healthcheck_path,
          needs_db: false,
          environment: value.environment
        })
      )
      .digest('hex')
    if (
      value.request_key !== request.request_key ||
      value.controller_id !== request.scope.controller_id ||
      value.app_id !== request.scope.app_id ||
      value.ownership_generation !== request.scope.ownership_generation ||
      value.environment.controller_id !== request.scope.controller_id ||
      value.environment.ownership_generation !== request.scope.ownership_generation ||
      value.environment.revision !== request.environment_revision ||
      value.source_generation <= request.expected_source_generation ||
      value.source_config_sha256 !== expectedHash
    )
      throw new DesktopEnvironmentError('ENVIRONMENT_RESPONSE_INVALID')
  }
  private metadata(row: Row): DesktopEnvironmentSelectionIntent {
    const request = this.request(row),
      result = this.result(row)
    if ((row.state === 'selected') !== (result !== null))
      throw new DesktopEnvironmentError('ENVIRONMENT_UNAVAILABLE')
    if (result) this.validateResult(result, request)
    return {
      request_key: row.request_key,
      project_request_key: row.project_request_key,
      binding_id: row.binding_id,
      binding_revision: row.binding_revision,
      controller_id: row.controller_id,
      app_id: row.app_id,
      ownership_generation: request.scope.ownership_generation,
      source_generation: request.expected_source_generation,
      source_config_sha256: request.expected_source_config_sha256,
      environment_revision: request.environment_revision,
      expected_latest_revision: request.expected_latest_revision,
      state: row.state,
      result,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }
  private valid(value: unknown): Row {
    const parsed = rowSchema.safeParse(value)
    if (!parsed.success) throw new DesktopEnvironmentError('ENVIRONMENT_UNAVAILABLE')
    return parsed.data
  }
  private row(key: string): Row {
    if (!uuid.safeParse(key).success)
      throw new DesktopEnvironmentError('ENVIRONMENT_REQUEST_INVALID')
    return this.valid(
      this.db.prepare('SELECT * FROM desktop_environment_selection WHERE request_key=?').get(key)
    )
  }
  private recover(row: Row): Row {
    this.request(row)
    if (row.state === 'in_flight' && !this.busy.has(row.request_key)) {
      this.update(row.request_key, 'outcome_unknown')
      return this.row(row.request_key)
    }
    return row
  }
  private update(
    key: string,
    state: Row['state'],
    result?: ProductEnvironmentSelectionResult
  ): void {
    let resultJson: string | null = null
    if (result) {
      const row = this.row(key),
        encrypted = this.cipher.encrypt(
          canonicalH2Json({ purpose: purpose + '-result', binding: this.binding(row), result })
        )
      resultJson = canonicalH2Json({
        crypto_scheme: encrypted.crypto_scheme,
        encrypted_secret: encrypted.encrypted_secret.toString('base64'),
        iv: encrypted.iv.toString('base64'),
        auth_tag: encrypted.auth_tag.toString('base64')
      })
    }
    this.db
      .prepare(
        'UPDATE desktop_environment_selection SET state=?,result_json=?,updated_at=? WHERE request_key=?'
      )
      .run(state, resultJson, new Date().toISOString(), key)
  }
  private result(row: Row): ProductEnvironmentSelectionResult | null {
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
      return environmentSelectionResultSchema.parse(value.result)
    } catch {
      throw new DesktopEnvironmentError('ENVIRONMENT_UNAVAILABLE')
    }
  }
  private mutate<T>(action: () => T): T {
    if (this.db.inTransaction) throw new DesktopEnvironmentError('ENVIRONMENT_REQUEST_INVALID')
    try {
      return this.db.transaction(action).immediate()
    } catch (error) {
      if (error instanceof DesktopEnvironmentError) throw error
      throw new DesktopEnvironmentError('ENVIRONMENT_UNAVAILABLE')
    }
  }
}
