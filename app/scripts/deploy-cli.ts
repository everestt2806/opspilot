import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import Database from 'better-sqlite3'

import { createCredentialCipher } from '../src/main/crypto/masterKey'
import { loadSecret } from '../src/main/crypto/credentials'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { DeployPipeline } from '../src/main/deploy/pipeline'
import { SshManager } from '../src/main/ssh/manager'
import {
  sanitizeObject,
  sanitizeText,
  serializeCliEvent
} from '../src/main/deploy/eventSerializer'
import type { DeployEvent, DeployInput } from '../src/shared/ipc'

export { sanitizeObject, sanitizeText, serializeCliEvent }

interface CliArgs {
  dbPath?: string
  vpsId?: number
  appName?: string
  sourcePath?: string
  appId?: number
  hostPort?: number
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--db' && i + 1 < args.length) {
      result.dbPath = args[++i]
    } else if (arg === '--vps-id' && i + 1 < args.length) {
      result.vpsId = Number.parseInt(args[++i], 10)
    } else if (arg === '--app-name' && i + 1 < args.length) {
      result.appName = args[++i]
    } else if (arg === '--source-path' && i + 1 < args.length) {
      result.sourcePath = args[++i]
    } else if (arg === '--app-id' && i + 1 < args.length) {
      result.appId = Number.parseInt(args[++i], 10)
    } else if (arg === '--host-port' && i + 1 < args.length) {
      result.hostPort = Number.parseInt(args[++i], 10)
    }
  }
  return result
}

async function main(): Promise<void> {
  const secrets: string[] = []
  if (process.env.OPSPILOT_SSH_SECRET?.trim()) {
    secrets.push(process.env.OPSPILOT_SSH_SECRET)
  }
  if (process.env.OPSPILOT_DEPLOY_SECRET?.trim()) {
    secrets.push(process.env.OPSPILOT_DEPLOY_SECRET)
  }

  function emitError(message: string): never {
    console.log(serializeCliEvent({ event: 'error', error: message }, secrets))
    process.exit(1)
  }

  const cliArgs = parseArgs(process.argv.slice(2))

  const dbPath = cliArgs.dbPath ?? process.env.OPSPILOT_DB_PATH
  if (!dbPath) {
    emitError('Thiếu đường dẫn SQLite DB (--db hoặc biến môi trường OPSPILOT_DB_PATH).')
  }

  const resolvedDbPath = resolve(dbPath)
  if (!existsSync(resolvedDbPath)) {
    emitError(`File SQLite DB không tồn tại: ${resolvedDbPath}`)
  }

  if (!cliArgs.vpsId || Number.isNaN(cliArgs.vpsId) || cliArgs.vpsId <= 0) {
    emitError('Tham số --vps-id phải là số nguyên dương.')
  }

  if (!cliArgs.appName || !cliArgs.appName.trim()) {
    emitError('Thiếu tên app (--app-name).')
  }

  if (!cliArgs.sourcePath) {
    emitError('Thiếu đường dẫn source app (--source-path).')
  }

  const resolvedSourcePath = resolve(cliArgs.sourcePath)
  if (!existsSync(resolvedSourcePath)) {
    emitError(`Thư mục source app không tồn tại: ${resolvedSourcePath}`)
  }

  // Nhận env_vars qua biến môi trường OPSPILOT_APP_ENV_JSON, không qua command line
  let appEnv: Record<string, string> = {}
  const rawEnvJson = process.env.OPSPILOT_APP_ENV_JSON
  if (rawEnvJson) {
    try {
      appEnv = JSON.parse(rawEnvJson) as Record<string, string>
      for (const v of Object.values(appEnv)) {
        if (typeof v === 'string' && v.trim().length > 0 && !secrets.includes(v)) {
          secrets.push(v)
        }
      }
    } catch {
      emitError('Biến môi trường OPSPILOT_APP_ENV_JSON không phải là chuỗi JSON hợp lệ.')
    }
  }

  let database: Database.Database
  try {
    database = new Database(resolvedDbPath)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    emitError(`Không thể mở SQLite DB: ${msg}`)
  }

  const vpsRepository = new VpsRepository(database)
  try {
    vpsRepository.getById(cliArgs.vpsId)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      database.close()
    } catch {}
    emitError(`Không tìm thấy VPS id=${cliArgs.vpsId} trong DB: ${msg}`)
  }

  // Xác thực bắt buộc SSH credential: không âm thầm dùng chuỗi rỗng
  let resolvedSecret = process.env.OPSPILOT_SSH_SECRET ?? process.env.OPSPILOT_DEPLOY_SECRET
  if (!resolvedSecret) {
    const userDataPath = process.env.OPSPILOT_USER_DATA_DIR ?? dirname(resolvedDbPath)
    try {
      const cipher = createCredentialCipher(userDataPath)
      resolvedSecret = loadSecret(database, cipher, cliArgs.vpsId)
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : String(cause)
      try {
        database.close()
      } catch {}
      emitError(
        `Không lấy được SSH credential cho VPS id=${cliArgs.vpsId}: ${msg}. ` +
          'Hãy cung cấp biến môi trường OPSPILOT_SSH_SECRET hoặc cấu hình credential hợp lệ.'
      )
    }
  }

  if (!resolvedSecret || !resolvedSecret.trim()) {
    try {
      database.close()
    } catch {}
    emitError(
      `SSH credential cho VPS id=${cliArgs.vpsId} bị rỗng. ` +
        'Hãy cung cấp biến môi trường OPSPILOT_SSH_SECRET hoặc cấu hình credential hợp lệ.'
    )
  }

  if (!secrets.includes(resolvedSecret)) {
    secrets.push(resolvedSecret)
  }

  const ssh = new SshManager((targetVpsId) => {
    const targetVps = vpsRepository.getById(targetVpsId)
    let secret = process.env.OPSPILOT_SSH_SECRET ?? process.env.OPSPILOT_DEPLOY_SECRET
    if (!secret) {
      if (targetVpsId === cliArgs.vpsId && resolvedSecret) {
        secret = resolvedSecret
      } else {
        const userDataPath = process.env.OPSPILOT_USER_DATA_DIR ?? dirname(resolvedDbPath)
        const cipher = createCredentialCipher(userDataPath)
        secret = loadSecret(database, cipher, targetVpsId)
      }
    }
    if (!secret || !secret.trim()) {
      throw new Error(`SSH credential cho VPS id=${targetVpsId} bị rỗng hoặc không hợp lệ.`)
    }
    return {
      host: targetVps.host,
      port: targetVps.port,
      username: targetVps.username,
      authType: targetVps.auth_type,
      secret
    }
  })

  let activeDeploymentId: number | null = null
  let finishedResolver!: (event: Extract<DeployEvent, { type: 'finished' }>) => void
  const finishedPromise = new Promise<Extract<DeployEvent, { type: 'finished' }>>((resolve) => {
    finishedResolver = resolve
  })

  const pipeline = new DeployPipeline({
    ssh,
    db: database,
    emit: (event: DeployEvent) => {
      switch (event.type) {
        case 'step-start':
          console.log(
            serializeCliEvent(
              {
                event: 'step_start',
                step: event.step,
                deployment_id: event.deployment_id
              },
              secrets
            )
          )
          break
        case 'step-done':
          console.log(
            serializeCliEvent(
              {
                event: 'step_done',
                step: event.step,
                deployment_id: event.deployment_id,
                duration_ms: event.duration_ms
              },
              secrets
            )
          )
          break
        case 'step-failed':
          console.log(
            serializeCliEvent(
              {
                event: 'step_failed',
                step: event.step,
                deployment_id: event.deployment_id,
                error: event.error.message,
                technical: event.error.technical
              },
              secrets
            )
          )
          break
        case 'finished':
          console.log(
            serializeCliEvent(
              {
                event: 'finished',
                deployment_id: event.deployment_id,
                status: event.status,
                app_url: event.app_url,
                total_duration_ms: event.total_duration_ms
              },
              secrets
            )
          )
          finishedResolver(event)
          break
      }
    }
  })

  process.on('SIGINT', () => {
    if (activeDeploymentId !== null) {
      try {
        pipeline.cancel(activeDeploymentId)
      } catch {}
    }
    try {
      database.close()
    } catch {}
    process.exit(130)
  })

  const deployInput: DeployInput = {
    vps_id: cliArgs.vpsId,
    app_name: cliArgs.appName,
    source_path: resolvedSourcePath,
    env: appEnv,
    app_id: cliArgs.appId,
    host_port: cliArgs.hostPort
  }

  let runResult: { deploymentId: number }
  try {
    runResult = pipeline.run(deployInput)
    activeDeploymentId = runResult.deploymentId
    console.log(
      serializeCliEvent(
        {
          event: 'assigned',
          deployment_id: runResult.deploymentId
        },
        secrets
      )
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.log(
      serializeCliEvent(
        {
          event: 'error',
          error: message
        },
        secrets
      )
    )
    try {
      database.close()
    } catch {}
    process.exit(1)
  }

  const finished = await finishedPromise
  try {
    database.close()
  } catch {}

  if (finished.status !== 'running') {
    process.exit(1)
  }
  process.exit(0)
}

if (typeof require !== 'undefined' && require.main === module) {
  void main()
}
