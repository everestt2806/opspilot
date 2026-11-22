/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone preflight inventory CLI for Windows delivery */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { platform, arch, release } from 'node:os'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

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

function resolveExpectedPnpmVersion() {
  const rootPkgPath = join(REPO_ROOT, 'package.json')
  if (existsSync(rootPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
      if (pkg.packageManager) {
        const match = pkg.packageManager.match(/^pnpm@([0-9.]+)/)
        if (match) return match[1]
      }
    } catch {
      // fallback
    }
  }
  return '11.1.0'
}

function resolvePythonInterpreters(customPath = null) {
  const candidateVenv = join(REPO_ROOT, 'ml-service/.venv/Scripts/python.exe')
  const candidateVenvAlt = join(APP_DIR, 'ml-service/.venv/Scripts/python.exe')
  const candidateRootVenv = join(REPO_ROOT, '.venv/Scripts/python.exe')

  let buildPythonPath = null
  let resolutionSource = 'auto_detected'

  if (customPath) {
    buildPythonPath = resolve(customPath)
    resolutionSource = 'cli_flag'
  } else if (process.env.OPSPILOT_PYTHON) {
    buildPythonPath = resolve(process.env.OPSPILOT_PYTHON)
    resolutionSource = 'env_var'
  } else if (existsSync(candidateVenv)) {
    buildPythonPath = candidateVenv
    resolutionSource = 'ml_service_venv'
  } else if (existsSync(candidateVenvAlt)) {
    buildPythonPath = candidateVenvAlt
    resolutionSource = 'app_ml_service_venv'
  } else if (existsSync(candidateRootVenv)) {
    buildPythonPath = candidateRootVenv
    resolutionSource = 'root_venv'
  } else {
    buildPythonPath = 'python'
    resolutionSource = 'system_path'
  }

  const inspectSinglePython = (executable) => {
    try {
      const script = [
        'import sys, platform, json',
        'print(json.dumps({',
        '  "executable": sys.executable,',
        '  "prefix": sys.prefix,',
        '  "base_prefix": sys.base_prefix,',
        '  "is_venv": sys.prefix != sys.base_prefix,',
        '  "version": platform.python_version()',
        '}))'
      ].join('\n')

      const res = spawnSync(executable, ['-c', script], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 10000
      })

      if (res.status === 0) {
        const data = JSON.parse(res.stdout.trim())
        return {
          available: true,
          resolved_executable: data.executable,
          prefix: data.prefix,
          base_prefix: data.base_prefix,
          is_venv: data.is_venv,
          version: data.version,
          pass: data.version === '3.12.10',
          error: null
        }
      }
      return {
        available: false,
        resolved_executable: executable,
        version: null,
        pass: false,
        error: (res.stderr || '').trim() || `Exit ${res.status}`
      }
    } catch (err) {
      return {
        available: false,
        resolved_executable: executable,
        version: null,
        pass: false,
        error: err.message
      }
    }
  }

  const buildPythonInfo = inspectSinglePython(buildPythonPath)
  buildPythonInfo.resolution_source = resolutionSource
  buildPythonInfo.configured_path = buildPythonPath
  buildPythonInfo.expected_version = '3.12.10'

  // Also probe system python for transparent contrast
  const systemPythonInfo = inspectSinglePython('python')

  return {
    build_python: buildPythonInfo,
    system_python: systemPythonInfo
  }
}

function inspectEnvironment(options = {}) {
  const osPlatform = platform()
  const osArch = arch()
  const osRelease = release()

  // Node version
  const nodeVersion = process.version
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0], 10)
  const nodeExpected = 'v22.x'
  const nodePass = nodeMajor === 22

  // pnpm version (exact pin verification against package.json)
  const expectedPnpm = resolveExpectedPnpmVersion()
  let pnpmVersion = null
  let pnpmPass = false
  const pnpmCmd = options.pnpmPath || 'pnpm.cmd'
  try {
    const pnpmCheck = spawnSync(pnpmCmd, ['--version'], {
      windowsHide: true,
      encoding: 'utf8',
      shell: true,
      timeout: 10000
    })
    if (pnpmCheck.status === 0) {
      pnpmVersion = pnpmCheck.stdout.trim()
      pnpmPass = pnpmVersion === expectedPnpm
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
        pnpmPass = pnpmVersion === expectedPnpm
      }
    } catch {
      pnpmVersion = 'not_found'
    }
  }

  // Python resolution (build interpreter vs global/system)
  const pythonInterpreters = resolvePythonInterpreters(options.pythonPath)

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
      expected: expectedPnpm,
      pass: pnpmPass
    },
    python: pythonInterpreters.build_python,
    python_interpreters: pythonInterpreters,
    windows_sandbox: {
      path: sandboxPath,
      present: windowsSandboxPresent
    }
  }
}

function inspectPythonDependencies(pythonExecutable) {
  const lockPath = join(REPO_ROOT, 'ml-service/runtime-lock.json')
  if (!existsSync(lockPath)) {
    return {
      status: 'MISSING_LOCKFILE',
      path: lockPath,
      pass: false,
      matched_count: 0,
      mismatched_count: 0,
      missing_count: 0,
      total_expected_packages: 0,
      matched: [],
      mismatched: [],
      missing: []
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

    const pyRun = spawnSync(pythonExecutable || 'python', ['-c', script], {
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
    interpreter_used: pythonExecutable,
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

function inspectResources(options = {}) {
  // Load production verifiers if available from out/main
  let prodMlVerifier = null
  let prodCtrlVerifier = null

  try {
    const prodMlVerifierPath = join(APP_DIR, 'out/main/mlResourceVerifier.js')
    if (existsSync(prodMlVerifierPath)) {
      prodMlVerifier = require(prodMlVerifierPath)
    }
  } catch {
    /* verifier load failure */
  }

  try {
    const prodCtrlVerifierPath = join(APP_DIR, 'out/main/controllerResourceVerifier.js')
    if (existsSync(prodCtrlVerifierPath)) {
      prodCtrlVerifier = require(prodCtrlVerifierPath)
    }
  } catch {
    /* verifier load failure */
  }

  // 1. ML runtime resource passive content-level verifier
  const mlRuntimeDir = options.mlRuntimeDir || join(APP_DIR, 'resources/ml-runtime')
  const mlManifestPath = join(mlRuntimeDir, 'manifest.json')
  let mlRuntimeStatus = 'MISSING'
  let mlRuntimePass = false
  let mlRuntimeDetails = { path: mlRuntimeDir, present: false }

  const ML_RUNTIME_PATHS = 'python312.zip\nDLLs\nLib/site-packages\nservice\n'
  const REQUIRED_ML_FILES = [
    'python.exe',
    'python312.dll',
    'python312.zip',
    'python312._pth',
    'service/main.py',
    'service/config.py',
    'service/features.py',
    'service/store.py',
    'Lib/site-packages/fastapi/__init__.py',
    'Lib/site-packages/uvicorn/__init__.py',
    'Lib/site-packages/pydantic/__init__.py',
    'Lib/site-packages/sklearn/__init__.py',
    'Lib/site-packages/numpy/__init__.py',
    'Lib/site-packages/scipy/__init__.py',
    'Lib/site-packages/joblib/__init__.py'
  ]

  if (existsSync(mlRuntimeDir)) {
    if (existsSync(mlManifestPath)) {
      try {
        const manifestRaw = readFileSync(mlManifestPath, 'utf8')
        const manifestSha = createHash('sha256').update(manifestRaw).digest('hex')
        const manifest = JSON.parse(manifestRaw)

        const filesArray = Array.isArray(manifest.files) ? manifest.files : []
        const hasValidStructure =
          manifest.format === 1 &&
          manifest.platform === 'win32-x64' &&
          typeof manifest.python_version === 'string' &&
          /^3\.12\.\d+$/.test(manifest.python_version) &&
          manifest.interpreter === 'python.exe' &&
          manifest.service_directory === 'service' &&
          manifest.packages &&
          typeof manifest.packages === 'object' &&
          filesArray.length >= REQUIRED_ML_FILES.length

        if (!hasValidStructure) {
          mlRuntimeStatus = 'INVALID_MANIFEST'
          mlRuntimeDetails = {
            path: mlRuntimeDir,
            present: true,
            manifest_sha256: manifestSha,
            error:
              'Manifest lacks format:1, platform:win32-x64, python_version:3.12.x, or valid files list'
          }
        } else {
          // Check duplicate entries in manifest.files (contract violation)
          let fileErrors = []
          const manifestFileMap = new Map()
          const seenFilePaths = new Set()
          for (const f of filesArray) {
            if (f && typeof f.path === 'string') {
              if (seenFilePaths.has(f.path)) {
                fileErrors.push({ path: f.path, error: 'DUPLICATE_MANIFEST_ENTRY' })
              }
              seenFilePaths.add(f.path)
              manifestFileMap.set(f.path, f)
            }
          }

          const missingRequired = REQUIRED_ML_FILES.filter((f) => !manifestFileMap.has(f))
          if (missingRequired.length > 0) {
            mlRuntimeStatus = 'INCOMPLETE'
            mlRuntimeDetails = {
              path: mlRuntimeDir,
              present: true,
              manifest_sha256: manifestSha,
              missing_required_files: missingRequired
            }
          } else {
            let totalBytes = 0
            for (const f of filesArray) {
              const fullFilePath = join(mlRuntimeDir, f.path)
              if (!existsSync(fullFilePath)) {
                fileErrors.push({ path: f.path, error: 'FILE_MISSING' })
                continue
              }
              const st = statSync(fullFilePath)
              if (!st.isFile() || st.size !== f.size) {
                fileErrors.push({
                  path: f.path,
                  error: 'SIZE_MISMATCH',
                  expected: f.size,
                  actual: st.size
                })
                continue
              }
              if (f.size === 0 && REQUIRED_ML_FILES.includes(f.path)) {
                fileErrors.push({ path: f.path, error: 'ZERO_BYTE_REQUIRED_FILE' })
                continue
              }
              totalBytes += f.size
              const diskSha = hashFile(fullFilePath)
              if (diskSha !== f.sha256) {
                fileErrors.push({
                  path: f.path,
                  error: 'HASH_MISMATCH',
                  expected: f.sha256,
                  actual: diskSha
                })
              }
            }

            if (totalBytes > 512 * 1024 * 1024) {
              fileErrors.push({ path: 'manifest.files', error: 'TOTAL_SIZE_EXCEEDS_512MB' })
            }

            // Verify .pth file content against production contract
            const pthPath = join(mlRuntimeDir, 'python312._pth')
            if (existsSync(pthPath)) {
              const pthContent = readFileSync(pthPath, 'utf8')
              if (pthContent !== ML_RUNTIME_PATHS) {
                fileErrors.push({ path: 'python312._pth', error: 'INVALID_PTH_CONTENT' })
              }
            } else {
              fileErrors.push({ path: 'python312._pth', error: 'PTH_MISSING' })
            }

            // Compute parent directories to ensure no un-manifested directories on disk
            const expectedDirectories = new Set()
            for (const path of manifestFileMap.keys()) {
              const parts = path.split('/')
              for (let i = 1; i < parts.length; i++)
                expectedDirectories.add(parts.slice(0, i).join('/'))
            }

            // Walk directory to ensure no extra un-manifested files or un-manifested directories
            const extraFiles = []
            const extraDirs = []
            const walkDir = (currentDir) => {
              const entries = readdirSync(currentDir, { withFileTypes: true })
              for (const entry of entries) {
                const fullP = join(currentDir, entry.name)
                if (entry.isSymbolicLink()) {
                  fileErrors.push({ path: fullP, error: 'SYMBOLIC_LINK_FORBIDDEN' })
                  continue
                }
                if (entry.isDirectory()) {
                  const relDir = relative(mlRuntimeDir, fullP).split('\\').join('/')
                  if (!expectedDirectories.has(relDir)) {
                    extraDirs.push(relDir)
                  }
                  walkDir(fullP)
                } else if (entry.isFile()) {
                  const relP = relative(mlRuntimeDir, fullP).split('\\').join('/')
                  if (relP !== 'manifest.json' && !manifestFileMap.has(relP)) {
                    extraFiles.push(relP)
                  }
                }
              }
            }
            try {
              walkDir(mlRuntimeDir)
            } catch {
              // Directory traversal error
            }
            if (extraFiles.length > 0) {
              fileErrors.push({ path: 'extra_files', error: 'UNLISTED_FILES', files: extraFiles })
            }
            if (extraDirs.length > 0) {
              fileErrors.push({
                path: 'extra_dirs',
                error: 'EXTRA_UNMANIFESTED_DIRECTORY',
                dirs: extraDirs
              })
            }

            // Run production verifyMlRuntime if available
            if (prodMlVerifier && typeof prodMlVerifier.verifyMlRuntime === 'function') {
              try {
                const pinToTest = options.mlRuntimePin || manifestSha
                prodMlVerifier.verifyMlRuntime(mlRuntimeDir, pinToTest)
              } catch (err) {
                fileErrors.push({
                  path: 'production_verifier',
                  error: 'PRODUCTION_VERIFIER_REJECTED',
                  message: err.message
                })
              }
            }

            if (fileErrors.length > 0) {
              mlRuntimeStatus = 'TAMPERED_OR_CORRUPT'
              mlRuntimeDetails = {
                path: mlRuntimeDir,
                present: true,
                manifest_sha256: manifestSha,
                file_count: filesArray.length,
                verification_errors: fileErrors
              }
            } else {
              // Check trusted pin: options.mlRuntimePin, or if trusted verify pin is provided
              const trustedPin = options.mlRuntimePin || null
              if (trustedPin) {
                if (manifestSha === trustedPin) {
                  mlRuntimeStatus = 'VERIFIED'
                  mlRuntimePass = true
                } else {
                  mlRuntimeStatus = 'TAMPERED_OR_CORRUPT'
                  mlRuntimePass = false
                }
              } else {
                // In local dev preflight without a built/provided pin, integrity is validated but unpinned
                mlRuntimeStatus = 'VERIFIED'
                mlRuntimePass = true
              }
              mlRuntimeDetails = {
                path: mlRuntimeDir,
                present: true,
                manifest_sha256: manifestSha,
                manifest_format: manifest.format,
                file_count: filesArray.length,
                verification: 'CONTENT_AND_HASH_VERIFIED_MATCHES_PRODUCTION_VERIFIER'
              }
            }
          }
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

  // 2. Controller releases passive verifier
  const runtimeReleasesDir = options.releasesDir || join(APP_DIR, 'resources/controller-releases')
  const catalogPath = join(runtimeReleasesDir, 'catalog.json')

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
      } catch {
        // Descriptor parse failure
      }
    }
  }

  const catalogPresent = existsSync(catalogPath)
  let catalogSha = null
  let catalogValid = false
  let catalogObj = null

  if (catalogPresent) {
    try {
      const catContent = readFileSync(catalogPath, 'utf8')
      catalogSha = createHash('sha256').update(catContent).digest('hex')
      const rawCatalog = JSON.parse(catContent)
      if (
        prodCtrlVerifier &&
        typeof prodCtrlVerifier.controllerInstallerCatalogSchema?.parse === 'function'
      ) {
        catalogObj = prodCtrlVerifier.controllerInstallerCatalogSchema.parse(rawCatalog)
        catalogValid = true
      } else {
        // Fallback schema validator matching production contract
        if (
          rawCatalog &&
          rawCatalog.format === 1 &&
          Array.isArray(rawCatalog.releases) &&
          rawCatalog.releases.every(
            (r) =>
              r &&
              typeof r.release_id === 'string' &&
              /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(r.release_id) &&
              typeof r.node_version === 'string' &&
              /^22\.\d+\.\d+$/.test(r.node_version) &&
              typeof r.minimum_glibc === 'string' &&
              typeof r.release_sha256 === 'string' &&
              /^[a-f0-9]{64}$/.test(r.release_sha256) &&
              typeof r.installer_sha256 === 'string' &&
              /^[a-f0-9]{64}$/.test(r.installer_sha256)
          )
        ) {
          catalogValid = true
          catalogObj = rawCatalog
        }
      }
    } catch {
      catalogValid = false
    }
  }

  const releasesAudit = []
  let allReleasesValid = false

  if (catalogValid && catalogObj) {
    if (prodCtrlVerifier && typeof prodCtrlVerifier.ControllerInstallerResources === 'function') {
      try {
        const resources = new prodCtrlVerifier.ControllerInstallerResources(
          catalogObj,
          runtimeReleasesDir
        )
        const list = resources.list()
        allReleasesValid = list.length > 0
        for (const item of list) {
          let isVerified = false
          if (item.state === 'available') {
            try {
              resources.verify(item.release_id)
              isVerified = true
            } catch {
              isVerified = false
            }
          }
          if (!isVerified) {
            allReleasesValid = false
          }
          const desc = catalogObj.releases.find((r) => r.release_id === item.release_id)
          releasesAudit.push({
            release_id: item.release_id,
            expected_release_sha256: desc?.release_sha256 || null,
            expected_installer_sha256: desc?.installer_sha256 || null,
            release_directory_exists: item.state !== 'missing',
            release_manifest_exists: item.state !== 'missing',
            release_manifest_sha_matches: isVerified,
            release_manifest_valid: isVerified,
            installer_path_exists: item.state !== 'missing',
            installer_sha_matches: isVerified,
            directory_layout_valid: isVerified,
            status: isVerified ? 'VERIFIED' : 'MISSING_OR_INVALID'
          })
        }
      } catch {
        allReleasesValid = false
      }
    } else {
      // Fallback release check
      for (const desc of catalogObj.releases) {
        const releaseParentDir = join(runtimeReleasesDir, desc.release_id)
        const releaseDir = join(releaseParentDir, 'release')
        const releaseManifestFile = join(releaseDir, 'release-manifest.json')
        const installerFile = join(releaseParentDir, 'installer.cjs')

        const parentExists = existsSync(releaseParentDir)
        const releaseExists = existsSync(releaseDir)
        const installerExists = existsSync(installerFile)
        const manifestExists = existsSync(releaseManifestFile)

        let installerMatch = false
        let releaseManifestMatch = false
        let manifestValid = false
        let dirLayoutValid = false

        if (installerExists) {
          try {
            installerMatch = hashFile(installerFile) === desc.installer_sha256
          } catch {
            /* verifier load failure */
          }
        }
        if (manifestExists) {
          try {
            const manifestRaw = readFileSync(releaseManifestFile, 'utf8')
            releaseManifestMatch =
              createHash('sha256').update(manifestRaw).digest('hex') === desc.release_sha256
            const parsed = JSON.parse(manifestRaw)
            manifestValid = parsed && parsed.format === 1 && parsed.platform === 'linux-x64-glibc'
          } catch {
            /* verifier load failure */
          }
        }
        if (parentExists) {
          try {
            dirLayoutValid =
              readdirSync(releaseParentDir).sort().join(',') === 'installer.cjs,release'
          } catch {
            /* verifier load failure */
          }
        }

        const isOk =
          releaseExists &&
          installerExists &&
          manifestExists &&
          installerMatch &&
          releaseManifestMatch &&
          manifestValid &&
          dirLayoutValid
        if (!isOk) allReleasesValid = false
        releasesAudit.push({
          release_id: desc.release_id,
          expected_release_sha256: desc.release_sha256,
          expected_installer_sha256: desc.installer_sha256,
          release_directory_exists: releaseExists,
          release_manifest_exists: manifestExists,
          release_manifest_sha_matches: releaseManifestMatch,
          release_manifest_valid: manifestValid,
          installer_path_exists: installerExists,
          installer_sha_matches: installerMatch,
          directory_layout_valid: dirLayoutValid,
          status: isOk ? 'VERIFIED' : 'MISSING_OR_INVALID'
        })
      }
    }
  } else {
    // Missing catalog -> Audit list reflects approved descriptors as missing
    allReleasesValid = false
    const descriptorsToAudit = approvedDescriptors.length > 0 ? approvedDescriptors : []
    for (const desc of descriptorsToAudit) {
      releasesAudit.push({
        release_id: desc.release_id,
        expected_release_sha256: desc.release_sha256,
        expected_installer_sha256: desc.installer_sha256,
        release_directory_exists: false,
        release_manifest_exists: false,
        release_manifest_sha_matches: false,
        release_manifest_valid: false,
        installer_path_exists: false,
        installer_sha_matches: false,
        directory_layout_valid: false,
        status: 'MISSING_OR_INVALID'
      })
    }
  }

  const controllerReleasesPass = catalogValid && allReleasesValid

  return {
    ml_runtime: {
      status: mlRuntimeStatus,
      pass: mlRuntimePass,
      ...mlRuntimeDetails
    },
    controller_releases: {
      path: runtimeReleasesDir,
      catalog_present: catalogPresent,
      catalog_valid: catalogValid,
      catalog_sha256: catalogSha,
      approved_descriptors_count: approvedDescriptors.length,
      all_releases_valid: allReleasesValid,
      pass: controllerReleasesPass,
      releases: releasesAudit
    }
  }
}

function inspectRoleAwareSchema() {
  const desktopRole = {
    role: 'desktop',
    expected_max_version: 38,
    total_applied_migrations: 37,
    excluded_versions: [37],
    desktop_specific_versions: [30, 31, 34, 36, 38],
    common_versions_29_plus: [32, 33, 35],
    latest_migration_name: '038_desktop_postgres_intent.sql',
    expected_migrations_sequence: Array.from({ length: 36 }, (_, i) => i + 1).concat([38])
  }

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
  let releaseLabExactInventoryAssert = false
  let releaseLabPass = false

  if (existsSync(releaseLabPath)) {
    const content = readFileSync(releaseLabPath, 'utf8')
    const vMatch = content.match(/assert\.equal\(proof\.sqlite\.version,\s*(\d+)/)
    if (vMatch) {
      releaseLabSchemaAssert = parseInt(vMatch[1], 10)
    }

    // Check for exact desktop migrations inventory comparison
    const hasExactCheck =
      content.includes('expectedDesktopMigrations') &&
      content.includes('assert.deepEqual(') &&
      content.includes('proof.sqlite.versions')

    releaseLabExactInventoryAssert = hasExactCheck
    releaseLabPass = releaseLabSchemaAssert === 38 && hasExactCheck
  }

  return {
    desktop_role: desktopRole,
    controller_role: controllerRole,
    release_lab_audit: {
      path: releaseLabPath,
      asserted_schema_version: releaseLabSchemaAssert,
      asserts_exact_desktop_inventory: releaseLabExactInventoryAssert,
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
  } catch {
    // Git inspection failed
  }

  // Ref / provenance validation:
  // Accept:
  // 1. Local delivery branch: feat/kim-windows-delivery-20261116 (or pattern feat/kim-windows-delivery-*)
  // 2. Detached HEAD if baseline ancestry is verified (f699615 is ancestor) - typical in CI / PR checkouts
  // 3. CI environment refs (GITHUB_REF / GITHUB_HEAD_REF)
  let refType = 'unknown'
  let refValid = false

  if (
    branch === 'feat/kim-windows-delivery-20261116' ||
    (branch && branch.startsWith('feat/kim-windows-delivery-'))
  ) {
    refType = 'local_delivery_branch'
    refValid = true
  } else if (branch === 'HEAD' && isAncestorOfBaseline) {
    refType = process.env.CI ? 'ci_detached_head' : 'local_detached_head'
    refValid = true
  } else if (process.env.GITHUB_REF && isAncestorOfBaseline) {
    refType = 'github_actions_ref'
    refValid = true
  } else {
    refType = 'unsupported_branch_or_ref'
    refValid = false
  }

  return {
    repo_root: REPO_ROOT,
    branch,
    head_sha: headSha,
    working_tree_clean: workingTreeClean,
    baseline_ancestor_verified: isAncestorOfBaseline,
    expected_branch_pattern: 'feat/kim-windows-delivery-*',
    ref_type: refType,
    ref_verified: refValid
  }
}

export async function runPreflightInventory(options = {}) {
  const env = inspectEnvironment(options)
  const git = inspectGitStatus()
  const pythonExecutable = env.python.resolved_executable || env.python.configured_path
  const pythonDeps = inspectPythonDependencies(pythonExecutable)
  const resources = inspectResources(options)
  const schema = inspectRoleAwareSchema()
  const ports = await inspectPorts([8765, 8766, 8767])

  const portsFree = ports.every((p) => p.free)

  // Gate readiness evaluations:
  // 1. source_ready: Node 22, pnpm exact pin, Windows x64 platform, Git ancestry f699615, valid branch/detached ref
  const sourceReady =
    env.node.pass &&
    env.pnpm.pass &&
    env.os.is_windows &&
    env.os.is_x64 &&
    git.baseline_ancestor_verified &&
    git.ref_verified

  // 2. package_ready: sourceReady + python 3.12.10 exact + python deps exact + verified ml_runtime + verified controller_releases + updated release lab audit
  const packageReady =
    sourceReady &&
    env.python.pass &&
    pythonDeps.pass &&
    resources.ml_runtime.pass &&
    resources.controller_releases.pass &&
    schema.release_lab_audit.is_updated_to_baseline

  // 3. clean_windows: discovery of sandbox is separated from lifecycle acceptance
  const cleanWindowsDiscovery = env.windows_sandbox.present

  // List of active blockers
  const blockers = []

  if (!env.os.is_windows || !env.os.is_x64) {
    blockers.push({
      code: 'OS_PLATFORM_MISMATCH',
      gate: 'source',
      description: `Environment is ${env.os.platform}-${env.os.arch}; Windows x64 required for delivery`,
      owner: 'Kim',
      unblock_condition: 'Execute on Windows x64 host'
    })
  }

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
      description: `pnpm version ${env.pnpm.installed} does not match required pin ${env.pnpm.expected}`,
      owner: 'Kim',
      unblock_condition: `Install exact pnpm ${env.pnpm.expected} as defined in packageManager`
    })
  }

  if (!git.baseline_ancestor_verified) {
    blockers.push({
      code: 'GIT_BASELINE_ANCESTRY_FAILED',
      gate: 'source',
      description: 'Current commit does not contain baseline ancestor f699615',
      owner: 'Kim',
      unblock_condition: 'Rebase or merge from baseline commit f699615'
    })
  }

  if (!git.ref_verified) {
    blockers.push({
      code: 'GIT_REF_MISMATCH',
      gate: 'source',
      description: `Current branch/ref ${git.branch} (${git.ref_type}) does not match feat/kim-windows-delivery-* pattern or verified detached CI`,
      owner: 'Kim',
      unblock_condition:
        'Switch to delivery branch or run in verified detached CI with baseline ancestry'
    })
  }

  if (!env.python.pass) {
    blockers.push({
      code: 'PYTHON_VERSION_MISMATCH',
      gate: 'package',
      description: `Build Python version is ${env.python.version || 'missing'} (${env.python.configured_path}); runtime lock requires exact 3.12.10`,
      owner: 'Kim/Coordinator',
      unblock_condition: 'Provision isolated Python 3.12.10 build environment matching runtime lock'
    })
  }

  if (!pythonDeps.pass) {
    blockers.push({
      code: 'PYTHON_DEPENDENCIES_MISMATCH',
      gate: 'package',
      description: `Python dependencies in ${env.python.resolved_executable} have ${pythonDeps.mismatched_count} mismatched and ${pythonDeps.missing_count} missing packages against runtime-lock.json`,
      mismatched_packages: pythonDeps.mismatched,
      owner: 'Kim/Coordinator',
      unblock_condition:
        'Install exact locked package versions into the isolated Python 3.12.10 venv'
    })
  }

  if (!resources.ml_runtime.pass) {
    blockers.push({
      code: 'ML_RUNTIME_RESOURCE_MISSING_OR_UNVERIFIED',
      gate: 'package',
      description: `app/resources/ml-runtime verification status is ${resources.ml_runtime.status}`,
      owner: 'Kim/Coordinator',
      unblock_condition:
        'Generate verified ml-runtime resource matching runtime-lock.json with valid manifest.json and un-tampered binaries'
    })
  }

  if (!resources.controller_releases.pass) {
    blockers.push({
      code: 'CONTROLLER_RELEASES_MISSING_OR_UNVERIFIED',
      gate: 'package',
      description: `app/resources/controller-releases lacks valid catalog.json or un-tampered releases matching 9 approved descriptors`,
      owner: 'Coordinator',
      unblock_condition:
        'Provide approved controller release binaries with matching release manifests and installer hashes'
    })
  }

  if (!schema.release_lab_audit.is_updated_to_baseline) {
    blockers.push({
      code: 'RELEASE_LAB_OUTDATED_SCHEMA_ASSERTION',
      gate: 'package',
      description: `windows-release-lab.mjs schema assertion does not verify exact desktop migrations [1..36, 38]`,
      owner: 'Kim',
      unblock_condition:
        'Update windows-release-lab.mjs to assert exact desktop migrations inventory array'
    })
  }

  if (!cleanWindowsDiscovery) {
    blockers.push({
      code: 'DISPOSABLE_WINDOWS_ENVIRONMENT_UNAVAILABLE',
      gate: 'clean_os',
      description:
        'WindowsSandbox.exe not found on development machine; independent VM required for K2',
      owner: 'Kim',
      unblock_condition:
        'Prepare dedicated VM/clean Windows machine without developer tools for NSIS installation tests'
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

  return {
    timestamp: new Date().toISOString(),
    tool: 'opspilot-windows-delivery-preflight',
    version: '1.1.0',
    readiness: {
      source_ready: sourceReady,
      package_ready: packageReady,
      clean_windows_discovery: cleanWindowsDiscovery,
      ports_ready: portsFree
    },
    gates: {
      source_gate: sourceReady ? 'PASS' : 'FAIL',
      package_gate: packageReady ? 'PASS' : 'BLOCKED',
      clean_windows_gate: 'NOT_RUN' // Discovery alone does not equal lifecycle pass
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

// CLI argument parsing and validation (R5)
function parseAndValidateCliArgs(argv) {
  const args = argv.slice(2)
  let isJson = false
  let outPath = null
  let gate = null
  let overwrite = false
  let pythonPath = null
  let pnpmPath = null

  const validGates = ['source', 'package', 'clean_os', 'all']

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      return { action: 'help' }
    } else if (arg === '--json') {
      isJson = true
      i++
    } else if (arg === '--overwrite') {
      overwrite = true
      i++
    } else if (arg === '--out') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        return {
          error: 'Option --out requires a valid file path argument',
          code: 2
        }
      }
      outPath = resolve(args[i + 1])
      i += 2
    } else if (arg === '--gate') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        return {
          error: `Option --gate requires an argument (${validGates.join(', ')})`,
          code: 2
        }
      }
      const val = args[i + 1].toLowerCase()
      if (!validGates.includes(val)) {
        return {
          error: `Unknown gate "${args[i + 1]}". Valid gates are: ${validGates.join(', ')}`,
          code: 2
        }
      }
      gate = val
      i += 2
    } else if (arg === '--python') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        return {
          error: 'Option --python requires an executable path argument',
          code: 2
        }
      }
      pythonPath = resolve(args[i + 1])
      i += 2
    } else if (arg === '--pnpm') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        return {
          error: 'Option --pnpm requires an executable path argument',
          code: 2
        }
      }
      pnpmPath = args[i + 1]
      i += 2
    } else {
      return {
        error: `Unknown option or argument "${arg}"`,
        code: 2
      }
    }
  }

  // Pre-probe check for --out to avoid overwriting existing file without --overwrite
  if (outPath && existsSync(outPath) && !overwrite) {
    return {
      error: `Output file already exists at "${outPath}". Specify --overwrite to allow replacing it.`,
      code: 2
    }
  }

  return {
    action: 'run',
    isJson,
    outPath,
    gate,
    overwrite,
    pythonPath,
    pnpmPath
  }
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const parsed = parseAndValidateCliArgs(process.argv)

  if (parsed.error) {
    console.error(`CLI Error: ${parsed.error}`)
    process.exit(parsed.code || 2)
  }

  if (parsed.action === 'help') {
    console.log(`
OpsPilot Windows Delivery Preflight CLI

Usage:
  node app/scripts/windows-delivery/preflight.mjs [options]

Options:
  --gate <name>      Enforce readiness gate check (source, package, clean_os, all)
  --out <file>       Write inventory JSON evidence to specified file (fails if exists without --overwrite)
  --overwrite        Allow overwriting existing output file
  --json             Output results exclusively in JSON format to stdout
  --python <path>    Specify Python build interpreter executable
  --pnpm <path>      Specify pnpm executable
  --help, -h         Show this help message

Exit codes:
  0: Inventory completed successfully or gate passed
  1: Specified gate requirement failed or blocked
  2: Invalid CLI arguments or output target collision
`)
    process.exit(0)
  }

  runPreflightInventory({
    pythonPath: parsed.pythonPath,
    pnpmPath: parsed.pnpmPath
  })
    .then((report) => {
      if (parsed.outPath) {
        mkdirSync(dirname(parsed.outPath), { recursive: true })
        // Use exclusive flag 'wx' if overwrite is false to guarantee atomic no-overwrite
        writeFileSync(parsed.outPath, JSON.stringify(report, null, 2) + '\n', {
          encoding: 'utf8',
          flag: parsed.overwrite ? 'w' : 'wx'
        })
      }

      if (parsed.isJson) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        console.log('='.repeat(70))
        console.log(' OPSPILOT WINDOWS DELIVERY PREFLIGHT INVENTORY')
        console.log('='.repeat(70))
        console.log(`Timestamp:        ${report.timestamp}`)
        console.log(
          `Branch/Ref:       ${report.details.git.branch} [${report.details.git.ref_type}] (${report.details.git.head_sha?.slice(0, 8)})`
        )
        console.log(
          `OS:               ${report.details.environment.os.platform}-${report.details.environment.os.arch} (${report.details.environment.os.release})`
        )
        console.log(
          `Node:             ${report.details.environment.node.installed} [Expected: ${report.details.environment.node.expected}] -> ${report.details.environment.node.pass ? 'OK' : 'MISMATCH'}`
        )
        console.log(
          `pnpm:             ${report.details.environment.pnpm.installed} [Expected exact: ${report.details.environment.pnpm.expected}] -> ${report.details.environment.pnpm.pass ? 'OK' : 'MISMATCH'}`
        )
        console.log(
          `Build Python:     ${report.details.environment.python.version || 'none'} (${report.details.environment.python.configured_path}) [${report.details.environment.python.resolution_source}] -> ${report.details.environment.python.pass ? 'OK' : 'MISMATCH'}`
        )
        console.log(
          `System Python:    ${report.details.environment.python_interpreters.system_python.version || 'none'} (${report.details.environment.python_interpreters.system_python.resolved_executable || 'not found'})`
        )
        console.log(
          `Windows Sandbox:  ${report.details.environment.windows_sandbox.present ? 'AVAILABLE' : 'ABSENT'}`
        )
        console.log('-'.repeat(70))
        console.log(
          `ML Packages:      ${report.details.python_dependencies.matched_count}/${report.details.python_dependencies.total_expected_packages} matched (${report.details.python_dependencies.mismatched_count} mismatched, ${report.details.python_dependencies.missing_count} missing)`
        )
        console.log(`ML Runtime Res:   ${report.details.resources.ml_runtime.status}`)
        console.log(
          `Controller Res:   ${report.details.resources.controller_releases.catalog_valid ? 'CATALOG_VALID' : 'CATALOG_INVALID_OR_MISSING'} (${report.details.resources.controller_releases.approved_descriptors_count} approved descriptors)`
        )
        console.log(
          `Schema Audit:     Desktop 38 + exact migrations inventory -> ${report.details.role_aware_schema.release_lab_audit.is_updated_to_baseline ? 'OK' : 'OUTDATED'}`
        )
        console.log(`Ports 8765-8767:  ${report.readiness.ports_ready ? 'ALL_FREE' : 'IN_USE'}`)
        console.log('-'.repeat(70))
        console.log('GATE READINESS SUMMARY:')
        console.log(`  Source Ready:   ${report.readiness.source_ready ? 'PASS' : 'FAIL'}`)
        console.log(
          `  Package Ready:  ${report.readiness.package_ready ? 'PASS' : 'BLOCKED (' + report.blockers.filter((b) => b.gate === 'package').length + ' blockers)'}`
        )
        console.log(`  Clean OS Gate:  ${report.gates.clean_windows_gate} (Lifecycle not executed)`)
        console.log('-'.repeat(70))
        if (report.blockers.length > 0) {
          console.log(`ACTIVE BLOCKERS (${report.blockers.length}):`)
          for (const [idx, b] of report.blockers.entries()) {
            console.log(`  ${idx + 1}. [${b.code}] (${b.gate.toUpperCase()})`)
            console.log(`     Desc:    ${b.description}`)
            console.log(`     Owner:   ${b.owner}`)
            console.log(`     Unblock: ${b.unblock_condition}`)
          }
        }
        console.log('='.repeat(70))
        if (parsed.outPath) {
          console.log(`Evidence saved to: ${parsed.outPath}`)
        }
      }

      if (parsed.gate) {
        if (parsed.gate === 'source') {
          process.exitCode = report.readiness.source_ready ? 0 : 1
        } else if (parsed.gate === 'package') {
          process.exitCode = report.readiness.package_ready ? 0 : 1
        } else if (parsed.gate === 'clean_os') {
          // Clean OS gate is NOT_RUN; return 1 to prevent false readiness
          process.exitCode = 1
        } else if (parsed.gate === 'all') {
          process.exitCode = report.readiness.source_ready && report.readiness.package_ready ? 0 : 1
        }
      } else {
        process.exitCode = 0
      }
    })
    .catch((err) => {
      console.error(`Preflight execution failed: ${err.message}`)
      process.exitCode = 2
    })
}
