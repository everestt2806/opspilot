export const snapshotCommand = `python3 - <<'PY'
import os,json,sqlite3,hashlib,subprocess
def h(p):
 with open(p,'rb') as f:return hashlib.sha256(f.read()).hexdigest()
c=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True);c.row_factory=sqlite3.Row
def rows(s):return [dict(r) for r in c.execute(s)]
p='/var/lib/opspilot-controller-install/receipt.json'
with open(p) as f:r=json.load(f)
print(json.dumps({'receipt':r,'upgrade':json.load(open('/var/lib/opspilot-controller-install/upgrade.json')),'upgrade_sha256':h('/var/lib/opspilot-controller-install/upgrade.json'),'receipt_sha256':h(p),'database_inode':os.stat('/var/lib/opspilot-controller/opspilot.db').st_ino,
'schema':c.execute('SELECT max(version) FROM schema_version').fetchone()[0],
'active_experiments':c.execute("SELECT count(*) FROM experiment_run WHERE status='running'").fetchone()[0],
'active_jobs':c.execute("SELECT count(*) FROM product_deploy_job WHERE state NOT IN ('succeeded','failed','rolled_back','superseded','cancelled')").fetchone()[0],
'active_clients':c.execute('SELECT count(*) FROM product_desktop_client WHERE revoked_at IS NULL').fetchone()[0],
'apps':rows('SELECT id,name,current_deployment_id FROM app ORDER BY id'),
'deployment':dict(c.execute('SELECT id,status,git_commit_sha,exposure_status,exposure_evidence_json FROM deployment WHERE id=4').fetchone()),
'desired':rows('SELECT app_id,auto_paused,reconciliation_state FROM product_desired_branch ORDER BY app_id'),
'vps_digest':hashlib.sha256(json.dumps(rows('SELECT id,host,port,username,auth_type,host_fingerprint,ssh_security_revision,hex(encrypted_secret) AS ciphertext,hex(iv) AS iv,hex(auth_tag) AS tag FROM vps ORDER BY id'),sort_keys=True).encode()).hexdigest(),
'files':[{'path':p,'inode':os.stat('/var/lib/opspilot-controller/'+p).st_ino,'sha256':h('/var/lib/opspilot-controller/'+p)} for p in os.listdir('/var/lib/opspilot-controller') if p in ('.controller-runtime-key','.product-controller-initialized','.controller-installation')],
'service':subprocess.check_output(['systemctl','show','opspilot-controller-product.service','--property=ActiveState,MainPID,User']).decode()}))
c.close()
PY`
