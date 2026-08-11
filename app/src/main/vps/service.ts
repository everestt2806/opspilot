import { z } from 'zod'

import type { Vps, VpsInput } from '@shared/ipc'

import type { CredentialCipher } from '../crypto/credentialCipher'
import type { VpsRepository } from '../db/vpsRepository'
import { AppError } from '../errors'

const nameSchema = z.string().trim().min(1).max(64)
const hostSchema = z.string().trim().min(1).max(253)
const portSchema = z.number().int().min(1).max(65535)
const usernameSchema = z.string().trim().min(1).max(128)
const secretSchema = z.string().min(1).max(100_000)
const optionalTextSchema = z.string().trim().max(100).optional()

const createVpsSchema = z.object({
  name: nameSchema,
  host: hostSchema,
  port: portSchema,
  username: usernameSchema,
  auth_type: z.enum(['key', 'password']),
  secret: secretSchema,
  provider: optionalTextSchema,
  region: optionalTextSchema
})

const updateVpsSchema = createVpsSchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Cần có ít nhất một trường để cập nhật.')

export class VpsService {
  constructor(
    private readonly repository: VpsRepository,
    private readonly credentialCipher: CredentialCipher
  ) {}

  list(): Vps[] {
    return this.repository.list()
  }

  create(rawInput: VpsInput): Vps {
    const input = parseInput(createVpsSchema, rawInput)
    const credential = this.credentialCipher.encrypt(input.secret)

    return this.repository.create({
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      auth_type: input.auth_type,
      provider: input.provider,
      region: input.region,
      credential
    })
  }

  update(id: number, rawPatch: Partial<VpsInput>): Vps {
    validateId(id)
    const patch = parseInput(updateVpsSchema, rawPatch)
    const current = this.repository.getById(id)

    if (patch.auth_type !== undefined && patch.auth_type !== current.auth_type && !patch.secret) {
      throw new AppError('VALIDATION', 'Đổi cách xác thực cần nhập lại credential rồi lưu.')
    }

    const { secret, ...publicPatch } = patch
    return this.repository.update(id, {
      ...publicPatch,
      credential: secret === undefined ? undefined : this.credentialCipher.encrypt(secret)
    })
  }

  delete(id: number): void {
    validateId(id)
    this.repository.delete(id)
  }
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new AppError(
      'VALIDATION',
      'Thông tin VPS không hợp lệ. Hãy kiểm tra các trường bắt buộc rồi thử lại.'
    )
  }
  return result.data
}

function validateId(id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('VALIDATION', 'VPS không hợp lệ. Hãy tải lại danh sách rồi thử lại.')
  }
}
