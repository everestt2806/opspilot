import { createHash } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { z } from 'zod'
import type { ClientChannel } from 'ssh2'
import type { SshManager, SshVerifiedConnectionIdentity } from '../ssh/manager'
import type {
  ProductDesktopControllerBindingIntent,
  ProductDesktopControllerBindingMetadata
} from '../../../../docs/contracts/product-controller-api'
import script from './desktop_controller_admin.py?raw'
import catalog from '../../../control-plane-runtime/bundle-files.json'
import { projectRegistrationResultSchema, projectTargetsResultSchema } from './projectRegistration'
import type {
  ProductProjectRegistrationInput,
  ProductProjectRegistrationResult,
  ProductProjectTargetsResult
} from '../../../../docs/contracts/product-project-registration'
import {
  DesktopControllerVault,
  DesktopControllerVaultError,
  desktopEnrollmentResponseSchema
} from './desktopControllerVault'

const code = script.replace(
  'APPROVED_ASSETS = ()',
  'APPROVED_ASSETS = ' + JSON.stringify(Object.keys(catalog).sort())
)
const pinnedScript = { text: code, sha256: createHash('sha256').update(code).digest('hex') }
const replaySchema = z.strictObject({
  state: z.literal('credential_delivery_unknown'),
  controller_id: z.string(),
  client_id: z.uuid()
})
export class DesktopControllerEnrollmentError extends Error {
  constructor(
    readonly code:
      | 'CONTROLLER_ADMIN_FAILED'
      | 'CONTROLLER_IDENTITY_MISMATCH'
      | 'CONTROLLER_BUNDLE_VERIFICATION_FAILED'
      | 'CONTROLLER_NODE_UNSUPPORTED'
      | 'REQUEST_ABORTED'
      | 'REQUEST_TIMEOUT'
  ) {
    super(code)
  }
}
function samePrincipal(
  first: SshVerifiedConnectionIdentity,
  second: SshVerifiedConnectionIdentity
): boolean {
  return (Object.keys(first) as Array<keyof SshVerifiedConnectionIdentity>).every(
    (key) => first[key] === second[key]
  )
}
/** Trusted main only; secret-bearing reply is consumed directly by vault, never renderer. */
export class DesktopControllerEnrollment {
  constructor(
    private readonly vault: DesktopControllerVault,
    private readonly ssh: Pick<SshManager, 'openProductBootstrapChannel'>
  ) {}
  async revoke(
    bindingId: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<ProductDesktopControllerBindingMetadata> {
    const before = this.vault.get(bindingId),
      intent = this.vault.intent(bindingId)
    if (!before.remote_client_id) throw new DesktopControllerVaultError('BINDING_UNAVAILABLE')
    const digest = createHash('sha256')
      .update(`desktop-revoke:${bindingId}:${before.remote_client_id}`)
      .digest('hex')
      .slice(0, 32)
    const requestKey = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20)}`
    const raw = await this.exchange(intent, options, {
      operation: 'revoke-desktop-client',
      payload: { request_key: requestKey, client_id: before.remote_client_id }
    })
    const reply = z
      .strictObject({ client_id: z.uuid(), revoked_at: z.iso.datetime() })
      .safeParse(raw)
    if (!reply.success || reply.data.client_id !== before.remote_client_id)
      throw new DesktopControllerEnrollmentError('CONTROLLER_ADMIN_FAILED')
    const current = this.vault.get(bindingId)
    if (current.remote_client_id !== before.remote_client_id)
      throw new DesktopControllerVaultError('BINDING_CHANGED')
    if (current.state === 'disabled') return current
    return this.vault.disable(bindingId, current.revision)
  }
  async projectTargets(
    bindingId: string,
    query: { after_id: number | null; limit: number } | { target_id: number }
  ): Promise<ProductProjectTargetsResult> {
    return this.projectOperation(bindingId, 'project-targets', query, projectTargetsResultSchema)
  }
  async registerProject(
    bindingId: string,
    input: ProductProjectRegistrationInput
  ): Promise<ProductProjectRegistrationResult> {
    return this.projectOperation(
      bindingId,
      'register-project',
      input,
      projectRegistrationResultSchema
    )
  }
  private async projectOperation<T extends { controller_id: string }>(
    bindingId: string,
    operation: 'project-targets' | 'register-project',
    payload: object,
    schema: z.ZodType<T>
  ): Promise<T> {
    const before = this.vault.resolve(bindingId),
      intent = this.vault.intent(bindingId)
    const reply = await this.exchange(
      intent,
      {},
      {
        operation,
        payload: { ...payload, controller_id: intent.controller_id },
        expected_revision: before.revision
      }
    )
    const after = this.vault.resolve(bindingId)
    if (
      before.revision !== after.revision ||
      before.controllerId !== after.controllerId ||
      before.accessToken !== after.accessToken
    )
      throw new DesktopControllerVaultError('BINDING_CHANGED')
    const parsed = schema.safeParse(reply)
    if (!parsed.success || parsed.data.controller_id !== intent.controller_id)
      throw new DesktopControllerEnrollmentError('CONTROLLER_ADMIN_FAILED')
    return parsed.data
  }
  async enroll(
    bindingId: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<ProductDesktopControllerBindingMetadata> {
    const timeout = options.timeoutMs ?? 45_000
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000)
      throw new DesktopControllerVaultError('REQUEST_INVALID')
    if (options.signal?.aborted) throw new DesktopControllerEnrollmentError('REQUEST_ABORTED')
    let before = this.vault.get(bindingId)
    if (before.state === 'active') {
      this.vault.resolve(bindingId)
      return before
    }
    if (before.state === 'disabled') throw new DesktopControllerVaultError('BINDING_CHANGED')
    const intent = this.vault.intent(bindingId)
    try {
      const raw = await this.exchange(intent, options)
      const issued = desktopEnrollmentResponseSchema.safeParse(raw),
        replay = replaySchema.safeParse(raw)
      if (
        (!issued.success && !replay.success) ||
        (issued.success ? issued.data.controller_id : replay.data!.controller_id) !==
          intent.controller_id
      )
        throw new DesktopControllerEnrollmentError('CONTROLLER_ADMIN_FAILED')
      // A concurrent enrollment or local disable may have completed while SSH was in flight.
      for (let attempt = 0; attempt < 2; attempt++) {
        before = this.vault.get(bindingId)
        if (before.state === 'active') {
          this.vault.resolve(bindingId)
          return before
        }
        if (before.state === 'disabled') throw new DesktopControllerVaultError('BINDING_CHANGED')
        this.vault.intent(bindingId) // Fresh current VPS/profile check before persisting credential.
        try {
          return issued.success
            ? this.vault.activate(bindingId, before.revision, issued.data)
            : this.vault.deliveryUnknown(bindingId, before.revision, replay.data!.client_id)
        } catch (error) {
          if (
            !(error instanceof DesktopControllerVaultError) ||
            error.code !== 'BINDING_CHANGED' ||
            attempt === 1
          )
            throw error
        }
      }
      throw new DesktopControllerVaultError('BINDING_CHANGED')
    } catch (error) {
      const current = this.vault.get(bindingId)
      if (current.state === 'pending') this.vault.deliveryUnknown(bindingId, current.revision)
      if (
        error instanceof DesktopControllerEnrollmentError ||
        error instanceof DesktopControllerVaultError
      )
        throw error
      throw new DesktopControllerEnrollmentError('CONTROLLER_ADMIN_FAILED')
    }
  }
  private async exchange(
    intent: ProductDesktopControllerBindingIntent,
    options: { signal?: AbortSignal; timeoutMs?: number },
    command?: {
      operation: 'revoke-desktop-client' | 'project-targets' | 'register-project'
      payload: object
      expected_revision?: number
    }
  ): Promise<unknown> {
    const timeout = options.timeoutMs ?? 45_000
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000)
      throw new DesktopControllerVaultError('REQUEST_INVALID')
    if (options.signal?.aborted) throw new DesktopControllerEnrollmentError('REQUEST_ABORTED')
    const stop = new AbortController()
    let channel: ClientChannel | undefined,
      expired = false
    const abort = (): void => stop.abort()
    const timer = setTimeout(() => {
      expired = true
      stop.abort()
    }, timeout)
    options.signal?.addEventListener('abort', abort, { once: true })
    let rejectStopped!: () => void
    const stopped = new Promise<never>((_resolve, reject) => {
      rejectStopped = () => {
        channel?.destroy()
        reject(
          new DesktopControllerEnrollmentError(expired ? 'REQUEST_TIMEOUT' : 'REQUEST_ABORTED')
        )
      }
      stop.signal.addEventListener('abort', rejectStopped, { once: true })
    })
    const work = async (): Promise<unknown> => {
      const opened = await this.ssh.openProductBootstrapChannel(intent.vps_id, pinnedScript, {
        signal: stop.signal,
        expectedIdentity: intent.principal,
        timeoutMs: Math.min(timeout, 30_000)
      })
      channel = opened.channel
      channel.on('error', ignoreError)
      channel.stderr.on('data', discardStderr)
      if (stop.signal.aborted) {
        channel.destroy()
        throw new DesktopControllerEnrollmentError('REQUEST_ABORTED')
      }
      if (!samePrincipal(intent.principal, opened.identity))
        throw new DesktopControllerEnrollmentError('CONTROLLER_IDENTITY_MISMATCH')
      const current = this.vault.intent(intent.binding_id)
      if (
        !samePrincipal(current.principal, intent.principal) ||
        this.vault.get(intent.binding_id).state === 'disabled' ||
        (command?.expected_revision !== undefined &&
          this.vault.get(intent.binding_id).revision !== command.expected_revision)
      )
        throw new DesktopControllerVaultError('BINDING_CHANGED')
      const body = JSON.stringify({
        operation: command?.operation ?? 'enroll-desktop-client',
        artifact_path: intent.artifact_path,
        data_directory: intent.data_directory,
        node_path: intent.node_path,
        manifest_sha256: intent.manifest_sha256,
        controller_id: intent.controller_id,
        payload: command?.payload ?? {
          request_key: intent.binding_id,
          display_name: intent.display_name,
          requested_scopes: intent.requested_scopes
        }
      })
      if (Buffer.byteLength(body) > 16384) throw new DesktopControllerVaultError('REQUEST_INVALID')
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        let size = 0,
          settled = false,
          ended = false
        const fail = (): void => {
          if (!settled) {
            settled = true
            reject(new DesktopControllerEnrollmentError('CONTROLLER_ADMIN_FAILED'))
          }
          channel?.destroy()
        }
        channel!.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 65536) fail()
          else chunks.push(chunk)
        })
        channel!.once('error', fail)
        channel!.once('end', () => {
          ended = true
        })
        channel!.once('close', (exitCode: number | undefined) => {
          if (settled) return
          try {
            if (!ended || exitCode !== 0) throw new Error()
            const decoded: unknown = JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
            )
            const failure = z
              .strictObject({
                ok: z.literal(false),
                code: z.enum([
                  'CONTROLLER_ADMIN_FAILED',
                  'CONTROLLER_IDENTITY_MISMATCH',
                  'CONTROLLER_BUNDLE_VERIFICATION_FAILED',
                  'CONTROLLER_NODE_UNSUPPORTED'
                ])
              })
              .safeParse(decoded)
            if (failure.success) {
              settled = true
              reject(new DesktopControllerEnrollmentError(failure.data.code))
              return
            }
            const envelope = z
              .strictObject({ ok: z.literal(true), data: z.unknown() })
              .safeParse(decoded)
            if (!envelope.success) throw new Error()
            settled = true
            resolve(envelope.data.data)
          } catch {
            fail()
          }
        })
        channel!.end(body)
      })
    }
    try {
      return await Promise.race([work(), stopped])
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      stop.signal.removeEventListener('abort', rejectStopped)
      channel?.destroy()
    }
  }
}
function ignoreError(): void {
  /* Raw SSH errors never leave main. */
}
function discardStderr(): void {
  /* Do not buffer/log arbitrary remote stderr. */
}
