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
  curlOk?: (call: number) => boolean
  composeUp?: (call: number) => { code: number; stdout: string; stderr: string }
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
}

let testDirectory: string | null = null
let sourceDirectory: string | null = null
let vpsId = 0
let database: ReturnType<typeof initializeDatabase>
let sshExec: Mock
let writeFileMock: Mock
let readFileMock: Mock
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

  let composeUpCall = 0
  let inspectCall = 0
  let curlCall = 0
  let imagesCall = 0
  let imageRemoveCall = 0
  sshExec = vi.fn(async (_vpsId: number, command: string) => {
    if (command.includes('free -m')) {
      return { code: 0, stdout: options.precheckOutput ?? PRECHECK_OK, stderr: '' }
    }
    if (command.includes('docker build')) {
      return { code: 0, stdout: 'build xong\n', stderr: '' }
    }
    if (command.includes('compose up -d')) {
      composeUpCall += 1
      if (options.composeUp) {
        return options.composeUp(composeUpCall)
      }
      return { code: 0, stdout: 'Container demo-api-app Started\n', stderr: '' }
    }
    if (command.includes('compose down')) {
      return { code: 0, stdout: '', stderr: '' }
    }
    if (command.includes('docker inspect')) {
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

  writeFileMock = vi.fn(async () => undefined)
  readFileMock = vi.fn(async (_vpsId: number, remotePath: string) => {
    const previous = [...writeFileMock.mock.calls].reverse().find(([, path]) => path === remotePath)
    return previous?.[2] ?? ''
  })
  const stubSsh = {
    exec: sshExec,
    uploadDir: vi.fn(async () => ({ bytes: 1_024 })),
    readFile: readFileMock,
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

    const envWrites = writeFileCalls().filter((call) => call.remotePath.endsWith('.env'))
    expect(envWrites).toHaveLength(2)
    const firstPassword = envWrites[0].content.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1]
    const secondPassword = envWrites[1].content.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1]
    expect(firstPassword).toMatch(/^[0-9a-f]{24}$/)
    expect(secondPassword).toBe(firstPassword)
    expect(envWrites[1].content).toContain(
      `DATABASE_URL=postgresql://opspilot:${firstPassword}@postgres:5432/opspilot`
    )
    expect(readFileMock).toHaveBeenCalledWith(vpsId, '/opt/opspilot/demo-api/.env')
    expect(JSON.stringify(events)).not.toContain(firstPassword)
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

    const next = pipeline.run(deployInput())
    expect((await waitForFinished(next.deploymentId)).status).toBe('running')
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
})

function fakeCredential(value: string): EncryptedCredential {
  return {
    crypto_scheme: 'aes_256_gcm',
    encrypted_secret: Buffer.from(value),
    iv: Buffer.alloc(12, 1),
    auth_tag: Buffer.alloc(16, 2)
  }
}
