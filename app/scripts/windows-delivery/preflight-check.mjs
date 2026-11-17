/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone check suite for preflight inventory CLI */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'

const SCRIPT_DIR = import.meta.dirname
const CLI_PATH = join(SCRIPT_DIR, 'preflight.mjs')
const REPO_ROOT = resolve(SCRIPT_DIR, '../../..')

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

  // 9. R4 Fixture: Fake/Empty ML runtime resource must NOT be granted VERIFIED
  {
    const fakeMlDir = join(FIXTURE_DIR, 'fake-ml-runtime')
    mkdirSync(fakeMlDir, { recursive: true })
    // Empty manifest
    writeFileSync(join(fakeMlDir, 'manifest.json'), JSON.stringify({}), 'utf8')
    // 8 empty dummy files
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
    for (const rf of requiredFiles) {
      const p = join(fakeMlDir, rf)
      mkdirSync(resolve(p, '..'), { recursive: true })
      writeFileSync(p, '', 'utf8')
    }

    // Run preflight in node importing inspectResources or CLI with mock resources if supported
    // Since preflight CLI inspects default resources, verify via preflight API directly
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
    console.log('✓ 9. R4 check: Empty/zero-byte ML resource fixture rejected as unverified')
  }

  // 10. R4 Fixture: Tampered ML runtime file must be rejected
  {
    const tamperedMlDir = join(FIXTURE_DIR, 'tampered-ml-runtime')
    mkdirSync(tamperedMlDir, { recursive: true })
    const dummyContent = 'VALID_EXECUTABLE_CONTENT_BYTES'
    const dummySha = createHash('sha256').update(dummyContent).digest('hex')
    const filesList = [
      { path: 'python.exe', size: dummyContent.length, sha256: dummySha },
      { path: 'python312.dll', size: dummyContent.length, sha256: dummySha },
      { path: 'python312.zip', size: dummyContent.length, sha256: dummySha },
      {
        path: 'python312._pth',
        size: 'python312.zip\n.\nservice\n'.length,
        sha256: createHash('sha256').update('python312.zip\n.\nservice\n').digest('hex')
      },
      { path: 'service/main.py', size: dummyContent.length, sha256: dummySha },
      { path: 'service/config.py', size: dummyContent.length, sha256: dummySha },
      { path: 'service/features.py', size: dummyContent.length, sha256: dummySha },
      { path: 'service/store.py', size: dummyContent.length, sha256: dummySha }
    ]
    const validManifest = {
      format: 1,
      python_version: '3.12.10',
      files: filesList
    }
    writeFileSync(join(tamperedMlDir, 'manifest.json'), JSON.stringify(validManifest), 'utf8')
    for (const f of filesList) {
      const p = join(tamperedMlDir, f.path)
      mkdirSync(resolve(p, '..'), { recursive: true })
      if (f.path === 'python312._pth') {
        writeFileSync(p, 'python312.zip\n.\nservice\n', 'utf8')
      } else {
        writeFileSync(p, dummyContent, 'utf8')
      }
    }

    const { runPreflightInventory } = await import('./preflight.mjs')
    const validReport = await runPreflightInventory({ mlRuntimeDir: tamperedMlDir })
    assert.equal(
      validReport.details.resources.ml_runtime.status,
      'VERIFIED',
      'Valid fixture with matching hashes must be VERIFIED'
    )
    assert.equal(validReport.details.resources.ml_runtime.pass, true)

    // Now tamper with python.exe content:
    writeFileSync(join(tamperedMlDir, 'python.exe'), 'TAMPERED_BYTES', 'utf8')
    const tamperedReport = await runPreflightInventory({ mlRuntimeDir: tamperedMlDir })
    assert.equal(
      tamperedReport.details.resources.ml_runtime.status,
      'TAMPERED_OR_CORRUPT',
      'Tampered file must be detected as TAMPERED_OR_CORRUPT'
    )
    assert.equal(tamperedReport.details.resources.ml_runtime.pass, false)
    console.log(
      '✓ 10. R4 check: Content hash validation distinguishes verified vs tampered resources'
    )
  }

  // 11. R6 Python Interpreter distinction: explicit --python flag
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
      '✓ 11. R6 check: Explicit --python argument sets resolved executable without ambiguity'
    )
  }

  console.log('\n========================================')
  console.log('All 11 preflight standalone checks PASSED!')
  console.log('========================================\n')
} finally {
  // Clean up this run's fixture directory
  try {
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}
