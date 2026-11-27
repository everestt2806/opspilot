import type { IncomingMessage } from 'node:http'
import { TextDecoder } from 'node:util'
import {
  PRODUCT_CONTROLLER_API_BODY_TIMEOUT_MS,
  PRODUCT_CONTROLLER_API_MAX_REQUEST_BYTES
} from '../../../../docs/contracts/product-controller-api'
import { ControllerClientAuthError } from './controllerClientAuth'

export class ControllerRequestBodyError extends ControllerClientAuthError {
  constructor(readonly httpStatus: 400 | 413 | 503) {
    super(httpStatus === 503 ? 'CAPABILITY_BLOCKED' : 'REQUEST_INVALID')
  }
}

/** Chỉ decode sau khi đủ body trong giới hạn; không đưa JSON/stdout thô vào exception. */
export function readControllerRequestBody(
  request: IncomingMessage,
  signal: AbortSignal
): Promise<unknown> {
  const media = request.headers['content-type']
  const length = request.headers['content-length']
  if (
    typeof media !== 'string' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(media) ||
    request.headers['content-encoding'] !== undefined
  )
    return Promise.reject(new ControllerRequestBodyError(400))
  if (length !== undefined && (!/^[0-9]+$/.test(length) || !Number.isSafeInteger(Number(length))))
    return Promise.reject(new ControllerRequestBodyError(400))
  if (length !== undefined && Number(length) > PRODUCT_CONTROLLER_API_MAX_REQUEST_BYTES)
    return Promise.reject(new ControllerRequestBodyError(413))
  if (signal.aborted) return Promise.reject(new ControllerRequestBodyError(503))
  return new Promise((resolve, reject) => {
    let settled = false,
      size = 0
    const chunks: Buffer[] = []
    const cleanup = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onStop)
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('aborted', onAborted)
    }
    const fail = (status: 400 | 413 | 503): void => {
      if (settled) return
      settled = true
      cleanup()
      request.pause()
      reject(new ControllerRequestBodyError(status))
    }
    const onStop = (): void => fail(503)
    const onAborted = (): void => fail(400)
    const onError = (): void => fail(400)
    const onData = (chunk: Buffer): void => {
      if (settled) return
      size += chunk.length
      if (size > PRODUCT_CONTROLLER_API_MAX_REQUEST_BYTES) {
        fail(413)
        return
      }
      chunks.push(chunk)
    }
    const onEnd = (): void => {
      if (settled) return
      try {
        if (length !== undefined && size !== Number(length)) throw new Error('LENGTH_MISMATCH')
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
        )
        settled = true
        cleanup()
        resolve(value)
      } catch {
        fail(400)
      }
    }
    const timer = setTimeout(() => fail(400), PRODUCT_CONTROLLER_API_BODY_TIMEOUT_MS)
    timer.unref()
    signal.addEventListener('abort', onStop, { once: true })
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('aborted', onAborted)
    // Giữ listener tới close vì Node có thể phát error sau aborted.
    request.on('error', onError)
    request.once('close', () => request.removeListener('error', onError))
    if (signal.aborted) onStop()
  })
}
