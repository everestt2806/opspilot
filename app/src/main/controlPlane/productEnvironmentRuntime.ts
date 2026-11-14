import { createHash, createHmac, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import type { ResolvedProductEnvironment } from '../../../../docs/contracts/product-environment-runtime'
import {
  PRODUCT_ENVIRONMENT_HEADER,
  PRODUCT_ENVIRONMENT_MARKER,
  PRODUCT_ENVIRONMENT_SIGNATURE
} from '../../../../docs/contracts/product-environment-runtime'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type { ProductDeployRepository } from '../db/productDeployRepository'
import { ProductEnvironmentRepository } from '../db/productEnvironmentRepository'
import { canonicalH2Json } from './productH2Proof'
import { ProductEnvironmentError, validateEnvironmentValues } from './productEnvironment'
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const referenceSchema = z.strictObject({
  controller_id: z.string().min(1).max(128),
  ownership_generation: positive,
  revision: positive
})

/** Capability chỉ do trusted controller tạo, không nhận values/scope tùy ý qua IPC. */
export class ProductEnvironmentRuntime {
  private readonly claim: ProductClaimToken
  private readonly vault: ProductEnvironmentRepository
  constructor(
    private readonly db: Database.Database,
    private readonly repository: ProductDeployRepository,
    cipher: AesGcmCredentialCipher,
    claim: ProductClaimToken,
    private readonly runtimeKey?: (claim: ProductClaimToken) => Buffer
  ) {
    this.claim = structuredClone(claim)
    this.vault = new ProductEnvironmentRepository(db, cipher)
  }
  resolve(deploymentId?: number): ResolvedProductEnvironment | null {
    if (this.db.inTransaction)
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
    try {
      const before = this.authority(deploymentId)
      const source = this.db
        .prepare(
          'SELECT deploy_config_json,config_sha256 FROM product_source_config WHERE app_id=? AND source_generation=?'
        )
        .get(this.claim.app_id, this.claim.source_generation) as
        { deploy_config_json: string; config_sha256: string } | undefined
      if (!source || source.config_sha256 !== this.claim.source_config_sha256) throw Error()
      const config = JSON.parse(source.deploy_config_json)
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error()
      if (!Object.hasOwn(config, 'environment')) {
        this.authority(deploymentId)
        return null
      }
      const reference = referenceSchema.parse(config.environment)
      if (
        createHash('sha256').update(canonicalH2Json(config)).digest('hex') !==
          source.config_sha256 ||
        reference.controller_id !== this.claim.controller_id ||
        reference.ownership_generation !== this.claim.ownership_generation
      )
        throw Error()
      const binding = this.db
        .prepare(
          `SELECT controller_id,ownership_generation,environment_revision,target_binding_json,source_config_sha256
        FROM product_source_environment WHERE app_id=? AND source_generation=?`
        )
        .get(this.claim.app_id, this.claim.source_generation) as
        | {
            controller_id: string
            ownership_generation: number
            environment_revision: number
            target_binding_json: string
            source_config_sha256: string
          }
        | undefined
      if (
        !binding ||
        binding.controller_id !== reference.controller_id ||
        binding.ownership_generation !== reference.ownership_generation ||
        binding.environment_revision !== reference.revision ||
        binding.source_config_sha256 !== source.config_sha256 ||
        binding.target_binding_json !== canonicalH2Json(before)
      )
        throw Error()
      const scope = {
        controller_id: this.claim.controller_id,
        app_id: this.claim.app_id,
        ownership_generation: this.claim.ownership_generation,
        target: before
      }
      const metadata = this.vault.metadata(scope, reference.revision)
      const values = this.vault.readValues(scope, reference.revision)
      if (
        config.framework !== metadata.framework ||
        canonicalH2Json(this.authority(deploymentId)) !== canonicalH2Json(before)
      )
        throw Error()
      if (!this.runtimeKey) throw Error()
      return {
        claim: structuredClone(this.claim),
        target: before,
        reference,
        framework: metadata.framework,
        values,
        signRuntime: (payload: string): string => {
          const raw = this.runtimeKey!(structuredClone(this.claim))
          let key: Buffer | undefined
          try {
            if (raw.length !== 32) throw Error()
            key = createHmac('sha256', raw).update('opspilot-env-transfer-key-v1').digest()
            return createHmac('sha256', key)
              .update('opspilot-env-transfer-v1\n')
              .update(payload, 'utf8')
              .digest('hex')
          } finally {
            raw.fill(0)
            key?.fill(0)
          }
        }
      }
    } catch {
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    }
  }
  private authority(deploymentId?: number): ResolvedProductEnvironment['target'] {
    const target = this.repository.readGitDispatchTargetBinding(this.claim, deploymentId)
    if (
      target.state !== 'ready' ||
      (deploymentId === undefined
        ? this.repository.readGitSnapshotAuthority(this.claim).state !== 'ready'
        : this.repository.readGitDispatchSessionAuthority(this.claim, deploymentId) !== 'ready')
    )
      throw Error()
    return target.binding
  }
}

/** Docker --env-file literal: không quote/interpolate, nonce riêng tư để blind transfer hash. */
export function renderProductRuntimeEnv(configuration: ResolvedProductEnvironment): string {
  const values = validateEnvironmentValues(configuration.values, configuration.framework)
  if (
    Object.values(values.runtime_env).some(
      (value) => Buffer.from(value, 'utf8').toString('utf8') !== value
    )
  )
    throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
  const header = {
    format: 1,
    claim: configuration.claim,
    target: configuration.target,
    reference: configuration.reference,
    nonce: randomBytes(32).toString('hex'),
    runtime_keys: Object.keys(values.runtime_env).sort()
  }
  const marker = [
    configuration.reference.controller_id,
    configuration.reference.ownership_generation,
    configuration.reference.revision,
    configuration.claim.source_generation
  ].join(':')
  const first = PRODUCT_ENVIRONMENT_HEADER + canonicalH2Json(header) + '\n'
  const body =
    PRODUCT_ENVIRONMENT_MARKER +
    '=' +
    marker +
    '\n' +
    Object.entries(values.runtime_env)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}\n`)
      .join('')
  const signature = configuration.signRuntime(first + body)
  if (!/^[a-f0-9]{64}$/.test(signature))
    throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
  const content = first + PRODUCT_ENVIRONMENT_SIGNATURE + signature + '\n' + body
  if (Buffer.byteLength(content) > 96 * 1024)
    throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
  return content
}
/** Public-only Dockerfile literals; runtime values never enter this function. */
export function renderProductPublicBuild(values: Record<string, string>): string {
  const next = Object.keys(values).every((key) => key.startsWith('NEXT_PUBLIC_'))
  const validated = validateEnvironmentValues(
    { runtime_env: {}, public_build_args: values },
    next ? 'nextjs' : 'static-spa'
  ).public_build_args
  const literal = (s: string): string =>
    s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$')
  return Object.entries(validated)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => {
      if (
        !/^(?:NEXT_PUBLIC_|VITE_)[A-Z0-9_]*$/.test(k) ||
        Buffer.from(v, 'utf8').toString('utf8') !== v ||
        [...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
      )
        throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
      return `ENV ${k}="${literal(v)}"`
    })
    .join('\n')
}
