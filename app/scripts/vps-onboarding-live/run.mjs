import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, lstatSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { privateInput } from '../product-environment-live/input.mjs'

const operation = process.argv.slice(2).join(' ')
assert(['--confirm-readonly-assigned-vps', '--confirm-prepare-assigned-vps'].includes(operation))
const prepareRuntime = operation === '--confirm-prepare-assigned-vps'
const root = resolve(import.meta.dirname, '../../..')
const nonce = randomBytes(6).toString('hex')
const directory = join(root, 'app/.out-scripts/vps-onboarding-live', nonce)
mkdirSync(directory, { recursive: true })
const require = createRequire(join(root, 'app/package.json'))
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const artifact = join(directory, 'entry.cjs')
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
      name: 'raw',
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, (a) => ({
          path: resolve(a.resolveDir, a.path.slice(0, -4)),
          namespace: 'raw'
        }))
        b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
          contents: readFileSync(a.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
const code = require(artifact)
const allowed = new Map([
  ['157.245.195.121', 'SHA256:d1XH2CiZnh4Dy/AoIbI1n3Uo2N1je86U2Wsy3orvxA4'],
  ['188.166.234.163', 'SHA256:jWmoAjdWENXxC2bmfEtx9g85HvjGt7P6mfaRn83XnZ0']
])
const command = `python3 - <<'OPSPILOT_READONLY_INVENTORY'
import datetime,json,platform,pathlib,os,shutil,subprocess,hashlib
def run(args):
    try:
        p=subprocess.run(args,capture_output=True,text=True,timeout=15)
        return {'code':p.returncode,'value':p.stdout.strip()[:1024]}
    except (OSError,subprocess.TimeoutExpired): return {'code':-1,'value':''}
osinfo={}
for line in pathlib.Path('/etc/os-release').read_text().splitlines():
    if '=' in line:
        k,v=line.split('=',1)
        if k in ('ID','VERSION_ID','PRETTY_NAME'): osinfo[k]=v.strip('"')
mem={}
for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
    key,value=line.split(':',1)
    if key in ('MemTotal','MemAvailable'): mem[key]=int(value.split()[0])*1024
disk=shutil.disk_usage('/')
docker=run(['docker','info','--format','{{.ServerVersion}}'])
containers=run(['docker','ps','-aq'])
print(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
'uid':os.geteuid(),'os':osinfo,'architecture':platform.machine(),'libc':list(platform.libc_ver()),
'cpu_count':os.cpu_count(),'memory_bytes':mem,'disk_bytes':{'total':disk.total,'free':disk.free},
'machine_id_sha256':hashlib.sha256(pathlib.Path('/etc/machine-id').read_bytes()).hexdigest(),
'docker':docker,'container_count':len(containers['value'].splitlines()) if containers['code']==0 else None,
'controller_service':run(['systemctl','is-active','opspilot-controller.service']),
'controller_root_exists':pathlib.Path('/opt/opspilot-controller').exists()}))
OPSPILOT_READONLY_INVENTORY`
let inputs, ssh
const profile = join(directory, 'private-profile')
const proof = {
  status: 'RUNNING',
  base_commit: '42c71bf',
  operation,
  checks: [],
  hosts: [],
  remote_mutation_attempted: false,
  private_profile_removed: false,
  main_artifact_sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex')
}
try {
  inputs = await privateInput()
  assert(Array.isArray(inputs) && inputs.length === 2)
  assert.equal(new Set(inputs.map((v) => v.host)).size, 2)
  for (const v of inputs) {
    assert(allowed.has(v.host))
    assert.equal(typeof v.password, 'string')
    assert(v.password.length > 0)
  }
  mkdirSync(profile, { mode: 0o700 })
  const db = code.initializeDatabase(profile)
  const key = randomBytes(32)
  const cipher = new code.AesGcmCredentialCipher(key)
  key.fill(0)
  const repository = new code.VpsRepository(db)
  const onboarding = new code.VpsOnboarding(
    repository,
    new code.VpsService(repository, cipher),
    async (host, port) => {
      const observed = await code.readFirstContactFingerprint(host, port)
      assert.equal(observed, allowed.get(host), 'OPERATOR_PREVIOUS_PIN_CHANGED')
      return observed
    }
  )
  ssh = new code.SshManager((id) => {
    const v = repository.getById(id)
    return {
      host: v.host,
      port: v.port,
      username: v.username,
      authType: v.auth_type,
      hostFingerprint: v.host_fingerprint,
      secret: code.loadSecret(db, cipher, id)
    }
  })
  const preparation = new code.VpsRuntimePreparationService(
    ssh,
    repository,
    new code.VpsService(repository, cipher)
  )
  for (const input of inputs) {
    // Deliberately omit a manual fingerprint: exercise production first-contact onboarding.
    const saved = await onboarding.create({
      name: input.host,
      host: input.host,
      port: 22,
      username: 'root',
      auth_type: 'password',
      secret: input.password
    })
    input.password = ''
    assert.equal(saved.host_fingerprint, allowed.get(saved.host))
    proof.checks.push('automatic_pin_saved_before_auth_' + saved.host)
    let runtime
    if (prepareRuntime) {
      proof.remote_mutation_attempted = true
      console.log('PREPARING_RUNTIME ' + saved.host)
      runtime = await preparation.prepare({ vps_id: saved.id, consent: true })
      const again = await preparation.prepare({ vps_id: saved.id, consent: true })
      assert.equal(again.installed_docker, false)
      assert.equal(again.docker_version, runtime.docker_version)
      assert.equal(again.compose_version, runtime.compose_version)
      proof.checks.push('runtime_prepared_and_repeat_does_not_reinstall_' + saved.host)
    }
    const result = await ssh.exec(saved.id, command, {
      logCommand: false,
      retryOnReconnect: false,
      timeoutMs: 60000,
      maxStdoutBytes: 16384,
      maxStderrBytes: 1024
    })
    assert.equal(result.code, 0, 'READONLY_INVENTORY_FAILED')
    const inventory = JSON.parse(result.stdout)
    assert.equal(inventory.uid, 0)
    proof.hosts.push({
      host: saved.host,
      host_fingerprint: saved.host_fingerprint,
      trust: 'USER_AUTHORIZED_FIRST_CONTACT_NOT_CONSOLE_VERIFIED',
      ...(runtime ? { runtime_preparation: runtime } : {}),
      inventory
    })
    proof.checks.push('strict_saved_pin_credential_and_readonly_inventory_' + saved.host)
    await ssh.disconnect(saved.id)
  }
  proof.status = prepareRuntime
    ? 'PASS_RUNTIME_PREPARATION_AND_INVENTORY'
    : 'PASS_READONLY_INVENTORY_ONLY'
} catch (error) {
  proof.status = 'FAIL'
  proof.error = /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code ?? '')
    ? error.code
    : 'VPS_INVENTORY_FAILED'
  process.exitCode = 1
} finally {
  if (Array.isArray(inputs)) for (const v of inputs) v.password = ''
  if (ssh) await ssh.disconnectAll()
  code.closeDatabase()
  try {
    assert.equal(dirname(profile), directory)
    assert.equal(lstatSync(profile).isSymbolicLink(), false)
    rmSync(profile, { recursive: true })
    proof.private_profile_removed = true
  } catch {
    proof.status = 'FAIL'
    proof.error = 'PRIVATE_PROFILE_CLEANUP_FAILED'
    process.exitCode = 1
  }
  writeFileSync(join(directory, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', {
    flag: 'wx'
  })
  console.log(JSON.stringify({ ...proof, evidence_directory: directory }))
}
