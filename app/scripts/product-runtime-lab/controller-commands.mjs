/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript Linux integration lab. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const artifact = process.env.OPSPILOT_R1_ARTIFACT
if (!artifact) throw new Error('COMMAND_LAB_ARTIFACT_REQUIRED')
const require = createRequire(artifact),
  api = require(artifact),
  Database = require('better-sqlite3')
if (process.argv[2] === '--child') {
  const directory = process.argv[3]
  assert.match(directory, /^\/tmp\/opspilot-commands-[A-Za-z0-9]+$/)
  let text = ''
  for await (const bytes of process.stdin) {
    text += bytes
    if (text.length > 8192) throw new Error('CHILD_INPUT_LIMIT')
  }
  const input = JSON.parse(text),
    db = new Database(join(directory, 'opspilot.db'))
  db.pragma('foreign_keys=ON')
  try {
    const result = new api.ControllerCommands(db, input.controller_id, () => true).redeploy(
      input.authorization,
      input.key,
      1,
      input.body
    )
    console.log(JSON.stringify(result))
  } finally {
    db.close()
  }
  process.exit(0)
}
const nonce = randomBytes(6).toString('hex'),
  directory = mkdtempSync('/tmp/opspilot-commands-')
chmodSync(directory, 0o700)
const output = resolve(import.meta.dirname, '../../.out-scripts/controller-commands', nonce)
mkdirSync(output, { recursive: true })
const cases = [],
  record = (name) => cases.push(name)
let db, result
const child = (input) =>
  new Promise((resolveChild) => {
    const processChild = spawn(process.execPath, [import.meta.filename, '--child', directory], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = '',
      overflow = false
    processChild.stdout.on('data', (bytes) => {
      if (stdout.length + bytes.length <= 8192) stdout += bytes
      else overflow = true
    })
    processChild.stderr.on('data', () => {})
    processChild.once('error', () => resolveChild({ code: null, overflow: true }))
    processChild.once('close', (code) => resolveChild({ code, overflow, stdout }))
    processChild.stdin.end(JSON.stringify(input))
  })
try {
  db = api.initializeDatabase(directory)
  assert.equal(db.prepare('SELECT MAX(version) AS n FROM schema_version').get().n, 23)
  const controller = 'native-commands',
    sha = 'a'.repeat(40),
    hash = createHash('sha256').update('{}').digest('hex'),
    now = new Date().toISOString()
  db.prepare('INSERT INTO product_controller VALUES(?,?,?)').run(controller, now, 'active')
  db.exec(`INSERT INTO vps(id,name,host,host_fingerprint,username,auth_type,encrypted_secret) VALUES(1,'native fixture','target.test','SHA256:${'A'.repeat(43)}','unit','key',X'00');
  INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
    VALUES(1,1,'native-command-app','express',30000,3000,'git','https://github.com/demo/app.git','main','.')`)
  db.prepare(
    `INSERT INTO product_source_config VALUES(1,1,'https://github.com/demo/app.git','main','.','{}',?,?)`
  ).run(hash, now)
  db.prepare(
    `INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,
    auto_deploy_paused,pause_reason,pause_policy_provenance) VALUES(1,'product',?,1,1,?,?,1,'operator','explicit')`
  ).run(controller, hash, now)
  const repo = new api.ProductDeployRepository(db)
  const identity = {
    controllerId: controller,
    appId: 1,
    ownershipGeneration: 1,
    sourceGeneration: 1,
    configSha256: hash,
    ref: 'main'
  }
  repo.observeTip({ ...identity, expectedObservationSequence: null, tipSha: sha })
  const auth = new api.ControllerClientAuth(db, controller, `unix:${process.getuid()}`)
  const credential = auth.enroll({
    request_key: randomUUID(),
    display_name: 'Native command client',
    requested_scopes: ['read', 'deploy:manual', 'policy:write']
  })
  assert.equal(credential.state, 'issued_once')
  const header = `Bearer ${credential.credential.access_token}`,
    commands = new api.ControllerCommands(db, controller, () => true)
  const body = {
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    target: { kind: 'current_desired' }
  }
  const policy = (action) => ({
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    action
  })
  const key = randomUUID()
  const race = await Promise.all([
    child({ controller_id: controller, authorization: header, key, body }),
    child({ controller_id: controller, authorization: header, key, body })
  ])
  for (const value of race) {
    assert.equal(value.code, 0)
    assert.equal(value.overflow, false)
  }
  const values = race.map((value) => JSON.parse(value.stdout))
  assert.deepEqual(values[0], values[1])
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_deploy_job').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_api_request').get().n, 1)
  record('two_native_processes_one_request_one_job')
  assert.equal(
    db.prepare('SELECT auto_deploy_paused FROM product_app_control').get().auto_deploy_paused,
    1
  )
  record('redeploy_and_pause_atomic')
  assert.deepEqual(
    new api.ControllerCommands(db, controller, () => false).redeploy(
      header,
      key.toUpperCase(),
      1,
      body
    ),
    values[0]
  )
  record('cold_replay_returns_original_even_when_not_ready')
  assert.throws(
    () => commands.redeploy(header, key, 1, { ...body, target: { kind: 'specific_sha', sha } }),
    /IDEMPOTENCY_CONFLICT/
  )
  record('changed_request_conflicts')
  const other = auth.enroll({
    request_key: randomUUID(),
    display_name: 'Other native reader',
    requested_scopes: ['read']
  })
  assert.deepEqual(commands.lookup(`Bearer ${other.credential.access_token}`, key), {
    found: false
  })
  record('lookup_client_namespace')
  assert.throws(
    () =>
      commands.redeploy(header, randomUUID(), 1, {
        ...body,
        target: { kind: 'specific_sha', sha: 'c'.repeat(40) }
      }),
    /TARGET_SHA_UNAVAILABLE/
  )
  record('unknown_sha_never_becomes_work')
  db.exec(
    "UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL;CREATE TRIGGER reject_request BEFORE INSERT ON product_api_request BEGIN SELECT RAISE(ABORT,'UNIT_ABORT');END"
  )
  const historyBefore = db.prepare('SELECT count(*) AS n FROM product_history_event').get().n
  assert.throws(() => commands.redeploy(header, randomUUID(), 1, body), /UNIT_ABORT/)
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_deploy_job').get().n, 1)
  assert.equal(
    db.prepare('SELECT auto_deploy_paused FROM product_app_control').get().auto_deploy_paused,
    0
  )
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_history_event').get().n, historyBefore)
  db.exec('DROP TRIGGER reject_request')
  record('native_sql_rollback_keeps_policy_queue_audit_atomic')
  const blocked = new api.ControllerCommands(db, controller, () => false)
  assert.equal(blocked.policy(header, randomUUID(), 1, policy('pause')).auto_deploy_paused, true)
  assert.throws(
    () => blocked.policy(header, randomUUID(), 1, policy('resume')),
    /CAPABILITY_BLOCKED/
  )
  record('pause_available_while_degraded_resume_blocked')
  const claimed = repo.claimNextJob(controller)
  assert.equal(claimed.state, 'claimed')
  const metadata = {
    repositoryUrl: 'https://github.com/demo/app.git',
    repositoryRoot: '.',
    commitSha: sha,
    sourceConfigSha256: hash
  }
  repo.markGitSnapshotVerified(claimed.claim, metadata)
  assert.equal(repo.beginGitDispatch(claimed.claim, metadata).state, 'dispatch_authorized')
  const leases = db.prepare('SELECT * FROM product_app_lease').all()
  assert.throws(() => commands.redeploy(header, randomUUID(), 1, body), /RECONCILIATION_REQUIRED/)
  assert.throws(
    () => commands.policy(header, randomUUID(), 1, policy('resume')),
    /RECONCILIATION_REQUIRED/
  )
  assert.deepEqual(db.prepare('SELECT * FROM product_app_lease').all(), leases)
  record('unknown_dispatch_does_not_release_or_clear_fence')
  for (const table of ['product_api_request', 'product_history_event'])
    assert.equal(
      JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()).includes(
        credential.credential.access_token
      ),
      false
    )
  record('request_and_audit_never_store_bearer')
  auth.revoke({ request_key: randomUUID(), client_id: credential.client.client_id })
  assert.throws(() => commands.lookup(header, key), /CLIENT_REVOKED/)
  record('revocation_before_request_disclosure')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  record('native_fk_integrity')
  result = {
    status: 'PASS',
    scope: 'CONTROLLER_COMMANDS_NATIVE_SQLITE',
    nonce,
    passed: cases.length,
    cases,
    runtime_dispatch_executed: false
  }
} catch (error) {
  result = {
    status: 'FAIL',
    nonce,
    passed: cases.length,
    cases,
    code: typeof error.code === 'string' ? error.code : error.name
  }
} finally {
  api.closeDatabase()
  assert.match(directory, /^\/tmp\/opspilot-commands-[A-Za-z0-9]+$/)
  rmSync(directory, { recursive: true })
}
writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
