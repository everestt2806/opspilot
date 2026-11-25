/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone check suite for preflight inventory CLI and resource/backup parity */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
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
    timeout: options.timeout || 90000
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

  // 11. S1 check: Native PowerShell profile backup, restore & process scripts verification
  {
    const backupScript = resolve(REPO_ROOT, 'app/scripts/windows-delivery/backup-profile.ps1')
    const restoreScript = resolve(REPO_ROOT, 'app/scripts/windows-delivery/restore-profile.ps1')
    const processScript = resolve(REPO_ROOT, 'app/scripts/windows-delivery/manage-process.ps1')

    assert(existsSync(backupScript), 'backup-profile.ps1 must exist')
    assert(existsSync(restoreScript), 'restore-profile.ps1 must exist')
    assert(existsSync(processScript), 'manage-process.ps1 must exist')

    const profileDir = join(FIXTURE_DIR, 'synthetic-profile')
    const backupTargetDir = join(FIXTURE_DIR, 'synthetic-backup')
    const restoreTargetDir = join(FIXTURE_DIR, 'synthetic-restore-profile')

    mkdirSync(profileDir, { recursive: true })
    mkdirSync(backupTargetDir, { recursive: true })
    mkdirSync(restoreTargetDir, { recursive: true })

    // Create 6 essential synthetic items in profile:
    // 1. Database
    writeFileSync(join(profileDir, 'opspilot.db'), 'SYNTHETIC_SQLITE_DATABASE_BYTES\n', 'utf8')
    // 2. Protected Master Key (DPAPI)
    writeFileSync(
      join(profileDir, 'credential-master-key.protected'),
      'SYNTHETIC_DPAPI_PROTECTED_KEY_CIPHERTEXT\n',
      'utf8'
    )
    // 3. Chromium / Electron Local State (DPAPI context)
    writeFileSync(
      join(profileDir, 'Local State'),
      '{"os_crypt":{"encrypted_key":"SYNTHETIC_DPAPI_ENCRYPTED_KEY"}}\n',
      'utf8'
    )
    // 4. ML State model
    mkdirSync(join(profileDir, 'ml-state/dep-synth-1'), { recursive: true })
    writeFileSync(
      join(profileDir, 'ml-state/dep-synth-1/state.pkl'),
      'SYNTHETIC_ML_TRAINED_STATE_PKL\n',
      'utf8'
    )
    // 5. ML State metadata
    writeFileSync(
      join(profileDir, 'ml-state/dep-synth-1/meta.json'),
      '{"deployment":"dep-synth-1","trained":true}\n',
      'utf8'
    )
    // 6. UI Local Storage session
    mkdirSync(join(profileDir, 'Local Storage'), { recursive: true })
    writeFileSync(
      join(profileDir, 'Local Storage/ui-state.log'),
      'SYNTHETIC_UI_SESSION_MARKER_LOCALE_EN\n',
      'utf8'
    )

    // Call backup-profile.ps1 with exact parameters: -SourceProfile, -BackupTarget
    const backupRes = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        backupScript,
        '-SourceProfile',
        profileDir,
        '-BackupTarget',
        backupTargetDir,
        '-Force'
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 }
    )
    assert.equal(backupRes.status, 0, `backup-profile.ps1 failed: ${backupRes.stderr}`)

    const manifestPath = join(backupTargetDir, 'backup-manifest.json')
    assert(existsSync(manifestPath), 'backup-manifest.json must be created by backup script')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
    assert.equal(manifest.format, 1, 'Manifest format must be 1')
    assert.equal(manifest.items_count, 6, 'All 6 items must be recorded in manifest')

    // Call restore-profile.ps1 with exact parameters: -BackupDir, -TargetProfile
    const restoreRes = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        restoreScript,
        '-BackupDir',
        backupTargetDir,
        '-TargetProfile',
        restoreTargetDir
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 }
    )
    assert.equal(restoreRes.status, 0, `restore-profile.ps1 failed: ${restoreRes.stderr}`)

    // Assert all 6 restored files match original profile hashes exactly
    for (const item of [
      'opspilot.db',
      'credential-master-key.protected',
      'Local State',
      'ml-state/dep-synth-1/state.pkl',
      'ml-state/dep-synth-1/meta.json',
      'Local Storage/ui-state.log'
    ]) {
      const restoredPath = join(restoreTargetDir, item)
      assert(existsSync(restoredPath), `Restored file must exist: ${item}`)
      assert.equal(
        hashFile(restoredPath),
        hashFile(join(profileDir, item)),
        `Hash must match for ${item}`
      )
    }

    // Negative Test 1: Missing protected key must REJECT and not mutate target
    const negTargetDir = join(FIXTURE_DIR, 'neg-target')
    mkdirSync(negTargetDir, { recursive: true })
    writeFileSync(join(negTargetDir, 'initial.txt'), 'INITIAL_STATE\n', 'utf8')
    const initialHash = hashFile(join(negTargetDir, 'initial.txt'))

    const noKeyBackupDir = join(FIXTURE_DIR, 'backup-no-key')
    mkdirSync(noKeyBackupDir, { recursive: true })
    writeFileSync(join(noKeyBackupDir, 'opspilot.db'), 'SYNTHETIC_SQLITE_DATABASE_BYTES\n', 'utf8')
    const noKeyManifest = {
      format: 1,
      items: [
        {
          path: 'opspilot.db',
          size: 31,
          sha256: hashFile(join(noKeyBackupDir, 'opspilot.db'))
        }
      ]
    }
    writeFileSync(
      join(noKeyBackupDir, 'backup-manifest.json'),
      JSON.stringify(noKeyManifest),
      'utf8'
    )

    const negKeyRes = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        restoreScript,
        '-BackupDir',
        noKeyBackupDir,
        '-TargetProfile',
        negTargetDir
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 }
    )
    assert.notEqual(
      negKeyRes.status,
      0,
      'Restore must reject backup missing credential-master-key.protected'
    )
    assert.equal(
      hashFile(join(negTargetDir, 'initial.txt')),
      initialHash,
      'Target profile must remain intact on rejected restore'
    )

    // Negative Test 1b: Missing Local State when protected key is present must REJECT
    const noLocalStateBackupDir = join(FIXTURE_DIR, 'backup-no-local-state')
    mkdirSync(noLocalStateBackupDir, { recursive: true })
    writeFileSync(
      join(noLocalStateBackupDir, 'opspilot.db'),
      'SYNTHETIC_SQLITE_DATABASE_BYTES\n',
      'utf8'
    )
    writeFileSync(
      join(noLocalStateBackupDir, 'credential-master-key.protected'),
      'SYNTHETIC_DPAPI_PROTECTED_KEY_CIPHERTEXT\n',
      'utf8'
    )
    const noLocalStateManifest = {
      format: 1,
      items: [
        {
          path: 'opspilot.db',
          size: 31,
          sha256: hashFile(join(noLocalStateBackupDir, 'opspilot.db'))
        },
        {
          path: 'credential-master-key.protected',
          size: 42,
          sha256: hashFile(join(noLocalStateBackupDir, 'credential-master-key.protected'))
        }
      ]
    }
    writeFileSync(
      join(noLocalStateBackupDir, 'backup-manifest.json'),
      JSON.stringify(noLocalStateManifest),
      'utf8'
    )

    const negLocalStateRes = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        restoreScript,
        '-BackupDir',
        noLocalStateBackupDir,
        '-TargetProfile',
        negTargetDir
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 }
    )
    assert.notEqual(
      negLocalStateRes.status,
      0,
      'Restore must reject backup having protected key but missing Local State'
    )
    assert.equal(
      hashFile(join(negTargetDir, 'initial.txt')),
      initialHash,
      'Target profile must remain intact on rejected restore lacking Local State'
    )

    // Negative Test 2: Unlisted file in backup directory must REJECT
    writeFileSync(join(backupTargetDir, 'unlisted_injected.txt'), 'MALICIOUS_INJECTION\n', 'utf8')
    const negUnlistedRes = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        restoreScript,
        '-BackupDir',
        backupTargetDir,
        '-TargetProfile',
        restoreTargetDir
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 }
    )
    assert.notEqual(negUnlistedRes.status, 0, 'Restore must reject unlisted file on disk')
    rmSync(join(backupTargetDir, 'unlisted_injected.txt'))

    // Negative Test 3 (R5): Promote failure triggers automatic rollback to restore original profile
    const promoteCaseParent = join(FIXTURE_DIR, 'promote-fail-case')
    const rollbackTargetDir = join(promoteCaseParent, 'target')
    mkdirSync(rollbackTargetDir, { recursive: true })
    writeFileSync(join(rollbackTargetDir, 'marker1.txt'), 'ORIGINAL_MARKER_1\n', 'utf8')
    writeFileSync(join(rollbackTargetDir, 'opspilot.db'), 'ORIGINAL_DB_STATE\n', 'utf8')
    writeFileSync(
      join(rollbackTargetDir, 'credential-master-key.protected'),
      'ORIGINAL_KEY_STATE\n',
      'utf8'
    )
    const originalMarker1Hash = hashFile(join(rollbackTargetDir, 'marker1.txt'))
    const originalDbHash = hashFile(join(rollbackTargetDir, 'opspilot.db'))
    const originalKeyHash = hashFile(join(rollbackTargetDir, 'credential-master-key.protected'))

    const promoteFailRes = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        restoreScript,
        '-BackupDir',
        backupTargetDir,
        '-TargetProfile',
        rollbackTargetDir
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
        env: {
          ...process.env,
          OPSPILOT_SIMULATE_RESTORE_PROMOTE_FAILURE: '1'
        }
      }
    )
    assert.notEqual(promoteFailRes.status, 0, 'Promote failure must exit with nonzero code')
    assert(existsSync(rollbackTargetDir), 'Original target directory must exist after rollback')
    assert.equal(
      hashFile(join(rollbackTargetDir, 'marker1.txt')),
      originalMarker1Hash,
      'marker1.txt must match original hash after rollback'
    )
    assert.equal(
      hashFile(join(rollbackTargetDir, 'opspilot.db')),
      originalDbHash,
      'opspilot.db must match original hash after rollback'
    )
    assert.equal(
      hashFile(join(rollbackTargetDir, 'credential-master-key.protected')),
      originalKeyHash,
      'credential-master-key.protected must match original hash after rollback'
    )

    // Verify no PreRestore or Staging folders remain in promote case directory
    const fixtureParentEntries = readdirSync(promoteCaseParent)
    const lingeringPreRestore = fixtureParentEntries.filter((e) =>
      e.startsWith('OpsPilot_PreRestore_')
    )
    assert.equal(
      lingeringPreRestore.length,
      0,
      'PreRestore directory must be restored and no longer present'
    )
    const lingeringStaging = fixtureParentEntries.filter((e) =>
      e.startsWith('OpsPilot_RestoreStaging_')
    )
    assert.equal(lingeringStaging.length, 0, 'Staging directory must be cleaned up')

    // Negative Test 4 (R5): Rollback failure preserves PreRestore and warns user
    const rollbackFailCaseParent = join(FIXTURE_DIR, 'rollback-fail-case')
    const rollbackFailTargetDir = join(rollbackFailCaseParent, 'target')
    mkdirSync(rollbackFailTargetDir, { recursive: true })
    writeFileSync(join(rollbackFailTargetDir, 'fail-marker.txt'), 'FAIL_MARKER_CONTENT\n', 'utf8')
    writeFileSync(join(rollbackFailTargetDir, 'opspilot.db'), 'FAIL_DB_STATE\n', 'utf8')
    writeFileSync(
      join(rollbackFailTargetDir, 'credential-master-key.protected'),
      'FAIL_KEY_STATE\n',
      'utf8'
    )
    const failMarkerHash = hashFile(join(rollbackFailTargetDir, 'fail-marker.txt'))

    const rollbackFailRes = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        restoreScript,
        '-BackupDir',
        backupTargetDir,
        '-TargetProfile',
        rollbackFailTargetDir
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
        env: {
          ...process.env,
          OPSPILOT_SIMULATE_RESTORE_PROMOTE_FAILURE: '1',
          OPSPILOT_SIMULATE_RESTORE_ROLLBACK_FAILURE: '1'
        }
      }
    )
    assert.notEqual(rollbackFailRes.status, 0, 'Rollback failure must exit with nonzero code')
    assert.equal(
      existsSync(rollbackFailTargetDir),
      false,
      'Target directory should not exist when rollback failed'
    )

    // PreRestore directory must be preserved and contain the original data!
    const updatedEntries = readdirSync(rollbackFailCaseParent)
    const preservedPreRestore = updatedEntries.filter((e) => e.startsWith('OpsPilot_PreRestore_'))
    assert(
      preservedPreRestore.length > 0,
      'PreRestore directory must be preserved when rollback fails'
    )
    const preservedPath = join(rollbackFailCaseParent, preservedPreRestore[0])
    assert.equal(
      hashFile(join(preservedPath, 'fail-marker.txt')),
      failMarkerHash,
      'Original file in PreRestore must be intact'
    )
    // Clean up preserved PreRestore for remaining tests
    rmSync(preservedPath, { recursive: true, force: true })

    // Process inspect probe using exact parameters: -InstallDir, -Action, -Port
    const procRes = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        processScript,
        '-InstallDir',
        FIXTURE_DIR,
        '-Action',
        'Inspect',
        '-Port',
        '8765'
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 }
    )
    assert.equal(procRes.status, 0, `manage-process.ps1 failed: ${procRes.stderr}`)

    // Process Regression Matrix (R6): Mocked cmdlets test suite for manage-process.ps1
    const procCases = ['owned-listener', 'lost-listener', 'pid-reuse', 'unrelated']
    for (const cName of procCases) {
      const caseDir = join(FIXTURE_DIR, `proc-${cName}`)
      mkdirSync(caseDir, { recursive: true })
      const markerPath = join(caseDir, 'stop-called.txt')
      const installPath = join(caseDir, 'owned-install')
      mkdirSync(installPath, { recursive: true })

      const probePs1 = `
$global:netReads=0
$global:procReads=0
$global:caseName='${cName}'
$global:markerPath='${markerPath.replace(/'/g, "''")}'
$global:installPath='${installPath.replace(/'/g, "''")}'
function Get-NetTCPConnection {
  [CmdletBinding()] param($LocalPort,$State)
  $global:netReads++
  if ($global:netReads -eq 1 -or ($global:caseName -ne 'lost-listener' -and $global:netReads -eq 2)) {
    [PSCustomObject]@{OwningProcess=777777}
  }
}
function Get-Process {
  [CmdletBinding()] param($Id)
  $global:procReads++
  $exe = Join-Path $global:installPath 'resources\\ml-runtime\\python.exe'
  if ($global:caseName -eq 'unrelated') { $exe = 'C:\\UnrelatedApp\\ml-runtime\\python.exe' }
  $start = [datetime]'2026-11-22T01:00:00'
  if ($global:caseName -eq 'pid-reuse' -and $global:procReads -gt 1) { $start = $start.AddSeconds(1) }
  $p = [PSCustomObject]@{MainModule=[PSCustomObject]@{FileName=$exe};StartTime=$start;HasExited=$false}
  $p | Add-Member -MemberType ScriptMethod -Name CloseMainWindow -Value { return $false }
  return $p
}
function Stop-Process {
  [CmdletBinding()] param($Id,[switch]$Force)
  [IO.File]::WriteAllText($global:markerPath, [string]$Id)
}
function Start-Sleep { [CmdletBinding()] param($Milliseconds) }
& '${processScript.replace(/'/g, "''")}' -Action Stop -InstallDir $global:installPath -Port 51234
`
      const probePs1Path = join(caseDir, 'probe.ps1')
      writeFileSync(probePs1Path, '\uFEFF' + probePs1, 'utf8')

      const procMockRes = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probePs1Path],
        { encoding: 'utf8', windowsHide: true, timeout: 30000 }
      )

      if (cName === 'owned-listener') {
        assert.equal(procMockRes.status, 0, `owned-listener should exit 0: ${procMockRes.stderr}`)
        assert(existsSync(markerPath), 'owned-listener must call Stop-Process')
        assert.equal(
          readFileSync(markerPath, 'utf8').trim(),
          '777777',
          'Stop-Process must receive PID 777777'
        )
      } else if (cName === 'lost-listener') {
        assert.equal(procMockRes.status, 0, `lost-listener should exit 0: ${procMockRes.stderr}`)
        assert.equal(
          existsSync(markerPath),
          false,
          'lost-listener must NOT call Stop-Process or CloseMainWindow'
        )
      } else if (cName === 'pid-reuse') {
        assert.equal(procMockRes.status, 1, 'pid-reuse must exit 1 with error')
        assert.equal(existsSync(markerPath), false, 'pid-reuse must NOT call Stop-Process')
      } else if (cName === 'unrelated') {
        assert.equal(procMockRes.status, 1, 'unrelated executable must exit 1 with rejection error')
        assert.equal(
          existsSync(markerPath),
          false,
          'unrelated executable must NOT call Stop-Process'
        )
      }
    }

    console.log(
      '✓ 11. S1 check: Native PowerShell backup, restore & process scripts verified with positive and negative matrix (including R5 rollback & R6 listener guards)'
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
