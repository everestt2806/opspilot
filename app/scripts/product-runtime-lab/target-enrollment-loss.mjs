import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const artifact = process.env.OPSPILOT_R1_ARTIFACT
if (!artifact || !process.argv[2]) throw new Error('LOSS_LAB_ENV_REQUIRED')
const api = createRequire(artifact)(artifact)
const input = JSON.parse(readFileSync(0, 'utf8'))
const database = api.initializeDatabase(process.argv[2])
api.TargetEnrollmentRepository.prototype.complete = function () {
  // Target đã trả receipt thật; kết thúc process trước khi SQLite được ghi proof.
  assert.equal(
    database.prepare('SELECT state FROM product_target_enrollment WHERE app_id=?').get(input.app_id)
      .state,
    'unknown'
  )
  console.log('INJECTED_EXIT_AFTER_TARGET_RESPONSE')
  process.exit(73)
}
await api.enrollProductTarget(database, input.controller_id, process.argv[2], input)
throw new Error('FAULT_CHECKPOINT_NOT_REACHED')
