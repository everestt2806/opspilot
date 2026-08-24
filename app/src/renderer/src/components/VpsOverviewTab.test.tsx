// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Vps, VpsScanResult } from '@shared/ipc'

import { VpsOverviewTab } from './VpsOverviewTab'

const VPS: Vps = {
  id: 1,
  name: 'VM01',
  host: '221.121.1.79',
  port: 22,
  username: 'root',
  auth_type: 'password',
  provider: 'WiService',
  region: 'Hanoi',
  docker_version: null,
  last_status: 'unknown',
  last_seen_at: null,
  created_at: '2026-08-19T00:00:00Z'
}

const SCAN_RESULT: VpsScanResult = {
  scanned_at: '2026-08-23T10:00:00Z',
  ssh_ok: true,
  items: [
    { key: 'ssh', ok: true, version: null },
    { key: 'docker', ok: true, version: '27.1.1' },
    { key: 'compose', ok: true, version: 'v2.29.1' },
    { key: 'node', ok: true, version: 'v20.11.1' },
    { key: 'git', ok: false, version: null, detail: 'git: command not found' },
    { key: 'workdir', ok: true, version: null }
  ]
}

type InvokeHandler = (...args: unknown[]) => Promise<unknown>

function mockApi(handlers: Record<string, InvokeHandler>): void {
  vi.stubGlobal('api', {
    invoke: (channel: string, ...args: unknown[]) => {
      const handler = handlers[channel]
      if (!handler) return Promise.reject(new Error(`No handler registered for '${channel}'`))
      return handler(channel, ...args)
    },
    on: () => () => {}
  })
}

function renderTab(): { onDockerInstalled: ReturnType<typeof vi.fn> } {
  const onDockerInstalled = vi.fn()
  render(
    <VpsOverviewTab
      vps={VPS}
      onRefreshResources={() => undefined}
      onCheckConnection={() => undefined}
      onEdit={() => undefined}
      onDelete={() => undefined}
      onDockerInstalled={onDockerInstalled}
    />
  )
  return { onDockerInstalled }
}

async function scanListEl(): Promise<HTMLElement> {
  return (await waitFor(() => {
    const el = document.querySelector('.scan-list')
    if (!el) {
      throw new Error('scan-list chưa render')
    }
    return el as HTMLElement
  })) as HTMLElement
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VpsOverviewTab — card Environment scan', () => {
  it('quét tự động khi mở: 6 hạng mục + version + báo thiếu; Scan again quét lại', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true, data: SCAN_RESULT })
    mockApi({ 'vps:scan': scan })

    const { onDockerInstalled } = renderTab()

    const list = await scanListEl()
    expect(scan).toHaveBeenCalledWith('vps:scan', 1)

    // Nhãn + version nằm trong card scan (Machine info cũng có nhãn 'Docker')
    expect(within(list).getByText('SSH connection')).toBeTruthy()
    expect(within(list).getByText('Docker')).toBeTruthy()
    expect(within(list).getByText('27.1.1')).toBeTruthy()
    expect(within(list).getByText('Docker Compose')).toBeTruthy()
    expect(within(list).getByText('v2.29.1')).toBeTruthy()
    expect(within(list).getByText('Node.js')).toBeTruthy()
    expect(within(list).getByText('v20.11.1')).toBeTruthy()
    expect(within(list).getByText('Git')).toBeTruthy()
    expect(within(list).getByText('Not installed')).toBeTruthy()
    expect(within(list).getByText('Workspace /opt/opspilot')).toBeTruthy()

    // Quét xong báo cho cha refresh Machine info (last seen + Docker version)
    await waitFor(() => expect(onDockerInstalled).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('Scan again'))
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onDockerInstalled).toHaveBeenCalledTimes(2))
  })

  it('quét lỗi: Alert kèm thông báo từ main, Retry gọi lại và hiện kết quả mới', async () => {
    const scan = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'SSH_TIMEOUT',
          message: 'Không kết nối được SSH. Kiểm tra firewall rồi thử lại.'
        }
      })
      .mockResolvedValueOnce({ ok: true, data: SCAN_RESULT })
    mockApi({ 'vps:scan': scan })

    renderTab()

    expect(await screen.findByText('Could not scan the server.')).toBeTruthy()
    expect(
      await screen.findByText('Không kết nối được SSH. Kiểm tra firewall rồi thử lại.')
    ).toBeTruthy()

    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2))
    expect((await scanListEl()).querySelector('.scan-item')).toBeTruthy()
  })

  it('kênh vps:scan chưa đăng ký: lỗi trung thực, không treo, Retry vẫn gọi lại', async () => {
    mockApi({})

    renderTab()

    expect(await screen.findByText('Could not scan the server.')).toBeTruthy()
    fireEvent.click(screen.getByText('Retry'))
    const list = document.querySelector('.scan-list')
    expect(list).toBeNull()
  })
})
