/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test suite for preflight CLI */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const SCRIPT_DIR = import.meta.dirname
const CLI_PATH = join(SCRIPT_DIR, 'preflight.mjs')
const REPO_ROOT = resolve(SCRIPT_DIR, '../../..')
const TEMP_OUT = join(REPO_ROOT, 'app/.out-scripts/windows-delivery/test-preflight-out.json')

function runCli(args = []) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000
  })
}

console.log('Testing Windows Delivery Preflight CLI...')

// 1. Basic invocation (exit code 0, human readable output)
{
  const res = runCli([])
  assert.equal(res.status, 0, `Expected exit 0 but got ${res.status}: ${res.stderr}`)
  assert(res.stdout.includes('OPSPILOT WINDOWS DELIVERY PREFLIGHT INVENTORY'))
  assert(res.stdout.includes('GATE READINESS SUMMARY'))
  console.log('✓ Default invocation produces inventory report with exit code 0')
}

// 2. Help flag (--help)
{
  const res = runCli(['--help'])
  assert.equal(res.status, 0)
  assert(res.stdout.includes('Usage:'))
  assert(res.stdout.includes('--gate'))
  console.log('✓ --help produces usage instructions')
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
  console.log('✓ --json outputs valid schema-compliant JSON')
}

// 4. File export (--out <path>)
{
  if (existsSync(TEMP_OUT)) rmSync(TEMP_OUT, { force: true })
  const res = runCli(['--out', TEMP_OUT])
  assert.equal(res.status, 0)
  assert(existsSync(TEMP_OUT), 'Evidence file must be written')
  const content = JSON.parse(readFileSync(TEMP_OUT, 'utf8'))
  assert.equal(content.tool, 'opspilot-windows-delivery-preflight')
  rmSync(TEMP_OUT, { force: true })
  console.log('✓ --out successfully exports structured evidence to disk')
}

// 5. Gate enforcement: --gate source (should PASS in current dev environment)
{
  const res = runCli(['--gate', 'source'])
  assert.equal(res.status, 0, `Source gate expected to pass but failed: ${res.stdout} ${res.stderr}`)
  console.log('✓ --gate source returns exit code 0 when source prerequisites met')
}

// 6. Gate enforcement: --gate package (must FAIL / exit 1 when prerequisites missing)
{
  const res = runCli(['--gate', 'package'])
  assert.equal(res.status, 1, 'Package gate must exit 1 when resources/Python lock missing')
  console.log('✓ --gate package returns exit code 1 when package prerequisites missing')
}

// 7. Gate enforcement: invalid gate name (must exit 2)
{
  const res = runCli(['--gate', 'invalid_gate_name'])
  assert.equal(res.status, 2, 'Invalid gate name must exit with code 2')
  console.log('✓ Invalid --gate argument returns exit code 2')
}

console.log('All preflight CLI tests PASSED!')
