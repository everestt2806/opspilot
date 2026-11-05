import type { Readable } from 'node:stream'
import { addAbortSignal } from 'node:stream'
import { TextDecoder } from 'node:util'
import {
  PRODUCT_CONTROLLER_ENROLLMENT_INPUT_TIMEOUT_MS,
  PRODUCT_CONTROLLER_ENROLLMENT_MAX_INPUT_BYTES
} from '../../../../docs/contracts/product-controller-bootstrap'

/** Chỉ đọc stdin pipe có giới hạn; không echo terminal, fallback env hoặc lộ lỗi parser thô. */
export async function readControllerBootstrapInput(
  stream: Readable & { isTTY?: boolean },
  signal: AbortSignal
): Promise<unknown> {
  if (stream.isTTY) throw new Error('CONTROLLER_VPS_STDIN_REQUIRED')
  if (signal.aborted) throw new Error('CONTROLLER_VPS_ENROLLMENT_ABORTED')
  const chunks: Buffer[] = []
  let length = 0
  let joined: Buffer | undefined
  const timer = setTimeout(
    () => stream.destroy(new Error('INPUT_TIMEOUT')),
    PRODUCT_CONTROLLER_ENROLLMENT_INPUT_TIMEOUT_MS
  )
  addAbortSignal(signal, stream)
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      length += bytes.length
      if (length > PRODUCT_CONTROLLER_ENROLLMENT_MAX_INPUT_BYTES) throw new Error('INPUT_LIMIT')
      chunks.push(Buffer.from(bytes))
    }
    if (signal.aborted) throw new Error('INPUT_ABORTED')
    joined = Buffer.concat(chunks)
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined))
  } catch {
    throw new Error(
      signal.aborted ? 'CONTROLLER_VPS_ENROLLMENT_ABORTED' : 'CONTROLLER_VPS_INPUT_INVALID'
    )
  } finally {
    clearTimeout(timer)
    joined?.fill(0)
    for (const chunk of chunks) chunk.fill(0)
  }
}
