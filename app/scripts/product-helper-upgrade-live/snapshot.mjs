import { snapshotCommand } from '../product-environment-live/snapshot.mjs'

// Chỉ fingerprint/digest/inode; không xuất key, ciphertext, token hoặc env values.
const additions = `
def digest_table_material():
 data={t:rows('SELECT * FROM '+t+' ORDER BY app_id') for t in ('product_environment_revision','product_source_environment','product_source_config')}
 return hashlib.sha256(json.dumps(data,sort_keys=True,default=lambda v:v.hex(),separators=(',',':')).encode()).hexdigest()

def helper_metadata():
 result=[]
 for row in rows('SELECT controller_id,app_id,ownership_generation,target_binding_json,manifest_sha256,target_root,state,last_error_code,created_at FROM product_target_enrollment ORDER BY app_id'):
  slot=hashlib.sha256(row['controller_id'].encode()).hexdigest()+'-app-'+str(row['app_id'])
  root=os.path.join(row['target_root'],'controller-'+slot)
  if not root.startswith('/var/lib/opspilot-product/') or os.path.realpath(root)!=root:raise ValueError('TARGET_ROOT_CHANGED')
  names=['helpers/target_execution_guard.py','helpers/target_guarded_ssh_helper.py','helpers/target_product_runtime.py','release-manifest.json','enrollment.json','../.enroll-'+slot+'.lock']
  for base_dir,dirs,files in os.walk(root+'/state',followlinks=False):
   for name in dirs:
    if os.path.islink(os.path.join(base_dir,name)):raise ValueError('UNSAFE_TARGET_STATE')
   names.extend(os.path.relpath(os.path.join(base_dir,name),root) for name in files)
  metadata=[]
  for name in sorted(names):
   p=os.path.join(root,name);info=os.lstat(p)
   if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1:raise ValueError('UNSAFE_TARGET_FILE')
   metadata.append({'path':name,'inode':info.st_ino,'uid':info.st_uid,'mode':stat.S_IMODE(info.st_mode),'size':info.st_size,'sha256':h(p)})
  row['target_binding_sha256']=hashlib.sha256(row.pop('target_binding_json').encode()).hexdigest()
  directories=[]
  for name in ('','state','state/locks'):
   p=os.path.join(root,name);s=os.lstat(p)
   if not stat.S_ISDIR(s.st_mode):raise ValueError('UNSAFE_TARGET_DIRECTORY')
   directories.append({'path':name,'inode':s.st_ino,'uid':s.st_uid,'mode':stat.S_IMODE(s.st_mode)})
  result.append({'enrollment':row,'files':metadata,'directories':directories})
 return result
`
export const helperSnapshotCommand = snapshotCommand
  .replace('{{.Id}}|{{.State.Status}}', '{{.Id}}|{{.Image}}|{{.State.Status}}')
  .replace(
    "'id':fields[0],'status':fields[1],'started_at':fields[2],'restart_count':int(fields[3])",
    "'id':fields[0],'image':fields[1],'status':fields[2],'started_at':fields[3],'restart_count':int(fields[4])"
  )
  .replace(
    'import os,json,sqlite3,hashlib,subprocess',
    'import os,json,sqlite3,hashlib,subprocess,stat'
  )
  .replace(
    "print(json.dumps({'receipt':receipt",
    additions +
      "\nprint(json.dumps({'content_digest':digest_table_material(),'helpers':helper_metadata(),'receipt':receipt"
  )
