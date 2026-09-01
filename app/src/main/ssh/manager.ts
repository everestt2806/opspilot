import { EventEmitter } from 'node:events'
import * as tar from 'tar'

import type { IpcError } from '@shared/ipc'
import { Client, type ClientChannel } from 'ssh2'

import { AppError } from '../errors'
import { logger } from '../logger'
import {
  isRetryableConnectionError,
  mapSshError,
  shouldRetryCommandAfterDisconnect
} from './errorMapping'
import { shellQuote } from './shellQuote'

/** Thông tin kết nối do main cấp (từ DB + loadSecret). Không bao giờ ra renderer. */
export interface SshConnectionInfo {
  host: string
  port: number
  username: string
  authType: 'key' | 'password'
  secret: string
}

export type SshConfigResolver = (vpsId: number) => SshConnectionInfo | Promise<SshConnectionInfo>

export interface ExecOptions {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  timeoutMs?: number
  signal?: AbortSignal
  /** false -> không ghi lệnh vào log (lệnh chứa dữ liệu nhạy cảm, vd ghi .env). */
  logCommand?: boolean
  /** false cho lệnh có side effect: không chạy lại lệnh sau khi connection rơi. */
  retryOnReconnect?: boolean
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface UploadOptions {
  exclude?: string[]
  onProgress?: (bytes: number) => void
  signal?: AbortSignal
}

export interface SshStatusEvent {
  vpsId: number
  status: 'online' | 'offline'
}

export class SshAbortedError extends Error {
  constructor() {
    super('Lệnh SSH đã bị huỷ bởi người dùng.')
    this.name = 'SshAbortedError'
  }
}

const DEFAULT_EXCLUDE = ['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv']
const EXEC_DEFAULT_TIMEOUT_MS = 30_000
const CONNECT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

interface PoolEntry {
  vpsId: number
  info: SshConnectionInfo
  client: Client | null
  ready: boolean
}

export class SshManager extends EventEmitter {
  private readonly entries = new Map<number, PoolEntry>()

  constructor(private readonly resolver: SshConfigResolver) {
    super()
  }

  /** Lấy connection từ pool (1 connection / VPS), tự mở kèm retry nếu chưa có. */
  async connect(vpsId: number): Promise<void> {
    await this.ensureConnected(vpsId)
  }

  async exec(vpsId: number, command: string, options: ExecOptions = {}): Promise<ExecResult> {
    let entry = await this.ensureConnected(vpsId)

    try {
      return await this.runCommand(entry, command, options)
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'UNKNOWN'
      if (shouldRetryCommandAfterDisconnect(code, entry.ready, options.retryOnReconnect)) {
        // Kết nối rơi trước khi lệnh kịp chạy (không retry lệnh đã chạy — có tác dụng phụ).
        entry = await this.ensureConnected(vpsId, true)
        return await this.runCommand(entry, command, options)
      }
      throw error
    }
  }

  /** Upload thư mục bằng tar qua stdin, KHÔNG dùng sftp từng file (M1). */
  async uploadDir(
    vpsId: number,
    localDir: string,
    remoteDir: string,
    options: UploadOptions = {}
  ): Promise<{ bytes: number }> {
    const entry = await this.ensureConnected(vpsId)
    const exclude = new Set(options.exclude ?? DEFAULT_EXCLUDE)
    const remoteBase = shellQuote(remoteDir)

    await this.runCommand(entry, `mkdir -p ${remoteBase}`)

    const channel = await this.openExecChannel(entry, `tar xzf - -C ${remoteBase}`)
    const tarball = tar.c(
      {
        gzip: true,
        cwd: localDir,
        filter: (path) => !path.split('/').some((part) => exclude.has(part))
      },
      ['.']
    )

    let bytes = 0
    const channelResult = this.awaitChannelResult(channel, {
      signal: options.signal,
      onStdout: () => undefined
    })
    const tarballError = new Promise<never>((_resolve, reject) => {
      tarball.on('error', (error) => {
        channel.destroy()
        reject(toSshAppError(error))
      })
    })

    tarball.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      options.onProgress?.(bytes)
      if (!channel.destroyed) {
        channel.write(chunk)
      }
    })
    tarball.on('end', () => channel.end())

    await Promise.race([channelResult, tarballError])
    return { bytes }
  }

  /** Đọc file từ byte thứ `fromByte` (1-based, dùng `tail -c +N`) — phục vụ metrics.jsonl (M6). */
  async readFileTail(
    vpsId: number,
    remotePath: string,
    fromByte: number
  ): Promise<{ content: string; nextByte: number }> {
    const entry = await this.ensureConnected(vpsId)
    const result = await this.runCommand(entry, `tail -c +${fromByte} ${shellQuote(remotePath)}`)
    return {
      content: result.stdout,
      nextByte: fromByte + Buffer.byteLength(result.stdout)
    }
  }

  async readFile(vpsId: number, remotePath: string): Promise<string> {
    const entry = await this.ensureConnected(vpsId)
    return (await this.runCommand(entry, `cat ${shellQuote(remotePath)}`)).stdout
  }

  async writeFile(
    vpsId: number,
    remotePath: string,
    content: string,
    options: { mode?: number; silent?: boolean } = {}
  ): Promise<void> {
    const entry = await this.ensureConnected(vpsId)
    const base64 = Buffer.from(content, 'utf8').toString('base64')
    const pathQuoted = shellQuote(remotePath)
    await this.runCommand(entry, `printf %s '${base64}' | base64 -d > ${pathQuoted}`, {
      logCommand: options.silent === true ? false : true
    })
    if (options.mode !== undefined) {
      await this.runCommand(entry, `chmod ${options.mode.toString(8)} ${pathQuoted}`)
    }
  }

  async fileSize(vpsId: number, remotePath: string): Promise<number> {
    const entry = await this.ensureConnected(vpsId)
    const result = await this.runCommand(entry, `stat -c %s ${shellQuote(remotePath)}`)
    const parsed = Number.parseInt(result.stdout.trim(), 10)
    if (Number.isNaN(parsed)) {
      throw new AppError('UNKNOWN', 'Không đọc được kích thước file trên VPS.')
    }
    return parsed
  }

  async disconnect(vpsId: number): Promise<void> {
    const entry = this.entries.get(vpsId)
    if (!entry) {
      return
    }
    this.entries.delete(vpsId)
    entry.client?.end()
    this.emitStatus(vpsId, 'offline')
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((vpsId) => this.disconnect(vpsId)))
  }

  override on(event: 'status', callback: (update: SshStatusEvent) => void): this {
    return super.on(event, callback)
  }

  override emit(event: 'status', update: SshStatusEvent): boolean {
    return super.emit(event, update)
  }

  // ── Pool & kết nối ─────────────────────────────────────────────────────────

  private getEntry(vpsId: number): PoolEntry {
    const existing = this.entries.get(vpsId)
    if (existing) {
      return existing
    }
    const entry: PoolEntry = {
      vpsId,
      info: { host: '', port: 22, username: '', authType: 'password', secret: '' },
      client: null,
      ready: false
    }
    this.entries.set(vpsId, entry)
    return entry
  }

  private async ensureConnected(vpsId: number, force = false): Promise<PoolEntry> {
    const entry = this.getEntry(vpsId)
    if (entry.ready && entry.client && !force) {
      return entry
    }

    entry.info = await this.resolver(vpsId)
    await this.openWithRetry(entry)
    return entry
  }

  private async openWithRetry(entry: PoolEntry): Promise<void> {
    for (let attempt = 0; attempt <= CONNECT_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        this.destroyClient(entry)
        await this.openClient(entry)
        return
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'UNKNOWN'
        const shouldRetry =
          isRetryableConnectionError(code) && attempt < CONNECT_RETRY_DELAYS_MS.length
        if (!shouldRetry) {
          throw error
        }
        await sleep(CONNECT_RETRY_DELAYS_MS[attempt] ?? 1_000)
      }
    }
  }

  private openClient(entry: PoolEntry): Promise<void> {
    const info = entry.info
    const client = new Client()

    return new Promise<void>((resolve, reject) => {
      const authOptions =
        info.authType === 'key' ? { privateKey: info.secret } : { password: info.secret }

      client.on('ready', () => {
        entry.client = client
        entry.ready = true
        this.emitStatus(entry.vpsId, 'online')
        resolve()
      })

      client.on('close', () => {
        entry.ready = false
        this.emitStatus(entry.vpsId, 'offline')
      })

      client.on('error', (error) => {
        if (!entry.ready) {
          reject(toSshAppError(error))
        }
      })

      client.connect({
        host: info.host,
        port: info.port,
        username: info.username,
        readyTimeout: 15_000,
        keepaliveInterval: 30_000,
        ...authOptions
      })
    })
  }

  private destroyClient(entry: PoolEntry): void {
    if (entry.client) {
      entry.client.removeAllListeners()
      entry.client.end()
    }
    entry.client = null
    entry.ready = false
  }

  private emitStatus(vpsId: number, status: 'online' | 'offline'): void {
    this.emit('status', { vpsId, status })
  }

  // ── Chạy lệnh ──────────────────────────────────────────────────────────────

  private async runCommand(
    entry: PoolEntry,
    command: string,
    options: ExecOptions = {}
  ): Promise<ExecResult> {
    const channel = await this.openExecChannel(entry, command, options)
    return this.awaitChannelResult(channel, options)
  }

  private openExecChannel(
    entry: PoolEntry,
    command: string,
    options: ExecOptions = {}
  ): Promise<ClientChannel> {
    return new Promise<ClientChannel>((resolve, reject) => {
      const client = entry.client
      if (!client) {
        reject(new AppError('SSH_HOST_UNREACHABLE', 'Kết nối SSH chưa sẵn sàng.'))
        return
      }

      if (options.logCommand !== false) {
        logger.info('ssh', command, { vps_id: entry.vpsId })
      }

      client.exec(command, (error, channel) => {
        if (error) {
          reject(toSshAppError(error))
          return
        }
        resolve(channel)
      })
    })
  }

  private awaitChannelResult(
    channel: ClientChannel,
    options: ExecOptions = {}
  ): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
      let exitCode = -1
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false
      const timeoutMs = options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS

      const settle = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        abort?.removeEventListener('abort', abortListener)
        callback()
      }

      const abortListener = (): void => {
        settle(() => {
          channel.destroy()
          reject(new SshAbortedError())
        })
      }
      const abort = options.signal
      if (abort) {
        if (abort.aborted) {
          reject(new SshAbortedError())
          return
        }
        abort.addEventListener('abort', abortListener, { once: true })
      }

      channel.on('data', (chunk: Buffer) => {
        if (timedOut) {
          return
        }
        const text = chunk.toString('utf8')
        stdout += text
        options.onStdout?.(text)
      })

      channel.stderr.on('data', (chunk: Buffer) => {
        if (timedOut) {
          return
        }
        const text = chunk.toString('utf8')
        stderr += text
        options.onStderr?.(text)
      })

      channel.on('error', (error: unknown) => {
        settle(() => reject(toSshAppError(error)))
      })

      channel.on('close', (code: number | null) => {
        if (code !== null) {
          exitCode = code
        }
        settle(() => {
          if (timedOut) {
            reject(new AppError('SSH_TIMEOUT', 'Lệnh chạy quá thời gian cho phép.'))
            return
          }
          if (channel.destroyed && exitCode === -1) {
            reject(new AppError('SSH_HOST_UNREACHABLE', 'Kết nối SSH bị mất giữa chừng.'))
            return
          }
          resolve({ code: exitCode, stdout, stderr })
        })
      })

      const timer = setTimeout(() => {
        timedOut = true
        // Đóng kênh -> sshd kết thúc tiến trình phía VPS.
        channel.destroy()
      }, timeoutMs)
    })
  }
}

function toSshAppError(error: unknown): AppError {
  const code = mapSshError(error)
  const messages: Partial<Record<IpcError['code'], string>> = {
    SSH_AUTH_FAILED: 'SSH xác thực thất bại. Hãy kiểm tra key/password của VPS rồi lưu lại.',
    SSH_TIMEOUT: 'Kết nối SSH bị treo quá thời gian. Hãy kiểm tra mạng hoặc firewall của VPS.',
    SSH_HOST_UNREACHABLE: 'Không kết nối được VPS. Hãy kiểm tra IP, cổng và kết nối mạng.'
  }
  return new AppError(code, messages[code] ?? 'Lỗi SSH không mong đợi.', { cause: error })
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
