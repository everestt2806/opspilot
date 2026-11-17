/* eslint-disable @typescript-eslint/explicit-function-return-type -- Windows delivery source check runner */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = resolve(SCRIPT_DIR, '../../..')
const APP_DIR = join(REPO_ROOT, 'app')
const OUT_DIR = join(APP_DIR, '.out-scripts/windows-delivery')

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function runStep(name, command, args, options = {}) {
  const start = Date.now()
  const displayCmd = `${command} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`
  console.log(`\n[STEP: ${name}] Running: ${displayCmd} (in ${options.cwd || REPO_ROOT})...`)

  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    windowsHide: true,
    encoding: 'utf8',
    shell: options.shell ?? true,
    timeout: options.timeout || 180000,
    ...options
  })
  const durationMs = Date.now() - start
  const passed = result.status === 0
  console.log(`[STEP: ${name}] ${passed ? 'PASS' : 'FAIL'} (exit: ${result.status}, duration: ${(durationMs / 1000).toFixed(1)}s)`)
  if (!passed && result.stderr) {
    console.error(`Error output:\n${result.stderr.slice(0, 500)}`)
  }
  return {
    name,
    command: displayCmd,
    cwd: options.cwd || REPO_ROOT,
    status: passed ? 'PASS' : 'FAIL',
    exit_code: result.status,
    duration_ms: durationMs,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  }
}

export async function runSourceChecks(options = {}) {
  mkdirSync(OUT_DIR, { recursive: true })
  const steps = []

  // Step 1: Git diff check
  steps.push(runStep('git_diff_check', 'git', ['diff', '--check'], { cwd: REPO_ROOT }))

  // Step 2: Preflight source readiness
  steps.push(
    runStep(
      'preflight_source_gate',
      process.execPath,
      [join(SCRIPT_DIR, 'preflight.mjs'), '--gate', 'source'],
      { cwd: REPO_ROOT, shell: false }
    )
  )

  // Step 3: Typecheck Node & Web (executed in app directory to avoid path quoting issues)
  steps.push(
    runStep(
      'typecheck_node_and_web',
      'pnpm.cmd',
      ['typecheck'],
      { cwd: APP_DIR }
    )
  )

  // Step 4: Typecheck Scripts
  steps.push(
    runStep(
      'typecheck_scripts',
      'pnpm.cmd',
      ['exec', 'tsc', '-p', 'tsconfig.scripts.json', '--noEmit'],
      { cwd: APP_DIR }
    )
  )

  // Step 5: Delivery unit test
  steps.push(
    runStep(
      'preflight_unit_tests',
      process.execPath,
      [join(SCRIPT_DIR, 'preflight.test.mjs')],
      { cwd: REPO_ROOT, shell: false }
    )
  )

  // Step 6: Source build compilation (main, preload, renderer)
  steps.push(
    runStep(
      'source_build_compilation',
      'pnpm.cmd',
      ['build'],
      { cwd: APP_DIR, timeout: 300000 }
    )
  )

  // Step 7: Optional full test suite audit (if --full-test passed)
  if (options.fullTest) {
    steps.push(
      runStep(
        'vitest_full_suite',
        'pnpm.cmd',
        ['exec', 'vitest', 'run'],
        { cwd: APP_DIR, timeout: 600000 }
      )
    )
  }

  const allPassed = steps.every((s) => s.status === 'PASS')
  const report = {
    timestamp: new Date().toISOString(),
    tool: 'opspilot-windows-delivery-source-check',
    overall_status: allPassed ? 'PASS' : 'FAIL',
    scope: 'source_only',
    steps_total: steps.length,
    steps_passed: steps.filter((s) => s.status === 'PASS').length,
    steps_failed: steps.filter((s) => s.status === 'FAIL').length,
    steps: steps.map((s) => ({
      name: s.name,
      command: s.command,
      cwd: s.cwd,
      status: s.status,
      exit_code: s.exit_code,
      duration_ms: s.duration_ms,
      stdout_snippet: s.stdout.slice(0, 300),
      stderr_snippet: s.stderr.slice(0, 300)
    }))
  }

  const evidencePath = join(OUT_DIR, 'source-check-evidence.json')
  writeFileSync(evidencePath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  report.evidence_path = evidencePath
  report.evidence_sha256 = hashFile(evidencePath)

  return report
}

// CLI entry
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const fullTest = process.argv.includes('--full-test')
  runSourceChecks({ fullTest })
    .then((report) => {
      console.log('\n' + '='.repeat(70))
      console.log(' SOURCE CHECK RESULTS')
      console.log('='.repeat(70))
      console.log(`Overall Status:   ${report.overall_status}`)
      console.log(`Passed / Total:   ${report.steps_passed} / ${report.steps_total}`)
      console.log(`Evidence File:    ${report.evidence_path}`)
      console.log(`Evidence SHA256:  ${report.evidence_sha256}`)
      console.log('='.repeat(70))
      process.exitCode = report.overall_status === 'PASS' ? 0 : 1
    })
    .catch((err) => {
      console.error(`Source check failed: ${err.message}`)
      process.exitCode = 2
    })
}
