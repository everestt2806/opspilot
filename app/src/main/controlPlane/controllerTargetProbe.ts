import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { ProductTargetEnrollmentPayload } from '../../../../docs/contracts/product-target-enrollment'
import type { ProductResourceEvidence } from '../../../../docs/contracts/product-controller-readiness'
import { SshManager } from '../ssh/manager'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { exchangeProductBootstrapJson } from './targetEnrollment'
import { assessProductResources } from './controllerResources'

/** Script cố định được bind trong controller bundle; request chỉ metadata, không app code/secret. */
export const CONTROLLER_TARGET_PROBE = `import sys,json,os,stat,hashlib,subprocess,socket
from pathlib import Path
def private(path):
 s=path.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.geteuid() or s.st_mode&0o077: raise ValueError('metadata')
def read(path):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd)
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.geteuid() or s.st_nlink!=1 or s.st_mode&0o077 or not 0<s.st_size<=32768: raise ValueError('metadata')
  with os.fdopen(os.dup(fd),'rb') as f: data=f.read(32769)
  if len(data)!=s.st_size: raise ValueError('size')
  return data.decode('utf-8')
 finally: os.close(fd)
def command(args):
 p=subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=8,text=True)
 return p.returncode,p.stdout.strip()
def freeport(port):
 try:
  with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as s: s.bind(('0.0.0.0',port))
  return True
 except OSError: return False
try:
 raw=sys.stdin.buffer.read(8193)
 if len(raw)>8192: raise ValueError('limit')
 q=json.loads(raw); p=q['payload']; app=q['app']; base=Path(p['target_root'])
 if not base.is_absolute() or '..' in str(base): raise ValueError('path')
 for ancestor in [*reversed(base.parents)]:
  s=ancestor.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid not in {0,os.geteuid()} or (s.st_mode&0o022 and not(s.st_uid==0 and s.st_mode&stat.S_ISVTX)): raise ValueError('path')
 private(base)
 root=base/('controller-'+hashlib.sha256(p['controller_id'].encode()).hexdigest()+'-app-'+str(p['app_id']))
 if str(root/'state')!=p['state_root'] or str(root/'helpers/target_guarded_ssh_helper.py')!=p['helper_path']: raise ValueError('path')
 private(root); private(root/'helpers'); private(root/'state')
 manifest=read(root/'release-manifest.json')
 if hashlib.sha256(manifest.encode()).hexdigest()!=p['manifest_sha256']: raise ValueError('manifest')
 resources=None
 if q['with_resources']:
  memory={line.split(':',1)[0]:line.split(':',1)[1].strip() for line in Path('/proc/meminfo').read_text().splitlines()}
  available=int(memory['MemAvailable'].split()[0])*1024
  runtime=Path('/opt/opspilot')
  while not runtime.exists(): runtime=runtime.parent
  capacity=min(os.statvfs(root).f_bavail*os.statvfs(root).f_frsize,os.statvfs(runtime).f_bavail*os.statvfs(runtime).f_frsize)
  code,version=command(['docker','info','--format','{{.ServerVersion}}'])
  docker=code==0 and bool(version)
  port=app['host_port']; owned=False
  if type(port)!=int or not 0<port<=65535: raise ValueError('port')
  if app['current_deployment_id'] is not None and docker:
   fmt='{{index .Config.Labels "opspilot.controller_id"}}|{{index .Config.Labels "opspilot.app_id"}}|{{index .Config.Labels "opspilot.deployment_id"}}|{{.State.Status}}|{{json .NetworkSettings.Ports}}'
   code,value=command(['docker','container','inspect','--format',fmt,app['name']+'-app'])
   parts=value.split('|',4)
   if code==0 and len(parts)==5 and parts[:3]==[p['controller_id'],str(p['app_id']),str(app['current_deployment_id'])]:
    mappings=json.loads(parts[4]) or {}
    owned=parts[3]=='running' and any(item.get('HostPort')==str(port) for entries in mappings.values() if entries for item in entries)
    if parts[3]!='running': owned=freeport(port)
   ready=owned
  else: ready=freeport(port)
  resources={'cpu_count':os.cpu_count() or 0,'available_ram_bytes':available,'workspace_available_bytes':capacity,'docker_ready':docker,'port_ready':ready}
 print(json.dumps({'manifest':manifest,'resources':resources},separators=(',',':')))
except Exception:
 print('{"error":"PROBE_UNKNOWN"}')
 sys.exit(1)
`

export async function observeProductTarget(
  database: Database.Database,
  controllerId: string,
  payload: ProductTargetEnrollmentPayload,
  ssh: SshManager,
  withResources: boolean,
  signal?: AbortSignal
): Promise<{ manifest: Buffer; resources: ProductResourceEvidence | null }> {
  const repository = new TargetEnrollmentRepository(database)
  if (payload.controller_id !== controllerId) throw new Error('TARGET_PROBE_AUTHORITY_REJECTED')
  repository.assertCurrent(payload, false)
  const app = database
    .prepare('SELECT name,host_port,current_deployment_id FROM app WHERE id=?')
    .get(payload.app_id) as
    { name: string; host_port: number; current_deployment_id: number | null } | undefined
  if (!app || !/^[a-z0-9][a-z0-9_.-]{0,62}$/.test(app.name) || app.name.includes('..'))
    throw new Error('TARGET_PROBE_AUTHORITY_REJECTED')
  const opened = await ssh.openProductBootstrapChannel(
    payload.target.vps_id,
    {
      text: CONTROLLER_TARGET_PROBE,
      sha256: createHash('sha256').update(CONTROLLER_TARGET_PROBE).digest('hex')
    },
    { signal, timeoutMs: 20_000 }
  )
  try {
    repository.assertCurrent(payload, false)
    const identity = opened.identity,
      target = payload.target
    if (
      identity.vpsId !== target.vps_id ||
      identity.host !== target.host ||
      identity.port !== target.port ||
      identity.hostFingerprint !== target.host_fingerprint ||
      identity.username !== target.username ||
      identity.authType !== target.auth_type
    )
      throw new Error('TARGET_PROBE_AUTHORITY_REJECTED')
    const response = (await exchangeProductBootstrapJson(
      opened.channel,
      JSON.stringify({ payload, app, with_resources: withResources }),
      signal,
      96 * 1024
    )) as { manifest?: string; resources?: unknown }
    repository.assertCurrent(payload, false)
    if (
      !response ||
      Object.keys(response).sort().join(',') !== 'manifest,resources' ||
      typeof response.manifest !== 'string' ||
      Buffer.byteLength(response.manifest) > 32 * 1024 ||
      createHash('sha256').update(response.manifest).digest('hex') !== payload.manifest_sha256
    )
      throw new Error('TARGET_PROBE_INVALID')
    if (
      withResources &&
      assessProductResources(response.resources, true).reason === 'resource_unknown'
    )
      throw new Error('TARGET_PROBE_INVALID')
    return {
      manifest: Buffer.from(response.manifest),
      resources: response.resources as ProductResourceEvidence | null
    }
  } finally {
    opened.channel.destroy()
  }
}
