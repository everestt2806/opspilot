import assert from 'node:assert/strict'
import { retainedPostgresAppSnapshotCommand } from '../product-postgres-desktop-live/snapshot.mjs'

// Exact readonly8app/2PG development baseline. Passwords/ciphertext/rows never
// leave the host. Database checks use the mounted pgpass file, not secret values.
const addition = String.raw`
def inspector_postgres():
 expected='850c85ec-450c-4b94-b2a4-712387664e1e'
 cid='3e1b0411840e2079b8256c145a451d64d208f25190dd4bb700c0aa13307fa889'
 volume='opspilot-pg-'+expected+'-data'
 assert rows('SELECT database_id,app_id FROM product_managed_postgres ORDER BY app_id')==[{'database_id':'8e397a25-7d99-43b8-9ecb-2a5765a7afcd','app_id':7},{'database_id':expected,'app_id':8}]
 assert rows('SELECT database_id FROM product_source_postgres WHERE app_id=8 AND source_generation=2')==[{'database_id':expected}]
 def fixed(args):
  p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=12,env={'PATH':'/usr/bin:/bin','LC_ALL':'C'})
  assert p.returncode==0 and len(p.stdout)<=8192
  return p.stdout.decode().strip()
 state,image,mounts,ports=fixed(['docker','inspect','--format','{{.State.Running}}|{{.Image}}|{{json .Mounts}}|{{json .HostConfig.PortBindings}}',cid]).split('|',3)
 assert state=='true' and not json.loads(ports)
 mount=[m for m in json.loads(mounts) if m['Destination']=='/var/lib/postgresql/data']
 assert len(mount)==1 and mount[0]['Type']=='volume' and mount[0]['Name']==volume
 sample=fixed(['docker','exec','-u','0','-e','PGCONNECT_TIMEOUT=2','-e','PGPASSFILE=/run/opspilot-secrets/app.pgpass',cid,'psql','--no-password','-h','127.0.0.1','-U','opspilot','-d','opspilot','-Atqc',"SELECT count(*)::text||':'||md5(string_agg(id::text||':'||label,chr(10) ORDER BY id)) FROM acceptance_sample"])
 count,digest=sample.split(':');assert count=='1000' and len(digest)==32
 system=fixed(['docker','exec','-u','0','-e','PGCONNECT_TIMEOUT=2','-e','PGPASSFILE=/run/opspilot-secrets/admin.pgpass',cid,'psql','--no-password','-h','127.0.0.1','-U','postgres','-d','opspilot','-Atqc','SELECT system_identifier::text FROM pg_control_system()'])
 assert system=='7708752679918456877'
 material={t:rows('SELECT * FROM '+t+' ORDER BY 1,2,3') for t in ('product_managed_postgres','product_managed_postgres_request','product_source_postgres','product_postgres_selection_request')}
 return {'database_id':expected,'container_id':cid,'volume':volume,'image_id':image,'system_identifier':system,'data_count':int(count),'data_md5':digest,'material_sha256':hashlib.sha256(json.dumps(material,sort_keys=True,default=lambda v:v.hex(),separators=(',',':')).encode()).hexdigest(),'public_port':None}
`
const anchor = "print(json.dumps({'postgres':retained_postgres(),"
assert.equal(retainedPostgresAppSnapshotCommand.split(anchor).length, 2)
export const inspectorSnapshotCommand = retainedPostgresAppSnapshotCommand.replace(
  anchor,
  addition + "\nprint(json.dumps({'postgres8':inspector_postgres(),'postgres':retained_postgres(),"
)
