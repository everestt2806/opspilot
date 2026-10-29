import type { ProductOutcomeContext, ProductOutcomeEvidence } from '../productOutcomePolicy'

export function productOutcomeFixture(): {
  context: ProductOutcomeContext
  evidence: ProductOutcomeEvidence
} {
  const now = Date.parse('2026-10-26T12:00:00.000Z')
  const context: ProductOutcomeContext = {
    claim: {
      controller_id: 'controller-1',
      app_id: 1,
      job_id: 'job-1',
      attempt_id: 'attempt-1',
      attempt_number: 1,
      ownership_generation: 2,
      source_generation: 3,
      source_config_sha256: 'a'.repeat(64),
      app_lease_id: 'app-lease-1',
      app_fence: 4,
      build_slot_lease_id: 'build-lease-1',
      build_slot_fence: 5,
      expires_at: new Date(now + 30_000).toISOString()
    },
    target: {
      vps_id: 1,
      host: 'lab.invalid',
      port: 22,
      host_fingerprint: `SHA256:${'A'.repeat(43)}`,
      username: 'lab',
      auth_type: 'key',
      ssh_security_revision: 2
    },
    candidate: {
      deployment_id: 2,
      image_tag: 'example:v2',
      image_id: `sha256:${'b'.repeat(64)}`,
      source_sha: '2'.repeat(40)
    },
    previous: {
      deployment_id: 1,
      image_tag: 'example:v1',
      image_id: `sha256:${'c'.repeat(64)}`,
      source_sha: '1'.repeat(40),
      container_id: 'd'.repeat(64)
    },
    authority: 'current',
    now_ms: now,
    execution_started_at: new Date(now - 30_000).toISOString(),
    app_lease_expires_at: new Date(now + 30_000).toISOString(),
    build_slot_lease_expires_at: new Date(now + 30_000).toISOString(),
    max_evidence_age_ms: 15_000
  }
  const evidence: ProductOutcomeEvidence = {
    claim: structuredClone(context.claim),
    target: structuredClone(context.target),
    candidate: structuredClone(context.candidate),
    phase: 'publish',
    outcome: 'succeeded',
    observed_at: new Date(now - 100).toISOString(),
    remote_quiescent: true,
    exposure_status: 'reachable',
    runtime: {
      ...context.candidate,
      container_id: 'e'.repeat(64),
      health: { state: 'healthy', http_status: 200, checked_at: new Date(now - 100).toISOString() }
    }
  }
  return { context, evidence }
}

export function previousRuntime(
  fixture: ReturnType<typeof productOutcomeFixture>
): NonNullable<ProductOutcomeEvidence['runtime']> {
  if (!fixture.context.previous) throw new Error('Fixture cần previous runtime')
  return {
    ...fixture.context.previous,
    health: { state: 'healthy', http_status: 200, checked_at: fixture.evidence.observed_at }
  }
}
