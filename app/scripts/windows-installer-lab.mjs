/* eslint-disable @typescript-eslint/explicit-function-return-type -- NSIS fixture riêng, không dùng production appId/GUID/executable name. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

const project = resolve(import.meta.dirname, '..'),
  require = createRequire(import.meta.url)
if (
  process.platform !== 'win32' ||
  !process.version.startsWith('v22.') ||
  process.argv.length !== 5 ||
  !['--build', '--run'].includes(process.argv[2]) ||
  process.argv[3] !== (process.argv[2] === '--build' ? '--artifact' : '--record')
) {
  console.log('{"status":"REJECTED","error":"EXPLICIT_WINDOWS_NSIS_FIXTURE_REQUIRED"}')
  process.exit(2)
}
const base = join(project, '.out-scripts/windows-installer-lab')
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const system = process.env.SystemRoot ?? 'C:\\Windows'
const powershell = join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe')
function registry(guid) {
  assert(/^[a-f0-9-]{36}$/.test(guid))
  const result = spawnSync(
    powershell,
    [
      '-NoProfile',
      '-Command',
      `$paths=@('HKCU:\\Software\\${guid}','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}'); @($paths | Where-Object { Test-Path -LiteralPath $_ }) | ConvertTo-Json -Compress`
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 }
  )
  assert.equal(result.status, 0)
  return result.stdout.trim() ? JSON.parse(result.stdout) : []
}
function copy(source, destination) {
  const stat = lstatSync(source)
  assert(!stat.isSymbolicLink())
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true })
    for (const name of readdirSync(source)) copy(join(source, name), join(destination, name))
  } else {
    assert(stat.isFile())
    copyFileSync(source, destination)
  }
}
function owned(directory, nonce) {
  assert(/^[a-f0-9]{12}$/.test(nonce))
  assert.equal(dirname(directory), base)
  assert.equal(realpathSync(directory), resolve(directory))
  assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), nonce)
}
if (process.argv[2] === '--build') {
  const artifact = realpathSync(resolve(process.argv[4]))
  assert(artifact.startsWith(join(project, '.out-scripts') + sep))
  require(join(project, 'out/main/mlResourceVerifier.js')).verifyPackagedMlResources(
    join(artifact, 'resources')
  )
  const nonce = randomBytes(6).toString('hex'),
    guid = randomUUID(),
    directory = join(base, nonce)
  assert(!existsSync(directory))
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '.owner'), nonce, { flag: 'wx' })
  assert.deepEqual(registry(guid), [])
  const staged = join(directory, 'prepackaged'),
    executableName = 'OpsPilotReleaseLab' + nonce
  copy(artifact, staged)
  renameSync(join(staged, 'OpsPilot.exe'), join(staged, executableName + '.exe'))
  const config = {
    extends: join(project, 'electron-builder.yml'),
    appId: 'vn.opspilot.release-lab.' + nonce,
    productName: 'OpsPilot Release Lab ' + nonce,
    directories: { output: directory },
    win: { executableName },
    nsis: {
      guid,
      artifactName: 'OpsPilot-Release-Lab.exe',
      runAfterFinish: false,
      perMachine: false,
      allowElevation: false,
      createDesktopShortcut: false,
      createStartMenuShortcut: false,
      deleteAppDataOnUninstall: false,
      uninstallDisplayName: 'OpsPilot Release Lab ' + nonce
    }
  }
  const plan = {
    nonce,
    guid,
    source_artifact: artifact,
    installation_directory: join(directory, 'install', 'OpsPilot'),
    executable_name: executableName + '.exe',
    installer: join(directory, 'OpsPilot-Release-Lab.exe'),
    config_sha256: '',
    source_sha256: {
      exe: hash(join(artifact, 'OpsPilot.exe')),
      asar: hash(join(artifact, 'resources/app.asar'))
    }
  }
  const configuration = join(directory, 'builder.json')
  writeFileSync(configuration, JSON.stringify(config, null, 2) + '\n')
  plan.config_sha256 = hash(configuration)
  writeFileSync(join(directory, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
  const cli = join(dirname(require.resolve('electron-builder/package.json')), 'cli.js')
  const result = spawnSync(
    process.execPath,
    [
      cli,
      '--win',
      'nsis',
      '--x64',
      '--publish',
      'never',
      '--prepackaged',
      staged,
      '--config',
      configuration
    ],
    { cwd: project, windowsHide: true, stdio: 'inherit', timeout: 600000 }
  )
  assert.equal(result.status, 0, 'LAB_NSIS_BUILD_FAILED')
  owned(directory, nonce)
  assert.equal(hash(configuration), plan.config_sha256)
  plan.installer_sha256 = hash(plan.installer)
  writeFileSync(join(directory, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
  console.log(
    JSON.stringify({
      status: 'PASS',
      mode: 'BUILD',
      record: nonce,
      installer_sha256: plan.installer_sha256
    })
  )
} else {
  const nonce = process.argv[4],
    directory = resolve(base, nonce)
  owned(directory, nonce)
  const plan = JSON.parse(readFileSync(join(directory, 'plan.json'), 'utf8'))
  assert.equal(plan.nonce, nonce)
  assert.equal(plan.installation_directory, join(directory, 'install', 'OpsPilot'))
  assert.equal(plan.installer, join(directory, 'OpsPilot-Release-Lab.exe'))
  assert.equal(plan.executable_name, 'OpsPilotReleaseLab' + nonce + '.exe')
  assert.equal(hash(join(directory, 'builder.json')), plan.config_sha256)
  assert.equal(hash(plan.installer), plan.installer_sha256)
  assert.deepEqual(registry(plan.guid), [])
  assert(!existsSync(plan.installation_directory), 'INSTALLATION_ALREADY_EXISTS')
  const installed = spawnSync(plan.installer, ['/S', '/D=' + plan.installation_directory], {
    windowsHide: true,
    cwd: directory,
    timeout: 180000
  })
  assert.equal(installed.status, 0, 'LAB_NSIS_INSTALL_FAILED')
  assert.equal(realpathSync(plan.installation_directory), resolve(plan.installation_directory))
  assert.equal(
    hash(join(plan.installation_directory, plan.executable_name)),
    plan.source_sha256.exe
  )
  assert.equal(
    hash(join(plan.installation_directory, 'resources/app.asar')),
    plan.source_sha256.asar
  )
  assert(registry(plan.guid).length > 0, 'FIXTURE_REGISTRY_NOT_WRITTEN')
  const application = spawnSync(
    process.execPath,
    [
      join(project, 'scripts/windows-release-lab.mjs'),
      '--run',
      '--artifact',
      plan.installation_directory,
      '--reinstall',
      plan.installer
    ],
    { cwd: resolve(project, '..'), windowsHide: true, encoding: 'utf8', timeout: 360000 }
  )
  writeFileSync(
    join(directory, 'application.log'),
    (application.stdout ?? '') + '\n' + (application.stderr ?? '')
  )
  assert.equal(application.status, 0, 'INSTALLED_FULL_APP_GATE_FAILED')
  assert.deepEqual(registry(plan.guid), [], 'FIXTURE_REGISTRY_NOT_REMOVED')
  assert(!existsSync(join(plan.installation_directory, plan.executable_name)))
  const result = {
    status: 'PASS',
    record: nonce,
    unique_app_id_and_guid: true,
    unique_executable_name: true,
    shortcuts_disabled: true,
    production_installer_executed: false,
    clean_windows: false,
    same_version_reinstall_not_version_upgrade: true,
    installed_payload_matches_production: true,
    installer_sha256: plan.installer_sha256,
    registry_removed: true,
    application: application.stdout.trim()
  }
  writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
}
