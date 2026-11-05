/* eslint-disable @typescript-eslint/explicit-function-return-type -- Công cụ QA JavaScript. */
import {
  receiptCases,
  canonicalCases,
  authCases,
  TEST_KEY,
  referenceHash,
  referenceSignature
} from './vectors.mjs'

export const AUDIT_SCOPE = 'H2_PROOF_COMPONENT_ONLY'

/** Không ghi exception/payload của SUT vào report. Case ID là metadata QA cố định. */
export function runProofAudit(subject) {
  const results = []
  const check = (id, group, evaluate) => {
    try {
      results.push({ id, group, status: evaluate() === true ? 'PASS' : 'FAIL' })
    } catch {
      results.push({ id, group, status: 'FAIL', reason: 'SUBJECT_EXCEPTION' })
    }
  }
  for (const item of receiptCases())
    check(item.id, item.group, () => {
      const actual = subject.h2ReceiptSchema.safeParse(structuredClone(item.receipt))
      return typeof actual.success === 'boolean' && actual.success === item.accepted
    })
  for (const item of canonicalCases()) {
    check(item.id, 'canonical-json', () => subject.canonicalH2Json(item.value) === item.canonical)
    check(
      `${item.id}-hash`,
      'sha256',
      () => subject.hashH2(item.value) === referenceHash(item.value)
    )
    for (const domain of ['receipt', 'commit', 'settlement'])
      check(
        `${item.id}-sign-${domain}`,
        'hmac',
        () =>
          subject.signH2(domain, item.value, TEST_KEY) === referenceSignature(domain, item.value)
      )
  }
  for (const item of authCases())
    check(
      item.id,
      'hmac-verification',
      () => subject.verifyH2(item.domain, item.payload, item.signature, item.key) === item.accepted
    )
  const cycle = {}
  cycle.self = cycle
  for (const [id, value] of [
    ['fraction', 1.5],
    ['unsafe-integer', Number.MAX_SAFE_INTEGER + 1],
    ['nan', NaN],
    ['infinity', Infinity],
    ['undefined', undefined],
    ['bigint', 1n],
    ['cycle', cycle],
    ['date', new Date('2026-10-27T00:00:00.000Z')],
    ['unpaired-surrogate', '\ud800']
  ])
    check(`reject-canonical-${id}`, 'canonical-rejection', () => {
      if (typeof subject.canonicalH2Json !== 'function') return false
      try {
        subject.canonicalH2Json(value)
        return false
      } catch {
        return true
      }
    })
  const passed = results.filter((item) => item.status === 'PASS').length
  return {
    version: 1,
    scope: AUDIT_SCOPE,
    status: passed === results.length ? 'PASS' : 'FAIL',
    total: results.length,
    passed,
    failed: results.length - passed,
    cases: results,
    not_tested: [
      'DB_AUTHORITY_CAS',
      'METRIC_BARRIER',
      'REMOTE_QUIESCENCE',
      'CRASH_RECOVERY',
      'LIVE_SSH_DOCKER'
    ]
  }
}
