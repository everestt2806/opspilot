import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Mock } from 'vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DeployEvent, DeployInput } from '@shared/ipc'

import type { EncryptedCredential } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from '../db'
import { VpsRepository } from '../db/vpsRepository'
import type { SshManager } from '../ssh/manager'
import { DeployPipeline } from './pipeline'

const PRECHECK_OK = [
  'RAM_MB|2048',
  'DISK_GB|20',
  'PORT|FREE',
  'DOCKER|Docker version 27.1.0, build 6312585',
  'Docker Compose version v2.29.1'
].join('\n')

interface StubSshOptions {
  precheckOutput?: string
  curlOk?: () => boolean
}

let testDirectory: string | null = null
let sourceDirectory: string | null = null
let vpsId = 0
let database: ReturnType<typeof initializeDatabase>
let sshExec: Mock
let writeFileMock: Mock
let events: DeployEvent[]
let pipeline: DeployPipeline

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
      dependencies: { express: '^4.19.2' },
      devDependencies: { pg: '^8.11.0' }
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

  sshExec = vi.fn(async (_vpsId: number, command: string) => {
    if (command.includes('free -m')) {
      return { code: 0, stdout: options.precheckOutput ?? PRECHECK_OK, stderr: '' }
    }
    if (command.includes('docker build')) {
      return { code: 0, stdout: 'build xong\n', stderr: '' }
    }
    if (command.includes('compose up -d')) {
      return { code: 0, stdout: 'Container demo-api-app Started\n', stderr: '' }
    }
    if (command.includes('compose down')) {
      return { code: 0, stdout: '', stderr: '' }
    }
    if (command.includes('docker inspect')) {
      return { code: 0, stdout: 'running\n', stderr: '' }
    }
    if (command.includes('docker images')) {
      return { code: 0, stdout: '', stderr: '' }
    }
    if (command.includes('curl -fsS')) {
      return options.curlOk?.() === false
        ? { code: 7, stdout: '', stderr: 'khong tra loi' }
        : { code: 0, stdout: '', stderr: '' }
    }
    throw new Error(`Lệnh ngoài script: ${command}`)
  })

  writeFileMock = vi.fn(async () => undefined)
  const stubSsh = {
    exec: sshExec,
    uploadDir: vi.fn(async () => ({ bytes: 1_024 })),
    writeFile: writeFileMock,
    fileSize: vi.fn(async () => 10)
  } as unknown as SshManager

  events = []
  pipeline = new DeployPipeline({
    ssh: stubSsh,
    db: database,
    emit: (event) => events.push(event)
  })
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

describe('DeployPipeline', () => {
  it('deploy moi thanh cong: du 7 buoc, ghi DB, .env ghi im lang', async () => {
    createHarness()
    const { deploymentId } = pipeline.run(deployInput())
    const finished = await waitForFinished()

    expect(finished.status).toBe('running')
    expect(finished.app_url).toBe('http://203.0.113.55:30000')

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

    expect(
      actionLogRows(deploymentId).some((row) => row.action === 'deploy' && row.status === 'success')
    ).toBe(true)
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

  it('healthcheck truot khi co version dang chay -> tu rollback ve v1', async () => {
    let healthOk = true
    createHarness({ curlOk: () => healthOk })
    const first = pipeline.run(deployInput())
    expect((await waitForFinished()).status).toBe('running')

    healthOk = false
    vi.useFakeTimers()
    const eventCountBefore = events.length
    const second = pipeline.run(deployInput())
    // 10 lan thu healthcheck, moi lan cach nhau 3s
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await vi.advanceTimersByTimeAsync(3_000)
    }
    await vi.advanceTimersByTimeAsync(100)
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
  })

  it('khoa hai pipeline cung app: lan thu hai bao VALIDATION ngay lap tuc', () => {
    createHarness()
    pipeline.run(deployInput())
    expect(() => pipeline.run(deployInput())).toThrow('VALIDATION')
  })

  it('huy giua chung -> kem ghi nhan cancelled trong action_log', async () => {
    createHarness()
    const { deploymentId } = pipeline.run(deployInput())
    pipeline.cancel(deploymentId)
    const finished = await waitForFinished()

    expect(finished.status).toBe('failed')
    expect(actionLogRows(deploymentId).some((row) => row.status === 'cancelled')).toBe(true)
    expect(deploymentRow(deploymentId).status).toBe('failed')
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
