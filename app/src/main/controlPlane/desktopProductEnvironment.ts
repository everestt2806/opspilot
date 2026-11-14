import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type {
  DesktopEnvironmentContext,
  DesktopEnvironmentIntent,
  DesktopEnvironmentPrepareInput
} from '@shared/desktopProductEnvironment'
import type {
  ProductEnvironmentMetadata,
  ProductEnvironmentStageInput,
  ProductEnvironmentState
} from '../../../../docs/contracts/product-environment'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type { DesktopControllerVault } from './desktopControllerVault'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import type { DesktopProjectSetups } from './desktopProjectSetup'
import { canonicalH2Json } from './productH2Proof'
import {
  environmentStageSchema,
  environmentStateResultSchema,
  environmentStageResultSchema,
  environmentMetadataSchema,
  environmentReviewSchema,
  validateEnvironmentValues
} from './productEnvironment'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  uuid = z.uuidv4()
const prepareSchema = z.strictObject({
  project_request_key: uuid,
  expected_binding_revision: positive,
  expected_latest_revision: positive.nullable(),
  runtime_env: z.record(z.string(), z.string()),
  public_build_args: z.record(z.string(), z.string())
})
const contextSchema = z.strictObject({
  request: environmentStageSchema.omit({ values: true }),
  runtime_keys: z.array(z.string()).max(128),
  public_build_keys: z.array(z.string()).max(128)
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
  encrypted_secret: z.instanceof(Buffer).refine((b) => b.length > 0 && b.length <= 131072),
  iv: z.instanceof(Buffer).refine((b) => b.length === 12),
  auth_tag: z.instanceof(Buffer).refine((b) => b.length === 16),
  state: z.enum(['prepared', 'in_flight', 'outcome_unknown', 'staged', 'cancelled']),
  result_json: z.string().max(32768).nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})
type Row = z.output<typeof rowSchema>
const purpose = 'opspilot-desktop-environment-intent-v1'
export class DesktopEnvironmentError extends Error {
  constructor(
    readonly code:
      | 'ENVIRONMENT_REQUEST_INVALID'
      | 'ENVIRONMENT_CHANGED'
      | 'ENVIRONMENT_BUSY'
      | 'ENVIRONMENT_UNAVAILABLE'
      | 'ENVIRONMENT_RESPONSE_INVALID'
      | 'ENVIRONMENT_CONFLICT'
  ) {
    super(code)
  }
}

/** Local encrypted replay journal. Không đưa body, cipher hoặc hash secret ra IPC. */
export class DesktopProductEnvironment {
  private readonly busy = new Set<string>()
  constructor(
    private readonly db: Database.Database,
    private readonly cipher: AesGcmCredentialCipher,
    private readonly vault: Pick<DesktopControllerVault, 'resolve' | 'get'>,
    private readonly projects: Pick<DesktopProjectSetups, 'registeredContextSnapshot'>,
    private readonly admin: Pick<
      DesktopControllerEnrollment,
      'environmentReview' | 'environmentState' | 'stageEnvironment'
    >
  ) {}

  async context(projectKey: string): Promise<DesktopEnvironmentContext> {
    const { project, remote } = await this.remoteContext(projectKey)
    return {
      project_request_key: projectKey,
      binding_id: project.setup.binding_id,
      binding_revision: project.setup.binding_revision,
      controller_id: project.setup.controller_id,
      app_id: project.registration.app_id,
      ownership_generation: remote.scope.ownership_generation,
      source_generation: remote.source_generation,
      source_config_sha256: remote.source_config_sha256,
      latest: remote.latest,
      selected: remote.selected,
      auto_deploy_paused: remote.auto_deploy_paused
    }
  }

  async prepare(input: DesktopEnvironmentPrepareInput): Promise<DesktopEnvironmentIntent> {
    const parsed = prepareSchema.safeParse(input)
    if (!parsed.success) throw new DesktopEnvironmentError('ENVIRONMENT_REQUEST_INVALID')
    const value = parsed.data
    const { project, remote } = await this.remoteContext(value.project_request_key)
    if (
      project.setup.binding_revision !== value.expected_binding_revision ||
      (remote.latest?.revision ?? null) !== value.expected_latest_revision
    )
      throw new DesktopEnvironmentError('ENVIRONMENT_CHANGED')
    return this.mutate(() => {
      this.project(value.project_request_key, project.setup.binding_revision)
      const values = validateEnvironmentValues(
        { runtime_env: value.runtime_env, public_build_args: value.public_build_args },
        project.setup.framework
      )
      const previous = this.db
        .prepare(
          "SELECT * FROM desktop_environment_intent WHERE controller_id=? AND app_id=? AND state IN ('prepared','in_flight','outcome_unknown')"
        )
        .get(project.setup.controller_id, project.registration.app_id)
      if (
        this.db
          .prepare(
            "SELECT 1 FROM desktop_environment_selection WHERE controller_id=? AND app_id=? AND state IN ('prepared','in_flight','outcome_unknown')"
          )
          .get(project.setup.controller_id, project.registration.app_id)
      )
        throw new DesktopEnvironmentError('ENVIRONMENT_CONFLICT')
      if (previous) {
        const row = this.valid(previous)
        this.current(row)
        const old = this.decrypt(row)
        if (
          row.project_request_key !== value.project_request_key ||
          old.expected_latest_revision !== value.expected_latest_revision ||
          canonicalH2Json(old.scope) !== canonicalH2Json(remote.scope) ||
          canonicalH2Json(old.values) !== canonicalH2Json(values)
        )
          throw new DesktopEnvironmentError('ENVIRONMENT_CONFLICT')
        return this.metadata(this.recover(row))
      }
      const request: ProductEnvironmentStageInput = {
        format: 1,
        request_key: randomUUID(),
        scope: remote.scope,
        expected_latest_revision: value.expected_latest_revision,
        expected_source_generation: remote.source_generation,
        expected_source_config_sha256: remote.source_config_sha256,
        values
      }
      const stamp = new Date().toISOString()
      const { values: requestValues, ...body } = request
      const context = canonicalH2Json({
        request: body,
        runtime_keys: Object.keys(requestValues.runtime_env).sort(),
        public_build_keys: Object.keys(requestValues.public_build_args).sort()
      })
      const binding = {
        request_key: request.request_key,
        project_request_key: value.project_request_key,
        binding_id: project.setup.binding_id,
        binding_revision: project.setup.binding_revision,
        controller_id: project.setup.controller_id,
        app_id: project.registration.app_id,
        context_json: context,
        created_at: stamp
      }
      const encrypted = this.cipher.encrypt(canonicalH2Json({ purpose, binding, request }))
      this.project(value.project_request_key, project.setup.binding_revision)
      this.db
        .prepare(
          `INSERT INTO desktop_environment_intent(request_key,project_request_key,binding_id,binding_revision,controller_id,
        app_id,context_json,crypto_scheme,encrypted_secret,iv,auth_tag,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)`
        )
        .run(
          binding.request_key,
          binding.project_request_key,
          binding.binding_id,
          binding.binding_revision,
          binding.controller_id,
          binding.app_id,
          context,
          encrypted.crypto_scheme,
          encrypted.encrypted_secret,
          encrypted.iv,
          encrypted.auth_tag,
          stamp,
          stamp
        )
      const row = this.row(binding.request_key)
      this.decrypt(row)
      this.current(row)
      return this.metadata(row)
    })
  }

  list(projectKey: string): DesktopEnvironmentIntent[] {
    this.project(projectKey)
    return this.mutate(() =>
      this.db
        .prepare(
          `SELECT * FROM desktop_environment_intent WHERE project_request_key=?
      ORDER BY CASE WHEN state IN ('prepared','in_flight','outcome_unknown') THEN 0 ELSE 1 END,created_at DESC,request_key LIMIT 20`
        )
        .all(projectKey)
        .map((found) => {
          const row = this.valid(found)
          this.current(row)
          return this.metadata(this.recover(row))
        })
    )
  }
  cancel(key: string): DesktopEnvironmentIntent {
    return this.mutate(() => {
      const row = this.row(key)
      this.current(row)
      if (!['prepared', 'cancelled'].includes(row.state) || this.busy.has(key))
        throw new DesktopEnvironmentError('ENVIRONMENT_CONFLICT')
      this.update(key, 'cancelled')
      return this.metadata(this.row(key))
    })
  }
  async send(key: string): Promise<DesktopEnvironmentIntent> {
    return this.operation(key, false)
  }
  async check(key: string): Promise<DesktopEnvironmentIntent> {
    return this.operation(key, true)
  }
  private async operation(key: string, check: boolean): Promise<DesktopEnvironmentIntent> {
    if (this.db.inTransaction) throw new DesktopEnvironmentError('ENVIRONMENT_REQUEST_INVALID')
    const initial = this.row(key)
    this.current(initial)
    if (['staged', 'cancelled'].includes(initial.state)) return this.metadata(initial)
    if (this.busy.has(key)) throw new DesktopEnvironmentError('ENVIRONMENT_BUSY')
    this.busy.add(key)
    try {
      const request = this.decrypt(initial)
      if (!check)
        this.mutate(() => {
          this.current(initial)
          this.update(key, 'in_flight')
        })
      const guard = (): void => {
        this.current(initial)
        if (this.row(key).context_json !== initial.context_json)
          throw new DesktopEnvironmentError('ENVIRONMENT_CHANGED')
      }
      let result: ProductEnvironmentMetadata | null
      if (check) {
        const reviewed = await this.remoteContext(initial.project_request_key)
        guard()
        if (canonicalH2Json(reviewed.remote.scope) !== canonicalH2Json(request.scope))
          throw new DesktopEnvironmentError('ENVIRONMENT_CHANGED')
        const value = environmentStateResultSchema.parse(
          await this.admin.environmentState(initial.binding_id, {
            format: 1,
            scope: request.scope,
            expected_source_generation: reviewed.remote.source_generation,
            expected_source_config_sha256: reviewed.remote.source_config_sha256,
            request_key: key
          })
        )
        if (
          canonicalH2Json(value.scope) !== canonicalH2Json(request.scope) ||
          value.request_key !== key ||
          value.source_generation !== reviewed.remote.source_generation ||
          value.source_config_sha256 !== reviewed.remote.source_config_sha256
        )
          throw new DesktopEnvironmentError('ENVIRONMENT_RESPONSE_INVALID')
        result = value.requested
      } else {
        const value = environmentStageResultSchema.parse(
          await this.admin.stageEnvironment(initial.binding_id, request, guard)
        )
        if (value.request_key !== key)
          throw new DesktopEnvironmentError('ENVIRONMENT_RESPONSE_INVALID')
        result = value.metadata
      }
      guard()
      return this.mutate(() => {
        guard()
        const row = this.row(key)
        if (result) {
          this.validateMetadata(result, row)
          if (row.state === 'prepared') this.update(key, 'in_flight')
          this.update(key, 'staged', result)
        } else if (row.state === 'in_flight') this.update(key, 'outcome_unknown')
        return this.metadata(this.row(key))
      })
    } catch {
      this.mutate(() => {
        const row = this.row(key)
        if (row.state === 'in_flight') this.update(key, 'outcome_unknown')
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
    const project = this.projects.registeredContextSnapshot(key)
    const binding = this.vault.resolve(project.setup.binding_id),
      scopes = this.vault.get(project.setup.binding_id).client?.scopes ?? []
    if (
      binding.revision !== project.setup.binding_revision ||
      binding.controllerId !== project.setup.controller_id ||
      (revision !== undefined && revision !== binding.revision) ||
      !scopes.includes('deploy:manual') ||
      !scopes.includes('policy:write')
    )
      throw new DesktopEnvironmentError('ENVIRONMENT_CHANGED')
    return project
  }
  /** @internal Main capability; only context() metadata may cross IPC. */
  async remoteContext(key: string): Promise<{
    project: ReturnType<DesktopProjectSetups['registeredContextSnapshot']>
    remote: ProductEnvironmentState & {
      selected: ProductEnvironmentMetadata | null
      auto_deploy_paused: boolean
    }
  }> {
    if (this.db.inTransaction) throw new DesktopEnvironmentError('ENVIRONMENT_REQUEST_INVALID')
    const project = this.project(key),
      setup = project.setup,
      registration = project.registration
    const remote = environmentReviewSchema.parse(
      await this.admin.environmentReview(setup.binding_id, {
        format: 1,
        controller_id: setup.controller_id,
        app_id: registration.app_id,
        expected_ownership_generation: registration.ownership_generation,
        expected_source_generation: registration.source_generation,
        expected_source_config_sha256: registration.source_config_sha256,
        expected_target_security_revision: setup.target_security_revision
      })
    )
    const after = this.project(key, setup.binding_revision)
    if (
      after.body_sha256 !== project.body_sha256 ||
      remote.scope.controller_id !== setup.controller_id ||
      remote.scope.app_id !== registration.app_id ||
      remote.scope.ownership_generation !== registration.ownership_generation ||
      remote.source_generation < registration.source_generation ||
      remote.scope.target.vps_id !== setup.target_vps_id ||
      remote.scope.target.ssh_security_revision !== setup.target_security_revision ||
      remote.request_key !== null ||
      remote.requested !== null ||
      [remote.latest, remote.selected].some(
        (metadata) =>
          metadata &&
          (metadata.controller_id !== setup.controller_id ||
            metadata.app_id !== registration.app_id ||
            metadata.ownership_generation !== registration.ownership_generation ||
            metadata.framework !== setup.framework)
      ) ||
      (remote.selected !== null && remote.selected.revision > (remote.latest?.revision ?? 0))
    )
      throw new DesktopEnvironmentError('ENVIRONMENT_RESPONSE_INVALID')
    return { project, remote }
  }
  private current(row: Row): void {
    const project = this.project(row.project_request_key, row.binding_revision),
      context = contextSchema.parse(JSON.parse(row.context_json)),
      request = context.request
    if (
      project.setup.binding_id !== row.binding_id ||
      project.setup.controller_id !== row.controller_id ||
      project.registration.app_id !== row.app_id ||
      request.request_key !== row.request_key ||
      request.scope.controller_id !== row.controller_id ||
      request.scope.app_id !== row.app_id ||
      request.scope.ownership_generation !== project.registration.ownership_generation ||
      request.scope.target.vps_id !== project.setup.target_vps_id ||
      request.scope.target.ssh_security_revision !== project.setup.target_security_revision
    )
      throw new DesktopEnvironmentError('ENVIRONMENT_CHANGED')
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
  private decrypt(row: Row): ProductEnvironmentStageInput {
    try {
      const value = JSON.parse(this.cipher.decrypt(row))
      if (
        !value ||
        Object.keys(value).sort().join(',') !== 'binding,purpose,request' ||
        value.purpose !== purpose ||
        canonicalH2Json(value.binding) !== canonicalH2Json(this.binding(row))
      )
        throw Error()
      const request = environmentStageSchema.parse(value.request),
        { values, ...body } = request,
        context = contextSchema.parse(JSON.parse(row.context_json))
      if (
        canonicalH2Json(body) !== canonicalH2Json(context.request) ||
        canonicalH2Json(Object.keys(values.runtime_env).sort()) !==
          canonicalH2Json(context.runtime_keys) ||
        canonicalH2Json(Object.keys(values.public_build_args).sort()) !==
          canonicalH2Json(context.public_build_keys)
      )
        throw Error()
      validateEnvironmentValues(values, this.project(row.project_request_key).setup.framework)
      return request
    } catch {
      throw new DesktopEnvironmentError('ENVIRONMENT_UNAVAILABLE')
    }
  }
  private validateMetadata(value: ProductEnvironmentMetadata, row: Row): void {
    const c = contextSchema.parse(JSON.parse(row.context_json)),
      request = c.request
    if (
      value.controller_id !== row.controller_id ||
      value.app_id !== row.app_id ||
      value.ownership_generation !== request.scope.ownership_generation ||
      value.revision !== (request.expected_latest_revision ?? 0) + 1 ||
      value.basis_source_generation !== request.expected_source_generation ||
      value.basis_source_config_sha256 !== request.expected_source_config_sha256 ||
      value.framework !== this.project(row.project_request_key).setup.framework ||
      canonicalH2Json(value.runtime_keys) !== canonicalH2Json(c.runtime_keys) ||
      canonicalH2Json(value.public_build_keys) !== canonicalH2Json(c.public_build_keys)
    )
      throw new DesktopEnvironmentError('ENVIRONMENT_RESPONSE_INVALID')
  }
  private metadata(row: Row): DesktopEnvironmentIntent {
    this.decrypt(row)
    this.current(row)
    const c = contextSchema.parse(JSON.parse(row.context_json)),
      request = c.request
    const result =
      row.result_json === null ? null : environmentMetadataSchema.parse(JSON.parse(row.result_json))
    if ((row.state === 'staged') !== (result !== null))
      throw new DesktopEnvironmentError('ENVIRONMENT_UNAVAILABLE')
    if (result) this.validateMetadata(result, row)
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
      expected_latest_revision: request.expected_latest_revision,
      runtime_keys: c.runtime_keys,
      public_build_keys: c.public_build_keys,
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
      this.db.prepare('SELECT * FROM desktop_environment_intent WHERE request_key=?').get(key)
    )
  }
  private recover(row: Row): Row {
    if (row.state === 'in_flight' && !this.busy.has(row.request_key)) {
      this.update(row.request_key, 'outcome_unknown')
      return this.row(row.request_key)
    }
    return row
  }
  private update(key: string, state: Row['state'], result?: ProductEnvironmentMetadata): void {
    this.db
      .prepare(
        'UPDATE desktop_environment_intent SET state=?,result_json=?,updated_at=? WHERE request_key=?'
      )
      .run(state, result ? canonicalH2Json(result) : null, new Date().toISOString(), key)
  }
  private mutate<T>(work: () => T): T {
    if (this.db.inTransaction) throw new DesktopEnvironmentError('ENVIRONMENT_REQUEST_INVALID')
    try {
      return this.db.transaction(work).immediate()
    } catch (error) {
      if (error instanceof DesktopEnvironmentError) throw error
      throw new DesktopEnvironmentError('ENVIRONMENT_UNAVAILABLE')
    }
  }
}
