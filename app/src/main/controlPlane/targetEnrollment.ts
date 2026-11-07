import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { ClientChannel } from 'ssh2'
import { z } from 'zod'
import {
  PRODUCT_TARGET_ENROLLMENT_MAX_INPUT_BYTES,
  PRODUCT_TARGET_ENROLLMENT_MAX_OUTPUT_BYTES,
  type ProductTargetEnrollmentPayload
} from '../../../../docs/contracts/product-target-enrollment'
import {
  verifyControllerBundle,
  readVerifiedControllerBundleFile,
  type VerifiedControllerBundle
} from './controllerBundle'
import { createControllerRuntimeKey, loadControllerRuntimeKey } from './controllerRuntimeKeys'
import { createControllerSshResolver } from './controllerSshResolver'
import { SshManager } from '../ssh/manager'
import { makeTargetEnrollmentPayload, verifyTargetEnrollmentProof } from './targetEnrollmentProof'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { canonicalH2Json } from './productH2Proof'

const requestSchema = z.strictObject({
  format: z.literal(1),
  controller_id: z
    .string()
    .min(1)
    .max(128)
    .refine((s) => /^[A-Za-z0-9]/.test(s) && !/[^A-Za-z0-9_.-]/.test(s)),
  app_id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  ownership_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  artifact: z.string().min(1),
  manifest_sha256: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/),
  target_root: z
    .string()
    .min(2)
    .max(512)
    .refine(
      (s) =>
        /^\/[A-Za-z0-9_./-]+$/.test(s) &&
        !/[^A-Za-z0-9_./-]/.test(s) &&
        !s.includes('..') &&
        s
          .split('/')
          .slice(1)
          .every((part) => !!part && part !== '.' && part.length <= 255)
    )
})
export const productTargetRootSchema = requestSchema.shape.target_root

export type TargetEnrollmentResult = Readonly<{
  state: 'enrolled' | 'unknown'
  app_id: number
  ownership_generation: number
  safe_error_code?: 'TARGET_ENROLLMENT_UNKNOWN'
  helper_path?: string
  state_root?: string
}>

export async function exchangeProductBootstrapJson(
  channel: ClientChannel,
  body: string,
  signal?: AbortSignal,
  maxOutputBytes = PRODUCT_TARGET_ENROLLMENT_MAX_OUTPUT_BYTES
): Promise<unknown> {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 128 * 1024)
    throw new Error('TARGET_ENROLLMENT_INPUT_INVALID')
  return new Promise((resolve, reject) => {
    let output = Buffer.alloc(0)
    let finished = false
    const finish = (error?: Error): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      channel.removeListener('data', data)
      if (error) {
        channel.destroy()
        reject(error)
      } else {
        try {
          resolve(JSON.parse(output.toString('utf8')))
        } catch {
          reject(new Error('TARGET_ENROLLMENT_UNKNOWN'))
        }
      }
    }
    const abort = (): void => finish(new Error('TARGET_ENROLLMENT_UNKNOWN'))
    const timer = setTimeout(abort, 20_000)
    const data = (bytes: Buffer): void => {
      if (output.length + bytes.length > maxOutputBytes) {
        abort()
        return
      }
      output = Buffer.concat([output, bytes])
    }
    channel.on('data', data)
    channel.stderr.on('data', () => {})
    channel.on('error', abort)
    channel.on('close', (code: number) =>
      finish(code === 0 ? undefined : new Error('TARGET_ENROLLMENT_UNKNOWN'))
    )
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    channel.end(body)
  })
}

/** CLI quản trị explicit; chỉ source tin cậy đi vào argv, secret chỉ trong bounded stdin. */
export async function enrollProductTarget(
  database: Database.Database,
  controllerId: string,
  directory: string,
  input: unknown,
  signal?: AbortSignal,
  assertAuthority?: () => void
): Promise<TargetEnrollmentResult> {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success || parsed.data.controller_id !== controllerId)
    throw new Error('TARGET_ENROLLMENT_INPUT_INVALID')
  if (signal?.aborted) throw new Error('TARGET_ENROLLMENT_ABORTED')
  assertAuthority?.()
  const request = parsed.data
  const bundle = verifyControllerBundle(request.artifact, request.manifest_sha256)
  const script = readVerifiedControllerBundleFile(
    bundle,
    'target-helper/target_enrollment.py'
  ).toString('utf8')
  if (Buffer.byteLength(script) > 64 * 1024) throw new Error('TARGET_ENROLLMENT_INPUT_INVALID')
  const manifest = readVerifiedControllerBundleFile(bundle, 'bundle-manifest.json').toString('utf8')
  const helpers: Record<string, string> = {}
  for (const name of [
    'target_execution_guard.py',
    'target_guarded_ssh_helper.py',
    'target_product_runtime.py'
  ]) {
    const value = readVerifiedControllerBundleFile(bundle, `target-helper/${name}`)
    if (value.length > 512 * 1024) throw new Error('TARGET_ENROLLMENT_INPUT_INVALID')
    helpers[name] = value.toString('base64')
  }
  const repository = new TargetEnrollmentRepository(database)
  const target = repository.target(controllerId, request.app_id, request.ownership_generation, true)
  const payload = makeTargetEnrollmentPayload(
    controllerId,
    request.app_id,
    request.ownership_generation,
    target,
    request.manifest_sha256,
    request.target_root
  )
  if (payload.helper_path.length > 512 || payload.state_root.length > 1024)
    throw new Error('TARGET_ENROLLMENT_INPUT_INVALID')
  const packet = { format: 1, operation: 'enroll', payload, key: 'X'.repeat(44), manifest, helpers }
  if (Buffer.byteLength(JSON.stringify(packet)) > PRODUCT_TARGET_ENROLLMENT_MAX_INPUT_BYTES)
    throw new Error('TARGET_ENROLLMENT_INPUT_INVALID')
  const identity = {
    controller_id: controllerId,
    app_id: request.app_id,
    ownership_generation: request.ownership_generation
  }
  repository.prepare(
    payload,
    () => {
      // Explicit first prepare chỉ create-once; orphan record dùng lại, corrupt record không overwrite.
      let material: Buffer
      try {
        material = createControllerRuntimeKey(directory, identity)
      } catch {
        material = loadControllerRuntimeKey(directory, identity)
      }
      material.fill(0)
    },
    assertAuthority
  )
  const key = loadControllerRuntimeKey(directory, identity)
  const ssh = new SshManager(createControllerSshResolver(database, controllerId, directory))
  let started: ReturnType<TargetEnrollmentRepository['begin']> | undefined
  try {
    if (signal?.aborted) throw new Error('TARGET_ENROLLMENT_ABORTED')
    started = repository.begin(payload, false, assertAuthority)
    assertAuthority?.()
    const opened = await ssh.openProductBootstrapChannel(
      target.vps_id,
      { text: script, sha256: createHash('sha256').update(script).digest('hex') },
      {
        signal,
        timeoutMs: 20_000,
        expectedIdentity: {
          vpsId: target.vps_id,
          host: target.host,
          port: target.port,
          username: target.username,
          authType: target.auth_type,
          hostFingerprint: target.host_fingerprint
        }
      }
    )
    repository.assertCurrent(payload)
    assertAuthority?.()
    const actual = opened.identity
    if (
      actual.vpsId !== target.vps_id ||
      actual.host !== target.host ||
      actual.port !== target.port ||
      actual.hostFingerprint !== target.host_fingerprint ||
      actual.username !== target.username ||
      actual.authType !== target.auth_type
    ) {
      opened.channel.destroy()
      throw new Error('TARGET_ENROLLMENT_AUTHORITY_REJECTED')
    }
    const response = (await exchangeProductBootstrapJson(
      opened.channel,
      JSON.stringify({
        ...packet,
        operation: started.operation,
        helpers: started.operation === 'enroll' ? helpers : {},
        key: key.toString('base64')
      }),
      signal
    )) as { state?: string; proof?: unknown }
    if (
      !response ||
      Object.keys(response).sort().join(',') !== 'proof,state' ||
      response.state !== 'enrolled'
    )
      throw new Error('TARGET_ENROLLMENT_UNKNOWN')
    repository.complete(payload, response.proof, key, false, assertAuthority)
    return {
      state: 'enrolled',
      app_id: request.app_id,
      ownership_generation: request.ownership_generation,
      helper_path: payload.helper_path,
      state_root: payload.state_root
    }
  } catch (error) {
    if (!started) throw error
    try {
      repository.failed(started.row)
    } catch {
      /* unknown marker đã commit, không tự rollback/retry. */
    }
    return {
      state: 'unknown',
      app_id: request.app_id,
      ownership_generation: request.ownership_generation,
      safe_error_code: 'TARGET_ENROLLMENT_UNKNOWN'
    }
  } finally {
    key.fill(0)
    await ssh.disconnectAll()
  }
}

/** Source authority vẫn ở SQLite; getter chỉ đọc exact persisted proof/key, không tự enroll. */
export function readEnrolledProductTarget(
  database: Database.Database,
  directory: string,
  controllerId: string,
  appId: number,
  generation: number,
  expectedManifest: string
): ProductTargetEnrollmentPayload {
  const repository = new TargetEnrollmentRepository(database)
  const row = repository.get({
    controller_id: controllerId,
    app_id: appId,
    ownership_generation: generation
  })
  if (
    !row ||
    row.state !== 'enrolled' ||
    row.last_error_code ||
    row.manifest_sha256 !== expectedManifest ||
    !row.receipt_json
  )
    throw new Error('TARGET_ENROLLMENT_NOT_READY')
  const target = repository.target(controllerId, appId, generation, false)
  const expected = makeTargetEnrollmentPayload(
    controllerId,
    appId,
    generation,
    target,
    expectedManifest,
    row.target_root
  )
  const key = loadControllerRuntimeKey(directory, {
    controller_id: controllerId,
    app_id: appId,
    ownership_generation: generation
  })
  try {
    const proof: unknown = JSON.parse(row.receipt_json)
    if (
      row.target_binding_json !== canonicalH2Json(target) ||
      !verifyTargetEnrollmentProof(expected, proof, key)
    )
      throw new Error('TARGET_ENROLLMENT_PROOF_REJECTED')
    return expected
  } finally {
    key.fill(0)
  }
}

/** Chỉ inspect existing row/material, được dùng khi H2 pending; không first-install hoặc require pause. */
export async function inspectStoredProductTarget(
  database: Database.Database,
  directory: string,
  controllerId: string,
  appId: number,
  generation: number,
  bundle: VerifiedControllerBundle,
  historicalManifest: Buffer,
  signal?: AbortSignal
): Promise<TargetEnrollmentResult> {
  const repository = new TargetEnrollmentRepository(database)
  const identity = { controller_id: controllerId, app_id: appId, ownership_generation: generation }
  const row = repository.get(identity)
  if (
    !row ||
    historicalManifest.length > 32 * 1024 ||
    createHash('sha256').update(historicalManifest).digest('hex') !== row.manifest_sha256
  )
    throw new Error('TARGET_ENROLLMENT_NOT_READY')
  const manifest = JSON.parse(historicalManifest.toString('utf8')) as {
    files: { path: string; sha256: string; size: number }[]
  }
  for (const name of [
    'target_execution_guard.py',
    'target_guarded_ssh_helper.py',
    'target_product_runtime.py'
  ]) {
    const path = `target-helper/${name}`
    const current = readVerifiedControllerBundleFile(bundle, path)
    const previous = manifest.files.find((file) => file.path === path)
    if (
      !previous ||
      previous.size !== current.length ||
      previous.sha256 !== createHash('sha256').update(current).digest('hex')
    )
      throw new Error('TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED')
  }
  const target = repository.target(controllerId, appId, generation, false)
  const payload = makeTargetEnrollmentPayload(
    controllerId,
    appId,
    generation,
    target,
    row.manifest_sha256,
    row.target_root
  )
  const key = loadControllerRuntimeKey(directory, identity)
  const ssh = new SshManager(createControllerSshResolver(database, controllerId, directory))
  let started: ReturnType<TargetEnrollmentRepository['begin']> | undefined
  try {
    if (signal?.aborted) throw new Error('TARGET_ENROLLMENT_ABORTED')
    const script = readVerifiedControllerBundleFile(
      bundle,
      'target-helper/target_enrollment.py'
    ).toString('utf8')
    started = repository.begin(payload, true)
    const opened = await ssh.openProductBootstrapChannel(
      target.vps_id,
      { text: script, sha256: createHash('sha256').update(script).digest('hex') },
      { signal, timeoutMs: 20_000 }
    )
    repository.assertCurrent(payload, false)
    const actual = opened.identity
    if (
      actual.vpsId !== target.vps_id ||
      actual.host !== target.host ||
      actual.port !== target.port ||
      actual.hostFingerprint !== target.host_fingerprint ||
      actual.username !== target.username ||
      actual.authType !== target.auth_type
    ) {
      opened.channel.destroy()
      throw new Error('TARGET_ENROLLMENT_AUTHORITY_REJECTED')
    }
    const response = (await exchangeProductBootstrapJson(
      opened.channel,
      JSON.stringify({
        format: 1,
        operation: 'inspect',
        payload,
        key: key.toString('base64'),
        manifest: historicalManifest.toString('utf8'),
        helpers: {}
      }),
      signal
    )) as { state?: string; proof?: unknown }
    if (
      !response ||
      Object.keys(response).sort().join(',') !== 'proof,state' ||
      response.state !== 'enrolled'
    )
      throw new Error('TARGET_ENROLLMENT_UNKNOWN')
    repository.complete(payload, response.proof, key, true)
    return {
      state: 'enrolled',
      app_id: appId,
      ownership_generation: generation,
      helper_path: payload.helper_path,
      state_root: payload.state_root
    }
  } catch {
    if (started) repository.failed(started.row)
    return {
      state: 'unknown',
      app_id: appId,
      ownership_generation: generation,
      safe_error_code: 'TARGET_ENROLLMENT_UNKNOWN'
    }
  } finally {
    key.fill(0)
    await ssh.disconnectAll()
  }
}
