import { execFile, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, realpathSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface SecretHandoffOptions {
  command: string
  args: string[]
  secret: string
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes: number
}

export interface SecretHandoffResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface ModelStateIsolationOptions {
  projectRoot: string
  labRoot: string
}

/** Copy only ML source modules into a private lab tree; never copy application state. */
export function prepareIsolatedMlService(options: ModelStateIsolationOptions): string {
  const source = join(options.projectRoot, 'ml-service')
  const target = join(options.labRoot, 'ml-service')
  mkdirSync(join(target, 'models'), { recursive: true })
  for (const name of ['main.py', 'config.py', 'features.py', 'store.py']) {
    copyFileSync(join(source, name), join(target, name))
  }
  for (const entry of readdirSync(join(source, 'models'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.py')) {
      copyFileSync(join(source, 'models', entry.name), join(target, 'models', entry.name))
    }
  }
  if (existsSync(join(target, 'state'))) throw new Error('LAB_STATE_DIRECTORY_MUST_START_ABSENT')
  return target
}

export function removeIsolatedMlService(labRoot: string): void {
  rmSync(join(labRoot, 'ml-service'), { recursive: true, force: true })
}

/** Remove only a launcher-created scratch directory located strictly below tempRoot. */
function verifiedScratchPath(scratchDirectory: string, tempRoot: string): string {
  const rootReal = realpathSync(tempRoot)
  const scratchReal = realpathSync(scratchDirectory)
  const rel = relative(rootReal, scratchReal)
  if (
    !rel ||
    rel === '.' ||
    rel.startsWith(`..${sep}`) ||
    rel === '..' ||
    isAbsolute(rel) ||
    dirname(scratchReal) !== rootReal ||
    !basename(scratchReal).startsWith('opspilot-ml-preflight-')
  ) {
    throw new Error('HANDOFF_SCRATCH_PATH_INVALID')
  }
  return scratchReal
}

export function removeLauncherScratchDirectory(scratchDirectory: string, tempRoot: string): void {
  const scratchReal = verifiedScratchPath(scratchDirectory, tempRoot)
  rmSync(scratchReal, { recursive: true, force: false })
}

export function resolveProfileClone(profilePath: string, tempRoot: string): string {
  const rootReal = realpathSync(tempRoot)
  const profileReal = realpathSync(profilePath)
  const rel = relative(rootReal, profileReal)
  if (!rel || rel === '.' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('HANDOFF_PROFILE_NOT_ISOLATED_CLONE')
  }
  return resolve(profileReal)
}

export function cleanupPreflightScratch(
  scratchDirectory: string | null,
  tempRoot: string,
  preflightExitCode: number
): { exitCode: number; cleanupFailed: boolean } {
  if (!scratchDirectory) return { exitCode: preflightExitCode, cleanupFailed: false }
  try {
    const verifiedPath = verifiedScratchPath(scratchDirectory, tempRoot)
    removeIsolatedMlService(verifiedPath)
    removeLauncherScratchDirectory(scratchDirectory, tempRoot)
    return { exitCode: preflightExitCode, cleanupFailed: false }
  } catch {
    return { exitCode: 3, cleanupFailed: true }
  }
}

/** Send a short-lived secret through stdin; never add it to args or environment. */
export function runSecretHandoff(options: SecretHandoffOptions): Promise<SecretHandoffResult> {
  return new Promise((resolveResult, rejectResult) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch {
      rejectResult(new Error('HANDOFF_SPAWN_FAILED'))
      return
    }
    const stdin = child.stdin
    const stdoutStream = child.stdout
    const stderrStream = child.stderr
    if (!stdin || !stdoutStream || !stderrStream) {
      child.kill()
      rejectResult(new Error('HANDOFF_PIPES_UNAVAILABLE'))
      return
    }

    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let timeoutReached = false
    let outputExceeded = false
    let spawnError = false
    let pipeFailure = false
    let deliveryFinished = false
    let settled = false
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      rejectResult(error)
    }
    const resolveOnce = (result: SecretHandoffResult): void => {
      if (settled) return
      settled = true
      resolveResult(result)
    }
    const timeout = setTimeout(() => {
      timeoutReached = true
      terminateProcessTree(child)
    }, options.timeoutMs)
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      outputBytes += chunk.length
      if (outputBytes > options.maxOutputBytes) {
        outputExceeded = true
        terminateProcessTree(child)
        return
      }
      if (target === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
    }
    stdoutStream.on('data', (chunk: Buffer) => collect('stdout', chunk))
    stderrStream.on('data', (chunk: Buffer) => collect('stderr', chunk))
    child.once('error', () => {
      spawnError = true
    })
    stdin.once('error', () => {
      pipeFailure = true
      terminateProcessTree(child)
    })
    stdin.once('close', () => {
      if (!deliveryFinished) {
        pipeFailure = true
        terminateProcessTree(child)
      }
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      if (timeoutReached) rejectOnce(new Error('HANDOFF_TIMEOUT'))
      else if (outputExceeded) rejectOnce(new Error('HANDOFF_OUTPUT_LIMIT'))
      else if (spawnError) rejectOnce(new Error('HANDOFF_SPAWN_FAILED'))
      else if (pipeFailure || !deliveryFinished) rejectOnce(new Error('HANDOFF_STDIN_FAILED'))
      else resolveOnce({ exitCode: code ?? 1, stdout, stderr })
    })
    stdin.end(options.secret, 'utf8', () => {
      deliveryFinished = true
    })
  })
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32' && child.pid) {
    execFile(
      'taskkill.exe',
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true },
      () => undefined
    )
  } else {
    child.kill('SIGKILL')
  }
}
