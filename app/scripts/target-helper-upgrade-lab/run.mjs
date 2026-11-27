/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native target/consumer integration lab. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
if (process.platform !== 'linux') throw Error('LINUX_REQUIRED')
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
if (!modules) throw Error('APPROVED_MODULES_REQUIRED')
const esbuild = createRequire(join(modules, 'package.json'))('esbuild')
const nonce = randomBytes(6).toString('hex')
const root = resolve(import.meta.dirname, '../../..')
const native = join('/var/tmp/opspilot-p3e3a-runtime', 'helper-outcome-' + nonce)
const output = join(root, 'app/.out-scripts/target-helper-upgrade-lab', nonce)
mkdirSync(native, { mode: 0o700 })
mkdirSync(output, { recursive: true })
const artifact = join(native, 'outcome.cjs')
await esbuild.build({
  entryPoints: [join(import.meta.dirname, 'entry.ts')],
  outfile: artifact,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external'
})
const { verifyTargetHelperUpgradeOutcome: verify } = createRequire(artifact)(artifact)
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  )
const key = randomBytes(32)
let result
try {
  const probe = JSON.parse(
    execFileSync(
      'python3',
      [
        join(root, 'app/scripts/product-runtime-lab/test_target_helper_upgrade.py'),
        '--outcome-probe'
      ],
      {
        input: JSON.stringify({ key: key.toString('base64') }),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
        maxBuffer: 128 * 1024
      }
    )
  )
  assert.equal(probe.private_cleanup, true)
  assert.equal(probe.cases.length, 4)
  const observations = []
  for (const { name, expected, response } of probe.cases) {
    assert.equal(verify(expected, response, key), true, name)
    const altered = structuredClone(response)
    altered.receipt.signature = '0'.repeat(64)
    assert.equal(verify(expected, altered, key), false)
    assert.equal(verify({ ...expected, review_sha256: '0'.repeat(64) }, response, key), false)
    const foreign = structuredClone(expected)
    foreign.to.target.host = 'foreign.test'
    assert.equal(verify(foreign, response, key), false)
    assert.equal(verify(expected, { ...response, extra: true }, key), false)
    observations.push({
      name,
      state: response.state,
      settled: response.receipt.payload.settled,
      proof_verified: true
    })
  }
  assert.equal(observations[0].settled, false)
  assert.equal(observations[1].settled, false)
  assert.equal(observations[2].settled, true)
  assert.equal(observations[3].settled, true)
  const { expected, response } = probe.cases[2]
  const bad = structuredClone(response)
  bad.receipt.payload.settled = false
  bad.receipt.signature = createHmac('sha256', key)
    .update('opspilot-target-helper-upgrade-outcome-v1\n')
    .update(canonical(bad.receipt.payload))
    .digest('hex')
  assert.equal(verify(expected, bad, key), false)
  const pending = structuredClone(probe.cases[1].response)
  pending.proof = response.proof
  assert.equal(verify(probe.cases[1].expected, pending, key), false)
  assert.equal(verify(expected, response, Buffer.alloc(31)), false)
  result = {
    status: 'PASS',
    scope: 'NATIVE_PYTHON_TARGET_NODE_OUTCOME_VERIFIER',
    nonce,
    checks: 23,
    observations,
    private_cleanup: true,
    artifact_sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex')
  }
} catch {
  result = {
    status: 'FAIL',
    scope: 'NATIVE_PYTHON_TARGET_NODE_OUTCOME_VERIFIER',
    nonce,
    code: 'OUTCOME_VERIFIER_FAILED'
  }
} finally {
  key.fill(0)
}
writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
