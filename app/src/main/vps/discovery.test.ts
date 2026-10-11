import { describe, expect, it, vi } from 'vitest'

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

describe('VPS Docker discovery', () => {
  it('chỉ nhận app có tên, image và Compose path khớp; đọc port và trạng thái', () => {
    expect(parseDiscoveredApps(row('blog'))).toEqual([
      { name: 'blog', image_tag: 'blog:v3', version: 3, host_port: 32001, state: 'running' }
    ])
    expect(parseDiscoveredApps(row('1blog'))[0]?.name).toBe('1blog')
  })

  it('bỏ container lạ, path giả, image giả và tên nguy hiểm', () => {
    const rows = [
      row('outside', { Directory: '/opt/other/outside' }),
      row('blog', { Image: 'other:v3' }),
      row('bad;name'),
      row('demo', { Config: '/opt/opspilot/other/docker-compose.yml' }),
      row('valid')
    ].join('\n')
    expect(parseDiscoveredApps(rows).map((app) => app.name)).toEqual(['valid'])
  })

  it('không chọn mù khi có nhiều container khớp cùng một app', () => {
    expect(parseDiscoveredApps(`${row('blog')}\n${row('blog')}`)).toEqual([])
  })

  it('giới hạn dữ liệu và từ chối JSON hỏng', () => {
    expect(() => parseDiscoveredApps('{')).toThrow()
    expect(() => parseDiscoveredApps('x'.repeat(65_537))).toThrow()
    expect(() => parseDiscoveredApps(Array(101).fill(row('blog')).join('\n'))).toThrow()
  })

  it('trả [] khi Docker không có container OpsPilot', () => {
    expect(parseDiscoveredApps('\n')).toEqual([])
  })

  it('chỉ chạy lệnh đọc qua SSH với timeout và không trả stderr ra UI', async () => {
    const exec = vi.fn(async (_id: number, _cmd: string, _opts?: unknown) => ({
      ignored: [_id, _cmd, _opts].length,
      code: 0,
      stdout: row('blog'),
      stderr: 'secret marker'
    }))
    expect(await discoverVpsApps({ exec } as never, 7)).toHaveLength(1)
    expect(exec).toHaveBeenCalledOnce()
    const command = exec.mock.calls[0]?.[1] as string
    expect(command).toContain('docker ps -a')
    expect(command).not.toContain('inspect')
    expect(command).not.toContain('.env')
    expect(command).not.toContain('{{json .Labels}}')
    expect(exec.mock.calls[0]?.[2]).toMatchObject({ logCommand: false, retryOnReconnect: false })
  })

  it('Docker lỗi chỉ báo lỗi chung, không lộ stderr', async () => {
    const exec = vi.fn(async (_id: number, _cmd: string, _opts?: unknown) => ({
      ignored: [_id, _cmd, _opts].length,
      code: 4,
      stdout: '',
      stderr: 'CANARY_MARKER'
    }))
    await expect(discoverVpsApps({ exec } as never, 7)).rejects.toMatchObject({
      userMessage: 'Không thể đọc danh sách container Docker trên VPS.'
    })
  })
})
