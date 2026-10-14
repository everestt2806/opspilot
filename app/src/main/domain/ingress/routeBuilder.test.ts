import { describe, expect, it } from 'vitest'

import { buildSharedIngressConfig } from './routeBuilder'

describe('buildSharedIngressConfig', () => {
  it('normalizes and sorts routes deterministically while preserving every route', () => {
    expect(
      buildSharedIngressConfig([
        { hostname: 'B.example.com.', host_port: 30002 },
        { hostname: 'a.example.com', host_port: 30001 }
      ])
    ).toBe(
      'a.example.com {\n  reverse_proxy 127.0.0.1:30001\n}\n\n' +
        'b.example.com {\n  reverse_proxy 127.0.0.1:30002\n}\n'
    )
  })

  it('returns an empty config for an empty owned route set', () => {
    expect(buildSharedIngressConfig([])).toBe('')
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
