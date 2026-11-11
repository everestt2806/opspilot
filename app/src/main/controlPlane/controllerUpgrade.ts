import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fchownSync,
  fsyncSync,
  lchownSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readlinkSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { basename, dirname, join, posix } from 'node:path'
import { z } from 'zod'
import type {
  ControllerUpgradeRequest,
  ControllerUpgradePhase,
  ControllerUpgradeResult,
  ControllerUpgradeSnapshot
} from '../../../../docs/contracts/product-controller-upgrade'
import type { ControllerInstallationReceipt } from '../../../../docs/contracts/product-controller-installation'
import {
  controllerInstallerPaths,
  executeControllerInstallation,
  renderControllerUnit,
  type ControllerInstallerPaths
} from './controllerInstallation'
import {
  assertReleaseDirectory,
  readReleaseFile,
  releaseSha256,
  verifyControllerRelease
} from './controllerRelease'
import { CONTROLLER_RELEASE_LIMITS } from '../../../../docs/contracts/product-controller-release'

const uuid = z.uuidv4().refine((v) => v === v.toLowerCase()),
  sha = z.string().regex(/^[a-f0-9]{64}$/),
  path = z
    .string()
    .max(400)
    .refine((v) => v.startsWith('/') && posix.resolve(v) === v && !/[^A-Za-z0-9_./-]/.test(v))
const authority = {
  format: z.literal(1),
  request_key: uuid,
  installation_request_key: uuid,
  controller_id: uuid,
  parent_upgrade_key: uuid.nullable(),
  parent_release_sha256: sha,
  release_sha256: sha
}
const requestSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    ...authority,
    operation: z.literal('upgrade'),
    consent: z.literal(true),
    release_directory: path
  }),
  z.strictObject({ ...authority, operation: z.literal('inspect-upgrade') }),
  z.strictObject({
    ...authority,
    operation: z.literal('recover-upgrade'),
    consent: z.literal(true)
  }),
  z.strictObject({
    ...authority,
    operation: z.literal('rollback-upgrade'),
    consent: z.literal(true)
  })
])
const snapshotSchema = z.strictObject({
  format: z.literal(1),
  controller_id: uuid,
  schema_sha256: sha,
  state_sha256: sha,
  key_sha256: sha,
  database_inode: z.number().int().nonnegative(),
  key_inode: z.number().int().nonnegative(),
  quiescent: z.boolean()
})
const phases = z.enum([
  'prepared',
  'staging',
  'staged',
  'stop_pending',
  'stopped',
  'switch_pending',
  'switched',
  'start_pending',
  'commit_pending',
  'active',
  'rollback_pending',
  'rollback_commit_pending',
  'rolled_back'
])
const journalSchema = z.strictObject({
  ...authority,
  release_directory: path,
  payload_sha256: sha,
  phase: phases,
  before: snapshotSchema.nullable(),
  rollback_before: snapshotSchema.nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})
type Journal = z.output<typeof journalSchema>
const fail = (code: string): never => {
  throw Error('CONTROLLER_INSTALL_UPGRADE_' + code)
}
export function parseControllerUpgradeRequest(value: unknown): ControllerUpgradeRequest {
  const request = requestSchema.safeParse(value)
  if (
    !request.success ||
    request.data.request_key === request.data.parent_upgrade_key ||
    request.data.request_key === request.data.installation_request_key ||
    request.data.parent_release_sha256 === request.data.release_sha256
  )
    return fail('INPUT_INVALID')
  return request.data
}
export function renderUpgradedControllerUnit(
  paths: ControllerInstallerPaths,
  installationKey: string,
  key: string
): string {
  if (!uuid.safeParse(key).success) return fail('INPUT_INVALID')
  return renderControllerUnit(
    { ...paths, installation: posix.join(paths.installation, 'revisions', key) },
    installationKey
  )
}
export function assertControllerUpgradeCompatibility(
  old: ReturnType<typeof verifyControllerRelease>,
  next: ReturnType<typeof verifyControllerRelease>
): void {
  const assets = (value: typeof old): string =>
    JSON.stringify(
      value.files.filter(
        (f) => !['payload/control-plane.cjs', 'payload/bundle-manifest.json'].includes(f.path)
      )
    )
  if (
    old.lock_sha256 !== next.lock_sha256 ||
    old.node_abi !== next.node_abi ||
    old.node_version !== next.node_version ||
    assets(old) !== assets(next)
  )
    fail('INCOMPATIBLE_RELEASE')
}
const exists = (file: string): boolean => {
  try {
    lstatSync(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Trusted root CLI only. Paths/hooks cannot be supplied by request JSON or IPC. */
export async function executeControllerUpgrade(
  value: unknown,
  paths: ControllerInstallerPaths = controllerInstallerPaths,
  hooks: { afterEffect?: (phase: ControllerUpgradePhase) => void } = {}
): Promise<ControllerUpgradeResult> {
  const request = parseControllerUpgradeRequest(value)
  const result = await executeControllerInstallation<ControllerUpgradeResult>(
    { format: 1, operation: 'inspect', request_key: request.installation_request_key },
    paths,
    { guardedInstalled: (parent, held) => perform(request, paths, parent, held, hooks) }
  )
  if (!('installation_request_key' in result)) return fail('BASE_UNAVAILABLE')
  return result
}

async function perform(
  request: ControllerUpgradeRequest,
  paths: ControllerInstallerPaths,
  base: Readonly<ControllerInstallationReceipt>,
  held: { uid: number; gid: number; lockFd: number },
  hooks: { afterEffect?: (phase: ControllerUpgradePhase) => void }
): Promise<ControllerUpgradeResult> {
  const { uid, gid, lockFd } = held,
    unitName = basename(paths.unit),
    env = {
      PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: paths.data,
      LANG: 'C.UTF-8',
      NODE_ENV: 'production'
    },
    currentFile = join(paths.state, 'upgrade.json'),
    history = join(paths.state, 'upgrade-history'),
    revisions = join(paths.installation, 'revisions')
  if (base.controller_id !== request.controller_id) return fail('AUTHORITY_CHANGED')
  const rootRead = (file: string, cap = 32768): Buffer => readReleaseFile(file, cap, false, 0)
  const sync = (directory: string): void => {
    const fd = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
  const rootDir = (directory: string, mode: number): void => {
    assertReleaseDirectory(directory, 0)
    if (lstatSync(directory).uid !== 0 || (lstatSync(directory).mode & 0o777) !== mode)
      fail('CONFLICT')
  }
  rootDir(paths.state, 0o700)
  rootDir(paths.installation, 0o755)
  const atomic = (file: string, bytes: Buffer, mode = 0o600, replace = false, owner = 0): void => {
    if (exists(file)) {
      const old = readReleaseFile(file, Math.max(bytes.length, 32768), false, owner)
      if (!replace) {
        if (!old.equals(bytes) || (lstatSync(file).mode & 0o777) !== mode) fail('CONFLICT')
        return
      }
    }
    const temporary = file + '.upgrading-' + request.request_key
    if (exists(temporary)) {
      rootRead(temporary, CONTROLLER_RELEASE_LIMITS.node)
      unlinkSync(temporary)
    }
    const fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode
    )
    try {
      fchmodSync(fd, mode)
      writeFileSync(fd, bytes)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, file)
    sync(dirname(file))
  }
  const run = (command: string, args: string[], timeout = 30000): string => {
    const child = spawnSync(command, args, {
      env,
      cwd: '/',
      encoding: 'utf8',
      timeout,
      maxBuffer: 65536,
      stdio: ['ignore', 'pipe', 'pipe', lockFd]
    })
    if (child.error || child.status !== 0) return fail('COMMAND_FAILED')
    return child.stdout
  }
  const runtime = (key: string | null): string =>
    key ? join(revisions, key, 'runtime') : join(paths.installation, 'runtime')
  const artifact = (key: string | null): string => join(runtime(key), 'payload/control-plane.cjs')
  const verifiedRuntime = (
    key: string | null,
    pin: string
  ): ReturnType<typeof verifyControllerRelease> => {
    const directory = runtime(key),
      manifest = verifyControllerRelease(directory, pin, uid),
      folders = new Set([directory])
    for (const file of [...manifest.files, { path: 'release-manifest.json' }]) {
      const name = join(directory, file.path)
      if (lstatSync(name).uid !== uid) return fail('RUNTIME_CHANGED')
      let parent = dirname(name)
      while (parent !== directory) {
        folders.add(parent)
        parent = dirname(parent)
      }
    }
    for (const folder of folders)
      if (lstatSync(folder).uid !== uid || (lstatSync(folder).mode & 0o777) !== 0o700)
        return fail('RUNTIME_CHANGED')
    return manifest
  }
  const expectedUnit = (key: string | null): Buffer =>
    Buffer.from(
      key
        ? renderUpgradedControllerUnit(paths, base.request_key, key)
        : renderControllerUnit(paths, base.request_key)
    )
  const assertExecution = (key: string | null, payloadPin: string): void => {
    const file = key
      ? join(revisions, key, 'execution.json')
      : join(paths.installation, 'execution.json')
    const expected = Buffer.from(
      JSON.stringify({
        format: 1,
        artifact: artifact(key),
        manifest_sha256: payloadPin,
        ...(key
          ? {
              activation_guard: { request_key: key, path: join(revisions, key, 'activation.json') }
            }
          : {})
      }) + '\n'
    )
    if (!rootRead(file, 4096).equals(expected) || (lstatSync(file).mode & 0o777) !== 0o600)
      return fail('EXECUTION_CHANGED')
  }
  assertExecution(null, base.payload_sha256)
  const unitInfo = (): Record<string, string> =>
    Object.fromEntries(
      run('/usr/bin/systemctl', [
        'show',
        unitName,
        '--property=LoadState,ActiveState,SubState,MainPID,User,Group,FragmentPath,DropInPaths,UnitFileState'
      ])
        .trim()
        .split('\n')
        .map((line) => {
          const i = line.indexOf('=')
          return [line.slice(0, i), line.slice(i + 1)]
        })
    )
  const readJournal = (file: string): Journal => {
    try {
      const stat = lstatSync(file)
      if ((stat.mode & 0o777) !== 0o600) fail('CONFLICT')
      const j = journalSchema.parse(JSON.parse(rootRead(file).toString('utf8')))
      if (j.installation_request_key !== base.request_key || j.controller_id !== base.controller_id)
        fail('AUTHORITY_CHANGED')
      return j
    } catch {
      return fail('JOURNAL_INVALID')
    }
  }
  let journal = exists(currentFile) ? readJournal(currentFile) : null
  let isCurrent = !!journal && journal.request_key === request.request_key
  if (!isCurrent && exists(join(history, request.request_key + '.json')))
    journal = readJournal(join(history, request.request_key + '.json'))
  const sameIntent = (j: Journal): boolean =>
    (Object.keys(authority) as Array<keyof typeof authority>).every(
      (key) => j[key] === request[key]
    )
  if (journal && journal.request_key === request.request_key && !sameIntent(journal))
    return fail('CONFLICT')
  if (
    journal?.request_key === request.request_key &&
    request.operation === 'upgrade' &&
    request.release_directory !== journal.release_directory
  )
    return fail('CONFLICT')
  const archive = (j: Journal): void => {
    if (!exists(history)) mkdirSync(history, { mode: 0o700 })
    rootDir(history, 0o700)
    atomic(
      join(history, j.request_key + '.json'),
      Buffer.from(JSON.stringify(j) + '\n'),
      0o600,
      true
    )
  }
  const systemMatches = (allowed: Array<string | null>): string | null => {
    const bytes = rootRead(paths.unit, 8192),
      info = unitInfo()
    if (
      (lstatSync(paths.unit).mode & 0o777) !== 0o644 ||
      info.LoadState !== 'loaded' ||
      info.FragmentPath !== paths.unit ||
      info.DropInPaths ||
      info.User !== paths.account ||
      info.Group !== paths.account ||
      info.UnitFileState !== 'enabled'
    )
      return fail('UNIT_CHANGED')
    const found = allowed.find((key) => expectedUnit(key).equals(bytes))
    if (found === undefined) return fail('UNIT_CHANGED')
    return found
  }
  const proc = (file: string, cap = 65536): Buffer => {
    // /proc entries are uid-owned, zero-sized virtual files, not regular release files.
    const result = spawnSync('/usr/bin/head', ['-c', String(cap + 1), file], {
      env,
      timeout: 5000,
      maxBuffer: cap + 2,
      stdio: ['ignore', 'pipe', 'pipe', lockFd]
    })
    if (result.status !== 0 || result.stdout.length > cap) return fail('PROCESS_CHANGED')
    return result.stdout
  }
  const attest = (key: string | null): number => {
    systemMatches([key])
    const info = unitInfo(),
      pid = Number(info.MainPID)
    if (!Number.isSafeInteger(pid) || pid < 0) return fail('PROCESS_CHANGED')
    if (
      pid > 0 &&
      (Number(
        proc(`/proc/${pid}/status`)
          .toString()
          .match(/^Uid:\s+(\d+)/m)?.[1]
      ) !== uid ||
        proc(`/proc/${pid}/cmdline`).toString().split('\0').filter(Boolean).join('\n') !==
          [join(runtime(key), 'node'), artifact(key), 'run-product', '--data-dir', paths.data].join(
            '\n'
          ) ||
        readlinkSync(`/proc/${pid}/exe`) !== join(runtime(key), 'node'))
    )
      return fail('PROCESS_CHANGED')
    return pid
  }
  const health = async (key: string | null, state: 'ready' | 'maintenance'): Promise<boolean> => {
    try {
      const pid = attest(key)
      if (!pid) return false
      const sockets = proc('/proc/net/tcp', 2 * 1024 * 1024)
        .toString()
        .split('\n')
        .map((l) => l.trim().split(/\s+/))
        .filter((p) => p[1] === '0100007F:2240' && p[3] === '0A')
        .map((p) => `socket:[${p[9]}]`)
      if (
        !readdirSync(`/proc/${pid}/fd`).some((fd) => {
          try {
            return sockets.includes(readlinkSync(`/proc/${pid}/fd/${fd}`))
          } catch {
            return false
          }
        })
      )
        return false
      const response = await fetch('http://127.0.0.1:8768/healthz', {
        redirect: 'error',
        signal: AbortSignal.timeout(1500)
      })
      if (response.status !== 200 || !response.body) return false
      const reader = response.body.getReader()
      let body = Buffer.alloc(0)
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          if (body.length + chunk.value.length > 4096) return false
          body = Buffer.concat([body, chunk.value])
        }
      } finally {
        await reader.cancel()
      }
      const dto = JSON.parse(body.toString('utf8'))
      return dto.api_version === 'v1' && dto.service_state === state
    } catch {
      return false
    }
  }
  const waitHealth = async (
    key: string | null,
    state: 'ready' | 'maintenance'
  ): Promise<boolean> => {
    const until = Date.now() + 25000
    while (Date.now() < until) {
      if (await health(key, state)) return true
      await new Promise((done) => setTimeout(done, 200))
    }
    return false
  }
  const identityFence = (snapshot: ControllerUpgradeSnapshot): void => {
    const before = journal?.before
    if (
      before &&
      (
        ['controller_id', 'schema_sha256', 'key_sha256', 'database_inode', 'key_inode'] as const
      ).some((key) => snapshot[key] !== before[key])
    )
      fail('STATE_CHANGED')
  }
  const invoke = (key: string, command: 'upgrade-check'): ControllerUpgradeSnapshot => {
    verifiedRuntime(key, journal!.release_sha256)
    const value: unknown = JSON.parse(
      run('/usr/bin/setpriv', [
        '--reuid',
        String(uid),
        '--regid',
        String(gid),
        '--clear-groups',
        '--',
        join(runtime(key), 'node'),
        artifact(key),
        command,
        '--data-dir',
        paths.data
      ])
    )
    const parsed = snapshotSchema.safeParse(value)
    if (!parsed.success || parsed.data.controller_id !== base.controller_id)
      return fail('CHECK_FAILED')
    identityFence(parsed.data)
    return parsed.data
  }
  const stopped = (): void => {
    const info = unitInfo()
    // Explicit stop can retain a failed result from the process exit. Both terminal states
    // have no restart job; quiescent DB snapshot and port ownership are checked separately.
    if (Number(info.MainPID) !== 0 || !['inactive', 'failed'].includes(info.ActiveState))
      fail('STOP_UNCONFIRMED')
  }
  const portFree = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      const server = createServer()
      server.once('error', () => reject(Error('CONTROLLER_INSTALL_UPGRADE_PORT_BUSY')))
      server.listen(8768, '127.0.0.1', () => server.close(() => resolve()))
    })
  }
  const persist = (phase: ControllerUpgradePhase): void => {
    journal!.phase = phase
    journal!.updated_at = new Date().toISOString()
    atomic(currentFile, Buffer.from(JSON.stringify(journal) + '\n'), 0o600, true)
  }
  const unchanged = (
    before: ControllerUpgradeSnapshot | null,
    after: ControllerUpgradeSnapshot
  ): void => {
    if (!before || JSON.stringify(before) !== JSON.stringify(after)) fail('STATE_CHANGED')
  }
  const result = async (): Promise<ControllerUpgradeResult> => {
    const j = journal!
    let actualKey = ['rolled_back', 'rollback_commit_pending'].includes(j.phase)
      ? j.parent_upgrade_key
      : j.request_key
    let state: ControllerUpgradeResult['service_state'] = 'not_current'
    if (isCurrent) {
      const allowed = ['prepared', 'staging', 'staged', 'stop_pending', 'stopped'].includes(j.phase)
        ? [j.parent_upgrade_key]
        : ['switch_pending', 'rollback_pending', 'rollback_commit_pending'].includes(j.phase)
          ? [j.parent_upgrade_key, j.request_key]
          : [actualKey]
      actualKey = systemMatches(allowed)
      const pid = attest(actualKey)
      state = !pid
        ? unitInfo().ActiveState === 'failed'
          ? 'failed'
          : 'stopped'
        : (await health(actualKey, 'ready'))
          ? 'running'
          : 'maintenance'
    }
    const runtimePin = actualKey === j.request_key ? j.release_sha256 : j.parent_release_sha256
    const runtimeManifest = verifiedRuntime(actualKey, runtimePin)
    assertExecution(actualKey, runtimeManifest.payload_sha256)
    if (j.before) {
      const keyBytes = readReleaseFile(join(paths.data, '.controller-runtime-key'), 32, false, uid)
      try {
        if (
          releaseSha256(keyBytes) !== j.before.key_sha256 ||
          lstatSync(join(paths.data, 'opspilot.db')).ino !== j.before.database_inode ||
          lstatSync(join(paths.data, '.controller-runtime-key')).ino !== j.before.key_inode
        )
          return fail('STATE_CHANGED')
      } finally {
        keyBytes.fill(0)
      }
    }
    return {
      installation_request_key: j.installation_request_key,
      controller_id: j.controller_id,
      parent_upgrade_key: j.parent_upgrade_key,
      parent_release_sha256: j.parent_release_sha256,
      release_sha256: j.release_sha256,
      format: 1,
      request_key: j.request_key,
      payload_sha256: j.payload_sha256,
      runtime_release_sha256: runtimePin,
      runtime_payload_sha256: runtimeManifest.payload_sha256,
      runtime_upgrade_key: actualKey,
      phase: j.phase,
      is_current: isCurrent,
      service_state: state,
      runtime_uid: uid,
      artifact_path: artifact(actualKey),
      node_path: join(runtime(actualKey), 'node'),
      data_directory: paths.data
    }
  }
  const hold = async (): Promise<() => Promise<void>> => {
    const child = spawn(
      '/usr/bin/setpriv',
      [
        '--reuid',
        String(uid),
        '--regid',
        String(gid),
        '--clear-groups',
        '--',
        join(runtime(journal!.request_key), 'node'),
        artifact(journal!.request_key),
        'upgrade-hold',
        '--data-dir',
        paths.data
      ],
      { env, cwd: '/', stdio: ['pipe', 'pipe', 'pipe', lockFd] }
    )
    const stdin = child.stdin,
      stdout = child.stdout,
      stderr = child.stderr
    if (!stdin || !stdout || !stderr) {
      child.kill('SIGKILL')
      return fail('HOLD_FAILED')
    }
    const exit = new Promise<void>((done) => {
      child.once('close', () => done())
      child.once('error', () => done())
    })
    let closing: Promise<void> | null = null
    const release = (): Promise<void> =>
      closing ??
      (closing = (async (): Promise<void> => {
        stdin.end()
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
        try {
          await exit
        } finally {
          clearTimeout(timer)
        }
      })())
    try {
      const snapshot = await new Promise<ControllerUpgradeSnapshot>((resolve, reject) => {
        let text = '',
          errors = 0
        const timer = setTimeout(() => reject(Error('HOLD_TIMEOUT')), 10000)
        child.once('error', () => {
          clearTimeout(timer)
          reject(Error('HOLD_FAILED'))
        })
        child.once('exit', () => {
          clearTimeout(timer)
          reject(Error('HOLD_FAILED'))
        })
        stderr.on('data', (bytes: Buffer) => {
          errors += bytes.length
          if (errors > 4096) {
            clearTimeout(timer)
            reject(Error('HOLD_FAILED'))
          }
        })
        stdout.on('data', (bytes: Buffer) => {
          text += bytes.toString('utf8')
          if (text.length > 4096) {
            clearTimeout(timer)
            reject(Error('HOLD_FAILED'))
          }
          if (text.includes('\n')) {
            clearTimeout(timer)
            stdout.removeAllListeners('data')
            stdout.resume()
            try {
              const parsed = snapshotSchema.safeParse(JSON.parse(text))
              if (parsed.success) resolve(parsed.data)
              else reject(Error('HOLD_FAILED'))
            } catch {
              reject(Error('HOLD_FAILED'))
            }
          }
        })
      })
      if (snapshot.controller_id !== base.controller_id) return fail('AUTHORITY_CHANGED')
      identityFence(snapshot)
      if (!snapshot.quiescent) return fail('NOT_QUIESCENT')
      return release
    } catch (error) {
      await release()
      if (error instanceof Error && /^CONTROLLER_INSTALL_UPGRADE_[A-Z_]+$/.test(error.message))
        throw error
      return fail('HOLD_FAILED')
    }
  }
  if (
    !isCurrent &&
    request.operation === 'rollback-upgrade' &&
    journal?.request_key === request.request_key &&
    journal.phase === 'active'
  ) {
    const latest = exists(currentFile) ? readJournal(currentFile) : null
    if (latest?.phase === 'rolled_back' && latest.parent_upgrade_key === journal.request_key) {
      verifiedRuntime(journal.request_key, journal.release_sha256)
      assertExecution(journal.request_key, journal.payload_sha256)
      if (!(await health(journal.request_key, 'ready'))) return fail('PARENT_NOT_READY')
      archive(latest)
      atomic(currentFile, Buffer.from(JSON.stringify(journal) + '\n'), 0o600, true)
      isCurrent = true
    }
  }
  if (journal?.request_key === request.request_key) {
    if (
      !isCurrent ||
      journal.phase === 'rolled_back' ||
      request.operation === 'inspect-upgrade' ||
      request.operation === 'upgrade'
    )
      return result()
  } else {
    if (request.operation !== 'upgrade') return fail('NOT_FOUND')
    const previous = exists(currentFile) ? readJournal(currentFile) : null
    const parentKey =
      previous?.phase === 'active'
        ? previous.request_key
        : previous?.phase === 'rolled_back'
          ? previous.parent_upgrade_key
          : null
    if (previous && !['active', 'rolled_back'].includes(previous.phase)) return fail('BUSY')
    if (request.parent_upgrade_key !== parentKey) return fail('AUTHORITY_CHANGED')
    const parentPin =
      previous?.phase === 'active'
        ? previous.release_sha256
        : parentKey
          ? readJournal(join(history, parentKey + '.json')).release_sha256
          : base.release_sha256
    if (request.parent_release_sha256 !== parentPin) return fail('AUTHORITY_CHANGED')
    const oldManifest = verifiedRuntime(parentKey, parentPin),
      candidate = verifyControllerRelease(request.release_directory, request.release_sha256)
    assertControllerUpgradeCompatibility(oldManifest, candidate)
    if (!(await health(parentKey, 'ready'))) return fail('PARENT_NOT_READY')
    if (previous) archive(previous)
    const now = new Date().toISOString()
    journal = {
      ...request,
      release_directory: request.release_directory,
      payload_sha256: candidate.payload_sha256,
      phase: 'prepared',
      before: null,
      rollback_before: null,
      created_at: now,
      updated_at: now
    }
    // Remove transport operation/consent; journal contains only the immutable intent and state.
    journal = journalSchema.parse(
      Object.fromEntries(
        Object.keys(journalSchema.shape).map((key) => [key, journal![key as keyof Journal]])
      )
    )
    isCurrent = true
    persist('prepared')
  }
  const j = journal!,
    revision = join(revisions, j.request_key),
    newRuntime = runtime(j.request_key),
    guard = join(revision, 'activation.json')
  const gateBytes = Buffer.from(JSON.stringify({ format: 1, request_key: j.request_key }) + '\n')
  const oldPin = j.parent_upgrade_key
    ? readJournal(join(history, j.parent_upgrade_key + '.json')).release_sha256
    : base.release_sha256
  if (oldPin !== j.parent_release_sha256) return fail('AUTHORITY_CHANGED')
  const oldManifest = verifiedRuntime(j.parent_upgrade_key, oldPin)
  assertExecution(j.parent_upgrade_key, oldManifest.payload_sha256)
  if (
    request.operation === 'rollback-upgrade' &&
    ['prepared', 'staging', 'staged'].includes(j.phase)
  ) {
    attest(j.parent_upgrade_key)
    persist('rolled_back')
    archive(j)
    return result()
  }
  const manifest = ['prepared', 'staging'].includes(j.phase)
    ? verifyControllerRelease(j.release_directory, j.release_sha256)
    : verifiedRuntime(j.request_key, j.release_sha256)
  assertControllerUpgradeCompatibility(oldManifest, manifest)
  if (!['prepared', 'staging'].includes(j.phase)) {
    rootDir(revisions, 0o755)
    rootDir(revision, 0o755)
    if (
      !rootRead(join(revision, '.controller-upgrade'), 512).equals(
        Buffer.from(
          JSON.stringify({
            format: 1,
            request_key: j.request_key,
            installation_request_key: base.request_key
          }) + '\n'
        )
      )
    )
      return fail('CONFLICT')
    assertExecution(j.request_key, j.payload_sha256)
  }
  const stop = (allowed: Array<string | null>): void => {
    const current = systemMatches(allowed)
    attest(current)
    run('/usr/bin/systemctl', ['stop', unitName], 55000)
    stopped()
  }
  const rollback = async (): Promise<void> => {
    if (['prepared', 'staging', 'staged'].includes(j.phase)) {
      attest(j.parent_upgrade_key)
      persist('rolled_back')
      archive(j)
      return
    }
    const selected = systemMatches([j.request_key, j.parent_upgrade_key])
    if (selected === j.request_key) {
      // Recovery also takes a fresh mutex: the candidate could have restarted and accepted writes.
      const release = await hold()
      try {
        j.rollback_before = invoke(j.request_key, 'upgrade-check')
        persist('rollback_pending')
        stop([j.request_key])
      } finally {
        await release()
      }
      unchanged(j.rollback_before, invoke(j.request_key, 'upgrade-check'))
      hooks.afterEffect?.('rollback_pending')
      // Publishing the parent unit may expose it on reboot. Do not compare business state after this boundary.
      persist('rollback_commit_pending')
      atomic(paths.unit, expectedUnit(j.parent_upgrade_key), 0o644, true)
    } else {
      invoke(j.request_key, 'upgrade-check')
      persist('rollback_commit_pending')
    }
    if (exists(guard)) {
      if (!rootRead(guard, 512).equals(gateBytes)) fail('CONFLICT')
      unlinkSync(guard)
      sync(revision)
    }
    // The unit write may have survived a crash before daemon-reload.
    run('/usr/bin/systemctl', ['daemon-reload'])
    if (!attest(j.parent_upgrade_key)) {
      if (!invoke(j.request_key, 'upgrade-check').quiescent) fail('NOT_QUIESCENT')
      await portFree()
      run('/usr/bin/systemctl', ['start', unitName])
    }
    hooks.afterEffect?.('rollback_commit_pending')
    if (!(await waitHealth(j.parent_upgrade_key, 'ready'))) fail('ROLLBACK_NOT_READY')
    // Once old service is ready, legitimate writes may resume; preserve checks happened before start.
    persist('rolled_back')
    archive(j)
  }
  if (
    request.operation === 'rollback-upgrade' ||
    ['rollback_pending', 'rollback_commit_pending'].includes(j.phase)
  ) {
    await rollback()
    return result()
  }
  if (j.phase === 'active') return result()
  if (j.phase === 'prepared' || j.phase === 'staging') {
    persist('staging')
    if (!exists(revisions)) {
      mkdirSync(revisions, { mode: 0o755 })
      chmodSync(revisions, 0o755)
    }
    rootDir(revisions, 0o755)
    if (!exists(revision)) {
      mkdirSync(revision, { mode: 0o755 })
      chmodSync(revision, 0o755)
    }
    rootDir(revision, 0o755)
    atomic(
      join(revision, '.controller-upgrade'),
      Buffer.from(
        JSON.stringify({
          format: 1,
          request_key: j.request_key,
          installation_request_key: base.request_key
        }) + '\n'
      )
    )
    if (!exists(newRuntime)) mkdirSync(newRuntime, { mode: 0o700 })
    assertReleaseDirectory(newRuntime, uid)
    for (const entry of [
      ...manifest.files,
      {
        path: 'release-manifest.json',
        size: CONTROLLER_RELEASE_LIMITS.manifest,
        sha256: j.release_sha256,
        mode: 0o600
      }
    ]) {
      let parent = newRuntime
      for (const part of entry.path.split('/').slice(0, -1)) {
        parent = join(parent, part)
        if (!exists(parent)) mkdirSync(parent, { mode: 0o700 })
        assertReleaseDirectory(parent, uid)
      }
      const bytes = rootRead(
        join(j.release_directory, entry.path),
        entry.path === 'node'
          ? CONTROLLER_RELEASE_LIMITS.node
          : Math.max(entry.size, CONTROLLER_RELEASE_LIMITS.file)
      )
      if (releaseSha256(bytes) !== entry.sha256) return fail('RELEASE_CHANGED')
      atomic(join(newRuntime, entry.path), bytes, entry.mode, false, uid)
    }
    const own = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const file = join(directory, name),
          info = lstatSync(file)
        if (info.isSymbolicLink() || (!info.isDirectory() && info.nlink !== 1)) fail('CONFLICT')
        if (info.isDirectory()) own(file)
        else {
          const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
          try {
            fchownSync(fd, uid, gid)
          } finally {
            closeSync(fd)
          }
        }
      }
      lchownSync(directory, uid, gid)
    }
    verifyControllerRelease(newRuntime, j.release_sha256, uid)
    own(newRuntime)
    verifiedRuntime(j.request_key, j.release_sha256)
    atomic(
      join(revision, 'execution.json'),
      Buffer.from(
        JSON.stringify({
          format: 1,
          artifact: artifact(j.request_key),
          manifest_sha256: j.payload_sha256,
          activation_guard: { request_key: j.request_key, path: guard }
        }) + '\n'
      )
    )
    hooks.afterEffect?.('staging')
    persist('staged')
  }
  if (j.phase === 'staged' || j.phase === 'stop_pending') {
    const release = await hold()
    try {
      persist('stop_pending')
      stop([j.parent_upgrade_key])
      hooks.afterEffect?.('stop_pending')
    } finally {
      await release()
    }
    j.before = invoke(j.request_key, 'upgrade-check')
    if (!j.before.quiescent) fail('NOT_QUIESCENT')
    persist('stopped')
  }
  if (j.phase === 'stopped' || j.phase === 'switch_pending') {
    const selected = systemMatches([j.parent_upgrade_key, j.request_key])
    if (selected === j.parent_upgrade_key && attest(selected)) {
      const release = await hold()
      try {
        persist('stop_pending')
        stop([j.parent_upgrade_key])
      } finally {
        await release()
      }
      j.before = invoke(j.request_key, 'upgrade-check')
      if (!j.before.quiescent) fail('NOT_QUIESCENT')
      persist('stopped')
    } else if (selected === j.request_key && attest(selected)) {
      if (exists(guard) || !(await waitHealth(j.request_key, 'maintenance'))) fail('GATE_CHANGED')
    } else stopped()
    unchanged(j.before, invoke(j.request_key, 'upgrade-check'))
    persist('switch_pending')
    atomic(paths.unit, expectedUnit(j.request_key), 0o644, true)
    run('/usr/bin/systemctl', ['daemon-reload'])
    hooks.afterEffect?.('switch_pending')
    persist('switched')
  }
  if (j.phase === 'switched' || j.phase === 'start_pending') {
    attest(j.request_key)
    unchanged(j.before, invoke(j.request_key, 'upgrade-check'))
    if (exists(guard)) return fail('GATE_CHANGED')
    persist('start_pending')
    if (!attest(j.request_key)) {
      await portFree()
      run('/usr/bin/systemctl', ['start', unitName])
    }
    hooks.afterEffect?.('start_pending')
    if (!(await waitHealth(j.request_key, 'maintenance'))) return fail('CANDIDATE_NOT_READY')
    unchanged(j.before, invoke(j.request_key, 'upgrade-check'))
    persist('commit_pending')
  }
  if (j.phase === 'commit_pending') {
    if (!attest(j.request_key)) {
      const current = invoke(j.request_key, 'upgrade-check')
      if (!current.quiescent) return fail('NOT_QUIESCENT')
      await portFree()
      run('/usr/bin/systemctl', ['start', unitName])
    }
    if (!exists(guard)) {
      unchanged(j.before, invoke(j.request_key, 'upgrade-check'))
      atomic(guard, gateBytes, 0o644)
    } else if (!rootRead(guard, 512).equals(gateBytes)) return fail('GATE_CHANGED')
    hooks.afterEffect?.('commit_pending')
    if (await waitHealth(j.request_key, 'ready')) {
      persist('active')
      archive(j)
    }
  }
  return result()
}
