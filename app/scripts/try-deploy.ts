/**
 * Thử nghiệm pipeline M4 độc lập (deploy thật) — `pnpm try:deploy`.
 * Đọc cấu hình từ biến môi trường, không hardcode:
 *   OPSPILOT_DEPLOY_HOST / PORT / USER / SECRET (password bản rõ, chỉ cho CLI thử)
 *   OPSPILOT_DEPLOY_SOURCE (mặc định ../demo-apps/express-api)
 *   OPSPILOT_DEPLOY_APP (tên app, mặc định express-api)
 * Mặc định trỏ localhost nên chạy thiếu env sẽ thất bại nhanh và rõ.
 *
 * Kịch bản: deploy v1 (app mới) -> healthcheck từ ngoài -> deploy v2 (cùng port)
 * -> kiểm tra version/current_deployment. Dừng khi gặp bước FAIL đầu tiên.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DeployEvent } from '../src/shared/ipc'
import { initializeDatabase, closeDatabase } from '../src/main/db'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { AppRepository } from '../src/main/db/appRepository'
import { DeploymentRepository } from '../src/main/db/deploymentRepository'
import { DeployPipeline } from '../src/main/deploy/pipeline'
import type { SshConnectionInfo } from '../src/main/ssh/manager'
import { SshManager } from '../src/main/ssh/manager'

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

function deployConfig(): SshConnectionInfo {
  return {
    host: env('OPSPILOT_DEPLOY_HOST', '127.0.0.1'),
    port: Number.parseInt(env('OPSPILOT_DEPLOY_PORT', '22'), 10),
    username: env('OPSPILOT_DEPLOY_USER', 'root'),
    authType: 'password',
    secret: env('OPSPILOT_DEPLOY_SECRET', '')
  }
}

const RESULT: Record<string, 'PASS' | 'FAIL' | 'SKIP'> = {}

function record(step: string, status: 'PASS' | 'FAIL' | 'SKIP', detail = ''): boolean {
  RESULT[step] = status
  console.log(`[${status}] ${step}${detail ? ` — ${detail}` : ''}`)
  return status === 'PASS'
}

function printEvent(event: DeployEvent): void {
  switch (event.type) {
    case 'step-start':
      console.log(`\n── Bắt đầu bước ${event.step}`)
      break
    case 'log': {
      const lines = event.chunk.replace(/\n$/, '').split('\n')
      for (const line of lines) {
        console.log(`   ${event.stream === 'stderr' ? '[err] ' : ''}${line}`)
      }
      break
    }
    case 'step-done':
      console.log(`── Xong bước ${event.step} (${(event.duration_ms / 1000).toFixed(1)} s)`)
      break
    case 'step-failed':
      console.log(
        `── LỖI bước ${event.step}: ${event.error.message}` +
          (event.error.technical ? `\n   Chi tiết: ${event.error.technical}` : '')
      )
      for (const line of event.last_log_lines.slice(-20)) {
        console.log(`   [log] ${line}`)
      }
      console.log(`   (xem đủ log: ~/.opspilot/logs/deploy-${event.deployment_id}.log)`)
      break
    case 'finished':
      console.log(
        `\n==> finished: ${event.status}${event.app_url ? ` — ${event.app_url}` : ''} (tổng ${(
          event.total_duration_ms / 1000
        ).toFixed(1)} s)`
      )
      break
  }
}

function finishedEventFor(
  events: DeployEvent[],
  deploymentId: number
): Extract<DeployEvent, { type: 'finished' }> | undefined {
  return events.find(
    (event) => event.type === 'finished' && event.deployment_id === deploymentId
  ) as Extract<DeployEvent, { type: 'finished' }> | undefined
}

async function waitForFinished(
  events: DeployEvent[],
  deploymentId: number,
  timeoutMs: number
): Promise<Extract<DeployEvent, { type: 'finished' }>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const finished = finishedEventFor(events, deploymentId)
    if (finished) {
      return finished
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `Không nhận được finished cho deployment ${deploymentId} trong ${timeoutMs / 1000} s`
  )
}

async function healthcheckFromOutside(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    return response.ok
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const dbDir = mkdtempSync(join(tmpdir(), 'opspilot-try-deploy-'))
  const database = initializeDatabase(dbDir)
  const config = deployConfig()

  const vpsRepository = new VpsRepository(database)
  const appRepository = new AppRepository(database)
  const deploymentRepository = new DeploymentRepository(database)

  const vps = vpsRepository.create({
    name: 'CLI-thu-nghiem',
    host: config.host,
    port: config.port,
    username: config.username,
    auth_type: 'password',
    credential: {
      crypto_scheme: 'aes_256_gcm',
      encrypted_secret: Buffer.from('cli-thu-nghiem-khong-dung'),
      iv: Buffer.alloc(12, 1),
      auth_tag: Buffer.alloc(16, 2)
    }
  })

  const ssh = new SshManager(() => config)
  const events: DeployEvent[] = []
  let activeDeploymentId: number | null = null

  const pipeline = new DeployPipeline({
    ssh,
    db: database,
    emit: (event) => {
      events.push(event)
      printEvent(event)
    }
  })

  process.on('SIGINT', () => {
    console.log('\n[WARN] Nhan Ctrl+C — huy deployment dang chay...')
    if (activeDeploymentId !== null) {
      pipeline.cancel(activeDeploymentId)
    }
  })

  try {
    // ── Deploy v1: app mới ────────────────────────────────────────────────────
    const source = env(
      'OPSPILOT_DEPLOY_SOURCE',
      join(__dirname, '..', '..', '..', 'demo-apps', 'express-api')
    )
    const appName = env('OPSPILOT_DEPLOY_APP', 'express-api')
    console.log(`Deploy source: ${source}\nApp: ${appName} -> ${config.host}:${config.port}`)

    const first = pipeline.run({ vps_id: vps.id, app_name: appName, source_path: source, env: {} })
    activeDeploymentId = first.deploymentId
    const firstFinished = await waitForFinished(events, first.deploymentId, 30 * 60_000)
    record(
      '1 deploy v1 (app moi)',
      firstFinished.status === 'running' ? 'PASS' : 'FAIL',
      firstFinished.status
    )
    if (firstFinished.status !== 'running') {
      return
    }
    activeDeploymentId = null

    // ── Healthcheck từ ngoài ───────────────────────────────────────────────────
    const app = appRepository.getByVpsAndName(vps.id, appName)
    if (!app) {
      record('2 healthcheck tu ngoai', 'FAIL', 'khong tim thay app trong DB')
      return
    }
    const outsideOk = await healthcheckFromOutside(app.url)
    if (
      !record(
        '2 healthcheck tu ngoai',
        outsideOk ? 'PASS' : 'FAIL',
        `${app.url} (port ${app.host_port})`
      )
    ) {
      return
    }
    const healthBody = await fetch(`${app.url}/health`).then((response) => response.text())
    console.log(`   /health tra ve: ${healthBody.slice(0, 200)}`)

    // ── Deploy v2: cùng source, cùng app ───────────────────────────────────────
    const second = pipeline.run({ vps_id: vps.id, app_name: appName, source_path: source, env: {} })
    activeDeploymentId = second.deploymentId
    const secondFinished = await waitForFinished(events, second.deploymentId, 30 * 60_000)
    record(
      '3 deploy v2 (cung port)',
      secondFinished.status === 'running' ? 'PASS' : 'FAIL',
      secondFinished.status
    )
    if (secondFinished.status !== 'running') {
      return
    }
    activeDeploymentId = null

    // ── Kiểm tra DB ────────────────────────────────────────────────────────────
    const versions = deploymentRepository.listByApp(app.id)
    const current = appRepository.getById(app.id)
    const dbOk =
      versions.length === 2 &&
      versions[0].version === 2 &&
      current.current_deployment_id === second.deploymentId &&
      current.host_port === app.host_port
    record(
      '4 DB version/current',
      dbOk ? 'PASS' : 'FAIL',
      `versions=${versions.map((item) => item.version).join(',')}, current=${current.current_deployment_id}, port=${current.host_port}`
    )
    if (!dbOk) {
      return
    }

    console.log('\nDeploy demo xong. App dang chay tai:', current.url)
  } finally {
    activeDeploymentId = null
    await ssh.disconnectAll()
    closeDatabase()
    rmSync(dbDir, { recursive: true, force: true })
  }
}

main()
  .catch((error) => {
    console.error('\nTRY-DEPLOY CHẠY THẤT BẠI:', error)
    process.exitCode = 1
  })
  .finally(() => {
    const failed = Object.values(RESULT).filter((status) => status === 'FAIL')
    const total = Object.keys(RESULT).length
    console.log(`\nKết quả: ${total - failed.length}/${total} bước không lỗi`)
    if (failed.length > 0) {
      process.exitCode = 1
    }
    process.exit()
  })
