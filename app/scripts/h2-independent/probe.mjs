import { createRequire } from 'node:module'
import { runProofAudit } from './audit.mjs'

// Child riêng để giới hạn thời gian/output; không phải sandbox mã không tin cậy.
try {
  const subject = createRequire(import.meta.url)(process.argv[2])
  process.stdout.write(JSON.stringify(runProofAudit(subject)))
} catch {
  process.stdout.write(JSON.stringify({ status: 'ERROR', code: 'QA_SUBJECT_LOAD_FAILED' }))
  process.exitCode = 2
}
