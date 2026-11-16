import assert from 'node:assert/strict'
import { helperSnapshotCommand } from '../product-helper-upgrade-live/snapshot.mjs'

// Read-only, exact development fixture. Never reads Docker Config.Env or returns
// ciphertext, connection strings, passwords or data rows. Drift refuses rollout.
const addition = String.raw`
def retained_postgres():
 expected_database='8e397a25-7d99-43b8-9ecb-2a5765a7afcd'
 cid='83a8a787e3629431e61791ce6790d9b61f3aa463d5c92226e9af34e0ed4f8b3f'
 volume='opspilot-pg-'+expected_database+'-data'
 resource=rows('SELECT database_id,app_id FROM product_managed_postgres ORDER BY database_id')
 assert resource==[{'database_id':expected_database,'app_id':7}]
 selected=rows('SELECT database_id FROM product_source_postgres WHERE app_id=7 AND source_generation=2')
 assert selected==[{'database_id':expected_database}]
 material={table:rows('SELECT * FROM '+table+' ORDER BY 1,2,3') for table in ('product_managed_postgres','product_managed_postgres_request','product_source_postgres','product_postgres_selection_request')}
 material_digest=hashlib.sha256(json.dumps(material,sort_keys=True,default=lambda v:v.hex(),separators=(',',':')).encode()).hexdigest()
 def fixed(args):
  result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=12,env={'PATH':'/usr/bin:/bin','LC_ALL':'C'})
  assert result.returncode==0 and len(result.stdout)<=8192
  return result.stdout.decode().strip()
 state,image,mounts,ports=fixed(['docker','inspect','--format','{{.State.Running}}|{{.Image}}|{{json .Mounts}}|{{json .HostConfig.PortBindings}}',cid]).split('|',3)
 assert state=='true' and not json.loads(ports)
 data_mount=[m for m in json.loads(mounts) if m['Destination']=='/var/lib/postgresql/data']
 assert len(data_mount)==1 and data_mount[0]['Type']=='volume' and data_mount[0]['Name']==volume
 sample=fixed(['docker','exec','-u','0','-e','PGCONNECT_TIMEOUT=2','-e','PGPASSFILE=/run/opspilot-secrets/app.pgpass',cid,'psql','--no-password','-h','127.0.0.1','-U','opspilot','-d','opspilot','-Atqc',"SELECT count(*)::text||':'||md5(string_agg(id::text||':'||label,chr(10) ORDER BY id)) FROM acceptance_sample"])
 count,digest=sample.split(':')
 assert count=='1000' and len(digest)==32
 system=fixed(['docker','exec','-u','0','-e','PGCONNECT_TIMEOUT=2','-e','PGPASSFILE=/run/opspilot-secrets/admin.pgpass',cid,'psql','--no-password','-h','127.0.0.1','-U','postgres','-d','opspilot','-Atqc','SELECT system_identifier::text FROM pg_control_system()'])
 assert system=='7708649593492308006'
 return {'database_id':expected_database,'container_id':cid,'volume':volume,'image_id':image,'system_identifier':system,'data_count':int(count),'data_md5':digest,'material_sha256':material_digest,'resource_count':len(resource),'public_port':None,'original_source_material_sha256':hashlib.sha256(json.dumps({t:rows('SELECT * FROM '+t+' WHERE app_id<=7 ORDER BY app_id') for t in ('product_source_config','product_environment_revision','product_source_environment')},sort_keys=True,default=lambda v:v.hex(),separators=(',',':')).encode()).hexdigest()}
`
const anchor = "print(json.dumps({'content_digest':digest_table_material()"
assert.equal(helperSnapshotCommand.split(anchor).length, 2)
export const desktopPostgresSnapshotCommand = helperSnapshotCommand.replace(
  anchor,
  addition +
    "\nprint(json.dumps({'postgres':retained_postgres(),'content_digest':digest_table_material()"
)

// App acceptance may add a separate owned resource. Only app7's retained material
// is compared; the controller-only variant above still requires exactly one.
const retainedAddition = addition
  .replace(
    'SELECT database_id,app_id FROM product_managed_postgres ORDER BY database_id',
    'SELECT database_id,app_id FROM product_managed_postgres WHERE app_id=7 ORDER BY database_id'
  )
  .replace(
    "rows('SELECT * FROM '+table+' ORDER BY 1,2,3')",
    "rows('SELECT * FROM '+table+(\" WHERE app_id=7\" if table=='product_postgres_selection_request' else \" WHERE database_id='\"+expected_database+\"'\")+' ORDER BY 1,2,3')"
  )

export const retainedPostgresAppSnapshotCommand = helperSnapshotCommand.replace(
  anchor,
  retainedAddition +
    "\nprint(json.dumps({'postgres':retained_postgres(),'content_digest':digest_table_material()"
)
