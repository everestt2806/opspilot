import { describe, expect, it } from 'vitest'

import { isRetryableConnectionError, mapSshError } from './errorMapping'
import { shellQuote } from './shellQuote'

describe('shellQuote', () => {
  it('boc binh thuong', () => {
    expect(shellQuote('app-demo')).toBe("'app-demo'")
  })

  it('this co don nhan don', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })

  it('vo hieu hoa $ ; & va xuong dong (nam trong single quote nen la chu thuong)', () => {
    const input = '$(rm -rf /); echo pwned'
    expect(shellQuote(input)).toBe(`'$(rm -rf /); echo pwned'`)
  })

  it('chuoi rong van hop le', () => {
    expect(shellQuote('')).toBe("''")
  })
})

describe('mapSshError', () => {
  it('nhan dang AUTH_FAILED', () => {
    expect(mapSshError(new Error('All configured authentication methods failed'))).toBe(
      'SSH_AUTH_FAILED'
    )
  })

  it('nhan dang TIMEOUT', () => {
    expect(mapSshError(new Error('connect ETIMEDOUT 192.168.1.5:22'))).toBe('SSH_TIMEOUT')
    expect(mapSshError(new Error('Timed out while waiting for handshake'))).toBe('SSH_TIMEOUT')
  })

  it('nhan dang HOST_UNREACHABLE', () => {
    expect(mapSshError(new Error('connect ECONNREFUSED 203.0.113.5:22'))).toBe(
      'SSH_HOST_UNREACHABLE'
    )
    expect(mapSshError(new Error('connect EHOSTUNREACH 203.0.113.9:22'))).toBe(
      'SSH_HOST_UNREACHABLE'
    )
    expect(mapSshError(new Error('getaddrinfo ENOTFOUND khong-ton-tai.local'))).toBe(
      'SSH_HOST_UNREACHABLE'
    )
  })

  it('con lai la UNKNOWN', () => {
    expect(mapSshError(new Error('something else entirely'))).toBe('UNKNOWN')
    expect(mapSshError('not even an error')).toBe('UNKNOWN')
  })
})

describe('isRetryableConnectionError', () => {
  it('chi retry loi mang, khong retry AUTH_FAILED', () => {
    expect(isRetryableConnectionError('SSH_TIMEOUT')).toBe(true)
    expect(isRetryableConnectionError('SSH_HOST_UNREACHABLE')).toBe(true)
    expect(isRetryableConnectionError('SSH_AUTH_FAILED')).toBe(false)
    expect(isRetryableConnectionError('UNKNOWN')).toBe(false)
  })
})
