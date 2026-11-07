import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type {
  DesktopControllerCommand,
  DesktopControllerCommandInput
} from '@shared/desktopControllerCommands'
import { ControllerHttpClient, ControllerHttpClientError } from './controllerHttpClient'
import type { SshManager } from '../ssh/manager'
import { DesktopControllerVault } from './desktopControllerVault'
import {
  controllerIdSchema,
  controllerRequestSchemas,
  controllerResponseSchemas,
  positive,
  requestKeySchema
} from './controllerHttpSchemas'
import { canonicalH2Json } from './productH2Proof'

const generations = {
  expected_ownership_generation: positive,
  expected_source_generation: positive
}
const base = { binding_id: requestKeySchema, app_id: positive, ...generations }
const inputSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    ...base,
    operation: z.literal('redeploy'),
    target: controllerRequestSchemas.redeploy.shape.target
  }),
  z.strictObject({ ...base, operation: z.literal('policy'), action: z.enum(['pause', 'resume']) })
])
const bodySchemas = {
  redeploy: controllerRequestSchemas.redeploy,
  // Không nhận note tự do vào journal vì có thể chứa secret.
  policy: z.strictObject({ ...generations, action: z.enum(['pause', 'resume']) })
}
const rowSchema = z.strictObject({
  request_key: requestKeySchema,
  binding_id: requestKeySchema,
  controller_id: controllerIdSchema,
  client_id: requestKeySchema,
  binding_revision: positive,
  app_id: positive,
  operation: z.enum(['redeploy', 'policy']),
  body_json: z.string().max(2048),
  body_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['prepared', 'in_flight', 'outcome_unknown', 'accepted', 'rejected', 'cancelled']),
  reason_code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,80}$/)
    .nullable(),
  remote_state: z.enum(['accepted', 'completed', 'blocked', 'uncertain']).nullable(),
  job_id: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/)
    .nullable(),
  target_sha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  auto_deploy_paused: z.union([z.literal(0), z.literal(1), z.null()]),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})
type Row = z.output<typeof rowSchema>
export class DesktopControllerCommandError extends Error {
  constructor(
    readonly code:
      | 'REQUEST_INVALID'
      | 'COMMAND_UNAVAILABLE'
      | 'COMMAND_PENDING'
      | 'BINDING_CHANGED'
      | 'SCOPE_REQUIRED'
      | 'PROTOCOL_INVALID'
  ) {
    super(code)
  }
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Ý định Desktop, không phải nguồn sự thật runtime. Không tự replay POST. */
export class DesktopControllerCommands {
  constructor(
    private readonly db: Database.Database,
    private readonly vault: DesktopControllerVault,
    private readonly ssh: Pick<SshManager, 'openControllerApiChannel'>,
    private readonly clientFactory?: (bindingId: string) => Pick<ControllerHttpClient, 'call'>
  ) {}

  prepare(input: DesktopControllerCommandInput): DesktopControllerCommand {
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) throw new DesktopControllerCommandError('REQUEST_INVALID')
    const value = parsed.data
    return this.mutate(() => {
      const binding = this.vault.resolve(value.binding_id),
        metadata = this.vault.get(value.binding_id),
        scope = value.operation === 'redeploy' ? 'deploy:manual' : 'policy:write'
      if (!metadata.client?.scopes.includes(scope))
        throw new DesktopControllerCommandError('SCOPE_REQUIRED')
      const body = {
        expected_ownership_generation: value.expected_ownership_generation,
        expected_source_generation: value.expected_source_generation,
        ...(value.operation === 'redeploy' ? { target: value.target } : { action: value.action })
      }
      const serialized = canonicalH2Json(body)
      const pending = this.db
        .prepare(
          `SELECT * FROM desktop_controller_command WHERE controller_id=? AND app_id=?
          AND state IN ('prepared','in_flight','outcome_unknown')`
        )
        .get(binding.controllerId, value.app_id)
      if (pending) {
        const row = this.valid(pending)
        if (
          row.state === 'prepared' &&
          row.binding_id === value.binding_id &&
          row.binding_revision === binding.revision &&
          row.client_id === metadata.remote_client_id &&
          row.operation === value.operation &&
          row.body_json === serialized
        )
          return this.metadata(row)
        throw new DesktopControllerCommandError('COMMAND_PENDING')
      }
      const key = randomUUID(),
        stamp = new Date().toISOString()
      this.db
        .prepare(
          `INSERT INTO desktop_controller_command(request_key,binding_id,controller_id,client_id,
          binding_revision,app_id,operation,body_json,body_sha256,state,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,'prepared',?,?)`
        )
        .run(
          key,
          value.binding_id,
          binding.controllerId,
          metadata.remote_client_id,
          binding.revision,
          value.app_id,
          value.operation,
          serialized,
          digest(serialized),
          stamp,
          stamp
        )
      return this.get(key)
    })
  }

  get(key: string): DesktopControllerCommand {
    return this.metadata(this.row(key))
  }
  list(bindingId: string): DesktopControllerCommand[] {
    if (!requestKeySchema.safeParse(bindingId).success)
      throw new DesktopControllerCommandError('REQUEST_INVALID')
    return this.db
      .prepare(
        `SELECT * FROM desktop_controller_command WHERE binding_id=?
        ORDER BY CASE WHEN state IN ('prepared','in_flight','outcome_unknown') THEN 0 ELSE 1 END,
        updated_at DESC,request_key DESC LIMIT 100`
      )
      .all(bindingId.toLowerCase())
      .map((row) => this.metadata(this.valid(row)))
  }
  cancel(key: string): DesktopControllerCommand {
    return this.mutate(() => {
      const row = this.row(key)
      if (row.state !== 'prepared' && row.state !== 'cancelled')
        throw new DesktopControllerCommandError('COMMAND_PENDING')
      this.update(row, 'cancelled', null)
      return this.get(row.request_key)
    })
  }

  async send(key: string): Promise<DesktopControllerCommand> {
    const claimed = this.mutate(() => {
      const row = this.row(key)
      if (row.state !== 'prepared') return null
      this.authorize(row, true)
      this.update(row, 'in_flight', null)
      return row
    })
    if (!claimed) return this.get(key) // Không POST lần hai, kể cả process mới.
    const row = claimed
    try {
      const client = this.client(row)
      const body = JSON.parse(row.body_json)
      const result =
        row.operation === 'redeploy'
          ? await client.call('redeploy', {
              app_id: row.app_id,
              request_key: row.request_key,
              body: bodySchemas.redeploy.parse(body)
            })
          : await client.call('policy', {
              app_id: row.app_id,
              request_key: row.request_key,
              body: bodySchemas.policy.parse(body)
            })
      this.authorize(row, true)
      if (result.state !== 'response_received') {
        this.unknown(row, 'RESPONSE_LOST')
      } else {
        const response = controllerResponseSchemas[row.operation].safeParse(result.response)
        if (
          !response.success ||
          response.data.controller_id !== row.controller_id ||
          response.data.app_id !== row.app_id ||
          ('target_sha' in response.data &&
            body.target.kind === 'specific_sha' &&
            body.target.sha !== response.data.target_sha) ||
          (row.operation === 'policy' &&
            response.data.auto_deploy_paused !== (body.action === 'pause'))
        )
          throw new DesktopControllerCommandError('PROTOCOL_INVALID')
        const data = response.data
        this.finish(row, {
          remote_state: row.operation === 'redeploy' ? 'accepted' : 'completed',
          job_id: 'job_id' in data ? data.job_id : null,
          target_sha: 'target_sha' in data ? data.target_sha : null,
          auto_deploy_paused: data.auto_deploy_paused ? 1 : 0
        })
      }
    } catch (error) {
      // Chỉ 4xx đã được client xác thực mới chứng minh từ chối; lỗi khác giữ unknown.
      const definitive =
        error instanceof ControllerHttpClientError &&
        error.httpStatus !== null &&
        error.httpStatus >= 400 &&
        error.httpStatus < 500
      const reason =
        error instanceof ControllerHttpClientError || error instanceof DesktopControllerCommandError
          ? error.code
          : 'BINDING_UNAVAILABLE'
      this.mutate(() => {
        const current = this.row(key)
        if (current.state !== 'in_flight' && current.state !== 'outcome_unknown') return
        // Lookup đồng thời có thể đã xác nhận accepted; không ghi đè bằng lỗi đến muộn.
        if (definitive && current.state === 'in_flight') this.update(current, 'rejected', reason)
        else this.update(current, 'outcome_unknown', reason)
      })
    }
    return this.get(key)
  }

  async check(key: string): Promise<DesktopControllerCommand> {
    const row = this.row(key)
    if (['prepared', 'cancelled', 'rejected'].includes(row.state)) return this.metadata(row)
    this.authorize(row, false)
    // Crash trước/sau network không phân biệt được; không cấp quyền POST lại.
    if (row.state === 'in_flight') this.unknown(row, 'RESPONSE_LOST')
    const result = await this.client(row).call('lookup', { request_key: row.request_key })
    this.authorize(row, false)
    if (result.state !== 'response_received')
      throw new DesktopControllerCommandError('PROTOCOL_INVALID')
    const checked = controllerResponseSchemas.lookup.safeParse(result.response)
    if (!checked.success || checked.data.controller_id !== row.controller_id)
      throw new DesktopControllerCommandError('PROTOCOL_INVALID')
    if (!checked.data.found) return this.get(key) // Không thấy không có nghĩa chưa nhận.
    const status = checked.data.status,
      body = JSON.parse(row.body_json),
      action =
        row.operation === 'redeploy'
          ? 'manual_redeploy'
          : body.action === 'pause'
            ? 'pause_auto_deploy'
            : 'resume_auto_deploy'
    if (
      status.request_key !== row.request_key ||
      status.app_id !== row.app_id ||
      status.action !== action ||
      status.ownership_generation !== body.expected_ownership_generation ||
      status.source_generation !== body.expected_source_generation ||
      (row.job_id !== null && row.job_id !== status.job_id) ||
      (row.operation === 'redeploy' ? status.job_id === null : status.job_id !== null)
    )
      throw new DesktopControllerCommandError('PROTOCOL_INVALID')
    this.finish(row, { remote_state: status.state, job_id: status.job_id }, status.reason_code)
    return this.get(key)
  }

  private authorize(row: Row, write: boolean): void {
    const resolved = this.vault.resolve(row.binding_id),
      metadata = this.vault.get(row.binding_id)
    if (
      resolved.controllerId !== row.controller_id ||
      resolved.revision !== row.binding_revision ||
      metadata.remote_client_id !== row.client_id
    )
      throw new DesktopControllerCommandError('BINDING_CHANGED')
    const scope = write ? (row.operation === 'redeploy' ? 'deploy:manual' : 'policy:write') : 'read'
    if (!metadata.client?.scopes.includes(scope))
      throw new DesktopControllerCommandError('SCOPE_REQUIRED')
  }
  private client(row: Row): Pick<ControllerHttpClient, 'call'> {
    return (
      this.clientFactory?.(row.binding_id) ??
      new ControllerHttpClient(this.ssh, () => {
        this.authorize(row, false)
        return this.vault.resolve(row.binding_id)
      })
    )
  }
  private finish(
    row: Row,
    summary: Partial<Pick<Row, 'remote_state' | 'job_id' | 'target_sha' | 'auto_deploy_paused'>>,
    reason: string | null = null
  ): void {
    this.mutate(() => {
      const current = this.row(row.request_key)
      if (!['in_flight', 'outcome_unknown', 'accepted'].includes(current.state))
        throw new DesktopControllerCommandError('COMMAND_PENDING')
      if (current.job_id && summary.job_id && current.job_id !== summary.job_id)
        throw new DesktopControllerCommandError('PROTOCOL_INVALID')
      if (current.target_sha && summary.target_sha && current.target_sha !== summary.target_sha)
        throw new DesktopControllerCommandError('PROTOCOL_INVALID')
      if (
        current.remote_state === 'completed' ||
        (current.remote_state === 'blocked' && summary.remote_state === 'accepted') ||
        (current.remote_state === 'uncertain' && summary.remote_state === 'accepted')
      )
        return // Không hạ kết quả lookup đã xác nhận vì HTTP response cũ đến muộn.
      const data = { ...current, ...summary }
      this.db
        .prepare(
          `UPDATE desktop_controller_command SET state='accepted',reason_code=?,remote_state=?,
          job_id=?,target_sha=?,auto_deploy_paused=?,updated_at=? WHERE request_key=?`
        )
        .run(
          reason,
          data.remote_state,
          data.job_id,
          data.target_sha,
          data.auto_deploy_paused,
          new Date().toISOString(),
          row.request_key
        )
    })
  }
  private unknown(row: Row, reason: string): void {
    this.mutate(() => {
      const current = this.row(row.request_key)
      if (current.state === 'in_flight' || current.state === 'outcome_unknown')
        this.update(current, 'outcome_unknown', reason)
    })
  }
  private update(row: Row, state: Row['state'], reason: string | null): void {
    this.db
      .prepare(
        'UPDATE desktop_controller_command SET state=?,reason_code=?,updated_at=? WHERE request_key=?'
      )
      .run(state, reason, new Date().toISOString(), row.request_key)
  }
  private valid(value: unknown): Row {
    try {
      const row = rowSchema.parse(value),
        body = bodySchemas[row.operation].parse(JSON.parse(row.body_json))
      if (canonicalH2Json(body) !== row.body_json || digest(row.body_json) !== row.body_sha256)
        throw new Error()
      return row
    } catch {
      throw new DesktopControllerCommandError('COMMAND_UNAVAILABLE')
    }
  }
  private row(key: string): Row {
    const parsed = requestKeySchema.safeParse(key)
    if (!parsed.success) throw new DesktopControllerCommandError('REQUEST_INVALID')
    return this.valid(
      this.db
        .prepare('SELECT * FROM desktop_controller_command WHERE request_key=?')
        .get(parsed.data)
    )
  }
  private metadata(row: Row): DesktopControllerCommand {
    return {
      request_key: row.request_key,
      binding_id: row.binding_id,
      controller_id: row.controller_id,
      client_id: row.client_id,
      binding_revision: row.binding_revision,
      app_id: row.app_id,
      operation: row.operation,
      state: row.state,
      reason_code: row.reason_code,
      remote_state: row.remote_state,
      job_id: row.job_id,
      target_sha: row.target_sha,
      created_at: row.created_at,
      updated_at: row.updated_at,
      auto_deploy_paused: row.auto_deploy_paused === null ? null : row.auto_deploy_paused === 1
    }
  }
  private mutate<T>(work: () => T): T {
    if (this.db.inTransaction) throw new DesktopControllerCommandError('REQUEST_INVALID')
    return this.db.transaction(work).immediate()
  }
}
