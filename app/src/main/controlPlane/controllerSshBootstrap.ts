import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { ClientChannel } from 'ssh2'
import { z } from 'zod'
import type { SshManager, SshVerifiedConnectionIdentity } from '../ssh/manager'
import catalog from '../../../control-plane-runtime/bundle-files.json'
import script from '../../../control-plane-runtime/controller_ssh_bootstrap.py?raw'
import {
  controllerRuntimeLock,
  productionPackages,
  readReleaseFile,
  releaseSha256,
  verifyControllerRelease
} from './controllerRelease'
import {
  CONTROLLER_SSH_BOOTSTRAP_LIMITS as limits,
  type ControllerBootstrapErrorCode,
  type ControllerBootstrapLocator,
  type ControllerBootstrapOperation,
  type ControllerBootstrapResult,
  type ControllerBootstrapDiscovery
} from '../../../../docs/contracts/product-controller-ssh-bootstrap'
import type { InstalledControllerAdminRequest } from '../../../../docs/contracts/product-installed-controller-admin'
import { installedControllerAdminSchema } from './installedControllerAdminProtocol'
import { controllerUpgradeResultSchema } from './controllerUpgradeProtocol'
import { parseControllerUpgradeRequest } from './controllerUpgrade'
import type {
  ControllerUpgradeRequest,
  ControllerUpgradeResult
} from '../../../../docs/contracts/product-controller-upgrade'

const locatorSchema = z
  .object({
    request_key: z.uuidv4().refine((v) => v === v.toLowerCase()),
    release_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .length(64),
    installer_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .length(64)
  })
  .strict()
const phases = [
  'prepared',
  'account_pending',
  'account_ready',
  'runtime_pending',
  'runtime_ready',
  'data_pending',
  'data_ready',
  'database_pending',
  'database_ready',
  'key_pending',
  'key_ready',
  'unit_pending',
  'unit_ready',
  'start_pending',
  'installed'
] as const
const safePath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (v) =>
      v.startsWith('/') &&
      !/[^A-Za-z0-9_./-]/.test(v) &&
      v
        .split('/')
        .slice(1)
        .every((p) => p.length > 0 && p !== '.' && p !== '..')
  )
export const controllerInstallationResultSchema = z
  .object({
    format: z.literal(1),
    request_key: z.uuidv4(),
    phase: z.enum(phases),
    controller_id: z.uuidv4().nullable(),
    service_state: z.enum(['running', 'stopped', 'starting', 'failed', 'not_installed']),
    runtime_uid: z.number().int().positive().nullable(),
    service_enabled: z.boolean(),
    artifact_path: safePath,
    node_path: safePath,
    data_directory: safePath,
    payload_sha256: locatorSchema.shape.release_sha256
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (phases.indexOf(value.phase) >= phases.indexOf('account_ready') &&
        value.runtime_uid === null) ||
      (phases.indexOf(value.phase) >= phases.indexOf('database_ready') &&
        value.controller_id === null) ||
      (value.service_state === 'running' &&
        (value.runtime_uid === null || value.controller_id === null))
    )
      ctx.addIssue({ code: 'custom', message: 'INCONSISTENT_INSTALLATION_STATE' })
  })
const resultSchema = z.union([
  locatorSchema
    .extend({
      state: z.enum(['absent', 'uploading', 'verified']),
      completed_files: z.number().int().min(0).max(10001),
      total_files: z.number().int().min(0).max(10001)
    })
    .strict(),
  z
    .object({
      state: z.literal('installation_result'),
      request_key: z.uuidv4(),
      installation: controllerInstallationResultSchema
    })
    .strict()
])
const errorCodes: ControllerBootstrapErrorCode[] = [
  'BOOTSTRAP_INPUT_INVALID',
  'BOOTSTRAP_ROOT_REQUIRED',
  'BOOTSTRAP_HOST_UNSUPPORTED',
  'BOOTSTRAP_PIN_MISMATCH',
  'BOOTSTRAP_CONFLICT',
  'BOOTSTRAP_BUSY',
  'BOOTSTRAP_UNAVAILABLE',
  'BOOTSTRAP_LIMIT',
  'BOOTSTRAP_ABORTED',
  'BOOTSTRAP_OUTCOME_UNKNOWN',
  'BOOTSTRAP_AUTHORITY_CHANGED',
  'BOOTSTRAP_ARTIFACT_CHANGED',
  'BOOTSTRAP_NOT_FOUND',
  'BOOTSTRAP_INSTALLER_FAILED'
]

export class ControllerBootstrapError extends Error {
  constructor(
    readonly code: ControllerBootstrapErrorCode,
    readonly remote_effects_possible = false
  ) {
    super(code)
  }
}

/** Code/path chỉ từ Main catalog hoặc trusted lab seam; không nhận script từ renderer/JSON. */
export function controllerBootstrapScript(): { text: string; sha256: string } {
  const packages = Object.fromEntries(productionPackages().map(({ path, ...rest }) => [path, rest]))
  const text = script
    .replace(
      'APPROVED_LOCK_SHA = ""',
      'APPROVED_LOCK_SHA = ' + JSON.stringify(releaseSha256(controllerRuntimeLock))
    )
    .replace(
      'APPROVED_PACKAGES = {}',
      'APPROVED_PACKAGES = json.loads(' + JSON.stringify(JSON.stringify(packages)) + ')'
    )
    .replace(
      'APPROVED_PAYLOAD = []',
      'APPROVED_PAYLOAD = ' + JSON.stringify(Object.keys(catalog).sort())
    )
  return { text, sha256: createHash('sha256').update(text).digest('hex') }
}

export type ControllerBootstrapArtifacts = {
  release_directory: string
  installer_path: string
}
type BootstrapInput = {
  /** Main-only namespace selector; không nhận từ IPC. */
  purpose?: 'upgrade'
  ssh: Pick<SshManager, 'openProductBootstrapChannel'>
  vpsId: number
  expectedIdentity: SshVerifiedConnectionIdentity
  locator: ControllerBootstrapLocator
  assertCurrent: () => void
  signal?: AbortSignal
  /** @internal Pinned executable composition seam; never exposed through IPC/CLI JSON. */
  bootstrapScript?: { text: string; sha256: string }
}

/** Transfer chỉ staging, không tự install. Mọi retry/recovery phải do caller chỉ định cùng UUID/pins. */
export async function transferControllerRelease(
  input: BootstrapInput & {
    consent: true
    artifacts: ControllerBootstrapArtifacts
    onProgress?: (value: {
      completed_files: number
      total_files: number
      sent_bytes: number
    }) => void
  }
): Promise<ControllerBootstrapResult> {
  input = {
    ...input,
    locator: { ...input.locator },
    expectedIdentity: { ...input.expectedIdentity },
    artifacts: { ...input.artifacts }
  }
  if (input.consent !== true) throw new ControllerBootstrapError('BOOTSTRAP_INPUT_INVALID')
  let manifest: ReturnType<typeof verifyControllerRelease>, raw: Buffer, tool: Buffer
  try {
    locatorSchema.parse(input.locator)
    manifest = verifyControllerRelease(
      input.artifacts.release_directory,
      input.locator.release_sha256
    )
    raw = readReleaseFile(
      join(input.artifacts.release_directory, 'release-manifest.json'),
      limits.manifest
    )
    tool = readReleaseFile(input.artifacts.installer_path, limits.installer)
    if (
      releaseSha256(raw) !== input.locator.release_sha256 ||
      releaseSha256(tool) !== input.locator.installer_sha256 ||
      raw.length + tool.length + manifest.files.reduce((n, v) => n + v.size, 0) > limits.total
    )
      throw Error()
  } catch {
    throw new ControllerBootstrapError('BOOTSTRAP_ARTIFACT_CHANGED')
  }
  return withBootstrap(input, 'transfer', async (wire) => {
    await wire.sendFrame({
      format: 1,
      operation: 'transfer',
      ...(input.purpose ? { purpose: input.purpose } : {}),
      ...input.locator,
      consent: true,
      manifest_size: raw.length,
      installer_size: tool.length
    })
    const hello = await wire.receive()
    if (Object.keys(hello).join(',') !== 'state' || hello.state !== 'send_manifest')
      throw new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE')
    await wire.send(raw)
    const files = [
      ...manifest.files.map((v) => ({
        ...v,
        local: join(input.artifacts.release_directory, v.path)
      })),
      {
        path: 'installer.cjs',
        size: tool.length,
        sha256: input.locator.installer_sha256,
        local: input.artifacts.installer_path
      }
    ]
    let sent = raw.length
    for (let index = 0; index < files.length; index++) {
      const message = await wire.receive()
      if (
        Object.keys(message).sort().join(',') !== 'index,needed,state' ||
        message.state !== 'send_file' ||
        message.index !== index ||
        typeof message.needed !== 'boolean'
      )
        throw new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE')
      await wire.send(Buffer.from([1]))
      if (message.needed) {
        let bytes: Buffer
        try {
          bytes =
            files[index].path === 'installer.cjs'
              ? tool
              : readReleaseFile(files[index].local, files[index].size)
          if (bytes.length !== files[index].size || releaseSha256(bytes) !== files[index].sha256)
            throw Error()
        } catch {
          throw new ControllerBootstrapError('BOOTSTRAP_ARTIFACT_CHANGED')
        }
        await wire.send(bytes)
        sent += bytes.length
      }
      input.onProgress?.({
        completed_files: index + 1,
        total_files: files.length,
        sent_bytes: sent
      })
    }
    wire.end()
    const result = checkedResult(await wire.receive(), input.locator, 'transfer')
    if (result.state !== 'verified' || result.total_files !== files.length)
      throw new ControllerBootstrapError('BOOTSTRAP_CONFLICT')
    return result
  })
}

export async function callControllerBootstrap(
  input: BootstrapInput & {
    operation: Exclude<
      ControllerBootstrapOperation,
      'transfer' | 'discover' | 'admin' | 'upgrade-call'
    >
    consent?: true
  }
): Promise<ControllerBootstrapResult> {
  input = {
    ...input,
    locator: { ...input.locator },
    expectedIdentity: { ...input.expectedIdentity }
  }
  if (
    !['status', 'install', 'inspect', 'recover'].includes(input.operation) ||
    (['install', 'recover'].includes(input.operation) && input.consent !== true)
  )
    throw new ControllerBootstrapError('BOOTSTRAP_INPUT_INVALID')
  try {
    locatorSchema.parse(input.locator)
  } catch {
    throw new ControllerBootstrapError('BOOTSTRAP_INPUT_INVALID')
  }
  return withBootstrap(input, input.operation, async (wire) => {
    await wire.sendFrame({
      format: 1,
      operation: input.operation,
      ...(input.purpose ? { purpose: input.purpose } : {}),
      ...input.locator,
      ...(['install', 'recover'].includes(input.operation) ? { consent: true } : {})
    })
    wire.end()
    return checkedResult(await wire.receive(), input.locator, input.operation)
  })
}

/** Readonly locator hint. Caller MUST match both pins against its protected catalog. */
export async function discoverControllerBootstrap(
  input: Omit<BootstrapInput, 'locator'>
): Promise<ControllerBootstrapDiscovery> {
  input = { ...input, expectedIdentity: { ...input.expectedIdentity } }
  return withBootstrap(input, 'discover', async (wire) => {
    await wire.sendFrame({ format: 1, operation: 'discover' })
    wire.end()
    const value = await wire.receive()
    const parsed = z
      .union([
        z.object({ state: z.literal('absent') }).strict(),
        locatorSchema.extend({ state: z.literal('discovered') }).strict()
      ])
      .safeParse(value)
    if (!parsed.success) throw new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE')
    return parsed.data
  })
}

/** Fixed root upgrader, staged tool/release pins independently verified by receiver. */
export async function callControllerUpgrade(
  input: BootstrapInput & { request: ControllerUpgradeRequest }
): Promise<ControllerUpgradeResult> {
  input = { ...input, expectedIdentity: { ...input.expectedIdentity } }
  const locator = locatorSchema.parse(input.locator)
  const request = parseControllerUpgradeRequest(input.request)
  if (
    request.request_key !== locator.request_key ||
    request.release_sha256 !== locator.release_sha256
  )
    throw new ControllerBootstrapError('BOOTSTRAP_CONFLICT')
  const { release_directory: _path, ...wireRequest } =
    request.operation === 'upgrade' || request.operation === 'recover-upgrade'
      ? request
      : { ...request, release_directory: undefined }
  void _path
  const bytes = Buffer.from(JSON.stringify(wireRequest))
  if (bytes.length > 4096) throw new ControllerBootstrapError('BOOTSTRAP_LIMIT')
  return withBootstrap(input, 'upgrade-call', async (wire) => {
    await wire.sendFrame({
      format: 1,
      operation: 'upgrade-call',
      purpose: 'upgrade',
      ...locator,
      request_size: bytes.length
    })
    await wire.send(bytes)
    wire.end()
    const value = z
      .strictObject({
        state: z.literal('upgrade_result'),
        request_key: z.uuidv4(),
        result: controllerUpgradeResultSchema
      })
      .parse(await wire.receive())
    if (
      value.request_key !== locator.request_key ||
      Object.entries(wireRequest).some(
        ([key, v]) =>
          !['operation', 'consent'].includes(key) &&
          value.result[key as keyof ControllerUpgradeResult] !== v
      )
    )
      throw new ControllerBootstrapError('BOOTSTRAP_CONFLICT')
    return value.result
  })
}

/** Main-only secret-bearing response; enrollment consumes it directly into the encrypted vault. */
export async function administerInstalledController(
  input: BootstrapInput & { request: InstalledControllerAdminRequest }
): Promise<unknown> {
  input = { ...input, expectedIdentity: { ...input.expectedIdentity } }
  let bytes: Buffer
  try {
    locatorSchema.parse(input.locator)
    bytes = Buffer.from(JSON.stringify(installedControllerAdminSchema.parse(input.request)))
    if (
      bytes.length > 512 * 1024 ||
      input.request.format !== 1 ||
      input.request.operation !== 'admin' ||
      Object.entries(input.locator).some(
        ([key, value]) => input.request.authority[key as keyof typeof input.locator] !== value
      )
    )
      throw Error()
  } catch {
    throw new ControllerBootstrapError('BOOTSTRAP_INPUT_INVALID')
  }
  const locator = { ...input.locator }
  if (!!input.request.authority.revision !== (input.purpose === 'upgrade'))
    throw new ControllerBootstrapError('BOOTSTRAP_INPUT_INVALID')
  return withBootstrap(
    { ...input, expectedIdentity: { ...input.expectedIdentity } },
    'admin',
    async (wire) => {
      await wire.sendFrame({
        format: 1,
        operation: 'admin',
        ...(input.purpose ? { purpose: input.purpose } : {}),
        ...locator,
        request_size: bytes.length
      })
      await wire.send(bytes)
      wire.end()
      const response = z
        .strictObject({
          state: z.literal('admin_result'),
          request_key: z.uuidv4(),
          result: z.unknown()
        })
        .safeParse(await wire.receive())
      if (!response.success || response.data.request_key !== locator.request_key)
        throw new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE')
      return response.data.result
    },
    65536
  )
}

function checkedResult(
  value: unknown,
  locator: ControllerBootstrapLocator,
  operation: ControllerBootstrapOperation
): ControllerBootstrapResult {
  const parsed = resultSchema.safeParse(value)
  if (!parsed.success) throw new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE')
  const result = parsed.data
  if (result.request_key !== locator.request_key)
    throw new ControllerBootstrapError('BOOTSTRAP_CONFLICT')
  if (result.state === 'installation_result') {
    if (
      !['install', 'inspect', 'recover'].includes(operation) ||
      result.installation.request_key !== locator.request_key
    )
      throw new ControllerBootstrapError('BOOTSTRAP_CONFLICT')
  } else {
    if (result.state === 'absent' && (result.completed_files !== 0 || result.total_files !== 0))
      throw new ControllerBootstrapError('BOOTSTRAP_CONFLICT')
    if (
      !['transfer', 'status'].includes(operation) ||
      result.release_sha256 !== locator.release_sha256 ||
      result.installer_sha256 !== locator.installer_sha256 ||
      result.completed_files > result.total_files ||
      (result.state === 'verified' &&
        (result.total_files === 0 || result.completed_files !== result.total_files)) ||
      (operation === 'transfer' && result.state !== 'verified')
    )
      throw new ControllerBootstrapError('BOOTSTRAP_CONFLICT')
  }
  return result
}

interface BootstrapWire {
  sendFrame: (value: unknown) => Promise<void>
  send: (value: Buffer) => Promise<void>
  receive: () => Promise<Record<string, unknown>>
  end: () => void
}

async function withBootstrap<T>(
  input: Omit<BootstrapInput, 'locator'>,
  operation: ControllerBootstrapOperation,
  action: (wire: BootstrapWire) => Promise<T>,
  replyLimit: number = limits.frame
): Promise<T> {
  let channel: ClientChannel | undefined,
    effects = false,
    timer: ReturnType<typeof setTimeout> | undefined
  const mutates = ['transfer', 'install', 'recover', 'admin', 'upgrade-call'].includes(operation)
  const assert = (): void => {
    if (input.signal?.aborted) throw new ControllerBootstrapError('BOOTSTRAP_ABORTED')
    try {
      input.assertCurrent()
    } catch {
      throw new ControllerBootstrapError('BOOTSTRAP_AUTHORITY_CHANGED')
    }
  }
  try {
    if (
      !input.expectedIdentity ||
      input.expectedIdentity.vpsId !== input.vpsId ||
      typeof input.assertCurrent !== 'function'
    )
      throw new ControllerBootstrapError('BOOTSTRAP_INPUT_INVALID')
    assert()
    const opened = await input.ssh.openProductBootstrapChannel(
      input.vpsId,
      input.bootstrapScript ?? controllerBootstrapScript(),
      { expectedIdentity: { ...input.expectedIdentity }, signal: input.signal, timeoutMs: 15000 }
    )
    channel = opened.channel
    assert()
    if (
      Object.entries(input.expectedIdentity).some(
        ([key, value]) => opened.identity[key as keyof SshVerifiedConnectionIdentity] !== value
      )
    )
      throw new ControllerBootstrapError('BOOTSTRAP_AUTHORITY_CHANGED')
    let failure: ControllerBootstrapError | undefined,
      buffer = Buffer.alloc(0),
      stderr = 0,
      closed = false
    const queue: Record<string, unknown>[] = []
    let waiter:
      | { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
      | undefined
    const pendingWrites = new Set<(error: Error) => void>()
    const reject = (error: ControllerBootstrapError): void => {
      if (failure) return
      failure = error
      waiter?.reject(error)
      waiter = undefined
      for (const rejectWrite of pendingWrites) rejectWrite(error)
      channel?.destroy()
    }
    const abort = (): void => reject(new ControllerBootstrapError('BOOTSTRAP_ABORTED'))
    input.signal?.addEventListener('abort', abort, { once: true })
    const receive = (): Promise<Record<string, unknown>> => {
      assert()
      if (failure) return Promise.reject(failure)
      const ready = queue.shift()
      if (ready) return Promise.resolve(ready)
      if (closed) return Promise.reject(new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE'))
      if (waiter) return Promise.reject(new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE'))
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject }
      })
    }
    channel.on('data', (chunk: Buffer) => {
      if (failure) return
      if (buffer.length + chunk.length > replyLimit * 4)
        return reject(new ControllerBootstrapError('BOOTSTRAP_LIMIT'))
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const size = buffer.readUInt32BE(0)
        if (size < 1 || size > replyLimit)
          return reject(new ControllerBootstrapError('BOOTSTRAP_LIMIT'))
        if (buffer.length < size + 4) break
        let value: Record<string, unknown>
        try {
          value = JSON.parse(buffer.subarray(4, size + 4).toString('utf8'))
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error()
        } catch {
          return reject(new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE'))
        }
        buffer = buffer.subarray(size + 4)
        if (value.state === 'error') {
          if (Object.keys(value).sort().join(',') !== 'code,state')
            return reject(new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE'))
          return reject(
            new ControllerBootstrapError(
              errorCodes.includes(value.code as ControllerBootstrapErrorCode)
                ? (value.code as ControllerBootstrapErrorCode)
                : 'BOOTSTRAP_UNAVAILABLE'
            )
          )
        }
        if (waiter) {
          const current = waiter
          waiter = undefined
          current.resolve(value)
        } else {
          if (queue.length >= 2) return reject(new ControllerBootstrapError('BOOTSTRAP_LIMIT'))
          queue.push(value)
        }
      }
    })
    channel.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.length
      if (stderr > 4096) reject(new ControllerBootstrapError('BOOTSTRAP_LIMIT'))
    })
    channel.on('error', () => reject(new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE')))
    channel.on('close', () => {
      closed = true
      if (waiter || pendingWrites.size || buffer.length)
        reject(new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE'))
    })
    timer = setTimeout(
      () => reject(new ControllerBootstrapError('BOOTSTRAP_OUTCOME_UNKNOWN')),
      limits.timeout_ms
    )
    const send = async (value: Buffer): Promise<void> => {
      for (let offset = 0; offset < value.length; offset += limits.chunk) {
        assert()
        if (failure) throw failure
        if (closed) throw new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE')
        effects ||= mutates
        const chunk = value.subarray(offset, offset + limits.chunk)
        if (!channel!.write(chunk))
          await new Promise<void>((resolve, rejectWrite) => {
            const onFailure = (error: Error): void => {
              channel!.removeListener('drain', onDrain)
              pendingWrites.delete(onFailure)
              rejectWrite(error)
            }
            const onDrain = (): void => {
              pendingWrites.delete(onFailure)
              resolve()
            }
            pendingWrites.add(onFailure)
            channel!.once('drain', onDrain)
            if (failure || closed)
              onFailure(failure ?? new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE'))
          })
      }
    }
    try {
      const result = await action({
        send,
        sendFrame: async (value) => {
          const body = Buffer.from(JSON.stringify(value))
          if (body.length > limits.frame) throw new ControllerBootstrapError('BOOTSTRAP_LIMIT')
          const length = Buffer.alloc(4)
          length.writeUInt32BE(body.length)
          await send(Buffer.concat([length, body]))
        },
        receive,
        end: () => {
          assert()
          channel!.end()
        }
      })
      assert()
      if (failure) throw failure
      if (buffer.length || queue.length) throw new ControllerBootstrapError('BOOTSTRAP_UNAVAILABLE')
      return result
    } finally {
      input.signal?.removeEventListener('abort', abort)
    }
  } catch (error) {
    const code = error instanceof ControllerBootstrapError ? error.code : 'BOOTSTRAP_UNAVAILABLE'
    throw new ControllerBootstrapError(
      effects && ['BOOTSTRAP_UNAVAILABLE', 'BOOTSTRAP_ABORTED'].includes(code)
        ? 'BOOTSTRAP_OUTCOME_UNKNOWN'
        : code,
      effects
    )
  } finally {
    if (timer) clearTimeout(timer)
    channel?.destroy()
  }
}
