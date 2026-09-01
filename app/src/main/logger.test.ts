import { describe, expect, it } from 'vitest'

import { maskSecrets } from './logger'

describe('maskSecrets', () => {
  it('che password, token va private key', () => {
    const input = [
      'password=mat-khau-that',
      'token:abc123',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'noi-dung-key',
      '-----END OPENSSH PRIVATE KEY-----'
    ].join('\n')

    const result = maskSecrets(input)

    expect(result).not.toContain('mat-khau-that')
    expect(result).not.toContain('abc123')
    expect(result).not.toContain('noi-dung-key')
    expect(result).toContain('password=***')
  })

  it('che credential nam trong URL ket noi', () => {
    const result = maskSecrets('DATABASE_URL=postgresql://opspilot:mat-khau@postgres:5432/app')

    expect(result).toBe('DATABASE_URL=postgresql://opspilot:***@postgres:5432/app')
    expect(result).not.toContain('mat-khau')
  })
})
