import { z } from 'zod'
import { canonicalH2Json } from './productH2Proof'
import { postgresReferenceSchema } from './productPostgres'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const sourceEnvironmentReferenceSchema = z.strictObject({
  controller_id: z.string().min(1).max(128),
  ownership_generation: positive,
  revision: positive
})
export const productSourceConfigurationSchema = z
  .strictObject({
    framework: z.enum(['express', 'static-spa', 'nextjs']),
    host_port: positive.max(65535),
    container_port: positive.max(65535),
    healthcheck_path: z
      .string()
      .regex(/^\/[A-Za-z0-9_./-]{0,127}$/)
      .refine((value) => !value.includes('..')),
    needs_db: z.boolean(),
    environment: sourceEnvironmentReferenceSchema.optional(),
    database: postgresReferenceSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.needs_db !== !!value.database || (value.framework === 'static-spa' && value.database))
      ctx.addIssue({ code: 'custom', message: 'INVALID_MANAGED_DATABASE_SOURCE' })
  })
export type ProductSourceConfiguration = z.infer<typeof productSourceConfigurationSchema>
export type ProductSourceBasis = Pick<
  ProductSourceConfiguration,
  'framework' | 'host_port' | 'container_port' | 'healthcheck_path'
> & { needs_db: number }

/** Canonical shape only, never authorization to read a secret or dispatch SSH. */
export function readProductSourceConfiguration(
  basis: ProductSourceBasis,
  raw: string
): ProductSourceConfiguration {
  const value = productSourceConfigurationSchema.parse(JSON.parse(raw))
  if (
    canonicalH2Json(value) !== raw ||
    value.framework !== basis.framework ||
    value.host_port !== basis.host_port ||
    value.container_port !== basis.container_port ||
    value.healthcheck_path !== basis.healthcheck_path ||
    value.needs_db !== (basis.needs_db === 1)
  )
    throw Error('PRODUCT_SOURCE_CONFIGURATION_MISMATCH')
  return value
}
