// Root relay chỉ chạy CLI đã ghim trong current revision, dưới UID service hiện hữu.
// Không shell interpolation, không ghi packet/key/credential xuống target filesystem.
export const helperRelay = `import os,sys,json,stat,hashlib,subprocess
try:
 raw=sys.stdin.buffer.read(262145)
 if len(raw)>262144:raise ValueError()
 request=json.loads(raw)
 if set(request)!={'command','input','upgrade_key'}:raise ValueError()
 allowed=('review-target-helper-upgrade','prepare-target-helper-upgrade','helper-upgrade-state','apply-target-helper-upgrade','inspect-target-helper-upgrade','recover-target-helper-upgrade','cancel-target-helper-upgrade')
 if request['command'] not in allowed:raise ValueError()
 journal='/var/lib/opspilot-controller-install/upgrade.json'
 info=os.lstat(journal)
 if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)&0o022:raise ValueError()
 with open(journal) as f:current=json.load(f)
 if current['phase']!='active' or current['request_key']!=request['upgrade_key'] or current['release_sha256']!='3782655ddd14e5b88e6fff592cf7415e5652b4c0562af68866b4fd0eae2fadf0':raise ValueError()
 runtime='/opt/opspilot-controller/revisions/'+current['request_key']+'/runtime'
 def sha(p):
  with open(p,'rb') as f:return hashlib.sha256(f.read()).hexdigest()
 if sha(runtime+'/release-manifest.json')!=current['release_sha256'] or sha(runtime+'/payload/bundle-manifest.json')!='5b876a1a55c776722e0f440b4d67bedb45d7ef6118eb203245f5a943c174c029':raise ValueError()
 with open(runtime+'/release-manifest.json') as f:manifest=json.load(f)
 for name in ('node','payload/control-plane.cjs'):
  record=next(r for r in manifest['files'] if r['path']==name)
  p=runtime+'/'+name;s=os.lstat(p)
  if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size!=record['size'] or sha(p)!=record['sha256']:raise ValueError()
 data='/var/lib/opspilot-controller'
 owner=os.stat(data)
 if owner.st_uid!=997:raise ValueError()
 artifact=runtime+'/payload/control-plane.cjs'
 if request['command'] in ('review-target-helper-upgrade','prepare-target-helper-upgrade'):
  if request['input'].get('artifact')!=artifact or request['input'].get('manifest_sha256')!='5b876a1a55c776722e0f440b4d67bedb45d7ef6118eb203245f5a943c174c029':raise ValueError()
 child=subprocess.run(['/usr/bin/setpriv','--reuid',str(owner.st_uid),'--regid',str(owner.st_gid),'--clear-groups','--',runtime+'/node',artifact,request['command'],'--data-dir',data],input=json.dumps(request['input']).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90,env={'PATH':'/usr/bin:/bin','NODE_ENV':'production'},cwd='/')
 if len(child.stdout)>131072:raise ValueError()
 if child.returncode:
  import re
  match=re.search(rb'CONTROL_PLANE_ERROR (TARGET_HELPER_[A-Z_]+)',child.stderr)
  print(json.dumps({'relay_error':match.group(1).decode() if match else 'HELPER_CLI_FAILED'}));sys.exit(0)
 response=json.loads(child.stdout)
 print(json.dumps(response))
except Exception:
 print('{"relay_error":"HELPER_RELAY_REJECTED"}')
 sys.exit(0)
`
