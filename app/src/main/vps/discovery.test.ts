import { describe, expect, it, vi } from 'vitest'

import { parseAppManifest } from '../deploy/appManifest'
import { discoverVpsApps, parseDiscoveredApps } from './discovery'

function row(name: string, patch: Record<string, string> = {}): string {
  return JSON.stringify({
    Names: `${name}-app`,
    Image: `${name}:v3`,
    State: 'running',
    Ports: '0.0.0.0:32001->3000/tcp, [::]:32001->3000/tcp',
    Service: 'app',
    Directory: `/opt/opspilot/${name}`,
    Config: `/opt/opspilot/${name}/docker-compose.yml`,
    ...patch
  })
}
const manifest = JSON.stringify({
  schema_version: 1,
  app: { name: 'blog' },
  framework: 'express',
  source: {
    type: 'git',
    locator_available: true,
    remote: 'https://github.com/example/blog.git',
    ref: 'main',
    root: '.'
  },
  ports: { host: 32001, container: 3000 },
  healthcheck: '/health',
  needs_db: false
})

describe('strict VPS app manifest parsing', () => {
  it('allows only schema v1 fields and credential-free Git locator', () => {
    expect(parseAppManifest(manifest)).toMatchObject({
      app: { name: 'blog' },
      source: { remote: 'https://github.com/example/blog.git' }
    })
    expect(
      parseAppManifest(manifest.replace('https://github.com', 'https://user:secret@github.com'))
    ).toBeNull()
  })
  it('rejects unknown fields, malformed JSON and oversized bytes', () => {
    expect(
      parseAppManifest(manifest.replace('"needs_db":false', '"needs_db":false,"secret":"CANARY"'))
    ).toBeNull()
    expect(parseAppManifest('{')).toBeNull()
    expect(parseAppManifest(' '.repeat(16_385))).toBeNull()
  })
})

describe('VPS Docker discovery and recovery verification', () => {
  it('classifies a matching manifest and exposes only allowlisted metadata', async () => {
    const exec = vi.fn(async (_id: number, command: string) => ({
      code: 0,
      stdout: command.includes('docker ps') ? row('blog') : manifest,
      stderr: 'SECRET_CANARY'
    }))
    const [app] = await discoverVpsApps({ exec } as never, 7)
    expect(app).toMatchObject({
      recovery_status: 'verified',
      framework: 'express',
      source_type: 'git',
      git_ref: 'main',
      host_port: 32001,
      container_port: 3000
    })
    expect(JSON.stringify(app)).not.toContain('SECRET_CANARY')
    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec.mock.calls[1]?.[1]).toContain('/opt/opspilot/blog/.opspilot-app.json')
    expect(exec.mock.calls[1]?.[1]).toContain('head -c 16385')
  })
  it('marks missing, malformed, oversized and mismatched metadata explicitly', async () => {
    for (const [code, stdout, status] of [
      [5, '', 'legacy'],
      [0, '{', 'invalid'],
      [0, 'x'.repeat(16_385), 'invalid'],
      [0, manifest.replace('32001', '32002'), 'mismatch'],
      [0, manifest.replace('"name":"blog"', '"name":"other"'), 'mismatch']
    ] as const) {
      const exec = vi.fn(async (_id: number, command: string) =>
        command.includes('docker ps')
          ? { code: 0, stdout: row('blog'), stderr: '' }
          : { code, stdout, stderr: 'RAW_REMOTE_ERROR' }
      )
      const [app] = await discoverVpsApps({ exec } as never, 7)
      expect(app?.recovery_status).toBe(status)
      expect(app).toMatchObject({
        framework: null,
        source_type: null,
        git_remote: null,
        git_ref: null,
        git_root: null,
        healthcheck: null,
        needs_db: null
      })
      expect(JSON.stringify(app)).not.toContain('RAW_REMOTE_ERROR')
    }
  })
  it('distinguishes an unreadable manifest and hides its metadata', async () => {
    const exec = vi.fn(async (_id: number, command: string) =>
      command.includes('docker ps')
        ? { code: 0, stdout: row('blog'), stderr: '' }
        : { code: 6, stdout: '', stderr: 'permission denied' }
    )
    const [app] = await discoverVpsApps({ exec } as never, 7)
    expect(app).toMatchObject({
      recovery_status: 'unverifiable',
      recovery_reason: 'manifest_unreadable',
      framework: null,
      source_type: null,
      git_remote: null,
      git_ref: null,
      git_root: null,
      healthcheck: null,
      needs_db: null
    })
    const throws = vi.fn(async (_id: number, command: string) => {
      if (command.includes('docker ps')) return { code: 0, stdout: row('blog'), stderr: '' }
      throw new Error('permission denied')
    })
    expect((await discoverVpsApps({ exec: throws } as never, 7))[0]).toMatchObject({
      recovery_status: 'unverifiable',
      recovery_reason: 'manifest_unreadable'
    })
  })
  it('limits concurrent SSH manifest reads to four', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(`app-${index}`)).join('\n')
    let active = 0
    let maximum = 0
    const exec = vi.fn(async (_id: number, command: string) => {
      if (command.includes('docker ps')) return { code: 0, stdout: rows, stderr: '' }
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { code: 5, stdout: '', stderr: '' }
    })
    expect(await discoverVpsApps({ exec } as never, 7)).toHaveLength(10)
    expect(maximum).toBeLessThanOrEqual(4)
    expect(maximum).toBe(4)
  })
  it('rejects stopped, ambiguous and unverifiable runtime and keeps legacy parser read-only', async () => {
    const stopped = vi.fn(async (_id: number, command: string) => ({
      code: 0,
      stdout: command.includes('docker ps') ? row('blog', { State: 'exited' }) : manifest,
      stderr: ''
    }))
    expect((await discoverVpsApps({ exec: stopped } as never, 7))[0]?.recovery_status).toBe(
      'stopped'
    )
    const duplicate = vi.fn(async (_id: number, command: string) => ({
      code: 0,
      stdout: command.includes('docker ps') ? `${row('blog')}\n${row('blog')}` : manifest,
      stderr: ''
    }))
    expect((await discoverVpsApps({ exec: duplicate } as never, 7))[0]?.recovery_status).toBe(
      'ambiguous'
    )
    const badPort = vi.fn(async (_id: number, command: string) => ({
      code: 0,
      stdout: command.includes('docker ps') ? row('blog', { Ports: '' }) : manifest,
      stderr: ''
    }))
    expect((await discoverVpsApps({ exec: badPort } as never, 7))[0]?.recovery_status).toBe(
      'unverifiable'
    )
    expect(parseDiscoveredApps(row('blog'))[0]?.recovery_status).toBe('legacy')
  })
  it('classifies transient SSH failure and never uses inspect or arbitrary renderer paths', async () => {
    const exec = vi.fn(async (_id: number, command: string) => {
      if (command.includes('docker ps')) return { code: 0, stdout: row('blog'), stderr: '' }
      throw new Error('SECRET_CANARY')
    })
    await expect(discoverVpsApps({ exec } as never, 7)).resolves.toMatchObject([
      {
        recovery_status: 'unverifiable',
        recovery_reason: 'manifest_unreadable',
        framework: null,
        git_remote: null
      }
    ])
    expect(exec.mock.calls[0]?.[1]).not.toContain('inspect')
    expect(exec.mock.calls[0]?.[1]).not.toContain('.env')
  })
})
