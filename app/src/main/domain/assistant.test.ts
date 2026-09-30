import { describe, expect, it } from 'vitest'

import { checkDomainTarget, planDomain } from './assistant'

describe('domain assistant', () => {
  it('lập record direct-port trung thực về port', () => {
    const plan = planDomain({
      hostname: 'App.Example.com.',
      target: '203.0.113.10',
      appPort: 30000,
      mode: 'direct_port'
    })
    expect(plan.record_type).toBe('A')
    expect(plan.hostname).toBe('app.example.com')
    expect(plan.public_url).toBe('http://app.example.com:30000')
    expect(plan.instructions).toContain('Mở TCP 30000 trên firewall.')
  })

  it('không giả vờ HTTPS nếu chưa có ingress', () => {
    const plan = planDomain({
      hostname: 'app.example.com',
      target: 'gateway.example.net',
      appPort: 30001,
      mode: 'shared_ingress'
    })
    expect(plan.record_type).toBe('CNAME')
    expect(plan.public_url).toBe('https://app.example.com')
    expect(plan.instructions.join(' ')).toContain('80/443')
  })

  it('lập record cho named_tunnel với CNAME target và HTTPS', () => {
    const plan = planDomain({
      hostname: 'tunnel.example.com',
      target: 'abc123uuid.cfargotunnel.com',
      appPort: 30003,
      mode: 'named_tunnel'
    })
    expect(plan.record_type).toBe('CNAME')
    expect(plan.mode).toBe('named_tunnel')
    expect(plan.target).toBe('abc123uuid.cfargotunnel.com')
    expect(plan.public_url).toBe('https://tunnel.example.com')
    expect(plan.instructions.join(' ')).toContain('tunnel')
  })

  it('chặn named_tunnel khi target là IP VPS thay vì CNAME target của tunnel', () => {
    expect(() =>
      planDomain({
        hostname: 'tunnel.example.com',
        target: '198.51.100.20',
        appPort: 30003,
        mode: 'named_tunnel'
      })
    ).toThrow('Mode named_tunnel yêu cầu CNAME target của tunnel')
  })

  it('hỗ trợ IPv6 và format URL có ngoặc vuông', () => {
    const plan = planDomain({
      hostname: 'v6.example.com',
      target: '2001:db8::10',
      appPort: 30002,
      mode: 'direct_port'
    })
    expect(plan.record_type).toBe('AAAA')
    expect(plan.direct_url).toBe('http://[2001:db8::10]:30002')
  })

  it('validate ném lỗi khi hostname, port hoặc target không hợp lệ', () => {
    expect(() =>
      planDomain({
        hostname: 'invalid_domain_name',
        target: '1.2.3.4',
        appPort: 30000,
        mode: 'direct_port'
      })
    ).toThrow('Hostname không hợp lệ')

    expect(() =>
      planDomain({
        hostname: 'valid.example.com',
        target: '1.2.3.4',
        appPort: 70000,
        mode: 'direct_port'
      })
    ).toThrow('Port ứng dụng không hợp lệ')

    expect(() =>
      planDomain({
        hostname: 'valid.example.com',
        target: 'not a valid ip or host!',
        appPort: 30000,
        mode: 'direct_port'
      })
    ).toThrow('Target phải là IPv4')
  })
})

describe('checkDomainTarget', () => {
  it('trả về propagated khi DNS trỏ đúng target', async () => {
    const mockResolver = async (): Promise<string[]> => ['203.0.113.10']
    const result = await checkDomainTarget('app.example.com', '203.0.113.10', 'A', mockResolver)
    expect(result.status).toBe('propagated')
    expect(result.observed).toEqual(['203.0.113.10'])
  })

  it('trả về wrong_target khi DNS trỏ sai target', async () => {
    const mockResolver = async (): Promise<string[]> => ['198.51.100.99']
    const result = await checkDomainTarget('app.example.com', '203.0.113.10', 'A', mockResolver)
    expect(result.status).toBe('wrong_target')
    expect(result.observed).toEqual(['198.51.100.99'])
  })

  it('propagation với target lẫn đúng/sai không được báo đạt (phải trả về wrong_target)', async () => {
    const mockResolver = async (): Promise<string[]> => ['203.0.113.10', '198.51.100.99']
    const result = await checkDomainTarget('app.example.com', '203.0.113.10', 'A', mockResolver)
    expect(result.status).toBe('wrong_target')
    expect(result.observed).toEqual(['203.0.113.10', '198.51.100.99'])
  })

  it('trả về nxdomain khi resolver không trả record', async () => {
    const mockResolver = async (): Promise<string[]> => []
    const result = await checkDomainTarget('app.example.com', '203.0.113.10', 'A', mockResolver)
    expect(result.status).toBe('nxdomain')
    expect(result.observed).toEqual([])
  })

  it('trả về nxdomain khi resolver ném lỗi ENOTFOUND', async () => {
    const mockResolver = async (): Promise<string[]> => {
      const err = new Error('getaddrinfo ENOTFOUND app.example.com') as NodeJS.ErrnoException
      err.code = 'ENOTFOUND'
      throw err
    }
    const result = await checkDomainTarget('app.example.com', '203.0.113.10', 'A', mockResolver)
    expect(result.status).toBe('nxdomain')
  })

  it('trả về error khi resolver ném lỗi mạng bất thường', async () => {
    const mockResolver = async (): Promise<string[]> => {
      const err = new Error('SERVFAIL') as NodeJS.ErrnoException
      err.code = 'ESERVFAIL'
      throw err
    }
    const result = await checkDomainTarget('app.example.com', '203.0.113.10', 'A', mockResolver)
    expect(result.status).toBe('error')
  })
})
