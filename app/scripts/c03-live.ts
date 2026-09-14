import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'

import type { DeployEvent } from '../src/shared/ipc'
import { createCredentialCipher } from '../src/main/crypto/masterKey'
import { loadSecret } from '../src/main/crypto/credentials'
import { closeDatabase, initializeDatabase } from '../src/main/db'
import { AppRepository } from '../src/main/db/appRepository'
import { DeploymentRepository } from '../src/main/db/deploymentRepository'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { DeployPipeline } from '../src/main/deploy/pipeline'
import { DeployService } from '../src/main/deploy/service'
import { SshManager } from '../src/main/ssh/manager'

const runName = process.env.OPSPILOT_C03_RUN ?? `c03r2-${Date.now().toString().slice(-8)}`
const repoRoot = resolve(__dirname, '..', '..', '..')
const sourceRoot = join(repoRoot, 'demo-apps')

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
  app.setAppUserModelId('vn.opspilot.desktop')
  app.setName('OpsPilot')
  await app.whenReady()
  const userDataPath = app.getPath('userData')
  database = initializeDatabase(userDataPath)
  const cipher = createCredentialCipher(userDataPath)
  const vpsRepository = new VpsRepository(database)
  const ssh = new SshManager((vpsId) => {
    const vps = vpsRepository.getById(vpsId)
    return {
      host: vps.host,
      port: vps.port,
      username: vps.username,
      authType: vps.auth_type,
      secret: loadSecret(database, cipher, vpsId)
    }
  })
  const events: DeployEvent[] = []
  const vps = vpsRepository.getById(Number(process.env.OPSPILOT_C03_VPS_ID ?? 2))
  const pipeline = new DeployPipeline({ ssh, db: database, emit: (event) => events.push(event) })
  const results: SourceResult[] = []
  try {
    if (process.env.OPSPILOT_C03_AUDIT_ONLY === '1') {
      const credential = database
        .prepare(
          'SELECT crypto_scheme, length(encrypted_secret) encrypted_secret_length, length(iv) iv_length, length(auth_tag) auth_tag_length FROM vps WHERE id=?'
        )
        .get(vps.id) as {
        crypto_scheme: string
        encrypted_secret_length: number
        iv_length: number
        auth_tag_length: number
      }
      const secret = loadSecret(database, cipher, vps.id)
      const proof = await ssh.exec(vps.id, 'docker version --format "{{.Server.Version}}"', {
        timeoutMs: 30_000,
        retryOnReconnect: true
      })
      if (proof.code !== 0) throw new Error('credential audit SSH proof failed')
      const output = {
        userDataPath,
        vps_id: vps.id,
        credential: {
          crypto_scheme: credential.crypto_scheme,
          encrypted_secret_length: credential.encrypted_secret_length,
          iv_length: credential.iv_length,
          auth_tag_length: credential.auth_tag_length,
          decryptable: secret.length > 0,
          master_key_protected: existsSync(join(userDataPath, 'credential-master-key.protected'))
        },
        resolver: { ssh_exit: proof.code, docker_server_version: proof.stdout.trim() }
      }
      const evidencePath = process.env.OPSPILOT_C03_EVIDENCE
      if (evidencePath) writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
      console.log(JSON.stringify(output, null, 2))
      return
    }
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
      VITE_API_URL: `http://${vps.host}:${expressApp.host_port}`
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
    database = initializeDatabase(userDataPath)
    const reopenedService = new DeployService({ ssh, db: database, emit: () => undefined })
    const reopened = reopenedService.listApps(vps.id).map((app) => ({
      ...app,
      deployments: new DeploymentRepository(database).listByApp(app.id)
    }))
    const resolverProof = await ssh.exec(vps.id, 'docker version --format "{{.Server.Version}}"', {
      timeoutMs: 30_000,
      retryOnReconnect: true
    })
    if (resolverProof.code !== 0) throw new Error('reopened credential resolver SSH proof failed')
    const output = {
      host: vps.host,
      userDataPath,
      sources: results,
      sqlite: { beforeClose: db, afterReopen: reopened },
      reopened_resolver: {
        vps_id: vps.id,
        ssh_exit: resolverProof.code,
        docker_server_version: resolverProof.stdout.trim()
      }
    }
    const evidencePath = process.env.OPSPILOT_C03_EVIDENCE
    if (evidencePath) writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(output, null, 2))
  } finally {
    await ssh.disconnectAll()
    closeDatabase()
    app.quit()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
