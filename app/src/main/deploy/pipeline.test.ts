import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Mock } from 'vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DeployEvent, DeployInput } from '@shared/ipc'

import type { EncryptedCredential } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from '../db'
import { VpsRepository } from '../db/vpsRepository'
import type { SshManager } from '../ssh/manager'
import { DeployPipeline, resolveCollectorAppPath, resolveCollectorDir } from './pipeline'
import { detectSource } from './detectionDto'
import { buildSourceTree } from '../detectors/sourceTree'
import { createGitSnapshotFromLocalFixture } from '../git/snapshot'
import type { GitSnapshot } from '../git/snapshot'
import { DeployService } from './service'
import type { PreparedGitLease } from './preparedGitSources'

const PRECHECK_OK = [
  'RAM_MB|2048',
  'DISK_GB|20',
  'PORT|FREE',
  'DOCKER|Docker version 27.1.0, build 6312585',
  'Docker Compose version v2.29.1'
].join('\n')

interface StubSshOptions {
  precheckOutput?: string
  curlOk?: (call: number) => boolean
  composeUp?: (call: number) => { code: number; stdout: string; stderr: string }
  buildResult?: (command: string) => { code: number; stdout: string; stderr: string }
  inspectStatus?: (call: number) => string
  inspectState?: (call: number) => {
    Status: string
    ExitCode: number
    Error: string
    Health?: { Status: string }
  }
  imagesOutput?: (call: number) => string
  imageRemove?: (call: number, command: string) => { code: number; stdout: string; stderr: string }
  imageAvailable?: boolean
  containerLogs?: string
  stopCollector?: (call: number) => { code: number; stdout: string; stderr: string }
  metricsFileMissing?: boolean
  metricSnapshot?: (
    call: number
  ) =>
    | { generation: string; device?: number; inode?: number; size: number }
    | null
    | Promise<{ generation: string; device?: number; inode?: number; size: number } | null>
  runtimeImage?: (appName: string, composeCall: number) => string
  remoteEnvContent?: string
  remoteEnvReadFails?: boolean
  manifestRenameFails?: boolean
}

let testDirectory: string | null = null
let sourceDirectory: string | null = null
let vpsId = 0
let database: ReturnType<typeof initializeDatabase>
let sshExec: Mock
let writeFileMock: Mock
let readFileMock: Mock
let uploadDirMock: Mock
let testSsh: SshManager
let uploadedDirectorySnapshots: Array<{ localPath: string; marker: string | null }>
let events: DeployEvent[]
let pipeline: DeployPipeline
let remoteManifestFiles: Map<string, string>

afterEach(() => {
  vi.useRealTimers()
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

function createHarness(options: StubSshOptions = {}): void {
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-pipeline-'))
  sourceDirectory = mkdtempSync(join(tmpdir(), 'opspilot-source-'))
  writeFileSync(
    join(sourceDirectory, 'package.json'),
    JSON.stringify({
      name: 'demo-api',
      main: 'app.js',
      scripts: { start: 'node app.js' },
      dependencies: { express: '^4.19.2', pg: '^8.11.0' }
    }),
    'utf8'
  )
  writeFileSync(
    join(sourceDirectory, 'app.js'),
    "const express = require('express'); const app = express(); app.get('/health', (q, s) => s.json({ok:true})); app.listen(3000)\n",
    'utf8'
  )

  database = initializeDatabase(testDirectory)
  const vps = new VpsRepository(database).create({
    name: 'VM Test',
    host: '203.0.113.55',
    port: 22,
    username: 'root',
    auth_type: 'password',
    credential: fakeCredential('cipher')
  })
  vpsId = vps.id

  let composeUpCall = 0
  let inspectCall = 0
  let curlCall = 0
  let imagesCall = 0
  let imageRemoveCall = 0
  let stopCollectorCall = 0
  let snapshotCall = 0
  const lastComposeUpCode = new Map<string, number>()
  remoteManifestFiles = new Map()
  sshExec = vi.fn(async (_vpsId: number, command: string) => {
    if (command.startsWith('mv -f --') && command.includes('.opspilot-app.json')) {
      if (options.manifestRenameFails) {
        return { code: 1, stdout: '', stderr: 'private-marker must not reach logs' }
      }
      const paths = [...command.matchAll(/'([^']+)'/g)].map((match) => match[1])
      const [tempPath, manifestPath] = paths
      if (tempPath && manifestPath) {
        const content = remoteManifestFiles.get(tempPath)
        if (content !== undefined) remoteManifestFiles.set(manifestPath, content)
        remoteManifestFiles.delete(tempPath)
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    if (command.startsWith('rm -f --') && command.includes('.opspilot-app.json')) {
      const tempPath = command.match(/'([^']+)'/)?.[1]
      if (tempPath) remoteManifestFiles.delete(tempPath)
      return { code: 0, stdout: '', stderr: '' }
    }
    if (command === 'ss -H -ltn') {
      return { code: 0, stdout: '', stderr: '' }
    }
    if (command.includes('free -m')) {
      return { code: 0, stdout: options.precheckOutput ?? PRECHECK_OK, stderr: '' }
    }
    if (command.includes('head -c 65537') && command.includes('/.env')) {
      if (options.remoteEnvReadFails) {
        return { code: 1, stdout: '', stderr: 'fake-secret-not-for-logs' }
      }
      const priorWrite = [...(writeFileMock?.mock.calls ?? [])]
        .reverse()
        .find(([, remotePath]) => String(remotePath).endsWith('/.env'))
      const content = options.remoteEnvContent ?? (priorWrite?.[2] as string | undefined)
      return content === undefined
        ? { code: 66, stdout: '', stderr: 'fake-secret-not-for-logs' }
        : { code: 0, stdout: content, stderr: '' }
    }
    if (command.includes('docker build')) {
      if (options.buildResult) return options.buildResult(command)
      return { code: 0, stdout: 'build xong\n', stderr: '' }
    }
    if (command.includes('compose up -d')) {
      composeUpCall += 1
      const result = options.composeUp?.(composeUpCall) ?? {
        code: 0,
        stdout: 'Container demo-api-app Started\n',
        stderr: ''
      }
      const composeApp = command.match(/apps\/([a-z0-9-]+)\s+&&/)?.[1] ?? 'demo-api'
      lastComposeUpCode.set(composeApp, result.code)
      return result
    }
    if (command.includes('compose down')) {
      return { code: 0, stdout: '', stderr: '' }
    }
    if (command.includes('compose stop collector')) {
      stopCollectorCall += 1
      return (
        options.stopCollector?.(stopCollectorCall) ?? {
          code: 0,
          stdout: 'collector stopped',
          stderr: ''
        }
      )
    }
    if (command.includes('compose start collector')) {
      return { code: 0, stdout: 'collector started', stderr: '' }
    }
    if (command.includes('docker inspect')) {
      if (command.includes('.Config.Image')) {
        const appName = command.match(/([a-z0-9-]+)-app(?:['\s]|$)/)?.[1] ?? 'demo-api'
        const compose = [...writeFileMock.mock.calls]
          .reverse()
          .find(
            ([, path]) =>
              String(path).endsWith('docker-compose.yml') && String(path).includes(`/${appName}/`)
          )
        const image =
          options.runtimeImage?.(appName, composeUpCall) ??
          String(compose?.[2] ?? '').match(/image:\s*(\S+)/)?.[1] ??
          `${appName}:v1`
        return {
          code: 0,
          stdout: `${image}|${(lastComposeUpCode.get(appName) ?? 0) === 0 ? 'running' : 'exited'}\n`,
          stderr: ''
        }
      }
      inspectCall += 1
      const state = options.inspectState?.(inspectCall) ?? {
        Status: options.inspectStatus?.(inspectCall) ?? 'running',
        ExitCode: 0,
        Error: '',
        Health: { Status: 'healthy' }
      }
      return {
        code: 0,
        stdout: `${JSON.stringify(state)}\n`,
        stderr: ''
      }
    }
    if (command.includes('docker images')) {
      imagesCall += 1
      return { code: 0, stdout: options.imagesOutput?.(imagesCall) ?? '', stderr: '' }
    }
    if (command.includes('docker image inspect')) {
      return options.imageAvailable === false
        ? { code: 1, stdout: '', stderr: 'No such image' }
        : { code: 0, stdout: '', stderr: '' }
    }
    if (command.includes('docker image rm')) {
      imageRemoveCall += 1
      return options.imageRemove?.(imageRemoveCall, command) ?? { code: 0, stdout: '', stderr: '' }
    }
    if (command.includes('docker logs --tail')) {
      return { code: 0, stdout: options.containerLogs ?? '', stderr: '' }
    }
    if (command.includes('curl -fsS')) {
      curlCall += 1
      return options.curlOk?.(curlCall) === false
        ? { code: 7, stdout: '', stderr: 'khong tra loi' }
        : { code: 0, stdout: '', stderr: '' }
    }
    throw new Error(`Lệnh ngoài script: ${command}`)
  })

  writeFileMock = vi.fn(async (_id: number, remotePath: string, content: string) => {
    if (remotePath.includes('.opspilot-app.json')) remoteManifestFiles.set(remotePath, content)
  })
  readFileMock = vi.fn(async (_vpsId: number, remotePath: string) => {
    const previous = [...writeFileMock.mock.calls].reverse().find(([, path]) => path === remotePath)
    return previous?.[2] ?? ''
  })
  uploadedDirectorySnapshots = []
  uploadDirMock = vi.fn(async (_vps: number, localPath: string) => {
    const markerPath = join(localPath, 'snapshot-marker.txt')
    uploadedDirectorySnapshots.push({
      localPath,
      marker: existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : null
    })
    return { bytes: 1_024 }
  })
  const stubSsh = {
    exec: sshExec,
    uploadDir: uploadDirMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
    fileSize: vi.fn(async () => 10),
    metricSnapshot: vi.fn(async () => {
      snapshotCall += 1
      if (options.metricSnapshot) return options.metricSnapshot(snapshotCall)
      return options.metricsFileMissing
        ? null
        : { generation: '1:1', device: 1, inode: 1, size: 10 }
    })
  } as unknown as SshManager
  testSsh = stubSsh

  events = []
  pipeline = new DeployPipeline({
    ssh: stubSsh,
    db: database,
    emit: (event) => events.push(event)
  })
}

function fixtureGit(repository: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: repository, stdio: 'ignore' })
}

function deployInput(overrides: Partial<DeployInput> = {}): DeployInput {
  return {
    vps_id: vpsId,
    app_name: 'demo-api',
    source_path: sourceDirectory ?? '',
    env: {},
    ...overrides
  }
}

function fakeGitLease(sourcePath: string): PreparedGitLease {
  const snapshot: GitSnapshot = {
    repositoryUrl: 'https://github.com/example/fake.git',
    commitSha: 'c'.repeat(40),
    rootDirectory: sourcePath,
    snapshotDirectory: sourcePath,
    cleanup: vi.fn()
  }
  return {
    handle: 'fake-existing-git-handle',
    snapshot,
    gitRepoUrl: snapshot.repositoryUrl,
    gitRef: 'main',
    gitRoot: '.',
    commitSha: snapshot.commitSha,
    sourcePath,
    expiresAt: Date.now() + 60_000,
    plan: detectSource(sourcePath).plan!
  }
}

async function waitForFinished(
  deploymentId?: number,
  timeoutMs = 8_000
): Promise<Extract<DeployEvent, { type: 'finished' }>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const finished = events.find(
      (event) =>
        event.type === 'finished' &&
        (deploymentId === undefined || event.deployment_id === deploymentId)
    )
    if (finished) {
      return finished as Extract<DeployEvent, { type: 'finished' }>
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Khong nhan duoc finished. Events: ${JSON.stringify(events)}`)
}

function deploymentRow(deploymentId: number): {
  status: string
  version: number
  failed_step: string | null
} {
  return database
    .prepare('SELECT status, version, failed_step FROM deployment WHERE id = ?')
    .get(deploymentId) as { status: string; version: number; failed_step: string | null }
}

function actionLogRows(deploymentId: number): Array<{ action: string; status: string | null }> {
  return database
    .prepare('SELECT action, status FROM action_log WHERE deployment_id = ?')
    .all(deploymentId) as Array<{ action: string; status: string | null }>
}

function writeFileCalls(): Array<{
  remotePath: string
  content: string
  options: { mode?: number; silent?: boolean }
}> {
  return writeFileMock.mock.calls.map(([, remotePath, content, options]) => ({
    remotePath,
    content,
    options: options as { mode?: number; silent?: boolean }
  }))
}

function currentDeploymentId(): number {
  const row = database
    .prepare('SELECT current_deployment_id FROM app WHERE name = ?')
    .get('demo-api') as { current_deployment_id: number }
  return row.current_deployment_id
}

function currentAppId(): number {
  const row = database.prepare('SELECT id FROM app WHERE name = ?').get('demo-api') as {
    id: number
  }
  return row.id
}

async function advanceFailedHealthcheck(): Promise<void> {
  // Đủ cho 10 probe của deploy lỗi và 10 probe readiness của rollback lỗi.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await vi.advanceTimersByTimeAsync(3_000)
  }
  await vi.advanceTimersByTimeAsync(100)
}

function createViteSource(envExample = 'VITE_API_URL=http://localhost:3000\n'): string {
  const viteSource = mkdtempSync(join(tmpdir(), 'opspilot-vite-source-'))
  writeFileSync(
    join(viteSource, 'package.json'),
    JSON.stringify({ name: 'demo-spa', devDependencies: { vite: '5' } }),
    'utf8'
  )
  writeFileSync(join(viteSource, '.env.example'), envExample, 'utf8')
  return viteSource
}

function appBuildCommand(): string {
  const command = sshExec.mock.calls
    .map((call) => String(call[1]))
    .find((entry) => entry.includes('docker build'))
  expect(command).toBeDefined()
  return command as string
}

describe('DeployPipeline', () => {
  it('keeps a healthy deployment running when manifest publication fails', async () => {
    createHarness({ manifestRenameFails: true })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const deployment = pipeline.run(deployInput({ env: { API_KEY: 'secret-marker' } }))
    expect((await waitForFinished(deployment.deploymentId)).status).toBe('running')
    expect(deploymentRow(deployment.deploymentId).status).toBe('running')
    const manifestWrites = writeFileCalls().filter((call) =>
      call.remotePath.includes('.opspilot-app.json')
    )
    expect(manifestWrites).toHaveLength(1)
    expect(manifestWrites[0]?.options).toMatchObject({ mode: 0o600, silent: true })
    expect(manifestWrites[0]?.content).not.toContain('secret-marker')
    expect(sshExec.mock.calls.map(([, command]) => command).join('\n')).not.toContain(
      'secret-marker'
    )
    expect(logSpy.mock.calls.flat().join('\n')).not.toContain('secret-marker')
    expect(remoteManifestFiles.size).toBe(0)
    logSpy.mockRestore()
  })

  it('runs a real Git snapshot through prepare, precheck, start, upload, DB record, and cleanup', async () => {
    createHarness()
    const repository = join(testDirectory!, 'remote.git')
    const working = join(testDirectory!, 'working')
    const snapshots = join(testDirectory!, 'snapshots')
    mkdirSync(working)
    mkdirSync(snapshots)
    fixtureGit(testDirectory!, 'init', '--quiet', '--bare', repository)
    fixtureGit(working, 'init', '--quiet', '-b', 'main')
    fixtureGit(working, 'config', 'user.name', 'Fixture Test')
    fixtureGit(working, 'config', 'user.email', 'fixture@example.invalid')
    const root = join(working, 'service')
    mkdirSync(root)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'git-demo',
        scripts: { start: 'node index.js' },
        dependencies: { express: '4.0.0' }
      })
    )
    writeFileSync(
      join(root, 'index.js'),
      "const app = require('express')(); app.get('/items', (_req, res) => res.json([])); app.listen(3000)\n"
    )
    writeFileSync(join(root, 'snapshot-marker.txt'), 'pinned-content\n')
    fixtureGit(working, 'add', '.')
    fixtureGit(working, 'commit', '--quiet', '-m', 'fixture one')
    fixtureGit(working, 'remote', 'add', 'origin', repository)
    fixtureGit(working, 'push', '--quiet', '-u', 'origin', 'main')
    let failOneEvent = true
    const service = new DeployService({
      ssh: testSsh,
      db: database,
      emit: (event) => {
        if (failOneEvent && event.type === 'step-start' && event.step === 'UPLOAD') {
          failOneEvent = false
          throw new Error('synthetic renderer event failure')
        }
        events.push(event)
      },
      exposure: {
        reconcile: async ({ app }) => ({
          status: 'not_checked',
          url: app.url,
          external_probe: 'not_run',
          ufw_state: 'not_checked',
          ufw_reconciled: false,
          cloud_firewall: 'not_configured',
          diagnosis: null,
          checked_at: new Date().toISOString()
        })
      },
      gitSnapshotFactory: (input) =>
        createGitSnapshotFromLocalFixture({ ...input, tempDirectory: snapshots })
    })

    const prepared = await service.prepareGit('integration-request', {
      source_type: 'git',
      git_repo_url: repository,
      git_ref: 'main',
      git_root: 'service'
    })
    const gitSourceInput = {
      source_type: 'git' as const,
      prepared_source_handle: prepared.prepared_source_handle,
      vps_id: vpsId,
      app_name: 'git-integration-api',
      env: {}
    }
    const precheck = await service.precheck(gitSourceInput)
    expect(precheck.passed).toBe(true)
    expect(precheck.precheck_token).toBeTruthy()

    writeFileSync(join(root, 'snapshot-marker.txt'), 'moved-branch-content\n')
    fixtureGit(working, 'add', '.')
    fixtureGit(working, 'commit', '--quiet', '-m', 'fixture two')
    fixtureGit(working, 'push', '--quiet', 'origin', 'main')
    const started = service.start({ ...gitSourceInput, precheck_token: precheck.precheck_token! })
    const finished = await waitForFinished(started.deployment_id)

    expect(finished.status).toBe('running')
    const uploadedSnapshot = uploadedDirectorySnapshots.find((entry) => entry.marker !== null)
    expect(uploadedSnapshot?.marker).toBe('pinned-content\n')
    expect(existsSync(uploadedSnapshot!.localPath)).toBe(false)
    const app = database
      .prepare(
        'SELECT source_type, source_path, git_repo_url, git_ref, git_root FROM app WHERE name = ?'
      )
      .get('git-integration-api') as Record<string, unknown>
    expect(app).toMatchObject({
      source_type: 'git',
      source_path: null,
      git_repo_url: prepared.git_repo_url,
      git_ref: 'main',
      git_root: 'service'
    })
    const deployment = database
      .prepare(
        'SELECT status, detector_json, git_repo_url, git_commit_sha FROM deployment WHERE id = ?'
      )
      .get(started.deployment_id) as Record<string, unknown>
    expect(deployment).toMatchObject({
      status: 'running',
      git_repo_url: prepared.git_repo_url,
      git_commit_sha: prepared.git_commit_sha
    })
    expect(JSON.parse(String(deployment.detector_json))).toMatchObject({
      collectorAppPath: '/items?limit=1'
    })
    expect(
      writeFileCalls().find((call) => call.remotePath.endsWith('docker-compose.yml'))?.content
    ).toContain('APP_URL: "http://app:3000/items?limit=1"')
    expect(prepared.git_commit_sha).toMatch(/^[a-f0-9]{40}$/)
    expect(events.at(-1)).toMatchObject({ type: 'finished', deployment_id: started.deployment_id })
  })

  it('restores a Git deployment from the relayed VPS root and saved plan without a local source path', async () => {
    createHarness()
    const repositoryUrl = 'https://github.com/example/pinned-demo.git'
    const commitSha = 'b'.repeat(40)
    const plan = {
      dockerfileTemplate: 'express.Dockerfile',
      buildArgs: {},
      buildCommand: 'npm run build',
      startCommand: 'node app.js',
      containerPort: 3000,
      healthcheckPath: '/health',
      collectorAppPath: '/items?limit=1',
      requiredEnv: [],
      optionalEnv: [],
      needsDb: false,
      manualSteps: []
    }
    const inserted = database
      .prepare(
        `INSERT INTO app (vps_id,name,framework,source_path,source_type,git_repo_url,git_ref,git_root,host_port,container_port,healthcheck_path,needs_db)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        vpsId,
        'migrated-git-app',
        'express',
        null,
        'git',
        repositoryUrl,
        'main',
        '.',
        30000,
        3000,
        '/health',
        0
      )
    const appId = Number(inserted.lastInsertRowid)

    const started = pipeline.runRestoredGit(
      {
        vps_id: vpsId,
        app_id: appId,
        app_name: 'migrated-git-app',
        remote_source_path: '/opt/opspilot/migrated-git-app',
        env: {}
      },
      {
        plan,
        collectorAppPath: '/items?limit=1',
        framework: 'express',
        repositoryUrl,
        commitSha
      }
    )
    const finished = await waitForFinished(started.deploymentId)

    expect(finished.status).toBe('running')
    expect(uploadDirMock).not.toHaveBeenCalled()
    expect(testSsh.fileSize).toHaveBeenCalledWith(vpsId, '/opt/opspilot/migrated-git-app/src')
    const compose = writeFileCalls().find((call) => call.remotePath.endsWith('docker-compose.yml'))
    expect(compose?.content).toContain('APP_URL: "http://app:3000/items?limit=1"')
    const app = database
      .prepare('SELECT source_path,source_type,git_repo_url,git_ref,git_root FROM app WHERE id=?')
      .get(appId)
    expect(app).toMatchObject({
      source_path: null,
      source_type: 'git',
      git_repo_url: repositoryUrl,
      git_ref: 'main',
      git_root: '.'
    })
    const deployment = database
      .prepare('SELECT status,detector_json,git_repo_url,git_commit_sha FROM deployment WHERE id=?')
      .get(started.deploymentId)
    expect(deployment).toMatchObject({
      status: 'running',
      detector_json: JSON.stringify(plan),
      git_repo_url: repositoryUrl,
      git_commit_sha: commitSha
    })
    expect(events.at(-1)).toMatchObject({ type: 'finished', deployment_id: started.deploymentId })
  })

  it('marks a deployment failed and releases app lock and Git snapshot when opening its log fails', async () => {
    createHarness()
    const cleanup = vi.fn()
    const logStreamSpy = vi
      .spyOn(pipeline as unknown as { openLogStream: () => unknown }, 'openLogStream')
      .mockImplementation(() => {
        throw new Error('synthetic log open failure')
      })
    const snapshot = {
      repositoryUrl: 'https://github.com/example/repo.git',
      commitSha: 'c'.repeat(40),
      rootDirectory: sourceDirectory!,
      snapshotDirectory: sourceDirectory!,
      cleanup
    }
    const { deploymentId } = pipeline.run(deployInput({ app_name: 'failed-git-api' }), undefined, {
      handle: 'fake-handle',
      snapshot,
      gitRepoUrl: snapshot.repositoryUrl,
      gitRef: 'main',
      gitRoot: '.',
      commitSha: snapshot.commitSha,
      sourcePath: snapshot.rootDirectory,
      expiresAt: Date.now() + 60_000,
      plan: {} as never
    })
    const finished = await waitForFinished(deploymentId)
    expect(finished.status).toBe('failed')
    expect(deploymentRow(deploymentId).status).toBe('failed')
    expect(cleanup).toHaveBeenCalledOnce()
    logStreamSpy.mockRestore()
    expect(() => pipeline.run(deployInput({ app_name: 'failed-git-api' }))).not.toThrow()
    const retryDeployment = database
      .prepare(
        'SELECT id FROM deployment WHERE app_id = (SELECT id FROM app WHERE name = ?) ORDER BY version DESC LIMIT 1'
      )
      .get('failed-git-api') as { id: number }
    expect((await waitForFinished(retryDeployment.id)).status).toBe('running')
  })

  it('finalizes once and releases a Git snapshot when collector recovery throws, then permits retry', async () => {
    createHarness({
      metricSnapshot: (call) =>
        call === 2
          ? Promise.reject(new Error('synthetic metric snapshot failure'))
          : { generation: '1:1', device: 1, inode: 1, size: 10 }
    })
    const makeLease = (cleanup: Mock): NonNullable<Parameters<DeployPipeline['run']>[2]> => ({
      handle: 'fault-handle',
      snapshot: {
        repositoryUrl: 'https://github.com/example/repo.git',
        commitSha: 'c'.repeat(40),
        rootDirectory: sourceDirectory!,
        snapshotDirectory: sourceDirectory!,
        cleanup
      },
      gitRepoUrl: 'https://github.com/example/repo.git',
      gitRef: 'main',
      gitRoot: '.',
      commitSha: 'c'.repeat(40),
      sourcePath: sourceDirectory!,
      expiresAt: Date.now() + 60_000,
      plan: {} as never
    })

    const firstCleanup = vi.fn()
    const first = pipeline.run(deployInput(), undefined, makeLease(firstCleanup))
    expect((await waitForFinished(first.deploymentId)).status).toBe('running')
    expect(firstCleanup).toHaveBeenCalledOnce()

    const failedCleanup = vi.fn()
    const resumeSpy = vi
      .spyOn(pipeline as unknown as { resumeCollector: () => Promise<void> }, 'resumeCollector')
      .mockRejectedValue(new Error('synthetic collector recovery failure'))
    const failed = pipeline.run(deployInput(), undefined, makeLease(failedCleanup))
    expect((await waitForFinished(failed.deploymentId)).status).toBe('failed')
    await pipeline.shutdown()
    expect(resumeSpy).toHaveBeenCalledOnce()
    resumeSpy.mockRestore()

    expect(deploymentRow(failed.deploymentId).status).toBe('failed')
    expect(failedCleanup).toHaveBeenCalledOnce()
    expect(
      events.filter(
        (event) => event.type === 'finished' && event.deployment_id === failed.deploymentId
      )
    ).toHaveLength(1)

    const retry = pipeline.run(deployInput(), undefined, makeLease(vi.fn()))
    expect((await waitForFinished(retry.deploymentId)).status).toBe('running')
  })

  it('packaged resource path contains the collector files', () => {
    const resourceRoot = mkdtempSync(join(tmpdir(), 'opspilot-resources-'))
    mkdirSync(join(resourceRoot, 'collector'))
    writeFileSync(join(resourceRoot, 'collector', 'collect.py'), '# collector\n')
    writeFileSync(join(resourceRoot, 'collector', 'Dockerfile'), 'FROM python:3.12\n')
    const previous = process.env.OPSPILOT_COLLECTOR_DIR
    const previousResourcesPath = process.resourcesPath
    delete process.env.OPSPILOT_COLLECTOR_DIR
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourceRoot })
    try {
      expect(resolveCollectorDir()).toBe(join(resourceRoot, 'collector'))
    } finally {
      if (previous === undefined) delete process.env.OPSPILOT_COLLECTOR_DIR
      else process.env.OPSPILOT_COLLECTOR_DIR = previous
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: previousResourcesPath
      })
      rmSync(resourceRoot, { recursive: true, force: true })
    }
  })

  it('Express collector probe uses verified business route and health fallback', () => {
    const generic = mkdtempSync(join(tmpdir(), 'opspilot-express-generic-'))
    writeFileSync(join(generic, 'package.json'), '{"dependencies":{"express":"4"}}')
    writeFileSync(join(generic, 'server.js'), "app.get('/health', handler)\n")
    const demo = mkdtempSync(join(tmpdir(), 'opspilot-express-demo-'))
    writeFileSync(join(demo, 'package.json'), '{"dependencies":{"express":"4"}}')
    writeFileSync(join(demo, 'server.js'), "app.get('/items', handler)\n")
    try {
      expect(resolveCollectorAppPath('express', buildSourceTree(generic), '/health')).toBe(
        '/health'
      )
      expect(resolveCollectorAppPath('express', buildSourceTree(demo), '/health')).toBe(
        '/items?limit=1'
      )
    } finally {
      rmSync(generic, { recursive: true, force: true })
      rmSync(demo, { recursive: true, force: true })
    }
  })

  it('Express POST-only /items route falls back to healthcheck', () => {
    const source = mkdtempSync(join(tmpdir(), 'opspilot-express-post-only-'))
    writeFileSync(join(source, 'package.json'), '{"dependencies":{"express":"4"}}')
    writeFileSync(join(source, 'server.js'), "app.post('/items', handler)\n")
    try {
      expect(resolveCollectorAppPath('express', buildSourceTree(source), '/health')).toBe('/health')
    } finally {
      rmSync(source, { recursive: true, force: true })
    }
  })

  it('Express item-detail route does not masquerade as collection GET', () => {
    const source = mkdtempSync(join(tmpdir(), 'opspilot-express-item-detail-'))
    writeFileSync(join(source, 'package.json'), '{"dependencies":{"express":"4"}}')
    writeFileSync(join(source, 'server.js'), "app.get('/items/:id', handler)\n")
    try {
      expect(resolveCollectorAppPath('express', buildSourceTree(source), '/health')).toBe('/health')
    } finally {
      rmSync(source, { recursive: true, force: true })
    }
  })

  it('deploy moi thanh cong: du 7 buoc, ghi DB, .env ghi im lang', async () => {
    createHarness()
    const { deploymentId } = pipeline.run(deployInput())
    const finished = await waitForFinished()

    expect(finished.status).toBe('running')
    expect(finished.exposure_status).toBe('not_checked')
    expect(finished.app_url).toBeUndefined()

    const steps = events
      .filter((event) => event.type === 'step-done')
      .map((event) => (event.type === 'step-done' ? event.step : ''))
    expect(steps).toEqual([
      'PRECHECK',
      'UPLOAD',
      'RENDER',
      'BUILD',
      'DEPLOY',
      'HEALTHCHECK',
      'RECORD'
    ])
    expect(events.filter((event) => event.type === 'step-failed')).toHaveLength(0)
    expect(events[events.length - 1].type).toBe('finished')

    expect(deploymentRow(deploymentId)).toMatchObject({
      status: 'running',
      version: 1,
      failed_step: null
    })
    const app = database
      .prepare('SELECT host_port, current_deployment_id FROM app WHERE name = ?')
      .get('demo-api') as { host_port: number; current_deployment_id: number }
    expect(app.host_port).toBe(30000)
    expect(app.current_deployment_id).toBe(deploymentId)

    const envWrite = writeFileCalls().find((call) => call.remotePath.endsWith('.env'))
    expect(envWrite?.options).toEqual({ mode: 0o600, silent: true })
    expect(envWrite?.content).toContain('DATABASE_URL=postgresql://opspilot:')

    const composeWrite = writeFileCalls().find((call) =>
      call.remotePath.endsWith('docker-compose.yml')
    )
    expect(composeWrite?.content).toContain('image: demo-api:v1')
    expect(composeWrite?.content).toContain('image: postgres:16-alpine')
    expect(composeWrite?.content).toContain('image: demo-api:collector')
    expect(composeWrite?.content).toContain('APP_URL: "http://app:3000/health"')
    expect(composeWrite?.content).toContain('/var/run/docker.sock:/var/run/docker.sock:ro')
    expect(
      sshExec.mock.calls.some(
        ([, command]) => command.includes('docker build') && command.includes('collector')
      )
    ).toBe(true)
    expect(
      (pipeline as unknown as { ssh: { uploadDir: Mock } }).ssh.uploadDir.mock.calls.some(
        ([, , remotePath]) => remotePath === '/opt/opspilot/demo-api/collector'
      )
    ).toBe(true)

    expect(
      actionLogRows(deploymentId).some((row) => row.action === 'deploy' && row.status === 'success')
    ).toBe(true)
  })

  it('deploy moi dung dung host port da duoc remote precheck chon', async () => {
    createHarness()
    const { deploymentId } = pipeline.run({ ...deployInput(), host_port: 30024 })
    const finished = await waitForFinished(deploymentId)

    expect(finished.status).toBe('running')
    expect(finished.exposure_status).toBe('not_checked')
    expect(finished.app_url).toBeUndefined()
    expect(database.prepare('SELECT host_port FROM app WHERE name = ?').get('demo-api')).toEqual({
      host_port: 30024
    })
  })

  it('build arg VITE_API_URL dung env nguoi dung nhap, khong dung default .env.example', async () => {
    createHarness()
    const viteSource = createViteSource()
    try {
      const { deploymentId } = pipeline.run(
        deployInput({ source_path: viteSource, env: { VITE_API_URL: 'http://203.0.113.55:30001' } })
      )
      expect((await waitForFinished(deploymentId)).status).toBe('running')

      const buildCommand = appBuildCommand()
      expect(buildCommand).toContain('VITE_API_URL=http://203.0.113.55:30001')
      expect(buildCommand).not.toContain('VITE_API_URL=http://localhost:3000')
    } finally {
      rmSync(viteSource, { recursive: true, force: true })
    }
  })

  it('build arg roi ve default .env.example khi env rong (deploy thuong giu nguyen hanh vi)', async () => {
    createHarness()
    const viteSource = createViteSource()
    try {
      const { deploymentId } = pipeline.run(deployInput({ source_path: viteSource }))
      expect((await waitForFinished(deploymentId)).status).toBe('running')

      expect(appBuildCommand()).toContain('VITE_API_URL=http://localhost:3000')
    } finally {
      rmSync(viteSource, { recursive: true, force: true })
    }
  })

  it('first deploy succeeds when collector has not created metrics.jsonl', async () => {
    createHarness({ metricsFileMissing: true })
    const { deploymentId } = pipeline.run(deployInput())
    expect((await waitForFinished(deploymentId)).status).toBe('running')
    expect(
      database
        .prepare(
          "SELECT state, start_offset FROM deployment_activation WHERE deployment_id=? AND reason='deploy'"
        )
        .get(deploymentId)
    ).toMatchObject({ state: 'active', start_offset: 1 })
  })

  it('fails closed when collector stop/flush fails before an existing cutover', async () => {
    createHarness({ stopCollector: () => ({ code: 1, stdout: '', stderr: 'stop failed' }) })
    const first = pipeline.run(deployInput())
    expect((await waitForFinished(first.deploymentId)).status).toBe('running')
    const second = pipeline.run(deployInput())
    expect((await waitForFinished(second.deploymentId)).status).toBe('failed')
    expect(currentDeploymentId()).toBe(first.deploymentId)
    expect(
      writeFileCalls().filter((call) => call.remotePath.includes('.opspilot-app.json'))
    ).toHaveLength(1)
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM deployment_activation WHERE state='prepared'")
        .get()
    ).toEqual({ count: 0 })
  })

  it('redeploy app co san: cung port, version tang len 2', async () => {
    createHarness()
    const first = pipeline.run(deployInput())
    await waitForFinished(first.deploymentId)
    const second = pipeline.run(deployInput())
    const finished = await waitForFinished(second.deploymentId)

    expect(finished.status).toBe('running')
    expect(deploymentRow(second.deploymentId).version).toBe(2)
    expect(currentDeploymentId()).toBe(second.deploymentId)
    const app = database.prepare('SELECT host_port FROM app WHERE name = ?').get('demo-api') as {
      host_port: number
    }
    expect(app.host_port).toBe(30000)

    const envWrites = writeFileCalls().filter((call) => call.remotePath.endsWith('.env'))
    expect(envWrites).toHaveLength(2)
    const firstPassword = envWrites[0].content.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1]
    const secondPassword = envWrites[1].content.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1]
    expect(firstPassword).toMatch(/^[0-9a-f]{24}$/)
    expect(secondPassword).toBe(firstPassword)
    expect(envWrites[1].content).toContain(
      `DATABASE_URL=postgresql://opspilot:${firstPassword}@postgres:5432/opspilot`
    )
    expect(
      sshExec.mock.calls.some(([, command]) => String(command).includes('head -c 65537'))
    ).toBe(true)
    expect(JSON.stringify(events)).not.toContain(firstPassword)
  })

  it.each(['local', 'git'] as const)(
    'preserves all existing env and applies explicit non-DB overrides on %s redeploy',
    async (sourceType) => {
      createHarness()
      writeFileSync(join(sourceDirectory!, '.env.example'), 'SESSION_SECRET=fake-example\n')
      const initial = deployInput({
        env: {
          SESSION_SECRET: 'fake-existing-session-secret',
          API_TOKEN: 'fake-existing-api-token'
        }
      })
      const lease = sourceType === 'git' ? fakeGitLease(sourceDirectory!) : undefined
      const first = pipeline.run(initial, undefined, lease)
      expect((await waitForFinished(first.deploymentId)).status).toBe('running')
      const initialEnv = writeFileCalls().find((call) => call.remotePath.endsWith('.env'))?.content
      expect(initialEnv).toContain('SESSION_SECRET=fake-existing-session-secret')
      expect(initialEnv).toContain('API_TOKEN=fake-existing-api-token')

      const secondInput = deployInput({
        app_id: currentAppId(),
        env: { SESSION_SECRET: 'fake-explicit-session-override', PORT: '3210' }
      })
      const second = pipeline.run(secondInput, undefined, lease)
      expect((await waitForFinished(second.deploymentId)).status).toBe('running')

      const envWrites = writeFileCalls().filter((call) => call.remotePath.endsWith('.env'))
      expect(envWrites).toHaveLength(2)
      expect(envWrites[1]?.content).toContain('SESSION_SECRET=fake-explicit-session-override')
      expect(envWrites[1]?.content).toContain('API_TOKEN=fake-existing-api-token')
      expect(envWrites[1]?.content).toContain('PORT=3210')
      expect(envWrites[1]?.content).toContain('DATABASE_URL=postgresql://opspilot:')
      expect(envWrites[1]?.content).toContain('POSTGRES_PASSWORD=')
      expect(envWrites[1]?.content).not.toContain('fake-existing-session-secret')
      expect(JSON.stringify(events)).not.toContain('fake-existing-session-secret')
      expect(JSON.stringify(events)).not.toContain('fake-explicit-session-override')
      const actionLogs = database.prepare('SELECT message FROM action_log').all()
      expect(JSON.stringify(actionLogs)).not.toContain('fake-existing-session-secret')
      expect(JSON.stringify(actionLogs)).not.toContain('fake-explicit-session-override')
    }
  )

  it('fails before upload or env write when existing required env is missing or unreadable', async () => {
    createHarness({
      remoteEnvContent:
        'PORT=3000\nDATABASE_URL=fake-existing-db\nPOSTGRES_PASSWORD=fake-existing-password\n',
      remoteEnvReadFails: true
    })
    writeFileSync(join(sourceDirectory!, '.env.example'), 'SESSION_SECRET=fake-example\n')
    const initial = pipeline.run(deployInput({ env: { SESSION_SECRET: 'fake-existing-secret' } }))
    expect((await waitForFinished(initial.deploymentId)).status).toBe('running')

    const missing = pipeline.run(deployInput({ app_id: currentAppId() }))
    const failed = await waitForFinished(missing.deploymentId)
    expect(failed.status).toBe('failed')
    const precheckFailure = events.find(
      (event) => event.type === 'step-failed' && event.deployment_id === missing.deploymentId
    )
    expect(precheckFailure?.type).toBe('step-failed')
    if (precheckFailure?.type === 'step-failed') {
      expect(precheckFailure.step).toBe('PRECHECK')
      expect(precheckFailure.error.message).not.toContain('fake-secret-not-for-logs')
      expect(precheckFailure.error.message).toContain('SESSION_SECRET')
    }
    expect(uploadDirMock).toHaveBeenCalledTimes(2)
    expect(writeFileCalls().filter((call) => call.remotePath.endsWith('.env'))).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('fake-existing-secret')
  })

  it('app build fail khong xoa collector tag dang ton tai', async () => {
    createHarness({
      buildResult: (command) =>
        command.includes("docker build -t 'demo-api:v1' .")
          ? { code: 1, stdout: '', stderr: 'app build failed' }
          : { code: 0, stdout: 'collector ok', stderr: '' }
    })
    const first = pipeline.run(deployInput())
    expect((await waitForFinished(first.deploymentId)).status).toBe('failed')
    const removals = sshExec.mock.calls
      .map(([, command]) => command as string)
      .filter((command) => command.includes('docker image rm'))
    expect(removals.some((command) => command.includes('demo-api:collector'))).toBe(false)
  })

  it('precheck truot -> dung o buoc PRECHECK, chua build gi', async () => {
    createHarness({
      precheckOutput: 'RAM_MB|100\nDISK_GB|20\nPORT|FREE\nDOCKER|Docker version 27.1.0'
    })
    const { deploymentId } = pipeline.run(deployInput())
    const finished = await waitForFinished()

    expect(finished.status).toBe('failed')
    const failed = events.find((event) => event.type === 'step-failed')
    expect(failed?.type === 'step-failed' && failed.step).toBe('PRECHECK')
    expect(failed?.type === 'step-failed' && failed.last_log_lines.join('\n')).toContain(
      'RAM trống'
    )
    expect(deploymentRow(deploymentId)).toMatchObject({ status: 'failed', failed_step: 'PRECHECK' })
    expect(sshExec.mock.calls.some(([, command]) => command.includes('docker build'))).toBe(false)
  })

  it('healthcheck truot -> auto rollback cho app cu ready lai thay vi fail o probe dau', async () => {
    // call 1: deploy v1; call 2..11: v2 lỗi; call 12: rollback vừa running nhưng app/DB
    // chưa ready; call 13: app cũ đã ready.
    createHarness({ curlOk: (call) => call === 1 || call === 13 })
    const first = pipeline.run(deployInput())
    expect((await waitForFinished()).status).toBe('running')
    const previousManifest = remoteManifestFiles.get('/opt/opspilot/demo-api/.opspilot-app.json')

    vi.useFakeTimers()
    const eventCountBefore = events.length
    const second = pipeline.run(deployInput())
    await advanceFailedHealthcheck()
    vi.useRealTimers()

    const finished = events
      .slice(eventCountBefore)
      .find((event) => event.type === 'finished' && event.deployment_id === second.deploymentId) as
      Extract<DeployEvent, { type: 'finished' }> | undefined
    expect(finished?.status).toBe('rolled_back')

    expect(deploymentRow(second.deploymentId)).toMatchObject({
      status: 'rolled_back',
      failed_step: 'HEALTHCHECK'
    })
    expect(currentDeploymentId()).toBe(first.deploymentId)
    expect(remoteManifestFiles.get('/opt/opspilot/demo-api/.opspilot-app.json')).toBe(
      previousManifest
    )

    // Extra DEPLOY step events cua nhanh tu rollback (bat bien 6)
    const secondRunEvents = events
      .slice(eventCountBefore)
      .filter((event) => event.deployment_id === second.deploymentId)
    const deployStarts = secondRunEvents.filter(
      (event) => event.type === 'step-start' && event.step === 'DEPLOY'
    )
    expect(deployStarts).toHaveLength(2)

    // Compose duoc viet lai voi image v1 (lan 1: deploy v1, lan 2: rollback)
    const v1ComposeWrites = writeFileCalls().filter(
      (call) =>
        call.remotePath.endsWith('docker-compose.yml') && call.content.includes('demo-api:v1')
    )
    expect(v1ComposeWrites).toHaveLength(2)
    expect(actionLogRows(second.deploymentId).some((row) => row.action === 'rollback_auto')).toBe(
      true
    )
    expect(
      actionLogRows(second.deploymentId).some(
        (row) => row.action === 'rollback_auto' && row.status === 'success'
      )
    ).toBe(true)
    const healthProbes = sshExec.mock.calls.filter(([, command]) =>
      (command as string).includes('curl -fsS')
    )
    expect(healthProbes).toHaveLength(13)
  })

  it('auto rollback compose fail -> step DEPLOY failed, DB failed va khong doi current', async () => {
    createHarness({
      curlOk: (call) => call === 1 || call >= 12,
      composeUp: (call) =>
        call === 3
          ? { code: 1, stdout: '', stderr: 'compose rollback failed' }
          : { code: 0, stdout: 'started', stderr: '' }
    })
    const first = pipeline.run(deployInput())
    await waitForFinished(first.deploymentId)

    vi.useFakeTimers()
    const eventCountBefore = events.length
    const second = pipeline.run(deployInput())
    await advanceFailedHealthcheck()
    vi.useRealTimers()

    const finished = await waitForFinished(second.deploymentId)
    expect(finished.status).toBe('failed')
    expect(deploymentRow(second.deploymentId)).toMatchObject({
      status: 'failed',
      failed_step: 'HEALTHCHECK'
    })
    expect(currentDeploymentId()).toBe(first.deploymentId)
    const secondEvents = events.slice(eventCountBefore)
    expect(
      secondEvents.some((event) => event.type === 'step-failed' && event.step === 'DEPLOY')
    ).toBe(true)
    expect(
      actionLogRows(second.deploymentId).some(
        (row) => row.action === 'rollback_auto' && row.status === 'failed'
      )
    ).toBe(true)
    expect(
      actionLogRows(second.deploymentId).some(
        (row) => row.action === 'rollback_auto' && row.status === 'success'
      )
    ).toBe(false)

    // An inconclusive restore is a durable reconciliation barrier; a new deploy
    // must not reopen polling or silently proceed over the unknown owner.
    const next = pipeline.run(deployInput())
    expect((await waitForFinished(next.deploymentId)).status).toBe('failed')
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM deployment_activation WHERE state='prepared'")
        .get()
    ).toEqual({ count: 1 })
  })

  it('auto rollback v1 khong running -> failed va khong doi current', async () => {
    createHarness({
      curlOk: (call) => call === 1,
      inspectStatus: (call) => (call <= 2 ? 'running' : 'restarting')
    })
    const first = pipeline.run(deployInput())
    await waitForFinished(first.deploymentId)

    vi.useFakeTimers()
    const second = pipeline.run(deployInput())
    await advanceFailedHealthcheck()
    await vi.advanceTimersByTimeAsync(181_000)
    vi.useRealTimers()

    const finished = await waitForFinished(second.deploymentId)
    expect(finished.status).toBe('failed')
    expect(currentDeploymentId()).toBe(first.deploymentId)
    expect(events.some((event) => event.type === 'step-failed' && event.step === 'DEPLOY')).toBe(
      true
    )
  })

  it('auto rollback v1 healthcheck fail -> failed va khong ghi success', async () => {
    createHarness({ curlOk: (call) => call === 1 })
    const first = pipeline.run(deployInput())
    await waitForFinished(first.deploymentId)

    vi.useFakeTimers()
    const second = pipeline.run(deployInput())
    await advanceFailedHealthcheck()
    vi.useRealTimers()

    expect((await waitForFinished(second.deploymentId)).status).toBe('failed')
    expect(currentDeploymentId()).toBe(first.deploymentId)
    expect(
      actionLogRows(second.deploymentId).some(
        (row) => row.action === 'rollback_auto' && row.status === 'success'
      )
    ).toBe(false)
  })

  it('rollback thu cong success chi sau running va healthcheck, roi release lock', async () => {
    createHarness()
    const first = pipeline.run(deployInput())
    await waitForFinished(first.deploymentId)
    const second = pipeline.run(deployInput())
    await waitForFinished(second.deploymentId)

    const rollback = pipeline.rollback(currentAppId(), first.deploymentId)
    expect((await waitForFinished(rollback.deploymentId)).status).toBe('running')
    expect(currentDeploymentId()).toBe(rollback.deploymentId)
    expect(
      actionLogRows(rollback.deploymentId).some(
        (row) => row.action === 'rollback_manual' && row.status === 'success'
      )
    ).toBe(true)

    const next = pipeline.run(deployInput())
    expect((await waitForFinished(next.deploymentId)).status).toBe('running')
  })

  it('rollback thu cong healthcheck fail -> khong doi current va ghi failed', async () => {
    createHarness({ curlOk: (call) => call <= 2 })
    const first = pipeline.run(deployInput())
    await waitForFinished(first.deploymentId)
    const second = pipeline.run(deployInput())
    await waitForFinished(second.deploymentId)

    vi.useFakeTimers()
    const rollback = pipeline.rollback(currentAppId(), first.deploymentId)
    await advanceFailedHealthcheck()
    vi.useRealTimers()
    expect((await waitForFinished(rollback.deploymentId)).status).toBe('failed')
    expect(currentDeploymentId()).toBe(second.deploymentId)
    expect(deploymentRow(rollback.deploymentId).failed_step).toBe('HEALTHCHECK')
    expect(
      actionLogRows(rollback.deploymentId).some(
        (row) => row.action === 'rollback_manual' && row.status === 'failed'
      )
    ).toBe(true)
  })

  it('auto rollback sau manual rollback dung image runtime cua target goc', async () => {
    createHarness({ curlOk: (call) => call <= 3 || call === 14 })
    const first = pipeline.run(deployInput())
    await waitForFinished(first.deploymentId)
    const second = pipeline.run(deployInput())
    await waitForFinished(second.deploymentId)
    const manual = pipeline.rollback(currentAppId(), first.deploymentId)
    await waitForFinished(manual.deploymentId)

    vi.useFakeTimers()
    const next = pipeline.run(deployInput())
    await advanceFailedHealthcheck()
    vi.useRealTimers()

    expect((await waitForFinished(next.deploymentId)).status).toBe('rolled_back')
    expect(currentDeploymentId()).toBe(manual.deploymentId)
    const v1ComposeWrites = writeFileCalls().filter(
      (call) =>
        call.remotePath.endsWith('docker-compose.yml') && call.content.includes('demo-api:v1')
    )
    expect(v1ComposeWrites).toHaveLength(3)
    expect(v1ComposeWrites.every((call) => call.content.includes('demo-api:collector'))).toBe(true)
    expect(
      v1ComposeWrites.every((call) =>
        call.content.includes('/var/run/docker.sock:/var/run/docker.sock:ro')
      )
    ).toBe(true)
    expect(
      writeFileCalls().some(
        (call) =>
          call.remotePath.endsWith('docker-compose.yml') && call.content.includes('demo-api:v3')
      )
    ).toBe(false)
  })

  it('rollback thu cong tu choi target failed truoc khi tao attempt', async () => {
    createHarness({
      precheckOutput: 'RAM_MB|100\nDISK_GB|20\nPORT|FREE\nDOCKER|Docker version 27.1.0'
    })
    const failed = pipeline.run(deployInput())
    await waitForFinished(failed.deploymentId)

    expect(() => pipeline.rollback(currentAppId(), failed.deploymentId)).toThrow('VALIDATION')
    const count = database.prepare('SELECT COUNT(*) AS total FROM deployment').get() as {
      total: number
    }
    expect(count.total).toBe(1)
  })

  it('rollback thu cong target da bi xoa image -> VALIDATION va khong compose lai', async () => {
    createHarness({ imageAvailable: false })
    const first = pipeline.run(deployInput())
    await waitForFinished(first.deploymentId)
    const second = pipeline.run(deployInput())
    await waitForFinished(second.deploymentId)
    const composeCallsBefore = sshExec.mock.calls.filter(([, command]) =>
      (command as string).includes('compose up -d')
    ).length

    const rollback = pipeline.rollback(currentAppId(), first.deploymentId)
    expect((await waitForFinished(rollback.deploymentId)).status).toBe('failed')
    expect(currentDeploymentId()).toBe(second.deploymentId)
    const failed = events.find(
      (event) => event.type === 'step-failed' && event.deployment_id === rollback.deploymentId
    )
    expect(failed?.type === 'step-failed' && failed.error.code).toBe('VALIDATION')
    expect(failed?.type === 'step-failed' && failed.error.message).toContain('không còn trên VPS')
    const composeCallsAfter = sshExec.mock.calls.filter(([, command]) =>
      (command as string).includes('compose up -d')
    ).length
    expect(composeCallsAfter).toBe(composeCallsBefore)
  })

  it('image retention bao ve v1 dang chay, giu toi da 3 tag va khong dung force', async () => {
    const listedImages = [
      'demo-api:v1',
      'demo-api:v2',
      'demo-api:v3',
      'demo-api:v4',
      'demo-api:v5',
      'demo-api-worker:v9',
      'demo-api:v5-extra'
    ].join('\n')
    createHarness({
      curlOk: (call) => call === 1 || call === 12,
      imagesOutput: (call) => (call === 1 ? '' : listedImages),
      imageRemove: (call) =>
        call === 1
          ? { code: 1, stdout: '', stderr: 'image busy' }
          : { code: 0, stdout: '', stderr: '' }
    })
    const first = pipeline.run(deployInput())
    await waitForFinished(first.deploymentId)

    vi.useFakeTimers()
    const second = pipeline.run(deployInput())
    await advanceFailedHealthcheck()
    vi.useRealTimers()
    expect((await waitForFinished(second.deploymentId)).status).toBe('rolled_back')

    const removeCommands = sshExec.mock.calls
      .map(([, command]) => command as string)
      .filter((command) => command.includes('docker image rm'))
    expect(removeCommands).toHaveLength(2)
    expect(removeCommands.some((command) => command.includes("'demo-api:v3'"))).toBe(true)
    expect(removeCommands.some((command) => command.includes("'demo-api:v2'"))).toBe(true)
    expect(removeCommands.some((command) => command.includes("'demo-api:v1'"))).toBe(false)
    expect(removeCommands.some((command) => command.includes('demo-api-worker'))).toBe(false)
    expect(removeCommands.every((command) => !command.includes(' rm -f '))).toBe(true)
  })

  it('hai app khac nhau tren cung VPS chay song song va nhan port khac nhau', async () => {
    createHarness()
    const first = pipeline.run(deployInput({ app_name: 'demo-api' }))
    const second = pipeline.run(deployInput({ app_name: 'worker-api' }))

    expect((await waitForFinished(first.deploymentId)).status).toBe('running')
    expect((await waitForFinished(second.deploymentId)).status).toBe('running')
    const rows = database
      .prepare('SELECT name, host_port FROM app ORDER BY host_port')
      .all() as Array<{ name: string; host_port: number }>
    expect(rows).toEqual([
      { name: 'demo-api', host_port: 30_000 },
      { name: 'worker-api', host_port: 30_001 }
    ])
  })

  it.each([
    { status: 'exited', health: 'none', exitCode: 137 },
    { status: 'running', health: 'unhealthy', exitCode: 1 }
  ])(
    'container $status/$health -> diagnostic co state, log mask secret va huong xu ly',
    async ({ status, health, exitCode }) => {
      createHarness({
        inspectState: () => ({
          Status: status,
          ExitCode: exitCode,
          Error: 'password=inspect-secret',
          Health: { Status: health }
        }),
        containerLogs:
          'password=log-secret token=abc123 DATABASE_URL=postgresql://user:url-secret@db:5432/app'
      })

      const deployment = pipeline.run(deployInput())
      const finished = await waitForFinished(deployment.deploymentId)
      expect(finished.status).toBe('failed')
      const failed = events.find(
        (event) => event.type === 'step-failed' && event.deployment_id === deployment.deploymentId
      )
      expect(failed?.type === 'step-failed' && failed.error.message).toContain(`status=${status}`)
      expect(failed?.type === 'step-failed' && failed.error.message).toContain(`health=${health}`)
      expect(failed?.type === 'step-failed' && failed.error.message).toContain(
        `exit_code=${exitCode}`
      )
      expect(JSON.stringify(failed)).toContain('***')
      expect(JSON.stringify(failed)).not.toContain('inspect-secret')
      expect(JSON.stringify(failed)).not.toContain('log-secret')
      expect(JSON.stringify(failed)).not.toContain('abc123')
      expect(JSON.stringify(failed)).not.toContain('url-secret')
      expect(
        sshExec.mock.calls.some(
          ([, command]) =>
            (command as string).includes('docker inspect') &&
            !(command as string).toLowerCase().includes('env')
        )
      ).toBe(true)
    }
  )

  it.each(['missing', 'restarting'])(
    'container %s qua deadline -> diagnostic timeout thay vi loi mo ho',
    async (status) => {
      createHarness({ inspectStatus: () => status, containerLogs: 'boot loop' })
      vi.useFakeTimers()
      const deployment = pipeline.run(deployInput())
      await vi.advanceTimersByTimeAsync(181_000)
      vi.useRealTimers()

      const finished = await waitForFinished(deployment.deploymentId)
      expect(finished.status).toBe('failed')
      const failed = events.find(
        (event) => event.type === 'step-failed' && event.deployment_id === deployment.deploymentId
      )
      expect(failed?.type === 'step-failed' && failed.error.code).toBe('SSH_TIMEOUT')
      expect(failed?.type === 'step-failed' && failed.error.message).toContain(`status=${status}`)
    }
  )

  it('side-effect command khong retry; probe images cho phep reconnect retry', async () => {
    createHarness({
      composeUp: () => ({ code: 1, stdout: '', stderr: 'compose failed' })
    })
    const deployment = pipeline.run(deployInput())
    expect((await waitForFinished(deployment.deploymentId)).status).toBe('failed')

    const buildCalls = sshExec.mock.calls.filter(([, command]) =>
      (command as string).includes('docker build')
    )
    const composeUpCalls = sshExec.mock.calls.filter(([, command]) =>
      (command as string).includes('compose up -d')
    )
    const composeDownCalls = sshExec.mock.calls.filter(([, command]) =>
      (command as string).includes('compose down')
    )
    expect(buildCalls).toHaveLength(1)
    expect(composeUpCalls).toHaveLength(1)
    expect(composeDownCalls).toHaveLength(1)
    for (const call of [...buildCalls, ...composeUpCalls, ...composeDownCalls]) {
      expect(call[2]).toMatchObject({ retryOnReconnect: false })
    }
    const imageProbe = sshExec.mock.calls.find(([, command]) =>
      (command as string).includes('docker images')
    )
    expect(imageProbe?.[2]).toMatchObject({ retryOnReconnect: true })
  })

  it('cancel khi dang cho container dung timer va release lock sach', async () => {
    createHarness({ inspectStatus: () => 'restarting' })
    vi.useFakeTimers()
    const deployment = pipeline.run(deployInput())
    await vi.advanceTimersByTimeAsync(2_100)
    expect(pipeline.cancel(deployment.deploymentId)).toBe(true)
    await vi.runAllTimersAsync()

    const finished = events.find(
      (event) => event.type === 'finished' && event.deployment_id === deployment.deploymentId
    )
    expect(finished?.type === 'finished' && finished.status).toBe('failed')
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()

    const next = pipeline.run(deployInput())
    pipeline.cancel(next.deploymentId)
    expect((await waitForFinished(next.deploymentId)).status).toBe('failed')
  })

  it('khoa hai pipeline cung app: lan thu hai bao VALIDATION ngay lap tuc', async () => {
    createHarness()
    const first = pipeline.run(deployInput())
    expect(() => pipeline.run(deployInput())).toThrow('VALIDATION')
    pipeline.cancel(first.deploymentId)
    expect((await waitForFinished(first.deploymentId)).status).toBe('failed')
  })

  it('huy giua chung -> kem ghi nhan cancelled trong action_log', async () => {
    createHarness()
    const { deploymentId } = pipeline.run(deployInput())
    pipeline.cancel(deploymentId)
    const finished = await waitForFinished()

    expect(finished.status).toBe('failed')
    expect(actionLogRows(deploymentId).some((row) => row.status === 'cancelled')).toBe(true)
    expect(deploymentRow(deploymentId).status).toBe('failed')
    const cleanup = sshExec.mock.calls.find(([, command]) =>
      (command as string).includes('docker images')
    )
    expect(cleanup?.[2]).toEqual({ timeoutMs: 30_000, retryOnReconnect: true })

    const next = pipeline.run(deployInput())
    expect((await waitForFinished(next.deploymentId)).status).toBe('running')
  })

  it('cleanup after cancellation uses an independent signal and verifies collector state', async () => {
    let releaseSnapshot!: () => void
    let snapshotEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      snapshotEntered = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      releaseSnapshot = resolve
    })
    let snapshotCalls = 0
    createHarness({
      metricSnapshot: async (call) => {
        snapshotCalls = call
        if (call === 2) {
          snapshotEntered()
          await blocked
          throw new Error('snapshot cancelled')
        }
        return { generation: '1:1', device: 1, inode: 1, size: 10 }
      }
    })
    const first = pipeline.run(deployInput())
    expect((await waitForFinished(first.deploymentId)).status).toBe('running')

    const second = pipeline.run(deployInput())
    await entered
    expect(snapshotCalls).toBe(2)
    expect(pipeline.cancel(second.deploymentId)).toBe(true)
    releaseSnapshot()
    expect((await waitForFinished(second.deploymentId)).status).toBe('failed')

    const cleanup = sshExec.mock.calls.find(([, command]) =>
      (command as string).includes('compose start collector')
    )
    expect(cleanup).toBeDefined()
    expect((cleanup?.[2] as { signal: AbortSignal }).signal.aborted).toBe(false)
    expect(
      sshExec.mock.calls.some(([, command]) =>
        (command as string).includes("docker inspect -f '{{json .State}}' 'demo-api-collector'")
      )
    ).toBe(true)
    expect(actionLogRows(second.deploymentId).some((row) => row.status === 'cancelled')).toBe(true)
  })

  it('keeps a durable prepared barrier when previous restore ownership is unknown', async () => {
    let composeCalls = 0
    createHarness({
      composeUp: (call) => {
        composeCalls = call
        return call === 2
          ? { code: 1, stdout: 'started', stderr: 'candidate failed' }
          : { code: 0, stdout: 'running', stderr: '' }
      },
      runtimeImage: (_appName, call) => (call === 3 ? 'demo-api:wrong' : 'demo-api:v1')
    })
    const first = pipeline.run(deployInput())
    expect((await waitForFinished(first.deploymentId)).status).toBe('running')

    const second = pipeline.run(deployInput())
    expect((await waitForFinished(second.deploymentId)).status).toBe('failed')
    expect(composeCalls).toBe(3)
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM deployment_activation WHERE state='prepared'")
        .get()
    ).toEqual({ count: 1 })
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM action_log WHERE message LIKE '%Prepared activation requires reconciliation%'"
        )
        .get()
    ).toEqual({ count: 1 })
  })

  describe('Publish, Reachability & Exposure', () => {
    it('khi loopback healthcheck pass và external probe fail: không rollback app healthy, ghi status running và exposure degraded', async () => {
      createHarness()
      const mockReconcile = vi.fn().mockResolvedValue({
        status: 'degraded',
        url: 'http://203.0.113.55:30000',
        external_probe: 'unreachable',
        ufw_state: 'active',
        ufw_reconciled: true,
        cloud_firewall: 'not_configured',
        diagnosis: {
          code: 'PORT_BLOCKED_EXTERNAL',
          title: 'Cổng 30000 bị chặn từ bên ngoài',
          cause: 'Firewall',
          fixes: ['Mở cổng 30000']
        },
        checked_at: new Date().toISOString()
      })

      const pipelineWithExposure = new DeployPipeline({
        ssh: (pipeline as unknown as { ssh: SshManager }).ssh,
        db: database,
        emit: (event) => events.push(event),
        exposure: { reconcile: mockReconcile }
      })

      const handle = pipelineWithExposure.run(deployInput())
      const finished = await waitForFinished(handle.deploymentId)

      expect(finished.status).toBe('running')
      expect(finished.exposure_status).toBe('degraded')
      expect(finished.app_url).toBeUndefined()

      const row = database
        .prepare(
          'SELECT status, exposure_status, exposure_evidence_json FROM deployment WHERE id = ?'
        )
        .get(handle.deploymentId) as {
        status: string
        exposure_status: string
        exposure_evidence_json: string
      }
      expect(row.status).toBe('running')
      expect(row.exposure_status).toBe('degraded')
      expect(row.exposure_evidence_json).toContain('PORT_BLOCKED_EXTERNAL')
      expect(mockReconcile).toHaveBeenCalledTimes(1)
    })

    it('khi loopback healthcheck pass và external probe ok: ghi status running và exposure reachable', async () => {
      createHarness()
      const mockReconcile = vi.fn().mockResolvedValue({
        status: 'reachable',
        url: 'http://203.0.113.55:30000',
        external_probe: 'reachable',
        ufw_state: 'active',
        ufw_reconciled: true,
        cloud_firewall: 'not_configured',
        diagnosis: null,
        checked_at: new Date().toISOString()
      })

      const pipelineWithExposure = new DeployPipeline({
        ssh: (pipeline as unknown as { ssh: SshManager }).ssh,
        db: database,
        emit: (event) => events.push(event),
        exposure: { reconcile: mockReconcile }
      })

      const handle = pipelineWithExposure.run(deployInput())
      const finished = await waitForFinished(handle.deploymentId)

      expect(finished.status).toBe('running')
      expect(finished.exposure_status).toBe('reachable')
      expect(finished.app_url).toBe('http://203.0.113.55:30000')

      const row = database
        .prepare('SELECT status, exposure_status FROM deployment WHERE id = ?')
        .get(handle.deploymentId) as { status: string; exposure_status: string }
      expect(row.status).toBe('running')
      expect(row.exposure_status).toBe('reachable')
    })

    it('khi loopback healthcheck fail: không gọi publishExposure và rollback', async () => {
      createHarness({
        curlOk: () => false,
        inspectState: () => ({ Status: 'running', ExitCode: 0, Error: '' })
      })
      const mockReconcile = vi.fn()

      const pipelineWithExposure = new DeployPipeline({
        ssh: (pipeline as unknown as { ssh: SshManager }).ssh,
        db: database,
        emit: (event) => events.push(event),
        exposure: { reconcile: mockReconcile }
      })

      vi.useFakeTimers()
      const handle = pipelineWithExposure.run(deployInput())
      await advanceFailedHealthcheck()
      vi.useRealTimers()

      const finished = await waitForFinished(handle.deploymentId)

      expect(finished.status).toBe('failed')
      expect(mockReconcile).not.toHaveBeenCalled()
    })

    it('khi thiếu ExposureManager: ghi status running, exposure not_checked và không trả app_url', async () => {
      createHarness()
      const pipelineWithoutExposure = new DeployPipeline({
        ssh: (pipeline as unknown as { ssh: SshManager }).ssh,
        db: database,
        emit: (event) => events.push(event)
      })

      const handle = pipelineWithoutExposure.run(deployInput())
      const finished = await waitForFinished(handle.deploymentId)

      expect(finished.status).toBe('running')
      expect(finished.exposure_status).toBe('not_checked')
      expect(finished.app_url).toBeUndefined()

      const row = database
        .prepare(
          'SELECT status, exposure_status, exposure_evidence_json FROM deployment WHERE id = ?'
        )
        .get(handle.deploymentId) as {
        status: string
        exposure_status: string
        exposure_evidence_json: string | null
      }
      expect(row.status).toBe('running')
      expect(row.exposure_status).toBe('not_checked')
      expect(row.exposure_evidence_json).toBeNull()
    })

    it('khi publish ném ngoại lệ: giữ status running, exposure degraded, log đã che secret và không gán nhầm mã', async () => {
      createHarness()
      const mockReconcile = vi
        .fn()
        .mockRejectedValue(
          new Error(
            'Failed connecting to cloud provider with token=secret_token_123&password=super_secret_pw'
          )
        )

      const pipelineWithExposure = new DeployPipeline({
        ssh: (pipeline as unknown as { ssh: SshManager }).ssh,
        db: database,
        emit: (event) => events.push(event),
        exposure: { reconcile: mockReconcile }
      })

      const handle = pipelineWithExposure.run(deployInput())
      const finished = await waitForFinished(handle.deploymentId)

      expect(finished.status).toBe('running')
      expect(finished.exposure_status).toBe('degraded')
      expect(finished.app_url).toBeUndefined()
      // Bắt lỗi gán nhầm mã: không gán PORT_BLOCKED_EXTERNAL hoặc kết luận cloud firewall failed khi chưa có bằng chứng
      expect(finished.exposure_evidence?.diagnosis).toBeFalsy()
      expect(finished.exposure_evidence?.cloud_firewall).not.toBe('failed')

      const healthcheckLogs = events
        .filter((e) => e.type === 'log' && e.step === 'HEALTHCHECK')
        .map((e) => (e.type === 'log' ? e.chunk : ''))
        .join('')
      expect(healthcheckLogs).toContain('Publish chưa hoàn tất')
      expect(healthcheckLogs).not.toContain('secret_token_123')
      expect(healthcheckLogs).not.toContain('super_secret_pw')
      expect(healthcheckLogs).toContain('token=***')

      const row = database
        .prepare(
          'SELECT status, exposure_status, exposure_evidence_json FROM deployment WHERE id = ?'
        )
        .get(handle.deploymentId) as {
        status: string
        exposure_status: string
        exposure_evidence_json: string | null
      }
      expect(row.status).toBe('running')
      expect(row.exposure_status).toBe('degraded')
      expect(row.exposure_evidence_json).toBeNull()
    })

    it('rollback thủ công khi thiếu ExposureManager: ghi running, exposure not_checked và không trả app_url', async () => {
      createHarness()
      const pipelineWithoutExposure = new DeployPipeline({
        ssh: (pipeline as unknown as { ssh: SshManager }).ssh,
        db: database,
        emit: (event) => events.push(event)
      })

      const first = pipelineWithoutExposure.run(deployInput())
      await waitForFinished(first.deploymentId)
      const second = pipelineWithoutExposure.run(deployInput())
      await waitForFinished(second.deploymentId)

      const rollback = pipelineWithoutExposure.rollback(currentAppId(), first.deploymentId)
      const finished = await waitForFinished(rollback.deploymentId)

      expect(finished.status).toBe('running')
      expect(finished.exposure_status).toBe('not_checked')
      expect(finished.app_url).toBeUndefined()

      const row = database
        .prepare(
          'SELECT status, exposure_status, exposure_evidence_json FROM deployment WHERE id = ?'
        )
        .get(rollback.deploymentId) as {
        status: string
        exposure_status: string
        exposure_evidence_json: string | null
      }
      expect(row.status).toBe('running')
      expect(row.exposure_status).toBe('not_checked')
      expect(row.exposure_evidence_json).toBeNull()
    })

    it('rollback thủ công khi publish ném ngoại lệ: giữ running, exposure degraded, log đã che secret và không gán nhầm mã', async () => {
      createHarness()
      const mockReconcile = vi
        .fn()
        .mockResolvedValueOnce({
          status: 'reachable',
          url: 'http://203.0.113.55:30000',
          external_probe: 'reachable',
          ufw_state: 'active',
          ufw_reconciled: true,
          cloud_firewall: 'not_configured',
          diagnosis: null,
          checked_at: new Date().toISOString()
        })
        .mockRejectedValue(
          new Error(
            'Cloud API error with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123 and secret: my_secret_key'
          )
        )

      const pipelineWithExposure = new DeployPipeline({
        ssh: (pipeline as unknown as { ssh: SshManager }).ssh,
        db: database,
        emit: (event) => events.push(event),
        exposure: { reconcile: mockReconcile }
      })

      const first = pipelineWithExposure.run(deployInput())
      await waitForFinished(first.deploymentId)

      const rollback = pipelineWithExposure.rollback(currentAppId(), first.deploymentId)
      const finished = await waitForFinished(rollback.deploymentId)

      expect(finished.status).toBe('running')
      expect(finished.exposure_status).toBe('degraded')
      expect(finished.app_url).toBeUndefined()
      // Bắt lỗi gán nhầm mã: không gán PORT_BLOCKED_EXTERNAL hoặc kết luận cloud firewall failed khi chưa có bằng chứng
      expect(finished.exposure_evidence?.diagnosis).toBeFalsy()
      expect(finished.exposure_evidence?.cloud_firewall).not.toBe('failed')

      const rollbackLogs = events
        .filter((e) => e.type === 'log' && e.step === 'HEALTHCHECK')
        .map((e) => (e.type === 'log' ? e.chunk : ''))
        .join('')
      expect(rollbackLogs).toContain('Publish chưa hoàn tất')
      expect(rollbackLogs).not.toContain('my_secret_key')
      expect(rollbackLogs).not.toContain('eyJhbGciOi')
      expect(rollbackLogs).toContain('Bearer ***')

      const row = database
        .prepare(
          'SELECT status, exposure_status, exposure_evidence_json FROM deployment WHERE id = ?'
        )
        .get(rollback.deploymentId) as {
        status: string
        exposure_status: string
        exposure_evidence_json: string | null
      }
      expect(row.status).toBe('running')
      expect(row.exposure_status).toBe('degraded')
      expect(row.exposure_evidence_json).toBeNull()
    })
  })
})

function fakeCredential(value: string): EncryptedCredential {
  return {
    crypto_scheme: 'aes_256_gcm',
    encrypted_secret: Buffer.from(value),
    iv: Buffer.alloc(12, 1),
    auth_tag: Buffer.alloc(16, 2)
  }
}
