/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone readonly preflight CLI tool for Windows delivery */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, basename, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { platform, arch, release } from 'node:os'
import { createServer } from 'node:net'

const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = resolve(SCRIPT_DIR, '../../..')
const APP_DIR = join(REPO_ROOT, 'app')

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function checkPortFree(port) {
  return new Promise((done) => {
    const server = createServer()
    server.once('error', (err) => {
      done({ port, free: false, error: err.code })
    })
    server.once('listening', () => {
      server.close(() => {
        done({ port, free: true })
      })
    })
    server.listen(port, '127.0.0.1')
  })
}

async function inspectPorts(ports = [8765, 8766, 8767]) {
  const results = []
  for (const p of ports) {
    results.push(await checkPortFree(p))
  }
  return results
}

function inspectEnvironment() {
  const osPlatform = platform()
  const osArch = arch()
  const osRelease = release()

  // Node version
  const nodeVersion = process.version
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0], 10)
  const nodeExpected = 'v22.x'
  const nodePass = nodeMajor === 22

  // pnpm version
  let pnpmVersion = null
  let pnpmPass = false
  try {
    const pnpmCheck = spawnSync('pnpm.cmd', ['--version'], {
      windowsHide: true,
      encoding: 'utf8',
      shell: true,
      timeout: 10000
    })
    if (pnpmCheck.status === 0) {
      pnpmVersion = pnpmCheck.stdout.trim()
      pnpmPass = pnpmVersion.startsWith('11.')
    }
  } catch {
    try {
      const pnpmCheck = spawnSync('pnpm', ['--version'], {
        windowsHide: true,
        encoding: 'utf8',
        shell: true,
        timeout: 10000
      })
      if (pnpmCheck.status === 0) {
        pnpmVersion = pnpmCheck.stdout.trim()
        pnpmPass = pnpmVersion.startsWith('11.')
      }
    } catch {
      pnpmVersion = 'not_found'
    }
  }

  // Python version
  let pythonVersion = null
  let pythonPass = false
  try {
    const pyCheck = spawnSync('python', ['--version'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000
    })
    if (pyCheck.status === 0) {
      const match = (pyCheck.stdout || pyCheck.stderr).trim().match(/Python\s+([0-9.]+)/i)
      if (match) {
        pythonVersion = match[1]
        pythonPass = pythonVersion === '3.12.10'
      }
    }
  } catch {
    pythonVersion = 'not_found'
  }

  // WindowsSandbox / Clean OS presence
  const sandboxPath = 'C:\\Windows\\System32\\WindowsSandbox.exe'
  const windowsSandboxPresent = existsSync(sandboxPath)

  return {
    os: {
      platform: osPlatform,
      arch: osArch,
      release: osRelease,
      is_windows: osPlatform === 'win32',
      is_x64: osArch === 'x64'
    },
    node: {
      installed: nodeVersion,
      expected: nodeExpected,
      pass: nodePass
    },
    pnpm: {
      installed: pnpmVersion,
      expected: '11.1.0 (11.x)',
      pass: pnpmPass
    },
    python: {
      installed: pythonVersion,
      expected: '3.12.10',
      pass: pythonPass
    },
    windows_sandbox: {
      path: sandboxPath,
      present: windowsSandboxPresent
    }
  }
}

function inspectPythonDependencies() {
  const lockPath = join(REPO_ROOT, 'ml-service/runtime-lock.json')
  if (!existsSync(lockPath)) {
    return {
      status: 'MISSING_LOCKFILE',
      path: lockPath,
      pass: false
    }
  }

  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  const expectedPackages = lock.packages || {}
  const packageNames = Object.keys(expectedPackages).sort()

  let installedPackages = {}
  let inspectionSucceeded = false
  let inspectionError = null

  try {
    const script = [
      'import importlib.metadata, json, sys',
      'names = json.loads(sys.stdin.read())',
      'res = {}',
      'for n in names:',
      '    try:',
      '        res[n] = importlib.metadata.version(n)',
      '    except Exception:',
      '        res[n] = None',
      'print(json.dumps(res))'
    ].join('\n')

    const pyRun = spawnSync('python', ['-c', script], {
      input: JSON.stringify(packageNames),
      windowsHide: true,
      encoding: 'utf8',
      timeout: 15000
    })

    if (pyRun.status === 0) {
      installedPackages = JSON.parse(pyRun.stdout.trim())
      inspectionSucceeded = true
    } else {
      inspectionError = (pyRun.stderr || '').trim() || `Exit code ${pyRun.status}`
    }
  } catch (err) {
    inspectionError = err.message
  }

  const matched = []
  const mismatched = []
  const missing = []

  for (const name of packageNames) {
    const required = expectedPackages[name]
    const installed = installedPackages[name]
    if (!installed) {
      missing.push({ package: name, required })
    } else if (installed !== required) {
      mismatched.push({ package: name, required, installed })
    } else {
      matched.push({ package: name, version: installed })
    }
  }

  const pass = inspectionSucceeded && mismatched.length === 0 && missing.length === 0

  return {
    lock_file: lockPath,
    expected_python_version: lock.python_version,
    expected_platform: lock.platform,
    total_expected_packages: packageNames.length,
    inspection_succeeded: inspectionSucceeded,
    inspection_error: inspectionError,
    matched_count: matched.length,
    mismatched_count: mismatched.length,
    missing_count: missing.length,
    matched,
    mismatched,
    missing,
    pass
  }
}

function inspectResources() {
  // 1. ML runtime resource
  const mlRuntimeDir = join(APP_DIR, 'resources/ml-runtime')
  const mlManifestPath = join(mlRuntimeDir, 'manifest.json')
  let mlRuntimeStatus = 'MISSING'
  let mlRuntimeDetails = { path: mlRuntimeDir, present: false }

  if (existsSync(mlRuntimeDir)) {
    if (existsSync(mlManifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(mlManifestPath, 'utf8'))
        const manifestSha = hashFile(mlManifestPath)
        const requiredFiles = [
          'python.exe',
          'python312.dll',
          'python312.zip',
          'python312._pth',
          'service/main.py',
          'service/config.py',
          'service/features.py',
          'service/store.py'
        ]
        const missingFiles = requiredFiles.filter((f) => !existsSync(join(mlRuntimeDir, f)))
        if (missingFiles.length === 0) {
          mlRuntimeStatus = 'VALID'
        } else {
          mlRuntimeStatus = 'INCOMPLETE'
        }
        mlRuntimeDetails = {
          path: mlRuntimeDir,
          present: true,
          manifest_sha256: manifestSha,
          manifest_format: manifest.format,
          file_count: manifest.files?.length ?? 0,
          missing_required_files: missingFiles
        }
      } catch (err) {
        mlRuntimeStatus = 'INVALID_MANIFEST'
        mlRuntimeDetails = { path: mlRuntimeDir, present: true, error: err.message }
      }
    } else {
      mlRuntimeStatus = 'MISSING_MANIFEST'
      mlRuntimeDetails = { path: mlRuntimeDir, present: true, manifest_present: false }
    }
  }

  // 2. Controller releases
  const runtimeReleasesDir = join(APP_DIR, 'resources/controller-releases')
  const catalogPath = join(runtimeReleasesDir, 'catalog.json')

  // Read approved descriptors
  const controlPlaneRuntimeDir = join(APP_DIR, 'control-plane-runtime')
  const approvedDescriptorFiles = [
    'desktop-upgrade-release.json',
    'desktop-spa-release.json',
    'desktop-spa-retained-release.json',
    'desktop-next-release.json',
    'desktop-environment-release.json',
    'desktop-active-exposure-release.json',
    'desktop-helper-upgrade-release.json',
    'desktop-postgres-release.json',
    'desktop-project-postgres-release.json'
  ]

  const approvedDescriptors = []
  for (const filename of approvedDescriptorFiles) {
    const fullPath = join(controlPlaneRuntimeDir, filename)
    if (existsSync(fullPath)) {
      try {
        const parsed = JSON.parse(readFileSync(fullPath, 'utf8'))
        approvedDescriptors.push(parsed)
      } catch {}
    }
  }

  const catalogPresent = existsSync(catalogPath)
  let catalogSha = null
  if (catalogPresent) {
    try {
      catalogSha = hashFile(catalogPath)
    } catch {}
  }

  const releasesAudit = []
  let allReleasesValid = catalogPresent && approvedDescriptors.length === 9

  for (const desc of approvedDescriptors) {
    const releaseDir = join(runtimeReleasesDir, desc.release_id, 'release')
    const installerFile = join(runtimeReleasesDir, desc.release_id, 'installer.cjs')
    const releaseExists = existsSync(releaseDir)
    const installerExists = existsSync(installerFile)

    let installerSha = null
    let installerMatch = false
    if (installerExists) {
      try {
        installerSha = hashFile(installerFile)
        installerMatch = installerSha === desc.installer_sha256
      } catch {}
    }

    const itemStatus = releaseExists && installerExists && installerMatch ? 'VALID' : 'MISSING'
    if (itemStatus !== 'VALID') {
      allReleasesValid = false
    }

    releasesAudit.push({
      release_id: desc.release_id,
      expected_release_sha256: desc.release_sha256,
      expected_installer_sha256: desc.installer_sha256,
      release_directory_exists: releaseExists,
      installer_path_exists: installerExists,
      installer_sha_matches: installerMatch,
      status: itemStatus
    })
  }

  return {
    ml_runtime: {
      status: mlRuntimeStatus,
      pass: mlRuntimeStatus === 'VALID',
      ...mlRuntimeDetails
    },
    controller_releases: {
      path: runtimeReleasesDir,
      catalog_present: catalogPresent,
      catalog_sha256: catalogSha,
      approved_descriptors_count: approvedDescriptors.length,
      all_releases_valid: allReleasesValid,
      pass: allReleasesValid,
      releases: releasesAudit
    }
  }
}

function inspectRoleAwareSchema() {
  // Desktop role schema definition
  // From app/src/main/db/index.ts:
  // Desktop applies 001..036 and 038 (037 is controller-only).
  // Total 37 applied migrations, max version = 38.
  const desktopRole = {
    role: 'desktop',
    expected_max_version: 38,
    total_applied_migrations: 37,
    excluded_versions: [37],
    desktop_specific_versions: [30, 31, 34, 36, 38],
    common_versions_29_plus: [32, 33, 35],
    latest_migration_name: '038_desktop_postgres_intent.sql'
  }

  // Controller role schema definition
  // Controller applies 001..029, 032, 033, 035, 037 (30, 31, 34, 36, 38 are desktop-only).
  // Total 33 applied migrations, max version = 37.
  const controllerRole = {
    role: 'controller',
    expected_max_version: 37,
    total_applied_migrations: 33,
    excluded_versions: [30, 31, 34, 36, 38],
    controller_specific_versions: [37],
    common_versions_29_plus: [32, 33, 35],
    latest_migration_name: '037_product_managed_postgres.sql'
  }

  // Audit existing lab harness: app/scripts/windows-release-lab.mjs
  const releaseLabPath = join(APP_DIR, 'scripts/windows-release-lab.mjs')
  let releaseLabSchemaAssert = null
  let releaseLabPass = false
  if (existsSync(releaseLabPath)) {
    const content = readFileSync(releaseLabPath, 'utf8')
    const match = content.match(/assert\.deepEqual\(proof\.sqlite,\s*\{\s*version:\s*(\d+)/)
    if (match) {
      releaseLabSchemaAssert = parseInt(match[1], 10)
      releaseLabPass = releaseLabSchemaAssert === 38
    } else {
      // Check if updated to individual assertions
      const vMatch = content.match(/assert\.equal\(proof\.sqlite\.version,\s*(\d+)/)
      if (vMatch) {
        releaseLabSchemaAssert = parseInt(vMatch[1], 10)
        releaseLabPass = releaseLabSchemaAssert === 38
      }
    }
  }

  return {
    desktop_role: desktopRole,
    controller_role: controllerRole,
    release_lab_audit: {
      path: releaseLabPath,
      asserted_schema_version: releaseLabSchemaAssert,
      expected_schema_version: 38,
      is_updated_to_baseline: releaseLabPass
    }
  }
}

function inspectGitStatus() {
  let headSha = null
  let branch = null
  let isAncestorOfBaseline = false
  let workingTreeClean = false

  try {
    const headRes = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000
    })
    if (headRes.status === 0) headSha = headRes.stdout.trim()

    const branchRes = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: REPO_ROOT,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000
    })
    if (branchRes.status === 0) branch = branchRes.stdout.trim()

    const statusRes = spawnSync('git', ['status', '--short'], {
      cwd: REPO_ROOT,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000
    })
    if (statusRes.status === 0) {
      workingTreeClean = statusRes.stdout.trim().length === 0
    }

    const ancestorRes = spawnSync('git', ['merge-base', '--is-ancestor', 'f699615', 'HEAD'], {
      cwd: REPO_ROOT,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000
    })
    isAncestorOfBaseline = ancestorRes.status === 0
  } catch {}

  return {
    repo_root: REPO_ROOT,
    branch,
    head_sha: headSha,
    baseline_ancestor_verified: isAncestorOfBaseline,
    expected_branch: 'feat/kim-windows-delivery-20261116',
    branch_matches: branch === 'feat/kim-windows-delivery-20261116'
  }
}

export async function runPreflightInventory() {
  const env = inspectEnvironment()
  const git = inspectGitStatus()
  const pythonDeps = inspectPythonDependencies()
  const resources = inspectResources()
  const schema = inspectRoleAwareSchema()
  const ports = await inspectPorts([8765, 8766, 8767])

  const portsFree = ports.every((p) => p.free)

  // Gate readiness evaluations:
  // 1. source_ready: Node 22, pnpm 11, git branch matches
  const sourceReady = env.node.pass && env.pnpm.pass && git.branch_matches

  // 2. package_ready: sourceReady + python 3.12.10 exact + python deps exact + ml_runtime + controller_releases
  const packageReady =
    sourceReady &&
    env.python.pass &&
    pythonDeps.pass &&
    resources.ml_runtime.pass &&
    resources.controller_releases.pass

  // 3. clean_windows_ready: disposable Windows environment available
  const cleanWindowsReady = env.windows_sandbox.present

  // List of active blockers
  const blockers = []

  if (!env.node.pass) {
    blockers.push({
      code: 'NODE_VERSION_MISMATCH',
      gate: 'source',
      description: `Node version ${env.node.installed} does not match required v22.x`,
      owner: 'Kim',
      unblock_condition: 'Configure environment to use Node 22 (e.g. Node 22.17.0)'
    })
  }

  if (!env.pnpm.pass) {
    blockers.push({
      code: 'PNPM_VERSION_MISMATCH',
      gate: 'source',
      description: `pnpm version ${env.pnpm.installed} does not match required 11.1.0 (11.x)`,
      owner: 'Kim',
      unblock_condition: 'Configure environment to use pnpm 11'
    })
  }

  if (!env.python.pass) {
    blockers.push({
      code: 'PYTHON_VERSION_MISMATCH',
      gate: 'package',
      description: `Python version is ${env.python.installed}; runtime lock requires exact 3.12.10`,
      owner: 'Kim/Coordinator',
      unblock_condition: 'Provision isolated Python 3.12.10 build environment matching runtime lock'
    })
  }

  if (!pythonDeps.pass) {
    blockers.push({
      code: 'PYTHON_DEPENDENCIES_MISMATCH',
      gate: 'package',
      description: `Python dependencies have ${pythonDeps.mismatched_count} mismatched and ${pythonDeps.missing_count} missing packages against runtime-lock.json`,
      mismatched_packages: pythonDeps.mismatched,
      owner: 'Kim/Coordinator',
      unblock_condition: 'Install exact locked package versions into the isolated Python 3.12.10 venv'
    })
  }

  if (!resources.ml_runtime.pass) {
    blockers.push({
      code: 'ML_RUNTIME_RESOURCE_MISSING',
      gate: 'package',
      description: `app/resources/ml-runtime is ${resources.ml_runtime.status}`,
      owner: 'Kim/Coordinator',
      unblock_condition: 'Execute build-ml-runtime.py in approved Python 3.12.10 build environment'
    })
  }

  if (!resources.controller_releases.pass) {
    blockers.push({
      code: 'CONTROLLER_RELEASES_MISSING',
      gate: 'package',
      description: 'app/resources/controller-releases lacks approved releases/catalog.json',
      owner: 'Coordinator',
      unblock_condition: 'Provide approved controller release binaries matching 9 approved descriptors'
    })
  }

  if (!cleanWindowsReady) {
    blockers.push({
      code: 'DISPOSABLE_WINDOWS_ENVIRONMENT_UNAVAILABLE',
      gate: 'clean_os',
      description: 'WindowsSandbox.exe not found on development machine; independent VM required for K2',
      owner: 'Kim',
      unblock_condition: 'Prepare dedicated VM/clean Windows machine without developer tools for NSIS installation tests'
    })
  }

  if (!portsFree) {
    blockers.push({
      code: 'ML_PORTS_CONFLICT',
      gate: 'runtime',
      description: 'One or more bundled ML ports (8765-8767) are currently occupied',
      ports: ports.filter((p) => !p.free),
      owner: 'Kim',
      unblock_condition: 'Stop running processes occupying ML ports before running application labs'
    })
  }

  if (!schema.release_lab_audit.is_updated_to_baseline) {
    blockers.push({
      code: 'RELEASE_LAB_OUTDATED_SCHEMA_ASSERTION',
      gate: 'package',
      description: `windows-release-lab.mjs asserts schema ${schema.release_lab_audit.asserted_schema_version} instead of baseline desktop schema 38`,
      owner: 'Kim',
      unblock_condition: 'Update windows-release-lab.mjs to verify desktop schema 38 and role-aware applied migrations'
    })
  }

  return {
    timestamp: new Date().toISOString(),
    tool: 'opspilot-windows-delivery-preflight',
    version: '1.0.0',
    readiness: {
      source_ready: sourceReady,
      package_ready: packageReady,
      clean_windows_ready: cleanWindowsReady,
      ports_ready: portsFree
    },
    gates: {
      source_gate: sourceReady ? 'PASS' : 'FAIL',
      package_gate: packageReady ? 'PASS' : 'BLOCKED',
      clean_windows_gate: cleanWindowsReady ? 'PASS' : 'NOT_RUN'
    },
    blockers_count: blockers.length,
    blockers,
    details: {
      git,
      environment: env,
      python_dependencies: pythonDeps,
      resources,
      role_aware_schema: schema,
      ports
    }
  }
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = process.argv.slice(2)
  const isJson = args.includes('--json')
  const outIndex = args.indexOf('--out')
  const outPath = outIndex !== -1 && args[outIndex + 1] ? resolve(args[outIndex + 1]) : null
  const gateIndex = args.indexOf('--gate')
  const gate = gateIndex !== -1 && args[gateIndex + 1] ? args[gateIndex + 1].toLowerCase() : null

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
OpsPilot Windows Delivery Preflight CLI

Usage:
  node app/scripts/windows-delivery/preflight.mjs [options]

Options:
  --json           Output results exclusively in JSON format
  --out <file>     Write inventory JSON evidence to specified file
  --gate <name>    Enforce gate readiness with exit code (source, package, clean_os, all)
  --help, -h       Show this help message

Exit codes:
  0: Inventory completed (or specified gate passed)
  1: Specified gate requirement not met
  2: Invalid CLI arguments
`)
    process.exit(0)
  }

  runPreflightInventory().then((report) => {
    if (outPath) {
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
    }

    if (isJson) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log('='.repeat(70))
      console.log(' OPSPILOT WINDOWS DELIVERY PREFLIGHT INVENTORY')
      console.log('='.repeat(70))
      console.log(`Timestamp:        ${report.timestamp}`)
      console.log(`Branch:           ${report.details.git.branch} (${report.details.git.head_sha?.slice(0, 8)})`)
      console.log(`OS:               ${report.details.environment.os.platform}-${report.details.environment.os.arch} (${report.details.environment.os.release})`)
      console.log(`Node:             ${report.details.environment.node.installed} [Expected: ${report.details.environment.node.expected}] -> ${report.details.environment.node.pass ? 'OK' : 'MISMATCH'}`)
      console.log(`pnpm:             ${report.details.environment.pnpm.installed} [Expected: ${report.details.environment.pnpm.expected}] -> ${report.details.environment.pnpm.pass ? 'OK' : 'MISMATCH'}`)
      console.log(`Python:           ${report.details.environment.python.installed} [Expected: ${report.details.environment.python.expected}] -> ${report.details.environment.python.pass ? 'OK' : 'MISMATCH'}`)
      console.log(`Windows Sandbox:  ${report.details.environment.windows_sandbox.present ? 'AVAILABLE' : 'ABSENT'}`)
      console.log('-'.repeat(70))
      console.log(`ML Packages:      ${report.details.python_dependencies.matched_count}/${report.details.python_dependencies.total_expected_packages} matched (${report.details.python_dependencies.mismatched_count} mismatched, ${report.details.python_dependencies.missing_count} missing)`)
      console.log(`ML Runtime Res:   ${report.details.resources.ml_runtime.status}`)
      console.log(`Controller Res:   ${report.details.resources.controller_releases.catalog_present ? 'CATALOG_PRESENT' : 'CATALOG_MISSING'} (${report.details.resources.controller_releases.approved_descriptors_count} approved descriptors)`)
      console.log(`Schema Audit:     Desktop expected=38, Lab asserted=${report.details.role_aware_schema.release_lab_audit.asserted_schema_version} -> ${report.details.role_aware_schema.release_lab_audit.is_updated_to_baseline ? 'OK' : 'OUTDATED'}`)
      console.log(`Ports 8765-8767:  ${report.readiness.ports_ready ? 'ALL_FREE' : 'IN_USE'}`)
      console.log('-'.repeat(70))
      console.log('GATE READINESS SUMMARY:')
      console.log(`  Source Ready:   ${report.readiness.source_ready ? 'PASS' : 'FAIL'}`)
      console.log(`  Package Ready:  ${report.readiness.package_ready ? 'PASS' : 'BLOCKED (' + report.blockers.filter(b => b.gate === 'package').length + ' blockers)'}`)
      console.log(`  Clean OS Ready: ${report.readiness.clean_windows_ready ? 'PASS' : 'NOT_RUN (No disposable VM)'}`)
      console.log('-'.repeat(70))
      if (report.blockers.length > 0) {
        console.log(`ACTIVE BLOCKERS (${report.blockers.length}):`)
        for (const [i, b] of report.blockers.entries()) {
          console.log(`  ${i + 1}. [${b.code}] (${b.gate.toUpperCase()})`)
          console.log(`     Desc:    ${b.description}`)
          console.log(`     Owner:   ${b.owner}`)
          console.log(`     Unblock: ${b.unblock_condition}`)
        }
      }
      console.log('='.repeat(70))
      if (outPath) {
        console.log(`Evidence saved to: ${outPath}`)
      }
    }

    if (gate) {
      if (gate === 'source') {
        process.exitCode = report.readiness.source_ready ? 0 : 1
      } else if (gate === 'package') {
        process.exitCode = report.readiness.package_ready ? 0 : 1
      } else if (gate === 'clean_os') {
        process.exitCode = report.readiness.clean_windows_ready ? 0 : 1
      } else if (gate === 'all') {
        process.exitCode = (report.readiness.source_ready && report.readiness.package_ready && report.readiness.clean_windows_ready) ? 0 : 1
      } else {
        console.error(`Unknown gate: ${gate}. Valid gates: source, package, clean_os, all`)
        process.exitCode = 2
      }
    } else {
      process.exitCode = 0
    }
  }).catch((err) => {
    console.error(`Preflight execution failed: ${err.message}`)
    process.exitCode = 2
  })
}
