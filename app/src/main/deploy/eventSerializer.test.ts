import { describe, expect, it } from 'vitest'

import { sanitizeObject, sanitizeText, serializeCliEvent } from './eventSerializer'

describe('eventSerializer (TK-S6 P2d-1b)', () => {
  const secrets = ['super_ssh_password_123', 'secret_db_token_456', 'api_key_789']

  describe('sanitizeText', () => {
    it('trả về nguyên văn khi không có secret hoặc text rỗng', () => {
      expect(sanitizeText('', secrets)).toBe('')
      expect(sanitizeText('hello world', [])).toBe('hello world')
      expect(sanitizeText('hello world', [''])).toBe('hello world')
    })

    it('khử chính xác một hoặc nhiều secret trong chuỗi', () => {
      const input = 'Connecting with super_ssh_password_123 and token secret_db_token_456'
      const sanitized = sanitizeText(input, secrets)
      expect(sanitized).toBe('Connecting with ***REDACTED*** and token ***REDACTED***')
      expect(sanitized).not.toContain('super_ssh_password_123')
      expect(sanitized).not.toContain('secret_db_token_456')
    })
  })

  describe('sanitizeObject', () => {
    it('khử secret đệ quy trong đối tượng lồng nhau, mảng và giữ nguyên kiểu nguyên thuỷ', () => {
      const input = {
        name: 'test-app',
        vpsId: 1,
        active: true,
        secretVal: 'api_key_789',
        nested: {
          cmd: 'sshpass -p super_ssh_password_123 ssh root@host',
          list: ['safe_item', 'token=secret_db_token_456', 42, null]
        }
      }

      const output = sanitizeObject(input, secrets)
      expect(output.name).toBe('test-app')
      expect(output.vpsId).toBe(1)
      expect(output.active).toBe(true)
      expect(output.secretVal).toBe('***REDACTED***')
      expect(output.nested.cmd).toBe('sshpass -p ***REDACTED*** ssh root@host')
      expect(output.nested.list[0]).toBe('safe_item')
      expect(output.nested.list[1]).toBe('token=***REDACTED***')
      expect(output.nested.list[2]).toBe(42)
      expect(output.nested.list[3]).toBeNull()
    })
  })

  describe('serializeCliEvent', () => {
    it('khử secret trong step_failed kể cả error.message và error.technical', () => {
      const failedEvent = {
        event: 'step_failed',
        step: 'BUILD',
        deployment_id: 10,
        error: 'Build failed while passing secret_db_token_456 to Docker',
        technical:
          'Error: SSH handshake failed for user root with secret super_ssh_password_123 (code 403)'
      }

      const jsonStr = serializeCliEvent(failedEvent, secrets)
      expect(jsonStr).not.toContain('secret_db_token_456')
      expect(jsonStr).not.toContain('super_ssh_password_123')
      expect(jsonStr).toContain('***REDACTED***')

      const parsed = JSON.parse(jsonStr)
      expect(parsed.event).toBe('step_failed')
      expect(parsed.error).toBe('Build failed while passing ***REDACTED*** to Docker')
      expect(parsed.technical).toBe(
        'Error: SSH handshake failed for user root with secret ***REDACTED*** (code 403)'
      )
    })

    it('khử secret trong finished event chứa app_url nhạy cảm', () => {
      const finishedEvent = {
        event: 'finished',
        deployment_id: 11,
        status: 'running',
        app_url: 'http://admin:api_key_789@127.0.0.1:3000',
        total_duration_ms: 1200
      }

      const jsonStr = serializeCliEvent(finishedEvent, secrets)
      expect(jsonStr).not.toContain('api_key_789')

      const parsed = JSON.parse(jsonStr)
      expect(parsed.app_url).toBe('http://admin:***REDACTED***@127.0.0.1:3000')
      expect(parsed.status).toBe('running')
    })

    it('khử secret trong error event trước khi có deployment_id', () => {
      const errorEvent = {
        event: 'error',
        error: 'Authentication failed using password super_ssh_password_123'
      }

      const jsonStr = serializeCliEvent(errorEvent, secrets)
      expect(jsonStr).not.toContain('super_ssh_password_123')

      const parsed = JSON.parse(jsonStr)
      expect(parsed.event).toBe('error')
      expect(parsed.error).toBe('Authentication failed using password ***REDACTED***')
    })
  })
})
