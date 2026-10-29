import { describe, expect, it } from 'vitest'

import { previousRuntime, productOutcomeFixture } from './__fixtures__/productOutcome'
import { evaluateProductOutcome } from './productOutcomePolicy'

describe('H2 outcome policy — identity, leases và dữ liệu sai', () => {
  const sample = productOutcomeFixture()
  it.each(Object.keys(sample.context.claim))('từ chối claim mismatch tại %s', (key) => {
    const { context, evidence } = productOutcomeFixture()
    const value = Reflect.get(evidence.claim, key)
    Reflect.set(
      evidence.claim,
      key,
      typeof value === 'number'
        ? value + 1
        : key === 'source_config_sha256'
          ? 'b'.repeat(64)
          : key === 'expires_at'
            ? '2026-10-26T12:01:00.000Z'
            : `${value}-other`
    )
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({
      action: 'reconciliation_required',
      code: 'IDENTITY_MISMATCH'
    })
  })

  const targetChanges = {
    vps_id: 2,
    host: 'other.invalid',
    port: 2222,
    host_fingerprint: `SHA256:${'B'.repeat(43)}`,
    username: 'other',
    auth_type: 'password',
    ssh_security_revision: 3
  }
  it.each(Object.entries(targetChanges))('từ chối target binding mismatch tại %s', (key, value) => {
    const { context, evidence } = productOutcomeFixture()
    Reflect.set(evidence.target, key, value)
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'IDENTITY_MISMATCH' })
  })

  const candidateChanges = {
    deployment_id: 3,
    image_tag: 'example:v3',
    image_id: `sha256:${'f'.repeat(64)}`,
    source_sha: '3'.repeat(40)
  }
  it.each(Object.entries(candidateChanges))('từ chối candidate mismatch tại %s', (key, value) => {
    const { context, evidence } = productOutcomeFixture()
    Reflect.set(evidence.candidate, key, value)
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'IDENTITY_MISMATCH' })
  })

  it.each(Object.entries(candidateChanges))('HTTP 200 không cứu runtime sai %s', (key, value) => {
    const { context, evidence } = productOutcomeFixture()
    Reflect.set(evidence.runtime!, key, value)
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'RUNTIME_MISMATCH' })
  })

  it('HTTP 200 từ container V1 không chứng minh V2 healthy', () => {
    const fixture = productOutcomeFixture()
    fixture.evidence.runtime = previousRuntime(fixture)
    expect(evaluateProductOutcome(fixture.context, fixture.evidence)).toMatchObject({
      code: 'RUNTIME_MISMATCH'
    })
  })

  it('không chấp nhận candidate dùng lại container ID baseline V1', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.runtime!.container_id = context.previous!.container_id
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'RUNTIME_MISMATCH' })
  })

  it('không coi candidate là previous của chính nó', () => {
    const { context, evidence } = productOutcomeFixture()
    context.previous!.deployment_id = context.candidate.deployment_id
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'IDENTITY_MISMATCH' })
  })

  it('không finalize hoặc đề xuất restore bằng stale authority', () => {
    const { context, evidence } = productOutcomeFixture()
    context.authority = 'stale'
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'AUTHORITY_STALE' })
  })

  it.each(['app_lease_expires_at', 'build_slot_lease_expires_at'] as const)(
    'lease %s hết hạn đúng boundary cũng bị chặn',
    (field) => {
      const { context, evidence } = productOutcomeFixture()
      context[field] = new Date(context.now_ms).toISOString()
      expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'LEASE_EXPIRED' })
      context[field] = new Date(context.now_ms + 1).toISOString()
      expect(evaluateProductOutcome(context, evidence)).toMatchObject({
        action: 'candidate_healthy'
      })
    }
  )

  it('dùng live lease deadlines sau heartbeat, không dùng claim TTL cũ để chặn nhầm', () => {
    const { context, evidence } = productOutcomeFixture()
    context.claim.expires_at = evidence.claim.expires_at = '2026-10-26T11:59:59.000Z'
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ action: 'candidate_healthy' })
  })

  it.each([null, [], 'secret-value', 1, true, {}, { phase: 'publish' }])(
    'input malformed fail closed: %#',
    (input) => {
      const { context, evidence } = productOutcomeFixture()
      expect(evaluateProductOutcome(context, input)).toEqual({
        action: 'reconciliation_required',
        code: 'EVIDENCE_INVALID'
      })
      expect(evaluateProductOutcome(input, evidence)).toEqual({
        action: 'reconciliation_required',
        code: 'EVIDENCE_INVALID'
      })
    }
  )

  it('từ chối dữ liệu thêm hoặc secret mà không echo payload', () => {
    const { context, evidence } = productOutcomeFixture()
    const secret = 'DO_NOT_ECHO_PASSWORD'
    for (const bad of [
      { ...evidence, password: secret },
      { ...evidence, target: { ...evidence.target, encrypted_secret: secret } },
      {
        ...evidence,
        runtime: { ...evidence.runtime, health: { ...evidence.runtime!.health, body: secret } }
      }
    ]) {
      const result = evaluateProductOutcome(context, bad)
      expect(result).toEqual({ action: 'reconciliation_required', code: 'EVIDENCE_INVALID' })
      expect(JSON.stringify(result)).not.toContain(secret)
    }
  })

  it('getter ném lỗi không được làm lộ exception hoặc phá policy', () => {
    const { context } = productOutcomeFixture()
    const bad = Object.defineProperty({}, 'claim', {
      get() {
        throw new Error('SECRET_GETTER')
      }
    })
    expect(evaluateProductOutcome(context, bad)).toEqual({
      action: 'reconciliation_required',
      code: 'EVIDENCE_INVALID'
    })
  })

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'từ chối numeric ID không hợp lệ: %s',
    (id) => {
      const { context, evidence } = productOutcomeFixture()
      expect(
        evaluateProductOutcome(context, {
          ...evidence,
          candidate: { ...evidence.candidate, deployment_id: id }
        })
      ).toMatchObject({ code: 'EVIDENCE_INVALID' })
    }
  )

  it.each(['2'.repeat(39), '2'.repeat(41), 'A'.repeat(40), '../escape', 'x'.repeat(70_000)])(
    'từ chối SHA sai hoặc quá dài: %#',
    (value) => {
      const { context, evidence } = productOutcomeFixture()
      expect(
        evaluateProductOutcome(context, {
          ...evidence,
          candidate: { ...evidence.candidate, source_sha: value }
        })
      ).toMatchObject({ code: 'EVIDENCE_INVALID' })
    }
  )
})

describe('H2 outcome policy — freshness và health proof', () => {
  it.each([1, -30_001, -15_001])('observed_at offset %sms không hợp lệ', (offset) => {
    const { context, evidence } = productOutcomeFixture()
    evidence.observed_at = evidence.runtime!.health.checked_at = new Date(
      context.now_ms + offset
    ).toISOString()
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({
      code: 'EVIDENCE_TIME_INVALID'
    })
  })

  it('freshness boundary đúng giới hạn được nhận', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.observed_at = evidence.runtime!.health.checked_at = new Date(
      context.now_ms - context.max_evidence_age_ms
    ).toISOString()
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ action: 'candidate_healthy' })
  })

  it('health proof phải có trước observed_at và sau session start', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.runtime!.health.checked_at = new Date(context.now_ms - 50).toISOString()
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({
      code: 'EVIDENCE_TIME_INVALID'
    })
    evidence.runtime!.health.checked_at = new Date(
      Date.parse(context.execution_started_at) - 1
    ).toISOString()
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({
      code: 'EVIDENCE_TIME_INVALID'
    })
  })

  it('không nhận execution bắt đầu trong tương lai', () => {
    const { context, evidence } = productOutcomeFixture()
    context.execution_started_at = new Date(context.now_ms + 1).toISOString()
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({
      code: 'EVIDENCE_TIME_INVALID'
    })
  })

  it.each(['2026-02-30T12:00:00.000Z', '2026-10-26T12:00:00+07:00', '2026-10-26', 'secret-date'])(
    'timestamp %s không canonical bị từ chối',
    (value) => {
      const { context, evidence } = productOutcomeFixture()
      evidence.observed_at = value
      expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'EVIDENCE_INVALID' })
    }
  )

  it.each([0, -1, 60_001, 1.5])('không cho freshness bound %s vượt policy lease TTL', (bound) => {
    const { context, evidence } = productOutcomeFixture()
    context.max_evidence_age_ms = bound
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'EVIDENCE_INVALID' })
  })

  it.each([null, 199, 300, 500])('nhãn healthy nhưng HTTP %s không được nhận', (status) => {
    const { context, evidence } = productOutcomeFixture()
    evidence.runtime!.health.http_status = status
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({
      code: 'PHASE_OUTCOME_CONFLICT'
    })
  })

  it.each([200, 204, 299])('healthy với HTTP %s hợp lệ', (status) => {
    const { context, evidence } = productOutcomeFixture()
    evidence.runtime!.health.http_status = status
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ action: 'candidate_healthy' })
  })

  it('nhãn unhealthy với HTTP 200 là evidence mâu thuẫn', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.runtime!.health.state = 'unhealthy'
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({
      code: 'PHASE_OUTCOME_CONFLICT'
    })
  })

  it.each(['health', 'publish', 'rollback'] as const)(
    'health unknown không qua phase %s',
    (phase) => {
      const { context, evidence } = productOutcomeFixture()
      evidence.phase = phase
      evidence.runtime!.health = {
        state: 'unknown',
        http_status: null,
        checked_at: evidence.observed_at
      }
      expect(evaluateProductOutcome(context, evidence)).toMatchObject({
        action: 'reconciliation_required'
      })
    }
  )

  it('health outcome failed nhưng proof healthy không tự rollback', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.phase = 'health'
    evidence.outcome = 'failed'
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({
      code: 'PHASE_OUTCOME_CONFLICT'
    })
  })
})
