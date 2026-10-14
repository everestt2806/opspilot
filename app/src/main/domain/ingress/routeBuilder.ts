export interface SharedIngressRoute {
  hostname: string
  host_port: number
}

/** Builds only OpsPilot-owned Caddyfile routes; it never reads another proxy's config. */
export function buildSharedIngressConfig(routes: readonly SharedIngressRoute[]): string {
  if (!Array.isArray(routes)) throw new Error('Danh sách route không hợp lệ.')
  const normalized = routes.map((route) => {
    if (!route || typeof route !== 'object') throw new Error('Route không hợp lệ.')
    const hostname = normalizeRouteHostname(route.hostname)
    if (!Number.isInteger(route.host_port) || route.host_port < 1 || route.host_port > 65_535) {
      throw new Error('Port ứng dụng phải là số nguyên từ 1 đến 65535.')
    }
    return { hostname, host_port: route.host_port }
  })
  const hostnames = new Set<string>()
  for (const route of normalized) {
    if (hostnames.has(route.hostname)) throw new Error(`Hostname bị trùng: ${route.hostname}`)
    hostnames.add(route.hostname)
  }
  normalized.sort((left, right) =>
    left.hostname < right.hostname ? -1 : left.hostname > right.hostname ? 1 : 0
  )
  if (normalized.length === 0) return ''
  return normalized
    .map(({ hostname, host_port }) => `${hostname} {\n  reverse_proxy 127.0.0.1:${host_port}\n}`)
    .join('\n\n') + '\n'
}

function normalizeRouteHostname(input: string): string {
  if (typeof input !== 'string') throw new Error('Hostname phải là chuỗi.')
  const hostname = input.trim().replace(/\.$/, '').toLowerCase()
  if (hostname.length < 1 || hostname.length > 253 || hostname.includes('*')) {
    throw new Error('Hostname không hợp lệ.')
  }
  const labels = hostname.split('.')
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) {
    throw new Error('Hostname không hợp lệ.')
  }
  return hostname
}
