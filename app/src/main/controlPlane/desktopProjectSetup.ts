import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type {
  DesktopProjectSetup,
  DesktopProjectSetupInput,
  DesktopProjectTargets,
  DesktopProjectSourceVerification
} from '@shared/desktopProjectRegistration'
import { DesktopControllerVault } from './desktopControllerVault'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import {
  ProductProjectRegistration,
  projectRegistrationInputSchema,
  projectRegistrationResultSchema
} from './projectRegistration'
import { canonicalH2Json } from './productH2Proof'
import { projectSourceVerificationResultSchema } from './projectSourceVerification'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  uuid = z.uuid().transform((value) => value.toLowerCase())
const inputSchema = projectRegistrationInputSchema
  .omit({
    format: true,
    controller_id: true,
    request_key: true,
    expected_target_security_revision: true
  })
  .extend({ binding_id: uuid })
const rowSchema = z.strictObject({
  request_key: uuid,
  binding_id: uuid,
  binding_revision: positive,
  controller_id: projectRegistrationInputSchema.shape.controller_id,
  target_vps_id: positive,
  target_security_revision: positive,
  app_name: projectRegistrationInputSchema.shape.app_name,
  body_json: z.string().max(8192),
  body_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['prepared', 'in_flight', 'outcome_unknown', 'registered', 'cancelled']),
  app_id: positive.nullable(),
  result_json: z.string().max(4096).nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})
type Row = z.output<typeof rowSchema>
const sha = (value: string): string => createHash('sha256').update(value).digest('hex')
export class DesktopProjectSetupError extends Error {
  constructor(
    readonly code:
      | 'PROJECT_REQUEST_INVALID'
      | 'PROJECT_SETUP_UNAVAILABLE'
      | 'PROJECT_SETUP_CONFLICT'
      | 'PROJECT_SETUP_BUSY'
      | 'PROJECT_SCOPE_REQUIRED'
      | 'PROJECT_BINDING_CHANGED'
      | 'PROJECT_TARGET_CHANGED'
      | 'PROJECT_RESPONSE_INVALID'
  ) {
    super(code)
  }
}
/** Local journal only; SSH admin remains the authority for remote registration. */
export class DesktopProjectSetups {
  private readonly busy = new Set<string>()
  constructor(
    private readonly db: Database.Database,
    private readonly vault: DesktopControllerVault,
    private readonly admin: Pick<
      DesktopControllerEnrollment,
      'projectTargets' | 'registerProject' | 'verifyProjectSource'
    >
  ) {}
  async verifySource(key: string): Promise<DesktopProjectSourceVerification> {
    if (this.db.inTransaction) throw new DesktopProjectSetupError('PROJECT_REQUEST_INVALID')
    const row = this.row(key)
    if (row.state !== 'registered') throw new DesktopProjectSetupError('PROJECT_SETUP_CONFLICT')
    const before = this.authorize(row.binding_id, row.binding_revision, row.controller_id)
    if (this.busy.has(row.request_key)) throw new DesktopProjectSetupError('PROJECT_SETUP_BUSY')
    this.busy.add(row.request_key)
    try {
      const registration = projectRegistrationResultSchema.parse(JSON.parse(row.result_json!))
      const parsed = projectSourceVerificationResultSchema.safeParse(
        await this.admin.verifyProjectSource(row.binding_id, {
          format: 1,
          controller_id: row.controller_id,
          app_id: registration.app_id,
          expected_ownership_generation: registration.ownership_generation,
          expected_source_generation: registration.source_generation,
          expected_source_config_sha256: registration.source_config_sha256,
          expected_target_security_revision: row.target_security_revision
        })
      )
      this.authorize(row.binding_id, before.revision, before.controllerId)
      if (this.db.inTransaction) throw new DesktopProjectSetupError('PROJECT_REQUEST_INVALID')
      const current = this.row(key)
      if (
        current.state !== 'registered' ||
        current.body_sha256 !== row.body_sha256 ||
        current.app_id !== row.app_id
      )
        throw new DesktopProjectSetupError('PROJECT_SETUP_CONFLICT')
      if (!parsed.success) throw new DesktopProjectSetupError('PROJECT_RESPONSE_INVALID')
      const result = parsed.data,
        body = ProductProjectRegistration.normalize(JSON.parse(row.body_json))
      if (
        result.controller_id !== row.controller_id ||
        result.app_id !== registration.app_id ||
        result.ownership_generation !== registration.ownership_generation ||
        result.source_generation !== registration.source_generation ||
        result.source_config_sha256 !== registration.source_config_sha256 ||
        result.target_vps_id !== row.target_vps_id ||
        result.target_security_revision !== row.target_security_revision ||
        result.repository_url !== body.repository_url ||
        result.production_ref !== body.production_ref ||
        result.repository_root !== body.repository_root ||
        result.configured_container_port !== body.container_port ||
        Date.parse(result.verified_at) > Date.now() + 5000 ||
        Date.now() - Date.parse(result.verified_at) > 120_000
      )
        throw new DesktopProjectSetupError('PROJECT_RESPONSE_INVALID')
      return {
        ...result,
        binding_id: row.binding_id,
        binding_revision: before.revision,
        request_key: row.request_key
      }
    } finally {
      this.busy.delete(row.request_key)
    }
  }
  async targets(bindingId: string, afterId: number | null = null): Promise<DesktopProjectTargets> {
    const id = uuid.safeParse(bindingId)
    if (!id.success || !positive.nullable().safeParse(afterId).success)
      throw new DesktopProjectSetupError('PROJECT_REQUEST_INVALID')
    const before = this.authorize(id.data)
    // 20 profiles fit the existing 64 KiB admin reply cap even with Unicode names.
    const page = await this.admin.projectTargets(id.data, { after_id: afterId, limit: 20 })
    this.authorize(id.data, before.revision, before.controllerId)
    if (
      page.controller_id !== before.controllerId ||
      page.has_more !== (page.next_after_id !== null) ||
      (page.next_after_id !== null && page.next_after_id <= (afterId ?? 0)) ||
      new Set(page.items.map((item) => item.id)).size !== page.items.length ||
      page.items.some(
        (item, index) =>
          item.id <= (afterId ?? 0) || (index > 0 && item.id <= page.items[index - 1].id)
      )
    )
      throw new DesktopProjectSetupError('PROJECT_RESPONSE_INVALID')
    return {
      binding_id: id.data,
      binding_revision: before.revision,
      controller_id: before.controllerId,
      items: page.items,
      next_after_id: page.next_after_id,
      has_more: page.has_more
    }
  }
  async prepare(input: DesktopProjectSetupInput): Promise<DesktopProjectSetup> {
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success || this.db.inTransaction)
      throw new DesktopProjectSetupError('PROJECT_REQUEST_INVALID')
    const { binding_id, ...value } = parsed.data,
      before = this.authorize(binding_id)
    const targetPage = await this.admin.projectTargets(binding_id, {
      target_id: value.target_vps_id
    })
    const target = targetPage.items.find((item) => item.id === value.target_vps_id)
    if (targetPage.controller_id !== before.controllerId || !target)
      throw new DesktopProjectSetupError('PROJECT_TARGET_CHANGED')
    const key = randomUUID(),
      body = ProductProjectRegistration.normalize({
        ...value,
        format: 1,
        controller_id: before.controllerId,
        request_key: key,
        expected_target_security_revision: target.ssh_security_revision
      })
    return this.mutate(() => {
      this.authorize(binding_id, before.revision, before.controllerId)
      const existing = this.db
        .prepare(
          "SELECT * FROM desktop_project_setup WHERE controller_id=? AND target_vps_id=? AND app_name=? AND state<>'cancelled'"
        )
        .get(before.controllerId, value.target_vps_id, value.app_name)
      if (existing) {
        const row = this.valid(existing)
        if (
          row.binding_id !== binding_id ||
          row.binding_revision !== before.revision ||
          row.body_json !== canonicalH2Json({ ...body, request_key: row.request_key })
        )
          throw new DesktopProjectSetupError('PROJECT_SETUP_CONFLICT')
        return this.metadata(row)
      }
      const serialized = canonicalH2Json(body),
        stamp = new Date().toISOString()
      this.db
        .prepare(
          `INSERT INTO desktop_project_setup(request_key,binding_id,binding_revision,controller_id,target_vps_id,target_security_revision,app_name,body_json,body_sha256,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'prepared',?,?)`
        )
        .run(
          key,
          binding_id,
          before.revision,
          before.controllerId,
          value.target_vps_id,
          target.ssh_security_revision,
          value.app_name,
          serialized,
          sha(serialized),
          stamp,
          stamp
        )
      return this.get(key)
    })
  }
  async send(key: string): Promise<DesktopProjectSetup> {
    const initial = this.row(key)
    if (['registered', 'cancelled'].includes(initial.state)) return this.metadata(initial)
    if (this.busy.has(initial.request_key)) throw new DesktopProjectSetupError('PROJECT_SETUP_BUSY')
    this.busy.add(initial.request_key)
    try {
      const claimed = this.mutate(() => {
        const current = this.row(initial.request_key)
        if (['registered', 'cancelled'].includes(current.state)) return false
        this.authorize(initial.binding_id, initial.binding_revision, initial.controller_id)
        this.db
          .prepare(
            "UPDATE desktop_project_setup SET state='in_flight',updated_at=? WHERE request_key=?"
          )
          .run(new Date().toISOString(), initial.request_key)
        return true
      })
      if (!claimed) return this.get(initial.request_key)
      const page = await this.admin.projectTargets(initial.binding_id, {
        target_id: initial.target_vps_id
      })
      const target = page.items.find((item) => item.id === initial.target_vps_id)
      this.authorize(initial.binding_id, initial.binding_revision, initial.controller_id)
      if (
        page.controller_id !== initial.controller_id ||
        !target ||
        target.ssh_security_revision !== initial.target_security_revision
      )
        throw new DesktopProjectSetupError('PROJECT_TARGET_CHANGED')
      const body = ProductProjectRegistration.normalize(JSON.parse(initial.body_json))
      const parsed = projectRegistrationResultSchema.safeParse(
        await this.admin.registerProject(initial.binding_id, body)
      )
      this.authorize(initial.binding_id, initial.binding_revision, initial.controller_id)
      if (
        !parsed.success ||
        parsed.data.controller_id !== initial.controller_id ||
        parsed.data.request_key !== initial.request_key ||
        parsed.data.target_vps_id !== initial.target_vps_id ||
        (body.host_port !== null && parsed.data.host_port !== body.host_port)
      )
        throw new DesktopProjectSetupError('PROJECT_RESPONSE_INVALID')
      const result = parsed.data
      this.mutate(() => {
        this.authorize(initial.binding_id, initial.binding_revision, initial.controller_id)
        const current = this.row(initial.request_key)
        if (current.state === 'registered') {
          if (current.app_id !== result.app_id)
            throw new DesktopProjectSetupError('PROJECT_RESPONSE_INVALID')
          return
        }
        if (!['in_flight', 'outcome_unknown'].includes(current.state))
          throw new DesktopProjectSetupError('PROJECT_SETUP_CONFLICT')
        this.db
          .prepare(
            "UPDATE desktop_project_setup SET state='registered',app_id=?,result_json=?,updated_at=? WHERE request_key=?"
          )
          .run(
            result.app_id,
            canonicalH2Json(result),
            new Date().toISOString(),
            initial.request_key
          )
      })
      return this.get(initial.request_key)
    } catch (error) {
      this.mutate(() => {
        const row = this.row(initial.request_key)
        if (row.state === 'in_flight')
          this.db
            .prepare(
              "UPDATE desktop_project_setup SET state='outcome_unknown',updated_at=? WHERE request_key=?"
            )
            .run(new Date().toISOString(), row.request_key)
      })
      throw error
    } finally {
      this.busy.delete(initial.request_key)
    }
  }
  list(bindingId: string): DesktopProjectSetup[] {
    const parsed = uuid.safeParse(bindingId)
    if (!parsed.success) throw new DesktopProjectSetupError('PROJECT_REQUEST_INVALID')
    return this.db
      .prepare(
        `SELECT * FROM desktop_project_setup WHERE binding_id=? ORDER BY CASE WHEN state IN ('prepared','in_flight','outcome_unknown') THEN 0 ELSE 1 END,created_at DESC,request_key DESC LIMIT 100`
      )
      .all(parsed.data)
      .map((row) => this.metadata(this.valid(row)))
  }
  cancel(key: string): DesktopProjectSetup {
    return this.mutate(() => {
      const row = this.row(key)
      if (!['prepared', 'cancelled'].includes(row.state))
        throw new DesktopProjectSetupError('PROJECT_SETUP_CONFLICT')
      this.db
        .prepare(
          "UPDATE desktop_project_setup SET state='cancelled',updated_at=? WHERE request_key=?"
        )
        .run(new Date().toISOString(), row.request_key)
      return this.get(row.request_key)
    })
  }
  private authorize(
    bindingId: string,
    revision?: number,
    controllerId?: string
  ): { revision: number; controllerId: string } {
    const resolved = this.vault.resolve(bindingId),
      metadata = this.vault.get(bindingId)
    if (
      (revision !== undefined && revision !== resolved.revision) ||
      (controllerId !== undefined && controllerId !== resolved.controllerId)
    )
      throw new DesktopProjectSetupError('PROJECT_BINDING_CHANGED')
    if (
      !metadata.client?.scopes.includes('deploy:manual') ||
      !metadata.client.scopes.includes('policy:write')
    )
      throw new DesktopProjectSetupError('PROJECT_SCOPE_REQUIRED')
    return { revision: resolved.revision, controllerId: resolved.controllerId }
  }
  private get(key: string): DesktopProjectSetup {
    return this.metadata(this.row(key))
  }
  private row(key: string): Row {
    const parsed = uuid.safeParse(key)
    if (!parsed.success) throw new DesktopProjectSetupError('PROJECT_REQUEST_INVALID')
    return this.valid(
      this.db.prepare('SELECT * FROM desktop_project_setup WHERE request_key=?').get(parsed.data)
    )
  }
  private valid(input: unknown): Row {
    try {
      const row = rowSchema.parse(input),
        body = ProductProjectRegistration.normalize(JSON.parse(row.body_json))
      if (
        canonicalH2Json(body) !== row.body_json ||
        sha(row.body_json) !== row.body_sha256 ||
        body.request_key !== row.request_key ||
        body.controller_id !== row.controller_id ||
        body.target_vps_id !== row.target_vps_id ||
        body.expected_target_security_revision !== row.target_security_revision ||
        body.app_name !== row.app_name
      )
        throw new Error()
      if (row.state === 'registered') {
        const result = projectRegistrationResultSchema.parse(JSON.parse(row.result_json!))
        if (
          result.request_key !== row.request_key ||
          result.app_id !== row.app_id ||
          result.controller_id !== row.controller_id ||
          result.target_vps_id !== row.target_vps_id
        )
          throw new Error()
      } else if (row.result_json !== null || row.app_id !== null) throw new Error()
      return row
    } catch {
      throw new DesktopProjectSetupError('PROJECT_SETUP_UNAVAILABLE')
    }
  }
  private metadata(row: Row): DesktopProjectSetup {
    const body = ProductProjectRegistration.normalize(JSON.parse(row.body_json)),
      result = row.result_json
        ? projectRegistrationResultSchema.parse(JSON.parse(row.result_json))
        : null
    return {
      request_key: row.request_key,
      binding_id: row.binding_id,
      binding_revision: row.binding_revision,
      controller_id: row.controller_id,
      target_vps_id: row.target_vps_id,
      target_security_revision: row.target_security_revision,
      app_name: row.app_name,
      repository_url: body.repository_url,
      production_ref: body.production_ref,
      repository_root: body.repository_root,
      host_port: result?.host_port ?? body.host_port,
      container_port: body.container_port,
      healthcheck_path: body.healthcheck_path,
      state: row.state,
      app_id: row.app_id,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }
  private mutate<T>(work: () => T): T {
    if (this.db.inTransaction) throw new DesktopProjectSetupError('PROJECT_REQUEST_INVALID')
    return this.db.transaction(work).immediate()
  }
}
