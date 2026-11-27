/* eslint-disable @typescript-eslint/explicit-function-return-type -- Packaged Electron native ML proof. */
import assert from 'node:assert/strict'
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MlServiceManager } from '../../src/main/mlClient'
import {
  builtinMlRuntimePin,
  packagedMlEnvironment,
  verifyMlRuntime
} from '../../src/main/mlRuntime'

const config = JSON.parse(readFileSync(join(app.getAppPath(), 'proof-config.json'), 'utf8'))
mkdirSync(config.user_data, { recursive: true })
app.setPath('userData', config.user_data)
const proof = {
  status: 'RUNNING',
  checks: [],
  mocked_python: false,
  production_database_used: false,
  real_packaged_electron: app.isPackaged,
  source: 'SYNTHETIC_DELIVERY_TEST_NOT_FORMAL_EXPERIMENT'
}
let manager
const timer = setTimeout(() => app.exit(2), 120000)
process.on('exit', () => manager?.stopSync())
app.whenReady().then(async () => {
  try {
    assert.equal(app.isPackaged, true)
    const runtime = join(process.resourcesPath, 'ml-runtime'),
      manifest = verifyMlRuntime(runtime)
    assert.equal(builtinMlRuntimePin(), config.pin)
    const diagnostic = spawnSync(
      join(runtime, 'python.exe'),
      [
        '-I',
        '-B',
        '-X',
        'utf8',
        '-c',
        'import json,sys,numpy,scipy,sklearn;print(json.dumps({"prefix":sys.prefix,"path":sys.path,"executable":sys.executable,"isolated":sys.flags.isolated,"no_site":sys.flags.no_site,"numpy":numpy.__file__,"scipy":scipy.__file__,"sklearn":sklearn.__file__}))'
      ],
      {
        cwd: join(runtime, 'service'),
        windowsHide: true,
        timeout: 45000,
        maxBuffer: 65536,
        env: packagedMlEnvironment(process.env, join(config.user_data, 'ml-state'))
      }
    )
    assert.equal(diagnostic.status, 0, 'ISOLATED_PYTHON_IMPORT_FAILED')
    proof.python = JSON.parse(diagnostic.stdout.toString())
    assert.equal(resolve(proof.python.prefix), resolve(runtime))
    assert.equal(proof.python.isolated, 1)
    assert.equal(proof.python.no_site, 1)
    for (const path of proof.python.path) assert(resolve(path).startsWith(resolve(runtime)))
    proof.checks.push(
      'real_packaged_electron_and_relocated_python_native_imports_only_from_bundled_runtime_without_user_site'
    )
    manager = new MlServiceManager(() => {})
    const first = manager.start(),
      duplicate = manager.start()
    assert.equal(first, duplicate)
    assert.equal((await first).running, true)
    const port = manager.getPort(),
      pid = manager.child.pid
    const api = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${manager.getPort()}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000)
      })
      assert.equal(response.status, 200)
      return response.json()
    }
    const deployment = 900001
    assert.equal((await api(`/status?deployment_id=${deployment}`)).trained, false)
    const samples = Array.from({ length: 180 }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 10, 12) + i * 10000).toISOString(),
      seq: i,
      cpu_pct: 25 + 3 * Math.sin(i / 7),
      mem_mb: 150 + 5 * Math.cos(i / 9),
      latency_ms: 35 + 2 * Math.sin(i / 5),
      http_error_rate: 0.001 + (i % 3) * 0.0001,
      db_response_ms: 5 + Math.cos(i / 4),
      container_up: 1
    }))
    const trained = await api('/train', { deployment_id: deployment, samples })
    assert.equal(trained.trained, true)
    assert.equal(trained.train_sample_count, 180)
    const prediction = await api('/ingest', {
      deployment_id: deployment,
      sample: {
        ...samples[179],
        ts: new Date(Date.UTC(2026, 10, 12) + 1800000).toISOString(),
        seq: 180,
        cpu_pct: 95,
        latency_ms: 1800
      }
    })
    for (const name of ['zscore_ewma', 'iforest', 'ocsvm', 'ensemble'])
      assert(Number.isFinite(prediction.scores[name]))
    proof.training = trained
    proof.scores = prediction.scores
    const model = join(config.user_data, 'ml-state', String(deployment), 'state.pkl')
    assert(existsSync(model))
    assert(!existsSync(join(runtime, 'service/state')))
    const modelHash = createHash('sha256').update(readFileSync(model)).digest('hex')
    proof.checks.push(
      'actual_http_train180_inference_four_methods_and_model_written_only_to_unicode_user_data'
    )
    assert.equal((await manager.restart()).running, true)
    const restartedPid = manager.child.pid
    assert.notEqual(restartedPid, pid)
    assert.throws(() => process.kill(pid, 0))
    const restored = await api(`/status?deployment_id=${deployment}`)
    assert.equal(restored.trained, true)
    assert.equal(restored.trained_at, trained.trained_at)
    assert.equal(createHash('sha256').update(readFileSync(model)).digest('hex'), modelHash)
    const resumed = await api('/ingest', {
      deployment_id: deployment,
      sample: {
        ...samples[179],
        ts: new Date(Date.UTC(2026, 10, 12) + 1810000).toISOString(),
        seq: 181
      }
    })
    for (const value of Object.values(resumed.scores)) assert(Number.isFinite(value))
    proof.checks.push(
      'real_process_restart_kills_old_pid_and_restores_same_persisted_models_before_resuming_inference'
    )
    manager.stopSync()
    assert.equal(manager.getPort(), null)
    assert.throws(() => process.kill(restartedPid, 0))
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
    )
    proof.checks.push(
      'absolute_windows_taskkill_removes_owned_ml_process_and_releases_loopback_listener_without_path_python_or_node'
    )
    const source = join(runtime, 'service/main.py'),
      original = readFileSync(source)
    try {
      writeFileSync(source, Buffer.concat([original, Buffer.from('\n# modified fixture\n')]))
      await assert.rejects(manager.start(), (error) => error.code === 'ML_SERVICE_DOWN')
      assert.equal(manager.child, null)
    } finally {
      writeFileSync(source, original)
    }
    const manifestPath = join(runtime, 'manifest.json'),
      missing = join(runtime, 'manifest.absent.json')
    assert.equal(resolve(manifestPath, '..'), resolve(runtime))
    assert.equal(resolve(missing, '..'), resolve(runtime))
    renameSync(manifestPath, missing)
    try {
      await assert.rejects(manager.start(), (error) => error.code === 'ML_SERVICE_DOWN')
      assert.equal(manager.child, null)
    } finally {
      renameSync(missing, manifestPath)
    }
    assert.equal(verifyMlRuntime(runtime).files.length, manifest.files.length)
    proof.checks.push(
      'tampered_and_missing_runtime_refused_without_spawn_or_global_venv_fallback_and_resource_bytes_unchanged_after_restore'
    )
    proof.runtime = {
      files: manifest.files.length,
      python_version: manifest.python_version,
      packages: manifest.packages,
      pin: config.pin
    }
    proof.status = 'PASS'
  } catch (error) {
    proof.status = 'FAIL'
    proof.error = /^[A-Z_]+$/.test(error?.context?.cause ?? '') ? error.context.cause : error.name
    proof.failure_location = /main\.cjs:\d+:\d+/.exec(error.stack ?? '')?.[0] ?? 'unknown'
  } finally {
    manager?.stopSync()
    clearTimeout(timer)
    writeFileSync(join(config.evidence, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
    console.log(
      JSON.stringify({ status: proof.status, checks: proof.checks.length, error: proof.error })
    )
    app.exit(proof.status === 'PASS' ? 0 : 1)
  }
})
