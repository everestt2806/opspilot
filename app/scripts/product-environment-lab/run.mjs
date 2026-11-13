// Gate Linux key-store/SQLite; không SSH hoặc VPS.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  chmodSync,
  readFileSync,
  existsSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
if (process.argv.slice(2).join(' ') !== '--confirm-local-environment-store') {
  console.log('{"status":"REJECTED","code":"EXPLICIT_LOCAL_ENVIRONMENT_GATE_REQUIRED"}')
  process.exit(2)
}
if (process.platform !== 'linux' || !process.version.startsWith('v22.'))
  throw Error('LINUX_NODE22_REQUIRED')
const modules = process.env.OPSPILOT_R1_MODULES,
  artifact = process.env.OPSPILOT_R1_ARTIFACT
if (!modules || !artifact) throw Error('APPROVED_LINUX_MODULES_AND_PRIVATE_ARTIFACT_REQUIRED')
const esbuild = createRequire(resolve(modules, 'package.json'))('esbuild')
await esbuild.build({
  entryPoints: [join(import.meta.dirname, 'entry.ts')],
  outfile: artifact,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  plugins: [
    {
      name: 'sql',
      setup(b) {
        b.onResolve({ filter: /\.sql\?raw$/ }, (a) => ({
          path: resolve(a.resolveDir, a.path.slice(0, -4)),
          namespace: 'sql'
        }))
        b.onLoad({ filter: /.*/, namespace: 'sql' }, (a) => ({
          contents: readFileSync(a.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
const code = createRequire(artifact)(artifact),
  nonce = randomBytes(6).toString('hex'),
  root = resolve(import.meta.dirname, '../../..'),
  scratch = mkdtempSync(join(tmpdir(), 'opspilot-r7h1-')),
  directory = join(root, 'app/.out-scripts/product-environment-lab', nonce)
chmodSync(scratch, 0o700)
mkdirSync(directory, { recursive: true })
const checks = [],
  proof = {
    status: 'FAIL',
    scope: 'LINUX_PRIVATE_KEYSTORE_SQLITE_ONLY',
    nonce,
    checks,
    vps_used: false,
    gui_used: false,
    activation_implemented: false,
    artifact_sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex')
  }
let db
try {
  db = code.initializeDatabase(scratch, 'controller')
  assert.throws(
    () => code.loadControllerCredentialCipher(scratch),
    /CONTROLLER_SECRET_KEY_UNAVAILABLE/
  )
  assert(!existsSync(join(scratch, '.controller-runtime-key')))
  checks.push('missing_master_key_refused_without_implicit_creation')
  code.initializeControllerSecretKey(scratch)
  const keyHash = createHash('sha256')
    .update(readFileSync(join(scratch, '.controller-runtime-key')))
    .digest('hex')
  assert.throws(() => code.initializeControllerSecretKey(scratch))
  chmodSync(join(scratch, '.controller-runtime-key'), 0o644)
  assert.throws(
    () => code.loadControllerCredentialCipher(scratch),
    /CONTROLLER_SECRET_KEY_UNAVAILABLE/
  )
  chmodSync(join(scratch, '.controller-runtime-key'), 0o600)
  assert.equal(
    createHash('sha256')
      .update(readFileSync(join(scratch, '.controller-runtime-key')))
      .digest('hex'),
    keyHash
  )
  checks.push('explicit_key_once_unsafe_mode_refused_original_material_preserved')
  const pin = 'SHA256:' + 'A'.repeat(43),
    config = '{"framework":"nextjs"}',
    hash = createHash('sha256').update(config).digest('hex')
  db.prepare(
    "INSERT INTO vps(id,name,host,username,auth_type,host_fingerprint,ssh_security_revision,encrypted_secret) VALUES(1,'fixture','example.test','operator','key',?,1,X'00')"
  ).run(pin)
  db.exec(
    "INSERT INTO app(id,vps_id,name,framework,host_port,container_port) VALUES(1,1,'env-native','nextjs',30000,3000);INSERT INTO product_controller VALUES('env-native','2026-11-14T00:00:00.000Z','active')"
  )
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://example.test/repo.git','main','.',?,?,?)"
  ).run(config, hash, '2026-11-14T00:00:00.000Z')
  db.prepare(
    "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at) VALUES(1,'product','env-native',1,1,?,'2026-11-14T00:00:00.000Z')"
  ).run(hash)
  const scope = {
    controller_id: 'env-native',
    app_id: 1,
    ownership_generation: 1,
    target: {
      vps_id: 1,
      host: 'example.test',
      port: 22,
      username: 'operator',
      auth_type: 'key',
      host_fingerprint: pin,
      ssh_security_revision: 1
    }
  }
  const values = {
    runtime_env: { APP_TOKEN: 'SYNTHETIC_' + randomBytes(24).toString('hex'), EMPTY: '' },
    public_build_args: { NEXT_PUBLIC_TITLE: 'Sổ Đọc' }
  }
  const before = db.prepare('SELECT * FROM product_app_control').get()
  let store = new code.ProductEnvironmentRepository(
    db,
    code.loadControllerCredentialCipher(scratch)
  )
  const metadata = store.append({
    scope,
    expected_latest_revision: null,
    expected_source_generation: 1,
    expected_source_config_sha256: hash,
    values
  })
  assert.equal(metadata.activation, 'staged')
  assert(!JSON.stringify(metadata).includes(values.runtime_env.APP_TOKEN))
  assert.deepEqual(db.prepare('SELECT * FROM product_app_control').get(), before)
  assert.equal(db.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
  code.closeDatabase()
  db = code.initializeDatabase(scratch, 'controller')
  store = new code.ProductEnvironmentRepository(db, code.loadControllerCredentialCipher(scratch))
  assert.deepEqual(store.readValues(scope, 1), values)
  db.pragma('wal_checkpoint(TRUNCATE)')
  assert(
    !readFileSync(join(scratch, 'opspilot.db')).includes(Buffer.from(values.runtime_env.APP_TOKEN))
  )
  assert.equal(db.prepare('SELECT max(version) n FROM schema_version').get().n, 33)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  checks.push('real_cipher_encrypted_sqlite_reopen_metadata_only_no_job_or_source_activation')
  assert.throws(
    () =>
      new code.ProductEnvironmentRepository(
        db,
        new code.AesGcmCredentialCipher(randomBytes(32))
      ).readValues(scope, 1),
    /PRODUCT_ENVIRONMENT_UNAVAILABLE/
  )
  db.exec('DROP TRIGGER product_environment_revision_immutable')
  const row = db.prepare('SELECT auth_tag FROM product_environment_revision').get()
  row.auth_tag[0] ^= 1
  db.prepare('UPDATE product_environment_revision SET auth_tag=?').run(row.auth_tag)
  assert.throws(() => store.metadata(scope, 1), /PRODUCT_ENVIRONMENT_UNAVAILABLE/)
  checks.push('wrong_key_and_actual_sqlite_tag_tamper_refused_without_value_leak')
  db.prepare('UPDATE vps SET port=2222').run()
  assert.throws(() => store.readValues(scope, 1), /PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED/)
  checks.push('changed_target_security_binding_rejected_before_decrypt')
  proof.status = 'PASS'
} catch (error) {
  proof.error_code = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '')
    ? error.message
    : 'LOCAL_ENVIRONMENT_GATE_FAILED'
} finally {
  code.closeDatabase()
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  assert(/^opspilot-r7h1-/.test(scratch.slice(scratch.lastIndexOf('/') + 1)))
  rmSync(scratch, { recursive: true })
  proof.private_scratch_removed = !existsSync(scratch)
  writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(JSON.stringify(proof))
  process.exitCode = proof.status === 'PASS' ? 0 : 1
}
