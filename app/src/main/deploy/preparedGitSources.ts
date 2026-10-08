import { createHash, randomUUID } from 'node:crypto'

import type { GitDeployInput, GitSourceInput, PreparedGitSource } from '@shared/ipc'

import { AppError } from '../errors'
import { createGitSnapshot, type GitSnapshot, type GitSnapshotInput } from '../git/snapshot'
import { detectSource } from './detectionDto'

const PREPARED_SOURCE_TTL_MS = 15 * 60 * 1000
const PRECHECK_TOKEN_TTL_MS = 5 * 60 * 1000

interface PreparedSourceRecord {
  handle: string
  snapshot: GitSnapshot
  gitRepoUrl: string
  gitRef: string
  gitRoot: string
  plan: NonNullable<ReturnType<typeof detectSource>['plan']>
  detection: PreparedGitSource['detection']
  expiresAt: number
  expiryTimer: ReturnType<typeof setTimeout>
  inUse: boolean
}

interface PrecheckTokenRecord {
  token: string
  handle: string
  inputFingerprint: string
  assignedHostPort: number
  expiresAt: number
  expiryTimer: ReturnType<typeof setTimeout>
  inUse: boolean
}

export interface PreparedGitLease {
  handle: string
  snapshot: GitSnapshot
  gitRepoUrl: string
  gitRef: string
  gitRoot: string
  commitSha: string
  sourcePath: string
  expiresAt: number
  plan: NonNullable<ReturnType<typeof detectSource>['plan']>
}

export interface GitStartReservation {
  lease: PreparedGitLease
  assignedHostPort: number
  token: PrecheckTokenRecord
  entry: PreparedSourceRecord
}

type SnapshotFactory = (input: GitSnapshotInput) => Promise<GitSnapshot>

function toDeployFingerprint(input: GitDeployInput, assignedHostPort: number): string {
  const env = Object.entries(input.env).sort(([left], [right]) => left.localeCompare(right))
  return createHash('sha256')
    .update(
      JSON.stringify({
        handle: input.prepared_source_handle,
        vps_id: input.vps_id,
        app_id: input.app_id ?? null,
        app_name: input.app_name,
        host_port: input.host_port ?? assignedHostPort,
        assigned_host_port: assignedHostPort,
        env
      })
    )
    .digest('hex')
}

export class PreparedGitSources {
  private readonly entries = new Map<string, PreparedSourceRecord>()
  private readonly precheckTokens = new Map<string, PrecheckTokenRecord>()
  private readonly usedHandles = new Map<string, number>()
  private readonly prepareControllers = new Map<string, AbortController>()
  private readonly snapshotFactory: SnapshotFactory
  private closed = false

  constructor(snapshotFactory: SnapshotFactory = createGitSnapshot) {
    this.snapshotFactory = snapshotFactory
  }

  async prepare(requestId: string, input: GitSourceInput): Promise<PreparedGitSource> {
    if (this.closed)
      throw new AppError('VALIDATION', 'Chuẩn bị Git đã dừng vì ứng dụng đang thoát.')
    if (!requestId || requestId.length > 128 || this.prepareControllers.has(requestId)) {
      throw new AppError('VALIDATION', 'Mã yêu cầu chuẩn bị Git không hợp lệ hoặc đang được dùng.')
    }

    const controller = new AbortController()
    this.prepareControllers.set(requestId, controller)
    let snapshot: GitSnapshot | null = null
    try {
      snapshot = await this.snapshotFactory({
        repositoryUrl: input.git_repo_url,
        ref: input.git_ref,
        root: input.git_root,
        signal: controller.signal
      })
      if (controller.signal.aborted || this.closed) {
        snapshot.cleanup()
        snapshot = null
        throw new AppError('VALIDATION', 'Đã huỷ chuẩn bị nguồn Git.')
      }
      const detected = detectSource(snapshot.rootDirectory)
      if (!detected.plan) {
        throw new AppError(
          'DETECT_FAILED',
          detected.dto.matched ? 'Không nhận diện được source Git.' : detected.dto.hint
        )
      }

      const handle = randomUUID()
      const entry: PreparedSourceRecord = {
        handle,
        snapshot,
        gitRepoUrl: snapshot.repositoryUrl,
        gitRef: input.git_ref,
        gitRoot: input.git_root,
        plan: detected.plan,
        detection: detected.dto,
        expiresAt: Date.now() + PREPARED_SOURCE_TTL_MS,
        expiryTimer: setTimeout(() => this.expireHandle(handle), PREPARED_SOURCE_TTL_MS),
        inUse: false
      }
      entry.expiryTimer.unref?.()
      this.entries.set(handle, entry)
      snapshot = null
      return {
        prepared_source_handle: handle,
        git_repo_url: entry.gitRepoUrl,
        git_ref: entry.gitRef,
        git_root: entry.gitRoot,
        git_commit_sha: entry.snapshot.commitSha,
        detection: entry.detection
      }
    } catch (error) {
      snapshot?.cleanup()
      throw error
    } finally {
      this.prepareControllers.delete(requestId)
    }
  }

  cancelPrepare(requestId: string): void {
    this.prepareControllers.get(requestId)?.abort()
  }

  get(handle: string): PreparedGitLease {
    this.pruneUsedHandles()
    const entry = this.entries.get(handle)
    if (!entry) {
      const message = this.usedHandles.has(handle)
        ? 'Snapshot Git này đã được dùng để bắt đầu deploy; hãy chuẩn bị lại.'
        : 'Handle snapshot Git không hợp lệ hoặc đã hết hạn; hãy chuẩn bị lại.'
      throw new AppError('VALIDATION', message)
    }
    if (entry.expiresAt <= Date.now()) {
      this.expireHandle(handle)
      throw new AppError('VALIDATION', 'Snapshot Git đã hết hạn; hãy chuẩn bị lại.')
    }
    if (entry.inUse) {
      throw new AppError('VALIDATION', 'Snapshot Git đang được start bởi yêu cầu khác.')
    }
    return this.toLease(entry)
  }

  issuePrecheckToken(handle: string, input: GitDeployInput, assignedHostPort: number): string {
    const entry = this.get(handle)
    if (input.prepared_source_handle !== handle) {
      throw new AppError('VALIDATION', 'Handle Git không khớp với precheck.')
    }
    this.clearTokensForHandle(handle)
    const token = randomUUID()
    const expiresAt = Math.min(Date.now() + PRECHECK_TOKEN_TTL_MS, entry.expiresAt)
    const record: PrecheckTokenRecord = {
      token,
      handle,
      inputFingerprint: toDeployFingerprint(input, assignedHostPort),
      assignedHostPort,
      expiresAt,
      expiryTimer: setTimeout(() => this.expireToken(token), Math.max(0, expiresAt - Date.now())),
      inUse: false
    }
    record.expiryTimer.unref?.()
    this.precheckTokens.set(token, record)
    return token
  }

  reserveStart(input: GitDeployInput): GitStartReservation {
    const lease = this.get(input.prepared_source_handle)
    if (!input.precheck_token) {
      throw new AppError('VALIDATION', 'Git deploy cần precheck mới trước khi start.')
    }
    const token = this.precheckTokens.get(input.precheck_token)
    if (!token || token.handle !== lease.handle || token.expiresAt <= Date.now()) {
      this.expireToken(input.precheck_token)
      throw new AppError(
        'VALIDATION',
        'Precheck Git không hợp lệ hoặc đã hết hạn; hãy precheck lại.'
      )
    }
    if (token.inUse) {
      throw new AppError(
        'VALIDATION',
        'Precheck Git này đang được dùng bởi một yêu cầu start khác.'
      )
    }
    if (toDeployFingerprint(input, token.assignedHostPort) !== token.inputFingerprint) {
      throw new AppError(
        'VALIDATION',
        'Nguồn, VPS, app, cổng hoặc biến môi trường đã đổi sau precheck; hãy chạy precheck lại.'
      )
    }
    if (input.host_port !== undefined && input.host_port !== token.assignedHostPort) {
      throw new AppError('VALIDATION', 'Cổng deploy đã đổi sau precheck; hãy chạy precheck lại.')
    }

    const entry = this.entries.get(lease.handle)!
    entry.inUse = true
    token.inUse = true
    return { lease, assignedHostPort: token.assignedHostPort, token, entry }
  }

  commitStart(reservation: GitStartReservation): PreparedGitLease {
    const current = this.entries.get(reservation.entry.handle)
    if (current !== reservation.entry || !current.inUse) {
      throw new AppError('VALIDATION', 'Snapshot Git không còn khả dụng; hãy chuẩn bị lại.')
    }
    clearTimeout(current.expiryTimer)
    this.entries.delete(current.handle)
    for (const [tokenValue, token] of this.precheckTokens) {
      if (token.handle !== current.handle) continue
      clearTimeout(token.expiryTimer)
      this.precheckTokens.delete(tokenValue)
    }
    this.usedHandles.set(current.handle, Date.now() + PREPARED_SOURCE_TTL_MS)
    return reservation.lease
  }

  releaseStart(reservation: GitStartReservation): void {
    const current = this.entries.get(reservation.entry.handle)
    if (current === reservation.entry) {
      current.inUse = false
      reservation.token.inUse = false
      if (current.expiresAt <= Date.now()) this.expireHandle(current.handle)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const controller of this.prepareControllers.values()) controller.abort()
    for (const handle of this.entries.keys()) this.expireHandle(handle)
    this.precheckTokens.clear()
    this.usedHandles.clear()
  }

  private toLease(entry: PreparedSourceRecord): PreparedGitLease {
    return {
      handle: entry.handle,
      snapshot: entry.snapshot,
      gitRepoUrl: entry.gitRepoUrl,
      gitRef: entry.gitRef,
      gitRoot: entry.gitRoot,
      commitSha: entry.snapshot.commitSha,
      sourcePath: entry.snapshot.rootDirectory,
      expiresAt: entry.expiresAt,
      plan: entry.plan
    }
  }

  private expireHandle(handle: string): void {
    const entry = this.entries.get(handle)
    if (!entry || entry.inUse) return
    clearTimeout(entry.expiryTimer)
    this.entries.delete(handle)
    this.clearTokensForHandle(handle)
    entry.snapshot.cleanup()
  }

  private expireToken(token: string): void {
    const entry = this.precheckTokens.get(token)
    if (!entry || entry.inUse) return
    clearTimeout(entry.expiryTimer)
    this.precheckTokens.delete(token)
  }

  private clearTokensForHandle(handle: string): void {
    for (const [token, entry] of this.precheckTokens) {
      if (entry.handle !== handle || entry.inUse) continue
      clearTimeout(entry.expiryTimer)
      this.precheckTokens.delete(token)
    }
  }

  private pruneUsedHandles(): void {
    const now = Date.now()
    for (const [handle, expiresAt] of this.usedHandles) {
      if (expiresAt <= now) this.usedHandles.delete(handle)
    }
  }
}
