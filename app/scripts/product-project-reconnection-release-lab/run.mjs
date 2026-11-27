import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes, createHash } from 'node:crypto'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  existsSync,
  rmSync,
  realpathSync,
  lstatSync
} from 'node:fs'
import { resolve, join } from 'node:path'
assert.equal(process.argv.slice(2).join(' '), '--confirm-project-reconnection-resources')
const app = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(app, 'package.json')),
  api = require(join(app, 'out/main/controllerResourceVerifier.js')),
  catalog = api.builtinControllerInstallerCatalog(),
  old = JSON.parse(
    readFileSync(join(app, '../docs/ui-redesign/r7h4e4-freeze-verification.json'), 'utf8')
  ).prior_compiled_catalog,
  descriptor = JSON.parse(
    readFileSync(
      join(app, 'control-plane-runtime/desktop-project-reconnection-release.json'),
      'utf8'
    )
  ),
  root = join(app, 'resources/controller-releases'),
  nonce = randomBytes(6).toString('hex'),
  scratch = join(app, '.out-scripts/r7h4e4-resources-' + nonce),
  checks = []
assert.equal(catalog.releases.length, 12)
assert.deepEqual(catalog.releases.slice(0, 11), old.releases)
assert.deepEqual(catalog.releases.at(-1), descriptor)
api.verifyPackagedControllerResources(root)
checks.push('compiled_twelve_releases_exact_and_original_eleven_pins_retained')
const resource = new api.ControllerInstallerResources(catalog, root),
  verified = resource.verify(descriptor.release_id)
assert.equal(
  verified.manifest.payload_sha256,
  '708fbd8274bac5a2fdbf71323c739b93b98bcc5f289b0f7185bcc874b56cbb14'
)
checks.push('actual_release_payload_and_installer_verified_without_execution')
mkdirSync(scratch, { mode: 0o700 })
writeFileSync(join(scratch, '.owner'), nonce, { flag: 'wx' })
let cleanup = false
try {
  cpSync(join(root, descriptor.release_id), join(scratch, descriptor.release_id), {
    recursive: true,
    errorOnExist: true,
    force: false
  })
  const local = new api.ControllerInstallerResources(catalog, scratch),
    file = join(scratch, descriptor.release_id, 'installer.cjs'),
    original = readFileSync(file)
  writeFileSync(
    join(scratch, 'catalog.json'),
    JSON.stringify({ format: 1, releases: [{ ...descriptor, release_sha256: '0'.repeat(64) }] })
  )
  assert.equal(local.verify(descriptor.release_id).entry.release_sha256, descriptor.release_sha256)
  checks.push('runtime_catalog_cannot_replace_compiled_pin')
  writeFileSync(
    file,
    Buffer.concat([original, Buffer.from("\nthrow Error('UNTRUSTED_INSTALLER_MUST_NOT_RUN');\n")])
  )
  assert.throws(() => local.verify(descriptor.release_id), /CONTROLLER_RESOURCES_INVALID/)
  assert.equal(local.list().find((r) => r.release_id === descriptor.release_id).state, 'invalid')
  checks.push('tampered_installer_rejected_before_execution')
  rmSync(file)
  assert.equal(local.list().find((r) => r.release_id === descriptor.release_id).state, 'missing')
  assert.throws(() => local.verify(descriptor.release_id))
  checks.push('missing_installer_rejected_before_execution')
} finally {
  assert.equal(realpathSync(scratch), resolve(app, '.out-scripts', 'r7h4e4-resources-' + nonce))
  assert(!lstatSync(scratch).isSymbolicLink())
  assert.equal(readFileSync(join(scratch, '.owner'), 'utf8'), nonce)
  rmSync(scratch, { recursive: true })
  cleanup = !existsSync(scratch)
}
const proof = {
  status: 'PASS',
  checks,
  compiled_entries: 12,
  prior_pins_retained: true,
  release: descriptor,
  cleanup,
  main_catalog_sha256: createHash('sha256')
    .update(readFileSync(join(app, 'out/main/controller-installer-catalog.json')))
    .digest('hex')
}
writeFileSync(
  join(app, '.out-scripts/r7h4e4-resources.json'),
  JSON.stringify(proof, null, 2) + '\n'
)
console.log(
  JSON.stringify({ status: proof.status, checks: checks.length, compiled_entries: 12, cleanup })
)
