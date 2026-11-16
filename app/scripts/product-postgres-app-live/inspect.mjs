import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
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
  const command = `python3 - <<'PY'
import os,json,sqlite3,stat,datetime,math
with open('/var/lib/opspilot-controller-install/upgrade.json') as f:upgrade=json.load(f)
assert upgrade['phase']=='active' and upgrade['request_key']=='aaf2d779-70f8-42f0-8055-d333bd0b6774' and upgrade['release_sha256']=='cc8f33f57ab518c20c75118925522dcc03bb2d2cef04ba94c9bfef101cdb0ddd'
c=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True)
assert c.execute('SELECT max(version) FROM schema_version').fetchone()[0]==37
assert c.execute("SELECT count(*) FROM product_deploy_job WHERE state NOT IN ('succeeded','failed','rolled_back','superseded','cancelled')").fetchone()[0]==0
assert c.execute('SELECT auto_deploy_paused FROM product_app_control WHERE app_id=?',(${app.app_id},)).fetchone()[0]==1
p='/opt/opspilot/${app.app_name}/metrics/latest.json'
s=os.lstat(p);assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<=16384 and os.path.realpath(p)==p
with open(p) as f:value=json.load(f)
age=datetime.datetime.now(datetime.timezone.utc).timestamp()-s.st_mtime
latency=value.get('db_response_ms')
assert 0<=age<=90 and isinstance(latency,(int,float)) and not isinstance(latency,bool) and math.isfinite(latency) and latency>=0
print(json.dumps({'app_id':${app.app_id},'latest_metric_age_seconds':round(age,3),'db_response_ms':latency,'collector_database_probe':'measured','schema':37,'no_jobs_running':True,'policy_paused':True}))
c.close()
PY`
  const result = await ssh.exec(1, command, {
    logCommand: false,
    retryOnReconnect: false,
    timeoutMs: 30000,
    maxStdoutBytes: 4096,
    maxStderrBytes: 1024
  })
  assert.equal(result.code, 0)
  const metric = JSON.parse(result.stdout)
  const proof = {
    status: 'PASS',
    record: nonce,
    SSH_fingerprint_verified: true,
    serving_database_mutated: false,
    production_profile_used: false,
    credentials_persisted: false,
    ...metric,
    checked_at: new Date().toISOString()
  }
  writeFileSync(join(directory, 'metrics-verification.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(JSON.stringify(proof))
} catch {
  console.log('{"status":"FAIL","code":"POSTGRES_METRIC_INSPECTION_FAILED"}')
  process.exitCode = 1
} finally {
  await ssh?.disconnectAll()
  if (config) config.password = ''
}
