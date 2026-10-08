/**
 * Test end-to-end cho demo round 1 — chạy TRÊN DB THẬT (AppData/OpsPilot).
 * Vẫn dùng code path thật: DeployPipeline + MigrateService + SshManager,
 * credential giải mã qua safeStorage như app GUI.
 *
 * Chạy: pnpm exec tsc -p tsconfig.scripts.json && node scripts/prepare-cli.js
 *       ./node_modules/.bin/electron .out-scripts/scripts/e2e-demo-test.js
 *
 * Kịch bản (đúng kịch bản demo):
 *  1. Deploy express-api lên VM02 (DATABASE_URL trống → tự sinh PostgreSQL, PORT=3000,
 *     ENABLE_FAULT_ENDPOINTS=false)
 *  2. Deploy next-blog lên VM02 (NODE_ENV=production, NEXT_PUBLIC_SITE_NAME)
 *  3. Deploy vite-spa lên VM02 (VITE_API_URL = URL express vừa deploy)
 *  4. Tạo marker MARKER-DEMO-1409 trong express qua API
 *  5. Migrate vite-spa VM02 -> VM01 (stateless), xác nhận giữ nguồn
 *  6. Migrate express VM02 -> VM01 (stateful PostgreSQL), xác nhận giữ nguồn,
 *     kiểm tra marker + row count ở đích
 */
import { resolve, join } from 'node:path'

import { app } from 'electron'

import type { DeployEvent, MigrateEvent } from '../src/shared/ipc'
import { loadSecret } from '../src/main/crypto/credentials'
import { createCredentialCipher } from '../src/main/crypto/masterKey'
import { closeDatabase, initializeDatabase } from '../src/main/db'
import { AppRepository } from '../src/main/db/appRepository'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { DeployPipeline } from '../src/main/deploy/pipeline'
import { MigrateService } from '../src/main/migrate/service'
import { SshManager } from '../src/main/ssh/manager'

const SOURCE_ROOT = resolve(__dirname, '..', '..', '..', 'demo', 'sources')
const VM02_HOST = '221.121.1.80'
const VM01_HOST = '221.121.1.79'

const RESULT: Array<{ step: string; status: 'PASS' | 'FAIL'; detail: string }> = []

function record(step: string, status: 'PASS' | 'FAIL', detail = ''): boolean {
  RESULT.push({ step, status, detail })
  console.log(`[${status}] ${step}${detail ? ` — ${detail}` : ''}`)
  return status === 'PASS'
}

app.setAppUserModelId('vn.opspilot.desktop')
app.setName('OpsPilot')
const EXPECTED_USER_DATA = resolve(join(app.getPath('appData'), 'OpsPilot'))
app.setPath('userData', EXPECTED_USER_DATA)

function printDeployEvent(event: DeployEvent): void {
  if (event.type === 'step-start') console.log(`  ── ${event.step}`)
  else if (event.type === 'step-done')
    console.log(`  ── xong ${event.step} (${(event.duration_ms / 1000).toFixed(1)}s)`)
  else if (event.type === 'step-failed') {
    console.log(`  ── LỖI ${event.step}: ${event.error.message}`)
    for (const line of event.last_log_lines.slice(-10)) console.log(`     [log] ${line}`)
  } else if (event.type === 'finished')
    console.log(
      `  ==> ${event.status}${event.app_url ? ` — ${event.app_url}` : ''} (${(
        event.total_duration_ms / 1000
      ).toFixed(1)}s)`
    )
}

function printMigrateEvent(event: MigrateEvent): void {
  if (event.type === 'log')
    for (const line of event.chunk.replace(/\n$/, '').split('\n'))
      console.log(`  [${event.step}] ${line}`)
  else if (event.type === 'step-start') console.log(`  ── ${event.step}`)
  else if (event.type === 'awaiting-confirm')
    console.log(`  ── chờ xác nhận (downtime ${event.downtime_ms}ms)`)
  else if (event.type === 'finished')
    console.log(
      `  ==> migrate ${event.status} (downtime ${event.downtime_ms}ms)${event.error ? ` — ${event.error}` : ''}`
    )
}

async function waitFor<T>(
  condition: () => T | undefined,
  timeoutMs: number,
  what: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = condition()
    if (value !== undefined) return value
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Timeout ${timeoutMs / 1000}s chờ ${what}`)
}

async function main(): Promise<void> {
  const userDataPath = resolve(app.getPath('userData'))
  if (userDataPath !== EXPECTED_USER_DATA) throw new Error(`Sai userData: ${userDataPath}`)
  const database = initializeDatabase(userDataPath)
  const cipher = createCredentialCipher(userDataPath)
  const vpsRepository = new VpsRepository(database)
  const appRepository = new AppRepository(database)

  const vm01 = vpsRepository.list().find((v) => v.host === VM01_HOST)
  const vm02 = vpsRepository.list().find((v) => v.host === VM02_HOST)
  if (!vm01 || !vm02) throw new Error(`Cần VM01 (${VM01_HOST}) và VM02 (${VM02_HOST}) trong DB`)

  const ssh = new SshManager((vpsId) => {
    const vps = vpsRepository.getById(vpsId)
    return {
      host: vps.host,
      port: vps.port,
      hostFingerprint: vps.host_fingerprint ?? null,
      username: vps.username,
      authType: vps.auth_type,
      secret: loadSecret(database, cipher, vpsId)
    }
  })

  const deployEvents: DeployEvent[] = []
  const pipeline = new DeployPipeline({
    ssh,
    db: database,
    emit: (event) => {
      deployEvents.push(event)
      printDeployEvent(event)
    }
  })

  try {
    // ── 1. Deploy express-api lên VM02 ──────────────────────────────────────────
    console.log('\n===== 1/6 DEPLOY express-api -> VM02 =====')
    const d1 = pipeline.run({
      vps_id: vm02.id,
      app_name: 'demo1409-express',
      source_path: join(SOURCE_ROOT, 'express-api'),
      env: { PORT: '3000', ENABLE_FAULT_ENDPOINTS: 'false' }
    })
    const f1 = await waitFor(
      () =>
        deployEvents.find((e) => e.type === 'finished' && e.deployment_id === d1.deploymentId) as
          Extract<DeployEvent, { type: 'finished' }> | undefined,
      30 * 60_000,
      'deploy express xong'
    )
    if (!record('1 deploy express -> VM02', f1.status === 'running' ? 'PASS' : 'FAIL', f1.status)) {
      return
    }
    const expressApp = appRepository.getByVpsAndName(vm02.id, 'demo1409-express')
    if (!expressApp) {
      record('1b app record', 'FAIL', 'không tìm thấy app trong DB')
      return
    }
    record('1b app record', 'PASS', `port ${expressApp.host_port} url ${expressApp.url}`)

    // ── 2. Deploy next-blog lên VM02 ────────────────────────────────────────────
    console.log('\n===== 2/6 DEPLOY next-blog -> VM02 =====')
    const d2 = pipeline.run({
      vps_id: vm02.id,
      app_name: 'demo1409-next',
      source_path: join(SOURCE_ROOT, 'next-blog'),
      env: { NODE_ENV: 'production', NEXT_PUBLIC_SITE_NAME: 'OpsPilot Demo 14-09' }
    })
    const f2 = await waitFor(
      () =>
        deployEvents.find((e) => e.type === 'finished' && e.deployment_id === d2.deploymentId) as
          Extract<DeployEvent, { type: 'finished' }> | undefined,
      30 * 60_000,
      'deploy next xong'
    )
    if (!record('2 deploy next -> VM02', f2.status === 'running' ? 'PASS' : 'FAIL', f2.status)) {
      return
    }

    // ── 3. Deploy vite-spa lên VM02 (VITE_API_URL = URL express) ────────────────
    console.log('\n===== 3/6 DEPLOY vite-spa -> VM02 =====')
    const expressUrl = (
      appRepository.getByVpsAndName(vm02.id, 'demo1409-express') as { url: string }
    ).url
    console.log(`  VITE_API_URL=${expressUrl}`)
    const d3 = pipeline.run({
      vps_id: vm02.id,
      app_name: 'demo1409-vite',
      source_path: join(SOURCE_ROOT, 'vite-spa'),
      env: { VITE_API_URL: expressUrl }
    })
    const f3 = await waitFor(
      () =>
        deployEvents.find((e) => e.type === 'finished' && e.deployment_id === d3.deploymentId) as
          Extract<DeployEvent, { type: 'finished' }> | undefined,
      30 * 60_000,
      'deploy vite xong'
    )
    if (!record('3 deploy vite -> VM02', f3.status === 'running' ? 'PASS' : 'FAIL', f3.status)) {
      return
    }

    // ── 4. Healthcheck từ ngoài + tạo marker ────────────────────────────────────
    console.log('\n===== 4/6 HEALTHCHECK + MARKER =====')
    for (const [name, path] of [
      ['express /health', '/health'],
      ['vite /', '/']
    ] as const) {
      const url = `${expressApp.url.replace(/\/$/, '')}${path === '/' ? '' : path}`
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        record(`4 healthcheck ${name}`, response.ok ? 'PASS' : 'FAIL', `HTTP ${response.status}`)
      } catch (e) {
        record(`4 healthcheck ${name}`, 'FAIL', String((e as Error).message))
      }
    }
    const nextApp = appRepository.getByVpsAndName(vm02.id, 'demo1409-next')
    if (nextApp) {
      try {
        const response = await fetch(nextApp.url, { signal: AbortSignal.timeout(15_000) })
        const text = await response.text()
        record(
          '4 healthcheck next / (site name)',
          response.ok && text.includes('OpsPilot Demo 14-09') ? 'PASS' : 'FAIL',
          `HTTP ${response.status}`
        )
      } catch (e) {
        record('4 healthcheck next / (site name)', 'FAIL', String((e as Error).message))
      }
    }
    try {
      const createMarker = await fetch(`${expressApp.url}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'MARKER-DEMO-1409' }),
        signal: AbortSignal.timeout(15_000)
      })
      record(
        '4 tạo MARKER-DEMO-1409',
        createMarker.status === 201 ? 'PASS' : 'FAIL',
        `HTTP ${createMarker.status}`
      )
    } catch (e) {
      record('4 tạo MARKER-DEMO-1409', 'FAIL', String((e as Error).message))
    }

    // ── 5. Migrate vite-spa VM02 -> VM01 (stateless) ────────────────────────────
    console.log('\n===== 5/6 MIGRATE vite-spa: VM02 -> VM01 =====')
    const viteApp = appRepository.getByVpsAndName(vm02.id, 'demo1409-vite')
    if (!viteApp) {
      record('5 migrate vite', 'FAIL', 'không tìm thấy app vite')
      return
    }

    const migrateEvents: MigrateEvent[] = []
    const migrate = new MigrateService(database, ssh, (event) => {
      migrateEvents.push(event)
      printMigrateEvent(event)
    })
    const { job_id: viteJobId } = migrate.start({ app_id: viteApp.id, target_vps_id: vm01.id })
    await waitFor(
      () =>
        migrateEvents.find((e) => e.type === 'awaiting-confirm' && e.job_id === viteJobId) as
          MigrateEvent | undefined,
      30 * 60_000,
      'migrate vite xong'
    )
    const viteJob = migrate.list().find((j) => j.id === viteJobId)
    if (!viteJob) {
      return
    }
    if (viteJob.status !== 'awaiting_confirm') {
      record('5 migrate vite', 'FAIL', `status=${viteJob.status} err=${viteJob.error_message}`)
      return
    }
    const viteVerify = JSON.parse(viteJob.verify_json || '{}') as { ok?: boolean }
    record('5 migrate vite tới AWAITING_CONFIRM', 'PASS', `verify ok=${viteVerify.ok}`)
    await migrate.confirm(viteJobId, true)
    const viteDone = await waitFor(
      () => {
        const job = migrate.list().find((j) => j.id === viteJobId)
        return job && (job.status === 'completed' || job.status === 'failed') ? job : undefined
      },
      10 * 60_000,
      'confirm vite'
    )
    record(
      '5 migrate vite completed (giữ nguồn)',
      viteDone.status === 'completed' ? 'PASS' : 'FAIL',
      `status=${viteDone.status}`
    )

    // ── 6. Migrate express VM02 -> VM01 (stateful) ──────────────────────────────
    console.log('\n===== 6/6 MIGRATE express+postgres: VM02 -> VM01 =====')
    const { job_id: expressJobId } = migrate.start({
      app_id: expressApp.id,
      target_vps_id: vm01.id
    })
    await waitFor(
      () =>
        migrateEvents.find((e) => e.type === 'awaiting-confirm' && e.job_id === expressJobId) as
          MigrateEvent | undefined,
      30 * 60_000,
      'migrate express xong'
    )
    const expressJob = migrate.list().find((j) => j.id === expressJobId)
    if (!expressJob) {
      return
    }
    if (expressJob.status !== 'awaiting_confirm') {
      record(
        '6 migrate express',
        'FAIL',
        `status=${expressJob.status} err=${expressJob.error_message}`
      )
      return
    }
    const expressVerify = JSON.parse(expressJob.verify_json || '{}') as {
      ok?: boolean
      marker?: { source: boolean; target: boolean }
      table_counts?: Array<{ table: string; source: number; target: number; ok: boolean }>
    }
    record(
      '6 migrate express tới AWAITING_CONFIRM',
      expressVerify.ok ? 'PASS' : 'FAIL',
      `verify ok=${expressVerify.ok} marker=${JSON.stringify(expressVerify.marker)}`
    )
    await migrate.confirm(expressJobId, true)
    const expressDone = await waitFor(
      () => {
        const job = migrate.list().find((j) => j.id === expressJobId)
        return job && (job.status === 'completed' || job.status === 'failed') ? job : undefined
      },
      10 * 60_000,
      'confirm express'
    )
    record(
      '6 migrate express completed (giữ nguồn)',
      expressDone.status === 'completed' ? 'PASS' : 'FAIL',
      `status=${expressDone.status}`
    )

    // Kiểm tra sau migrate: marker còn ở đích + app đích healthy
    const expressOnVm01 = appRepository
      .listByVps(vm01.id)
      .find((a) => a.name === 'demo1409-express')
    if (expressOnVm01) {
      try {
        const items = (await fetch(`${expressOnVm01.url}/items?limit=1000`, {
          signal: AbortSignal.timeout(15_000)
        }).then((r) => r.json())) as Array<{ name: string }>
        record(
          '6b MARKER-DEMO-1409 ở đích VM01',
          items.some((item) => item.name === 'MARKER-DEMO-1409') ? 'PASS' : 'FAIL',
          `${items.length} bản ghi đọc được từ ${expressOnVm01.url}`
        )
      } catch (e) {
        record('6b MARKER-DEMO-1409 ở đích VM01', 'FAIL', String((e as Error).message))
      }
    }
  } finally {
    await ssh.disconnectAll()
    closeDatabase()
  }
}

void app
  .whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error('E2E FAIL:', error instanceof Error ? (error.stack ?? error.message) : error)
    app.exit(1)
  })
  .finally(() => {
    const failed = RESULT.filter((r) => r.status === 'FAIL')
    console.log(`\n===== KẾT QUẢ: ${RESULT.length - failed.length}/${RESULT.length} PASS =====`)
    for (const r of RESULT) console.log(`  [${r.status}] ${r.step} — ${r.detail}`)
    process.exit(failed.length > 0 ? 1 : 0)
  })
