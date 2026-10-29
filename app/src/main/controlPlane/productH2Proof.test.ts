import { describe, expect, it } from 'vitest'
import type {
  H2Context,
  H2MetricBoundary,
  H2RuntimeIdentity,
  H2TerminalReceipt
} from '../../../../docs/contracts/product-h2-runtime'
import {
  canonicalH2Json,
  hashH2,
  signH2,
  verifyH2,
  h2ContextSchema,
  h2ReceiptSchema,
  h2EnvelopeSchema,
  h2AttestationSchema,
  h2AckSchema
} from './productH2Proof'

const secret = Buffer.alloc(32, 0x42)

function makeContext(overrides: Partial<H2Context> = {}): H2Context {
  return {
    version: 1,
    execution_nonce: '0'.repeat(64),
    claim: {
      controller_id: 'controller-1',
      app_id: 1,
      job_id: 'job-1',
      attempt_id: 'attempt-1',
      attempt_number: 1,
      ownership_generation: 1,
      source_generation: 1,
      source_config_sha256: 'a'.repeat(64),
      app_lease_id: 'lease-app-1',
      app_fence: 1,
      build_slot_lease_id: 'lease-slot-1',
      build_slot_fence: 1,
      expires_at: '2026-10-27T18:00:00.000Z'
    },
    target: {
      vps_id: 1,
      host: '127.0.0.1',
      port: 22,
      host_fingerprint: `SHA256:${'a'.repeat(43)}`,
      username: 'root',
      auth_type: 'key',
      ssh_security_revision: 1
    },
    deployment_id: 2,
    source_sha: 'b'.repeat(40),
    app_name: 'test-app',
    host_port: 3000,
    container_port: 3000,
    healthcheck_path: '/health',
    candidate_image_tag: 'test-app:v2',
    candidate_image_id: `sha256:${'c'.repeat(64)}`,
    build_state: 'build_succeeded',
    previous: {
      deployment_id: 1,
      image_tag: 'test-app:v1',
      source_sha: 'a'.repeat(40)
    },
    activation_id: 10,
    health_timeout_ms: 5000,
    exposure_policy: 'not_checked',
    ...overrides
  }
}

function makeIdentity(overrides: Partial<H2RuntimeIdentity> = {}): H2RuntimeIdentity {
  return {
    deployment_id: 2,
    image_tag: 'test-app:v2',
    image_id: `sha256:${'c'.repeat(64)}`,
    source_sha: 'b'.repeat(40),
    container_id: '1'.repeat(64),
    collector_container_id: '2'.repeat(64),
    collector_image_id: `sha256:${'d'.repeat(64)}`,
    config_sha256: 'e'.repeat(64),
    health: 'healthy',
    http_status: 200,
    ...overrides
  }
}

function makeBoundary(): H2MetricBoundary {
  return {
    generation: 'gen-1',
    device: 1,
    inode: 2,
    next_offset: 100
  }
}

describe('productH2Proof', () => {
  describe('canonicalH2Json, hashH2, signH2, verifyH2', () => {
    it('produces canonical JSON with sorted keys and safe integers', () => {
      const obj = { z: 1, a: 2, m: { b: 3, a: 4 } }
      expect(canonicalH2Json(obj)).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}')
    })

    it('rejects floats and non-plain objects', () => {
      expect(() => canonicalH2Json({ x: 1.5 })).toThrow('H2_PROOF_INVALID')
      expect(() => canonicalH2Json(new Date())).toThrow('H2_PROOF_INVALID')
    })

    it('hashes canonical JSON into 64-char hex digest', () => {
      const hash = hashH2({ a: 1 })
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('validates h2ContextSchema constraints', () => {
      expect(h2ContextSchema.safeParse(makeContext()).success).toBe(true)
      expect(h2ContextSchema.safeParse(makeContext({ candidate_image_id: null })).success).toBe(
        false
      )
    })

    it('signs and verifies correctly across distinct domains', () => {
      const payload = { test: 123 }
      const receiptSig = signH2('receipt', payload, secret)
      const commitSig = signH2('commit', payload, secret)
      expect(receiptSig).not.toBe(commitSig)
      expect(verifyH2('receipt', payload, receiptSig, secret)).toBe(true)
      expect(verifyH2('commit', payload, receiptSig, secret)).toBe(false)
      expect(verifyH2('commit', payload, commitSig, secret)).toBe(true)
    })

    it('fails verification on tampered payload or secret', () => {
      const payload = { test: 123 }
      const sig = signH2('receipt', payload, secret)
      expect(verifyH2('receipt', { test: 124 }, sig, secret)).toBe(false)
      expect(verifyH2('receipt', payload, sig, Buffer.alloc(32, 0x43))).toBe(false)
    })
  })

  describe('h2ReceiptSchema & H2-PROOF-001 identity consistency', () => {
    it('accepts a valid succeeded receipt with consistent candidate identity', () => {
      const context = makeContext()
      const candidateId = makeIdentity()
      const prevId = makeIdentity({
        deployment_id: 1,
        image_tag: 'test-app:v1',
        source_sha: 'a'.repeat(40),
        container_id: '9'.repeat(64)
      })
      const receipt: H2TerminalReceipt = {
        version: 1,
        context,
        outcome: 'succeeded',
        failed_step: null,
        active_runtime: candidateId,
        candidate_runtime: candidateId,
        previous_runtime: prevId,
        boundary: makeBoundary(),
        exposure_status: 'not_checked',
        remote_quiescent: true,
        sealed_at: '2026-10-27T18:00:05.000Z'
      }
      expect(h2ReceiptSchema.safeParse(receipt).success).toBe(true)
      const envelope = {
        receipt,
        receipt_sha256: hashH2(receipt),
        signature: signH2('receipt', receipt, secret)
      }
      expect(h2EnvelopeSchema.safeParse(envelope).success).toBe(true)
    })

    it('H2-PROOF-001: rejects if active and candidate have same container_id but mismatch image_id', () => {
      const context = makeContext()
      const activeId = makeIdentity({ image_id: `sha256:${'c'.repeat(64)}` })
      const candidateId = makeIdentity({ image_id: `sha256:${'f'.repeat(64)}` })
      const receipt: H2TerminalReceipt = {
        version: 1,
        context,
        outcome: 'succeeded',
        failed_step: null,
        active_runtime: activeId,
        candidate_runtime: candidateId,
        previous_runtime: null,
        boundary: makeBoundary(),
        exposure_status: 'not_checked',
        remote_quiescent: true,
        sealed_at: '2026-10-27T18:00:05.000Z'
      }
      expect(h2ReceiptSchema.safeParse(receipt).success).toBe(false)
    })

    it('H2-PROOF-001: rejects if candidate and previous share the same container_id', () => {
      const context = makeContext()
      const activeId = makeIdentity({ container_id: '1'.repeat(64) })
      const prevId = makeIdentity({
        deployment_id: 1,
        image_tag: 'test-app:v1',
        source_sha: 'a'.repeat(40),
        container_id: '1'.repeat(64) // colliding with active!
      })
      const receipt: H2TerminalReceipt = {
        version: 1,
        context,
        outcome: 'succeeded',
        failed_step: null,
        active_runtime: activeId,
        candidate_runtime: activeId,
        previous_runtime: prevId,
        boundary: makeBoundary(),
        exposure_status: 'not_checked',
        remote_quiescent: true,
        sealed_at: '2026-10-27T18:00:05.000Z'
      }
      expect(h2ReceiptSchema.safeParse(receipt).success).toBe(false)
    })

    it('H2-PROOF-001: accepts valid rolled_back receipt and rejects if restored active differs from previous', () => {
      const context = makeContext()
      const prevId = makeIdentity({
        deployment_id: 1,
        image_tag: 'test-app:v1',
        source_sha: 'a'.repeat(40),
        container_id: '9'.repeat(64)
      })
      const candId = makeIdentity({ container_id: '1'.repeat(64) })
      const validRollback: H2TerminalReceipt = {
        version: 1,
        context,
        outcome: 'rolled_back',
        failed_step: 'DEPLOY',
        active_runtime: prevId,
        candidate_runtime: candId,
        previous_runtime: prevId,
        boundary: makeBoundary(),
        exposure_status: 'not_checked',
        remote_quiescent: true,
        sealed_at: '2026-10-27T18:00:05.000Z'
      }
      expect(h2ReceiptSchema.safeParse(validRollback).success).toBe(true)

      // Tampered active runtime differing from previous
      const tamperedRollback = {
        ...validRollback,
        active_runtime: { ...prevId, image_tag: 'test-app:v99' }
      }
      expect(h2ReceiptSchema.safeParse(tamperedRollback).success).toBe(false)
    })

    it('accepts valid failed BUILD receipt with null boundary and null candidate', () => {
      const context = makeContext({
        build_state: 'build_failed_definite',
        candidate_image_id: null,
        activation_id: null
      })
      const prevId = makeIdentity({
        deployment_id: 1,
        image_tag: 'test-app:v1',
        source_sha: 'a'.repeat(40),
        container_id: '9'.repeat(64)
      })
      const buildFailReceipt: H2TerminalReceipt = {
        version: 1,
        context,
        outcome: 'failed',
        failed_step: 'BUILD',
        active_runtime: prevId,
        candidate_runtime: null,
        previous_runtime: prevId,
        boundary: null,
        exposure_status: 'not_checked',
        remote_quiescent: true,
        sealed_at: '2026-10-27T18:00:05.000Z'
      }
      expect(h2ReceiptSchema.safeParse(buildFailReceipt).success).toBe(true)

      // Must reject if failed BUILD attempts to provide a boundary or candidate
      expect(
        h2ReceiptSchema.safeParse({
          ...buildFailReceipt,
          boundary: makeBoundary()
        }).success
      ).toBe(false)
    })
  })

  describe('h2AttestationSchema and h2AckSchema', () => {
    it('validates complete commit attestation and settlement ack', () => {
      const attestation = {
        payload: {
          version: 1,
          kind: 'product-h2-commit',
          commit_id: 'commit-1',
          receipt_sha256: 'a'.repeat(64),
          context_sha256: 'b'.repeat(64),
          execution_nonce: 'c'.repeat(64),
          attempt_id: 'attempt-1',
          deployment_id: 2,
          outcome: 'succeeded'
        },
        signature: 'd'.repeat(64)
      }
      expect(h2AttestationSchema.safeParse(attestation).success).toBe(true)

      const ack = {
        payload: {
          version: 1,
          kind: 'product-h2-settlement',
          commit_id: 'commit-1',
          receipt_sha256: 'a'.repeat(64),
          context_sha256: 'b'.repeat(64),
          execution_nonce: 'c'.repeat(64),
          attempt_id: 'attempt-1',
          deployment_id: 2,
          settled_at: '2026-10-27T18:00:10.000Z'
        },
        signature: 'e'.repeat(64)
      }
      expect(h2AckSchema.safeParse(ack).success).toBe(true)
    })
  })
})
