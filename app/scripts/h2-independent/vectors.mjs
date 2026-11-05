/* eslint-disable @typescript-eslint/explicit-function-return-type -- Công cụ QA JavaScript. */
import { createHash, createHmac } from 'node:crypto'

// Khóa công khai chỉ dành cho test vector, tuyệt đối không dùng cho enrollment thật.
export const TEST_KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index))
export const CONTRACT_REFERENCE = 'product-h2-runtime-v1'

/** Golden encoding cho fixture JSON đã biết; không sử dụng encoder của implementation. */
export function referenceJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(referenceJson).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${referenceJson(value[key])}`)
    .join(',')}}`
}
export const referenceHash = (value) =>
  createHash('sha256').update(referenceJson(value), 'utf8').digest('hex')
export const referenceSignature = (domain, value, key = TEST_KEY) =>
  createHmac('sha256', key)
    .update(`product-h2:${domain}\n${referenceJson(value)}`, 'utf8')
    .digest('hex')

function runtime(deploymentId = 2) {
  return {
    deployment_id: deploymentId,
    image_tag: `fixture:v${deploymentId}`,
    image_id: `sha256:${String(deploymentId).repeat(64)}`,
    source_sha: String(deploymentId).repeat(40),
    container_id: String(deploymentId).repeat(64),
    collector_container_id: 'c'.repeat(64),
    collector_image_id: `sha256:${'d'.repeat(64)}`,
    config_sha256: 'e'.repeat(64),
    health: 'healthy',
    http_status: 200
  }
}
export function validReceipt(outcome = 'succeeded') {
  const active = runtime(),
    previous = runtime(1)
  previous.collector_container_id = 'a'.repeat(64)
  const context = {
    version: 1,
    execution_nonce: 'f'.repeat(64),
    claim: {
      controller_id: 'fixture-controller',
      app_id: 1,
      job_id: 'fixture-job',
      attempt_id: 'fixture-attempt',
      attempt_number: 1,
      ownership_generation: 1,
      source_generation: 1,
      source_config_sha256: 'a'.repeat(64),
      app_lease_id: 'fixture-app-lease',
      app_fence: 7,
      build_slot_lease_id: 'fixture-build-lease',
      build_slot_fence: 9,
      expires_at: '2026-10-27T13:00:00.000Z'
    },
    target: {
      vps_id: 1,
      host: 'fixture.invalid',
      port: 22,
      host_fingerprint: `SHA256:${'A'.repeat(43)}`,
      username: 'fixture',
      auth_type: 'key',
      ssh_security_revision: 1
    },
    deployment_id: 2,
    source_sha: '2'.repeat(40),
    app_name: 'fixture',
    host_port: 30001,
    container_port: 3000,
    healthcheck_path: '/health',
    candidate_image_tag: 'fixture:v2',
    candidate_image_id: active.image_id,
    build_state: 'build_succeeded',
    previous: { deployment_id: 1, image_tag: 'fixture:v1', source_sha: '1'.repeat(40) },
    activation_id: 8,
    health_timeout_ms: 15000,
    exposure_policy: 'not_checked'
  }
  const result = {
    version: 1,
    context,
    outcome,
    failed_step: null,
    active_runtime: active,
    candidate_runtime: structuredClone(active),
    previous_runtime: previous,
    boundary: { generation: 'fixture-stream', device: 1, inode: 1234, next_offset: 51 },
    exposure_status: 'not_checked',
    remote_quiescent: true,
    sealed_at: '2026-10-27T12:00:00.000Z'
  }
  if (outcome === 'rolled_back') {
    result.failed_step = 'DEPLOY'
    result.active_runtime = structuredClone(previous)
    result.candidate_runtime.health = 'unhealthy'
    result.candidate_runtime.http_status = 503
    result.boundary.next_offset = 101
  } else if (outcome === 'failed') {
    context.build_state = 'build_failed_definite'
    context.candidate_image_id = null
    context.activation_id = null
    result.failed_step = 'BUILD'
    result.active_runtime = structuredClone(previous)
    result.candidate_runtime = null
    result.boundary = null
  }
  return result
}

/** Mỗi vector nêu rõ gate cần kiểm tra, không gộp schema với DB authority. */
export function receiptCases() {
  const cases = []
  const add = (id, outcome, accepted, change = () => {}) => {
    const receipt = validReceipt(outcome)
    change(receipt)
    cases.push({ id, group: 'receipt-schema', accepted, receipt })
  }
  for (const outcome of ['succeeded', 'rolled_back', 'failed'])
    add(`valid-${outcome}`, outcome, true)
  add('valid-first-build-failure', 'failed', true, (value) => {
    value.context.previous = null
    value.previous_runtime = null
    value.active_runtime = null
  })
  add('valid-first-deploy-failure', 'succeeded', true, (value) => {
    value.outcome = 'failed'
    value.failed_step = 'DEPLOY'
    value.context.previous = null
    value.active_runtime = null
    value.previous_runtime = null
    value.candidate_runtime.health = 'unhealthy'
    value.candidate_runtime.http_status = 503
  })
  const identityChanges = {
    deployment_id: 99,
    image_tag: 'other:v99',
    image_id: `sha256:${'9'.repeat(64)}`,
    source_sha: '9'.repeat(40),
    config_sha256: '9'.repeat(64),
    collector_container_id: '9'.repeat(64),
    collector_image_id: `sha256:${'9'.repeat(64)}`
  }
  for (const [field, other] of Object.entries(identityChanges)) {
    add(`candidate-same-cid-wrong-${field}`, 'succeeded', false, (value) => {
      value.candidate_runtime[field] = other
    })
    add(`previous-same-cid-wrong-${field}`, 'rolled_back', false, (value) => {
      value.previous_runtime[field] = other
    })
    add(`preserved-same-cid-wrong-${field}`, 'failed', false, (value) => {
      value.previous_runtime[field] = other
    })
  }
  for (const outcome of ['succeeded', 'rolled_back', 'failed']) {
    add(`not-quiescent-${outcome}`, outcome, false, (value) => {
      value.remote_quiescent = false
    })
    add(`extra-secret-field-${outcome}`, outcome, false, (value) => {
      value.unexpected_secret = 'SYNTHETIC_QA_SENTINEL'
    })
  }
  add('healthy-with-http503', 'succeeded', false, (value) => {
    value.active_runtime.http_status = 503
  })
  add('healthy-without-status', 'succeeded', false, (value) => {
    value.active_runtime.http_status = null
  })
  add('success-active-wrong-source', 'succeeded', false, (value) => {
    value.active_runtime.source_sha = '9'.repeat(40)
  })
  add('success-active-wrong-cid', 'succeeded', false, (value) => {
    value.active_runtime.container_id = '9'.repeat(64)
  })
  add('success-with-failed-step', 'succeeded', false, (value) => {
    value.failed_step = 'BUILD'
  })
  add('success-without-activation', 'succeeded', false, (value) => {
    value.context.activation_id = null
  })
  add('success-without-boundary', 'succeeded', false, (value) => {
    value.boundary = null
  })
  add('success-without-collector', 'succeeded', false, (value) => {
    value.active_runtime.collector_container_id = null
    value.active_runtime.collector_image_id = null
  })
  add('rollback-without-previous', 'rolled_back', false, (value) => {
    value.context.previous = null
  })
  add('rollback-wrong-current-deployment', 'rolled_back', false, (value) => {
    value.active_runtime.deployment_id = 2
  })
  add('rollback-without-boundary', 'rolled_back', false, (value) => {
    value.boundary = null
  })
  add('build-failure-with-candidate-image', 'failed', false, (value) => {
    value.context.candidate_image_id = `sha256:${'2'.repeat(64)}`
  })
  add('build-failure-with-activation', 'failed', false, (value) => {
    value.context.activation_id = 8
  })
  add('build-failure-with-boundary', 'failed', false, (value) => {
    value.boundary = { generation: 'fixture-stream', device: 1, inode: 1234, next_offset: 1 }
  })
  add('failed-without-failed-step', 'failed', false, (value) => {
    value.failed_step = null
  })
  add('failed-previous-unhealthy', 'failed', false, (value) => {
    value.active_runtime.health = 'unhealthy'
    value.active_runtime.http_status = 503
  })
  add('context-invalid-image-id', 'succeeded', false, (value) => {
    value.context.candidate_image_id = 'sha256:short'
  })
  add('context-extra-key', 'succeeded', false, (value) => {
    value.context.arbitrary_shell = 'SYNTHETIC_QA_SENTINEL'
  })
  add('lease-fence-not-integer', 'succeeded', false, (value) => {
    value.context.claim.app_fence = 1.5
  })
  add('timestamp-not-utc', 'succeeded', false, (value) => {
    value.sealed_at = '2026-10-27T19:00:00+07:00'
  })
  add('boundary-invalid-offset', 'succeeded', false, (value) => {
    value.boundary.next_offset = 0
  })
  return cases
}

export function canonicalCases() {
  return [
    {
      id: 'canonical-order',
      value: { z: 1, a: { y: false, a: null } },
      canonical: '{"a":{"a":null,"y":false},"z":1}'
    },
    {
      id: 'canonical-unicode',
      value: { text: 'Tiếng Việt', line: 'a\nb', slash: '/x' },
      canonical: '{"line":"a\\nb","slash":"/x","text":"Tiếng Việt"}'
    },
    {
      id: 'canonical-array',
      value: { list: [2, 1, true, null] },
      canonical: '{"list":[2,1,true,null]}'
    },
    { id: 'canonical-zero', value: { zero: -0 }, canonical: '{"zero":0}' }
  ]
}
export function authCases() {
  const payload = validReceipt(),
    signature = referenceSignature('receipt', payload)
  return [
    { id: 'auth-valid', domain: 'receipt', payload, signature, key: TEST_KEY, accepted: true },
    {
      id: 'auth-wrong-secret',
      domain: 'receipt',
      payload,
      signature,
      key: Buffer.alloc(32, 255),
      accepted: false
    },
    {
      id: 'auth-wrong-domain',
      domain: 'commit',
      payload,
      signature,
      key: TEST_KEY,
      accepted: false
    },
    {
      id: 'auth-tampered-payload',
      domain: 'receipt',
      payload: { ...payload, sealed_at: '2026-10-27T12:00:01.000Z' },
      signature,
      key: TEST_KEY,
      accepted: false
    },
    {
      id: 'auth-short-signature',
      domain: 'receipt',
      payload,
      signature: 'abcd',
      key: TEST_KEY,
      accepted: false
    },
    {
      id: 'auth-nonhex-signature',
      domain: 'receipt',
      payload,
      signature: 'g'.repeat(64),
      key: TEST_KEY,
      accepted: false
    },
    {
      id: 'auth-empty-key',
      domain: 'receipt',
      payload,
      signature,
      key: Buffer.alloc(0),
      accepted: false
    }
  ]
}
