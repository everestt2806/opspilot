import { createHash } from 'node:crypto'
import { Client } from 'ssh2'

import { AppError } from '../errors'

/** Read a public host key, rejecting the handshake before any authentication. */
export function readFirstContactFingerprint(host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let fingerprint: string | undefined
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.end()
      if (fingerprint) resolve(fingerprint)
      else
        reject(
          new AppError(
            'SSH_HOST_UNREACHABLE',
            'Không kết nối được VPS. Kiểm tra IP và cổng SSH rồi thử lại.'
          )
        )
    }
    const timer = setTimeout(finish, 15_000)
    // Keep the error listener through close: rejecting a host key can emit a late error.
    client.on('error', finish)
    client.once('close', finish)
    try {
      client.connect({
        host,
        port,
        username: 'opspilot-host-key-probe',
        readyTimeout: 12_000,
        authHandler: () => false,
        hostVerifier: (key: Buffer): boolean => {
          fingerprint =
            'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
          return false
        }
      })
    } catch {
      finish()
    }
  })
}
