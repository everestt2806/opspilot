import { z } from 'zod'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type { ProductControllerCursorPayload } from '../../../../docs/contracts/product-controller-api'
import { ControllerClientAuthError } from './controllerClientAuth'
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const payloadSchema = z.union([
  z
    .strictObject({
      controller_id: z.string().max(128),
      collection: z.literal('apps'),
      after_app_id: positive,
      upper_bound_app_id: positive
    })
    .refine((v) => v.after_app_id <= v.upper_bound_app_id),
  z.strictObject({
    controller_id: z.string().max(128),
    collection: z.enum(['jobs', 'deployments', 'history', 'logs']),
    app_id: positive,
    event_id: positive,
    offset: z.number().int().nonnegative().max(1_000_000)
  })
])
/** Purpose check prevents a cursor ciphertext from becoming an SSH credential or authorization. */
export class ControllerReadCursor {
  constructor(
    private readonly cipher: AesGcmCredentialCipher,
    private readonly controllerId: string
  ) {}
  encode(payload: ProductControllerCursorPayload): string {
    if (payload.controller_id !== this.controllerId)
      throw new ControllerClientAuthError('REQUEST_INVALID')
    const validated = payloadSchema.parse(payload)
    const encrypted = this.cipher.encrypt(
      JSON.stringify({ purpose: 'controller-read-cursor-v1', payload: validated })
    )
    return Buffer.concat([encrypted.iv, encrypted.auth_tag, encrypted.encrypted_secret]).toString(
      'base64url'
    )
  }
  decode(value: string): ProductControllerCursorPayload {
    try {
      if (!/^[A-Za-z0-9_-]{40,2048}$/.test(value)) throw new Error('CURSOR_INVALID')
      const bytes = Buffer.from(value, 'base64url')
      if (bytes.toString('base64url') !== value) throw new Error('CURSOR_INVALID')
      const body: unknown = JSON.parse(
        this.cipher.decrypt({
          crypto_scheme: 'aes_256_gcm',
          iv: bytes.subarray(0, 12),
          auth_tag: bytes.subarray(12, 28),
          encrypted_secret: bytes.subarray(28)
        })
      )
      const envelope = z
        .strictObject({ purpose: z.literal('controller-read-cursor-v1'), payload: payloadSchema })
        .parse(body)
      if (envelope.payload.controller_id !== this.controllerId) throw new Error('CURSOR_INVALID')
      return envelope.payload
    } catch {
      throw new ControllerClientAuthError('REQUEST_INVALID')
    }
  }
}
