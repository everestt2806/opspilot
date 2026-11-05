import {
  GUARDED_SSH_MAX_FRAME_BYTES,
  GUARDED_SSH_MAX_OUTPUT_BYTES,
  type GuardedSshErrorCode,
  type GuardedSshResponse
} from '../../../../docs/contracts/product-guarded-ssh-session'
import { h2AckSchema, h2EnvelopeSchema, h2ProgressSchema } from './productH2Proof'

export const STABLE_ERROR_CODES = new Set([
  'SSH_PIN_REJECTED',
  'SSH_CONNECT_FAILED',
  'SSH_SESSION_TIMEOUT',
  'SSH_SESSION_ABORTED',
  'SSH_SESSION_DISCONNECTED',
  'SSH_PROTOCOL_MALFORMED',
  'SSH_PROTOCOL_TRUNCATED',
  'SSH_PROTOCOL_DUPLICATE',
  'SSH_PROTOCOL_SEQUENCE',
  'SSH_PROTOCOL_LIMIT',
  'SSH_TRANSFER_REJECTED',
  'SSH_TRANSFER_INCOMPLETE',
  'SSH_TRANSFER_CHECKSUM',
  'SSH_BUILD_REJECTED',
  'SSH_BUILD_FAILED',
  'SSH_BUILD_TIMEOUT',
  'SSH_BUILD_NOT_ACTIVE',
  'SSH_RUNTIME_REJECTED',
  'SSH_RUNTIME_FAILED',
  'SSH_RUNTIME_UNKNOWN',
  'SSH_SETTLEMENT_REJECTED',
  'SSH_AUTHORITY_STALE',
  'SSH_DISPATCH_RECONCILIATION_REQUIRED',
  'SSH_DISPATCH_REJECTED',
  'SSH_TARGET_REJECTED',
  'SSH_OUTCOME_UNKNOWN',
  'TARGET_NOT_ENROLLED',
  'TARGET_MARKER_INVALID',
  'TARGET_IDENTITY_INVALID',
  'TARGET_IDENTITY_MISMATCH',
  'TARGET_OWNERSHIP_GENERATION_STALE',
  'TARGET_FENCE_STALE',
  'TARGET_ATTEMPT_REPLAY',
  'TARGET_EXECUTION_UNCERTAIN',
  'TARGET_EXECUTION_NOT_ACTIVE',
  'TARGET_EXECUTION_ALREADY_ENTERED',
  'TARGET_LOCK_BUSY',
  'TARGET_LOCK_TIMEOUT_INVALID',
  'TARGET_LOCK_RELEASE_FAILED',
  'TARGET_PHASE_REJECTED'
])

export class GuardedSshProtocolError extends Error {
  constructor(readonly code: Extract<GuardedSshErrorCode, `SSH_PROTOCOL_${string}`>) {
    super(code)
    this.name = 'GuardedSshProtocolError'
  }
}

export function encodeGuardedSshFrame(value: unknown): Buffer {
  let payload: Buffer
  try {
    payload = Buffer.from(JSON.stringify(value), 'utf8')
  } catch {
    throw new GuardedSshProtocolError('SSH_PROTOCOL_MALFORMED')
  }
  if (payload.length === 0 || payload.length > GUARDED_SSH_MAX_FRAME_BYTES) {
    throw new GuardedSshProtocolError('SSH_PROTOCOL_LIMIT')
  }
  const frame = Buffer.allocUnsafe(4 + payload.length)
  frame.writeUInt32BE(payload.length, 0)
  payload.copy(frame, 4)
  return frame
}

export class GuardedSshFrameDecoder {
  private buffered = Buffer.alloc(0)

  push(chunk: Buffer): GuardedSshResponse[] {
    if (this.buffered.length + chunk.length > GUARDED_SSH_MAX_OUTPUT_BYTES + 4) {
      throw new GuardedSshProtocolError('SSH_PROTOCOL_LIMIT')
    }
    this.buffered = Buffer.concat([this.buffered, chunk])
    const values: GuardedSshResponse[] = []
    while (this.buffered.length >= 4) {
      const length = this.buffered.readUInt32BE(0)
      if (length === 0) throw new GuardedSshProtocolError('SSH_PROTOCOL_MALFORMED')
      if (length > GUARDED_SSH_MAX_OUTPUT_BYTES) {
        throw new GuardedSshProtocolError('SSH_PROTOCOL_LIMIT')
      }
      if (this.buffered.length < length + 4) break
      const payload = this.buffered.subarray(4, length + 4)
      this.buffered = this.buffered.subarray(length + 4)
      let value: unknown
      try {
        value = JSON.parse(payload.toString('utf8'))
      } catch {
        throw new GuardedSshProtocolError('SSH_PROTOCOL_MALFORMED')
      }
      if (!isResponse(value)) throw new GuardedSshProtocolError('SSH_PROTOCOL_MALFORMED')
      values.push(value)
    }
    return values
  }

  finish(): void {
    if (this.buffered.length !== 0) throw new GuardedSshProtocolError('SSH_PROTOCOL_TRUNCATED')
  }
}

export function requireSingleGuardedSshResponse(
  responses: readonly GuardedSshResponse[]
): GuardedSshResponse | null {
  if (responses.length > 1) throw new GuardedSshProtocolError('SSH_PROTOCOL_DUPLICATE')
  return responses[0] ?? null
}

function isResponse(value: unknown): value is GuardedSshResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Record<string, unknown>
  const ALLOWED_RESPONSE_KEYS = new Set([
    'version',
    'request_id',
    'sequence',
    'state',
    'deployment_id',
    'error_code',
    'build_state',
    'exit_code',
    'image_id',
    'image_tag',
    'labels',
    'error_tail',
    'runtime',
    'terminal',
    'settlement'
  ])
  const keys = Object.keys(response)
  if (keys.some((key) => !ALLOWED_RESPONSE_KEYS.has(key))) {
    return false
  }
  return (
    response.version === 1 &&
    typeof response.request_id === 'string' &&
    Number.isSafeInteger(response.sequence) &&
    (response.state === 'accepted' || response.state === 'rejected') &&
    (response.error_code === undefined ||
      (typeof response.error_code === 'string' && STABLE_ERROR_CODES.has(response.error_code))) &&
    (response.deployment_id === undefined || Number.isSafeInteger(response.deployment_id)) &&
    (response.build_state === undefined ||
      ['started', 'running', 'succeeded', 'failed'].includes(response.build_state as string)) &&
    (response.exit_code === undefined || Number.isSafeInteger(response.exit_code)) &&
    (response.image_id === undefined || typeof response.image_id === 'string') &&
    (response.image_tag === undefined || typeof response.image_tag === 'string') &&
    (response.labels === undefined ||
      (typeof response.labels === 'object' &&
        response.labels !== null &&
        !Array.isArray(response.labels) &&
        Object.entries(response.labels).every(
          ([k, v]) => typeof k === 'string' && typeof v === 'string'
        ))) &&
    (response.error_tail === undefined || typeof response.error_tail === 'string') &&
    (response.runtime === undefined || h2ProgressSchema.safeParse(response.runtime).success) &&
    (response.terminal === undefined || h2EnvelopeSchema.safeParse(response.terminal).success) &&
    (response.settlement === undefined || h2AckSchema.safeParse(response.settlement).success)
  )
}
