/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Linux SSH/SQLite capability gate. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  existsSync,
  readdirSync,
  lstatSync,
  realpathSync,
  rmSync,
  cpSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import net from 'node:net'

if (
  process.argv.slice(2).join(' ') !== '--confirm-local-environment-target-capability' ||
  process.platform !== 'linux' ||
  process.getuid() !== 0 ||
  !process.version.startsWith('v22.')
)
  throw Error('ROOT_LINUX_NODE22_EXPLICIT_LOCAL_GATE_REQUIRED')
const artifact = process.env.OPSPILOT_R1_ARTIFACT,
  currentCli = process.env.OPSPILOT_CONTROLLER_ARTIFACT
if (!artifact || !currentCli) throw Error('FROZEN_ARTIFACTS_REQUIRED')
const api = createRequire(artifact)(artifact),
  Database = createRequire(artifact)('better-sqlite3'),
  repo = resolve(import.meta.dirname, '../../..'),
  nonce = randomBytes(6).toString('hex'),
  scratch = mkdtempSync('/var/tmp/opspilot-env-target-' + nonce + '-'),
  data = join(scratch, 'data'),
  output = join(repo, 'app/.out-scripts/environment-target-capability', nonce),
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  checks = []
chmodSync(scratch, 0o700)
mkdirSync(output, { recursive: true })
writeFileSync(join(scratch, '.gate-owner'), nonce, { mode: 0o600, flag: 'wx' })
const result = {
  status: 'FAIL',
  scope: 'LOCAL_REAL_PINNED_SSH_SQLITE_ENVIRONMENT_CAPABILITY',
  nonce,
  checks,
  production_vps_used: false,
  production_database_used: false,
  docker_info_only: true,
  docker_deployment_tested: false,
  cleanup: false
}
const run = (binary, args, options = {}) =>
  execFileSync(binary, args, {
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 65536,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim()
const cli = (file, command, input) => {
  try {
    return {
      ok: true,
      data: JSON.parse(
        run(process.execPath, [file, command, '--data-dir', data], {
          input: JSON.stringify(input),
          stdio: ['pipe', 'pipe', 'pipe']
        })
      )
    }
  } catch (error) {
    return {
      ok: false,
      code: /CONTROL_PLANE_ERROR ([A-Z0-9_]+)/.exec(String(error.stderr ?? ''))?.[1] ?? 'CLI_FAILED'
    }
  }
}
const bridge = (operation, payload) =>
  JSON.parse(
    run('python3', [join(repo, 'app/scripts/product-environment-admin-lab/bridge.py')], {
      input: JSON.stringify({
        node_path: process.execPath,
        artifact_path: currentCli,
        data_directory: data,
        operation,
        payload
      }),
      stdio: ['pipe', 'pipe', 'pipe']
    })
  )
const check = (name) => {
  checks.push(name)
  writeFileSync(
    join(output, 'progress.json'),
    JSON.stringify({ checks: checks.length, last: name })
  )
}
const reserve = () =>
  new Promise((done, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => done(p))
    })
  })
let db,
  sshd,
  controller,
  scopeRows = [],
  phase = 'setup'
try {
  const port = await reserve()
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(scratch, 'host')])
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(scratch, 'client')])
  const pin = run('ssh-keygen', ['-lf', join(scratch, 'host.pub'), '-E', 'sha256']).match(
    /SHA256:[A-Za-z0-9+/]{43}/
  )?.[0]
  assert(pin)
  mkdirSync('/run/sshd', { recursive: true })
  writeFileSync(
    join(scratch, 'sshd_config'),
    [
      'Port ' + port,
      'ListenAddress 127.0.0.1',
      'HostKey ' + join(scratch, 'host'),
      'PidFile ' + join(scratch, 'sshd.pid'),
      'AuthorizedKeysFile ' + join(scratch, 'client.pub'),
      'AllowUsers root',
      'PermitRootLogin yes',
      'StrictModes no',
      'UsePAM no',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'PubkeyAuthentication yes',
      'AuthenticationMethods publickey',
      'Subsystem sftp internal-sftp'
    ].join('\n') + '\n',
    { mode: 0o600 }
  )
  sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', join(scratch, 'sshd_config')], {
    stdio: 'ignore'
  })
  for (let i = 0; i < 80; i++) {
    assert.equal(sshd.exitCode, null)
    const ready = await new Promise((done) => {
      const s = net.connect(port, '127.0.0.1')
      s.once('connect', () => {
        s.destroy()
        done(true)
      })
      s.once('error', () => done(false))
    })
    if (ready) break
    if (i === 79) throw Error('SSHD_TIMEOUT')
    await new Promise((done) => setTimeout(done, 100))
  }
  controller = api.initializeController(data).controllerId
  api.initializeControllerSecretKey(data)
  db = new Database(join(data, 'opspilot.db'))
  db.pragma('foreign_keys=ON')
  db.pragma('journal_mode=WAL')
  const cipher = api.loadControllerCredentialCipher(data),
    target = {
      vps_id: 1,
      host: '127.0.0.1',
      port,
      username: 'root',
      auth_type: 'key',
      host_fingerprint: pin,
      ssh_security_revision: 1
    },
    encrypted = api.encryptControllerCredential(
      cipher,
      { controller_id: controller, target },
      readFileSync(join(scratch, 'client'), 'utf8')
    )
  db.prepare(
    'INSERT INTO vps(id,name,host,port,username,auth_type,host_fingerprint,crypto_scheme,encrypted_secret,iv,auth_tag) VALUES(1,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    'private target',
    '127.0.0.1',
    port,
    'root',
    'key',
    pin,
    encrypted.crypto_scheme,
    encrypted.encrypted_secret,
    encrypted.iv,
    encrypted.auth_tag
  )
  const oldExpress = join(scratch, 'old-express/control-plane.cjs'),
    oldTier1 = join(scratch, 'old-tier1/control-plane.cjs'),
    currentBundle = api.verifyControllerBundle(
      currentCli,
      sha(readFileSync(join(dirname(currentCli), 'bundle-manifest.json')))
    )
  cpSync(
    join(repo, 'app/resources/controller-releases/linux-x64-node22-20261110/release/payload'),
    dirname(oldExpress),
    { recursive: true, errorOnExist: true, force: false }
  )
  cpSync(
    join(
      repo,
      'app/resources/controller-releases/linux-x64-node22-20261113-spa-retained/release/payload'
    ),
    dirname(oldTier1),
    { recursive: true, errorOnExist: true, force: false }
  )
  const privateCopy = (directory) => {
    assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink())
    chmodSync(directory, 0o700)
    for (const name of readdirSync(directory)) {
      const file = join(directory, name),
        info = lstatSync(file)
      assert(!info.isSymbolicLink())
      if (info.isDirectory()) privateCopy(file)
      else {
        assert(info.isFile() && info.nlink === 1)
        chmodSync(file, 0o600)
      }
    }
  }
  privateCopy(dirname(oldExpress))
  privateCopy(dirname(oldTier1))
  for (const [index, framework, enroller] of [
    [1, 'express', oldExpress],
    [2, 'static-spa', oldTier1],
    [3, 'nextjs', oldTier1],
    [4, 'express', currentCli]
  ]) {
    phase = 'enroll-' + index
    const name = 'r7h3d2-' + nonce + '-' + index,
      hostPort = await reserve(),
      containerPort = framework === 'static-spa' ? 80 : 3000,
      path = framework === 'express' ? '/health' : '/',
      config = api.canonicalH2Json({
        framework,
        host_port: hostPort,
        container_port: containerPort,
        healthcheck_path: path,
        needs_db: false
      }),
      hash = sha(config),
      stamp = new Date().toISOString()
    assert(!existsSync('/opt/opspilot/' + name))
    db.prepare(
      "INSERT INTO app(id,vps_id,name,framework,host_port,container_port,healthcheck_path,source_type,git_repo_url,git_ref,git_root) VALUES(?,1,?,?,?,?,?,'git','https://github.com/example/fixture.git','main','.')"
    ).run(index, name, framework, hostPort, containerPort, path)
    db.prepare(
      "INSERT INTO product_source_config VALUES(?,1,'https://github.com/example/fixture.git','main','.',?,?,?)"
    ).run(index, config, hash, stamp)
    db.prepare(
      "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,auto_deploy_paused,pause_reason,pause_policy_provenance,changed_at) VALUES(?,'product',?,1,1,?,1,'operator','explicit',?)"
    ).run(index, controller, hash, stamp)
    const manifest = sha(readFileSync(join(dirname(enroller), 'bundle-manifest.json'))),
      scope = { controller_id: controller, app_id: index, ownership_generation: 1, target },
      input = {
        format: 1,
        controller_id: controller,
        app_id: index,
        ownership_generation: 1,
        artifact: enroller,
        manifest_sha256: manifest,
        target_root: join(scratch, 'targets')
      }
    const enrolled = cli(enroller, 'enroll-target', input)
    if (!enrolled.ok) throw Error(enrolled.code)
    assert.equal(enrolled.ok, true)
    assert.equal(enrolled.data.state, 'enrolled')
    const context = {
      format: 1,
      controller_id: controller,
      app_id: index,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: hash,
      expected_target_security_revision: 1
    }
    scopeRows.push({ index, name, scope, context, manifest, enrolled: enrolled.data })
  }
  const material = () =>
    scopeRows.map((row) => {
      const root = dirname(dirname(row.enrolled.helper_path)),
        files = [
          join(data, '.controller-runtime-key'),
          join(root, 'release-manifest.json'),
          join(root, 'enrollment.json'),
          ...[
            'target_execution_guard.py',
            'target_guarded_ssh_helper.py',
            'target_product_runtime.py'
          ].map((name) => join(root, 'helpers', name)),
          ...readdirSync(join(root, 'state'))
            .filter((name) => name.endsWith('.key'))
            .map((name) => join(root, 'state', name))
        ]
      return {
        app: row.index,
        manifest: db
          .prepare('SELECT manifest_sha256 FROM product_target_enrollment WHERE app_id=?')
          .get(row.index).manifest_sha256,
        files: files.map((file) => ({
          path: file,
          inode: lstatSync(file).ino,
          hash: sha(readFileSync(file))
        }))
      }
    })
  const before = material()
  phase = 'retained-startup'
  const recovery = new api.ControllerStartupRecovery(db, data, controller, currentBundle),
    report = await recovery.run(new AbortController().signal)
  assert.equal(report.state, 'ready')
  assert.equal(report.inspected_enrollments, 4)
  assert.equal(report.recovered_terminals, 0)
  assert.deepEqual(material(), before)
  check(
    'real_SSH_cold_recovery_retains_Express_eb5c_SPA_Next_98b0_and_current_f591_with_exact_material'
  )
  const vault = new api.ProductEnvironmentRepository(db, cipher),
    requests = []
  for (const row of scopeRows) {
    phase = 'capability-' + row.index
    vault.append({
      scope: row.scope,
      expected_latest_revision: null,
      expected_source_generation: 1,
      expected_source_config_sha256: row.context.expected_source_config_sha256,
      values: {
        runtime_env: { APP_TOKEN: 'SYNTHETIC_NATIVE_CAPABILITY_ONLY' },
        public_build_args: {}
      }
    })
    const request = {
      format: 1,
      request_key: randomUUID(),
      scope: row.scope,
      expected_source_generation: 1,
      expected_source_config_sha256: row.context.expected_source_config_sha256,
      expected_latest_revision: 1,
      environment_revision: 1
    }
    requests.push(request)
    const reviewed = cli(currentCli, 'project-environment-review', row.context)
    if (row.index !== 4) {
      assert.deepEqual(reviewed, { ok: false, code: 'PRODUCT_ENVIRONMENT_HELPER_UPGRADE_REQUIRED' })
      assert.deepEqual(bridge('project-environment-review', row.context), {
        ok: false,
        code: 'PRODUCT_ENVIRONMENT_HELPER_UPGRADE_REQUIRED'
      })
      assert.deepEqual(cli(currentCli, 'select-project-environment', request), {
        ok: false,
        code: 'PRODUCT_ENVIRONMENT_HELPER_UPGRADE_REQUIRED'
      })
      assert.equal(
        db
          .prepare('SELECT source_generation FROM product_app_control WHERE app_id=?')
          .get(row.index).source_generation,
        1
      )
    } else {
      assert.equal(reviewed.ok, true)
      const selected = cli(currentCli, 'select-project-environment', request)
      assert.equal(selected.ok, true)
      assert.equal(selected.data.state, 'selected')
      assert.equal(
        cli(currentCli, 'select-project-environment', request).data.state,
        'already_selected'
      )
      assert.equal(
        cli(currentCli, 'project-environment-selection-state', request).data.result
          .source_generation,
        2
      )
    }
  }
  assert.equal(db.prepare('SELECT count(*) n FROM product_source_environment').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
  assert.deepEqual(material(), before)
  check(
    'production_CLI_rejects_legacy_environment_before_selection_and_current_target_selects_and_replays'
  )
  phase = 'runtime-admission'
  const request = requests[0],
    selected = new api.ProductEnvironmentSelection(db, cipher).select(
      request,
      controller,
      'unix:0'
    ),
    stamp = new Date().toISOString()
  db.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL WHERE app_id=1')
  db.prepare(
    "INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,trigger,idempotency_key,ref,target_sha,state,available_at,created_at,updated_at) VALUES('legacy-env-claim',?,1,1,?,?,'manual_redeploy','private-lab','main',?,'queued',?,?,?)"
  ).run(
    controller,
    selected.source_generation,
    selected.source_config_sha256,
    'a'.repeat(40),
    stamp,
    stamp,
    stamp
  )
  const jobs = new api.ProductDeployRepository(db),
    claimed = jobs.claimNextJob(controller)
  assert.equal(claimed.state, 'claimed')
  const ssh = new api.SshManager(api.createControllerSshResolver(db, controller, data))
  try {
    const target = api.readEnrolledProductTarget(db, data, controller, 1, 1, scopeRows[0].manifest)
    const resources = (
      await api.observeProductTarget(
        db,
        controller,
        target,
        ssh,
        true,
        new AbortController().signal
      )
    ).resources
    assert.equal(resources.docker_ready, true)
    assert.equal(resources.port_ready, true)
    assert(
      resources.available_ram_bytes > 512 * 1024 * 1024 &&
        resources.workspace_available_bytes > 2 * 1024 * 1024 * 1024
    )
    assert.equal(jobs.readClaimExecutionState(claimed.claim), 'prewrite')
    assert.deepEqual(
      await new api.ControllerTargetAdmission(db, data, controller, ssh).check(
        claimed.claim,
        new AbortController().signal
      ),
      { state: 'deferred', reason: 'resource_unknown' }
    )
    assert.equal(jobs.readClaimExecutionState(claimed.claim), 'prewrite')
  } finally {
    ssh.disconnectAll()
  }
  assert.equal(db.prepare('SELECT count(*) n FROM product_runtime_terminal').get().n, 0)
  assert(scopeRows.every((row) => !existsSync('/opt/opspilot/' + row.name)))
  check(
    'actual_Docker_resource_probe_cannot_admit_env_on_legacy_helper_before_dispatch_or_plaintext_files'
  )
  phase = 'tampered-helper'
  const tampered = join(dirname(scopeRows[1].enrolled.helper_path), 'target_product_runtime.py')
  writeFileSync(
    tampered,
    Buffer.concat([readFileSync(tampered), Buffer.from('\n# private tamper test\n')])
  )
  const blocked = await new api.ControllerStartupRecovery(db, data, controller, currentBundle).run(
    new AbortController().signal
  )
  assert.equal(blocked.state, 'reconciliation_required')
  assert(
    blocked.blockers.some((item) => item.app_id === 2 && item.reason === 'enrollment_not_ready')
  )
  assert(readFileSync(tampered, 'utf8').endsWith('# private tamper test\n'))
  check('retained_allowlist_never_skips_remote_file_hash_or_reinstalls_a_changed_helper')
  result.status = 'PASS'
  result.bundle_sha256 = currentBundle.manifest_sha256
  result.driver_sha256 = sha(readFileSync(import.meta.filename))
} catch (error) {
  result.phase = phase
  result.error =
    error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'ENVIRONMENT_TARGET_GATE_FAILED'
  result.failure_location =
    /environment-target-capability\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? null
} finally {
  db?.close()
  if (sshd && sshd.exitCode === null) {
    sshd.kill('SIGTERM')
    for (let i = 0; i < 50 && sshd.exitCode === null; i++)
      await new Promise((done) => setTimeout(done, 100))
    if (sshd.exitCode === null) sshd.kill('SIGKILL')
  }
  assert.equal(realpathSync(scratch), scratch)
  assert(scratch.startsWith('/var/tmp/opspilot-env-target-' + nonce + '-'))
  assert.equal(readFileSync(join(scratch, '.gate-owner'), 'utf8'), nonce)
  rmSync(scratch, { recursive: true })
  result.cleanup = !existsSync(scratch)
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(
    JSON.stringify({ status: result.status, checks: checks.length, output, phase: result.phase })
  )
  if (result.status !== 'PASS') process.exitCode = 1
}
