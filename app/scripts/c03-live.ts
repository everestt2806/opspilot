import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import type { DeployEvent } from '../src/shared/ipc'
import { closeDatabase, initializeDatabase } from '../src/main/db'
import { AppRepository } from '../src/main/db/appRepository'
import { DeploymentRepository } from '../src/main/db/deploymentRepository'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { DeployPipeline } from '../src/main/deploy/pipeline'
import { DeployService } from '../src/main/deploy/service'
import { SshManager, type SshConnectionInfo } from '../src/main/ssh/manager'

const host = process.env.OPSPILOT_C03_HOST ?? '221.121.1.80'
const username = process.env.OPSPILOT_C03_USER ?? 'deploy'
const keyPath = process.env.OPSPILOT_C03_KEY ?? 'C:/Users/everestt28/.ssh/opspilot_ed25519'
const keySecret = readFileSync(keyPath, 'utf8')
const runName = process.env.OPSPILOT_C03_RUN ?? 'a17-c03-0912'
const repoRoot = resolve(__dirname, '..', '..', '..')
const sourceRoot = join(repoRoot, 'demo-apps')

const config: SshConnectionInfo = {
  host,
  port: Number(process.env.OPSPILOT_C03_PORT ?? 22),
  username,
  authType: 'key',
  secret: keySecret
}

type SourceResult = {
  name: string
  appId: number
  deploymentIds: number[]
  image: string
  port: number
  framework: string
  docker: { image: string; state: string; health: string; raw: string }
  http: { status: number; body: string; raw: string }
  collector: { state: string; restartCount: number; raw: string }
  attempts: DeploymentEvidence[]
}

type DeploymentEvidence = {
  deploymentId: number
  eventIndexStart: number
  eventIndexEnd: number
  steps: string[]
  finished: Extract<DeployEvent, { type: 'finished' }>
  events: DeployEvent[]
}

function waitForFinished(
  events: DeployEvent[],
  deploymentId: number
): Promise<Extract<DeployEvent, { type: 'finished' }>> {
  return new Promise((resolveFinished, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`timeout deployment ${deploymentId}`)),
      35 * 60_000
    )
    const check = (): void => {
      const finished = events.find(
        (event) => event.type === 'finished' && event.deployment_id === deploymentId
      ) as Extract<DeployEvent, { type: 'finished' }> | undefined
      if (finished) {
        clearTimeout(deadline)
        resolveFinished(finished)
      } else setTimeout(check, 500)
    }
    check()
  })
}

async function deploy(
  pipeline: DeployPipeline,
  events: DeployEvent[],
  vpsId: number,
  appName: string,
  sourcePath: string,
  env: Record<string, string>
): Promise<{
  appId: number
  deploymentId: number
  finished: Extract<DeployEvent, { type: 'finished' }>
  evidence: DeploymentEvidence
}> {
  const eventIndexStart = events.length
  const started = pipeline.run({ vps_id: vpsId, app_name: appName, source_path: sourcePath, env })
  const finished = await waitForFinished(events, started.deploymentId)
  const deploymentEvents = events.filter((event) => event.deployment_id === started.deploymentId)
  const steps = deploymentEvents
    .filter((event) => event.type === 'step-done')
    .map((event) => event.step)
  const expectedSteps = ['PRECHECK', 'UPLOAD', 'RENDER', 'BUILD', 'DEPLOY', 'HEALTHCHECK', 'RECORD']
  if (finished.status === 'running' && JSON.stringify(steps) !== JSON.stringify(expectedSteps)) {
    throw new Error(`deployment ${started.deploymentId} emitted invalid steps: ${steps.join(',')}`)
  }
  if (finished.status !== 'running') {
    const failed = events.filter(
      (event) => event.type === 'step-failed' && event.deployment_id === started.deploymentId
    )
    console.error(
      JSON.stringify({ appName, deploymentId: started.deploymentId, finished, failed }, null, 2)
    )
    throw new Error(`${appName} deployment ${started.deploymentId}: ${finished.status}`)
  }
  const app = new AppRepository(database).getByVpsAndName(vpsId, appName)
  if (!app) throw new Error(`missing SQLite app ${appName}`)
  return {
    appId: app.id,
    deploymentId: started.deploymentId,
    finished,
    evidence: {
      deploymentId: started.deploymentId,
      eventIndexStart,
      eventIndexEnd: events.length - 1,
      steps,
      finished,
      events: deploymentEvents
    }
  }
}

async function inspect(
  ssh: SshManager,
  vpsId: number,
  appName: string,
  port: number
): Promise<{
  docker: SourceResult['docker']
  http: SourceResult['http']
  collector: SourceResult['collector']
}> {
  await new Promise((resolve) => setTimeout(resolve, 7_000))
  const appResult = await ssh.exec(
    vpsId,
    `docker inspect --format '{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${appName}-app`,
    { timeoutMs: 30_000, retryOnReconnect: true }
  )
  const httpResult = await ssh.exec(
    vpsId,
    `curl -sS -w '\n__STATUS__:%{http_code}' http://127.0.0.1:${port}/`,
    { timeoutMs: 30_000, retryOnReconnect: true }
  )
  const collectorResult = await ssh.exec(
    vpsId,
    `docker inspect --format '{{.State.Status}}|{{.RestartCount}}' ${appName}-collector`,
    { timeoutMs: 30_000, retryOnReconnect: true }
  )
  if (appResult.code !== 0 || httpResult.code !== 0 || collectorResult.code !== 0) {
    throw new Error(
      [appResult, httpResult, collectorResult].map((result) => result.stderr).join('\n')
    )
  }
  const [image = '', state = '', health = ''] = appResult.stdout.trim().split('|')
  const statusMatch = httpResult.stdout.match(/\n__STATUS__:(\d+)\s*$/)
  const body = statusMatch
    ? httpResult.stdout.slice(0, statusMatch.index).trimEnd()
    : httpResult.stdout
  const [collectorState = '', restartCount = ''] = collectorResult.stdout.trim().split('|')
  return {
    docker: { image, state, health, raw: appResult.stdout },
    http: { status: Number(statusMatch?.[1] ?? 0), body, raw: httpResult.stdout },
    collector: {
      state: collectorState,
      restartCount: Number(restartCount),
      raw: collectorResult.stdout
    }
  }
}

let database: ReturnType<typeof initializeDatabase>

async function main(): Promise<void> {
  const profileDir =
    process.env.OPSPILOT_C03_PROFILE ?? mkdtempSync(join(tmpdir(), 'opspilot-c03-profile-'))
  database = initializeDatabase(profileDir)
  const ssh = new SshManager(() => config)
  const events: DeployEvent[] = []
  const vps = new VpsRepository(database).create({
    name: 'C03-VM02',
    host,
    port: config.port,
    username,
    auth_type: 'key',
    credential: {
      crypto_scheme: 'aes_256_gcm',
      encrypted_secret: Buffer.from(keySecret),
      iv: Buffer.alloc(12, 1),
      auth_tag: Buffer.alloc(16, 2)
    }
  })
  // VM02 already owns 30000 (A17) and 30001 (app B); reserve them in the
  // temporary SQLite allocator so the real pipeline selects fresh ports.
  const appRepository = new AppRepository(database)
  const reservations: Array<[string, number]> = [
    ['reserved-a17', 30000],
    ['reserved-b', 30001],
    ['reserved-c03-attempt', 30002],
    ['reserved-c03-current', 30003],
    ['reserved-c03-redeploy', 30004],
    ['reserved-c03-next', 30005],
    ['reserved-c03-final-express', 30006],
    ['reserved-c03-final-next', 30007],
    ['reserved-c03-final-vite', 30008]
  ]
  for (const [name, port] of reservations) {
    appRepository.create({
      vps_id: vps.id,
      name,
      framework: 'express',
      source_path: sourceRoot,
      host_port: port,
      container_port: 3000,
      healthcheck_path: '/health',
      needs_db: 0
    })
  }
  const pipeline = new DeployPipeline({ ssh, db: database, emit: (event) => events.push(event) })
  const results: SourceResult[] = []
  try {
    const expressName = `${runName}-express`
    const nextName = `${runName}-next`
    const viteName = `${runName}-vite`
    const express = await deploy(
      pipeline,
      events,
      vps.id,
      expressName,
      join(sourceRoot, 'express-api'),
      { ENABLE_FAULT_ENDPOINTS: 'false' }
    )
    const expressApp = new AppRepository(database).getById(express.appId)
    const marker = `c03-marker-${Date.now()}`
    await ssh.exec(
      vps.id,
      `curl -fsS -X POST -H 'Content-Type: application/json' --data '{"name":"${marker}"}' http://127.0.0.1:${expressApp.host_port}/items`,
      { timeoutMs: 30_000, retryOnReconnect: true }
    )
    const before = await ssh.exec(
      vps.id,
      `curl -fsS 'http://127.0.0.1:${expressApp.host_port}/items?limit=10&offset=1000'`,
      { timeoutMs: 30_000, retryOnReconnect: true }
    )
    const redeploy = await deploy(
      pipeline,
      events,
      vps.id,
      expressName,
      join(sourceRoot, 'express-api'),
      { ENABLE_FAULT_ENDPOINTS: 'false' }
    )
    const after = await ssh.exec(
      vps.id,
      `curl -fsS 'http://127.0.0.1:${expressApp.host_port}/items?limit=10&offset=1000'`,
      { timeoutMs: 30_000, retryOnReconnect: true }
    )
    if (!before.stdout.includes(marker) || !after.stdout.includes(marker))
      throw new Error('PostgreSQL marker was not preserved')
    const expressState = await inspect(ssh, vps.id, expressName, expressApp.host_port)
    results.push({
      name: 'Express',
      appId: express.appId,
      deploymentIds: [express.deploymentId, redeploy.deploymentId],
      image: new DeploymentRepository(database).getById(redeploy.deploymentId).image_tag,
      port: expressApp.host_port,
      framework: expressApp.framework,
      ...expressState,
      attempts: [express.evidence, redeploy.evidence]
    })

    const next = await deploy(pipeline, events, vps.id, nextName, join(sourceRoot, 'next-blog'), {
      NEXT_PUBLIC_SITE_NAME: 'OpsPilot C03 Next'
    })
    const nextApp = new AppRepository(database).getById(next.appId)
    results.push({
      name: 'Next.js',
      appId: next.appId,
      deploymentIds: [next.deploymentId],
      image: new DeploymentRepository(database).getById(next.deploymentId).image_tag,
      port: nextApp.host_port,
      framework: nextApp.framework,
      ...(await inspect(ssh, vps.id, nextName, nextApp.host_port)),
      attempts: [next.evidence]
    })

    const vite = await deploy(pipeline, events, vps.id, viteName, join(sourceRoot, 'vite-spa'), {
      VITE_API_URL: `http://${host}:${expressApp.host_port}`
    })
    const viteApp = new AppRepository(database).getById(vite.appId)
    results.push({
      name: 'Vite SPA',
      appId: vite.appId,
      deploymentIds: [vite.deploymentId],
      image: new DeploymentRepository(database).getById(vite.deploymentId).image_tag,
      port: viteApp.host_port,
      framework: viteApp.framework,
      ...(await inspect(ssh, vps.id, viteName, viteApp.host_port)),
      attempts: [vite.evidence]
    })

    const db = new AppRepository(database)
      .listByVps(vps.id)
      .map((app) => ({ ...app, deployments: new DeploymentRepository(database).listByApp(app.id) }))
    closeDatabase()
    database = initializeDatabase(profileDir)
    const reopenedService = new DeployService({ ssh, db: database, emit: () => undefined })
    const reopened = reopenedService.listApps(vps.id).map((app) => ({
      ...app,
      deployments: new DeploymentRepository(database).listByApp(app.id)
    }))
    const output = {
      host,
      profileDir,
      sources: results,
      sqlite: { beforeClose: db, afterReopen: reopened }
    }
    const evidencePath = process.env.OPSPILOT_C03_EVIDENCE
    if (evidencePath) writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(output, null, 2))
  } finally {
    await ssh.disconnectAll()
    closeDatabase()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
