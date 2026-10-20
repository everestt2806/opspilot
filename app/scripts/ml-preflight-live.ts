import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import Database from 'better-sqlite3'
import { app } from 'electron'
import { electronApp } from '@electron-toolkit/utils'

import { loadExistingCredentialCipher } from '../src/main/crypto/masterKey'
import { loadSecret } from '../src/main/crypto/credentials'
import {
  prepareIsolatedMlService,
  removeIsolatedMlService,
  runSecretHandoff
} from '../src/main/crypto/credentialHandoff'

const MAX_OUTPUT_BYTES = 1024 * 1024
const PROCESS_TIMEOUT_MS = 180_000
let phase = 'arguments'

function parseArgs(argv: string[]): {
  profile: string
  vpsId: number
  appId: number
  mlUrl: string
  report: string
} {
  const values = new Map<string, string>()
  const appArgs = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < appArgs.length; index += 2) {
    const name = appArgs[index]
    const value = appArgs[index + 1]
    if (!name?.startsWith('--') || !value || values.has(name))
      throw new Error('Invalid CLI arguments')
    values.set(name, value)
  }
  const profile = values.get('--profile')
  const vpsId = Number(values.get('--vps-id'))
  const appId = Number(values.get('--app-id'))
  const mlUrl = values.get('--ml-url')
  const report = values.get('--report')
  if (
    !profile ||
    !Number.isSafeInteger(vpsId) ||
    vpsId <= 0 ||
    !Number.isSafeInteger(appId) ||
    appId <= 0 ||
    !mlUrl ||
    !report
  ) {
    throw new Error('Explicit profile, IDs, ML endpoint, and report path are required')
  }
  const endpoint = new URL(mlUrl)
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error('ML endpoint must be an explicit loopback HTTP URL')
  }
  return { profile: resolve(profile), vpsId, appId, mlUrl, report: resolve(report) }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  phase = 'profile'
  const tempRoot = realpathSync(tmpdir())
  const profileReal = realpathSync(args.profile)
  const relative = profileReal.slice(tempRoot.length)
  if (!relative.startsWith('\\') || relative.includes('..')) {
    throw new Error('Selected profile must be an isolated clone beneath the system temp directory')
  }
  const dbPath = join(profileReal, 'opspilot.db')
  const keyPath = join(profileReal, 'credential-master-key.protected')
  if (!existsSync(dbPath) || !existsSync(keyPath))
    throw new Error('Selected profile DB or existing master key is missing')

  app.setPath('userData', profileReal)
  app.setName('OpsPilot')
  phase = 'electron_ready'
  await app.whenReady()
  electronApp.setAppUserModelId('vn.opspilot.desktop')

  const database = new Database(dbPath, { readonly: true, fileMustExist: true })
  let secret: string | null = null
  let scratchDirectory: string | null = null
  let exitCode = 3
  try {
    phase = 'readonly_database'
    database.pragma('query_only = ON')
    if (database.pragma('query_only', { simple: true }) !== 1)
      throw new Error('SQLite read-only mode unavailable')
    const selected = database
      .prepare(
        `
      SELECT v.id, a.id AS app_id, d.id AS deployment_id
        FROM vps v
        JOIN app a ON a.vps_id = v.id
        JOIN deployment d ON d.id = a.current_deployment_id AND d.app_id = a.id
       WHERE v.id = ? AND v.archived_at IS NULL AND a.id = ?
    `
      )
      .get(args.vpsId, args.appId) as
      { id: number; app_id: number; deployment_id: number } | undefined
    if (!selected)
      throw new Error('Selected VPS/app/current deployment was not found in the explicit profile')
    const cipher = loadExistingCredentialCipher(profileReal)
    phase = 'credential_decrypt'
    secret = loadSecret(database, cipher, selected.id)
    scratchDirectory = mkdtempSync(join(tmpdir(), 'opspilot-ml-preflight-'))

    const repoRoot = resolve(__dirname, '..', '..', '..')
    const isolatedMlService = prepareIsolatedMlService({
      projectRoot: repoRoot,
      labRoot: scratchDirectory
    })
    const python = join(repoRoot, 'ml-service', '.venv', 'Scripts', 'python.exe')
    const script = join(repoRoot, 'experiments', 'credential_handoff.py')
    if (!existsSync(python) || !existsSync(script))
      throw new Error('Preflight runtime is unavailable')
    const childEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          !/(SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|APP_ENV_JSON)/i.test(name) &&
          name.toUpperCase() !== 'OPSPILOT_SSH_KEY_FILE'
      )
    )
    childEnv.OPSPILOT_ML_SERVICE_ROOT = isolatedMlService
    phase = 'python_handoff'
    const result = await runSecretHandoff({
      command: python,
      args: [
        script,
        '--db-path',
        dbPath,
        '--vps-id',
        String(args.vpsId),
        '--app-id',
        String(args.appId),
        '--ml-url',
        args.mlUrl,
        '--report-path',
        args.report,
        '--scratch-dir',
        scratchDirectory,
        '--ml-service-root',
        isolatedMlService
      ],
      cwd: repoRoot,
      env: childEnv,
      secret,
      timeoutMs: PROCESS_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES
    })
    if (result.exitCode !== 0 && result.exitCode !== 2)
      throw new Error(result.stderr.trim() || 'Preflight handoff failed')
    phase = 'report_complete'
    process.stdout.write(result.stdout)
    exitCode = result.exitCode
  } finally {
    secret = null
    try {
      database.close()
    } finally {
      if (scratchDirectory) {
        try {
          removeIsolatedMlService(scratchDirectory)
          const fs = await import('node:fs/promises')
          await fs.rm(scratchDirectory, { recursive: false, force: true })
        } catch {
          process.stderr.write('ML_PREFLIGHT_SCRATCH_CLEANUP_FAILED\n')
          exitCode = 3
        }
      }
      app.exit(exitCode)
    }
  }
}

void main().catch((error: unknown) => {
  const safeReason =
    error instanceof Error
      ? error.message.match(/HANDOFF_[A-Z_]+|PREFLIGHT_HANDOFF_FAILED:[A-Za-z]+/)?.[0]
      : undefined
  const handoffCode = safeReason ? `:${safeReason}` : ''
  process.stderr.write(`ML_PREFLIGHT_LAUNCH_FAILED:${phase}${handoffCode}\n`)
  app.exit(3)
})
