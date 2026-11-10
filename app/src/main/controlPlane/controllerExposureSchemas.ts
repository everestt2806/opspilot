import { z } from 'zod'
import type {
  ProductExposureContext,
  ProductExposureObservation,
  ProductExposureObservationInput,
  ProductExposureView
} from '../../../../docs/contracts/product-exposure'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const uuid = z.uuid().transform((v) => v.toLowerCase())
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const status = z.enum(['reachable', 'degraded', 'not_checked'])
export const exposureInputSchema = z
  .strictObject({
    deployment_id: positive,
    authority_sha256: sha,
    previous_observation_id: uuid.nullable(),
    observer: z.literal('desktop_external'),
    started_at: z.iso.datetime(),
    checked_at: z.iso.datetime(),
    outcome: z.enum(['reachable', 'unreachable', 'not_run']),
    http_status: z.number().int().min(100).max(599).nullable(),
    reason: z.enum([
      'none',
      'timeout',
      'connection_error',
      'http_error',
      'redirect',
      'unsafe_target',
      'aborted'
    ])
  })
  .refine((v) => {
    if (v.outcome === 'reachable')
      return (
        v.http_status !== null && v.http_status >= 200 && v.http_status < 300 && v.reason === 'none'
      )
    if (v.outcome === 'not_run')
      return v.http_status === null && ['unsafe_target', 'aborted'].includes(v.reason)
    if (v.http_status === null) return ['timeout', 'connection_error'].includes(v.reason)
    if (v.http_status >= 300 && v.http_status < 400) return v.reason === 'redirect'
    return v.http_status >= 400 && v.reason === 'http_error'
  }) satisfies z.ZodType<ProductExposureObservationInput>
export const exposureContextSchema = z.strictObject({
  app_id: positive,
  deployment_id: positive,
  authority_sha256: sha,
  previous_observation_id: uuid.nullable(),
  url: z.string().min(1).max(512)
}) satisfies z.ZodType<ProductExposureContext>
export const exposureObservationSchema = z.strictObject({
  ...exposureInputSchema.shape,
  format: z.literal(1),
  observation_id: uuid,
  client_id: uuid,
  body_sha256: sha,
  app_id: positive,
  url: z.string().min(1).max(512),
  status,
  received_at: z.iso.datetime()
}) satisfies z.ZodType<ProductExposureObservation>
export const exposureViewSchema = z.strictObject({
  app_id: positive,
  deployment_id: positive.nullable(),
  context: exposureContextSchema.nullable(),
  status,
  freshness: z.enum(['current', 'stale', 'not_checked']),
  unavailable_reason: z
    .enum([
      'no_running_deployment',
      'runtime_unsettled',
      'authority_changed',
      'execution_active',
      'invalid_target'
    ])
    .nullable(),
  observation: exposureObservationSchema.nullable()
}) satisfies z.ZodType<ProductExposureView>

export const EXPOSURE_OBSERVATION_MAX_AGE_MS = 30_000
export const EXPOSURE_DISPLAY_TTL_MS = 60_000
export const EXPOSURE_FUTURE_TOLERANCE_MS = 5_000
