import { z } from 'zod'
import type {
  ProductEnvironmentScope,
  ProductEnvironmentStageInput,
  ProductEnvironmentStateInput,
  ProductEnvironmentValues,
  ProductEnvironmentWriteInput
} from '../../../../docs/contracts/product-environment'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)
const text = z.string().min(1).max(253)
export const environmentScopeSchema = z.strictObject({
  controller_id: identifier,
  app_id: positive,
  ownership_generation: positive,
  target: z.strictObject({
    vps_id: positive,
    host: text,
    port: positive.max(65535),
    host_fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
    username: text.max(128),
    auth_type: z.enum(['key', 'password']),
    ssh_security_revision: positive
  })
}) satisfies z.ZodType<ProductEnvironmentScope>
const valuesSchema = z.strictObject({
  runtime_env: z.record(z.string(), z.string()),
  public_build_args: z.record(z.string(), z.string())
}) satisfies z.ZodType<ProductEnvironmentValues>
export const environmentWriteSchema = z.strictObject({
  scope: environmentScopeSchema,
  expected_latest_revision: positive.nullable(),
  expected_source_generation: positive,
  expected_source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  values: valuesSchema
}) satisfies z.ZodType<ProductEnvironmentWriteInput>
const requestKey = z.uuidv4().refine((v) => v === v.toLowerCase())
export const environmentStageSchema = environmentWriteSchema.extend({
  format: z.literal(1),
  request_key: requestKey
}) satisfies z.ZodType<ProductEnvironmentStageInput>
export const environmentStateSchema = environmentWriteSchema
  .pick({ scope: true, expected_source_generation: true, expected_source_config_sha256: true })
  .extend({
    format: z.literal(1),
    request_key: requestKey.nullable()
  }) satisfies z.ZodType<ProductEnvironmentStateInput>

export class ProductEnvironmentError extends Error {
  constructor(
    readonly code:
      | 'PRODUCT_ENVIRONMENT_INPUT_INVALID'
      | 'PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED'
      | 'PRODUCT_ENVIRONMENT_SOURCE_CHANGED'
      | 'PRODUCT_ENVIRONMENT_REVISION_CONFLICT'
      | 'PRODUCT_ENVIRONMENT_IDEMPOTENCY_CONFLICT'
      | 'PRODUCT_ENVIRONMENT_UNAVAILABLE'
      | 'PRODUCT_ENVIRONMENT_STORAGE_UNAVAILABLE'
  ) {
    super(code)
    this.name = 'ProductEnvironmentError'
  }
}

/** Không parse dotenv/interpolate hoặc tự đưa secret sang public build scope. */
export function validateEnvironmentValues(
  input: unknown,
  framework: 'express' | 'static-spa' | 'nextjs'
): ProductEnvironmentValues {
  const parsed = valuesSchema.safeParse(input)
  if (!parsed.success) throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
  const entries = [
    ...Object.entries(parsed.data.runtime_env),
    ...Object.entries(parsed.data.public_build_args)
  ]
  const invalid =
    entries.length > 128 ||
    Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > 65536 ||
    entries.some(
      ([key, value]) =>
        !/^[A-Z_][A-Z0-9_]{0,127}$/.test(key) ||
        Buffer.byteLength(value, 'utf8') > 8192 ||
        [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
  const reserved = (key: string): boolean =>
    ['PORT', 'NODE_ENV', 'NODE_OPTIONS', 'PATH', 'HOME', 'DATABASE_URL'].includes(key) ||
    /^(?:LD_|NPM_CONFIG_|OPSPILOT_|DOCKER_|COMPOSE_|POSTGRES_)/.test(key)
  if (
    invalid ||
    Object.keys(parsed.data.runtime_env).some(
      (key) => reserved(key) || /^(?:VITE_|NEXT_PUBLIC_)/.test(key)
    ) ||
    Object.keys(parsed.data.public_build_args).some(
      (key) =>
        framework === 'express' ||
        !key.startsWith(framework === 'nextjs' ? 'NEXT_PUBLIC_' : 'VITE_')
    )
  )
    throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
  return parsed.data
}
