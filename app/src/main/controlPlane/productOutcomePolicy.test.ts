import { describe, expect, it } from 'vitest'

import { previousRuntime, productOutcomeFixture } from './__fixtures__/productOutcome'
import { evaluateProductOutcome } from './productOutcomePolicy'

describe('H2 outcome policy — trạng thái và phục hồi', () => {
  it('chỉ đề xuất success sau publish có runtime đúng và healthy', () => {
    const { context, evidence } = productOutcomeFixture()
    expect(evaluateProductOutcome(context, evidence)).toEqual({
      action: 'candidate_healthy',
      proposed_job_state: 'succeeded',
      exposure_status: 'reachable'
    })
  })

  it.each(['reachable', 'degraded', 'tunnel_only', 'not_checked'] as const)(
    'giữ exposure %s riêng với runtime health',
    (exposure) => {
      const { context, evidence } = productOutcomeFixture()
      evidence.exposure_status = exposure
      expect(evaluateProductOutcome(context, evidence)).toMatchObject({
        action: 'candidate_healthy',
        exposure_status: exposure
      })
    }
  )

  it('publish thất bại nhưng candidate healthy không rollback', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.outcome = 'failed'
    expect(evaluateProductOutcome(context, evidence)).toEqual({
      action: 'candidate_healthy',
      proposed_job_state: 'succeeded',
      exposure_status: 'degraded'
    })
  })

  it('publish mất receipt không bị coi là lỗi external probe thông thường', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.outcome = 'unknown'
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({
      action: 'reconciliation_required',
      code: 'REMOTE_OUTCOME_UNKNOWN'
    })
  })

  it.each(['succeeded', 'failed'] as const)('build %s vẫn giữ previous runtime', (outcome) => {
    const fixture = productOutcomeFixture()
    fixture.evidence.phase = 'build'
    fixture.evidence.outcome = outcome
    fixture.evidence.runtime = previousRuntime(fixture)
    expect(evaluateProductOutcome(fixture.context, fixture.evidence)).toEqual(
      outcome === 'succeeded'
        ? { action: 'continue_activation' }
        : { action: 'previous_preserved', proposed_job_state: 'failed', failed_step: 'BUILD' }
    )
  })

  it.each(['succeeded', 'failed'] as const)('build đầu tiên %s khi chưa có runtime', (outcome) => {
    const { context, evidence } = productOutcomeFixture()
    context.previous = null
    evidence.phase = 'build'
    evidence.outcome = outcome
    evidence.runtime = null
    expect(evaluateProductOutcome(context, evidence)).toEqual(
      outcome === 'succeeded'
        ? { action: 'continue_activation' }
        : { action: 'first_deploy_failed', proposed_job_state: 'failed', failed_step: 'BUILD' }
    )
  })

  it('không nhận build thành công khi runtime đã bị đổi sang candidate', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.phase = 'build'
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'RUNTIME_MISMATCH' })
  })

  it('activate thành công chưa đủ để chốt healthy/success', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.phase = 'activate'
    evidence.runtime!.health = {
      state: 'unknown',
      http_status: null,
      checked_at: evidence.observed_at
    }
    expect(evaluateProductOutcome(context, evidence)).toEqual({ action: 'check_candidate_health' })
  })

  it('activate lỗi xác định khi V1 nguyên vẹn đề xuất giữ V1', () => {
    const fixture = productOutcomeFixture()
    fixture.evidence.phase = 'activate'
    fixture.evidence.outcome = 'failed'
    fixture.evidence.runtime = previousRuntime(fixture)
    expect(evaluateProductOutcome(fixture.context, fixture.evidence)).toEqual({
      action: 'previous_preserved',
      proposed_job_state: 'failed',
      failed_step: 'DEPLOY'
    })
  })

  it('activate lỗi xác định khi candidate đã chạy đề xuất restore previous', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.phase = 'activate'
    evidence.outcome = 'failed'
    expect(evaluateProductOutcome(context, evidence)).toEqual({
      action: 'restore_previous',
      deployment_id: 1
    })
  })

  it('activate thất bại đầu tiên không tạo previous giả', () => {
    const { context, evidence } = productOutcomeFixture()
    context.previous = null
    evidence.runtime = null
    evidence.phase = 'activate'
    evidence.outcome = 'failed'
    expect(evaluateProductOutcome(context, evidence)).toEqual({
      action: 'first_deploy_failed',
      proposed_job_state: 'failed',
      failed_step: 'DEPLOY'
    })
  })

  it('candidate healthy tiếp tục kiểm tra exposure', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.phase = 'health'
    expect(evaluateProductOutcome(context, evidence)).toEqual({ action: 'check_exposure' })
  })

  it.each([false, true])('health lỗi khi first-deploy=%s', (firstDeploy) => {
    const { context, evidence } = productOutcomeFixture()
    if (firstDeploy) context.previous = null
    evidence.phase = 'health'
    evidence.outcome = 'failed'
    evidence.runtime!.health.state = 'unhealthy'
    evidence.runtime!.health.http_status = 500
    expect(evaluateProductOutcome(context, evidence)).toEqual(
      firstDeploy
        ? {
            action: 'first_deploy_failed',
            proposed_job_state: 'failed',
            failed_step: 'HEALTHCHECK'
          }
        : { action: 'restore_previous', deployment_id: 1 }
    )
  })

  it('HTTP timeout đã xác định là unhealthy cho phép recovery, không biến thành healthy', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.phase = 'health'
    evidence.outcome = 'failed'
    evidence.runtime!.health = {
      state: 'unhealthy',
      http_status: null,
      checked_at: evidence.observed_at
    }
    expect(evaluateProductOutcome(context, evidence)).toEqual({
      action: 'restore_previous',
      deployment_id: 1
    })
  })

  it('restore có thể recreate container nhưng phải giữ image ID/source của V1', () => {
    const fixture = productOutcomeFixture()
    fixture.evidence.phase = 'rollback'
    fixture.evidence.runtime = previousRuntime(fixture)
    fixture.evidence.runtime.container_id = 'f'.repeat(64)
    expect(evaluateProductOutcome(fixture.context, fixture.evidence)).toEqual({
      action: 'previous_restored',
      proposed_job_state: 'rolled_back',
      deployment_id: 1
    })
  })

  it.each(['failed', 'unknown'] as const)('restore %s không nhận rolled_back', (outcome) => {
    const fixture = productOutcomeFixture()
    fixture.evidence.phase = 'rollback'
    fixture.evidence.outcome = outcome
    fixture.evidence.runtime = previousRuntime(fixture)
    expect(evaluateProductOutcome(fixture.context, fixture.evidence)).toMatchObject({
      action: 'reconciliation_required'
    })
  })

  it('restore không có previous đã pin không được nhận rolled_back', () => {
    const { context, evidence } = productOutcomeFixture()
    context.previous = null
    evidence.phase = 'rollback'
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({ code: 'HEALTH_UNVERIFIED' })
  })

  it.each(['build', 'activate', 'health', 'rollback', 'publish'] as const)(
    'không suy diễn outcome khi phase %s còn child mutation đang chạy',
    (phase) => {
      const { context, evidence } = productOutcomeFixture()
      evidence.phase = phase
      evidence.remote_quiescent = false
      expect(evaluateProductOutcome(context, evidence)).toMatchObject({
        action: 'reconciliation_required',
        code: 'REMOTE_OUTCOME_UNKNOWN'
      })
    }
  )

  it('không mutate input context/evidence hoặc ghi thông tin thừa vào decision', () => {
    const fixture = productOutcomeFixture()
    const before = structuredClone(fixture)
    const result = evaluateProductOutcome(fixture.context, fixture.evidence)
    expect(fixture).toEqual(before)
    expect(Object.keys(result).sort()).toEqual(['action', 'exposure_status', 'proposed_job_state'])
  })

  it.each(['build', 'activate', 'health', 'rollback', 'publish'] as const)(
    'mất receipt ở phase %s luôn yêu cầu reconciliation, không có action retry',
    (phase) => {
      const { context, evidence } = productOutcomeFixture()
      evidence.phase = phase
      evidence.outcome = 'unknown'
      expect(evaluateProductOutcome(context, evidence)).toEqual({
        action: 'reconciliation_required',
        code: 'REMOTE_OUTCOME_UNKNOWN'
      })
    }
  )

  it.each(['activate', 'health', 'publish'] as const)(
    'không có runtime proof thì phase %s chưa được qua',
    (phase) => {
      const { context, evidence } = productOutcomeFixture()
      evidence.phase = phase
      evidence.runtime = null
      expect(evaluateProductOutcome(context, evidence)).toMatchObject({
        action: 'reconciliation_required',
        code: 'RUNTIME_MISMATCH'
      })
    }
  )

  it('health outcome succeeded nhưng candidate unhealthy không được qua', () => {
    const { context, evidence } = productOutcomeFixture()
    evidence.phase = 'health'
    evidence.runtime!.health.state = 'unhealthy'
    evidence.runtime!.health.http_status = 503
    expect(evaluateProductOutcome(context, evidence)).toMatchObject({
      code: 'PHASE_OUTCOME_CONFLICT'
    })
  })

  it('build failure không được nhận previous preserved nếu V1 không healthy', () => {
    const fixture = productOutcomeFixture()
    fixture.evidence.phase = 'build'
    fixture.evidence.outcome = 'failed'
    fixture.evidence.runtime = previousRuntime(fixture)
    fixture.evidence.runtime.health.state = 'unhealthy'
    fixture.evidence.runtime.health.http_status = 503
    expect(evaluateProductOutcome(fixture.context, fixture.evidence)).toMatchObject({
      code: 'RUNTIME_MISMATCH'
    })
  })

  it('restore không được nhận tag V1 nếu image ID đã đổi', () => {
    const fixture = productOutcomeFixture()
    fixture.evidence.phase = 'rollback'
    fixture.evidence.runtime = previousRuntime(fixture)
    fixture.evidence.runtime.image_id = fixture.context.candidate.image_id
    expect(evaluateProductOutcome(fixture.context, fixture.evidence)).toMatchObject({
      code: 'HEALTH_UNVERIFIED'
    })
  })
})
