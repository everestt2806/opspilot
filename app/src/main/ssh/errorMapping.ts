import type { IpcError } from '@shared/ipc'

/** Ánh xạ lỗi thư viện ssh2 sang mã IpcError cho logic retry và UI (M1 / docs/10 mục 3). */
export function mapSshError(error: unknown): IpcError['code'] {
  const message = error instanceof Error ? error.message : String(error)

  if (/All configured authentication methods failed/i.test(message)) {
    return 'SSH_AUTH_FAILED'
  }
  if (/ETIMEDOUT|Timed out while waiting for handshake/i.test(message)) {
    return 'SSH_TIMEOUT'
  }
  if (/ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND/i.test(message)) {
    return 'SSH_HOST_UNREACHABLE'
  }
  return 'UNKNOWN'
}

/** Chỉ các lỗi mạng mới được retry (docs/10 mục 5); AUTH_FAILED thì thử lại cũng vậy. */
export function isRetryableConnectionError(code: IpcError['code']): boolean {
  return code === 'SSH_TIMEOUT' || code === 'SSH_HOST_UNREACHABLE'
}
