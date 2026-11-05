import { createHash } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

import Database from 'better-sqlite3'

import { HeadlessPoller, type SshManagerLike } from '../src/main/monitor/headlessPoller'
import { MlApiClient } from '../src/main/monitor/mlApi'
import { MonitorService } from '../src/main/monitor/service'
import { prepareIsolatedMlService } from '../src/main/crypto/credentialHandoff'

const ROOT = realpathSync(join(__dirname, '../../..'))
const EVIDENCE = join(ROOT, 'docs/evidence/tk-s7-ml-ready-7')
const DATA = join(ROOT, 'docs/demo-11-10/ml-collector-raw-v5-180.jsonl')
const CSV = join(ROOT, 'docs/demo-11-10/ml-samples-v5-180.csv')
const SCHEMA = join(ROOT, 'docs/contracts/schema.sql')
const PYTHON = join(ROOT, 'ml-service/.venv/Scripts/python.exe')
const PORT = 18766
const EXPECTED_RAW_SHA = '4d0a9e29bc395ce34508ef6be100f58e43fbc2ac65b01ca81991cf10a46956ab'
const EXPECTED_CSV_SHA = '9d2af5f64e64c3371fb988b54fef0770460368ddf935b456a605a1abd7bc425a'
const execFileAsync = promisify(execFile)

interface Sample {
  seq: number
  ts: string
  cpu_pct: number
  mem_mb: number
  mem_pct: number
  mem_limit_mb: number
  latency_ms: number
  http_error_rate: number
  db_response_ms: number | null
  container_up: number
  host_cpu_pct: number
  host_mem_pct: number
  [key: string]: unknown
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function databaseSnapshot(path: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${path}${suffix}`
    if (existsSync(file)) snapshot[suffix || 'database'] = sha256(file)
  }
  return snapshot
}

function treeSnapshot(path: string): Record<string, string> | null {
  if (!existsSync(path)) return null
  const root = realpathSync(path)
  const result: Record<string, string> = {}
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) result[relative(root, full).split(sep).join('/')] = sha256(full)
    }
  }
  if (statSync(root).isDirectory()) visit(root)
  else result[relative(dirname(root), root)] = sha256(root)
  return result
}

function readSamples(): Sample[] {
  if (sha256(DATA) !== EXPECTED_RAW_SHA || sha256(CSV) !== EXPECTED_CSV_SHA)
    throw new Error('HISTORICAL_SOURCE_HASH_MISMATCH')
  const rows = readFileSync(DATA, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Sample)
  if (
    rows.length !== 180 ||
    rows[0].seq !== 9118 ||
    rows[149].seq !== 9267 ||
    rows[150].seq !== 9268 ||
    rows[179].seq !== 9297
  )
    throw new Error('HISTORICAL_SOURCE_SPLIT_INVALID')
  for (let i = 1; i < rows.length; i += 1) {
    if (
      rows[i].seq !== rows[i - 1].seq + 1 ||
      Date.parse(rows[i].ts) - Date.parse(rows[i - 1].ts) !== 10_000
    )
      throw new Error('HISTORICAL_SOURCE_ORDER_INVALID')
  }
  return rows
}

function fixtureSsh(contents: () => string): SshManagerLike {
  const pathFor = (_vpsId: number, path: string): string => path
  const contentFor = (path: string): string => (path.includes('/app-a/') ? contents() : '')
  return {
    fileIdentity: async (_id, path) => ({
      generation: `fixture:${pathFor(_id, path)}`,
      device: 1,
      inode: path.includes('/app-a/') ? 11 : 12
    }),
    fileSize: async (_id, path) => Buffer.byteLength(contentFor(path)),
    readFileTail: async (_id, path, fromByte) => {
      const content = contentFor(path)
      const tail = Buffer.from(content)
        .subarray(Math.max(0, fromByte - 1))
        .toString('utf8')
      return { content: tail, nextOffset: fromByte + Buffer.byteLength(tail) }
    }
  }
}

function sampleJson(sample: Sample): string {
  return JSON.stringify(sample)
}

function listenOnce(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', () =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })
}

async function listenerIsFree(): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: PORT })
    socket.setTimeout(350)
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(true))
  })
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SERVICE_STOP_TIMEOUT')), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.once('error', () => {
      clearTimeout(timer)
      reject(new Error('SERVICE_STOP_WAIT_FAILED'))
    })
  })
}

async function stopService(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        timeout: 5_000,
        windowsHide: true
      })
    } else if (!child.kill('SIGTERM')) throw new Error('SERVICE_STOP_SIGNAL_FAILED')
    await waitForExit(child, 6_000)
  }
  if (!(await listenerIsFree())) throw new Error('SERVICE_LISTENER_NOT_RELEASED')
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    ...init,
    signal: AbortSignal.timeout(5_000)
  })
  if (!response.ok) throw new Error(`ML_HTTP_${response.status}`)
  return (await response.json()) as Record<string, unknown>
}

function startService(serviceDirectory: string): ChildProcess {
  return spawn(
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
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP
      },
      stdio: 'ignore',
      windowsHide: true
    }
  )
}

async function waitHealthy(child: ChildProcess): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (child.exitCode !== null) throw new Error('SERVICE_EXITED_DURING_STARTUP')
    try {
      const health = await request('/health')
      if (health.status === 'ok') return
    } catch {
      /* bounded startup poll */
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('SERVICE_START_TIMEOUT')
}

async function runPoller(
  db: Database.Database,
  ssh: SshManagerLike,
  scorer?: MlApiClient
): Promise<void> {
  const poller = new HeadlessPoller({
    db,
    ssh,
    scorer,
    intervalMs: 60_000,
    autoCloseDb: false,
    strict: true
  })
  await poller.start()
  if (!poller.active) throw new Error('POLLER_TIMER_NOT_STARTED')
  const drained = await poller.drain()
  if (drained.status !== 'drained' || !poller.closed || poller.active || poller.polling)
    throw new Error('POLLER_DRAIN_NOT_CONFIRMED')
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true })
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const summaryPath = join(EVIDENCE, 'run-summary.json')
  const failurePath = join(EVIDENCE, 'run-failure.json')
  if (existsSync(summaryPath))
    writeFileSync(join(EVIDENCE, `run-summary-${runId}.json`), readFileSync(summaryPath))
  rmSync(summaryPath, { force: true })
  const productionStatePath = join(ROOT, 'ml-service/state')
  const appData = process.env.APPDATA ?? ''
  const productionDbPath =
    process.env.OPSPILOT_DB_PATH ?? (appData ? join(appData, 'OpsPilot', 'opspilot.db') : '')
  let productionStateBefore: Record<string, string> | null = null
  let productionStateAfter: Record<string, string> | null = null
  let productionDbBefore: Record<string, string> | null = null
  let productionDbAfter: Record<string, string> | null = null
  let scratch: string | null = null
  let serviceDirectory: string | null = null
  let child: ChildProcess | null = null
  let serviceStarted = false
  let serviceStopped = false
  let db: Database.Database | null = null
  let primaryError: string | null = null
  let failedPhase: string | null = null
  const cleanupErrors: string[] = []
  let listenerReleased = false
  let scratchRemoved = false
  let pollerDrained = false
  let result: Record<string, unknown> | null = null

  try {
    failedPhase = 'production_snapshot'
    productionStateBefore = treeSnapshot(productionStatePath)
    productionDbBefore = productionDbPath ? databaseSnapshot(productionDbPath) : null
    failedPhase = 'source_and_port_preflight'
    const samples = readSamples()
    if (!existsSync(PYTHON)) throw new Error('REPOSITORY_VENV_PYTHON_MISSING')
    await listenOnce()
    scratch = mkdtempSync(join(tmpdir(), 'opspilot-ml-ready-7-'))
    failedPhase = 'isolated_database_setup'
    serviceDirectory = prepareIsolatedMlService({ projectRoot: ROOT, labRoot: scratch })
    db = new Database(join(scratch, 'integration.db'))
    db.pragma('foreign_keys = ON')
    db.exec(readFileSync(SCHEMA, 'utf8'))
    db.exec(`
      INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret) VALUES (1,'fixture-vps','fixture.invalid','fixture','password','fixture');
      INSERT INTO app (id,vps_id,name,framework,host_port,container_port) VALUES
        (1,1,'app-a','express',30001,3000), (2,1,'app-b','express',30002,3000);
      INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES
        (11,1,1,'app-a:v1','running'), (22,2,1,'app-b:v1','running');
      UPDATE app SET current_deployment_id=11 WHERE id=1;
      UPDATE app SET current_deployment_id=22 WHERE id=2;
    `)

    let feed = samples.slice(0, 150).map(sampleJson).join('\n') + '\n'
    const ssh = fixtureSsh(() => feed)
    failedPhase = 'baseline_monitor_poller'
    await runPoller(db, ssh)
    pollerDrained = true
    const baselineCount = (
      db.prepare('SELECT COUNT(*) AS n FROM metric_sample WHERE deployment_id=11').get() as {
        n: number
      }
    ).n
    if (baselineCount !== 150) throw new Error(`BASELINE_SQLITE_ROWS_${baselineCount}`)
    const trainingTarget = db
      .prepare(
        `
      SELECT a.imported_from_vps,d.origin,d.status,a.current_deployment_id
      FROM deployment d JOIN app a ON a.id=d.app_id WHERE d.id=11
    `
      )
      .get() as {
      imported_from_vps: number
      origin: string
      status: string
      current_deployment_id: number
    }
    if (
      !trainingTarget ||
      trainingTarget.imported_from_vps !== 0 ||
      trainingTarget.origin !== 'opspilot' ||
      trainingTarget.status !== 'running' ||
      trainingTarget.current_deployment_id !== 11
    )
      throw new Error('TRAINING_TARGET_IDENTITY_INVALID')
    failedPhase = 'ml_service_start'
    const ml = new MlApiClient(`http://127.0.0.1:${PORT}`, 5_000)
    child = startService(serviceDirectory)
    serviceStarted = true
    await waitHealthy(child)
    const initial = await ml.status(11)
    failedPhase = 'monitor_training_via_http'
    if (initial.trained) throw new Error('ISOLATED_MODEL_STATE_NOT_EMPTY')
    const train = await new MonitorService(db).trainNow(11, ml)
    if (train.train_sample_count !== 150) throw new Error('MONITOR_TRAIN_COUNT_INVALID')
    const afterTrain = await ml.status(11)
    if (!afterTrain.trained || afterTrain.sample_count !== 150)
      throw new Error('HTTP_TRAIN_STATUS_INVALID')

    feed = samples.map(sampleJson).join('\n') + '\n'
    failedPhase = 'holdout_headless_poller'
    await runPoller(db, ssh, ml)
    pollerDrained = true
    const afterFirstHoldout = (
      db.prepare('SELECT COUNT(*) AS n FROM metric_sample WHERE deployment_id=11').get() as {
        n: number
      }
    ).n
    failedPhase = 'repeat_idempotency_poll'
    await runPoller(db, ssh, ml)
    const afterRepeat = (
      db.prepare('SELECT COUNT(*) AS n FROM metric_sample WHERE deployment_id=11').get() as {
        n: number
      }
    ).n
    const countByMethod = db
      .prepare(
        `
      SELECT method, COUNT(*) AS n, SUM(CASE WHEN score IS NULL OR score < 0 OR score > 1 OR score != score THEN 1 ELSE 0 END) AS invalid
      FROM score_sample WHERE deployment_id=11 AND ts_vps>=? AND method IN ('zscore_ewma','iforest','ocsvm','ensemble') GROUP BY method ORDER BY method
    `
      )
      .all(samples[150].ts) as Array<{ method: string; n: number; invalid: number }>
    const identityRows = db
      .prepare(
        `
      SELECT ms.deployment_id, ms.seq, ms.ts_vps, COUNT(ss.id) AS methods,
        SUM(CASE WHEN ss.deployment_id<>ms.deployment_id OR ss.ts_vps<>ms.ts_vps THEN 1 ELSE 0 END) AS mismatched
      FROM metric_sample ms LEFT JOIN score_sample ss ON ss.metric_sample_id=ms.id
      WHERE ms.deployment_id=11 AND ms.seq BETWEEN 9268 AND 9297 GROUP BY ms.id ORDER BY ms.seq
    `
      )
      .all() as Array<{
      deployment_id: number
      seq: number
      ts_vps: string
      methods: number
      mismatched: number
    }>
    const foreignRows = (
      db.prepare('SELECT COUNT(*) AS n FROM score_sample WHERE deployment_id=22').get() as {
        n: number
      }
    ).n
    if (
      baselineCount !== 150 ||
      afterFirstHoldout !== 180 ||
      afterRepeat !== 180 ||
      countByMethod.length !== 4 ||
      countByMethod.some((row) => row.n !== 30 || row.invalid !== 0) ||
      identityRows.length !== 30 ||
      identityRows.some(
        (row, index) =>
          row.deployment_id !== 11 ||
          row.seq !== 9268 + index ||
          row.ts_vps !== samples[150 + index].ts ||
          row.methods !== 5 ||
          row.mismatched !== 0
      ) ||
      foreignRows !== 0
    )
      throw new Error('SQLITE_INTEGRATION_ASSERTION_FAILED')

    failedPhase = 'service_and_database_shutdown'
    await stopService(child)
    child = null
    serviceStopped = true
    listenerReleased = true
    db.close()
    db = null
    result = {
      source: {
        csv: 'docs/demo-11-10/ml-samples-v5-180.csv',
        csv_sha256: EXPECTED_CSV_SHA,
        raw: 'docs/demo-11-10/ml-collector-raw-v5-180.jsonl',
        raw_sha256: EXPECTED_RAW_SHA,
        rows: 180,
        sequences: [9118, 9297],
        sample_interval_seconds: 10
      },
      ssh_fixture:
        'fixed, read-only fixture metric stream; app-a receives published raw rows; app-b receives empty stream',
      training: {
        source_rows: 150,
        database_rows_before_training: baselineCount,
        deployment_id: 11,
        result: train,
        status: afterTrain
      },
      poll: {
        holdout_rows_processed: 30,
        deployment_id: 11,
        total_rows_after_first: afterFirstHoldout,
        total_after_repeat_poll: afterRepeat,
        method_score_counts: Object.fromEntries(countByMethod.map((row) => [row.method, row.n])),
        all_scores_finite_in_range: true
      },
      identity: {
        timestamp_and_seq_match_source_order: true,
        each_holdout_has_four_ml_methods_and_rule_score: true,
        score_deployment_matches_metric_deployment: true,
        other_deployment_score_rows: foreignRows,
        duplicate_metric_rows_after_repeat: afterRepeat - 180
      },
      poller: { drain_completed: pollerDrained, poller_instances_closed: true }
    }
  } catch (error) {
    const phase = failedPhase
    primaryError =
      error instanceof Error
        ? error.message.replace(/[^A-Z0-9_:.-]/gi, '_').slice(0, 120)
        : 'INTEGRATION_FAILED'
    if (phase) primaryError = `${phase}:${primaryError}`
  } finally {
    if (db?.open) {
      try {
        db.close()
      } catch {
        cleanupErrors.push('TEMP_DATABASE_CLOSE_FAILED')
      }
    }
    if (child) {
      try {
        await stopService(child)
        child = null
        serviceStopped = true
        listenerReleased = true
      } catch {
        cleanupErrors.push('SERVICE_STOP_OR_LISTENER_CHECK_FAILED')
      }
    } else if (!(await listenerIsFree())) cleanupErrors.push('SERVICE_LISTENER_NOT_RELEASED')
    else listenerReleased = true
    if (scratch) {
      try {
        const tempReal = realpathSync(tmpdir())
        const scratchReal = realpathSync(scratch)
        const rel = relative(tempReal, scratchReal)
        const safeScratch = Boolean(
          rel &&
          rel !== '..' &&
          !rel.startsWith(`..${sep}`) &&
          dirname(scratchReal) === tempReal &&
          scratchReal.split(sep).at(-1)?.startsWith('opspilot-ml-ready-7-')
        )
        if (safeScratch) {
          rmSync(scratchReal, { recursive: true, force: false })
          scratchRemoved = !existsSync(scratchReal)
          if (!scratchRemoved) cleanupErrors.push('SCRATCH_NOT_REMOVED')
        } else cleanupErrors.push('SCRATCH_PATH_REJECTED')
      } catch {
        cleanupErrors.push('SCRATCH_CLEANUP_FAILED')
      }
    }
    try {
      productionStateAfter = treeSnapshot(productionStatePath)
    } catch {
      cleanupErrors.push('PRODUCTION_STATE_SNAPSHOT_FAILED')
    }
    try {
      productionDbAfter = productionDbPath ? databaseSnapshot(productionDbPath) : null
    } catch {
      cleanupErrors.push('PRODUCTION_DB_HASH_FAILED')
    }
  }

  const productionStateUnchanged =
    JSON.stringify(productionStateBefore) === JSON.stringify(productionStateAfter)
  const productionDbUnchanged =
    JSON.stringify(productionDbBefore) === JSON.stringify(productionDbAfter)
  const passed =
    !primaryError &&
    cleanupErrors.length === 0 &&
    serviceStarted &&
    serviceStopped &&
    listenerReleased &&
    scratchRemoved &&
    productionStateUnchanged &&
    productionDbUnchanged &&
    result !== null
  const record = {
    result: passed ? 'PASS' : 'FAIL',
    run_id: runId,
    timestamp_utc: new Date().toISOString(),
    primary_error: primaryError,
    cleanup_errors: cleanupErrors,
    service_process_stopped: serviceStopped,
    listener_released: listenerReleased,
    scratch_removed: scratchRemoved,
    production_model_state_unchanged: productionStateUnchanged,
    production_db_unchanged: productionDbUnchanged,
    production_db_observation: {
      path_configured_or_default: Boolean(productionDbPath),
      files_before: productionDbBefore,
      files_after: productionDbAfter,
      hash_unchanged: productionDbUnchanged
    },
    results: passed ? result : null,
    limitations: [
      'Published historical normal data and fixed SSH metric fixture only; not a pilot or live VPS check.',
      'No fault labels or accuracy, precision, recall, F1, or fault-detection claim.',
      'No real auto-rollback execution.'
    ]
  }
  writeFileSync(passed ? summaryPath : failurePath, `${JSON.stringify(record, null, 2)}\n`)
  if (!passed)
    throw new Error(
      `ML_READY_7_FAILED:${primaryError ?? (cleanupErrors.join(',') || 'FINAL_CHECK_FAILED')}`
    )
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'ML_READY_7_FAILED'}\n`)
    process.exitCode = 1
  })
}
