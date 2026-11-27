import { z } from 'zod'

import type { Vps, VpsConnectionCheck, VpsInput } from '@shared/ipc'
import type { VpsRepository } from '../db/vpsRepository'
import { AppError } from '../errors'
import { readFirstContactFingerprint } from '../ssh/firstContact'
import { testConnectionWithCredentials } from './connectionService'
import { createVpsSchema, type VpsService } from './service'

const optionalPin = z.preprocess(
  (value) => (value === '' ? undefined : value),
  createVpsSchema.shape.host_fingerprint.optional()
)
const inputSchema = createVpsSchema.extend({ host_fingerprint: optionalPin })
const patchSchema = inputSchema.partial().refine((patch) => Object.keys(patch).length > 0)

/** First contact only lives here. SshManager and all runtime paths still require a pin. */
export class VpsOnboarding {
  // Holds test→save identity, including failed authentication. Saved pins are durable in vps.
  private readonly contacts = new Map<string, Promise<string>>()

  constructor(
    private readonly repository: Pick<VpsRepository, 'getById' | 'getEndpointFingerprint'>,
    private readonly service: Pick<VpsService, 'create' | 'update'>,
    private readonly observe = readFirstContactFingerprint,
    private readonly check = testConnectionWithCredentials
  ) {}

  private async pin(host: string, port: number, supplied?: string): Promise<string> {
    const key = JSON.stringify([host.toLowerCase(), port])
    const known = this.repository.getEndpointFingerprint(host, port)
    const pending = this.contacts.get(key)
    let pin: string
    if (known) pin = known
    else if (pending) pin = await pending
    else {
      if (this.contacts.size >= 256) {
        throw new AppError(
          'VALIDATION',
          'Đã kiểm tra quá nhiều máy chưa lưu. Khởi động lại OpsPilot rồi thử lại.'
        )
      }
      // Store before awaiting so simultaneous checks share one identity.
      const contact = supplied ? Promise.resolve(supplied) : this.observe(host, port)
      this.contacts.set(key, contact)
      try {
        pin = await contact
      } catch (error) {
        if (this.contacts.get(key) === contact) this.contacts.delete(key)
        throw error
      }
    }
    const current = this.repository.getEndpointFingerprint(host, port)
    if ((supplied && supplied !== pin) || (current && current !== pin)) {
      throw new AppError(
        'VALIDATION',
        'Khóa SSH khác với lần kết nối trước. OpsPilot đã dừng để bảo vệ thông tin đăng nhập. Kiểm tra VPS có được cài lại hoặc đổi chủ không.'
      )
    }
    return pin
  }

  async create(raw: VpsInput): Promise<Vps> {
    const input = this.parse(inputSchema, raw)
    const pin = await this.pin(input.host, input.port, input.host_fingerprint)
    return this.service.create({ ...input, host_fingerprint: pin })
  }

  async update(id: number, raw: Partial<VpsInput>): Promise<Vps> {
    const patch = this.parse(patchSchema, raw)
    const current = this.repository.getById(id)
    const pin = await this.pin(
      patch.host ?? current.host,
      patch.port ?? current.port,
      patch.host_fingerprint
    )
    const fresh = this.repository.getById(id)
    if (
      fresh.host !== current.host ||
      fresh.port !== current.port ||
      fresh.host_fingerprint !== current.host_fingerprint ||
      fresh.username !== current.username ||
      fresh.auth_type !== current.auth_type
    ) {
      throw new AppError(
        'VALIDATION',
        'Thông tin kết nối VPS vừa thay đổi. Mở lại hồ sơ rồi lưu lại.'
      )
    }
    return this.service.update(id, { ...patch, host_fingerprint: pin })
  }

  async test(raw: VpsInput): Promise<VpsConnectionCheck> {
    const input = this.parse(inputSchema, raw)
    const pin = await this.pin(input.host, input.port, input.host_fingerprint)
    const result = await this.check({
      host: input.host,
      port: input.port,
      username: input.username,
      authType: input.auth_type,
      secret: input.secret,
      hostFingerprint: pin
    })
    return { ...result, host_fingerprint: pin }
  }

  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw)
    if (!result.success)
      throw new AppError(
        'VALIDATION',
        'Thông tin VPS không hợp lệ. Kiểm tra IP, tài khoản và mật khẩu rồi thử lại.'
      )
    return result.data
  }
}
