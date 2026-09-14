import { app } from 'electron'

import { loadSecret } from '../src/main/crypto/credentials'
import { createCredentialCipher } from '../src/main/crypto/masterKey'
import { closeDatabase, initializeDatabase } from '../src/main/db'
import { AppRepository } from '../src/main/db/appRepository'
import { MigrationRepository } from '../src/main/migrate/repository'
import { MigrateService } from '../src/main/migrate/service'
import { SshManager } from '../src/main/ssh/manager'
import { VpsRepository } from '../src/main/db/vpsRepository'

const TARGET_VPS_ID = 1
const SOURCE_APPS = process.env.OPSPILOT_C04_ONLY_APP_ID
  ? [Number(process.env.OPSPILOT_C04_ONLY_APP_ID)]
  : [
      Number(process.env.OPSPILOT_C04_VITE_APP_ID ?? 18),
      Number(process.env.OPSPILOT_C04_EXPRESS_APP_ID ?? 16)
    ]

async function waitForTerminal(
  database: ReturnType<typeof initializeDatabase>,
  jobId: number,
  allowAwaitingConfirm = true
): Promise<string> {
  const migrations = new MigrationRepository(database)
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const status = migrations.get(jobId).status
    if (
      (allowAwaitingConfirm && status === 'awaiting_confirm') ||
      status === 'completed' ||
      status === 'rolled_back' ||
      status === 'failed'
    )
      return status
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`migration job ${jobId} timed out`)
}

async function main(): Promise<void> {
  app.setName('OpsPilot')
  await app.whenReady()
  const userDataPath = app.getPath('userData')
  const database = initializeDatabase(userDataPath)
  const cipher = createCredentialCipher(userDataPath)
  const vps = new VpsRepository(database)
  const ssh = new SshManager((vpsId) => {
    const profile = vps.getById(vpsId)
    return {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authType: profile.auth_type,
      secret: loadSecret(database, cipher, vpsId)
    }
  })
  const events: unknown[] = []
  const service = new MigrateService(database, ssh, (event) => events.push(event))
  const apps = new AppRepository(database)
  const output: Array<Record<string, unknown>> = []
  try {
    const sourceProbe = await ssh.exec(
      2,
      "docker inspect -f '{{.Config.Image}}|{{.State.Status}}' c03r2-34290093-vite-app 2>&1; curl -m 5 -fsS -o /dev/null -w 'HTTP|%{http_code}' http://127.0.0.1:30017/ 2>&1",
      { timeoutMs: 15_000, retryOnReconnect: true }
    )
    console.log(JSON.stringify({ source_runtime_probe: sourceProbe }, null, 2))
    if (sourceProbe.code !== 0) {
      const recovery = await ssh.exec(
        2,
        "cd '/opt/opspilot/c03r2-34290093-vite' && docker compose start app",
        { timeoutMs: 60_000, retryOnReconnect: false }
      )
      const healthy = await ssh.exec(
        2,
        "curl -m 10 -fsS -o /dev/null -w 'HTTP|%{http_code}' http://127.0.0.1:30017/",
        { timeoutMs: 15_000, retryOnReconnect: true }
      )
      console.log(JSON.stringify({ source_recovery: recovery, source_health: healthy }, null, 2))
      if (recovery.code !== 0 || healthy.code !== 0 || !healthy.stdout.includes('HTTP|200')) {
        throw new Error('source Vite app could not be restored before migration')
      }
    }
    const active = database
      .prepare(
        "SELECT id FROM migration_job WHERE status IN ('preparing','backing_up','transferring','restoring','verifying','awaiting_confirm')"
      )
      .all() as Array<{ id: number }>
    for (const job of active) {
      service.abort(job.id)
      await waitForTerminal(database, job.id, false)
    }
    for (const appId of SOURCE_APPS) {
      const source = apps.getById(appId)
      const started = service.start({ app_id: source.id, target_vps_id: TARGET_VPS_ID })
      const before = {
        app_id: source.id,
        source_vps_id: source.vps_id,
        target_vps_id: TARGET_VPS_ID,
        job_id: started.job_id
      }
      const status = await waitForTerminal(database, started.job_id)
      if (status !== 'awaiting_confirm') throw new Error(`job ${started.job_id} ended ${status}`)
      await service.confirm(started.job_id, true)
      const completed = await waitForTerminal(database, started.job_id)
      output.push({ ...before, status: completed, events: events.splice(0) })
      if (completed !== 'completed')
        throw new Error(`job ${started.job_id} confirmation ended ${completed}`)
    }
    console.log(
      JSON.stringify({ userDataPath, target_vps_id: TARGET_VPS_ID, runs: output }, null, 2)
    )
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          userDataPath,
          target_vps_id: TARGET_VPS_ID,
          runs: output,
          error: error instanceof Error ? error.message : String(error),
          events
        },
        null,
        2
      )
    )
    throw error
  } finally {
    await ssh.disconnectAll()
    closeDatabase()
    app.quit()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  app.quit()
  process.exitCode = 1
})
