import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import type { App } from '@shared/ipc'
import type Database from 'better-sqlite3'

import {
  GUARDED_SSH_TRANSFER_CHUNK_BYTES,
  GUARDED_SSH_TRANSFER_MAX_FILES,
  GUARDED_SSH_TRANSFER_MAX_FILE_BYTES,
  GUARDED_SSH_TRANSFER_MAX_PATH_BYTES,
  GUARDED_SSH_TRANSFER_MAX_TOTAL_BYTES,
  type GuardedSshTransferScope
} from '../../../../docs/contracts/product-guarded-ssh-session'
import { AppRepository } from '../db/appRepository'
import { DeploymentRepository } from '../db/deploymentRepository'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { detectFramework } from '../detectors'
import { buildSourceTree } from '../detectors/sourceTree'
import type { BuildPlan } from '../detectors/types'
import { SshAbortedError, SshManager } from '../ssh/manager'
import { shouldExcludeUploadPath } from '../ssh/manager'
import {
  buildEnvFile,
  renderBuildArgs,
  renderCompose,
  renderDockerfile,
  type ComposeVars
} from '../deploy/templates'
import { resolveCollectorDir, resolveCollectorAppPath } from '../deploy/pipeline'
import type { PreparedProductGitSnapshot } from './productSnapshotPreparation'
import { GuardedSshExecutionSession, openProductGuardedSshSession } from './guardedSshSession'

type TransferFile = {
  path: string
  localPath: string
  size: number
  mode: number
  sha256: string
}

export type ProductSourceRenderResult = Readonly<{
  state: 'source_render_staged_dispatch_unknown'
  app_id: number
  deployment_id: number
  target_sha: string
  source_file_count: number
  source_bytes: number
  source_manifest_sha256: string
  render_file_count: number
  render_bytes: number
  render_manifest_sha256: string
  finalization: 'not_implemented_remote_outcome_unknown'
}>

export type ProductBuildResult = Readonly<{
  state: 'build_succeeded' | 'build_failed_definite'
  app_id: number
  deployment_id: number
  target_sha: string
  image_tag: string
  image_id?: string
  labels?: Record<string, string>
  exit_code?: number
  error_tail?: string
}>

export class ProductSourceRenderError extends Error {
  constructor(
    readonly code:
      | 'PRODUCT_SOURCE_RENDER_UNSUPPORTED_PLAN'
      | 'PRODUCT_SOURCE_RENDER_INVALID_DEPLOYMENT'
      | 'PRODUCT_SOURCE_RENDER_LIMIT_EXCEEDED'
      | 'PRODUCT_SOURCE_RENDER_CANCELLED'
  ) {
    super(code)
    this.name = 'ProductSourceRenderError'
  }
}

export function redactSecrets(text: string): string {
  if (!text) return ''
  let redacted = text
  redacted = redacted.replace(/:\/\/([^:\s/@]+):([^@\s/]+)@/g, '://$1:[REDACTED]@')
  redacted = redacted.replace(
    /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]'
  )
  redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+/gi, 'Bearer [REDACTED]')
  redacted = redacted.replace(
    /\b(password|passwd|secret|token|api[_-]?key|auth|bearer|credentials?)\b\s*([:=])\s*([^\s;,'"]+)/gi,
    '$1$2[REDACTED]'
  )
  return redacted
}

export function validatePreflightSourceAndPlan(
  database: Database.Database,
  snapshot: PreparedProductGitSnapshot
): {
  app: App
  plan: BuildPlan
  sourceTree: ReturnType<typeof buildSourceTree>
} {
  const app = new AppRepository(database).getById(snapshot.claim.app_id)
  const sourceTree = buildSourceTree(snapshot.rootDirectory)
  const detection = detectFramework(sourceTree)
  if (
    app.framework !== 'express' ||
    app.needs_db !== 0 ||
    !detection.matched ||
    detection.detector !== 'express' ||
    detection.plan.needsDb ||
    detection.plan.requiredEnv.length > 0
  ) {
    throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_UNSUPPORTED_PLAN')
  }
  return { app, plan: detection.plan, sourceTree }
}

/**
 * Caller-owned session variant for stageProductSourceAndRender.
 * Transfers source and render scopes without closing the session.
 */
export async function stageProductSourceAndRenderWithSession(
  session: GuardedSshExecutionSession,
  database: Database.Database,
  snapshot: PreparedProductGitSnapshot,
  options: {
    collector_directory?: string
    signal?: AbortSignal
  } = {}
): Promise<ProductSourceRenderResult> {
  const { app, plan, sourceTree } = validatePreflightSourceAndPlan(database, snapshot)

  const deployment = new DeploymentRepository(database).getById(session.deploymentId)
  if (
    deployment.id !== session.deploymentId ||
    deployment.app_id !== app.id ||
    deployment.status !== 'building' ||
    deployment.git_commit_sha !== snapshot.metadata.commitSha ||
    deployment.git_repo_url !== snapshot.metadata.repositoryUrl
  ) {
    throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_INVALID_DEPLOYMENT')
  }

  const collectorDirectory = options.collector_directory ?? resolveCollectorDir()
  const sourceFiles = [
    ...collectFiles(snapshot.rootDirectory, ''),
    ...collectFiles(collectorDirectory, 'collector')
  ]
  const sourceManifest = prepareManifest(sourceFiles)
  const renderFiles = renderPlanFiles(app, plan, sourceTree, deployment.image_tag)
  const renderManifest = prepareManifest(renderFiles)
  if (
    sourceFiles.length + renderFiles.length > GUARDED_SSH_TRANSFER_MAX_FILES ||
    sourceManifest.totalBytes + renderManifest.totalBytes > GUARDED_SSH_TRANSFER_MAX_TOTAL_BYTES
  ) {
    throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_LIMIT_EXCEEDED')
  }

  await transferScope(session, 'source', sourceFiles, sourceManifest, options.signal)
  await transferScope(session, 'render', renderFiles, renderManifest, options.signal)

  return {
    state: 'source_render_staged_dispatch_unknown',
    app_id: app.id,
    deployment_id: session.deploymentId,
    target_sha: snapshot.metadata.commitSha,
    source_file_count: sourceFiles.length,
    source_bytes: sourceManifest.totalBytes,
    source_manifest_sha256: sourceManifest.sha256,
    render_file_count: renderFiles.length,
    render_bytes: renderManifest.totalBytes,
    render_manifest_sha256: renderManifest.sha256,
    finalization: 'not_implemented_remote_outcome_unknown'
  }
}

/**
 * Execute Docker build target-side within the caller's active guarded SSH session.
 */
export async function executeProductBuildWithSession(
  session: GuardedSshExecutionSession,
  database: Database.Database,
  snapshot: PreparedProductGitSnapshot,
  options: {
    timeoutMs?: number
    pollIntervalMs?: number
    signal?: AbortSignal
  } = {}
): Promise<ProductBuildResult> {
  const deployment = new DeploymentRepository(database).getById(session.deploymentId)
  if (
    deployment.id !== session.deploymentId ||
    deployment.app_id !== snapshot.claim.app_id ||
    deployment.status !== 'building' ||
    deployment.git_commit_sha !== snapshot.metadata.commitSha
  ) {
    throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_INVALID_DEPLOYMENT')
  }

  await session.startBuild(deployment.image_tag)
  const settled = await session.pollBuildUntilSettled({
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs
  })

  if (settled.state === 'succeeded') {
    const labels = settled.labels ?? {}
    const expectedAppId = String(snapshot.claim.app_id)
    const expectedDeploymentId = String(session.deploymentId)
    const hasValidTag = settled.imageTag === deployment.image_tag
    const hasValidLabels =
      labels['opspilot.app_id'] === expectedAppId &&
      labels['opspilot.deployment_id'] === expectedDeploymentId
    const hasValidImageId =
      typeof settled.imageId === 'string' && /^sha256:[0-9a-f]{64}$/.test(settled.imageId)

    if (!hasValidTag || !hasValidLabels || !hasValidImageId) {
      session.failClosed('SSH_BUILD_FAILED')
      throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_INVALID_DEPLOYMENT')
    }

    return {
      state: 'build_succeeded',
      app_id: snapshot.claim.app_id,
      deployment_id: session.deploymentId,
      target_sha: snapshot.metadata.commitSha,
      image_tag: deployment.image_tag,
      image_id: settled.imageId,
      labels: settled.labels
    }
  }

  return {
    state: 'build_failed_definite',
    app_id: snapshot.claim.app_id,
    deployment_id: session.deploymentId,
    target_sha: snapshot.metadata.commitSha,
    image_tag: deployment.image_tag,
    exit_code: settled.exitCode,
    error_tail: settled.errorTail ? redactSecrets(settled.errorTail) : undefined
  }
}

/**
 * Combined source, render, and build within one guarded SSH session and target lock.
 */
export async function stageAndBuildProduct(
  database: Database.Database,
  repository: ProductDeployRepository,
  ssh: SshManager,
  snapshot: PreparedProductGitSnapshot,
  options: {
    vps_id: number
    target_helper_path: string
    target_state_root: string
    signal?: AbortSignal
    collector_directory?: string
    build_timeout_ms?: number
    build_poll_interval_ms?: number
  }
): Promise<ProductBuildResult> {
  validatePreflightSourceAndPlan(database, snapshot)
  const session = await openProductGuardedSshSession(repository, ssh, snapshot, {
    vps_id: options.vps_id,
    target_helper_path: options.target_helper_path,
    target_state_root: options.target_state_root,
    signal: options.signal
  })
  let success = false
  try {
    await stageProductSourceAndRenderWithSession(session, database, snapshot, {
      collector_directory: options.collector_directory,
      signal: options.signal
    })
    const buildResult = await executeProductBuildWithSession(session, database, snapshot, {
      timeoutMs: options.build_timeout_ms,
      pollIntervalMs: options.build_poll_interval_ms,
      signal: options.signal
    })
    success = buildResult.state === 'build_succeeded'
    return buildResult
  } finally {
    if (success && session.state === 'active') {
      await session.close()
    } else if (session.state === 'active') {
      session.failClosed(options.signal?.aborted ? 'SSH_SESSION_ABORTED' : 'SSH_OUTCOME_UNKNOWN')
    }
  }
}

/**
 * Source/render-only Product adapter (backward compatibility wrapper).
 */
export async function stageProductSourceAndRender(
  database: Database.Database,
  repository: ProductDeployRepository,
  ssh: SshManager,
  snapshot: PreparedProductGitSnapshot,
  options: {
    vps_id: number
    target_helper_path: string
    target_state_root: string
    signal?: AbortSignal
    collector_directory?: string
  }
): Promise<ProductSourceRenderResult> {
  validatePreflightSourceAndPlan(database, snapshot)
  const session = await openProductGuardedSshSession(repository, ssh, snapshot, {
    vps_id: options.vps_id,
    target_helper_path: options.target_helper_path,
    target_state_root: options.target_state_root,
    signal: options.signal
  })
  let success = false
  try {
    const res = await stageProductSourceAndRenderWithSession(session, database, snapshot, {
      collector_directory: options.collector_directory,
      signal: options.signal
    })
    success = true
    return res
  } finally {
    if (success && session.state === 'active') {
      await session.close()
    } else if (session.state === 'active') {
      session.failClosed(options.signal?.aborted ? 'SSH_SESSION_ABORTED' : 'SSH_OUTCOME_UNKNOWN')
    }
  }
}

function collectFiles(root: string, prefix: string): TransferFile[] {
  const files: TransferFile[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      comparePath(a.name, b.name)
    )) {
      const absolute = join(current, entry.name)
      const rel = relative(root, absolute).split(sep).join('/')
      const relPath = prefix ? `${prefix}/${rel}` : rel
      if (shouldExcludeUploadPath(rel) || isEnvironmentFile(entry.name)) continue
      const info = lstatSync(absolute)
      if (info.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        visit(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const pathBytes = Buffer.byteLength(relPath, 'utf8')
      if (
        pathBytes > GUARDED_SSH_TRANSFER_MAX_PATH_BYTES ||
        info.size > GUARDED_SSH_TRANSFER_MAX_FILE_BYTES
      ) {
        throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_LIMIT_EXCEEDED')
      }
      const content = readFileSync(absolute)
      if (content.length !== info.size) {
        throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_LIMIT_EXCEEDED')
      }
      files.push({
        path: relPath,
        localPath: absolute,
        size: content.length,
        mode: info.mode & 0o111 ? 0o755 : 0o644,
        sha256: createHash('sha256').update(content).digest('hex')
      })
      if (files.length > GUARDED_SSH_TRANSFER_MAX_FILES) {
        throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_LIMIT_EXCEEDED')
      }
    }
  }
  visit(root)
  return files.sort((a, b) => comparePath(a.path, b.path))
}

function isEnvironmentFile(name: string): boolean {
  return name === '.env' || name.startsWith('.env.')
}

function renderPlanFiles(
  app: App,
  plan: BuildPlan,
  sourceTree: ReturnType<typeof buildSourceTree>,
  imageTag?: string
): TransferFile[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(app.name)) {
    throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_UNSUPPORTED_PLAN')
  }
  const resolvedImageTag = imageTag || `${app.name}:product-source-render`
  const vars: ComposeVars = {
    APP_NAME: app.name,
    IMAGE_TAG: resolvedImageTag,
    HOST_PORT: String(app.host_port),
    CONTAINER_PORT: String(app.container_port),
    HEALTHCHECK_PATH: app.healthcheck_path,
    START_COMMAND: plan.startCommand,
    COLLECT_INTERVAL_S: '10',
    COLLECTOR_IMAGE_TAG: `${app.name}:collector`,
    COLLECTOR_APP_PATH: resolveCollectorAppPath(app.framework, sourceTree, app.healthcheck_path),
    APP_DEPENDS_ON: ''
  }
  const rendered = [
    {
      path: 'Dockerfile',
      content: renderDockerfile(plan.dockerfileTemplate, {
        ...vars,
        BUILD_COMMAND: plan.buildCommand,
        BUILD_ARGS: renderBuildArgs(plan.buildArgs)
      }),
      mode: 0o644
    },
    { path: 'docker-compose.yml', content: renderCompose(vars, false), mode: 0o644 },
    { path: '.env', content: buildEnvFile({}, false).content, mode: 0o600 }
  ]
  return rendered.map(({ path, content, mode }) => {
    const bytes = Buffer.from(content, 'utf8')
    return {
      path,
      localPath: '',
      size: bytes.length,
      mode,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      content
    } as TransferFile & { content: string }
  })
}

function prepareManifest(files: TransferFile[]): { totalBytes: number; sha256: string } {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (
    files.length > GUARDED_SSH_TRANSFER_MAX_FILES ||
    totalBytes > GUARDED_SSH_TRANSFER_MAX_TOTAL_BYTES
  ) {
    throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_LIMIT_EXCEEDED')
  }
  const digest = createHash('sha256')
  for (const file of [...files].sort((a, b) => comparePath(a.path, b.path))) {
    digest.update(`${file.path}\0${file.size}\0${file.sha256}\0${file.mode.toString(8)}\n`, 'utf8')
  }
  return { totalBytes, sha256: digest.digest('hex') }
}

function comparePath(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

async function transferScope(
  session: Awaited<ReturnType<typeof openProductGuardedSshSession>>,
  scope: GuardedSshTransferScope,
  files: Array<TransferFile & { content?: string }>,
  manifest: { totalBytes: number; sha256: string },
  signal?: AbortSignal
): Promise<void> {
  ensureNotAborted(signal)
  await session.beginTransferScope(scope, files.length, manifest.totalBytes, manifest.sha256)
  for (const file of files) {
    ensureNotAborted(signal)
    const content =
      file.content !== undefined ? Buffer.from(file.content, 'utf8') : readFileSync(file.localPath)
    if (
      content.length !== file.size ||
      createHash('sha256').update(content).digest('hex') !== file.sha256
    ) {
      throw new ProductSourceRenderError('PRODUCT_SOURCE_RENDER_INVALID_DEPLOYMENT')
    }
    await session.beginTransferFile(scope, file.path, file.size, file.mode, file.sha256)
    let chunkIndex = 0
    for (let offset = 0; offset < content.length; offset += GUARDED_SSH_TRANSFER_CHUNK_BYTES) {
      ensureNotAborted(signal)
      await session.writeTransferChunk(
        chunkIndex++,
        content.subarray(offset, offset + GUARDED_SSH_TRANSFER_CHUNK_BYTES)
      )
    }
    await session.finishTransferFile()
  }
  ensureNotAborted(signal)
  await session.completeTransferScope(scope, files.length, manifest.totalBytes, manifest.sha256)
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SshAbortedError()
}
