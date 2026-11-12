import { z } from 'zod'
import type { InstalledControllerAdminRequest } from '../../../../docs/contracts/product-installed-controller-admin'

const sha = z.string().regex(/^[a-f0-9]{64}$/)
export const installedControllerAdminSchema = z.strictObject({
  format: z.literal(1),
  operation: z.literal('admin'),
  authority: z.strictObject({
    request_key: z.uuidv4().refine((v) => v === v.toLowerCase()),
    release_sha256: sha,
    installer_sha256: sha,
    controller_id: z.uuidv4(),
    runtime_uid: z.number().int().positive().max(2147483647),
    payload_sha256: sha,
    revision: z
      .strictObject({
        installation_request_key: z.uuidv4().refine((v) => v === v.toLowerCase()),
        parent_upgrade_key: z
          .uuidv4()
          .refine((v) => v === v.toLowerCase())
          .nullable(),
        parent_release_sha256: sha
      })
      .optional()
  }),
  command: z.strictObject({
    operation: z.enum([
      'enroll-desktop-client',
      'revoke-desktop-client',
      'status',
      'project-targets',
      'register-project',
      'verify-project-source',
      'project-target-state',
      'enroll-project-target',
      'project-readiness',
      'register-vps'
    ]),
    payload: z.record(z.string(), z.unknown())
  })
}) satisfies z.ZodType<InstalledControllerAdminRequest>
