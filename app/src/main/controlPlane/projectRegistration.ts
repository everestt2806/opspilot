import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type {
  ProductProjectRegistrationResult,
  ProductProjectTargetsResult
} from '../../../../docs/contracts/product-project-registration'
import type { ProductDispatchTargetBinding } from '../../../../docs/contracts/product-auto-deploy'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { AppRepository } from '../db/appRepository'
import { canonicalizeGitHubUrl, validateRef } from '../git/snapshot'
import { canonicalH2Json } from './productH2Proof'
import { decryptControllerCredential } from './controllerSecrets'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const projectRegistrationInputSchema = z.strictObject({
  format: z.literal(1),
  controller_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
  request_key: z.uuid().transform((value) => value.toLowerCase()),
  target_vps_id: positive,
  expected_target_security_revision: positive,
  app_name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}$/),
  framework: z.literal('express'),
  repository_url: z.string().min(1).max(2048),
  production_ref: z.string().min(1).max(255),
  repository_root: z.string().min(1).max(512),
  host_port: z.number().int().min(30000).max(30999).nullable(),
  container_port: z.number().int().min(1).max(65535),
  healthcheck_path: z
    .string()
    .min(1)
    .max(512)
    .regex(/^\/[A-Za-z0-9._~/-]*$/)
})
const inputSchema = projectRegistrationInputSchema
export const projectRegistrationResultSchema = z.strictObject({
  state: z.enum(['registered', 'already_registered']),
  controller_id: inputSchema.shape.controller_id,
  request_key: inputSchema.shape.request_key,
  app_id: positive,
  target_vps_id: positive,
  host_port: z.number().int().min(30000).max(30999),
  ownership_generation: z.literal(1),
  source_generation: z.literal(1),
  source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  auto_deploy_paused: z.literal(true),
  target_enrollment: z.literal('required'),
  runtime_preflight: z.literal('required'),
  source_verification: z.literal('required')
}) satisfies z.ZodType<ProductProjectRegistrationResult>
const resultSchema = projectRegistrationResultSchema
export const projectTargetSchema = z.strictObject({
  id: positive,
  name: z
    .string()
    .min(1)
    .max(128)
    .refine((value) => [...value].every((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127)),
  host: z.string().min(1).max(253),
  port: positive.max(65535),
  username: z.string().min(1).max(128),
  host_fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
  ssh_security_revision: positive
})
export const projectTargetsResultSchema = z.strictObject({
  controller_id: inputSchema.shape.controller_id,
  items: z.array(projectTargetSchema).max(50),
  next_after_id: positive.nullable(),
  has_more: z.boolean()
}) satisfies z.ZodType<ProductProjectTargetsResult>
type Input = z.output<typeof inputSchema>
type Stored = {
  body_json: string
  body_sha256: string
  app_id: number
  target_vps_id: number
  target_security_revision: number
  result_json: string
}
type Target = ProductDispatchTargetBinding & {
  crypto_scheme: string
  encrypted_secret: Buffer
  iv: Buffer
  auth_tag: Buffer
  archived_at: string | null
}
export class ProjectRegistrationError extends Error {
  constructor(
    readonly code:
      | 'PROJECT_REQUEST_INVALID'
      | 'PROJECT_CONTROLLER_UNAVAILABLE'
      | 'PROJECT_TARGET_UNAVAILABLE'
      | 'PROJECT_IDEMPOTENCY_CONFLICT'
      | 'PROJECT_REVIEW_REQUIRED'
      | 'PROJECT_NAME_CONFLICT'
      | 'PROJECT_PORT_CONFLICT'
      | 'PROJECT_PORT_EXHAUSTED'
      | 'PROJECT_STORAGE_UNAVAILABLE'
  ) {
    super(code)
  }
}
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
/** Quản trị cục bộ; không nhận administrator ID từ payload, không chạy SSH/Git. */
export class ProductProjectRegistration {
  constructor(
    private readonly db: Database.Database,
    private readonly controllerId: string,
    private readonly administratorId: string,
    private readonly cipher: AesGcmCredentialCipher
  ) {}

  register(input: unknown): ProductProjectRegistrationResult {
    try {
      if (this.db.inTransaction || !/^unix:(0|[1-9][0-9]{0,9})$/.test(this.administratorId))
        throw new ProjectRegistrationError('PROJECT_REQUEST_INVALID')
      const value = ProductProjectRegistration.normalize(input)
      if (value.controller_id !== this.controllerId)
        throw new ProjectRegistrationError('PROJECT_CONTROLLER_UNAVAILABLE')
      const { request_key, ...body } = value,
        serialized = canonicalH2Json(body),
        digest = sha256(serialized)
      return this.db
        .transaction(() => {
          const controllers = this.db
            .prepare('SELECT controller_id,status FROM product_controller')
            .all() as Array<{ controller_id: string; status: string }>
          if (
            controllers.length !== 1 ||
            controllers[0].controller_id !== this.controllerId ||
            controllers[0].status !== 'active'
          )
            throw new ProjectRegistrationError('PROJECT_CONTROLLER_UNAVAILABLE')
          const target = this.target(value.target_vps_id)
          if (target.ssh_security_revision !== value.expected_target_security_revision)
            throw new ProjectRegistrationError('PROJECT_TARGET_UNAVAILABLE')
          const previous = this.db
            .prepare(
              'SELECT * FROM product_project_registration WHERE controller_id=? AND administrator_id=? AND request_key=?'
            )
            .get(this.controllerId, this.administratorId, request_key) as Stored | undefined
          if (previous) {
            if (previous.body_json !== serialized || previous.body_sha256 !== digest)
              throw new ProjectRegistrationError('PROJECT_IDEMPOTENCY_CONFLICT')
            const result = resultSchema.safeParse(JSON.parse(previous.result_json))
            if (
              !result.success ||
              result.data.state !== 'registered' ||
              result.data.app_id !== previous.app_id ||
              result.data.target_vps_id !== previous.target_vps_id ||
              result.data.controller_id !== this.controllerId ||
              result.data.request_key !== request_key ||
              previous.target_security_revision !== target.ssh_security_revision ||
              previous.target_vps_id !== value.target_vps_id
            )
              throw new ProjectRegistrationError('PROJECT_REVIEW_REQUIRED')
            this.checkReplay(value, result.data)
            return { ...result.data, state: 'already_registered' as const }
          }
          if (
            this.db
              .prepare('SELECT 1 FROM app WHERE vps_id=? AND name=?')
              .get(value.target_vps_id, value.app_name)
          )
            throw new ProjectRegistrationError('PROJECT_NAME_CONFLICT')
          const port = value.host_port ?? this.allocatePort(value.target_vps_id)
          if (
            this.db
              .prepare('SELECT 1 FROM app WHERE vps_id=? AND host_port=?')
              .get(value.target_vps_id, port)
          )
            throw new ProjectRegistrationError('PROJECT_PORT_CONFLICT')
          const app = new AppRepository(this.db).create({
            vps_id: value.target_vps_id,
            name: value.app_name,
            framework: 'express',
            source_type: 'git',
            source_path: null,
            git_repo_url: value.repository_url,
            git_ref: value.production_ref,
            git_root: value.repository_root,
            host_port: port,
            container_port: value.container_port,
            healthcheck_path: value.healthcheck_path,
            needs_db: 0
          })
          const config = canonicalH2Json({
              framework: 'express',
              host_port: port,
              container_port: value.container_port,
              healthcheck_path: value.healthcheck_path,
              needs_db: false
            }),
            configHash = sha256(config),
            stamp = new Date().toISOString()
          this.db
            .prepare(
              'INSERT INTO product_source_config(app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at) VALUES(?,1,?,?,?,?,?,?)'
            )
            .run(
              app.id,
              value.repository_url,
              value.production_ref,
              value.repository_root,
              config,
              configHash,
              stamp
            )
          this.db
            .prepare(
              `INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,auto_deploy_paused,pause_reason,pause_policy_provenance)
          VALUES(?,'product',?,1,1,?,?,1,'operator','explicit')`
            )
            .run(app.id, this.controllerId, configHash, stamp)
          const result: ProductProjectRegistrationResult = {
            state: 'registered',
            controller_id: this.controllerId,
            request_key,
            app_id: app.id,
            target_vps_id: value.target_vps_id,
            host_port: port,
            ownership_generation: 1,
            source_generation: 1,
            source_config_sha256: configHash,
            auto_deploy_paused: true,
            target_enrollment: 'required',
            runtime_preflight: 'required',
            source_verification: 'required'
          }
          this.db
            .prepare(
              `INSERT INTO product_history_event(controller_id,app_id,kind,created_at,safe_summary_json) VALUES(?,?,'project_registered',?,?)`
            )
            .run(
              this.controllerId,
              app.id,
              stamp,
              JSON.stringify({
                app_id: app.id,
                target_vps_id: value.target_vps_id,
                source_generation: 1,
                auto_deploy_paused: true
              })
            )
          this.db
            .prepare(
              `INSERT INTO product_project_registration(controller_id,administrator_id,request_key,body_json,body_sha256,app_id,target_vps_id,target_security_revision,result_json,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`
            )
            .run(
              this.controllerId,
              this.administratorId,
              request_key,
              serialized,
              digest,
              app.id,
              value.target_vps_id,
              target.ssh_security_revision,
              JSON.stringify(result),
              stamp
            )
          return result
        })
        .immediate()
    } catch (error) {
      if (error instanceof ProjectRegistrationError) throw error
      throw new ProjectRegistrationError('PROJECT_STORAGE_UNAVAILABLE')
    }
  }
  static normalize(input: unknown): Input {
    try {
      const value = inputSchema.parse(input)
      validateRef(value.production_ref)
      if (
        value.production_ref.startsWith('refs/') ||
        /^[a-f0-9]{40}$/i.test(value.production_ref) ||
        value.production_ref
          .split('/')
          .some(
            (part) => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock')
          ) ||
        (value.repository_root !== '.' &&
          (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value.repository_root) ||
            value.repository_root
              .split('/')
              .some((part) => part === '.' || part === '..' || part === '.git')))
      )
        throw new Error()
      return { ...value, repository_url: canonicalizeGitHubUrl(value.repository_url) }
    } catch {
      throw new ProjectRegistrationError('PROJECT_REQUEST_INVALID')
    }
  }
  targets(input: unknown): ProductProjectTargetsResult {
    const common = { controller_id: inputSchema.shape.controller_id }
    const parsed = z
      .union([
        z.strictObject({ ...common, target_id: positive }),
        z.strictObject({ ...common, after_id: positive.nullable(), limit: positive.max(50) })
      ])
      .safeParse(input)
    if (!parsed.success || this.db.inTransaction)
      throw new ProjectRegistrationError('PROJECT_REQUEST_INVALID')
    const value = parsed.data
    return this.db.transaction(() => {
      const controllers = this.db
        .prepare('SELECT controller_id,status FROM product_controller')
        .all() as Array<{ controller_id: string; status: string }>
      if (
        value.controller_id !== this.controllerId ||
        controllers.length !== 1 ||
        controllers[0].controller_id !== this.controllerId ||
        controllers[0].status !== 'active'
      )
        throw new ProjectRegistrationError('PROJECT_CONTROLLER_UNAVAILABLE')
      const rows = (
        'target_id' in value
          ? this.db
              .prepare('SELECT id,name FROM vps WHERE id=? AND archived_at IS NULL')
              .all(value.target_id)
          : this.db
              .prepare(
                'SELECT id,name FROM vps WHERE id>? AND archived_at IS NULL ORDER BY id ASC LIMIT ?'
              )
              .all(value.after_id ?? 0, value.limit + 1)
      ) as Array<{ id: number; name: string }>
      const limit = 'target_id' in value ? 1 : value.limit,
        scanned = rows.slice(0, limit),
        items: ProductProjectTargetsResult['items'] = []
      for (const row of scanned) {
        try {
          const target = this.target(row.id),
            parsed = projectTargetSchema.safeParse({
              id: row.id,
              name: row.name,
              host: target.host,
              port: target.port,
              username: target.username,
              host_fingerprint: target.host_fingerprint,
              ssh_security_revision: target.ssh_security_revision
            })
          if (parsed.success) items.push(parsed.data)
        } catch {
          /* Không xuất profile không đủ pin/controller credential. */
        }
      }
      const has_more = rows.length > limit
      return {
        controller_id: this.controllerId,
        items,
        next_after_id: has_more ? scanned.at(-1)!.id : null,
        has_more
      }
    })()
  }
  private target(id: number): Target {
    try {
      const row = this.db
        .prepare(
          'SELECT id AS vps_id,host,port,username,auth_type,host_fingerprint,ssh_security_revision,archived_at,crypto_scheme,encrypted_secret,iv,auth_tag FROM vps WHERE id=?'
        )
        .get(id) as Target | undefined
      if (
        !row ||
        row.archived_at !== null ||
        row.crypto_scheme !== 'aes_256_gcm' ||
        !/^SHA256:[A-Za-z0-9+/]{43}$/.test(row.host_fingerprint) ||
        !Number.isSafeInteger(row.ssh_security_revision) ||
        row.ssh_security_revision < 1 ||
        !Number.isSafeInteger(row.port) ||
        row.port < 1 ||
        row.port > 65535 ||
        ![row.host, row.username].every(
          (part) =>
            typeof part === 'string' &&
            part.length >= 1 &&
            part.length <= 253 &&
            !/\s/.test(part) &&
            [...part].every(
              (character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127
            )
        ) ||
        row.username.length > 128 ||
        !['key', 'password'].includes(row.auth_type)
      )
        throw new Error()
      const { vps_id, host, port, username, auth_type, host_fingerprint, ssh_security_revision } =
        row
      decryptControllerCredential(
        this.cipher,
        {
          controller_id: this.controllerId,
          target: {
            vps_id,
            host,
            port,
            username,
            auth_type,
            host_fingerprint,
            ssh_security_revision
          }
        },
        {
          crypto_scheme: 'aes_256_gcm',
          encrypted_secret: row.encrypted_secret,
          iv: row.iv,
          auth_tag: row.auth_tag
        }
      )
      return row
    } catch {
      throw new ProjectRegistrationError('PROJECT_TARGET_UNAVAILABLE')
    }
  }
  private allocatePort(targetId: number): number {
    const rows = this.db
      .prepare('SELECT host_port FROM app WHERE vps_id=? AND host_port BETWEEN 30000 AND 30999')
      .all(targetId) as Array<{ host_port: number }>
    const used = new Set(rows.map((row) => row.host_port))
    for (let port = 30000; port <= 30999; port++) if (!used.has(port)) return port
    throw new ProjectRegistrationError('PROJECT_PORT_EXHAUSTED')
  }
  private checkReplay(value: Input, result: ProductProjectRegistrationResult): void {
    const row = this.db
      .prepare(
        `SELECT a.*, c.mode,c.controller_id,c.ownership_generation,c.source_generation,c.source_config_sha256,
      s.repository_url,s.production_ref,s.repository_root,s.config_sha256,s.deploy_config_json FROM app a JOIN product_app_control c ON c.app_id=a.id
      JOIN product_source_config s ON s.app_id=c.app_id AND s.source_generation=c.source_generation WHERE a.id=?`
      )
      .get(result.app_id) as Record<string, unknown> | undefined
    const config = canonicalH2Json({
      framework: 'express',
      host_port: result.host_port,
      container_port: value.container_port,
      healthcheck_path: value.healthcheck_path,
      needs_db: false
    })
    if (
      !row ||
      row.mode !== 'product' ||
      row.controller_id !== this.controllerId ||
      row.ownership_generation !== 1 ||
      row.source_generation !== 1 ||
      row.source_config_sha256 !== result.source_config_sha256 ||
      row.config_sha256 !== result.source_config_sha256 ||
      sha256(config) !== result.source_config_sha256 ||
      row.deploy_config_json !== config ||
      row.vps_id !== value.target_vps_id ||
      row.name !== value.app_name ||
      row.framework !== 'express' ||
      row.source_type !== 'git' ||
      row.needs_db !== 0 ||
      row.host_port !== result.host_port ||
      row.container_port !== value.container_port ||
      row.healthcheck_path !== value.healthcheck_path ||
      row.healthcheck_response_type !== 'status_2xx' ||
      row.source_path !== null ||
      row.imported_from_vps !== 0 ||
      row.git_repo_url !== value.repository_url ||
      row.git_ref !== value.production_ref ||
      row.git_root !== value.repository_root ||
      row.repository_url !== value.repository_url ||
      row.production_ref !== value.production_ref ||
      row.repository_root !== value.repository_root
    )
      throw new ProjectRegistrationError('PROJECT_REVIEW_REQUIRED')
  }
}
