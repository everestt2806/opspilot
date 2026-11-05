/* eslint-disable @typescript-eslint/explicit-function-return-type -- Công cụ QA JavaScript. */
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { assessReadiness, execute, readWorkerState, PROOF_PATH } from './gate.mjs'
import { AUDIT_SCOPE } from './audit.mjs'
import { CONTRACT_REFERENCE } from './vectors.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const app = resolve(here, '../..')
const qaRepo = resolve(app, '..')
const digest = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/** Chỉ compile blob Git đã handoff; tuyệt đối không import file đang sửa của Worker. */
export async function inspectCheckpoint(worker, sha, inspectOnly = false) {
  const metadata = { version: 1, scope: AUDIT_SCOPE, sha, contract_reference: CONTRACT_REFERENCE }
  try {
    const state = await readWorkerState(worker, qaRepo, sha)
    const gate = assessReadiness(state, sha)
    if (gate !== 'READY') return { ...metadata, status: 'WAITING', gate, exit: 2 }
    if (inspectOnly) return { ...metadata, status: 'READY', gate, exit: 0 }
    const require = createRequire(join(app, 'package.json'))
    const { transform } = createRequire(require.resolve('vite/package.json'))('esbuild')
    const compiled = await transform(state.proof, {
      loader: 'ts',
      format: 'cjs',
      platform: 'node',
      sourcefile: PROOF_PATH,
      sourcemap: false,
      logLevel: 'silent'
    })
    const outputRoot = join(app, '.out-scripts', 'h2-independent')
    await mkdir(outputRoot, { recursive: true })
    const output = await mkdtemp(join(outputRoot, `${sha.slice(0, 12)}-`))
    const subject = join(output, 'subject.cjs')
    await writeFile(subject, compiled.code, 'utf8')
    const child = await execute(process.execPath, [join(here, 'probe.mjs'), subject], qaRepo, {
      timeoutMs: 15000,
      maxBuffer: 256 * 1024
    })
    const after = await readWorkerState(worker, qaRepo, sha)
    if (assessReadiness(after, sha) !== 'READY')
      return { ...metadata, status: 'INCONCLUSIVE', code: 'QA_WORKER_CHANGED', exit: 2 }
    if (!child.bounded) return { ...metadata, status: 'ERROR', code: 'QA_CHILD_LIMIT', exit: 2 }
    // Không echo stdout/stderr/exception của implementation vào report.
    if (child.exit !== 0 || child.stderr.length)
      return { ...metadata, status: 'ERROR', code: 'QA_CHILD_FAILED', exit: 2 }
    let report
    try {
      report = JSON.parse(child.stdout)
    } catch {
      return { ...metadata, status: 'ERROR', code: 'QA_UNEXPECTED_OUTPUT', exit: 2 }
    }
    if (
      report.scope !== AUDIT_SCOPE ||
      !['PASS', 'FAIL'].includes(report.status) ||
      !Array.isArray(report.cases) ||
      !Number.isSafeInteger(report.total) ||
      report.total !== report.cases.length ||
      report.passed !== report.cases.filter((item) => item.status === 'PASS').length ||
      report.failed !== report.total - report.passed ||
      report.status !== (report.failed === 0 ? 'PASS' : 'FAIL') ||
      !report.cases.every(
        (item) =>
          /^[a-z0-9_-]+$/.test(item.id) &&
          /^[a-z0-9_-]+$/.test(item.group) &&
          ['PASS', 'FAIL'].includes(item.status)
      )
    )
      return { ...metadata, status: 'ERROR', code: 'QA_INVALID_REPORT', exit: 2 }
    // Chỉ whitelist metadata từ harness, không chuyển tiếp fields tùy ý.
    const result = {
      ...metadata,
      status: report.status,
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      cases: report.cases.map(({ id, group, status }) => ({ id, group, status })),
      proof_sha256: digest(state.proof),
      contract_sha256: digest(state.contract),
      not_tested: [
        'DB_AUTHORITY_CAS',
        'METRIC_BARRIER',
        'REMOTE_QUIESCENCE',
        'CRASH_RECOVERY',
        'LIVE_SSH_DOCKER'
      ],
      exit: report.status === 'PASS' ? 0 : 1
    }
    await writeFile(join(output, 'report.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    return result
  } catch {
    return { ...metadata, status: 'ERROR', code: 'QA_CHECKPOINT_UNAVAILABLE', exit: 2 }
  }
}

export async function main(args) {
  const inspectOnly = args[0] === '--inspect'
  const rest = inspectOnly ? args.slice(1) : args
  if (
    rest.length !== 4 ||
    rest[0] !== '--worker' ||
    rest[2] !== '--sha' ||
    !/^[0-9a-f]{40}$/.test(rest[3])
  )
    return { status: 'ERROR', code: 'QA_ARGUMENTS_INVALID', exit: 2 }
  return inspectCheckpoint(resolve(rest[1]), rest[3], inspectOnly)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await main(process.argv.slice(2))
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.exit
}
