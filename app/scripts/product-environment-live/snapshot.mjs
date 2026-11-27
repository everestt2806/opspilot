// Chỉ metadata/digest; không trả ciphertext/secret/env values hoặc Docker Config.Env.
export const snapshotCommand = `python3 - <<'PY'
import os,json,sqlite3,hashlib,subprocess
base='/var/lib/opspilot-controller';state='/var/lib/opspilot-controller-install'
def h(p):
 with open(p,'rb') as f:return hashlib.sha256(f.read()).hexdigest()
c=sqlite3.connect('file:'+base+'/opspilot.db?mode=ro',uri=True);c.row_factory=sqlite3.Row
def rows(sql):return [dict(r) for r in c.execute(sql)]
def protected_digest():
 if c.execute('SELECT max(version) FROM schema_version').fetchone()[0]<35:return None
 tables=('product_environment_revision','product_source_environment','product_source_config','product_target_enrollment')
 data={t:rows('SELECT * FROM '+t+' WHERE app_id<=5 ORDER BY app_id') for t in tables}
 return hashlib.sha256(json.dumps(data,sort_keys=True,default=lambda v:v.hex(),separators=(',',':')).encode()).hexdigest()
def protected_material_digest():
 if c.execute('SELECT max(version) FROM schema_version').fetchone()[0]<35:return None
 data={t:rows('SELECT * FROM '+t+' WHERE app_id<=5 ORDER BY app_id') for t in ('product_environment_revision','product_source_environment','product_source_config')}
 data['target_identity']=rows('SELECT controller_id,app_id,ownership_generation,target_binding_json,manifest_sha256,target_root,state,last_error_code,created_at FROM product_target_enrollment WHERE app_id<=5 ORDER BY app_id')
 return hashlib.sha256(json.dumps(data,sort_keys=True,default=lambda v:v.hex(),separators=(',',':')).encode()).hexdigest()
with open(state+'/receipt.json') as f:receipt=json.load(f)
with open(state+'/upgrade.json') as f:upgrade=json.load(f)
apps=rows('SELECT id,name,current_deployment_id FROM app ORDER BY id')
containers=[]
for app in apps:
 if app['current_deployment_id'] is None:continue
 for suffix in ('app','collector'):
  name=app['name']+'-'+suffix
  p=subprocess.run(['docker','inspect','--format','{{.Id}}|{{.State.Status}}|{{.State.StartedAt}}|{{.RestartCount}}',name],capture_output=True,text=True,timeout=10)
  if p.returncode!=0:raise ValueError('EXPECTED_CONTAINER_MISSING')
  fields=p.stdout.strip().split('|');containers.append({'name':name,'id':fields[0],'status':fields[1],'started_at':fields[2],'restart_count':int(fields[3])})
print(json.dumps({'receipt':receipt,'upgrade':upgrade,'receipt_sha256':h(state+'/receipt.json'),'upgrade_sha256':h(state+'/upgrade.json'),
'database_inode':os.stat(base+'/opspilot.db').st_ino,'schema':c.execute('SELECT max(version) FROM schema_version').fetchone()[0],
'retained_environment_target_digest':protected_digest(),
'retained_material_digest':protected_material_digest(),
'active_experiments':c.execute("SELECT count(*) FROM experiment_run WHERE status='running'").fetchone()[0],
'active_jobs':c.execute("SELECT count(*) FROM product_deploy_job WHERE state NOT IN ('succeeded','failed','rolled_back','superseded','cancelled')").fetchone()[0],
'active_clients':c.execute('SELECT count(*) FROM product_desktop_client WHERE revoked_at IS NULL').fetchone()[0],
'app_leases':c.execute('SELECT count(*) FROM product_app_lease WHERE released_at IS NULL').fetchone()[0],
'worker_leases':c.execute('SELECT count(*) FROM product_worker_lease WHERE released_at IS NULL').fetchone()[0],
'unsettled_terminals':c.execute('SELECT count(*) FROM product_runtime_terminal WHERE settled_at IS NULL OR leases_released_at IS NULL').fetchone()[0],
'prepared_activations':c.execute("SELECT count(*) FROM deployment_activation WHERE state='prepared'").fetchone()[0],
'apps':apps,'containers':containers,
'owners':rows('SELECT app_id,controller_id,ownership_generation,source_generation,auto_deploy_paused FROM product_app_control ORDER BY app_id'),
'desired':rows('SELECT app_id,auto_paused,reconciliation_state FROM product_desired_branch ORDER BY app_id'),
'vps_digest':hashlib.sha256(json.dumps(rows('SELECT id,host,port,username,auth_type,host_fingerprint,ssh_security_revision,hex(encrypted_secret) AS ciphertext,hex(iv) AS iv,hex(auth_tag) AS tag FROM vps ORDER BY id'),sort_keys=True).encode()).hexdigest(),
'files':[{'path':p,'inode':os.stat(base+'/'+p).st_ino,'sha256':h(base+'/'+p)} for p in ('.controller-runtime-key','.product-controller-initialized','.controller-installation')],
'service':subprocess.check_output(['systemctl','show','opspilot-controller-product.service','--property=ActiveState,MainPID,User']).decode()}))
c.close()
PY`
