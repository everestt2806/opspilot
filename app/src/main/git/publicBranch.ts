import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

import { canonicalizeGitHubUrl, sanitizedGitEnvironment, validateRef } from './snapshot'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_OUTPUT_BYTES = 16 * 1024
const KILL_GRACE_MS = 1_000

export type PublicBranchTip = { state: 'found'; sha: string } | { state: 'missing' }

export type PublicBranchErrorCode =
  | 'GIT_INVALID_REPOSITORY'
  | 'GIT_INVALID_BRANCH'
  | 'GIT_TIMEOUT'
  | 'GIT_CANCELLED'
  | 'GIT_OUTPUT_LIMIT'
  | 'GIT_UNAVAILABLE'
  | 'GIT_TEMP_DIRECTORY_INVALID'
  | 'GIT_TEMP_CLEANUP_FAILED'
  | 'GIT_REMOTE_ERROR'
  | 'GIT_INVALID_RESPONSE'

export class PublicBranchQueryError extends Error {
  constructor(readonly code: PublicBranchErrorCode) {
    super(code)
    this.name = 'PublicBranchQueryError'
  }
}

export interface PublicBranchQueryInput {
  repositoryUrl: string
  branch: string
  signal?: AbortSignal
  timeoutMs?: number
}

/** Read one exact public GitHub branch ref without cloning or modifying a worktree. */
export function queryPublicGitHubBranchTip(
  input: PublicBranchQueryInput
): Promise<PublicBranchTip> {
  let repositoryUrl: string
  try {
    repositoryUrl = canonicalizeGitHubUrl(input.repositoryUrl)
  } catch {
    throw new PublicBranchQueryError('GIT_INVALID_REPOSITORY')
  }

  if (!isBranchName(input.branch)) throw new PublicBranchQueryError('GIT_INVALID_BRANCH')
  try {
    validateRef(input.branch)
  } catch {
    throw new PublicBranchQueryError('GIT_INVALID_BRANCH')
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new PublicBranchQueryError('GIT_TIMEOUT')
  }
  if (input.signal?.aborted) return Promise.reject(new PublicBranchQueryError('GIT_CANCELLED'))

  return runLsRemote(repositoryUrl, input.branch, timeoutMs, input.signal)
}

function isBranchName(value: string): boolean {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('refs/') ||
    value.includes('\\') ||
    value.includes('//') ||
    [...value].some((character) => character.charCodeAt(0) <= 0x20 || '~^:?*[]'.includes(character))
  ) {
    return false
  }
  const components = value.split('/')
  return components.every(
    (part) =>
      part.length > 0 && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock')
  )
}

function runLsRemote(
  repositoryUrl: string,
  branch: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<PublicBranchTip> {
  let workingDirectory: string
  try {
    workingDirectory = createGitWorkingDirectory()
  } catch (error) {
    return Promise.reject(
      error instanceof PublicBranchQueryError
        ? error
        : new PublicBranchQueryError('GIT_TEMP_DIRECTORY_INVALID')
    )
  }

  return new Promise((resolve, reject) => {
    const args = [
      '-c',
      'credential.helper=',
      'ls-remote',
      '--exit-code',
      '--refs',
      repositoryUrl,
      `refs/heads/${branch}`
    ]
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('git', args, {
        cwd: workingDirectory,
        shell: false,
        windowsHide: true,
        env: publicGitEnvironment(workingDirectory),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      reject(cleanupFailure(workingDirectory) ?? new PublicBranchQueryError('GIT_UNAVAILABLE'))
      return
    }

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let termination: PublicBranchErrorCode | null = null
    let settled = false
    let killTimer: NodeJS.Timeout | undefined

    const finish = (error?: PublicBranchErrorCode, result?: PublicBranchTip): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener('abort', abort)
      const cleanupError = cleanupFailure(workingDirectory)
      if (cleanupError) reject(cleanupError)
      else if (error) reject(new PublicBranchQueryError(error))
      else if (result) resolve(result)
      else reject(new PublicBranchQueryError('GIT_INVALID_RESPONSE'))
    }

    const terminate = (code: PublicBranchErrorCode): void => {
      if (settled || termination) return
      termination = code
      try {
        child.kill('SIGTERM')
      } catch {
        // Keep waiting for close; the escalation timer will try SIGKILL.
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Do not report completion or remove cwd until the child closes.
        }
      }, KILL_GRACE_MS)
      killTimer.unref()
    }

    const abort = (): void => terminate('GIT_CANCELLED')
    const timeoutTimer = setTimeout(() => terminate('GIT_TIMEOUT'), timeoutMs)
    timeoutTimer.unref()
    signal?.addEventListener('abort', abort, { once: true })

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      stdoutBytes += bytes.length
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        terminate('GIT_OUTPUT_LIMIT')
        return
      }
      stdout.push(bytes)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      stderrBytes += bytes.length
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        terminate('GIT_OUTPUT_LIMIT')
        return
      }
      stderr.push(bytes)
    })
    child.on('error', () => {
      if (child.pid === undefined) finish(termination ?? 'GIT_UNAVAILABLE')
      else if (!termination) terminate('GIT_UNAVAILABLE')
    })
    child.once('close', (code) => {
      if (termination) {
        finish(termination)
        return
      }
      const out = Buffer.concat(stdout).toString('ascii').trim()
      const err = Buffer.concat(stderr).toString('utf8').trim()
      if (out.length === 0 && (code === 0 || (code === 2 && err.length === 0))) {
        finish(undefined, { state: 'missing' })
        return
      }
      if (code !== 0) {
        finish('GIT_REMOTE_ERROR')
        return
      }
      const lines = out.split(/\r?\n/)
      if (lines.length !== 1) {
        finish('GIT_INVALID_RESPONSE')
        return
      }
      const match = /^([a-f0-9]{40})\trefs\/heads\/(.+)$/.exec(lines[0])
      if (!match || match[2] !== branch) {
        finish('GIT_INVALID_RESPONSE')
        return
      }
      finish(undefined, { state: 'found', sha: match[1] })
    })
  })
}

function publicGitEnvironment(workingDirectory: string): NodeJS.ProcessEnv {
  const safeEnvironment = Object.fromEntries(
    Object.entries(sanitizedGitEnvironment()).filter(
      ([key]) => !/(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY)/i.test(key)
    )
  )
  return {
    ...safeEnvironment,
    GIT_CEILING_DIRECTORIES: workingDirectory,
    GIT_DISCOVERY_ACROSS_FILESYSTEM: '0',
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_PROTOCOL_FROM_USER: '0'
  }
}

function createGitWorkingDirectory(): string {
  let createdDirectory: string | null = null
  try {
    createdDirectory = mkdtempSync(join(tmpdir(), 'opspilot-public-git-'))
    const workingDirectory = realpathSync(createdDirectory)
    const repositoryRoot = findGitRepositoryRoot(process.cwd())
    if (repositoryRoot && isPathInside(repositoryRoot, workingDirectory)) {
      throw new PublicBranchQueryError('GIT_TEMP_DIRECTORY_INVALID')
    }
    return workingDirectory
  } catch (error) {
    if (createdDirectory) {
      const cleanupError = cleanupFailure(createdDirectory)
      if (cleanupError) throw cleanupError
    }
    if (error instanceof PublicBranchQueryError) throw error
    throw new PublicBranchQueryError('GIT_TEMP_DIRECTORY_INVALID')
  }
}

function findGitRepositoryRoot(startDirectory: string): string | null {
  let current = realpathSync(startDirectory)
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function isPathInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate)
  return (
    pathFromParent === '' ||
    (pathFromParent !== '..' &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent))
  )
}

function cleanupFailure(workingDirectory: string): PublicBranchQueryError | null {
  try {
    rmSync(workingDirectory, { recursive: true, force: false })
    return null
  } catch {
    return new PublicBranchQueryError('GIT_TEMP_CLEANUP_FAILED')
  }
}
