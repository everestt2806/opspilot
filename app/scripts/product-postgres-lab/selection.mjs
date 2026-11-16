/* eslint-disable @typescript-eslint/explicit-function-return-type -- Private Linux CLI/SSHD acceptance. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

if (
  process.platform !== 'linux' ||
  process.getuid() !== 0 ||
  !process.version.startsWith('v22.') ||
  process.argv.slice(2).join(' ') !== '--confirm-local-postgres-selection'
)
  throw Error('EXPLICIT_ROOT_LINUX_NODE22_LOCAL_SELECTION_REQUIRED')
const inputArtifact = process.env.OPSPILOT_CONTROL_PLANE_OUTPUT,
  modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
if (!inputArtifact || !modules) throw Error('PRIVATE_LINUX_ARTIFACT_REQUIRED')
const sourceFixture = process.env.OPSPILOT_POSTGRES_SOURCE_FIXTURE
  ? JSON.parse(readFileSync(process.env.OPSPILOT_POSTGRES_SOURCE_FIXTURE, 'utf8'))
  : null
if (sourceFixture) {
  assert.equal(sourceFixture.repository_url, 'https://github.com/everestt2806/opspilot.git')
  assert.match(sourceFixture.branch, /^demo\/postgres-r7h-[a-f0-9]{12}$/)
  assert.match(sourceFixture.sha, /^[a-f0-9]{40}$/)
}
const Database = createRequire(join(modules, 'package.json'))('better-sqlite3'),
  scratch = mkdtempSync(join(tmpdir(), 'opspilot-pg-selection-')),
  artifact = join(scratch, 'payload/control-plane.cjs'),
  nonce = randomBytes(6).toString('hex'),
  output = resolve(import.meta.dirname, '../../.out-scripts/product-postgres-selection', nonce),
  checks = [],
  data = join(scratch, 'data'),
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  bundlePin = sha(readFileSync(join(dirname(inputArtifact), 'bundle-manifest.json'))),
  proof = {
    state: 'FAIL',
    nonce,
    production_vps_used: false,
    production_database_used: false,
    Docker_used: false,
    artifact_sha256: sha(readFileSync(inputArtifact)),
    checks
  }
chmodSync(scratch, 0o700)
cpSync(dirname(inputArtifact), dirname(artifact), {
  recursive: true,
  errorOnExist: true,
  force: false
})
mkdirSync(output, { recursive: true })
let sshd,
  db,
  stage = 'setup',
  secret
const run = (binary, args) => {
  const child = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  assert.equal(child.status, 0)
  return child.stdout.trim()
}
const cli = (command, input, denied) => {
  const child = spawnSync(process.execPath, [artifact, command, '--data-dir', data], {
    input: input === undefined ? '' : JSON.stringify(input),
    encoding: 'utf8',
    timeout: sourceFixture ? 180000 : 50000,
    maxBuffer: 65536,
    env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', NODE_ENV: 'production', NODE_PATH: modules }
  })
  assert(!child.error)
  proof.last_command = command
  proof.last_error = /^CONTROL_PLANE_ERROR ([A-Z0-9_]+)\n$/.exec(child.stderr)?.[1] ?? null
  if (secret) assert(!child.stdout.includes(secret) && !child.stderr.includes(secret))
  if (denied) {
    assert.equal(child.status, 1)
    assert.equal(child.stdout, '')
    assert.match(child.stderr, /^CONTROL_PLANE_ERROR [A-Z0-9_]+\n$/)
    if (denied instanceof RegExp) assert.match(child.stderr, denied)
    return
  }
  assert.equal(child.status, 0)
  assert.equal(child.stderr, '')
  return JSON.parse(child.stdout)
}
const check = (name) => {
  checks.push(name)
  console.log('PASS ' + name)
}
try {
  for (const name of ['host', 'client']) {
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(scratch, name)])
    chmodSync(join(scratch, name), 0o600)
  }
  secret = readFileSync(join(scratch, 'client'), 'utf8')
  const pin = /SHA256:[A-Za-z0-9+/]{43}/.exec(
    run('ssh-keygen', ['-lf', join(scratch, 'host.pub'), '-E', 'sha256'])
  )?.[0]
  assert(pin)
  const port = await new Promise((done, fail) => {
    const server = net.createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port
      server.close((error) => (error ? fail(error) : done(value)))
    })
  })
  mkdirSync('/run/sshd', { recursive: true })
  writeFileSync(
    join(scratch, 'sshd_config'),
    [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${join(scratch, 'host')}`,
      `PidFile ${join(scratch, 'sshd.pid')}`,
      `AuthorizedKeysFile ${join(scratch, 'client.pub')}`,
      'AllowUsers root',
      'PermitRootLogin yes',
      'StrictModes no',
      'UsePAM no',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'PubkeyAuthentication yes',
      'AuthenticationMethods publickey'
    ].join('\n') + '\n',
    { mode: 0o600 }
  )
  sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', join(scratch, 'sshd_config')], {
    stdio: 'ignore'
  })
  for (let attempt = 0; ; attempt++) {
    assert.equal(sshd.exitCode, null)
    const ready = await new Promise((done) => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        done(true)
      })
      socket.once('error', () => done(false))
    })
    if (ready) break
    assert(attempt < 80)
    await delay(100)
  }
  const controllerId = cli('init').controller_id
  cli('secrets-init')
  const enrolled = cli('enroll-vps', {
    format: 1,
    controller_id: controllerId,
    profile: {
      name: 'pg-selection-' + nonce,
      host: '127.0.0.1',
      port,
      username: 'root',
      auth_type: 'key',
      host_fingerprint: pin
    },
    secret
  })
  db = new Database(join(data, 'opspilot.db'))
  db.pragma('foreign_keys=ON')
  const vps = db.prepare('SELECT id,ssh_security_revision FROM vps').get(),
    config = JSON.stringify({
      container_port: 3000,
      framework: 'express',
      healthcheck_path: '/health',
      host_port: 30000,
      needs_db: false
    }),
    hash = sha(config),
    scope = {
      controller_id: controllerId,
      app_id: 1,
      ownership_generation: 1,
      target: {
        vps_id: vps.id,
        host: '127.0.0.1',
        port,
        username: 'root',
        auth_type: 'key',
        host_fingerprint: pin,
        ssh_security_revision: vps.ssh_security_revision
      }
    }
  assert(enrolled)
  const repository = sourceFixture?.repository_url ?? 'https://example.test/fixture.git',
    productionRef = sourceFixture?.branch ?? 'main'
  db.prepare(
    "INSERT INTO app(id,vps_id,name,framework,host_port,container_port,healthcheck_path,source_type,git_repo_url,git_ref,git_root) VALUES(1,?,'pg-selection','express',30000,3000,'/health','git',?,? ,'.')"
  ).run(vps.id, repository, productionRef)
  db.prepare("INSERT INTO product_source_config VALUES(1,1,?,? ,'.',?,?,?)").run(
    repository,
    productionRef,
    config,
    hash,
    '2026-11-16T00:00:00.000Z'
  )
  db.prepare(
    "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,auto_deploy_paused,pause_reason,pause_policy_provenance,changed_at) VALUES(1,'product',?,1,1,?,1,'operator','explicit','2026-11-16T00:00:00.000Z')"
  ).run(controllerId, hash)
  const prepare = {
      format: 1,
      request_key: randomUUID(),
      scope,
      expected_source_generation: 1,
      expected_source_config_sha256: hash
    },
    prepared = cli('prepare-managed-postgres', prepare),
    selection = {
      ...prepare,
      request_key: randomUUID(),
      database_id: prepared.metadata.database_id
    },
    request = { artifact, manifest_sha256: bundlePin, selection }
  stage = 'missing-target'
  cli('select-managed-postgres', request, /HELPER_UPGRADE_REQUIRED/)
  assert.equal(db.prepare('SELECT count(*) n FROM product_source_postgres').get().n, 0)
  check('missing_enrollment_refuses_selection_without_source_mutation')
  stage = 'enroll'
  assert.equal(
    cli('enroll-target', {
      format: 1,
      controller_id: controllerId,
      app_id: 1,
      ownership_generation: 1,
      artifact,
      manifest_sha256: bundlePin,
      target_root: join(scratch, 'targets')
    }).state,
    'enrolled'
  )
  const root = join(scratch, 'targets', 'controller-' + sha(controllerId) + '-app-1'),
    helper = join(root, 'helpers/target_product_runtime.py'),
    original = readFileSync(helper),
    keyBefore = readFileSync(join(data, '.controller-runtime-key')),
    rowBefore = db.prepare('SELECT * FROM product_target_enrollment').get()
  stage = 'readonly-review'
  const reviewed = cli('managed-postgres-review', request)
  assert.equal(reviewed.metadata.provisioning, 'prepared')
  assert.equal(reviewed.deployment_started, false)
  assert.deepEqual(db.prepare('SELECT * FROM product_target_enrollment').get(), rowBefore)
  assert.equal(db.prepare('SELECT count(*) n FROM product_source_postgres').get().n, 0)
  check('actual_SSH_manifest_helper_bytes_key_and_receipt_review_is_readonly')
  stage = 'tamper'
  writeFileSync(helper, Buffer.concat([original, Buffer.from('\n# private tamper fixture\n')]))
  cli('select-managed-postgres', request, /PRODUCT_POSTGRES_/)
  assert.equal(db.prepare('SELECT count(*) n FROM product_source_postgres').get().n, 0)
  assert.deepEqual(db.prepare('SELECT * FROM product_target_enrollment').get(), rowBefore)
  writeFileSync(helper, original)
  check('actual_helper_tamper_refuses_selection_without_clearing_enrollment')
  cli('select-managed-postgres', { ...request, manifest_sha256: '0'.repeat(64) }, true)
  check('wrong_local_bundle_pin_rejected_before_source_selection')
  stage = 'select'
  const selected = cli('select-managed-postgres', request)
  assert.equal(selected.state, 'selected')
  assert.equal(selected.source_generation, 2)
  assert.equal(selected.auto_deploy_paused, true)
  assert.equal(db.prepare('SELECT count(*) n FROM product_postgres_selection_request').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
  assert.deepEqual(readFileSync(join(data, '.controller-runtime-key')), keyBefore)
  check('production_CLI_selects_once_preserves_key_and_pause_no_job_or_runtime_readiness_claim')
  if (sourceFixture) {
    stage = 'public-Git-source-readiness'
    const input = {
      format: 1,
      controller_id: controllerId,
      app_id: 1,
      expected_ownership_generation: 1,
      expected_source_generation: selected.source_generation,
      expected_source_config_sha256: selected.source_config_sha256,
      expected_target_security_revision: vps.ssh_security_revision,
      artifact,
      manifest_sha256: bundlePin
    }
    const verified = cli('verify-project-source', input)
    assert.equal(verified.state, 'source_verified')
    assert.equal(verified.commit_sha, sourceFixture.sha)
    check('production_CLI_fetches_actual_public_Git_and_verifies_selected_PostgreSQL_source')
    const ready = cli('project-readiness', input)
    assert.equal(ready.state, 'ready')
    assert.equal(ready.commit_sha, sourceFixture.sha)
    assert.equal(ready.auto_deploy_paused, true)
    assert.equal(ready.deployment_started, false)
    assert.equal(db.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
    proof.public_Git = {
      ...sourceFixture,
      source_verified: true,
      first_deployment_readiness: 'ready',
      database_not_provisioned: true
    }
    check('actual_SSH_Docker_resource_probe_and_readiness_support_database_only_source_no_job')
  }
  stage = 'configuration-context'
  const metadataContext = cli('project-configuration-context', {
    format: 1,
    controller_id: controllerId,
    app_id: 1,
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    expected_source_config_sha256: hash,
    expected_target_security_revision: vps.ssh_security_revision
  })
  assert.equal(metadataContext.source_generation, selected.source_generation)
  assert.equal(metadataContext.database.selected.database_id, prepared.metadata.database_id)
  assert.equal(metadataContext.database.selected.provisioning, 'prepared')
  assert.equal(metadataContext.deployment_started, false)
  assert.equal(metadataContext.environment.selected, null)
  assert.equal(db.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
  check(
    'production_CLI_reviews_DB_only_source_from_original_registration_without_provisioning_or_job'
  )
  stage = 'offline-receipt'
  sshd.kill('SIGTERM')
  await new Promise((done) => sshd.once('close', done))
  assert.equal(cli('managed-postgres-selection-state', request).is_current, true)
  assert.deepEqual(cli('select-managed-postgres', request), {
    ...selected,
    state: 'already_selected'
  })
  cli(
    'select-managed-postgres',
    { ...request, selection: { ...selection, database_id: randomUUID() } },
    /REQUEST_CONFLICT/
  )
  check('cold_offline_same_UUID_lookup_replay_and_conflicting_body_refusal')
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  proof.state = 'PASS'
} catch (error) {
  proof.stage = stage
  proof.error = error?.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : 'SELECTION_LAB_FAILED'
  proof.failure_location = /selection\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? 'unknown'
  process.exitCode = 1
} finally {
  db?.close()
  if (sshd && sshd.exitCode === null) {
    sshd.kill('SIGTERM')
    await new Promise((done) => sshd.once('close', done))
  }
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  assert(!lstatSync(scratch).isSymbolicLink())
  assert(scratch.startsWith(join(tmpdir(), 'opspilot-pg-selection-')))
  rmSync(scratch, { recursive: true })
  proof.private_cleanup = !existsSync(scratch)
  writeFileSync(join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(
    JSON.stringify({ state: proof.state, checks: checks.length, nonce, stage: proof.stage })
  )
}
