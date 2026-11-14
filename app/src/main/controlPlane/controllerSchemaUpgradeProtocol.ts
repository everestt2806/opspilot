import { z } from 'zod'

const sha = z.string().regex(/^[a-f0-9]{64}$/)
export const controllerUpgradeSnapshotSchema = z.strictObject({
  format: z.literal(1),
  controller_id: z.uuidv4().refine((v) => v === v.toLowerCase()),
  schema_sha256: sha,
  state_sha256: sha,
  key_sha256: sha,
  database_inode: z.number().int().nonnegative(),
  key_inode: z.number().int().nonnegative(),
  quiescent: z.boolean(),
  schema_version: z.union([z.literal(29), z.literal(35)]).optional()
})
export const controllerSchemaBackupSchema = z.strictObject({
  format: z.literal(1),
  request_key: z.uuidv4().refine((v) => v === v.toLowerCase()),
  backup_sha256: sha,
  before: controllerUpgradeSnapshotSchema.extend({ schema_version: z.literal(29) })
})
export const controllerSchemaTransitionSchema = z.strictObject({
  snapshot: controllerUpgradeSnapshotSchema,
  projection29: controllerUpgradeSnapshotSchema.extend({ schema_version: z.literal(29) })
})
export const controllerSchemaCommandSchema = z.strictObject({
  format: z.literal(1),
  request_key: z.uuidv4().refine((v) => v === v.toLowerCase()),
  expected: controllerUpgradeSnapshotSchema.extend({
    schema_version: z.union([z.literal(29), z.literal(35)])
  }),
  backup: controllerSchemaBackupSchema.optional(),
  rollback_projection: controllerUpgradeSnapshotSchema
    .extend({ schema_version: z.literal(29) })
    .optional()
})
