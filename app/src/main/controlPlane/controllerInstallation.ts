import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  constants,
  fchownSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lchownSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  readSync,
  readdirSync,
  renameSync,
  statfsSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, posix } from 'node:path'
import type {
  ControllerInstallationPhase,
  ControllerInstallationReceipt,
  ControllerInstallationRequest,
  ControllerInstallationResult
} from '../../../../docs/contracts/product-controller-installation'
import { CONTROLLER_RELEASE_LIMITS as limits } from '../../../../docs/contracts/product-controller-release'
import {
  assertReleaseDirectory,
  readReleaseFile,
  releaseSha256,
  verifyControllerRelease
} from './controllerRelease'

export type ControllerInstallerPaths = Readonly<{
  state: string
  installation: string
  data: string
  unit: string
  account: string
}>
export const controllerInstallerPaths: ControllerInstallerPaths = Object.freeze({
  state: '/var/lib/opspilot-controller-install',
  installation: '/opt/opspilot-controller',
  data: '/var/lib/opspilot-controller',
  unit: '/etc/systemd/system/opspilot-controller-product.service',
  account: 'opspilot-controller'
})
const phases: ControllerInstallationPhase[] = [
  'prepared',
  'account_pending',
  'account_ready',
  'runtime_pending',
  'runtime_ready',
  'data_pending',
  'data_ready',
  'database_pending',
  'database_ready',
  'key_pending',
  'key_ready',
  'unit_pending',
  'unit_ready',
  'start_pending',
  'installed'
]
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) &&
  value.length === 36
const pin = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && value.length === 64
const path = (value: unknown): value is string =>
  typeof value === 'string' &&
  posix.isAbsolute(value) &&
  value.startsWith('/') &&
  !/[^A-Za-z0-9_./-]/.test(value) &&
  posix.resolve(value) === value &&
  value.length <= 400
const fail = (code: string): never => {
  throw new Error('CONTROLLER_INSTALL_' + code)
}

// existsSync bỏ qua dangling symlink; installer phải xem mọi directory entry là đã tồn tại.
const present = (file: string): boolean => {
  try {
    lstatSync(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function readProc(file: string, cap: number): Buffer {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const bytes = Buffer.alloc(cap + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (!count) break
      length += count
    }
    if (length > cap) return fail('HOST_PROBE_LIMIT')
    return bytes.subarray(0, length)
  } finally {
    closeSync(fd)
  }
}

export function parseControllerInstallationRequest(value: unknown): ControllerInstallationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INPUT_INVALID')
  const item = value as Record<string, unknown>
  if (item.format !== 1 || !uuid(item.request_key)) return fail('INPUT_INVALID')
  const keys = Object.keys(item).sort().join(',')
  if (item.operation === 'inspect' && keys === 'format,operation,request_key')
    return item as ControllerInstallationRequest
  if (item.consent !== true || !pin(item.release_sha256)) return fail('INPUT_INVALID')
  if (
    item.operation === 'recover' &&
    keys === 'consent,format,operation,release_sha256,request_key'
  )
    return item as ControllerInstallationRequest
  if (
    item.operation === 'install' &&
    keys === 'consent,format,operation,release_directory,release_sha256,request_key' &&
    path(item.release_directory)
  )
    return item as ControllerInstallationRequest
  return fail('INPUT_INVALID')
}

export function renderControllerUnit(paths: ControllerInstallerPaths, key: string): string {
  if (
    !uuid(key) ||
    ![paths.state, paths.installation, paths.data, paths.unit].every(path) ||
    !/^[a-z][a-z0-9-]{0,30}$/.test(paths.account) ||
    paths.account === 'root' ||
    !paths.unit.endsWith('.service')
  )
    return fail('PATHS_INVALID')
  return `# OpsPilot installation ${key}\n[Unit]\nDescription=OpsPilot Product Controller\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${paths.account}\nGroup=${paths.account}\nWorkingDirectory=${paths.installation}/runtime\nUMask=0077\nEnvironment=NODE_ENV=production\nEnvironment=PATH=/usr/bin:/bin\nStandardInput=file:${paths.installation}/execution.json\nExecStart=${paths.installation}/runtime/node ${paths.installation}/runtime/payload/control-plane.cjs run-product --data-dir ${paths.data}\nRestart=on-failure\nRestartSec=5s\nTimeoutStopSec=45s\nKillMode=control-group\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=${paths.data}\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\n\n[Install]\nWantedBy=multi-user.target\n`
}

/** CLI trusted code only. Paths/hook là composition seam của Linux lab, không nhận từ JSON/IPC. */
export async function executeControllerInstallation(
  value: unknown,
  paths: ControllerInstallerPaths = controllerInstallerPaths,
  hooks: { afterEffect?: (phase: ControllerInstallationPhase) => void } = {}
): Promise<ControllerInstallationResult> {
  const request = parseControllerInstallationRequest(value)
  if (
    process.platform !== 'linux' ||
    process.arch !== 'x64' ||
    process.getuid?.() !== 0 ||
    process.versions.node.split('.')[0] !== '22'
  )
    return fail('ROOT_LINUX_NODE22_REQUIRED')
  renderControllerUnit(paths, request.request_key)
  process.umask(0o077)
  const cleanEnv = {
    PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
    LANG: 'C.UTF-8',
    HOME: paths.data,
    NODE_ENV: 'production'
  }
  let lockFd: number | undefined
  const run = (command: string, args: string[], input?: string, timeout = 30000): string => {
    const result = spawnSync(command, args, {
      env: cleanEnv,
      cwd: '/',
      input,
      timeout,
      maxBuffer: 65536,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe', ...(lockFd === undefined ? [] : [lockFd])]
    })
    if (result.error || result.status !== 0) return fail('COMMAND_FAILED')
    return result.stdout
  }
  const safeFile = (file: string, cap: number, owner = 0): Buffer =>
    readReleaseFile(file, cap, false, owner)
  const syncDirectory = (directory: string): void => {
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
  const atomic = (file: string, bytes: Buffer, mode: number, replace = false): void => {
    if (!replace && present(file)) {
      if (
        !safeFile(file, bytes.length + 1).equals(bytes) ||
        (lstatSync(file).mode & 0o777) !== mode
      )
        return fail('CONFLICT')
      return
    }
    const temporary = file + '.installing-' + request.request_key
    if (present(temporary)) {
      safeFile(temporary, Math.max(bytes.length, limits.node))
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
    if (replace && present(file)) safeFile(file, 16384)
    renameSync(temporary, file)
    syncDirectory(dirname(file))
  }
  const ownedDirectory = (directory: string, mode: number, owner = 0): void => {
    const marker = Buffer.from(
      JSON.stringify({ format: 1, request_key: request.request_key }) + '\n'
    )
    const markerName = '.controller-installation'
    if (present(directory)) {
      assertReleaseDirectory(directory, owner)
      if (!safeFile(join(directory, markerName), 256, owner).equals(marker)) return fail('CONFLICT')
      return
    }
    assertReleaseDirectory(dirname(directory))
    const temporary = directory + '.installing-' + request.request_key
    if (!present(temporary)) mkdirSync(temporary, { mode: 0o700 })
    assertReleaseDirectory(temporary)
    if (readdirSync(temporary).some((name) => name !== markerName)) return fail('CONFLICT')
    atomic(join(temporary, markerName), marker, 0o600)
    chmodSync(temporary, mode)
    if (present(directory)) return fail('CONFLICT')
    renameSync(temporary, directory)
    syncDirectory(dirname(directory))
  }
  const account = (): { uid: number; gid: number } | null => {
    const result = spawnSync('/usr/bin/getent', ['passwd', paths.account], {
      encoding: 'utf8',
      env: cleanEnv,
      timeout: 5000,
      maxBuffer: 4096
    })
    if (result.status === 2) return null
    if (result.error || result.status !== 0) return fail('ACCOUNT_UNAVAILABLE')
    const parts = result.stdout.trim().split(':')
    const uid = Number(parts[2])
    const gid = Number(parts[3])
    if (
      parts.length !== 7 ||
      parts[0] !== paths.account ||
      parts[4] !== 'opspilot-install-' + request.request_key ||
      parts[5] !== paths.data ||
      parts[6] !== '/usr/sbin/nologin' ||
      !Number.isSafeInteger(uid) ||
      uid <= 0 ||
      !Number.isSafeInteger(gid) ||
      gid <= 0
    )
      return fail('ACCOUNT_CONFLICT')
    const group = run('/usr/bin/getent', ['group', paths.account]).trim().split(':')
    if (group[0] !== paths.account || Number(group[2]) !== gid || group[3])
      return fail('ACCOUNT_CONFLICT')
    return { uid, gid }
  }
  const unitState = (): Record<string, string> =>
    Object.fromEntries(
      run('/usr/bin/systemctl', [
        'show',
        paths.unit.split('/').at(-1)!,
        '--property=LoadState,ActiveState,SubState,MainPID,User,Group,FragmentPath,DropInPaths,UnitFileState'
      ])
        .trim()
        .split('\n')
        .map((line) => {
          const split = line.indexOf('=')
          return [line.slice(0, split), line.slice(split + 1)]
        })
    )
  let receipt: ControllerInstallationReceipt
  const persist = (phase: ControllerInstallationPhase): void => {
    receipt.phase = phase
    receipt.updated_at = new Date().toISOString()
    atomic(
      join(paths.state, 'receipt.json'),
      Buffer.from(JSON.stringify(receipt) + '\n'),
      0o600,
      true
    )
  }
  try {
    if (!present(paths.state)) {
      if (request.operation !== 'install') return fail('NOT_FOUND')
      // Chưa tạo namespace khi input candidate sai.
      verifyControllerRelease(request.release_directory, request.release_sha256)
      ownedDirectory(paths.state, 0o700)
    }
    assertReleaseDirectory(paths.state)
    if (lstatSync(paths.state).uid !== 0 || (lstatSync(paths.state).mode & 0o777) !== 0o700)
      return fail('CONFLICT')
    const namespace = JSON.parse(
      safeFile(join(paths.state, '.controller-installation'), 256).toString()
    )
    if (namespace.request_key !== request.request_key || namespace.format !== 1)
      return fail('CONFLICT')
    const lockPath = join(paths.state, 'operation.lock')
    if (!present(lockPath)) {
      // Không tạo inode lock mới sau khi intent đã tồn tại: process cũ có thể vẫn giữ inode cũ.
      if (request.operation !== 'install' || present(join(paths.state, 'receipt.json')))
        return fail('LOCK_UNAVAILABLE')
      writeFileSync(lockPath, '', { mode: 0o600, flag: 'wx' })
    }
    safeFile(lockPath, 0)
    lockFd = openSync(lockPath, constants.O_RDWR | constants.O_NOFOLLOW)
    const locked = spawnSync(
      '/usr/bin/flock',
      ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'],
      { env: cleanEnv, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe', lockFd] }
    )
    if (locked.status === 75) return fail('BUSY')
    if (locked.error || locked.status !== 0) return fail('LOCK_UNAVAILABLE')
    const receiptPath = join(paths.state, 'receipt.json')
    const existed = present(receiptPath)
    if (existed) {
      receipt = JSON.parse(safeFile(receiptPath, 16384).toString()) as ControllerInstallationReceipt
      if (
        Object.keys(receipt).sort().join(',') !==
          'controller_id,created_at,format,gid,payload_sha256,phase,release_sha256,request_key,source_directory,uid,updated_at' ||
        receipt.format !== 1 ||
        receipt.request_key !== request.request_key ||
        !pin(receipt.release_sha256) ||
        !pin(receipt.payload_sha256) ||
        !path(receipt.source_directory) ||
        !phases.includes(receipt.phase) ||
        ![receipt.uid, receipt.gid].every(
          (v) => v === null || (Number.isSafeInteger(v) && v > 0)
        ) ||
        !(receipt.controller_id === null || uuid(receipt.controller_id)) ||
        (receipt.uid === null) !== (receipt.gid === null) ||
        (phases.indexOf(receipt.phase) >= phases.indexOf('account_ready') &&
          receipt.uid === null) ||
        (phases.indexOf(receipt.phase) >= phases.indexOf('database_ready') &&
          receipt.controller_id === null)
      )
        return fail('RECEIPT_INVALID')
      if (
        request.operation !== 'inspect' &&
        (request.release_sha256 !== receipt.release_sha256 ||
          (request.operation === 'install' &&
            request.release_directory !== receipt.source_directory))
      )
        return fail('CONFLICT')
    } else {
      if (request.operation !== 'install') return fail('RECOVERY_REQUIRED')
      if (
        [paths.installation, paths.data, paths.unit, paths.unit + '.d'].some((p) => present(p)) ||
        account() ||
        unitState().LoadState !== 'not-found'
      )
        return fail('CONFLICT')
      const manifest = verifyControllerRelease(request.release_directory, request.release_sha256)
      const now = new Date().toISOString()
      receipt = {
        format: 1,
        request_key: request.request_key,
        release_sha256: request.release_sha256,
        source_directory: request.release_directory,
        payload_sha256: manifest.payload_sha256,
        phase: 'prepared',
        uid: null,
        gid: null,
        controller_id: null,
        created_at: now,
        updated_at: now
      }
      persist('prepared')
    }
    const runtime = join(paths.installation, 'runtime')
    const artifact = join(runtime, 'payload/control-plane.cjs')
    const node = join(runtime, 'node')
    const verifyRuntime = (): ReturnType<typeof verifyControllerRelease> => {
      const manifest = verifyControllerRelease(runtime, receipt.release_sha256, receipt.uid!)
      const directories = new Set([runtime])
      for (const entry of [...manifest.files, { path: 'release-manifest.json' }]) {
        const file = join(runtime, entry.path)
        if (lstatSync(file).uid !== receipt.uid) return fail('RUNTIME_OWNER_CHANGED')
        let parent = dirname(file)
        while (parent !== runtime) {
          directories.add(parent)
          parent = dirname(parent)
        }
      }
      for (const directory of directories) {
        const info = lstatSync(directory)
        if (info.uid !== receipt.uid || (info.mode & 0o777) !== 0o700)
          return fail('RUNTIME_OWNER_CHANGED')
      }
      return manifest
    }
    const asRuntime = (args: string[]): string => {
      if (receipt.uid === null || receipt.gid === null) return fail('ACCOUNT_UNAVAILABLE')
      verifyRuntime()
      return run('/usr/bin/setpriv', [
        '--reuid',
        String(receipt.uid),
        '--regid',
        String(receipt.gid),
        '--clear-groups',
        '--',
        node,
        ...args
      ])
    }
    const verifyPrivateData = (): void => {
      if (phases.indexOf(receipt.phase) < phases.indexOf('data_ready')) return
      assertReleaseDirectory(paths.data, receipt.uid!)
      const info = lstatSync(paths.data)
      const owner = JSON.parse(
        safeFile(join(paths.data, '.controller-installation'), 256, receipt.uid!).toString()
      )
      if (
        info.uid !== receipt.uid ||
        (info.mode & 0o777) !== 0o700 ||
        owner.format !== 1 ||
        owner.request_key !== receipt.request_key
      )
        return fail('DATA_RECOVERY_REQUIRED')
      if (phases.indexOf(receipt.phase) >= phases.indexOf('database_ready')) {
        const db = lstatSync(join(paths.data, 'opspilot.db'))
        const identity = JSON.parse(
          safeFile(
            join(paths.data, '.product-controller-initialized'),
            512,
            receipt.uid!
          ).toString()
        )
        if (
          !db.isFile() ||
          db.nlink !== 1 ||
          db.uid !== receipt.uid ||
          (db.mode & 0o777) !== 0o600 ||
          identity.format !== 1 ||
          identity.controller_id !== receipt.controller_id
        )
          return fail('DATA_RECOVERY_REQUIRED')
      }
      if (phases.indexOf(receipt.phase) >= phases.indexOf('key_ready')) {
        const file = join(paths.data, '.controller-runtime-key')
        if (!present(file)) return fail('DATA_RECOVERY_REQUIRED')
        const bytes = safeFile(file, 32, receipt.uid!)
        const keyInfo = lstatSync(file)
        const valid =
          bytes.length === 32 && keyInfo.uid === receipt.uid && (keyInfo.mode & 0o777) === 0o600
        bytes.fill(0)
        if (!valid) return fail('DATA_RECOVERY_REQUIRED')
      }
    }
    const currentResult = async (): Promise<ControllerInstallationResult> => {
      let state: ControllerInstallationResult['service_state'] = 'not_installed'
      let enabled = false
      if (receipt.uid !== null) {
        const current = account()
        if (!current || current.uid !== receipt.uid || current.gid !== receipt.gid)
          return fail('ACCOUNT_CONFLICT')
      }
      if (phases.indexOf(receipt.phase) >= phases.indexOf('runtime_ready')) verifyRuntime()
      verifyPrivateData()
      if (present(paths.unit)) {
        if (
          !safeFile(paths.unit, 8192).equals(
            Buffer.from(renderControllerUnit(paths, request.request_key))
          )
        )
          return fail('CONFLICT')
        const info = unitState()
        enabled = info.UnitFileState === 'enabled'
        if (
          info.LoadState !== 'loaded' ||
          info.FragmentPath !== paths.unit ||
          info.DropInPaths ||
          info.User !== paths.account ||
          info.Group !== paths.account
        )
          return fail('CONFLICT')
        state =
          info.ActiveState === 'active'
            ? 'starting'
            : info.ActiveState === 'failed'
              ? 'failed'
              : 'stopped'
        if (state === 'starting' && (await isReady(Number(info.MainPID)))) state = 'running'
      }
      return {
        format: 1,
        request_key: receipt.request_key,
        phase: receipt.phase,
        controller_id: receipt.controller_id,
        service_state: state,
        runtime_uid: receipt.uid,
        service_enabled: enabled,
        artifact_path: artifact,
        node_path: node,
        data_directory: paths.data,
        payload_sha256: receipt.payload_sha256
      }
    }
    const isReady = async (pid: number): Promise<boolean> => {
      try {
        if (!Number.isSafeInteger(pid) || pid <= 0) return false
        const processStatus = readProc(`/proc/${pid}/status`, 65536).toString('utf8')
        if (Number(processStatus.match(/^Uid:\s+(\d+)/m)?.[1]) !== receipt.uid) return false
        const command = readProc(`/proc/${pid}/cmdline`, 65536)
          .toString()
          .split('\0')
          .filter(Boolean)
        if (
          command.join('\n') !==
          [node, artifact, 'run-product', '--data-dir', paths.data].join('\n')
        )
          return false
        const sockets = readProc('/proc/net/tcp', 2 * 1024 * 1024)
          .toString('utf8')
          .split('\n')
          .map((line) => line.trim().split(/\s+/))
          .filter((parts) => parts[1] === '0100007F:2240' && parts[3] === '0A')
          .map((parts) => `socket:[${parts[9]}]`)
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
        const signal = AbortSignal.timeout(1000)
        const response = await fetch('http://127.0.0.1:8768/healthz', { signal, redirect: 'error' })
        if (response.status !== 200 || Number(response.headers.get('content-length')) > 4096)
          return false
        if (!response.body) return false
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
        const parsed = JSON.parse(body.toString('utf8'))
        return parsed.api_version === 'v1' && parsed.service_state === 'ready'
      } catch {
        return false
      }
    }
    if (
      request.operation === 'inspect' ||
      (existed && request.operation === 'install') ||
      receipt.phase === 'installed'
    )
      return await currentResult()
    const hasRuntime = phases.indexOf(receipt.phase) >= phases.indexOf('runtime_ready')
    const manifest = hasRuntime
      ? verifyRuntime()
      : verifyControllerRelease(receipt.source_directory, receipt.release_sha256)
    const glibc = (process.report.getReport() as { header: { glibcVersionRuntime?: string } })
      .header.glibcVersionRuntime
    const currentGlibc = glibc?.split('.').map(Number)
    const minimum = manifest.minimum_glibc.split('.').map(Number)
    if (
      !currentGlibc ||
      currentGlibc[0] < minimum[0] ||
      (currentGlibc[0] === minimum[0] && currentGlibc[1] < minimum[1]) ||
      !present('/run/systemd/system')
    )
      return fail('HOST_UNSUPPORTED')
    const disk = statfsSync(dirname(paths.data))
    const memory =
      Number(
        readProc('/proc/meminfo', 65536)
          .toString('utf8')
          .match(/^MemAvailable:\s+(\d+)/m)?.[1]
      ) * 1024
    if (disk.bavail * disk.bsize <= 2 * 1024 ** 3 || memory <= 512 * 1024 ** 2)
      return fail('RESOURCES')
    if (!Number.isFinite(memory)) return fail('RESOURCES')
    if (phases.indexOf(receipt.phase) < phases.indexOf('start_pending'))
      await assertControllerPortFree()
    const step = (
      pending: ControllerInstallationPhase,
      ready: ControllerInstallationPhase,
      action: () => void
    ): void => {
      if (phases.indexOf(receipt.phase) >= phases.indexOf(ready)) return
      persist(pending)
      action()
      hooks.afterEffect?.(pending)
      persist(ready)
    }
    step('account_pending', 'account_ready', () => {
      let current = account()
      if (!current) {
        run('/usr/sbin/useradd', [
          '--system',
          '--user-group',
          '--no-create-home',
          '--home-dir',
          paths.data,
          '--shell',
          '/usr/sbin/nologin',
          '--comment',
          'opspilot-install-' + request.request_key,
          paths.account
        ])
        current = account()
      }
      if (!current) return fail('ACCOUNT_UNAVAILABLE')
      receipt.uid = current.uid
      receipt.gid = current.gid
    })
    // Luôn kiểm lại account trước tiếp tục từ durable phase.
    const current = account()
    if (!current || current.uid !== receipt.uid || current.gid !== receipt.gid)
      return fail('ACCOUNT_CONFLICT')
    step('runtime_pending', 'runtime_ready', () => {
      ownedDirectory(paths.installation, 0o755)
      if (!present(runtime)) mkdirSync(runtime, { mode: 0o700 })
      assertReleaseDirectory(runtime, receipt.uid!)
      const files = [
        ...manifest.files,
        {
          path: 'release-manifest.json',
          size: limits.manifest,
          sha256: receipt.release_sha256,
          mode: 0o600
        }
      ]
      for (const entry of files) {
        const destination = join(runtime, entry.path)
        const relativeParents = entry.path.split('/').slice(0, -1)
        let parent = runtime
        for (const name of relativeParents) {
          parent = join(parent, name)
          if (!present(parent)) mkdirSync(parent, { mode: 0o700 })
          assertReleaseDirectory(parent, receipt.uid!)
        }
        const bytes = safeFile(
          join(receipt.source_directory, entry.path),
          entry.path === 'node'
            ? limits.node
            : entry.path === 'release-manifest.json'
              ? limits.manifest
              : limits.file
        )
        if (releaseSha256(bytes) !== entry.sha256) return fail('RELEASE_CHANGED')
        if (present(destination)) {
          if (
            !safeFile(destination, bytes.length, receipt.uid!).equals(bytes) ||
            (lstatSync(destination).mode & 0o777) !== entry.mode
          )
            return fail('CONFLICT')
        } else atomic(destination, bytes, entry.mode)
      }
      verifyControllerRelease(runtime, receipt.release_sha256, receipt.uid!)
      const changeOwner = (directory: string): void => {
        for (const name of readdirSync(directory)) {
          const file = join(directory, name)
          const info = lstatSync(file)
          if (info.isSymbolicLink()) return fail('CONFLICT')
          if (info.isDirectory()) changeOwner(file)
          else {
            const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
            try {
              if (fstatSync(fd).nlink !== 1) return fail('CONFLICT')
              fchownSync(fd, receipt.uid!, receipt.gid!)
            } finally {
              closeSync(fd)
            }
          }
        }
        lchownSync(directory, receipt.uid!, receipt.gid!)
      }
      changeOwner(runtime)
      verifyRuntime()
    })
    step('data_pending', 'data_ready', () => {
      ownedDirectory(paths.data, 0o700, receipt.uid!)
      lchownSync(join(paths.data, '.controller-installation'), receipt.uid!, receipt.gid!)
      lchownSync(paths.data, receipt.uid!, receipt.gid!)
    })
    verifyPrivateData()
    const smoke = JSON.parse(
      asRuntime([
        '-e',
        "console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),groups:process.getgroups(),lock:require('node:fs').fstatSync(3).isFile(),node:process.versions.node,abi:process.versions.modules}))"
      ])
    )
    if (
      smoke.uid !== receipt.uid ||
      smoke.gid !== receipt.gid ||
      smoke.groups.some((gid: number) => gid === 0 || gid !== receipt.gid) ||
      smoke.lock !== true ||
      smoke.node !== manifest.node_version ||
      smoke.abi !== manifest.node_abi
    )
      return fail('RUNTIME_CHECK_FAILED')
    step('database_pending', 'database_ready', () => {
      const database = present(join(paths.data, 'opspilot.db'))
      const marker = present(join(paths.data, '.product-controller-initialized'))
      if (database !== marker) return fail('DATA_RECOVERY_REQUIRED')
      const result = JSON.parse(
        asRuntime([artifact, database ? 'status' : 'init', '--data-dir', paths.data])
      )
      if (
        !uuid(result.controller_id) ||
        (receipt.controller_id && receipt.controller_id !== result.controller_id)
      )
        return fail('IDENTITY_CONFLICT')
      receipt.controller_id = result.controller_id
    })
    step('key_pending', 'key_ready', () => {
      const key = join(paths.data, '.controller-runtime-key')
      if (!present(key)) asRuntime([artifact, 'secrets-init', '--data-dir', paths.data])
      const bytes = safeFile(key, 32, receipt.uid!)
      const info = lstatSync(key)
      if (bytes.length !== 32 || info.uid !== receipt.uid || (info.mode & 0o777) !== 0o600)
        return fail('DATA_RECOVERY_REQUIRED')
      bytes.fill(0)
    })
    step('unit_pending', 'unit_ready', () => {
      if (present(paths.unit + '.d')) return fail('CONFLICT')
      atomic(
        join(paths.installation, 'execution.json'),
        Buffer.from(
          JSON.stringify({ format: 1, artifact, manifest_sha256: manifest.payload_sha256 }) + '\n'
        ),
        0o600
      )
      atomic(paths.unit, Buffer.from(renderControllerUnit(paths, request.request_key)), 0o644)
      run('/usr/bin/systemctl', ['daemon-reload'])
    })
    if (receipt.phase !== 'start_pending') {
      await assertControllerPortFree()
      persist('start_pending')
    }
    const before = await currentResult()
    run('/usr/bin/systemctl', ['enable', paths.unit.split('/').at(-1)!])
    if (before.service_state !== 'running') {
      run('/usr/bin/systemctl', ['start', paths.unit.split('/').at(-1)!])
    }
    hooks.afterEffect?.('start_pending')
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      const result = await currentResult()
      if (result.service_state === 'running' && result.service_enabled) {
        persist('installed')
        return { ...result, phase: 'installed' }
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return fail('SERVICE_NOT_READY')
  } catch (error) {
    if (error instanceof Error && /^CONTROLLER_INSTALL_[A-Z_]+$/.test(error.message)) throw error
    return fail('UNAVAILABLE')
  } finally {
    if (lockFd !== undefined) closeSync(lockFd)
  }
}

async function assertControllerPortFree(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer()
    server.once('error', () => reject(Error('CONTROLLER_INSTALL_PORT_BUSY')))
    server.listen(8768, '127.0.0.1', () => server.close(() => resolve()))
  })
}
