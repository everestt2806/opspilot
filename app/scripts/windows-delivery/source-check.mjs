/* eslint-disable @typescript-eslint/explicit-function-return-type -- Unified Windows delivery source check runner */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = resolve(SCRIPT_DIR, '../../..')
const APP_DIR = join(REPO_ROOT, 'app')
const OUT_DIR = join(APP_DIR, '.out-scripts/windows-delivery')

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function hashString(content) {
  return createHash('sha256').update(content).digest('hex')
}

function inspectProvenance() {
  let headSha = null
  let branch = null
  let isAncestorOfBaseline = false
  let workingTreeClean = false
  let dirtyDiffHash = null

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
      if (!workingTreeClean) {
        const diffRes = spawnSync('git', ['diff', 'HEAD'], {
          cwd: REPO_ROOT,
          windowsHide: true,
          encoding: 'utf8',
          timeout: 10000
        })
        const statusPorcelain = spawnSync('git', ['status', '--porcelain'], {
          cwd: REPO_ROOT,
          windowsHide: true,
          encoding: 'utf8',
          timeout: 10000
        })
        const combined =
          (diffRes.stdout || '') +
          '\n--- UNTRACKED_AND_STATUS ---\n' +
          (statusPorcelain.stdout || '')
        dirtyDiffHash = hashString(combined)
      }
    }

    const ancestorRes = spawnSync('git', ['merge-base', '--is-ancestor', 'f699615', 'HEAD'], {
      cwd: REPO_ROOT,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000
    })
    isAncestorOfBaseline = ancestorRes.status === 0
  } catch {
    // Provenance probe failure
  }

  let pnpmVersion = null
  try {
    const pnpmRes = spawnSync('pnpm.cmd', ['--version'], {
      windowsHide: true,
      encoding: 'utf8',
      shell: true,
      timeout: 5000
    })
    if (pnpmRes.status === 0) pnpmVersion = pnpmRes.stdout.trim()
  } catch {
    pnpmVersion = 'not_found'
  }

  return {
    commit_sha: headSha,
    branch,
    working_tree_clean: workingTreeClean,
    dirty_diff_sha256: dirtyDiffHash,
    baseline_ancestor_verified: isAncestorOfBaseline,
    node_version: process.version,
    pnpm_version: pnpmVersion,
    platform: process.platform,
    arch: process.arch
  }
}

function runStep(name, command, args, options = {}, logsDir) {
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
  const passed = result.status === 0 && !result.error

  const stdoutRaw = result.stdout || ''
  const stderrRaw = result.stderr || ''

  // Write full raw logs to individual files in nonce logs directory
  const stdoutPath = join(logsDir, `${name}.stdout.log`)
  const stderrPath = join(logsDir, `${name}.stderr.log`)
  writeFileSync(stdoutPath, stdoutRaw, 'utf8')
  writeFileSync(stderrPath, stderrRaw, 'utf8')

  const stdoutHash = hashString(stdoutRaw)
  const stderrHash = hashString(stderrRaw)

  console.log(
    `[STEP: ${name}] ${passed ? 'PASS' : 'FAIL'} (exit: ${result.status}, signal: ${result.signal || 'none'}, duration: ${(durationMs / 1000).toFixed(1)}s)`
  )

  if (!passed) {
    if (result.error) {
      console.error(`Execution error: ${result.error.message || result.error}`)
    }
    if (stderrRaw) {
      console.error(`Error output summary (first 500 chars):\n${stderrRaw.slice(0, 500)}`)
    }
  }

  return {
    name,
    command: displayCmd,
    cwd: options.cwd || REPO_ROOT,
    status: passed ? 'PASS' : 'FAIL',
    exit_code: result.status,
    signal: result.signal || null,
    error: result.error ? result.error.message || String(result.error) : null,
    error_code: result.error?.code || null,
    timed_out: result.error?.code === 'ETIMEDOUT',
    duration_ms: durationMs,
    stdout_file: stdoutPath,
    stdout_sha256: stdoutHash,
    stdout_chars: stdoutRaw.length,
    stdout_snippet: stdoutRaw.slice(0, 500),
    stderr_file: stderrPath,
    stderr_sha256: stderrHash,
    stderr_chars: stderrRaw.length,
    stderr_snippet: stderrRaw.slice(0, 500)
  }
}

function parseVitestResults(vitestJsonPath, fullStdout, vitestStep) {
  // If Vitest did not complete cleanly or results JSON is absent, report abnormal termination
  if (
    !existsSync(vitestJsonPath) ||
    vitestStep.exit_code === null ||
    vitestStep.error ||
    vitestStep.timed_out
  ) {
    return {
      status: 'ABNORMAL_TERMINATION_OR_TIMEOUT',
      error:
        vitestStep.error ||
        (vitestStep.timed_out
          ? 'Vitest full suite timed out'
          : 'Vitest did not exit cleanly or produce results JSON'),
      signal: vitestStep.signal,
      timed_out: Boolean(vitestStep.timed_out),
      total_suites: null,
      failed_suites: null,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      skipped_tests: 0,
      delivery_failures_count: null,
      delivery_failures: [],
      outside_scope_failures_count: null,
      outside_scope_failures: []
    }
  }

  let totalTests = 0
  let passedTests = 0
  let failedTests = 0
  let skippedTests = 0
  let totalSuites = 0
  let failedSuites = 0
  let deliveryFailures = []
  let outsideScopeFailures = []

  let parsed = null
  try {
    const raw = readFileSync(vitestJsonPath, 'utf8')
    parsed = JSON.parse(raw)
  } catch {
    // JSON parse error
  }

  if (parsed && Array.isArray(parsed.testResults)) {
    totalSuites = parsed.testResults.length
    for (const suite of parsed.testResults) {
      const suitePath = suite.name || ''
      const isDeliveryOwned =
        suitePath.includes('windows-delivery') || suitePath.includes('windows-release-lab')

      let suiteHasFailure = false
      const failedCases = []

      for (const assertion of suite.assertionResults || []) {
        totalTests++
        if (assertion.status === 'passed') {
          passedTests++
        } else if (assertion.status === 'failed') {
          failedTests++
          suiteHasFailure = true
          failedCases.push({
            title: assertion.title,
            ancestorTitles: assertion.ancestorTitles,
            errorMessages: assertion.failureMessages
          })
        } else if (assertion.status === 'skipped' || assertion.status === 'pending') {
          skippedTests++
        }
      }

      if (suiteHasFailure || suite.status === 'failed') {
        failedSuites++
        const failureRecord = {
          file: suitePath,
          failed_tests_count: failedCases.length,
          failed_cases: failedCases,
          suite_message: suite.message,
          category: isDeliveryOwned ? 'delivery_regression' : 'outside_scope_unverified_baseline'
        }
        if (isDeliveryOwned) {
          deliveryFailures.push(failureRecord)
        } else {
          outsideScopeFailures.push(failureRecord)
        }
      }
    }
  } else {
    // Parse summary from stdout if json unavailable
    const match = fullStdout.match(
      /Tests\s+([0-9]+)\s+failed\s+\|\s+([0-9]+)\s+passed\s+\|\s+([0-9]+)\s+skipped/i
    )
    if (match) {
      failedTests = parseInt(match[1], 10)
      passedTests = parseInt(match[2], 10)
      skippedTests = parseInt(match[3], 10)
      totalTests = failedTests + passedTests + skippedTests
    }
  }

  return {
    status: failedSuites === 0 ? 'ALL_PASSED' : 'HAS_FAILURES',
    total_suites: totalSuites,
    failed_suites: failedSuites,
    total_tests: totalTests,
    passed_tests: passedTests,
    failed_tests: failedTests,
    skipped_tests: skippedTests,
    delivery_failures_count: deliveryFailures.length,
    delivery_failures: deliveryFailures,
    outside_scope_failures_count: outsideScopeFailures.length,
    outside_scope_failures: outsideScopeFailures
  }
}

export async function runSourceChecks(options = {}) {
  const nonce = `run-${Date.now()}-${process.pid}-${randomBytes(3).toString('hex')}`
  const runDir = options.outDir || join(OUT_DIR, 'source-runs', nonce)
  const logsDir = join(runDir, 'logs')
  mkdirSync(logsDir, { recursive: true })

  console.log(`Starting Windows Delivery Source Checks [Nonce: ${nonce}]`)
  console.log(`Evidence directory: ${runDir}`)

  const provenance = inspectProvenance()
  const steps = []

  // Step 1: Git diff check
  steps.push(runStep('git_diff_check', 'git', ['diff', '--check'], { cwd: REPO_ROOT }, logsDir))

  // Step 2: Scoped ESLint check on Kim's changed delivery files
  steps.push(
    runStep(
      'scoped_eslint',
      'pnpm.cmd',
      [
        'exec',
        'eslint',
        'scripts/windows-delivery',
        'scripts/windows-release-lab.mjs',
        '--max-warnings=0'
      ],
      { cwd: APP_DIR },
      logsDir
    )
  )

  // Step 3: Mandatory Preflight Source-Readiness Gate (S4)
  steps.push(
    runStep(
      'preflight_source_gate',
      process.execPath,
      [
        join(SCRIPT_DIR, 'preflight.mjs'),
        '--gate',
        'source',
        '--out',
        join(runDir, 'preflight-inventory.json'),
        '--overwrite'
      ],
      { cwd: REPO_ROOT, shell: false },
      logsDir
    )
  )

  // Step 4: Standalone Preflight Check Suite (probes / negative tests)
  steps.push(
    runStep(
      'preflight_standalone_checks',
      process.execPath,
      [join(SCRIPT_DIR, 'preflight-check.mjs')],
      { cwd: REPO_ROOT, shell: false },
      logsDir
    )
  )

  // Step 5: Typecheck Node & Web
  steps.push(
    runStep('typecheck_node_and_web', 'pnpm.cmd', ['typecheck'], { cwd: APP_DIR }, logsDir)
  )

  // Step 6: Typecheck Scripts
  steps.push(
    runStep(
      'typecheck_scripts',
      'pnpm.cmd',
      ['exec', 'tsc', '-p', 'tsconfig.scripts.json', '--noEmit'],
      { cwd: APP_DIR },
      logsDir
    )
  )

  // Step 7: Source build compilation
  steps.push(
    runStep(
      'source_build_compilation',
      'pnpm.cmd',
      ['build'],
      { cwd: APP_DIR, timeout: 300000 },
      logsDir
    )
  )

  // Step 8: Full Vitest test suite (mandatory gate unless explicitly --skip-vitest passed)
  let vitestAnalysis = null
  let vitestStep = null
  if (!options.skipVitest) {
    const vitestJsonPath = join(runDir, 'vitest-results.json')
    const relVitestJsonPath = relative(APP_DIR, vitestJsonPath).split('\\').join('/')
    vitestStep = runStep(
      'vitest_full_suite',
      'pnpm.cmd',
      [
        'exec',
        'vitest',
        'run',
        '--reporter=default',
        '--reporter=json',
        `--outputFile=${relVitestJsonPath}`
      ],
      { cwd: APP_DIR, timeout: 600000 },
      logsDir
    )
    steps.push(vitestStep)

    const rawStdout = readFileSync(vitestStep.stdout_file, 'utf8')
    vitestAnalysis = parseVitestResults(vitestJsonPath, rawStdout, vitestStep)
  }

  const deliverySteps = steps.filter((s) => s.name !== 'vitest_full_suite')
  const allDeliveryStepsPassed = deliverySteps.every((s) => s.status === 'PASS')
  const vitestPassed = vitestStep ? vitestStep.status === 'PASS' : false

  let overallStatus = 'FAIL'
  let reportScope = 'windows_delivery_source_and_gates'

  if (options.skipVitest) {
    reportScope = 'windows_delivery_fast_mode'
    overallStatus = allDeliveryStepsPassed ? 'INCOMPLETE_FAST_MODE' : 'FAIL'
  } else if (!allDeliveryStepsPassed) {
    overallStatus = 'FAIL'
  } else if (!vitestPassed) {
    // If vitest failed, check if test execution completed and produced valid results
    if (
      !vitestAnalysis ||
      vitestAnalysis.total_tests === 0 ||
      vitestAnalysis.delivery_failures_count === null
    ) {
      overallStatus = 'FAIL'
    } else if (vitestAnalysis.delivery_failures_count > 0) {
      overallStatus = 'FAIL'
    } else if (vitestAnalysis.outside_scope_failures_count > 0) {
      overallStatus = 'PARTIAL_OUTSIDE_SCOPE_FAILURES'
    } else {
      overallStatus = 'FAIL'
    }
  } else {
    overallStatus = 'PASS'
  }

  const report = {
    timestamp: new Date().toISOString(),
    tool: 'opspilot-windows-delivery-source-check',
    version: '1.2.0',
    nonce,
    overall_status: overallStatus,
    scope: reportScope,
    provenance,
    steps_total: steps.length,
    steps_passed: steps.filter((s) => s.status === 'PASS').length,
    steps_failed: steps.filter((s) => s.status === 'FAIL').length,
    vitest_analysis: vitestAnalysis,
    steps
  }

  // Write report into runDir
  const reportPath = join(runDir, 'source-check-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  report.report_path = reportPath
  report.report_sha256 = hashFile(reportPath)

  // Generate SHA256SUMS for runDir
  const checksumEntries = []
  checksumEntries.push(`${report.report_sha256}  source-check-report.json`)
  for (const step of steps) {
    checksumEntries.push(`${step.stdout_sha256}  logs/${step.name}.stdout.log`)
    checksumEntries.push(`${step.stderr_sha256}  logs/${step.name}.stderr.log`)
  }
  const preflightInvJson = join(runDir, 'preflight-inventory.json')
  if (existsSync(preflightInvJson)) {
    checksumEntries.push(`${hashFile(preflightInvJson)}  preflight-inventory.json`)
  }
  const vitestJson = join(runDir, 'vitest-results.json')
  if (existsSync(vitestJson)) {
    checksumEntries.push(`${hashFile(vitestJson)}  vitest-results.json`)
  }
  const sha256Path = join(runDir, 'SHA256SUMS')
  writeFileSync(sha256Path, checksumEntries.join('\n') + '\n', 'utf8')

  // Maintain latest pointer for easy reference
  const latestPointerPath = join(OUT_DIR, 'source-check-latest.json')
  writeFileSync(
    latestPointerPath,
    JSON.stringify(
      {
        latest_nonce: nonce,
        latest_run_dir: runDir,
        report_path: reportPath,
        overall_status: overallStatus,
        timestamp: report.timestamp
      },
      null,
      2
    ) + '\n',
    'utf8'
  )

  // Write top-level summary for standard evidence collectors
  const topEvidencePath = join(OUT_DIR, 'source-check-evidence.json')
  writeFileSync(topEvidencePath, JSON.stringify(report, null, 2) + '\n', 'utf8')

  return report
}

// CLI entry
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
OpsPilot Windows Delivery Source Check Runner

Usage:
  node app/scripts/windows-delivery/source-check.mjs [options]

Options:
  --skip-vitest     Skip running full Vitest suite (results in INCOMPLETE_FAST_MODE, not acceptance PASS)
  --out-dir <path>  Specify custom output directory for evidence logs
  --overwrite       Allow using an existing custom output directory
  --help, -h        Show this help message

Exit codes:
  0: All source checks and full test suite PASSED
  1: One or more checks FAILED, incomplete fast mode, or outside-scope failures present
  2: Execution error or output path collision
`)
    process.exit(0)
  }

  const validFlags = ['--skip-vitest', '--out-dir', '--overwrite', '--help', '-h']
  let skipVitest = false
  let customOutDir = null
  let overwrite = false

  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (a === '--skip-vitest') {
      skipVitest = true
      i++
    } else if (a === '--overwrite') {
      overwrite = true
      i++
    } else if (a === '--out-dir') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        console.error('CLI Error: Option --out-dir requires a directory path argument')
        process.exit(2)
      }
      customOutDir = resolve(args[i + 1])
      i += 2
    } else if (!validFlags.includes(a)) {
      console.error(`CLI Error: Unknown option "${a}"`)
      process.exit(2)
    } else {
      i++
    }
  }

  if (customOutDir && existsSync(customOutDir) && !overwrite) {
    console.error(
      `CLI Error: Output directory already exists at "${customOutDir}". Specify --overwrite to allow using it.`
    )
    process.exit(2)
  }

  runSourceChecks({ skipVitest, outDir: customOutDir })
    .then((report) => {
      console.log('\n' + '='.repeat(70))
      console.log(' SOURCE CHECK RESULTS')
      console.log('='.repeat(70))
      console.log(`Overall Status:   ${report.overall_status}`)
      console.log(`Scope:            ${report.scope}`)
      console.log(`Passed / Total:   ${report.steps_passed} / ${report.steps_total}`)
      console.log(`Report File:      ${report.report_path}`)
      console.log(`Report SHA256:    ${report.report_sha256}`)
      if (report.vitest_analysis) {
        console.log('-'.repeat(70))
        console.log('VITEST SUITE BREAKDOWN:')
        console.log(`  Vitest Status:  ${report.vitest_analysis.status}`)
        if (report.vitest_analysis.status === 'ABNORMAL_TERMINATION_OR_TIMEOUT') {
          console.log(`  Error/Signal:   ${report.vitest_analysis.error}`)
          console.log('  Coverage:       UNKNOWN (suite did not produce test results)')
        } else {
          console.log(
            `  Total Tests:    ${report.vitest_analysis.total_tests} (${report.vitest_analysis.passed_tests} passed, ${report.vitest_analysis.failed_tests} failed, ${report.vitest_analysis.skipped_tests} skipped)`
          )
          console.log(
            `  Delivery Tests: ${report.vitest_analysis.delivery_failures_count} failed suites (REGRESSION: ${report.vitest_analysis.delivery_failures_count > 0 ? 'YES' : 'NONE'})`
          )
          console.log(
            `  Outside Scope:  ${report.vitest_analysis.outside_scope_failures_count} failed suites (unverified baseline in src/**)`
          )
        }
      }
      if (report.overall_status === 'INCOMPLETE_FAST_MODE') {
        console.log('-'.repeat(70))
        console.log('WARNING: Fast mode active. Full Vitest suite was NOT RUN.')
        console.log('Status is INCOMPLETE_FAST_MODE (cannot be used for full acceptance).')
      }
      console.log('='.repeat(70))

      // Exit 0 ONLY if truly PASS. Propagate exit code 1 if any failure or outside-scope failures.
      process.exitCode = report.overall_status === 'PASS' ? 0 : 1
    })
    .catch((err) => {
      console.error(`Source check runner fatal error: ${err.message}`)
      process.exitCode = 2
    })
}
