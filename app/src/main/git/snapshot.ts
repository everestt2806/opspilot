import { spawn } from 'node:child_process'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { signalChildProcessTree } from './processTree'

export interface GitSnapshotInput {
  repositoryUrl: string
  ref: string
  /** When supplied, fetch and checkout this exact full commit SHA; never follow the ref tip. */
  targetSha?: string
  root?: string
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
  tempDirectory?: string
}

export interface GitSnapshot {
  repositoryUrl: string
  commitSha: string
  rootDirectory: string
  snapshotDirectory: string
  cleanup(): void
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024
const PROCESS_KILL_GRACE_MS = 1_000
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024

export function sanitizedGitEnvironment(): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^GIT_/i.test(key) && !/(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY)/i.test(key)
    )
  )
  const nullConfig = process.platform === 'win32' ? 'NUL' : '/dev/null'
  return {
    ...inherited,
    GIT_CONFIG_GLOBAL: nullConfig,
    GIT_CONFIG_SYSTEM: nullConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_LFS_SKIP_SMUDGE: '1'
  }
}

function gitFailureMessage(stderr: string, code: number | null): string {
  if (
    /could not read Username|authentication failed|repository not found|HTTP 40[13]/i.test(stderr)
  ) {
    return 'Repository GitHub không truy cập được qua HTTPS công khai; kiểm tra URL và trạng thái public.'
  }
  if (/couldn't find remote ref|not our ref|unknown revision|invalid ref/i.test(stderr)) {
    return 'Git ref không tồn tại hoặc không thể lấy từ repository.'
  }
  if (
    /could not resolve host|failed to connect|connection timed out|network is unreachable|SSL certificate/i.test(
      stderr
    )
  ) {
    return 'Không thể kết nối GitHub qua HTTPS để lấy snapshot.'
  }
  return `Lệnh Git thất bại khi lấy snapshot (mã ${code ?? 'không xác định'}).`
}

export function canonicalizeGitHubUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('URL Git không hợp lệ; cần repository GitHub công khai qua HTTPS.')
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 2 ||
    !/^[A-Za-z0-9_.-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_.-]+$/.test(parts[1].replace(/\.git$/i, ''))
  ) {
    throw new Error('Chỉ hỗ trợ repository GitHub công khai qua HTTPS, không kèm credential.')
  }
  const owner = parts[0]
  const repository = parts[1].replace(/\.git$/i, '')
  if (owner === '.' || owner === '..' || repository === '.' || repository === '..') {
    throw new Error('URL repository GitHub không hợp lệ.')
  }
  return `https://github.com/${owner}/${repository}.git`
}

export function validateRef(ref: string): void {
  if (
    !ref ||
    ref.startsWith('-') ||
    ref.startsWith('/') ||
    ref.endsWith('/') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)
  ) {
    throw new Error('Git ref không hợp lệ.')
  }
}

function getDirectoryBytes(path: string): number {
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    const info = lstatSync(child)
    if (info.isSymbolicLink()) continue
    if (info.isDirectory()) total += getDirectoryBytes(child)
    else if (info.isFile()) total += info.size
  }
  return total
}

function runGit(
  args: string[],
  cwd: string,
  options: Required<Pick<GitSnapshotInput, 'timeoutMs' | 'maxBytes'>> &
    Pick<GitSnapshotInput, 'signal'>
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    if (options.signal?.aborted) return reject(new Error('Đã hủy lấy snapshot Git.'))
    const child = spawn('git', args, {
      cwd,
      detached: process.platform === 'linux',
      shell: false,
      windowsHide: true,
      env: sanitizedGitEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false
    let terminationError: Error | null = null
    let killTimer: NodeJS.Timeout | undefined
    let killEscalated = false
    let closed = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(sizeTimer)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolvePromise(stdout.trim())
    }
    const abort = (): void => {
      terminate(new Error('Đã hủy lấy snapshot Git.'))
    }
    const terminate = (error: Error): void => {
      if (settled || terminationError) return
      terminationError = error
      clearTimeout(timer)
      clearInterval(sizeTimer)
      signalChildProcessTree(child, 'SIGTERM')
      killTimer = setTimeout(() => {
        signalChildProcessTree(child, 'SIGKILL')
        killEscalated = true
        if (closed) finish(terminationError ?? error)
      }, PROCESS_KILL_GRACE_MS)
      killTimer.unref()
    }
    const timer = setTimeout(
      () => terminate(new Error('Lấy snapshot Git quá thời gian cho phép.')),
      options.timeoutMs
    )
    const sizeTimer = setInterval(() => {
      try {
        if (getDirectoryBytes(cwd) > options.maxBytes) {
          terminate(new Error('Snapshot Git vượt quá giới hạn dung lượng.'))
        }
      } catch {
        // The checkout can be changing while Git creates pack/index files.
      }
    }, 500)
    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk)
      if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
        terminate(new Error('Snapshot Git vượt quá giới hạn output.'))
        return
      }
      stdout = (stdout + chunk).slice(-16_384)
    })
    child.stderr.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk)
      if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
        terminate(new Error('Snapshot Git vượt quá giới hạn output.'))
        return
      }
      stderr = (stderr + chunk).slice(-16_384)
    })
    child.on('error', () => {
      if (child.pid === undefined) finish(new Error('Không thể chạy Git để lấy snapshot.'))
      else if (!terminationError) terminate(new Error('Không thể chạy Git để lấy snapshot.'))
    })
    child.on('close', (code) => {
      closed = true
      if (terminationError) {
        if (killEscalated) finish(terminationError)
      } else if (code === 0) finish()
      else finish(new Error(gitFailureMessage(stderr, code)))
    })
  })
}

export function resolveSnapshotRoot(snapshotDirectory: string, requestedRoot = '.'): string {
  if (
    !requestedRoot ||
    requestedRoot.includes('\0') ||
    requestedRoot.startsWith('/') ||
    /^[A-Za-z]:/.test(requestedRoot)
  ) {
    throw new Error('Git root phải là đường dẫn tương đối bên trong repository.')
  }
  const segments = requestedRoot
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part && part !== '.')
  if (segments.some((part) => part === '..')) {
    throw new Error('Git root không được thoát khỏi snapshot.')
  }
  let cursor = snapshotDirectory
  for (const segment of segments) {
    cursor = join(cursor, segment)
    let info
    try {
      info = lstatSync(cursor)
    } catch {
      throw new Error('Git root không tồn tại trong snapshot.')
    }
    if (info.isSymbolicLink()) throw new Error('Git root không được đi qua symbolic link.')
  }
  const realRoot = realpathSync(cursor)
  if (realRoot !== snapshotDirectory && !realRoot.startsWith(snapshotDirectory + sep)) {
    throw new Error('Git root không được thoát khỏi snapshot.')
  }
  if (!statSync(realRoot).isDirectory()) throw new Error('Git root phải là thư mục.')
  return realRoot
}

/** Resolve once, fetch into an isolated checkout, and return a detached full-SHA snapshot. */
async function snapshotRemote(
  input: GitSnapshotInput,
  repositoryUrl: string,
  allowFileProtocol: boolean
): Promise<GitSnapshot> {
  validateRef(input.ref)
  if (input.targetSha !== undefined && !/^[a-f0-9]{40}$/.test(input.targetSha)) {
    throw new Error('Git target sha phải là full commit SHA hợp lệ.')
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  ) {
    throw new Error('Giới hạn snapshot không hợp lệ.')
  }
  const snapshotDirectory = mkdtempSync(join(input.tempDirectory ?? tmpdir(), 'opspilot-git-'))
  const templateDirectory = join(snapshotDirectory, '.empty-git-template')
  try {
    const runOptions = { timeoutMs, maxBytes, signal: input.signal }
    mkdirSync(templateDirectory)
    await runGit(
      ['init', '--quiet', `--template=${templateDirectory}`],
      snapshotDirectory,
      runOptions
    )
    rmSync(templateDirectory, { recursive: true, force: true })
    await runGit(
      ['-c', 'credential.helper=', 'remote', 'add', 'origin', repositoryUrl],
      snapshotDirectory,
      runOptions
    )
    await runGit(
      [
        '-c',
        'credential.helper=',
        '-c',
        'protocol.allow=never',
        '-c',
        'protocol.https.allow=always',
        '-c',
        `protocol.file.allow=${allowFileProtocol ? 'always' : 'never'}`,
        '-c',
        'protocol.ext.allow=never',
        'fetch',
        '--depth=1',
        '--no-recurse-submodules',
        'origin',
        input.targetSha ?? input.ref
      ],
      snapshotDirectory,
      runOptions
    )
    const commitSha = await runGit(
      ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
      snapshotDirectory,
      runOptions
    )
    if (!/^[a-f0-9]{40}$/.test(commitSha))
      throw new Error('Git không trả về full commit SHA hợp lệ.')
    if (input.targetSha && commitSha !== input.targetSha) {
      throw new Error('Git snapshot không khớp full SHA đã yêu cầu.')
    }
    await runGit(
      [
        '-c',
        'credential.helper=',
        'checkout',
        '--quiet',
        '--detach',
        '--no-recurse-submodules',
        commitSha
      ],
      snapshotDirectory,
      runOptions
    )
    const checkedOutSha = await runGit(
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      snapshotDirectory,
      runOptions
    )
    if (checkedOutSha !== commitSha) throw new Error('Git checkout không khớp full SHA đã tải.')
    if (getDirectoryBytes(snapshotDirectory) > maxBytes)
      throw new Error('Snapshot Git vượt quá giới hạn dung lượng.')
    const rootDirectory = resolveSnapshotRoot(snapshotDirectory, input.root)
    let cleaned = false
    return {
      repositoryUrl,
      commitSha,
      rootDirectory,
      snapshotDirectory,
      cleanup: () => {
        if (cleaned) return
        const realDirectory = realpathSync(snapshotDirectory)
        const realParent = realpathSync(input.tempDirectory ?? tmpdir())
        if (!realDirectory.startsWith(realParent + sep)) {
          throw new Error('Git snapshot cleanup path không thuộc scratch đã tạo.')
        }
        rmSync(realDirectory, { recursive: true, force: true })
        cleaned = true
      }
    }
  } catch (error) {
    rmSync(snapshotDirectory, { recursive: true, force: true })
    throw error
  }
}

export function createGitSnapshot(input: GitSnapshotInput): Promise<GitSnapshot> {
  return snapshotRemote(input, canonicalizeGitHubUrl(input.repositoryUrl), false)
}

/** Local file transport for deterministic repository fixtures; never used by the app entry point. */
export function createGitSnapshotFromLocalFixture(input: GitSnapshotInput): Promise<GitSnapshot> {
  const repositoryUrl = input.repositoryUrl.startsWith('file:')
    ? input.repositoryUrl
    : pathToFileURL(input.repositoryUrl).toString()
  return snapshotRemote(input, repositoryUrl, true)
}
