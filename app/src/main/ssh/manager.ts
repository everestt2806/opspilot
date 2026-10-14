import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'
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
  hostFingerprint: string | null
  username: string
  authType: 'key' | 'password'
  secret: string
}

export type SshConfigResolver = (vpsId: number) => SshConnectionInfo | Promise<SshConnectionInfo>

export interface ExecOptions {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  onChannelOpened?: () => void
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

export interface RelayOptions {
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
}

/** Copy a remote artifact without buffering it in the desktop process. */
export function relayStreams(
  input: Readable,
  output: Writable,
  options: Pick<RelayOptions, 'signal' | 'onProgress'> = {}
): Promise<{ bytes: number }> {
  return new Promise((resolve, reject) => {
    let bytes = 0
    let settled = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve({ bytes })
    }
    const abort = (): void => {
      input.destroy()
      output.destroy()
      finish(new SshAbortedError())
    }
    if (options.signal?.aborted) {
      abort()
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    input.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      options.onProgress?.(bytes)
      if (!output.write(chunk)) input.pause()
    })
    output.on('drain', () => input.resume())
    input.once('error', finish)
    output.once('error', finish)
    input.once('end', () => output.end())
    output.once('finish', () => {
      options.signal?.removeEventListener('abort', abort)
      finish()
    })
  })
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
const CONNECT_TIMEOUT_MS = 15_000
const CONNECT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

/** Compute the OpenSSH display fingerprint from the host key bytes received in the handshake. */
export function matchesSshHostFingerprint(receivedHostKey: Buffer, expected: string): boolean {
  const fingerprint = createHash('sha256')
    .update(receivedHostKey)
    .digest('base64')
    .replace(/=+$/, '')
  return `SHA256:${fingerprint}` === expected
}

interface PoolEntry {
  vpsId: number
  info: SshConnectionInfo
  client: Client | null
  ready: boolean
  cancelled: boolean
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
    const deadline = Date.now() + (options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS)
    let entry = await this.ensureConnected(vpsId)
    try {
      const remainingMs = Math.max(1, deadline - Date.now())
      const channel = await this.openExecChannel(entry, command, { ...options, timeoutMs: remainingMs })
      return await this.awaitChannelResult(channel, {
        ...options,
        timeoutMs: Math.max(1, deadline - Date.now())
      })
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'UNKNOWN'
      if (shouldRetryCommandAfterDisconnect(code, entry.ready, options.retryOnReconnect)) {
        entry = await this.ensureConnected(vpsId, true)
        const remainingMs = Math.max(1, deadline - Date.now())
        const channel = await this.openExecChannel(entry, command, { ...options, timeoutMs: remainingMs })
        return await this.awaitChannelResult(channel, {
          ...options,
          timeoutMs: Math.max(1, deadline - Date.now())
        })
      }
      throw error
    }
  }

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
    const writeResult = await this.runCommand(
      entry,
      `printf %s '${base64}' | base64 -d > ${pathQuoted}`,
      {
        logCommand: options.silent === true ? false : true
      }
    )
    if (writeResult.code !== 0) {
      throw new AppError('UNKNOWN', 'Không thể ghi file từ xa qua SSH.')
    }
    if (options.mode !== undefined) {
      const chmodResult = await this.runCommand(
        entry,
        `chmod ${options.mode.toString(8)} ${pathQuoted}`
      )
      if (chmodResult.code !== 0) {
        throw new AppError('UNKNOWN', 'Không thể áp dụng quyền riêng tư cho file từ xa.')
      }
    }
  }

  /** Relay one remote file through the desktop with channel backpressure. */
  async relayFile(
    sourceVpsId: number,
    sourcePath: string,
    targetVpsId: number,
    targetPath: string,
    options: RelayOptions = {}
  ): Promise<{ bytes: number }> {
    const source = await this.ensureConnected(sourceVpsId)
    const target = await this.ensureConnected(targetVpsId)
    const input = await this.openExecChannel(source, `cat ${shellQuote(sourcePath)}`, {})
    const output = await this.openExecChannel(target, `cat > ${shellQuote(targetPath)}`, {})
    let bytes = 0
    const result = this.awaitChannelResult(
      input,
      { signal: options.signal, timeoutMs: 900_000 },
      false
    )
    const outputResult = this.awaitChannelResult(
      output,
      { signal: options.signal, timeoutMs: 900_000 },
      false
    )
    const failure = new Promise<never>((_, reject) => {
      output.on('error', reject)
      output.stderr.on('data', (chunk: Buffer) => {
        if (chunk.length > 0) reject(new Error(chunk.toString('utf8')))
      })
    })
    const relay = relayStreams(input, output, options)
    try {
      const sourceResult = await Promise.race([result, failure])
      if (sourceResult.code !== 0) throw new AppError('UNKNOWN', 'Đọc artifact nguồn thất bại.')
      const targetResult = await outputResult
      bytes = (await relay).bytes
      if (targetResult.code !== 0) throw new AppError('UNKNOWN', 'Ghi artifact đích thất bại.')
    } catch (error) {
      input.destroy()
      output.destroy()
      throw error
    }
    return { bytes }
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

  async metricSnapshot(
    vpsId: number,
    remotePath: string
  ): Promise<{ generation: string; device: number; inode: number; size: number } | null> {
    const result = await this.exec(vpsId, `stat -c '%d:%i:%s' ${shellQuote(remotePath)} 2>&1`, {
      retryOnReconnect: true
    })
    if (result.code !== 0) {
      if (/no such file|cannot stat/i.test(result.stdout + result.stderr)) return null
      throw new AppError('UNKNOWN', 'Không đọc được snapshot metrics.jsonl trên VPS.')
    }
    const value = result.stdout.trim()
    const match = value.match(/^(\d+):(\d+):(\d+)$/)
    if (!match) throw new AppError('UNKNOWN', 'Snapshot metrics.jsonl không hợp lệ trên VPS.')
    return {
      generation: `${match[1]}:${match[2]}`,
      device: Number(match[1]),
      inode: Number(match[2]),
      size: Number(match[3])
    }
  }

  async fileIdentity(
    vpsId: number,
    remotePath: string
  ): Promise<{ generation: string; device?: number; inode?: number }> {
    const result = await this.exec(vpsId, `stat -c '%d:%i' ${shellQuote(remotePath)}`)
    const generation = result.stdout.trim()
    if (!/^\d+:\d+$/.test(generation)) {
      throw new AppError('UNKNOWN', 'KhÃ´ng Ä‘á»c Ä‘Æ°á»£c identity file metrics trÃªn VPS.')
    }
    const [device, inode] = generation.split(':').map(Number)
    return { generation, device, inode }
  }

  async disconnect(vpsId: number): Promise<void> {
    const entry = this.entries.get(vpsId)
    if (!entry) {
      return
    }
    this.entries.delete(vpsId)
    entry.cancelled = true
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
      info: {
        host: '',
        port: 22,
        hostFingerprint: null,
        username: '',
        authType: 'password',
        secret: ''
      },
      client: null,
      ready: false,
      cancelled: false
    }
    this.entries.set(vpsId, entry)
    return entry
  }

  private async ensureConnected(vpsId: number, force = false): Promise<PoolEntry> {
    const entry = this.getEntry(vpsId)
    const resolved = await this.resolver(vpsId)
    if (!resolved.hostFingerprint || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(resolved.hostFingerprint)) {
      await this.disconnect(vpsId)
      throw new AppError(
        'VALIDATION',
        'Thiếu fingerprint SSH SHA256 hợp lệ. Hãy lấy fingerprint độc lập từ console của VPS rồi lưu trước khi kết nối.'
      )
    }
    const endpointChanged =
      entry.info.host !== '' &&
      (entry.info.host !== resolved.host ||
        entry.info.port !== resolved.port ||
        entry.info.hostFingerprint !== resolved.hostFingerprint)
    if (endpointChanged) force = true
    if (entry.ready && entry.client && !force) {
      return entry
    }

    entry.info = resolved
    await this.openWithRetry(entry)
    return entry
  }

  private async openWithRetry(entry: PoolEntry): Promise<void> {
    for (let attempt = 0; attempt <= CONNECT_RETRY_DELAYS_MS.length; attempt += 1) {
      if (entry.cancelled) throw new AppError('SSH_TIMEOUT', 'SSH connection was cancelled.')
      try {
        this.destroyClient(entry)
        await this.openClient(entry)
        return
      } catch (error) {
        if (entry.cancelled) throw new AppError('SSH_TIMEOUT', 'SSH connection was cancelled.')
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
    let hostKeyMismatch = false

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        client.removeListener('ready', onReady)
        client.removeListener('close', onClose)
        client.removeListener('error', onError)
        if (entry.client === client) entry.client = null
        entry.ready = false
        client.end()
        reject(error)
      }
      const onReady = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        entry.client = client
        entry.ready = true
        this.emitStatus(entry.vpsId, 'online')
        resolve()
      }
      const onClose = (): void => {
        entry.ready = false
        this.emitStatus(entry.vpsId, 'offline')
        if (!settled) {
          fail(new AppError('SSH_HOST_UNREACHABLE', 'Kết nối SSH đã đóng trước khi sẵn sàng.'))
        }
      }
      const onError = (error: Error): void => {
        if (!settled) {
          fail(hostKeyMismatch
            ? new AppError('VALIDATION', 'Fingerprint SSH không khớp với fingerprint đã lưu. Kết nối bị từ chối trước xác thực.', { cause: new Error('SSH host fingerprint mismatch') })
            : toSshAppError(error))
        }
      }
      const timer = setTimeout(
        () => fail(new AppError('SSH_TIMEOUT', 'Bắt tay SSH quá thời gian cho phép.')),
        CONNECT_TIMEOUT_MS
      )
      const authOptions = info.authType === 'key'
        ? { privateKey: info.secret }
        : { password: info.secret }

      entry.client = client
      client.on('ready', onReady)
      client.on('close', onClose)
      client.on('error', onError)
      try {
        client.connect({
          host: info.host,
          port: info.port,
          username: info.username,
          readyTimeout: CONNECT_TIMEOUT_MS,
          keepaliveInterval: 30_000,
          hostVerifier: (receivedHostKey: Buffer) => {
            hostKeyMismatch = !matchesSshHostFingerprint(receivedHostKey, info.hostFingerprint!)
            return !hostKeyMismatch
          },
          ...authOptions
        })
      } catch (error) {
        fail(toSshAppError(error))
      }
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
    const deadline = Date.now() + (options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS)
    const channel = await this.openExecChannel(entry, command, {
      ...options,
      timeoutMs: Math.max(1, deadline - Date.now())
    })
    return this.awaitChannelResult(channel, {
      ...options,
      timeoutMs: Math.max(1, deadline - Date.now())
    })
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
      if (options.logCommand !== false) logger.info('ssh', command, { vps_id: entry.vpsId })

      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        client.removeListener('close', onClose)
        client.removeListener('error', onError)
        callback()
      }
      const onClose = (): void => finish(() => reject(
        new AppError('SSH_HOST_UNREACHABLE', 'Kết nối SSH đã đóng trước khi mở command channel.')
      ))
      const onError = (error: Error): void => finish(() => reject(toSshAppError(error)))
      const timer = setTimeout(() => finish(() => reject(
        new AppError('SSH_TIMEOUT', 'Mở command channel SSH quá thời gian cho phép.')
      )), options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS)
      client.once('close', onClose)
      client.once('error', onError)

      try {
        client.exec(command, (error, channel) => {
          if (settled) {
            channel?.destroy()
            return
          }
          if (error) {
            finish(() => reject(toSshAppError(error)))
          } else {
            try {
              options.onChannelOpened?.()
              finish(() => resolve(channel))
            } catch (callbackError) {
              finish(() => reject(callbackError))
              channel.destroy()
            }
          }
        })
      } catch (error) {
        finish(() => reject(toSshAppError(error)))
      }
    })
  }

  private awaitChannelResult(
    channel: ClientChannel,
    options: ExecOptions = {},
    captureOutput = true
  ): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
      let exitCode = -1
      let stdout = ''
      let stderr = ''
      let settled = false
      let timer: NodeJS.Timeout
      const abort = options.signal
      const cleanup = (): void => {
        clearTimeout(timer)
        abort?.removeEventListener('abort', abortListener)
        channel.removeListener('data', onData)
        channel.stderr.removeListener('data', onStderr)
        channel.removeListener('error', onError)
        channel.removeListener('close', onClose)
      }
      const settle = (callback: () => void): void => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }
      const abortListener = (): void => settle(() => {
        channel.destroy()
        reject(new SshAbortedError())
      })
      const onData = (chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        if (captureOutput) stdout += text
        options.onStdout?.(text)
      }
      const onStderr = (chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        if (captureOutput) stderr += text
        options.onStderr?.(text)
      }
      const onError = (error: unknown): void => settle(() => reject(toSshAppError(error)))
      const onClose = (code: number | null): void => {
        if (code !== null) exitCode = code
        if (channel.destroyed && exitCode === -1) {
          settle(() => reject(new AppError('SSH_HOST_UNREACHABLE', 'Kênh lệnh SSH đã đóng bất ngờ.')))
        } else {
          settle(() => resolve({ code: exitCode, stdout, stderr }))
        }
      }

      if (abort?.aborted) {
        channel.destroy()
        reject(new SshAbortedError())
        return
      }
      abort?.addEventListener('abort', abortListener, { once: true })
      channel.on('data', onData)
      channel.stderr.on('data', onStderr)
      channel.on('error', onError)
      channel.on('close', onClose)
      timer = setTimeout(() => settle(() => {
        channel.destroy()
        reject(new AppError('SSH_TIMEOUT', 'Lệnh SSH chạy quá thời gian cho phép.'))
      }), options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS)
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
