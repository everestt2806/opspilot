import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { connect as connectNet, type Socket } from 'node:net'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import Database from 'better-sqlite3'
import { app } from 'electron'
import { electronApp } from '@electron-toolkit/utils'

import { loadExistingCredentialCipher } from '../src/main/crypto/masterKey'
import { loadSecret } from '../src/main/crypto/credentials'
import { AppError } from '../src/main/errors'
import { SshManager } from '../src/main/ssh/manager'
import {
  cleanupPreflightScratch,
  prepareIsolatedMlService,
  resolveProfileClone,
  runSecretHandoff
} from '../src/main/crypto/credentialHandoff'

const MAX_OUTPUT_BYTES = 1024 * 1024
const PROCESS_TIMEOUT_MS = 180_000
const MAX_SSH_SNAPSHOT_BYTES = 16 * 1024
const PREFLIGHT_RESOURCE_COMMAND = `set -eu
export LC_ALL=C
printf 'PREFLIGHT_VERSION=1\\n'
printf 'OS_ID='; (. /etc/os-release && printf '%s\\n' "\${ID:-unknown}")
printf 'ARCH='; uname -m
printf 'VCPU='; (getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || printf '0'); printf '\\n'
printf 'MEMTOTAL_BYTES='; awk '/^MemTotal:/ {printf "%.0f\\n", $2 * 1024}' /proc/meminfo
printf 'MEMAVAILABLE_BYTES='; awk '/^MemAvailable:/ {printf "%.0f\\n", $2 * 1024}' /proc/meminfo
printf 'DISK_TOTAL_BYTES='; df -B1 --output=size / 2>/dev/null | tail -n 1 | tr -d ' '
printf 'DISK_FREE_BYTES='; df -B1 --output=avail / 2>/dev/null | tail -n 1 | tr -d ' '
printf 'NTP_SYNC='; (timedatectl show -p NTPSynchronized --value 2>/dev/null || printf 'unknown'); printf '\\n'
printf 'DOCKER='; if command -v docker >/dev/null 2>&1; then printf 'yes\\n'; else printf 'no\\n'; fi
printf 'COMPOSE='; if docker compose version >/dev/null 2>&1; then printf 'yes\\n'; else printf 'no\\n'; fi
container_rows=$(docker ps --no-trunc --format '{{.ID}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.Label "com.docker.compose.project.working_dir"}}|{{.Label "com.docker.compose.project.config_files"}}')
printf 'CONTAINER_INVENTORY_BEGIN=1\\n'
if [ -n "$container_rows" ]; then
  while IFS= read -r row; do printf 'CONTAINER=%s\\n' "$row"; done <<EOF
$container_rows
EOF
fi
printf 'CONTAINER_INVENTORY_END=1\\n'`
let phase = 'arguments'

function parseArgs(argv: string[]): {
  profile: string
  vpsId: number
  appId: number
  mlUrl: string
  report: string
  sshDiagnosticReport: string
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
  const sshDiagnosticReport = values.get('--ssh-diagnostic-report')
  if (
    !profile ||
    !Number.isSafeInteger(vpsId) ||
    vpsId <= 0 ||
    !Number.isSafeInteger(appId) ||
    appId <= 0 ||
    !mlUrl ||
    !report ||
    !sshDiagnosticReport
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
  return {
    profile: resolve(profile),
    vpsId,
    appId,
    mlUrl,
    report: resolve(report),
    sshDiagnosticReport: resolve(sshDiagnosticReport)
  }
}

async function probeTcpBanner(host: string, port: number): Promise<Record<string, unknown>> {
  const started = Date.now()
  return new Promise<Record<string, unknown>>((resolveResult) => {
    let settled = false
    let bannerBytes = 0
    let sshBanner = false
    let connected = false
    let phase = 'tcp_connect'
    let socket: Socket | null = null
    const timerRef: { current?: NodeJS.Timeout } = {}
    const finish = (status: string): void => {
      if (settled) return
      settled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      socket?.destroy()
      resolveResult({
        phase,
        status,
        duration_ms: Date.now() - started,
        tcp_connected: connected,
        ssh_protocol_banner: sshBanner,
        banner_bytes: bannerBytes
      })
    }
    timerRef.current = setTimeout(
      () => finish(connected ? 'SSH_BANNER_TIMEOUT' : 'TCP_TIMEOUT'),
      4000
    )
    socket = connectNet({ host, port })
    socket.once('connect', () => {
      connected = true
      phase = 'ssh_banner'
      socket?.setTimeout(3000)
    })
    socket.on('data', (chunk: Buffer) => {
      bannerBytes = Math.min(256, bannerBytes + chunk.length)
      if (chunk.subarray(0, Math.min(chunk.length, 256)).includes(Buffer.from('SSH-'))) {
        sshBanner = true
        if (timerRef.current) clearTimeout(timerRef.current)
        finish('PASS')
      }
    })
    socket.once('timeout', () => finish(connected ? 'SSH_BANNER_TIMEOUT' : 'TCP_TIMEOUT'))
    socket.once('error', (error: NodeJS.ErrnoException) => finish(error.code ?? 'TCP_ERROR'))
    socket.once('close', () => {
      if (!settled) finish(connected ? 'SSH_BANNER_CLOSED' : 'TCP_CLOSED')
    })
  })
}

async function diagnosePinnedSsh(input: {
  vpsId: number
  host: string
  port: number
  username: string
  authType: 'key' | 'password'
  secret: string
  hostFingerprint: string | null
}): Promise<{
  report: Record<string, unknown>
  verifiedKnownHostsLine?: string
  verifiedKeyType?: string
  verifiedRemoteSnapshot?: Record<string, unknown>
}> {
  const tcp = await probeTcpBanner(input.host, input.port)
  const manager = new SshManager(() => ({
    host: input.host,
    port: input.port,
    hostFingerprint: input.hostFingerprint,
    username: input.username,
    authType: input.authType,
    secret: input.secret
  }))
  const started = Date.now()
  let timer: NodeJS.Timeout | undefined
  let managerStatus = 'UNKNOWN'
  let errorCode: string | undefined
  let deadlineExceeded = false
  const keyHolder: { current: Buffer | null } = { current: null }
  const commandPhases: Record<string, unknown>[] = []
  let verifiedRemoteSnapshot: Record<string, unknown> | undefined
  const connect = manager.connect(input.vpsId).then(
    () => {
      if (!deadlineExceeded) {
        managerStatus = 'PASS_PINNED_SSH_AUTHENTICATED'
        keyHolder.current = manager.getVerifiedHostKey(input.vpsId)
      }
    },
    (error: unknown) => {
      if (!deadlineExceeded) {
        managerStatus = 'FAILED'
        errorCode = error instanceof AppError ? error.code : 'SSH_ERROR'
      }
    }
  )
  const timedOut = await Promise.race([
    connect.then(() => false),
    new Promise<boolean>((resolveResult) => {
      timer = setTimeout(() => resolveResult(true), 25_000)
    })
  ])
  if (timer) clearTimeout(timer)
  if (timedOut) {
    deadlineExceeded = true
    managerStatus = 'TOTAL_DEADLINE_EXCEEDED'
    await manager.disconnect(input.vpsId)
    await Promise.race([
      connect,
      new Promise<void>((resolveResult) => setTimeout(resolveResult, 1000))
    ])
  }
  let verifiedKnownHostsLine: string | undefined
  let verifiedKeyType: string | undefined
  const verifiedKey = keyHolder.current
  if (managerStatus === 'PASS_PINNED_SSH_AUTHENTICATED' && verifiedKey && verifiedKey.length > 4) {
    const nameLength = verifiedKey.readUInt32BE(0)
    if (nameLength > 0 && nameLength <= verifiedKey.length - 4) {
      verifiedKeyType = verifiedKey.subarray(4, 4 + nameLength).toString('ascii')
      if (/^(ssh-|ecdsa-|sk-)/.test(verifiedKeyType)) {
        const token = input.port === 22 ? input.host : `[${input.host}]:${input.port}`
        verifiedKnownHostsLine = `${token} ${verifiedKeyType} ${verifiedKey.toString('base64')}`
      }
    }
  }
  if (managerStatus === 'PASS_PINNED_SSH_AUTHENTICATED' && verifiedKnownHostsLine) {
    const clockStarted = Date.now()
    const clockLocalBefore = Date.now()
    try {
      const clock = await manager.exec(input.vpsId, 'date +%s%3N', {
        timeoutMs: 5000,
        maxStdoutBytes: 128,
        maxStderrBytes: 512,
        logCommand: false,
        retryOnReconnect: false
      })
      const clockLocalAfter = Date.now()
      const remoteMs = /^\d{13}$/.test(clock.stdout.trim()) ? Number(clock.stdout.trim()) : null
      const clockOffsetMs =
        clock.code === 0 && remoteMs !== null
          ? Math.round(remoteMs - (clockLocalBefore + clockLocalAfter) / 2)
          : null
      commandPhases.push({
        phase: 'ssh_manager_readonly_clock',
        status: clockOffsetMs === null ? 'FAILED' : 'PASS',
        duration_ms: Date.now() - clockStarted,
        ...(clockOffsetMs === null ? {} : { clock_offset_ms: clockOffsetMs })
      })

      const resourceStarted = Date.now()
      const resource = await manager.exec(input.vpsId, PREFLIGHT_RESOURCE_COMMAND, {
        timeoutMs: 5000,
        maxStdoutBytes: MAX_SSH_SNAPSHOT_BYTES,
        maxStderrBytes: 1024,
        logCommand: false,
        retryOnReconnect: false
      })
      const resourceBytes = Buffer.byteLength(resource.stdout, 'utf8')
      const resourceOk = resource.code === 0 && resourceBytes <= MAX_SSH_SNAPSHOT_BYTES
      commandPhases.push({
        phase: 'ssh_manager_readonly_resource_inventory',
        status: resourceOk ? 'PASS' : 'FAILED',
        duration_ms: Date.now() - resourceStarted,
        output_bytes: resourceBytes
      })
      verifiedRemoteSnapshot = {
        endpoint: `${input.host}:${input.port}`,
        verified_key_type: verifiedKeyType,
        host_pin_verified: true,
        clock_offset_ms: clockOffsetMs,
        resource_exit_code: resource.code,
        resource_output: resourceOk ? resource.stdout : ''
      }
    } catch (error) {
      commandPhases.push({
        phase: 'ssh_manager_readonly_command',
        status: 'FAILED',
        reason_code: error instanceof AppError ? error.code : 'SSH_COMMAND_FAILED',
        duration_ms: Date.now() - clockStarted
      })
    }
  }
  await manager.disconnect(input.vpsId)
  return {
    report: {
      endpoint: `${input.host}:${input.port}`,
      saved_pin_configured: Boolean(input.hostFingerprint),
      phases: [
        tcp,
        {
          phase: 'ssh_manager_pinned_handshake_auth',
          status: managerStatus,
          ...(errorCode ? { reason_code: errorCode } : {}),
          ...(verifiedKeyType ? { verified_public_key_type: verifiedKeyType } : {}),
          duration_ms: Date.now() - started,
          total_deadline_ms: 25_000
        },
        ...commandPhases
      ]
    },
    ...(verifiedKnownHostsLine ? { verifiedKnownHostsLine, verifiedKeyType } : {}),
    ...(verifiedRemoteSnapshot ? { verifiedRemoteSnapshot } : {})
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  phase = 'profile'
  const tempRoot = realpathSync(tmpdir())
  let profileReal: string
  try {
    profileReal = resolveProfileClone(args.profile, tempRoot)
  } catch {
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
        SELECT v.id, v.host, v.port, v.username, v.auth_type, v.host_fingerprint,
               a.id AS app_id, d.id AS deployment_id
        FROM vps v
        JOIN app a ON a.vps_id = v.id
        JOIN deployment d ON d.id = a.current_deployment_id AND d.app_id = a.id
       WHERE v.id = ? AND v.archived_at IS NULL AND a.id = ?
    `
      )
      .get(args.vpsId, args.appId) as
      | {
          id: number
          host: string
          port: number
          username: string
          auth_type: 'key' | 'password'
          host_fingerprint: string | null
          app_id: number
          deployment_id: number
        }
      | undefined
    if (!selected)
      throw new Error('Selected VPS/app/current deployment was not found in the explicit profile')
    const cipher = loadExistingCredentialCipher(profileReal)
    phase = 'credential_decrypt'
    secret = loadSecret(database, cipher, selected.id)
    phase = 'ssh_diagnostic'
    const sshDiagnostic = await diagnosePinnedSsh({
      vpsId: selected.id,
      host: selected.host,
      port: selected.port,
      username: selected.username,
      authType: selected.auth_type,
      secret,
      hostFingerprint: selected.host_fingerprint
    })
    writeFileSync(
      args.sshDiagnosticReport,
      `${JSON.stringify(
        { generated_at_utc: new Date().toISOString(), ...sshDiagnostic.report },
        null,
        2
      )}\n`,
      { encoding: 'utf8', mode: 0o600 }
    )
    scratchDirectory = mkdtempSync(join(tmpdir(), 'opspilot-ml-preflight-'))
    let verifiedKnownHostsPath: string | null = null
    if (sshDiagnostic.verifiedKnownHostsLine) {
      verifiedKnownHostsPath = join(scratchDirectory, 'known_hosts.verified')
      writeFileSync(verifiedKnownHostsPath, `${sshDiagnostic.verifiedKnownHostsLine}\n`, {
        encoding: 'ascii',
        mode: 0o600
      })
    }
    let verifiedRemoteSnapshotPath: string | null = null
    if (sshDiagnostic.verifiedRemoteSnapshot) {
      const snapshotContent = JSON.stringify(sshDiagnostic.verifiedRemoteSnapshot)
      if (Buffer.byteLength(snapshotContent, 'utf8') <= MAX_SSH_SNAPSHOT_BYTES) {
        verifiedRemoteSnapshotPath = join(scratchDirectory, 'ssh-snapshot.json')
        writeFileSync(verifiedRemoteSnapshotPath, `${snapshotContent}\n`, {
          encoding: 'utf8',
          mode: 0o600
        })
      }
    }

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
        isolatedMlService,
        ...(verifiedKnownHostsPath ? ['--verified-known-hosts-file', verifiedKnownHostsPath] : []),
        ...(verifiedRemoteSnapshotPath
          ? ['--verified-ssh-snapshot-file', verifiedRemoteSnapshotPath]
          : [])
      ],
      cwd: repoRoot,
      env: childEnv,
      secret,
      timeoutMs: PROCESS_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES
    })
    if (result.exitCode !== 0 && result.exitCode !== 2) throw new Error('PREFLIGHT_CHILD_FAILED')
    phase = 'report_complete'
    process.stdout.write(result.stdout)
    exitCode = result.exitCode
  } finally {
    secret = null
    try {
      database.close()
    } finally {
      const cleanup = cleanupPreflightScratch(scratchDirectory, tempRoot, exitCode)
      if (cleanup.cleanupFailed) process.stderr.write('ML_PREFLIGHT_SCRATCH_CLEANUP_FAILED\n')
      app.exit(cleanup.exitCode)
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
