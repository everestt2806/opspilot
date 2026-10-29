/* eslint-disable @typescript-eslint/explicit-function-return-type -- Công cụ QA JavaScript. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const review = resolve(import.meta.dirname, '../..')
const worker = review
const nonce = randomBytes(6).toString('hex')
const scratch = join(review, 'app/.out-scripts/h2-acceptance', nonce)
mkdirSync(scratch, { recursive: true })
const app = `h2-leader-${nonce}`
const tag = `${app}:v2`
const label = `opspilot.review.run=${nonce}`
const owned = []
let createdImage = false
let cleanup = true
let result
const command = (program, args) =>
  execFileSync(program, args, {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 128 * 1024,
    windowsHide: true
  }).trim()
const docker = (...args) => command('docker', args)
const inspect = (kind, id) => JSON.parse(docker(kind, 'inspect', id))[0]
try {
  assert.equal(docker('image', 'ls', '-q', '--filter', `reference=${tag}`), '')
  writeFileSync(
    join(scratch, 'Dockerfile'),
    `FROM node:22-alpine\nLABEL opspilot.review.run=${nonce} opspilot.app_id=900001 opspilot.deployment_id=2 org.opencontainers.image.revision=${'2'.repeat(40)}\n`
  )
  docker('build', '--network=none', '-q', '-t', tag, scratch)
  createdImage = true
  const image = inspect('image', tag).Id
  const script = "require('http').createServer((_,r)=>r.end('fixture')).listen(3000,'127.0.0.1')"
  for (const foreign of [false, true]) {
    const id = docker(
      'run',
      '-d',
      '--network=none',
      '--name',
      foreign ? `${app}-foreign` : `${app}-app`,
      '--label',
      label,
      '--label',
      `opspilot.deployment_id=${foreign ? 99 : 2}`,
      image,
      'node',
      '-e',
      script
    )
    owned.push(id)
  }
  const fixture = {
    nonce,
    container_id: owned[0],
    foreign_container_id: owned[1],
    context: {
      app_name: app,
      deployment_id: 2,
      source_sha: '2'.repeat(40),
      candidate_image_tag: tag,
      claim: { app_id: 900001 },
      container_port: 3000,
      healthcheck_path: '/health'
    }
  }
  writeFileSync(join(scratch, 'live.json'), JSON.stringify(fixture))
  const output = docker(
    'run',
    '--rm',
    '--network=none',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=32m',
    '--label',
    label,
    '--mount',
    `type=bind,source=${join(worker, 'app/src/main/controlPlane')},target=/subject,readonly`,
    '--mount',
    `type=bind,source=${join(scratch, 'live.json')},target=/live.json,readonly`,
    '--mount',
    `type=bind,source=${join(review, 'app/scripts/review-h2-live-health.py')},target=/review.py,readonly`,
    '--mount',
    'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
    'opspilot-review-h1-ssh:20261026',
    'python',
    '-B',
    '/review.py'
  )
  result = JSON.parse(output)
} catch {
  result = { status: 'FAIL', code: 'H2_REAL_HEALTH_LAB_FAILED' }
} finally {
  for (const id of owned.reverse()) {
    try {
      const record = inspect('container', id)
      assert.equal(record.Config.Labels['opspilot.review.run'], nonce)
      docker('rm', '-f', id)
      assert.equal(docker('ps', '-aq', '--no-trunc', '--filter', `id=${id}`), '')
    } catch {
      cleanup = false
    }
  }
  if (createdImage) {
    try {
      assert.equal(inspect('image', tag).Config.Labels['opspilot.review.run'], nonce)
      docker('image', 'rm', tag)
      assert.equal(docker('image', 'ls', '-q', '--filter', `reference=${tag}`), '')
    } catch {
      cleanup = false
    }
  }
}
result = {
  ...result,
  nonce,
  cleanup,
  source_sha: command('git', ['-C', worker, 'rev-parse', 'HEAD'])
}
writeFileSync(join(scratch, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result))
process.exitCode = result.passed === 5 && cleanup ? 0 : 1
