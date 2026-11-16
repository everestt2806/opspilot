import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { privateInput } from '../product-environment-live/input.mjs'
const [nonce] = process.argv.slice(2)
assert(/^[a-f0-9]{12}$/.test(nonce) && process.argv.length === 3)
const project = resolve(import.meta.dirname, '../..'),
  directory = join(project, '.out-scripts/product-postgres-app-live', nonce)
const evidence = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'))
assert.equal(evidence.status, 'PASS')
assert.equal(evidence.private_db_removed, true)
assert.equal(evidence.PG_application_deployed, true)
const artifact = join(directory, 'entry.cjs')
assert.equal(
  createHash('sha256').update(readFileSync(artifact)).digest('hex'),
  evidence.main_artifact_sha256
)
const code = createRequire(join(project, 'package.json'))(artifact)
let config, ssh
try {
  config = await privateInput()
  assert.equal(config.host, '167.71.202.116')
  assert.equal(config.username, 'root')
  assert.equal(config.port, 22)
  assert.equal(config.host_fingerprint, 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E')
  assert.equal(typeof config.password, 'string')
  ssh = new code.SshManager(() => ({
    host: config.host,
    port: config.port,
    username: config.username,
    authType: 'password',
    hostFingerprint: config.host_fingerprint,
    secret: config.password
  }))
  const app = evidence.project
  assert(Number.isSafeInteger(app.app_id) && app.app_id > 6 && /^[a-z0-9-]+$/.test(app.app_name))
  const intentFile = join(directory, 'backup-intent.json')
  let intent
  if (existsSync(intentFile)) intent = JSON.parse(readFileSync(intentFile, 'utf8'))
  else {
    const final = evidence.deployments.final
    intent = {
      record: nonce,
      request_key: randomUUID(),
      app_id: app.app_id,
      authority: {
        name: app.app_name,
        current_deployment_id: final.status.current_deployment_id,
        controller_id: evidence.database.controller_id,
        ownership_generation: evidence.database.ownership_generation,
        source_generation: final.status.source_generation,
        auto_deploy_paused: 1
      },
      database: final.database_runtime
    }
    writeFileSync(intentFile, JSON.stringify(intent, null, 2) + '\n', { flag: 'wx', flush: true })
  }
  assert.equal(intent.record, nonce)
  assert.deepEqual(intent.database, evidence.deployments.final.database_runtime)
  const script = readFileSync(join(import.meta.dirname, 'backup.py'), 'utf8')
  const input = JSON.stringify(intent)
  assert(!input.includes("'") && !input.includes('\\') && !input.includes('\n'))
  const command =
    "python3 - <<'PY'\n" +
    script.replace('"__OPSPILOT_ACCEPTANCE_REQUEST__"', JSON.stringify(input)) +
    '\nPY'
  const result = await ssh.exec(1, command, {
    logCommand: false,
    retryOnReconnect: false,
    timeoutMs: 180000,
    maxStdoutBytes: 4096,
    maxStderrBytes: 1024
  })
  if (result.code !== 0) {
    let failure = { status: 'FAIL', code: 'BACKUP_OPERATOR_WIRE_FAILED', remote_exit: result.code }
    try {
      const value = JSON.parse(result.stdout)
      if (value.status === 'FAIL' && /^[a-z-]+$/.test(value.stage))
        failure = {
          ...failure,
          stage: value.stage,
          remote_code: value.code,
          clone_cleanup_confirmed: value.clone_cleanup_confirmed
        }
    } catch {
      /* No raw stderr or stdout in evidence. */
    }
    writeFileSync(join(directory, 'backup-failure.json'), JSON.stringify(failure, null, 2) + '\n')
  }
  assert.equal(result.code, 0)
  const proof = JSON.parse(result.stdout)
  assert.equal(proof.status, 'PASS')
  assert.equal(proof.request_key, intent.request_key)
  assert.equal(proof.rows, 1000)
  assert.equal(proof.isolated_clone_removed, true)
  assert.equal(proof.serving_data_changed, false)
  proof.operator_script_sha256 = createHash('sha256').update(script).digest('hex')
  proof.checked_at = new Date().toISOString()
  writeFileSync(
    join(directory, 'backup-restore-verification.json'),
    JSON.stringify(proof, null, 2) + '\n'
  )
  console.log(JSON.stringify(proof))
} catch {
  console.log('{"status":"FAIL","code":"POSTGRES_BACKUP_INSPECTION_REQUIRED"}')
  process.exitCode = 1
} finally {
  await ssh?.disconnectAll()
  if (config) config.password = ''
}
