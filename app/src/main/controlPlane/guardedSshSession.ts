import { randomUUID } from 'node:crypto'
import { posix as posixPath } from 'node:path'
import type { ClientChannel } from 'ssh2'

import {
  GUARDED_SSH_MAX_MESSAGES,
  GUARDED_SSH_MAX_SESSION_OUTPUT_BYTES,
  GUARDED_SSH_REQUEST_TIMEOUT_MS,
  GUARDED_SSH_TRANSFER_CHUNK_BYTES,
  GUARDED_SSH_TRANSFER_MAX_FILE_BYTES,
  GUARDED_SSH_TRANSFER_MAX_TOTAL_BYTES,
  GUARDED_SSH_TRANSFER_MAX_FILES,
  type GuardedSshErrorCode,
  type GuardedSshRequest,
  type GuardedSshResponse,
  type GuardedSshSessionInput,
  type GuardedSshTransferScope
} from '../../../../docs/contracts/product-guarded-ssh-session'
import type { TargetWritePhase } from '../../../../docs/contracts/product-target-execution-guard'
import type {
  ProductBeginDispatchResult,
  ProductClaimToken,
  ProductDispatchTargetBinding
} from '../../../../docs/contracts/product-auto-deploy'
import { ProductDeployRepository } from '../db/productDeployRepository'
import type { PreparedProductGitSnapshot } from './productSnapshotPreparation'
import { SshAbortedError, SshManager, type SshVerifiedConnectionIdentity } from '../ssh/manager'
import {
  encodeGuardedSshFrame,
  GuardedSshFrameDecoder,
  GuardedSshProtocolError,
  requireSingleGuardedSshResponse
} from './guardedSshProtocol'

export class GuardedSshSessionError extends Error {
  constructor(readonly code: GuardedSshErrorCode) {
    super(code)
    this.name = 'GuardedSshSessionError'
  }
}

type SessionOptions = Pick<
  GuardedSshSessionInput,
  'vps_id' | 'target_helper_path' | 'target_state_root'
> & {
  signal?: AbortSignal
}

/** One internal SSH channel binds a single durable dispatch to one target guard lifetime. */
export async function openProductGuardedSshSession(
  repository: ProductDeployRepository,
  ssh: SshManager,
  snapshot: PreparedProductGitSnapshot,
  options: SessionOptions
): Promise<GuardedSshExecutionSession> {
  const claim = snapshot.claim
  if (
    !/^\/[A-Za-z0-9_./-]{1,511}$/.test(options.target_helper_path) ||
    options.target_helper_path.includes('..') ||
    !posixPath.isAbsolute(options.target_state_root) ||
    options.target_state_root.length > 1024 ||
    containsControlCharacter(options.target_state_root)
  ) {
    throw new GuardedSshSessionError('SSH_DISPATCH_REJECTED')
  }
  const preDispatchBinding = repository.readGitDispatchTargetBinding(claim)
  if (
    preDispatchBinding.state !== 'ready' ||
    preDispatchBinding.binding.vps_id !== options.vps_id
  ) {
    throw new GuardedSshSessionError('SSH_DISPATCH_REJECTED')
  }
  const dispatch = repository.beginGitDispatch(claim, snapshot.metadata)
  if (dispatch.state !== 'dispatch_authorized') throw mapDispatchResult(dispatch)

  const dispatchedBinding = repository.readGitDispatchTargetBinding(claim, dispatch.deployment_id)
  if (
    dispatchedBinding.state !== 'ready' ||
    !sameTargetBinding(preDispatchBinding.binding, dispatchedBinding.binding)
  ) {
    throw new GuardedSshSessionError('SSH_OUTCOME_UNKNOWN')
  }

  let opened: { channel: ClientChannel; identity: SshVerifiedConnectionIdentity }
  try {
    opened = await ssh.openGuardedExecutionChannelWithIdentity(
      dispatchedBinding.binding.vps_id,
      options.target_helper_path,
      {
        timeoutMs: GUARDED_SSH_REQUEST_TIMEOUT_MS,
        signal: options.signal
      }
    )
  } catch (error) {
    throw mapSshOpenError(error)
  }

  const postOpenBinding = repository.readGitDispatchTargetBinding(claim, dispatch.deployment_id)
  if (
    options.signal?.aborted ||
    postOpenBinding.state !== 'ready' ||
    !sameTargetBinding(dispatchedBinding.binding, postOpenBinding.binding) ||
    !sameSshIdentity(dispatchedBinding.binding, opened.identity)
  ) {
    opened.channel.destroy()
    throw new GuardedSshSessionError(
      options.signal?.aborted ? 'SSH_SESSION_ABORTED' : 'SSH_AUTHORITY_STALE'
    )
  }

  const session = new GuardedSshExecutionSession(
    opened.channel,
    repository,
    claim,
    dispatch.deployment_id,
    dispatchedBinding.binding,
    options.signal,
    GUARDED_SSH_REQUEST_TIMEOUT_MS
  )
  try {
    await session.open(options.target_state_root)
    return session
  } catch (error) {
    session.failClosed()
    throw error
  }
}

export class GuardedSshExecutionSession {
  readonly deploymentId: number
  private readonly decoder = new GuardedSshFrameDecoder()
  private readonly requestTimeoutMs: number
  private sequence = 1
  private pending: ((response: GuardedSshResponse) => void) | null = null
  private pendingReject: ((error: GuardedSshSessionError) => void) | null = null
  private pendingTimer: NodeJS.Timeout | null = null
  private outputBytes = 0
  private stderrBytes = 0
  private stateValue: 'active' | 'closed' | 'reconciliation_required' = 'active'
  private closeRequested = false
  private channelClosed = false
  private transferredBytes = 0
  private transferredFiles = 0
  private currentFileOpen = false
  private resolveCloseWaiter: (() => void) | null = null
  private activeImageTag: string | null = null
  private readonly onAbort: () => void

  constructor(
    private readonly channel: ClientChannel,
    private readonly repository: ProductDeployRepository,
    private readonly claim: ProductClaimToken,
    deploymentId: number,
    private readonly targetBinding: ProductDispatchTargetBinding,
    private readonly signal: AbortSignal | undefined = undefined,
    requestTimeoutMs: number = GUARDED_SSH_REQUEST_TIMEOUT_MS
  ) {
    this.deploymentId = deploymentId
    this.requestTimeoutMs = requestTimeoutMs
    this.onAbort = () => this.failClosed('SSH_SESSION_ABORTED')
    channel.on('data', this.onData)
    channel.stderr.on('data', this.onStderr)
    channel.once('close', this.onClose)
    channel.once('error', this.onChannelError)
    if (signal?.aborted) this.onAbort()
    else signal?.addEventListener('abort', this.onAbort, { once: true })
  }

  get state(): 'active' | 'closed' | 'reconciliation_required' {
    return this.stateValue
  }

  async open(stateRoot: string): Promise<void> {
    this.assertAuthority()
    const identity = {
      controller_id: this.claim.controller_id,
      app_id: String(this.claim.app_id),
      ownership_generation: this.claim.ownership_generation,
      claim_id: this.claim.job_id,
      attempt_id: this.claim.attempt_id,
      app_fence: this.claim.app_fence
    }
    await this.exchange({
      version: 1,
      request_id: randomUUID(),
      sequence: 1,
      operation: 'open',
      identity,
      state_root: stateRoot,
      deployment_id: this.deploymentId
    })
    this.sequence += 1
  }

  async authorizeWritePhase(phase: TargetWritePhase): Promise<void> {
    if (this.stateValue !== 'active') throw new GuardedSshSessionError('SSH_OUTCOME_UNKNOWN')
    if (this.sequence >= GUARDED_SSH_MAX_MESSAGES) {
      this.failClosed('SSH_PROTOCOL_LIMIT')
      throw new GuardedSshSessionError('SSH_PROTOCOL_LIMIT')
    }
    this.assertAuthority()
    await this.exchange({
      version: 1,
      request_id: randomUUID(),
      sequence: this.sequence,
      operation: 'authorize_phase',
      phase,
      deployment_id: this.deploymentId
    })
    this.sequence += 1
  }

  async beginTransferScope(
    scope: GuardedSshTransferScope,
    fileCount: number,
    totalBytes: number,
    manifestSha256: string
  ): Promise<void> {
    if (
      !Number.isSafeInteger(fileCount) ||
      fileCount < 0 ||
      !Number.isSafeInteger(totalBytes) ||
      totalBytes < 0 ||
      !/^[a-f0-9]{64}$/.test(manifestSha256) ||
      this.transferredFiles + fileCount > GUARDED_SSH_TRANSFER_MAX_FILES ||
      this.transferredBytes + totalBytes > GUARDED_SSH_TRANSFER_MAX_TOTAL_BYTES
    ) {
      throw new GuardedSshSessionError('SSH_TRANSFER_REJECTED')
    }
    await this.transferExchange({
      version: 1,
      request_id: randomUUID(),
      sequence: this.sequence,
      operation: 'begin_scope',
      deployment_id: this.deploymentId,
      scope,
      file_count: fileCount,
      total_bytes: totalBytes,
      manifest_sha256: manifestSha256
    })
    this.transferredFiles += fileCount
    this.transferredBytes += totalBytes
  }

  async beginTransferFile(
    scope: GuardedSshTransferScope,
    path: string,
    size: number,
    mode: number,
    sha256: string
  ): Promise<void> {
    if (
      this.currentFileOpen ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > GUARDED_SSH_TRANSFER_MAX_FILE_BYTES ||
      !/^[a-f0-9]{64}$/.test(sha256)
    ) {
      throw new GuardedSshSessionError('SSH_TRANSFER_REJECTED')
    }
    await this.transferExchange({
      version: 1,
      request_id: randomUUID(),
      sequence: this.sequence,
      operation: 'begin_file',
      deployment_id: this.deploymentId,
      scope,
      path,
      size,
      mode,
      sha256
    })
    this.currentFileOpen = true
  }

  async writeTransferChunk(index: number, chunk: Buffer): Promise<void> {
    if (
      !this.currentFileOpen ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      chunk.length === 0 ||
      chunk.length > GUARDED_SSH_TRANSFER_CHUNK_BYTES
    ) {
      throw new GuardedSshSessionError('SSH_TRANSFER_REJECTED')
    }
    await this.transferExchange({
      version: 1,
      request_id: randomUUID(),
      sequence: this.sequence,
      operation: 'file_chunk',
      deployment_id: this.deploymentId,
      chunk_index: index,
      data_base64: chunk.toString('base64')
    })
  }

  async finishTransferFile(): Promise<void> {
    if (!this.currentFileOpen) throw new GuardedSshSessionError('SSH_TRANSFER_REJECTED')
    await this.transferExchange({
      version: 1,
      request_id: randomUUID(),
      sequence: this.sequence,
      operation: 'finish_file',
      deployment_id: this.deploymentId
    })
    this.currentFileOpen = false
  }

  async completeTransferScope(
    scope: GuardedSshTransferScope,
    fileCount: number,
    totalBytes: number,
    manifestSha256: string
  ): Promise<void> {
    if (this.currentFileOpen || !/^[a-f0-9]{64}$/.test(manifestSha256)) {
      throw new GuardedSshSessionError('SSH_TRANSFER_REJECTED')
    }
    await this.transferExchange({
      version: 1,
      request_id: randomUUID(),
      sequence: this.sequence,
      operation: 'complete_scope',
      deployment_id: this.deploymentId,
      scope,
      file_count: fileCount,
      total_bytes: totalBytes,
      manifest_sha256: manifestSha256
    })
  }

  async close(): Promise<void> {
    if (this.stateValue !== 'active') return
    this.closeRequested = true
    await this.exchange({
      version: 1,
      request_id: randomUUID(),
      sequence: this.sequence,
      operation: 'close',
      deployment_id: this.deploymentId
    })
    this.sequence += 1
    if (!this.channelClosed) {
      await new Promise<void>((resolve, reject) => {
        this.resolveCloseWaiter = resolve
        const timer = setTimeout(() => {
          this.resolveCloseWaiter = null
          this.failClosed('SSH_SESSION_TIMEOUT')
          reject(new GuardedSshSessionError('SSH_SESSION_TIMEOUT'))
        }, 5_000)
        const finish = (): void => {
          clearTimeout(timer)
          resolve()
        }
        const previous = this.resolveCloseWaiter
        this.resolveCloseWaiter = () => {
          previous?.()
          finish()
        }
      })
    }
    this.stateValue = 'closed'
    this.removeListeners()
  }

  /** Close the channel without claiming the remote process/command has stopped. */
  failClosed(code: GuardedSshErrorCode = 'SSH_OUTCOME_UNKNOWN'): void {
    if (this.stateValue === 'closed' || this.stateValue === 'reconciliation_required') return
    this.stateValue = 'reconciliation_required'
    this.rejectPending(code)
    this.channel.destroy()
    this.removeListeners()
  }

  private readonly onData = (chunk: Buffer): void => {
    this.outputBytes += chunk.length
    if (this.outputBytes > GUARDED_SSH_MAX_SESSION_OUTPUT_BYTES) {
      this.failClosed('SSH_PROTOCOL_LIMIT')
      return
    }
    try {
      const responses = this.decoder.push(chunk)
      const response = requireSingleGuardedSshResponse(responses)
      if (!response) return
      if (!this.pending) {
        this.failClosed('SSH_PROTOCOL_DUPLICATE')
        return
      }
      const accept = this.pending
      this.clearPending()
      accept(response)
    } catch (error) {
      this.failClosed(
        error instanceof GuardedSshProtocolError ? error.code : 'SSH_PROTOCOL_MALFORMED'
      )
    }
  }

  private readonly onStderr = (chunk: Buffer): void => {
    // stderr is never logged or forwarded; it is bounded and discarded.
    this.stderrBytes += chunk.length
    if (this.stderrBytes > 64 * 1024) this.failClosed('SSH_PROTOCOL_LIMIT')
  }

  private readonly onClose = (): void => {
    try {
      this.decoder.finish()
    } catch (error) {
      this.failClosed(
        error instanceof GuardedSshProtocolError ? error.code : 'SSH_PROTOCOL_TRUNCATED'
      )
      return
    }
    if (this.closeRequested && !this.pending) {
      this.channelClosed = true
      this.resolveCloseWaiter?.()
      this.resolveCloseWaiter = null
      return
    }
    this.failClosed('SSH_SESSION_DISCONNECTED')
  }

  private readonly onChannelError = (): void => this.failClosed('SSH_SESSION_DISCONNECTED')

  async startBuild(imageTag: string): Promise<void> {
    if (this.stateValue !== 'active') throw new GuardedSshSessionError('SSH_OUTCOME_UNKNOWN')
    if (this.sequence >= GUARDED_SSH_MAX_MESSAGES) {
      this.failClosed('SSH_PROTOCOL_LIMIT')
      throw new GuardedSshSessionError('SSH_PROTOCOL_LIMIT')
    }
    if (!/^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+$/.test(imageTag)) {
      throw new GuardedSshSessionError('SSH_BUILD_REJECTED')
    }
    this.activeImageTag = imageTag
    await this.authorizeWritePhase('build')
    this.assertAuthority()
    await this.exchange({
      version: 1,
      request_id: randomUUID(),
      sequence: this.sequence,
      operation: 'start_build',
      deployment_id: this.deploymentId,
      image_tag: imageTag
    })
    this.sequence += 1
  }

  async pollBuild(): Promise<GuardedSshResponse> {
    if (this.stateValue !== 'active') throw new GuardedSshSessionError('SSH_OUTCOME_UNKNOWN')
    if (this.sequence >= GUARDED_SSH_MAX_MESSAGES) {
      this.failClosed('SSH_PROTOCOL_LIMIT')
      throw new GuardedSshSessionError('SSH_PROTOCOL_LIMIT')
    }
    this.assertAuthority()
    const response = await this.exchangeWithResponse({
      version: 1,
      request_id: randomUUID(),
      sequence: this.sequence,
      operation: 'poll_build',
      deployment_id: this.deploymentId
    })
    this.sequence += 1
    return response
  }

  async pollBuildUntilSettled(
    options: {
      timeoutMs?: number
      pollIntervalMs?: number
    } = {}
  ): Promise<
    | { state: 'succeeded'; imageId: string; imageTag: string; labels?: Record<string, string> }
    | { state: 'failed'; exitCode: number; errorTail?: string }
  > {
    const timeoutMs = options.timeoutMs ?? 300_000
    const pollIntervalMs = options.pollIntervalMs ?? 1_000
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      if (this.signal?.aborted) {
        this.failClosed('SSH_SESSION_ABORTED')
        throw new GuardedSshSessionError('SSH_SESSION_ABORTED')
      }
      this.assertAuthority()
      const resp = await this.pollBuild()
      if (resp.build_state === 'succeeded') {
        const isValidImageId =
          typeof resp.image_id === 'string' && /^sha256:[0-9a-f]{64}$/.test(resp.image_id)
        const isExitCodeZero = resp.exit_code === 0
        const isTagValid =
          typeof resp.image_tag === 'string' &&
          resp.image_tag.length > 0 &&
          (this.activeImageTag === null || resp.image_tag === this.activeImageTag)

        if (!isValidImageId || !isExitCodeZero || !isTagValid) {
          this.failClosed('SSH_BUILD_FAILED')
          throw new GuardedSshSessionError('SSH_BUILD_FAILED')
        }
        return {
          state: 'succeeded',
          imageId: resp.image_id,
          imageTag: resp.image_tag,
          labels: resp.labels
        }
      }
      if (resp.build_state === 'failed') {
        return {
          state: 'failed',
          exitCode: resp.exit_code ?? 1,
          errorTail: resp.error_tail
        }
      }
      await new Promise<void>((resolve, reject) => {
        let cleanup = (): void => {}
        const timer = setTimeout(() => {
          cleanup()
          resolve()
        }, pollIntervalMs)
        if (this.signal) {
          const onAbort = (): void => {
            clearTimeout(timer)
            cleanup()
            reject(new GuardedSshSessionError('SSH_SESSION_ABORTED'))
          }
          cleanup = (): void => {
            this.signal?.removeEventListener('abort', onAbort)
          }
          this.signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    }
    this.failClosed('SSH_BUILD_TIMEOUT')
    throw new GuardedSshSessionError('SSH_BUILD_TIMEOUT')
  }

  private exchange(request: GuardedSshRequest): Promise<void> {
    return this.exchangeWithResponse(request).then(() => undefined)
  }

  private exchangeWithResponse(request: GuardedSshRequest): Promise<GuardedSshResponse> {
    if (this.stateValue !== 'active' || this.signal?.aborted) {
      this.failClosed('SSH_SESSION_ABORTED')
      return Promise.reject(new GuardedSshSessionError('SSH_SESSION_ABORTED'))
    }
    if (this.pending) return Promise.reject(new GuardedSshSessionError('SSH_PROTOCOL_DUPLICATE'))
    return new Promise<GuardedSshResponse>((resolve, reject) => {
      this.pending = (response) => {
        if (response.request_id !== request.request_id || response.sequence !== request.sequence) {
          this.failClosed('SSH_PROTOCOL_SEQUENCE')
          reject(new GuardedSshSessionError('SSH_PROTOCOL_SEQUENCE'))
          return
        }
        if (response.state !== 'accepted') {
          const code = response.error_code ?? 'SSH_TARGET_REJECTED'
          this.failClosed(code)
          reject(new GuardedSshSessionError(code))
          return
        }
        if (response.deployment_id !== this.deploymentId) {
          this.failClosed('SSH_TARGET_REJECTED')
          reject(new GuardedSshSessionError('SSH_TARGET_REJECTED'))
          return
        }
        resolve(response)
      }
      this.pendingReject = reject
      this.pendingTimer = setTimeout(
        () => this.failClosed('SSH_SESSION_TIMEOUT'),
        this.requestTimeoutMs
      )
      try {
        this.channel.write(encodeGuardedSshFrame(request))
      } catch {
        this.failClosed('SSH_OUTCOME_UNKNOWN')
      }
    })
  }

  private async transferExchange(
    request: Extract<
      GuardedSshRequest,
      { operation: 'begin_scope' | 'begin_file' | 'file_chunk' | 'finish_file' | 'complete_scope' }
    >
  ): Promise<void> {
    if (this.sequence + 1 >= GUARDED_SSH_MAX_MESSAGES) {
      this.failClosed('SSH_PROTOCOL_LIMIT')
      throw new GuardedSshSessionError('SSH_PROTOCOL_LIMIT')
    }
    await this.authorizeWritePhase('prepare')
    this.assertAuthority()
    await this.exchange({ ...request, sequence: this.sequence })
    this.sequence += 1
  }

  private assertAuthority(): void {
    const binding = this.repository.readGitDispatchTargetBinding(this.claim, this.deploymentId)
    if (
      this.signal?.aborted ||
      binding.state !== 'ready' ||
      !sameTargetBinding(this.targetBinding, binding.binding)
    ) {
      const code = this.signal?.aborted ? 'SSH_SESSION_ABORTED' : 'SSH_AUTHORITY_STALE'
      this.failClosed(code)
      throw new GuardedSshSessionError(code)
    }
  }

  private clearPending(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    this.pendingTimer = null
    this.pending = null
    this.pendingReject = null
  }

  private rejectPending(code: GuardedSshErrorCode): void {
    const reject = this.pendingReject
    this.clearPending()
    reject?.(new GuardedSshSessionError(code))
  }

  private removeListeners(): void {
    this.signal?.removeEventListener('abort', this.onAbort)
    this.channel.removeListener('data', this.onData)
    this.channel.stderr.removeListener('data', this.onStderr)
    this.channel.removeListener('close', this.onClose)
    this.channel.removeListener('error', this.onChannelError)
  }
}

function mapDispatchResult(
  result: Exclude<ProductBeginDispatchResult, { state: 'dispatch_authorized' }>
): GuardedSshSessionError {
  return new GuardedSshSessionError(
    result.state === 'reconciliation_required'
      ? 'SSH_DISPATCH_RECONCILIATION_REQUIRED'
      : 'SSH_DISPATCH_REJECTED'
  )
}

function mapSshOpenError(error: unknown): GuardedSshSessionError {
  if (error instanceof SshAbortedError) return new GuardedSshSessionError('SSH_SESSION_ABORTED')
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'VALIDATION') return new GuardedSshSessionError('SSH_PIN_REJECTED')
    if (error.code === 'SSH_TIMEOUT') return new GuardedSshSessionError('SSH_SESSION_TIMEOUT')
  }
  return new GuardedSshSessionError('SSH_CONNECT_FAILED')
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
}

function sameTargetBinding(
  left: ProductDispatchTargetBinding,
  right: ProductDispatchTargetBinding
): boolean {
  return (
    left.vps_id === right.vps_id &&
    left.host === right.host &&
    left.port === right.port &&
    left.host_fingerprint === right.host_fingerprint &&
    left.username === right.username &&
    left.auth_type === right.auth_type &&
    left.ssh_security_revision === right.ssh_security_revision
  )
}

function sameSshIdentity(
  binding: ProductDispatchTargetBinding,
  identity: SshVerifiedConnectionIdentity
): boolean {
  return (
    binding.vps_id === identity.vpsId &&
    binding.host === identity.host &&
    binding.port === identity.port &&
    binding.host_fingerprint === identity.hostFingerprint &&
    binding.username === identity.username &&
    binding.auth_type === identity.authType
  )
}
