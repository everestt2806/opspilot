import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

import {
  prepareIsolatedMlService,
  removeIsolatedMlService
} from '../src/main/crypto/credentialHandoff'

const ROOT = resolve(__dirname, '../../..')
const EVIDENCE = join(ROOT, 'docs/evidence/tk-s7-ml-ready-6')
const DATA = join(ROOT, 'docs/demo-11-10/ml-samples-v5-180.csv')
const PORT = 18765
const DEPLOYMENT_ID = 7
const METHODS = ['zscore_ewma', 'iforest', 'ocsvm', 'ensemble'] as const
const METRICS = ['cpu_pct', 'mem_mb', 'latency_ms', 'http_error_rate', 'db_response_ms'] as const
const PYTHON = join(ROOT, 'ml-service/.venv/Scripts/python.exe')

type Sample = Record<string, string | number>
type ScoreSet = Record<(typeof METHODS)[number], number | null>

export async function assertLoopbackPortAvailable(port: number): Promise<void> {
  const server = createServer()
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', () => rejectListen(new Error('EXPLICIT_LOOPBACK_PORT_BUSY')))
    server.listen(port, '127.0.0.1', () => resolveListen())
  })
  await new Promise<void>((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  )
}

async function listenerPids(port: number): Promise<number[]> {
  if (process.platform !== 'win32') throw new Error('LISTENER_OWNER_CHECK_UNSUPPORTED')
  const output = await new Promise<string>((resolveOutput, rejectOutput) => {
    execFile(
      'netstat.exe',
      ['-ano', '-p', 'tcp'],
      { windowsHide: true, timeout: 2_000, maxBuffer: 256 * 1024 },
      (error, stdout) =>
        error ? rejectOutput(new Error('LISTENER_QUERY_FAILED')) : resolveOutput(stdout)
    )
  })
  const pids: number[] = []
  const endpoint = new RegExp(
    `^\\s*TCP\\s+127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`,
    'i'
  )
  for (const line of output.split(/\r?\n/)) {
    const match = endpoint.exec(line)
    if (match) pids.push(Number(match[1]))
  }
  return pids
}

async function isDescendantOf(rootPid: number, processPid: number): Promise<boolean> {
  const script = `$root=${rootPid};$target=${processPid};$rows=Get-CimInstance Win32_Process;$parents=@{};foreach($row in $rows){$parents[[int]$row.ProcessId]=[int]$row.ParentProcessId};$current=$target;for($i=0;$i -lt 64;$i++){if($current -eq $root){Write-Output 'OWNED';exit 0};if(!$parents.ContainsKey($current)){break};$current=$parents[$current]};Write-Output 'NOT_OWNED';exit 1`
  return await new Promise<boolean>((resolveOwned) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 3_000, maxBuffer: 512 * 1024 },
      (error, stdout) => resolveOwned(!error && stdout.trim() === 'OWNED')
    )
  })
}

export function validScoreSet(scores: ScoreSet): boolean {
  return METHODS.every((method) => {
    const value = scores[method]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
  })
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function treeSnapshot(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const result: Record<string, string> = {}
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile())
        result[relative(path, absolute).replaceAll(sep, '/')] = sha256(absolute)
    }
  }
  visit(path)
  return result
}

function readSamples(): Sample[] {
  const lines = readFileSync(DATA, 'utf8')
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split(/\r?\n/)
  const headers = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const values = line.split(',')
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]))
  })
}

function apiSample(row: Sample): Record<string, string | number> {
  const result: Record<string, string | number> = {
    ts: String(row.ts),
    seq: Number(row.seq),
    container_up: Number(row.container_up)
  }
  for (const metric of METRICS) result[metric] = Number(row[metric])
  return result
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      ...init,
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', ...init?.headers }
    })
  } catch {
    throw new Error('HTTP_CONNECT_FAILED')
  }
  if (!response.ok) throw new Error(`HTTP_API_FAILED_${response.status}_${path}`)
  return (await response.json()) as Record<string, unknown>
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/(secret|password|credential|token|private.?key)/i.test(key)) delete env[key]
  }
  return env
}

export interface StopOwnedChildOptions {
  port: number
  timeoutMs?: number
  terminateTree?: (child: ChildProcess, timeoutMs: number) => Promise<void>
  listenerPids?: (port: number) => Promise<number[]>
}

async function defaultTerminateTree(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (!child.pid) throw new Error('OWNED_CHILD_PID_MISSING')
  if (process.platform === 'win32') {
    await new Promise<void>((resolveKill, rejectKill) =>
      execFile(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: timeoutMs },
        (error) => (error ? rejectKill(new Error('TASKKILL_FAILED')) : resolveKill())
      )
    )
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    throw new Error('PROCESS_TREE_KILL_FAILED')
  }
}

export async function stopOwnedChild(
  child: ChildProcess,
  options: StopOwnedChildOptions
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const getListenerPids = options.listenerPids ?? listenerPids
  const terminateTree = options.terminateTree ?? defaultTerminateTree
  const errors: string[] = []
  const deadline = Date.now() + timeoutMs

  if (child.exitCode === null && child.signalCode === null) {
    const remaining = Math.max(1, deadline - Date.now())
    try {
      await terminateTree(child, remaining)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'PROCESS_TREE_KILL_FAILED')
      try {
        if (process.platform === 'win32') {
          if (!child.kill('SIGKILL')) errors.push('PROCESS_TREE_FALLBACK_KILL_FAILED')
        } else if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        errors.push('PROCESS_TREE_FALLBACK_KILL_FAILED')
      }
    }
  }

  let stopped = false
  while (Date.now() < deadline) {
    const childExited = child.exitCode !== null || child.signalCode !== null
    let noListener = false
    try {
      noListener = (await getListenerPids(options.port)).length === 0
    } catch {
      errors.push('LISTENER_QUERY_FAILED')
      break
    }
    if (childExited && noListener) {
      stopped = true
      break
    }
    await delay(Math.min(50, Math.max(1, deadline - Date.now())))
  }

  if (!stopped) {
    errors.push('OWNED_PROCESS_TREE_STOP_DEADLINE_EXCEEDED')
    try {
      if (process.platform === 'win32') {
        if (!child.kill('SIGKILL')) errors.push('PROCESS_TREE_FALLBACK_KILL_FAILED')
      } else if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {
      errors.push('PROCESS_TREE_FALLBACK_KILL_FAILED')
    }
    const cleanupDeadline = Date.now() + 1_500
    while (Date.now() < cleanupDeadline) {
      let noListener = false
      try {
        noListener = (await getListenerPids(options.port)).length === 0
      } catch {
        errors.push('LISTENER_QUERY_FAILED')
        break
      }
      if ((child.exitCode !== null || child.signalCode !== null) && noListener) break
      await delay(50)
    }
  }
  if (errors.length) throw new Error(`SERVICE_CLEANUP_FAILED:${[...new Set(errors)].join(',')}`)
}

export interface LifecycleExecution<T> {
  value: T | null
  primaryError: string | null
  cleanupErrors: string[]
}

export function lifecycleCanPass<T>(
  execution: LifecycleExecution<T>,
  checks: Record<string, boolean>
): boolean {
  return (
    execution.primaryError === null &&
    execution.cleanupErrors.length === 0 &&
    execution.value !== null &&
    Object.values(checks).every(Boolean)
  )
}

export function removeOwnedScratch(
  scratchPath: string,
  expectedPath: string,
  tempRoot: string,
  remove: (path: string) => void = (path) => rmSync(path, { recursive: true, force: false })
): void {
  const current = realpathSync(scratchPath)
  const tempReal = realpathSync(tempRoot)
  if (
    current !== expectedPath ||
    !current.startsWith(`${tempReal}${sep}`) ||
    !current.split(sep).at(-1)?.startsWith('opspilot-ml-ready-6-')
  ) {
    throw new Error('SCRATCH_CLEANUP_PATH_REJECTED')
  }
  remove(current)
  if (existsSync(current)) throw new Error('SCRATCH_CLEANUP_FAILED')
}

export async function executeWithCleanup<T>(
  work: () => Promise<T>,
  cleanup: () => Promise<string[]>
): Promise<LifecycleExecution<T>> {
  let value: T | null = null
  let primaryError: string | null = null
  try {
    value = await work()
  } catch (error) {
    primaryError = errorCode(error)
  }
  let cleanupErrors: string[]
  try {
    cleanupErrors = await cleanup()
  } catch (error) {
    cleanupErrors = [errorCode(error)]
  }
  return { value, primaryError, cleanupErrors }
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : 'UNKNOWN_FAILURE'
  return /^[A-Z0-9_:,-]+$/.test(message) ? message : 'LIFECYCLE_STEP_FAILED'
}

async function startOwnedService(
  serviceDirectory: string,
  onChildStarted: (child: ChildProcess) => void
): Promise<ChildProcess> {
  const child = spawn(
    PYTHON,
    [
      '-m',
      'uvicorn',
      'main:app',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--log-level',
      'warning'
    ],
    {
      cwd: serviceDirectory,
      env: sanitizedEnvironment(),
      stdio: 'ignore',
      windowsHide: true,
      detached: process.platform !== 'win32'
    }
  )
  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    child.once('spawn', () => {
      onChildStarted(child)
      resolveSpawn()
    })
    child.once('error', () => rejectSpawn(new Error('ISOLATED_SERVICE_SPAWN_FAILED')))
  })
  let lastStartupReason = 'HTTP_HEALTH_NOT_READY'
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error('ISOLATED_SERVICE_EXITED_DURING_STARTUP')
    try {
      const health = await request('/health')
      const owners = await listenerPids(PORT)
      const ownsListener =
        owners.length === 1 &&
        child.pid !== undefined &&
        (owners[0] === child.pid || (await isDescendantOf(child.pid, owners[0])))
      if (child.exitCode !== null || health.status !== 'ok' || !ownsListener) {
        throw new Error(`ISOLATED_SERVICE_OWNERSHIP_UNVERIFIED:${child.pid}:${owners.join(',')}`)
      }
      return child
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('ISOLATED_SERVICE_')) throw error
      lastStartupReason = errorCode(error)
      await delay(100)
    }
  }
  throw new Error(`ISOLATED_SERVICE_START_TIMEOUT:${lastStartupReason}`)
}

function writeCsv(path: string, rows: Array<Record<string, string | number>>): void {
  const fields = ['seq', 'ts', 'split', 'train_count', 'feature_version', ...METHODS]
  const quote = (value: string | number): string => {
    const text = String(value)
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  writeFileSync(
    path,
    `${fields.join(',')}\n${rows.map((row) => fields.map((field) => quote(row[field])).join(',')).join('\n')}\n`
  )
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
    renameSync(temporary, path)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      // The primary artifact write error is reported by the caller.
    }
    throw error
  }
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true })
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const summaryPath = join(EVIDENCE, 'run-summary.json')
  const failurePath = join(EVIDENCE, 'run-failure.json')
  if (existsSync(summaryPath)) {
    let archived = join(EVIDENCE, 'run-summary-b66c6b1.json')
    if (existsSync(archived)) archived = join(EVIDENCE, `run-summary-${runId}.json`)
    renameSync(summaryPath, archived)
  }
  for (const name of ['inference-scores.csv', 'production-state-integrity.json']) {
    const current = join(EVIDENCE, name)
    const archived = join(EVIDENCE, name.replace(/\.(csv|json)$/, '-b66c6b1.$1'))
    if (existsSync(current)) {
      renameSync(current, existsSync(archived) ? `${archived}.${runId}` : archived)
    }
  }
  if (existsSync(failurePath)) {
    let previousRunId = runId
    try {
      const previous = JSON.parse(readFileSync(failurePath, 'utf8')) as { run_id?: unknown }
      if (typeof previous.run_id === 'string' && /^[0-9TZ-]+$/.test(previous.run_id)) {
        previousRunId = previous.run_id
      }
    } catch {
      // Keep an unreadable failure record under this attempt's unique archive name.
    }
    let archivedFailure = join(EVIDENCE, `run-failure-${previousRunId}.json`)
    if (existsSync(archivedFailure))
      archivedFailure = join(EVIDENCE, `run-failure-archive-${runId}.json`)
    renameSync(failurePath, archivedFailure)
  }

  const productionState = join(ROOT, 'ml-service/state')
  let beforeProductionState: Record<string, string> | null = null
  let afterProductionState: Record<string, string> | null = null
  let child: ChildProcess | null = null
  let isolatedService: string | null = null
  let labRoot: string | null = null
  let resolvedLab: string | null = null
  let resolvedTemp: string | null = null
  let scratchRemoved = true
  let processTreeStopped = true
  let listenerReleased = false
  let cleanupErrors: string[] = []
  let primaryError: string | null = null

  const execution = await executeWithCleanup(
    async () => {
      beforeProductionState = treeSnapshot(productionState)
      if (!existsSync(PYTHON)) throw new Error('REPOSITORY_VENV_PYTHON_MISSING')
      const sourceHash = sha256(DATA)
      await assertLoopbackPortAvailable(PORT)
      const createdLab = mkdtempSync(join(tmpdir(), 'opspilot-ml-ready-6-'))
      labRoot = createdLab
      resolvedLab = realpathSync(createdLab)
      resolvedTemp = realpathSync(tmpdir())
      const rel = relative(resolvedTemp, resolvedLab)
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`))
        throw new Error('SCRATCH_PATH_NOT_ISOLATED')

      isolatedService = prepareIsolatedMlService({ projectRoot: ROOT, labRoot: createdLab })
      const samples = readSamples()
      if (
        samples.length !== 180 ||
        Number(samples[0].seq) !== 9118 ||
        Number(samples[179].seq) !== 9297
      )
        throw new Error('HISTORICAL_DATASET_SPLIT_INVALID')
      const copiedService = isolatedService
      child = await startOwnedService(copiedService, (ownedChild) => {
        child = ownedChild
        processTreeStopped = false
        listenerReleased = false
      })
      const initialHealth = await request('/health')
      const initialStatus = await request(`/status?deployment_id=${DEPLOYMENT_ID}`)
      if (initialStatus.trained !== false) throw new Error('ISOLATED_STATE_NOT_EMPTY')
      const train = await request('/train', {
        method: 'POST',
        body: JSON.stringify({
          deployment_id: DEPLOYMENT_ID,
          samples: samples.slice(0, 150).map(apiSample)
        })
      })
      if (train.trained !== true || train.train_sample_count !== 150)
        throw new Error('HTTP_TRAIN_RESULT_INVALID')
      const trainingStatus = await request(`/status?deployment_id=${DEPLOYMENT_ID}`)
      if (trainingStatus.trained !== true || trainingStatus.train_sample_count !== 150)
        throw new Error('HTTP_TRAIN_STATUS_INVALID')

      const scores: Array<Record<string, string | number>> = []
      for (const row of samples.slice(150)) {
        const response = await request('/ingest', {
          method: 'POST',
          body: JSON.stringify({ deployment_id: DEPLOYMENT_ID, sample: apiSample(row) })
        })
        const scoreSet = response.scores as ScoreSet
        if (response.ready !== true || !validScoreSet(scoreSet))
          throw new Error('HTTP_INGEST_SCORE_INVALID')
        scores.push({
          seq: Number(row.seq),
          ts: String(row.ts),
          split: 'inference',
          train_count: 150,
          feature_version: String(trainingStatus.feature_version),
          zscore_ewma: scoreSet.zscore_ewma as number,
          iforest: scoreSet.iforest as number,
          ocsvm: scoreSet.ocsvm as number,
          ensemble: scoreSet.ensemble as number
        })
      }
      await stopOwnedChild(child, { port: PORT })
      child = null
      processTreeStopped = true
      listenerReleased = true

      child = await startOwnedService(copiedService, (ownedChild) => {
        child = ownedChild
        processTreeStopped = false
        listenerReleased = false
      })
      const restartedStatus = await request(`/status?deployment_id=${DEPLOYMENT_ID}`)
      if (
        restartedStatus.trained !== true ||
        restartedStatus.train_sample_count !== 150 ||
        restartedStatus.sample_count !== 180
      )
        throw new Error('RESTART_MODEL_RELOAD_FAILED')
      const last = samples[179]
      const continued = await request('/ingest', {
        method: 'POST',
        body: JSON.stringify({ deployment_id: DEPLOYMENT_ID, sample: apiSample(last) })
      })
      if (continued.ready !== true || !validScoreSet(continued.scores as ScoreSet))
        throw new Error('RESTART_INFERENCE_FAILED')
      await stopOwnedChild(child, { port: PORT })
      child = null
      child = null
      processTreeStopped = true
      listenerReleased = true
      return {
        sourceHash,
        initialHealth,
        initialStatus,
        train,
        trainingStatus,
        scores,
        restartedStatus
      }
    },
    async () => {
      const errors: string[] = []
      if (child) {
        const failedChild = child
        try {
          await stopOwnedChild(failedChild, { port: PORT })
          child = null
          processTreeStopped = true
          listenerReleased = true
        } catch (error) {
          errors.push(errorCode(error))
          try {
            processTreeStopped =
              (failedChild.exitCode !== null || failedChild.signalCode !== null) &&
              (await listenerPids(PORT)).length === 0
          } catch {
            processTreeStopped = false
          }
        }
      }
      if (isolatedService && processTreeStopped) {
        try {
          if (labRoot) removeIsolatedMlService(labRoot)
        } catch {
          errors.push('ISOLATED_SOURCE_CLEANUP_FAILED')
        }
      } else if (isolatedService) {
        errors.push('ISOLATED_SOURCE_PRESERVED_PROCESS_NOT_STOPPED')
      }
      if (labRoot && resolvedLab && resolvedTemp && processTreeStopped) {
        try {
          removeOwnedScratch(labRoot, resolvedLab, resolvedTemp)
          scratchRemoved = true
        } catch (error) {
          scratchRemoved = false
          errors.push(errorCode(error))
        }
      } else if (labRoot) {
        scratchRemoved = false
        errors.push('SCRATCH_PRESERVED_PROCESS_NOT_STOPPED')
      }
      try {
        afterProductionState = treeSnapshot(productionState)
        if (
          beforeProductionState &&
          JSON.stringify(beforeProductionState) !== JSON.stringify(afterProductionState)
        ) {
          errors.push('PRODUCTION_MODEL_STATE_CHANGED')
        }
      } catch {
        errors.push('PRODUCTION_MODEL_STATE_HASH_FAILED')
      }
      try {
        listenerReleased = (await listenerPids(PORT)).length === 0
        await assertLoopbackPortAvailable(PORT)
        listenerReleased = true
      } catch {
        listenerReleased = false
        errors.push('LOOPBACK_LISTENER_NOT_RELEASED')
      }
      if (!processTreeStopped) errors.push('OWNED_PROCESS_TREE_NOT_CONFIRMED_STOPPED')
      return errors
    }
  )

  primaryError = execution.primaryError
  cleanupErrors = execution.cleanupErrors
  const productionStateUnchanged =
    beforeProductionState !== null &&
    afterProductionState !== null &&
    JSON.stringify(beforeProductionState) === JSON.stringify(afterProductionState)
  const checks = {
    service_process_tree_stopped: processTreeStopped,
    listener_released: listenerReleased,
    scratch_removed: scratchRemoved,
    production_state_unchanged: productionStateUnchanged
  }
  const passed = lifecycleCanPass(execution, checks)
  if (!passed) {
    const failure = {
      result: 'FAIL',
      run_id: runId,
      timestamp_utc: new Date().toISOString(),
      primary_error: primaryError,
      cleanup_errors: cleanupErrors,
      checks,
      production_state_before: beforeProductionState,
      production_state_after: afterProductionState,
      scratch_path_removed: scratchRemoved
    }
    writeJsonAtomic(failurePath, failure)
    throw new Error(`ML_READY_6_FAILED:${primaryError ?? 'CLEANUP_OR_FINAL_CHECK_FAILED'}`)
  }

  const result = execution.value
  if (!result || !beforeProductionState || !afterProductionState) {
    writeJsonAtomic(failurePath, { result: 'FAIL', run_id: runId, reason: 'FINAL_STATE_MISSING' })
    throw new Error('ML_READY_6_FINAL_STATE_MISSING')
  }
  try {
    writeCsv(join(EVIDENCE, 'inference-scores.csv'), result.scores)
    writeJsonAtomic(join(EVIDENCE, 'production-state-integrity.json'), {
      path: 'ml-service/state',
      files_before: beforeProductionState,
      files_after: afterProductionState,
      unchanged: productionStateUnchanged
    })
    writeJsonAtomic(summaryPath, {
      result: 'PASS',
      run_id: runId,
      timestamp_utc: new Date().toISOString(),
      endpoint: `http://127.0.0.1:${PORT}`,
      source: 'docs/demo-11-10/ml-samples-v5-180.csv',
      source_sha256: result.sourceHash,
      dataset_rows: 180,
      initial_health: result.initialHealth,
      initial_status: {
        trained: result.initialStatus.trained,
        sample_count: result.initialStatus.sample_count,
        min_samples_required: result.initialStatus.min_samples_required
      },
      training: {
        rows: 150,
        sequence: [9118, 9267],
        trained: result.train.trained,
        feature_vector_count: result.train.feature_vector_count,
        feature_version: result.trainingStatus.feature_version,
        train_status: {
          trained: result.trainingStatus.trained,
          sample_count: result.trainingStatus.sample_count,
          train_sample_count: result.trainingStatus.train_sample_count,
          min_samples_required: result.trainingStatus.min_samples_required
        }
      },
      inference: {
        rows: result.scores.length,
        sequence: [9268, 9297],
        chronological: true,
        methods: METHODS,
        scores_finite_in_range: true,
        warm_up: 'none; model trained before holdout ingestion'
      },
      restart: {
        same_isolated_state: true,
        trained: result.restartedStatus.trained,
        train_sample_count: result.restartedStatus.train_sample_count,
        persisted_sample_count: result.restartedStatus.sample_count,
        repeated_last_holdout_inference:
          'PASS; seq 9297 repeated to verify loaded model, not treated as a new historical sample'
      },
      cleanup: checks,
      isolation: {
        source_copy: 'prepareIsolatedMlService',
        state_started_absent: true,
        production_state_files: Object.keys(beforeProductionState).length,
        production_state_hash_manifest: 'production-state-integrity.json'
      },
      limitations: [
        'Historical normal-data HTTP lifecycle smoke only; not a pilot.',
        'No fault labels or accuracy/precision/recall claims.',
        'Pilot blockers from LIVE-0/ML-READY-5 remain: dedicated host, hardware/storage target, clock skew, ML endpoint/provider gates.'
      ]
    })
  } catch {
    writeJsonAtomic(failurePath, {
      result: 'FAIL',
      run_id: runId,
      primary_error: 'ARTIFACT_WRITE_FAILED',
      cleanup_errors: [],
      checks
    })
    throw new Error('ML_READY_6_FAILED:ARTIFACT_WRITE_FAILED')
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'ML_READY_6_FAILED'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
