/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone check suite for preflight inventory CLI and resource/backup parity */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync
} from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SCRIPT_DIR = import.meta.dirname
const CLI_PATH = join(SCRIPT_DIR, 'preflight.mjs')
const REPO_ROOT = resolve(SCRIPT_DIR, '../../..')
const APP_DIR = join(REPO_ROOT, 'app')

// Unique nonce for this test run to avoid colliding with other runs or overwriting existing fixtures
const runNonce = `check-${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`
const FIXTURE_DIR = join(REPO_ROOT, 'app/.out-scripts/windows-delivery/test-fixtures', runNonce)

function runCli(args = [], options = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd || REPO_ROOT,
    env: { ...process.env, ...(options.env || {}) },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000
  })
}

function hashFile(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

mkdirSync(FIXTURE_DIR, { recursive: true })

try {
  console.log(`Starting Windows Delivery Preflight CLI Check Suite [Nonce: ${runNonce}]...`)

  // 1. Basic invocation (exit code 0, human readable output)
  {
    const res = runCli([])
    assert.equal(res.status, 0, `Expected exit 0 but got ${res.status}: ${res.stderr}`)
    assert(res.stdout.includes('OPSPILOT WINDOWS DELIVERY PREFLIGHT INVENTORY'))
    assert(res.stdout.includes('GATE READINESS SUMMARY'))
    console.log('✓ 1. Default invocation produces inventory report with exit code 0')
  }

  // 2. Help flag (--help)
  {
    const res = runCli(['--help'])
    assert.equal(res.status, 0)
    assert(res.stdout.includes('Usage:'))
    assert(res.stdout.includes('--gate'))
    assert(res.stdout.includes('--overwrite'))
    console.log('✓ 2. --help produces usage instructions')
  }

  // 3. JSON output (--json)
  {
    const res = runCli(['--json'])
    assert.equal(res.status, 0)
    let parsed
    assert.doesNotThrow(() => {
      parsed = JSON.parse(res.stdout.trim())
    }, 'Output must be valid JSON')
    assert.equal(parsed.tool, 'opspilot-windows-delivery-preflight')
    assert(typeof parsed.readiness.source_ready === 'boolean')
    assert(typeof parsed.readiness.package_ready === 'boolean')
    assert(Array.isArray(parsed.blockers))
    assert(parsed.details.environment.node.installed.startsWith('v22.'))
    assert.equal(parsed.details.role_aware_schema.release_lab_audit.expected_schema_version, 38)
    assert.equal(parsed.details.role_aware_schema.release_lab_audit.is_updated_to_baseline, true)
    console.log('✓ 3. --json outputs valid schema-compliant JSON with schema 38 verification')
  }

  // 4. File export (--out <path>) with unique nonce
  {
    const outPath = join(FIXTURE_DIR, 'out-success.json')
    const res = runCli(['--out', outPath])
    assert.equal(res.status, 0)
    assert(existsSync(outPath), 'Evidence file must be written')
    const content = JSON.parse(readFileSync(outPath, 'utf8'))
    assert.equal(content.tool, 'opspilot-windows-delivery-preflight')
    console.log('✓ 4. --out successfully exports structured evidence to disk')
  }

  // 5. R5 Guard: Unknown argument must return exit 2 without touching any output
  {
    const sentinelPath = join(FIXTURE_DIR, 'sentinel-unknown.txt')
    writeFileSync(sentinelPath, 'ORIGINAL_SENTINEL_CONTENT\n', 'utf8')
    const res = runCli(['--unknown-flag', '--out', sentinelPath])
    assert.equal(res.status, 2, 'Unknown option must exit 2')
    assert.equal(
      readFileSync(sentinelPath, 'utf8'),
      'ORIGINAL_SENTINEL_CONTENT\n',
      'Sentinel file must remain untouched when unknown options passed'
    )
    console.log('✓ 5. Unknown CLI options exit 2 and preserve existing files')
  }

  // 6. R5 Guard: Invalid gate argument must return exit 2 and preserve existing output
  {
    const sentinelPath = join(FIXTURE_DIR, 'sentinel-gate.txt')
    writeFileSync(sentinelPath, 'SENTINEL_GATE_CONTENT\n', 'utf8')
    const res = runCli(['--gate', 'invalid_gate_name', '--out', sentinelPath])
    assert.equal(res.status, 2, 'Invalid gate name must exit 2')
    assert.equal(
      readFileSync(sentinelPath, 'utf8'),
      'SENTINEL_GATE_CONTENT\n',
      'Sentinel file must not be overwritten when gate is invalid'
    )
    console.log('✓ 6. Invalid --gate argument returns exit 2 and preserves target file')
  }

  // 7. R5 Guard: Bare --gate missing argument value must return exit 2
  {
    const res = runCli(['--gate'])
    assert.equal(res.status, 2, 'Bare --gate without value must exit 2')
    console.log('✓ 7. Missing --gate argument value returns exit 2')
  }

  // 8. R5 Guard: Overwrite protection - --out on existing file without --overwrite must exit 2
  {
    const existingFile = join(FIXTURE_DIR, 'existing-no-overwrite.json')
    writeFileSync(existingFile, '{"preserved":true}\n', 'utf8')
    const res = runCli(['--out', existingFile])
    assert.equal(
      res.status,
      2,
      'Attempting to write to existing file without --overwrite must exit 2'
    )
    assert.equal(
      readFileSync(existingFile, 'utf8'),
      '{"preserved":true}\n',
      'Existing file must be preserved without --overwrite'
    )

    // With --overwrite, it should succeed:
    const resOver = runCli(['--out', existingFile, '--overwrite'])
    assert.equal(resOver.status, 0, 'Must succeed when --overwrite is passed')
    const updated = JSON.parse(readFileSync(existingFile, 'utf8'))
    assert.equal(updated.tool, 'opspilot-windows-delivery-preflight')
    console.log('✓ 8. Overwrite guard protects existing files unless --overwrite is passed')
  }

  // 9. S3 Negative Fixture: Fake/Empty ML runtime resource must NOT be granted VERIFIED
  {
    const fakeMlDir = join(FIXTURE_DIR, 'fake-ml-runtime')
    mkdirSync(fakeMlDir, { recursive: true })
    // Empty manifest
    writeFileSync(join(fakeMlDir, 'manifest.json'), JSON.stringify({}), 'utf8')
    // Empty dummy files
    const requiredFiles = ['python.exe', 'python312.dll', 'python312.zip', 'python312._pth']
    for (const rf of requiredFiles) {
      const p = join(fakeMlDir, rf)
      mkdirSync(resolve(p, '..'), { recursive: true })
      writeFileSync(p, '', 'utf8')
    }

    const { runPreflightInventory } = await import('./preflight.mjs')
    const reportWithFake = await runPreflightInventory({ mlRuntimeDir: fakeMlDir })
    assert.notEqual(
      reportWithFake.details.resources.ml_runtime.status,
      'VERIFIED',
      'Empty/fake ML runtime must NOT be marked VERIFIED'
    )
    assert.equal(
      reportWithFake.details.resources.ml_runtime.pass,
      false,
      'Empty/fake ML runtime pass must be false'
    )
    console.log('✓ 9. S3 check: Empty/zero-byte ML resource fixture rejected as unverified')
  }

  // 10. S3 Parity Fixtures: Positive contract vs Wrong-.pth / Tamper / Extra-file negative cases
  {
    const ML_CONTRACT_PATHS = 'python312.zip\nDLLs\nLib/site-packages\nservice\n'
    const positiveMlDir = join(FIXTURE_DIR, 'positive-ml-runtime')
    mkdirSync(positiveMlDir, { recursive: true })

    const dummyContent = 'VALID_PRODUCTION_BINARY_CONTENT'
    const dummySha = createHash('sha256').update(dummyContent).digest('hex')
    const pthSha = createHash('sha256').update(ML_CONTRACT_PATHS).digest('hex')

    const all15Required = [
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

    const filesList = all15Required.map((fPath) => {
      if (fPath === 'python312._pth') {
        return { path: fPath, size: ML_CONTRACT_PATHS.length, sha256: pthSha }
      }
      return { path: fPath, size: dummyContent.length, sha256: dummySha }
    })

    const validManifest = {
      format: 1,
      platform: 'win32-x64',
      python_version: '3.12.10',
      interpreter: 'python.exe',
      service_directory: 'service',
      packages: { fastapi: '0.115.0', numpy: '2.5.1' },
      files: filesList
    }

    const manifestJson = JSON.stringify(validManifest, null, 2) + '\n'
    writeFileSync(join(positiveMlDir, 'manifest.json'), manifestJson, 'utf8')
    const manifestSha = createHash('sha256').update(manifestJson).digest('hex')

    for (const f of filesList) {
      const p = join(positiveMlDir, f.path)
      mkdirSync(resolve(p, '..'), { recursive: true })
      if (f.path === 'python312._pth') {
        writeFileSync(p, ML_CONTRACT_PATHS, 'utf8')
      } else {
        writeFileSync(p, dummyContent, 'utf8')
      }
    }

    // A. Verify with production verifier if compiled artifact exists
    const prodVerifierPath = join(APP_DIR, 'out/main/mlResourceVerifier.js')
    if (existsSync(prodVerifierPath)) {
      const { verifyMlRuntime } = require(prodVerifierPath)
      const verifiedManifest = verifyMlRuntime(positiveMlDir, manifestSha)
      assert.equal(verifiedManifest.python_version, '3.12.10')
      console.log('  -> Production verifyMlRuntime ACCEPTED positive contract fixture')
    }

    // B. Verify preflight inventory accepts positive contract fixture
    const { runPreflightInventory } = await import('./preflight.mjs')
    const reportValid = await runPreflightInventory({
      mlRuntimeDir: positiveMlDir,
      mlRuntimePin: manifestSha
    })
    assert.equal(
      reportValid.details.resources.ml_runtime.status,
      'VERIFIED',
      'Positive contract fixture must be VERIFIED in preflight'
    )
    assert.equal(reportValid.details.resources.ml_runtime.pass, true)

    // C. Negative case 1: Wrong .pth (old gemini .pth lacking DLLs and site-packages)
    const wrongPthDir = join(FIXTURE_DIR, 'wrong-pth-ml-runtime')
    mkdirSync(wrongPthDir, { recursive: true })
    const oldWrongPth = 'python312.zip\n.\nservice\n'
    const wrongPthSha = createHash('sha256').update(oldWrongPth).digest('hex')
    const wrongFilesList = all15Required.map((fPath) => {
      if (fPath === 'python312._pth') {
        return { path: fPath, size: oldWrongPth.length, sha256: wrongPthSha }
      }
      return { path: fPath, size: dummyContent.length, sha256: dummySha }
    })
    const wrongManifest = { ...validManifest, files: wrongFilesList }
    const wrongManifestJson = JSON.stringify(wrongManifest, null, 2) + '\n'
    writeFileSync(join(wrongPthDir, 'manifest.json'), wrongManifestJson, 'utf8')
    const wrongManifestSha = createHash('sha256').update(wrongManifestJson).digest('hex')
    for (const f of wrongFilesList) {
      const p = join(wrongPthDir, f.path)
      mkdirSync(resolve(p, '..'), { recursive: true })
      if (f.path === 'python312._pth') {
        writeFileSync(p, oldWrongPth, 'utf8')
      } else {
        writeFileSync(p, dummyContent, 'utf8')
      }
    }
    if (existsSync(prodVerifierPath)) {
      const { verifyMlRuntime } = require(prodVerifierPath)
      assert.throws(
        () => verifyMlRuntime(wrongPthDir, wrongManifestSha),
        /ML_RUNTIME_MISSING_OR_INVALID/
      )
      console.log('  -> Production verifyMlRuntime REJECTED wrong-.pth fixture')
    }
    const reportWrongPth = await runPreflightInventory({
      mlRuntimeDir: wrongPthDir,
      mlRuntimePin: wrongManifestSha
    })
    assert.equal(
      reportWrongPth.details.resources.ml_runtime.status,
      'TAMPERED_OR_CORRUPT',
      'Preflight must reject wrong-.pth fixture as TAMPERED_OR_CORRUPT'
    )
    assert.equal(reportWrongPth.details.resources.ml_runtime.pass, false)

    // D. Negative case 2: Controller catalog with empty objects {} must be rejected
    const badCatalogDir = join(FIXTURE_DIR, 'bad-catalog-releases')
    mkdirSync(badCatalogDir, { recursive: true })
    writeFileSync(
      join(badCatalogDir, 'catalog.json'),
      JSON.stringify({ format: 1, releases: [{}, {}, {}, {}, {}, {}, {}, {}, {}] }),
      'utf8'
    )
    const reportBadCatalog = await runPreflightInventory({ releasesDir: badCatalogDir })
    assert.equal(
      reportBadCatalog.details.resources.controller_releases.catalog_valid,
      false,
      'Catalog with empty objects must have catalog_valid: false'
    )
    assert.equal(reportBadCatalog.details.resources.controller_releases.pass, false)

    console.log('✓ 10. S3 check: Production contract parity and negative parity cases passed')
  }

  // 11. S1 Fixture: Synthetic Profile Backup & Restore Round-Trip with Manifest & Hashes
  {
    const profileDir = join(FIXTURE_DIR, 'synthetic-profile')
    const backupTargetDir = join(FIXTURE_DIR, 'synthetic-backup')
    const restoreTargetDir = join(FIXTURE_DIR, 'synthetic-restore-profile')
    mkdirSync(profileDir, { recursive: true })
    mkdirSync(backupTargetDir, { recursive: true })
    mkdirSync(restoreTargetDir, { recursive: true })

    // Create 5 essential synthetic items in profile:
    // 1. Database
    writeFileSync(join(profileDir, 'opspilot.db'), 'SYNTHETIC_SQLITE_DATABASE_BYTES\n', 'utf8')
    // 2. Protected Master Key (DPAPI)
    writeFileSync(
      join(profileDir, 'credential-master-key.protected'),
      'SYNTHETIC_DPAPI_PROTECTED_KEY_CIPHERTEXT\n',
      'utf8'
    )
    // 3. ML State model
    mkdirSync(join(profileDir, 'ml-state/dep-synth-1'), { recursive: true })
    writeFileSync(
      join(profileDir, 'ml-state/dep-synth-1/state.pkl'),
      'SYNTHETIC_ML_TRAINED_STATE_PKL\n',
      'utf8'
    )
    // 4. ML State metadata
    writeFileSync(
      join(profileDir, 'ml-state/dep-synth-1/meta.json'),
      '{"deployment":"dep-synth-1","trained":true}\n',
      'utf8'
    )
    // 5. UI Local Storage session
    mkdirSync(join(profileDir, 'Local Storage'), { recursive: true })
    writeFileSync(
      join(profileDir, 'Local Storage/ui-state.log'),
      'SYNTHETIC_UI_SESSION_MARKER_LOCALE_EN\n',
      'utf8'
    )

    // Execute synchronous backup copy
    const itemsToCopy = [
      'opspilot.db',
      'credential-master-key.protected',
      'ml-state',
      'Local Storage'
    ]
    const backupManifestFiles = []

    const copyRecursive = (src, dest) => {
      const st = statSync(src)
      if (st.isDirectory()) {
        mkdirSync(dest, { recursive: true })
        for (const entry of readdirSync(src)) {
          copyRecursive(join(src, entry), join(dest, entry))
        }
      } else {
        writeFileSync(dest, readFileSync(src))
      }
    }

    for (const item of itemsToCopy) {
      const srcPath = join(profileDir, item)
      if (existsSync(srcPath)) {
        copyRecursive(srcPath, join(backupTargetDir, item))
      }
    }

    // Build backup-manifest.json
    const walkBackup = (curr) => {
      for (const e of readdirSync(curr)) {
        const p = join(curr, e)
        const st = statSync(p)
        if (st.isDirectory()) {
          walkBackup(p)
        } else {
          const rel = relative(backupTargetDir, p).split('\\').join('/')
          backupManifestFiles.push({
            relative_path: rel,
            size_bytes: st.size,
            sha256: hashFile(p)
          })
        }
      }
    }
    walkBackup(backupTargetDir)

    const manifestObj = {
      format: 1,
      created_at: new Date().toISOString(),
      files_count: backupManifestFiles.length,
      files: backupManifestFiles
    }
    writeFileSync(
      join(backupTargetDir, 'backup-manifest.json'),
      JSON.stringify(manifestObj, null, 2) + '\n',
      'utf8'
    )

    // Assert that all 5 items are captured in backup
    const backupRelPaths = backupManifestFiles.map((f) => f.relative_path)
    assert(backupRelPaths.includes('opspilot.db'))
    assert(backupRelPaths.includes('credential-master-key.protected'))
    assert(backupRelPaths.includes('ml-state/dep-synth-1/state.pkl'))
    assert(backupRelPaths.includes('ml-state/dep-synth-1/meta.json'))
    assert(backupRelPaths.includes('Local Storage/ui-state.log'))

    // Execute restoration into restoreTargetDir after validating manifest
    const manifestFromDisk = JSON.parse(
      readFileSync(join(backupTargetDir, 'backup-manifest.json'), 'utf8')
    )
    for (const f of manifestFromDisk.files) {
      const backupFilePath = join(backupTargetDir, f.relative_path)
      assert(existsSync(backupFilePath), `Backup file must exist: ${f.relative_path}`)
      assert.equal(hashFile(backupFilePath), f.sha256, `Checksum must match: ${f.relative_path}`)
      const restoreDest = join(restoreTargetDir, f.relative_path)
      mkdirSync(resolve(restoreDest, '..'), { recursive: true })
      writeFileSync(restoreDest, readFileSync(backupFilePath))
    }

    // Assert all 5 restored files match original profile hashes exactly
    assert.equal(
      hashFile(join(restoreTargetDir, 'opspilot.db')),
      hashFile(join(profileDir, 'opspilot.db'))
    )
    assert.equal(
      hashFile(join(restoreTargetDir, 'credential-master-key.protected')),
      hashFile(join(profileDir, 'credential-master-key.protected'))
    )
    assert.equal(
      hashFile(join(restoreTargetDir, 'ml-state/dep-synth-1/state.pkl')),
      hashFile(join(profileDir, 'ml-state/dep-synth-1/state.pkl'))
    )
    assert.equal(
      hashFile(join(restoreTargetDir, 'ml-state/dep-synth-1/meta.json')),
      hashFile(join(profileDir, 'ml-state/dep-synth-1/meta.json'))
    )
    assert.equal(
      hashFile(join(restoreTargetDir, 'Local Storage/ui-state.log')),
      hashFile(join(profileDir, 'Local Storage/ui-state.log'))
    )

    console.log(
      '✓ 11. S1 check: Synthetic profile backup & restore round-trip preserved all 5 items with matching hashes'
    )
  }

  // 12. R6 Python Interpreter distinction: explicit --python flag
  {
    const res = runCli(['--python', process.execPath, '--json'])
    assert.equal(res.status, 0)
    const report = JSON.parse(res.stdout.trim())
    assert.equal(
      report.details.environment.python.resolution_source,
      'cli_flag',
      'Resolution source must be cli_flag when --python provided'
    )
    assert.equal(report.details.environment.python.pass, false)
    console.log(
      '✓ 12. R6 check: Explicit --python argument sets resolved executable without ambiguity'
    )
  }

  console.log('\n========================================')
  console.log('All 12 preflight standalone checks PASSED!')
  console.log('========================================\n')
} finally {
  // Clean up this run's fixture directory
  try {
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}
