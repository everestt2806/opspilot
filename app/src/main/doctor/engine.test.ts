import { describe, expect, it } from 'vitest'

import { diagnose, redactEvidence, redactText } from './engine'

describe('Deploy Doctor - Engine Rules & Abstain', () => {
  describe('RUNTIME_OOM rule', () => {
    it('chẩn đoán OOM từ exitCode 137 và oomKilled flag', () => {
      const result = diagnose({
        containerState: { status: 'exited', exitCode: 137, oomKilled: true }
      })
      expect(result.code).toBe('RUNTIME_OOM')
      expect(result.confidence).toBe('high')
      expect(result.safeToAutoFix).toBe(false)
      expect(result.fixId).toBeNull()
      expect(result.verifyProbe).toBe('container_state')
    })

    it('chẩn đoán OOM từ exitCode 137 dù oomKilled không có', () => {
      const result = diagnose({
        containerState: { status: 'exited', exitCode: 137 }
      })
      expect(result.code).toBe('RUNTIME_OOM')
      expect(result.confidence).toBe('high')
    })

    it('chẩn đoán OOM từ crash log pattern', () => {
      const result = diagnose({
        logs: 'kernel: [12345.67] Out of memory: Kill process 1234 (node) score 850 or sacrifice child'
      })
      expect(result.code).toBe('RUNTIME_OOM')
      expect(result.confidence).toBe('high')
    })

    it('chẩn đoán OOM từ node fatal error memory allocation pattern', () => {
      const result = diagnose({
        logs: '<--- Last few GCs --->\nFATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory'
      })
      expect(result.code).toBe('RUNTIME_OOM')
      expect(result.confidence).toBe('high')
    })
  })

  describe('PORT_MISMATCH rule', () => {
    it('chẩn đoán PORT_MISMATCH khi listenerPort khác expectedPort', () => {
      const result = diagnose({
        listenerPort: 3000,
        expectedPort: 8080
      })
      expect(result.code).toBe('PORT_MISMATCH')
      expect(result.confidence).toBe('high')
      expect(result.fixId).toBe('redeploy_correct_port')
      expect(result.safeToAutoFix).toBe(false)
    })

    it('chẩn đoán PORT_MISMATCH khi phát hiện qua logs của app', () => {
      const result = diagnose({
        expectedPort: 8080,
        logs: 'info: App server listening on port 3000 successfully'
      })
      expect(result.code).toBe('PORT_MISMATCH')
      expect(result.confidence).toBe('high')
      expect(result.fixId).toBe('redeploy_correct_port')
    })

    it('không kích hoạt PORT_MISMATCH khi listenerPort khớp expectedPort', () => {
      const result = diagnose({
        listenerPort: 8080,
        expectedPort: 8080
      })
      expect(result.code).not.toBe('PORT_MISMATCH')
    })
  })

  describe('PORT_BLOCKED_EXTERNAL rule (UFW / External Probe)', () => {
    it('nhận diện external port blocked khi container running và external probe unreachable', () => {
      const result = diagnose({
        containerState: { status: 'running' },
        externalProbe: 'unreachable'
      })
      expect(result.code).toBe('PORT_BLOCKED_EXTERNAL')
      expect(result.fixId).toBe('reconcile_firewall')
      expect(result.verifyProbe).toBe('external_http')
      expect(result.safeToAutoFix).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('nhận diện PORT_BLOCKED_EXTERNAL khi ufwState active và externalProbe unreachable', () => {
      const result = diagnose({
        ufwState: 'active',
        externalProbe: 'unreachable'
      })
      expect(result.code).toBe('PORT_BLOCKED_EXTERNAL')
      expect(result.fixId).toBe('reconcile_firewall')
      expect(result.safeToAutoFix).toBe(true)
    })
  })

  describe('RUNTIME_CRASH rule & exclusion from OOM', () => {
    it('chẩn đoán RUNTIME_CRASH khi log có exception / crashloop', () => {
      const result = diagnose({
        containerState: { status: 'exited', exitCode: 1 },
        logs: 'TypeError: Cannot read properties of undefined (reading "start")\n    at /app/index.js:15:10'
      })
      expect(result.code).toBe('RUNTIME_CRASH')
      expect(result.confidence).toBe('medium')
      expect(result.fixId).toBeNull()
      expect(result.safeToAutoFix).toBe(false)
    })

    it('loại trừ RUNTIME_CRASH và ưu tiên RUNTIME_OOM khi có exitCode 137', () => {
      const result = diagnose({
        containerState: { status: 'exited', exitCode: 137 },
        logs: 'uncaughtException: out of memory'
      })
      expect(result.code).toBe('RUNTIME_OOM')
      expect(result.abstained).toBe(false)
    })

    it('loại trừ RUNTIME_CRASH khi oomKilled là true', () => {
      const result = diagnose({
        containerState: { status: 'exited', exitCode: 1, oomKilled: true },
        logs: 'process.exit(1)'
      })
      expect(result.code).toBe('RUNTIME_OOM')
      expect(result.abstained).toBe(false)
    })
  })

  describe('Abstention behavior', () => {
    it('abstain (UNKNOWN) khi evidence hoàn toàn trống', () => {
      const result = diagnose({})
      expect(result.code).toBe('UNKNOWN')
      expect(result.abstained).toBe(true)
      expect(result.safeToAutoFix).toBe(false)
      expect(result.fixId).toBeNull()
      expect(result.confidence).toBe('low')
    })

    it('abstain (UNKNOWN) khi thiếu bằng chứng kết luận (chỉ có external probe unreachable mà container không running và ufw không active)', () => {
      const result = diagnose({
        externalProbe: 'unreachable'
      })
      expect(result.code).toBe('UNKNOWN')
      expect(result.abstained).toBe(true)
      expect(result.safeToAutoFix).toBe(false)
    })

    it('abstain khi nhiều root cause cùng khớp (ambiguous)', () => {
      const result = diagnose({
        logs: 'no space left on device; docker daemon down',
        diskFreeMb: 100,
        dockerAvailable: false
      })
      expect(result.abstained).toBe(true)
      expect(result.fixId).toBeNull()
      expect(result.safeToAutoFix).toBe(false)
      expect(result.confidence).toBe('low')
      expect(result.title).toContain('Có nhiều khả năng')
    })
  })

  describe('Redaction', () => {
    it('redact secret và bearer token trước khi lưu evidence', () => {
      const result = redactEvidence({
        logs: 'API_TOKEN=abc123 Authorization: Bearer abc.def password=mysecret',
        dbError: 'failed connection with password=secretpw'
      })
      expect(result.logs).toBe('API_TOKEN=*** Authorization: Bearer *** password=***')
      expect(result.dbError).toBe('failed connection with password=***')
    })

    it('redactText che dấu token và bearer', () => {
      expect(redactText('api_key=xyz-999')).toBe('api_key=***')
      expect(redactText('Bearer token_12345')).toBe('Bearer ***')
    })
  })
})
