import { describe, expect, it } from 'vitest'

import { buildSharedIngressConfig } from './routeBuilder'

const globalOptions = [
  '{',
  '    admin 127.0.0.1:2019',
  '    persist_config off',
  '    storage file_system /var/lib/opspilot/caddy/production',
  '}'
].join('\n')

describe('buildSharedIngressConfig', () => {
  it('normalizes and sorts routes deterministically while preserving every route', () => {
    expect(
      buildSharedIngressConfig([
        { hostname: 'B.example.com.', host_port: 30002 },
        { hostname: 'a.example.com', host_port: 30001 }
      ])
    ).toBe(
      `${globalOptions}\n\n` +
        'a.example.com {\n  reverse_proxy 127.0.0.1:30001\n}\n\n' +
        'b.example.com {\n  reverse_proxy 127.0.0.1:30002\n}\n'
    )
  })

  it('returns the fixed global options with no routes for an empty owned route set', () => {
    expect(buildSharedIngressConfig([])).toBe(`${globalOptions}\n`)
  })

  it('isolates ACME staging storage and directory from production while retaining the route', () => {
    const route = [{ hostname: 'lab.example.com', host_port: 30009 }]
    const staging = buildSharedIngressConfig(route, 'acme_staging')

    expect(staging).toContain('storage file_system /var/lib/opspilot/caddy/staging')
    expect(staging).toContain('acme_ca https://acme-staging-v02.api.letsencrypt.org/directory')
    expect(staging).toContain('lab.example.com {\n  reverse_proxy 127.0.0.1:30009\n}')
    expect(staging).not.toContain('/production')
  })

  it('rejects duplicate hostnames after normalization', () => {
    expect(() =>
      buildSharedIngressConfig([
        { hostname: 'app.example.com', host_port: 30000 },
        { hostname: 'APP.EXAMPLE.COM.', host_port: 30001 }
      ])
    ).toThrow(/Hostname bị trùng/)
  })

  it.each([
    'app.example.com { reverse_proxy evil.example }',
    'app.example.com; import /tmp/evil',
    '*.example.com',
    'app..example.com',
    'localhost'
  ])('rejects config injection or invalid hostname %s', (hostname) => {
    expect(() => buildSharedIngressConfig([{ hostname, host_port: 30000 }])).toThrow(/Hostname/)
  })

  it.each([0, -1, 65_536, 30_000.5, Number.NaN])('rejects invalid upstream port %s', (host_port) => {
    expect(() => buildSharedIngressConfig([{ hostname: 'app.example.com', host_port }])).toThrow(
      /Port ứng dụng/
    )
  })

  it('rejects shell or Caddy syntax in a port value', () => {
    expect(() =>
      buildSharedIngressConfig([
        { hostname: 'app.example.com', host_port: '30000; import /tmp/evil' as unknown as number }
      ])
    ).toThrow(/Port ứng dụng/)
  })
})
