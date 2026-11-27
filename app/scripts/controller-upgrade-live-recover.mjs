// Explicit development journal recovery, never a replay.
import assert from 'node:assert/strict'
import { journalKey } from './controller-upgrade-live/journal-key.mjs'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
const nonce = process.argv[2],
  operation = process.argv[3]
if (
  process.argv.length !== 4 ||
  !/^[a-f0-9]{16}$/.test(nonce ?? '') ||
  !['--inspect', '--recover'].includes(operation)
) {
  console.log('{"status":"REJECTED","error_code":"EXPLICIT_KNOWN_DEVELOPMENT_RECORD_REQUIRED"}')
  process.exit(2)
}
const project = resolve(import.meta.dirname, '..'),
  require = createRequire(join(project, 'package.json')),
  directory = join(project, '.out-scripts/controller-upgrade-live', nonce),
  local = join(directory, 'private-profile')
if (!existsSync(local) || realpathSync(local) !== resolve(local)) {
  console.log('{"status":"REJECTED","error_code":"KNOWN_PENDING_UPGRADE_REQUIRED"}')
  process.exit(2)
}
const old = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'))
if (old.status === 'PASS' || old.production_profile_used !== false || !old.upgrade?.request_key)
  throw Error('KNOWN_PENDING_UPGRADE_REQUIRED')
let db, ssh
const result = { status: 'FAIL', operation, production_profile_used: false, implicit_replay: false }
try {
  const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
  await esbuild.build({
    entryPoints: [join(project, 'scripts/controller-upgrade-live/entry.ts')],
    outfile: join(directory, 'recovery-entry.cjs'),
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
  const code = require(join(directory, 'recovery-entry.cjs')),
    key = journalKey(local, false),
    cipher = new code.AesGcmCredentialCipher(key),
    verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
  verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
  const resources = new code.ControllerInstallerResources(
    verifier.builtinControllerInstallerCatalog(),
    join(project, 'resources/controller-releases')
  )
  key.fill(0)
  db = code.initializeDatabase(local)
  const repository = new code.VpsRepository(db)
  ssh = new code.SshManager((id) => {
    const v = repository.getById(id)
    assert.equal(v.host, '167.71.202.116')
    assert.equal(v.host_fingerprint, 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E')
    return {
      host: v.host,
      port: v.port,
      username: v.username,
      authType: v.auth_type,
      hostFingerprint: v.host_fingerprint,
      secret: code.loadSecret(db, cipher, id)
    }
  })
  const service = new code.DesktopControllerService(
    db,
    cipher,
    ssh,
    undefined,
    resources.entries(),
    resources
  )
  result.before = await service.inspectUpgrade(old.upgrade.request_key)
  assert.equal(result.before.installation_request_key, '7573f0b1-4262-4305-8b7d-9a1edce49626')
  if (operation === '--recover' && result.before.state === 'outcome_unknown')
    result.after = await service.sendUpgrade({
      request_key: old.upgrade.request_key,
      operation: 'recover',
      consent: true
    })
  else result.after = result.before
  result.status = ['active', 'rolled_back'].includes(result.after.state) ? 'PASS' : 'UNRESOLVED'
} catch (error) {
  const code = error?.context?.cause?.message ?? error?.code
  result.error_code =
    typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(code)
      ? code
      : 'EXPLICIT_RECOVERY_FAILED'
} finally {
  await ssh?.disconnectAll()
  if (db?.open) db.close()
  writeFileSync(join(directory, 'recovery.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(
    JSON.stringify({
      status: result.status,
      operation,
      state: result.after?.state,
      error_code: result.error_code
    })
  )
  process.exit(result.status === 'PASS' ? 0 : 1)
}
