import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

// This intentionally uses a private disposable Desktop DB, never the user's profile.
// Only the controller installed on the designated development VPS remains afterwards.
if (
  !process.version.startsWith('v22.') ||
  process.argv[2] !== '--confirm-install-development-controller'
)
  throw Error('NODE22_AND_EXPLICIT_DEVELOPMENT_INSTALL_CONFIRMATION_REQUIRED')
const require = createRequire(import.meta.url)
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const project = resolve(import.meta.dirname, '..')
const parent = join(project, '.out-scripts/controller-onboarding-live')
const nonce = randomBytes(8).toString('hex'),
  directory = join(parent, nonce)
mkdirSync(directory, { recursive: true })
const evidence = {
  status: 'RUNNING',
  checks: [],
  remote_mutation_attempted: false,
  controller_retained: null,
  local_db_removed: false
}
const checks = evidence.checks
const verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
const catalog = verifier.builtinControllerInstallerCatalog()
const bundle = join(directory, 'entry.cjs')
await esbuild.build({
  entryPoints: [join(project, 'scripts/controller-bootstrap-lab/entry.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  define: { __OPSPILOT_CONTROLLER_INSTALLER_CATALOG__: JSON.stringify(catalog) },
  plugins: [
    {
      name: 'raw',
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw'
        }))
        build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
let inputText = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) {
  inputText += chunk
  if (Buffer.byteLength(inputText) > 32768) throw Error('INPUT_TOO_LARGE')
}
let input
try {
  input = JSON.parse(inputText)
} catch {
  throw Error('LIVE_INPUT_INVALID')
}
inputText = ''
const { z } = require('zod')
const parsed = z
  .strictObject({
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.literal('root'),
    host_fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
    password: z.string().min(1).max(8192)
  })
  .safeParse(input)
if (!parsed.success) throw Error('LIVE_INPUT_INVALID')
const config = parsed.data
input.password = ''
const {
  initializeDatabase,
  closeDatabase,
  VpsRepository,
  AesGcmCredentialCipher,
  SshManager,
  loadSecret,
  DesktopControllerService,
  ControllerInstallerResources
} = require(bundle)
const local = join(directory, 'private-profile')
mkdirSync(local, { mode: 0o700 })
const db = initializeDatabase(local)
const key = randomBytes(32),
  cipher = new AesGcmCredentialCipher(key)
key.fill(0)
const repository = new VpsRepository(db)
const vps = repository.create({
  name: 'Development controller',
  host: config.host,
  port: config.port,
  username: config.username,
  auth_type: 'password',
  host_fingerprint: config.host_fingerprint,
  credential: cipher.encrypt(config.password)
})
config.password = ''
const ssh = new SshManager((id) => {
  const profile = repository.getById(id)
  return {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authType: profile.auth_type,
    hostFingerprint: profile.host_fingerprint ?? null,
    secret: loadSecret(db, cipher, id)
  }
})
const resources = new ControllerInstallerResources(
  catalog,
  join(project, 'resources/controller-releases')
)
let binding, service
try {
  service = new DesktopControllerService(db, cipher, ssh, undefined, resources.entries(), resources)
  const overview = await service.installerOverview()
  const release = overview.releases.find((v) => v.state === 'available')
  assert.ok(release)
  checks.push('windows_local_resource_verification')
  const review = await service.reviewInstaller({ vps_id: vps.id, release_id: release.release_id })
  evidence.preflight = { next: review.next, host: review.host, root_required: review.root_required }
  assert.equal(review.next, 'install')
  assert.equal(review.plan.remote_existing, false)
  checks.push('pinned_ssh_readonly_preflight_and_fresh_remote')
  let record = await service.prepareInstaller({ plan_id: review.plan.plan_id })
  evidence.request_key = record.request_key
  assert.equal(record.state, 'prepared')
  checks.push('sqlite_intent_before_mutation')
  evidence.remote_mutation_attempted = true
  record = await service.sendInstaller({
    request_key: record.request_key,
    operation: 'transfer',
    consent: true
  })
  assert.equal(record.state, 'transferred')
  checks.push('windows_sender_linux_receiver_verified')
  record = await service.sendInstaller({
    request_key: record.request_key,
    operation: 'install',
    consent: true
  })
  evidence.controller_retained = true
  assert.equal(record.state, 'installed')
  assert.equal(record.last_result.service_state, 'running')
  checks.push('root_install_systemd_running')
  record = await service.inspectInstallation(record.request_key)
  assert.equal(record.state, 'installed')
  assert.equal(record.last_result.service_state, 'running')
  evidence.installed = record.last_result
  checks.push('independent_installed_receipt_inspect')
  const intent = {
    installation_request_key: record.request_key,
    display_name: 'Development smoke',
    allow_write: false
  }
  const prepared = await service.prepareInstalledRegistration(intent)
  binding = prepared.binding_id
  assert.equal((await service.prepareInstalledRegistration(intent)).binding_id, binding)
  checks.push('durable_binding_uuid_reuse')
  const registered = await service.registerInstalled({ ...intent, binding_id: binding })
  assert.equal(registered.state, 'active')
  checks.push('root_to_service_uid_enrollment_bridge')
  const snapshot = await service.apps({ binding_id: binding })
  assert.equal(snapshot.service_state, 'ready')
  assert.equal(snapshot.data_freshness, 'current')
  assert.deepEqual(snapshot.items, [])
  checks.push('authenticated_ssh_loopback_api_read')
  evidence.status = 'PASS'
} catch (error) {
  const code = error?.cause?.message ?? error?.code ?? ''
  evidence.status = 'FAIL'
  evidence.error = /^[A-Z][A-Z0-9_]{1,100}$/.test(code) ? code : 'LIVE_ONBOARDING_CHECK_FAILED'
  process.exitCode = 1
} finally {
  if (binding) {
    try {
      assert.equal((await service.revoke(binding)).state, 'disabled')
      checks.push('temporary_client_revoked')
    } catch {
      evidence.status = 'FAIL'
      evidence.error = 'TEMPORARY_CLIENT_REVOCATION_UNCONFIRMED'
      process.exitCode = 1
    }
  }
  await ssh.disconnectAll()
  closeDatabase()
  // Only this run's nonce directory may be removed; retain nonsensitive evidence/bundle.
  assert.equal(dirname(local), directory)
  assert.ok(directory.startsWith(parent + sep))
  assert.match(nonce, /^[a-f0-9]{16}$/)
  assert.equal(lstatSync(local).isSymbolicLink(), false)
  rmSync(local, { recursive: true })
  evidence.local_db_removed = true
  const fd = openSync(join(directory, 'result.json'), 'wx', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(evidence, null, 2))
  } finally {
    closeSync(fd)
  }
  console.log(JSON.stringify({ ...evidence, evidence_directory: directory }))
}
