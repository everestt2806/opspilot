/* eslint-disable @typescript-eslint/explicit-function-return-type -- Công cụ QA JavaScript. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { runProofAudit } from './audit.mjs'
import {
  receiptCases,
  canonicalCases,
  referenceJson,
  referenceHash,
  referenceSignature,
  TEST_KEY
} from './vectors.mjs'
import {
  assessReadiness,
  execute,
  git,
  handoffRecord,
  readWorkerState,
  WORKER_BRANCH,
  WORKER_DOSSIER,
  PROOF_PATH,
  CONTRACT_PATH
} from './gate.mjs'
import { main } from './run.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const app = resolve(here, '../..')
const sha = 'a'.repeat(40)
const ready = '- HANDOFF-LOCAL 28/10 — READY_FOR_LEADER_RETEST'
const validState = () => ({
  branch: WORKER_BRANCH,
  head: sha,
  dirty: false,
  sameRepository: true,
  dossier: ready,
  previousDossier: '',
  changedDossier: true,
  proofPresent: true,
  contractPresent: true
})

// Mock oracle chỉ kiểm plumbing công cụ bằng fixtures đã biết, không chứng minh H2 đúng.
function fixtureOracle() {
  const receipts = new Map(
    receiptCases().map((item) => [referenceJson(item.receipt), item.accepted])
  )
  const goldens = new Map(
    canonicalCases().map((item) => [referenceJson(item.value), item.canonical])
  )
  return {
    h2ReceiptSchema: {
      safeParse: (value) => ({ success: receipts.get(referenceJson(value)) ?? false })
    },
    canonicalH2Json(value) {
      const encoded = referenceJson(value)
      if (!goldens.has(encoded)) throw new Error('MOCK_NON_GOLDEN_INPUT')
      return goldens.get(encoded)
    },
    hashH2: referenceHash,
    signH2: referenceSignature,
    verifyH2: (domain, value, signature, key) =>
      Buffer.isBuffer(key) &&
      key.length === 32 &&
      ['receipt', 'commit', 'settlement'].includes(domain) &&
      /^[0-9a-f]{64}$/.test(signature) &&
      referenceSignature(domain, value, key) === signature
  }
}

test('golden canonical strings match independently constructed fixture encoding', () => {
  for (const item of canonicalCases()) assert.equal(referenceJson(item.value), item.canonical)
  assert.equal(
    referenceHash({ a: 1 }),
    '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862'
  )
  assert.equal(
    createHmac('sha256', Buffer.alloc(20, 0x0b)).update('Hi There').digest('hex'),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
  )
  assert.equal(TEST_KEY.length, 32)
})
test('receipt fixtures are independent and case IDs are unique', () => {
  const cases = receiptCases()
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length)
  const before = JSON.stringify(cases[1])
  cases[0].receipt.context.claim.app_fence = 999
  assert.equal(JSON.stringify(cases[1]), before)
  assert.equal(receiptCases()[0].receipt.context.claim.app_fence, 7)
})
test('audit plumbing passes known-fixture oracle without mutating input', () => {
  const report = runProofAudit(fixtureOracle())
  assert.equal(report.status, 'PASS')
  assert.equal(report.total, report.passed)
  assert.equal(report.failed, 0)
  assert.equal(new Set(report.cases.map((item) => item.id)).size, report.total)
  assert.ok(report.not_tested.includes('LIVE_SSH_DOCKER'))
})
test('audit catches accept-all receipt validator', () => {
  const subject = fixtureOracle()
  subject.h2ReceiptSchema.safeParse = () => ({ success: true })
  const report = runProofAudit(subject)
  assert.equal(report.status, 'FAIL')
  assert.ok(report.failed >= 40)
})
test('audit catches signature bypass', () => {
  const subject = fixtureOracle()
  subject.verifyH2 = () => true
  const report = runProofAudit(subject)
  assert.equal(report.cases.find((item) => item.id === 'auth-wrong-secret').status, 'FAIL')
  assert.equal(report.cases.find((item) => item.id === 'auth-wrong-domain').status, 'FAIL')
})
test('audit never includes subject exception text or receipt secret sentinel', () => {
  const subject = fixtureOracle()
  subject.h2ReceiptSchema.safeParse = () => {
    throw new Error('SYNTHETIC_QA_SENTINEL')
  }
  const report = runProofAudit(subject)
  assert.equal(report.status, 'FAIL')
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_QA_SENTINEL'), false)
})
test('handoff requires actual final journal record and explicit READY', () => {
  assert.equal(handoffRecord('Instructions: READY_FOR_LEADER_RETEST'), null)
  assert.equal(handoffRecord('- UPDATE 28/10 READY_FOR_LEADER_RETEST'), null)
  assert.equal(handoffRecord(`${ready}\n- START 28/10 tiếp tục sửa`), null)
  assert.equal(handoffRecord(`${ready}\nPARTIAL`), null)
  assert.equal(handoffRecord(`${ready}\nNOT_RUN`), null)
  assert.equal(handoffRecord(`- **HANDOFF-LOCAL** 28/10 — READY_FOR_LEADER_RETEST`), ready)
  const section =
    '## 4. Tuyên bố HANDOFF-LOCAL và Bàn giao Leader\n\n- Trạng thái: READY_FOR_LEADER_RETEST'
  assert.equal(handoffRecord(section), section)
  assert.equal(handoffRecord(`${section}\n- START 28/10 sửa tiếp`), null)
})
test('gate rejects each unsafe handoff condition', () => {
  assert.equal(assessReadiness(validState(), sha), 'READY')
  assert.equal(assessReadiness(validState(), 'a'.repeat(7)), 'INVALID_SHA')
  for (const [field, value, result] of [
    ['branch', 'main', 'WRONG_BRANCH'],
    ['head', 'b'.repeat(40), 'HEAD_MISMATCH'],
    ['dirty', true, 'WORKER_DIRTY'],
    ['sameRepository', false, 'WRONG_REPOSITORY'],
    ['dossier', '', 'WAITING_HANDOFF'],
    ['changedDossier', false, 'STALE_HANDOFF'],
    ['previousDossier', ready, 'STALE_HANDOFF'],
    ['proofPresent', false, 'MISSING_COMPONENT'],
    ['contractPresent', false, 'MISSING_COMPONENT']
  ])
    assert.equal(assessReadiness({ ...validState(), [field]: value }, sha), result)
})
test('CLI refuses abbreviated SHA, extra flags and missing args without executing code', async () => {
  for (const args of [
    [],
    ['--worker', '.', '--sha', 'abcdef0'],
    ['--worker', '.', '--sha', sha, '--force']
  ]) {
    assert.deepEqual(await main(args), { status: 'ERROR', code: 'QA_ARGUMENTS_INVALID', exit: 2 })
  }
})
test('child command enforces timeout and bounded output', async () => {
  const timed = await execute(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], app, {
    timeoutMs: 500
  })
  assert.notEqual(timed.exit, 0)
  assert.equal(timed.bounded, false)
  const flooded = await execute(
    process.execPath,
    ['-e', "process.stdout.write('x'.repeat(100000))"],
    app,
    { maxBuffer: 1024 }
  )
  assert.notEqual(flooded.exit, 0)
  assert.equal(flooded.bounded, false)
})

async function scratch() {
  const root = join(app, '.out-scripts', 'h2-independent-selftests')
  await mkdir(root, { recursive: true })
  // Giữ fixture tổng hợp trong thư mục ignored của QA; không xóa/move đường dẫn tính động.
  return mkdtemp(join(root, 'fixture-'))
}
test('real temporary Git repository detects dirty, fresh and stale handoff', async () => {
  const repo = await scratch()
  await git(repo, ['init', '-b', WORKER_BRANCH])
  for (const [path, content] of [
    [WORKER_DOSSIER, '- START 28/10'],
    [PROOF_PATH, 'throw new Error("DO_NOT_EXECUTE")'],
    [CONTRACT_PATH, 'export type Fixture = 1']
  ]) {
    await mkdir(dirname(join(repo, path)), { recursive: true })
    await writeFile(join(repo, path), content, 'utf8')
  }
  const commit = async (message) => {
    await git(repo, ['add', '--', WORKER_DOSSIER, PROOF_PATH, CONTRACT_PATH])
    await git(repo, [
      '-c',
      'user.name=QA Fixture',
      '-c',
      'user.email=qa@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      message
    ])
    return git(repo, ['rev-parse', 'HEAD'])
  }
  await commit('fixture initial')
  await writeFile(join(repo, WORKER_DOSSIER), ready, 'utf8')
  const handoffSha = await commit('fixture handoff')
  assert.equal(assessReadiness(await readWorkerState(repo, repo, handoffSha), handoffSha), 'READY')
  // CLI phải chặn repo khác, không thực thi fixture cố ý throw.
  const rejected = await main(['--worker', repo, '--sha', handoffSha])
  assert.equal(rejected.gate, 'WRONG_REPOSITORY')
  await writeFile(join(repo, PROOF_PATH), '// resumed work', 'utf8')
  assert.equal(
    assessReadiness(await readWorkerState(repo, repo, handoffSha), handoffSha),
    'WORKER_DIRTY'
  )
  const laterSha = await commit('fixture resumed implementation')
  assert.equal(
    assessReadiness(await readWorkerState(repo, repo, laterSha), laterSha),
    'STALE_HANDOFF'
  )
})
test('probe reports component failures without echoing exception sentinel', async () => {
  const root = await scratch()
  const subject = join(root, 'subject.cjs')
  await writeFile(
    subject,
    'module.exports = { h2ReceiptSchema: { safeParse() { throw new Error("SYNTHETIC_QA_SENTINEL") } } }'
  )
  const result = await execute(process.execPath, [join(here, 'probe.mjs'), subject], app)
  assert.equal(result.exit, 0)
  const report = JSON.parse(result.stdout)
  assert.equal(report.status, 'FAIL')
  assert.equal(report.failed, report.total)
  assert.equal(result.stdout.includes('SYNTHETIC_QA_SENTINEL'), false)
  assert.equal(result.stderr, '')
})

test('synthetic TypeScript compilation resolves only QA dependencies and loads Zod in child', async () => {
  const root = await scratch()
  const require = createRequire(join(app, 'package.json'))
  const { transform } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const compiled = await transform(
    `import { z } from 'zod'; type Fixture = string;
     const marker: Fixture = 'SYNTHETIC_QA_SENTINEL';
     export const h2ReceiptSchema = z.unknown().transform(() => { throw new Error(marker) });`,
    { loader: 'ts', format: 'cjs', platform: 'node', logLevel: 'silent' }
  )
  const subject = join(root, 'subject.cjs')
  await writeFile(subject, compiled.code, 'utf8')
  const result = await execute(process.execPath, [join(here, 'probe.mjs'), subject], app)
  assert.equal(result.exit, 0)
  const report = JSON.parse(result.stdout)
  assert.equal(report.status, 'FAIL')
  assert.equal(report.failed, report.total)
  assert.equal(result.stdout.includes('SYNTHETIC_QA_SENTINEL'), false)
  assert.equal(result.stderr, '')
})
