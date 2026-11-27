import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type {
  ProductProjectReconnectionInput,
  ProductProjectReconnectionContext
} from '../../../../docs/contracts/product-project-reconnection'
import { canonicalizeGitHubUrl, validateRef } from '../git/snapshot'
import { canonicalH2Json } from './productH2Proof'
import { environmentScopeSchema, environmentMetadataSchema } from './productEnvironment'
import { postgresMetadataSchema } from './productPostgres'
import { ProductEnvironmentPreflight } from './productEnvironmentPreflight'
import { ProductPostgresPreflight } from './productPostgresPreflight'
import { ProductProjectRegistration, projectRegistrationInputSchema } from './projectRegistration'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import {
  productSourceConfigurationSchema,
  readProductSourceConfiguration,
  type ProductSourceBasis
} from './productSourceConfiguration'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const digest = (value: unknown): string =>
  createHash('sha256').update(canonicalH2Json(value)).digest('hex')

export const projectReconnectionInputSchema = z.strictObject({
  format: z.literal(1),
  controller_id: environmentScopeSchema.shape.controller_id,
  app_id: positive,
  expected_snapshot_sha256: hash.optional()
}) satisfies z.ZodType<ProductProjectReconnectionInput>

function publicGit(value: {
  repository_url: string
  production_ref: string
  repository_root: string
}): void {
  projectRegistrationInputSchema.shape.repository_url.parse(value.repository_url)
  projectRegistrationInputSchema.shape.production_ref.parse(value.production_ref)
  projectRegistrationInputSchema.shape.repository_root.parse(value.repository_root)
  if (canonicalizeGitHubUrl(value.repository_url) !== value.repository_url) throw Error()
  validateRef(value.production_ref)
  if (
    value.production_ref.startsWith('refs/') ||
    /^[a-f0-9]{40}$/i.test(value.production_ref) ||
    value.production_ref
      .split('/')
      .some((p) => !p || p.startsWith('.') || p.endsWith('.') || p.endsWith('.lock')) ||
    (value.repository_root !== '.' &&
      (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value.repository_root) ||
        value.repository_root.split('/').some((p) => ['.', '..', '.git'].includes(p))))
  )
    throw Error()
}

export const projectReconnectionContextSchema = z
  .strictObject({
    state: z.literal('review_required'),
    controller_id: environmentScopeSchema.shape.controller_id,
    app_id: positive,
    app_name: projectRegistrationInputSchema.shape.app_name,
    scope: environmentScopeSchema,
    source: z.strictObject({
      generation: positive,
      config_sha256: hash,
      repository_url: projectRegistrationInputSchema.shape.repository_url,
      production_ref: projectRegistrationInputSchema.shape.production_ref,
      repository_root: projectRegistrationInputSchema.shape.repository_root,
      configuration: productSourceConfigurationSchema
    }),
    selected_environment: environmentMetadataSchema.nullable(),
    selected_database: postgresMetadataSchema.nullable(),
    auto_deploy_paused: z.boolean(),
    snapshot_sha256: hash,
    consent_required: z.literal(true),
    desktop_authority: z.literal('not_granted'),
    runtime_status: z.literal('not_checked')
  })
  .superRefine((value, ctx) => {
    const { snapshot_sha256, ...body } = value
    const config = value.source.configuration
    const env = value.selected_environment
    const pg = value.selected_database
    let validGit = true
    try {
      publicGit(value.source)
    } catch {
      validGit = false
    }
    if (
      !validGit ||
      digest(body) !== snapshot_sha256 ||
      digest(config) !== value.source.config_sha256 ||
      value.controller_id !== value.scope.controller_id ||
      value.app_id !== value.scope.app_id ||
      !!env !== !!config.environment ||
      !!pg !== !!config.database ||
      [env, pg].some(
        (m) =>
          m &&
          (m.controller_id !== value.controller_id ||
            m.app_id !== value.app_id ||
            m.ownership_generation !== value.scope.ownership_generation ||
            m.framework !== config.framework)
      ) ||
      (env &&
        (config.environment?.controller_id !== env.controller_id ||
          config.environment.ownership_generation !== env.ownership_generation ||
          config.environment.revision !== env.revision)) ||
      (pg &&
        (config.database?.controller_id !== pg.controller_id ||
          config.database.ownership_generation !== pg.ownership_generation ||
          config.database.database_id !== pg.database_id))
    )
      ctx.addIssue({ code: 'custom', message: 'PROJECT_RECONNECTION_SNAPSHOT_INVALID' })
  }) satisfies z.ZodType<ProductProjectReconnectionContext>

export class ProjectReconnectionError extends Error {
  constructor(
    readonly code:
      | 'PROJECT_RECONNECTION_INPUT_INVALID'
      | 'PROJECT_RECONNECTION_AUTHORITY_CHANGED'
      | 'PROJECT_RECONNECTION_UNAVAILABLE'
  ) {
    super(code)
  }
}

type Row = ProductSourceBasis & {
  app_name: string
  vps_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  auto_deploy_paused: number
  repository_url: string
  production_ref: string
  repository_root: string
  git_repo_url: string
  git_ref: string
  git_root: string
  source_type: string
  source_path: string | null
  imported_from_vps: number
  deploy_config_json: string
  config_sha256: string
}

/** Current authority preview only. Historical Desktop receipts are neither read
 * nor created. Re-read immutable/monotonic source and complete target after each
 * independent authenticated metadata review; never hold a transaction over I/O.
 */
export function readProjectReconnectionContext(
  db: Database.Database,
  cipher: AesGcmCredentialCipher,
  controllerId: string,
  administratorId: string,
  input: unknown
): ProductProjectReconnectionContext {
  const changed = (): never => {
    throw new ProjectReconnectionError('PROJECT_RECONNECTION_AUTHORITY_CHANGED')
  }
  if (db.inTransaction) throw new ProjectReconnectionError('PROJECT_RECONNECTION_INPUT_INVALID')
  const parsed = projectReconnectionInputSchema.safeParse(input)
  if (!parsed.success) throw new ProjectReconnectionError('PROJECT_RECONNECTION_INPUT_INVALID')
  const request = parsed.data
  if (request.controller_id !== controllerId) return changed()
  try {
    const read = (): Omit<
      ProductProjectReconnectionContext,
      'selected_environment' | 'selected_database' | 'snapshot_sha256'
    > =>
      db.transaction(
        (): Omit<
          ProductProjectReconnectionContext,
          'selected_environment' | 'selected_database' | 'snapshot_sha256'
        > => {
          const row = db
            .prepare(
              `SELECT a.name app_name,a.vps_id,a.framework,a.host_port,a.container_port,
        a.healthcheck_path,a.needs_db,a.source_type,a.source_path,a.imported_from_vps,a.git_repo_url,a.git_ref,a.git_root,
        c.ownership_generation,c.source_generation,c.source_config_sha256,c.auto_deploy_paused,s.*
        FROM product_app_control c JOIN app a ON a.id=c.app_id
        JOIN product_controller pc ON pc.controller_id=c.controller_id AND pc.status='active'
        JOIN product_source_config s ON s.app_id=c.app_id AND s.source_generation=c.source_generation
        WHERE c.controller_id=? AND c.app_id=? AND c.mode='product'`
            )
            .get(controllerId, request.app_id) as Row | undefined
          if (
            !row ||
            row.source_type !== 'git' ||
            row.source_path !== null ||
            row.imported_from_vps !== 0 ||
            row.config_sha256 !== row.source_config_sha256 ||
            Buffer.byteLength(row.deploy_config_json) > 65536 ||
            row.git_repo_url !== row.repository_url ||
            row.git_ref !== row.production_ref ||
            row.git_root !== row.repository_root
          )
            return changed()
          publicGit(row)
          const config = readProductSourceConfiguration(row, row.deploy_config_json)
          if (digest(config) !== row.config_sha256) return changed()
          const scope = environmentScopeSchema.parse({
            controller_id: controllerId,
            app_id: request.app_id,
            ownership_generation: row.ownership_generation,
            target: new TargetEnrollmentRepository(db).target(
              controllerId,
              request.app_id,
              row.ownership_generation,
              false
            )
          })
          return {
            state: 'review_required',
            controller_id: controllerId,
            app_id: request.app_id,
            app_name: row.app_name,
            scope,
            source: {
              generation: row.source_generation,
              config_sha256: row.config_sha256,
              repository_url: row.repository_url,
              production_ref: row.production_ref,
              repository_root: row.repository_root,
              configuration: config
            },
            auto_deploy_paused: row.auto_deploy_paused === 1,
            consent_required: true,
            desktop_authority: 'not_granted',
            runtime_status: 'not_checked'
          }
        }
      )()
    const before = read()
    const assertTarget = (): void => {
      const target = new ProductProjectRegistration(
        db,
        controllerId,
        administratorId,
        cipher
      ).targets({ controller_id: controllerId, target_id: before.scope.target.vps_id }).items[0]
      if (!target) return changed()
      const identity = Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'name'))
      const expected = before.scope.target
      // The verified target-list DTO deliberately omits auth_type. Its existing
      // reader authenticates the full credential binding; compare only its
      // public projection here, then re-read the complete binding below.
      if (
        canonicalH2Json(identity) !==
        canonicalH2Json({
          id: expected.vps_id,
          host: expected.host,
          port: expected.port,
          username: expected.username,
          host_fingerprint: expected.host_fingerprint,
          ssh_security_revision: expected.ssh_security_revision
        })
      )
        return changed()
    }
    assertTarget()
    const authority = {
      format: 1 as const,
      controller_id: controllerId,
      app_id: request.app_id,
      expected_ownership_generation: before.scope.ownership_generation,
      expected_source_generation: before.source.generation,
      expected_source_config_sha256: before.source.config_sha256,
      expected_target_security_revision: before.scope.target.ssh_security_revision
    }
    const env = ProductEnvironmentPreflight.reviewForInspection(db, authority, cipher)
    const pg = ProductPostgresPreflight.reviewForInspection(db, authority, cipher)
    assertTarget()
    if (canonicalH2Json(before) !== canonicalH2Json(read())) return changed()
    const body = {
      ...before,
      selected_environment: env?.metadata ?? null,
      selected_database: pg?.metadata ?? null
    }
    const snapshot_sha256 = digest(body)
    if (request.expected_snapshot_sha256 && request.expected_snapshot_sha256 !== snapshot_sha256)
      return changed()
    return projectReconnectionContextSchema.parse({ ...body, snapshot_sha256 })
  } catch (error) {
    if (error instanceof ProjectReconnectionError) throw error
    throw new ProjectReconnectionError('PROJECT_RECONNECTION_UNAVAILABLE')
  }
}
