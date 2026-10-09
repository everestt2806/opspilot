// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Vps, VpsOperationalDiagnostics, VpsScanResult } from '@shared/ipc'

import { VpsOverviewTab } from './VpsOverviewTab'
import { strings } from '../strings'
import { useUiState } from '../store/uiState'

const VPS: Vps = {
  id: 1,
  name: 'VM01',
  host: '221.121.1.79',
  port: 22,
  host_fingerprint: null,
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

const DIAGNOSTICS: VpsOperationalDiagnostics = {
  sampled_at: '2026-10-10T10:00:00Z',
  top_processes_available: true,
  top_processes: [{ pid: 42, name: 'worker', rss_mb: 12.5 }],
  memory_pressure: { some_avg10: 0, full_avg10: 0 },
  oom_kill_count: 0
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

function renderTab(
  resources?: import('../vpsResources').RowResourceState,
  onRefreshResources = vi.fn(),
  vps = VPS
): {
  onDockerInstalled: ReturnType<typeof vi.fn>
  onRefreshResources: ReturnType<typeof vi.fn>
  rerender: (nextVps: Vps) => void
} {
  const onDockerInstalled = vi.fn()
  const element = (selectedVps: Vps): React.JSX.Element => (
    <VpsOverviewTab
      vps={selectedVps}
      resources={resources}
      onRefreshResources={onRefreshResources}
      onCheckConnection={() => undefined}
      onEdit={() => undefined}
      onDelete={() => undefined}
      onDockerInstalled={onDockerInstalled}
    />
  )
  const view = render(element(vps))
  return {
    onDockerInstalled,
    onRefreshResources,
    rerender: (nextVps) => view.rerender(element(nextVps))
  }
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

beforeEach(() => {
  useUiState.setState({ locale: 'en' })
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

  it('vps:scan thành công chỉ gọi vps:scan, không tự gọi vps:get-resources cho fleet', async () => {
    const invokeSpy = vi.fn().mockImplementation((channel: string) => {
      if (channel === 'vps:scan') {
        return Promise.resolve({ ok: true, data: SCAN_RESULT })
      }
      return Promise.reject(new Error(`Unexpected channel: ${channel}`))
    })
    // Preload thật chỉ có invoke và on
    vi.stubGlobal('api', {
      invoke: invokeSpy,
      on: () => () => {}
    })

    renderTab()

    await scanListEl()
    expect(invokeSpy).toHaveBeenCalledWith('vps:scan', 1)
    const scanCalls = invokeSpy.mock.calls.filter(([ch]) => ch === 'vps:scan')
    const resourceCalls = invokeSpy.mock.calls.filter(([ch]) => ch === 'vps:get-resources')
    const diagnosticsCalls = invokeSpy.mock.calls.filter(
      ([ch]) => ch === 'vps:get-operational-diagnostics'
    )
    expect(scanCalls.length).toBeGreaterThanOrEqual(1)
    expect(resourceCalls.length).toBe(0)
    expect(diagnosticsCalls.length).toBe(0)
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

    fireEvent.click(screen.getByText(strings.common.retry))
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2))
    expect((await scanListEl()).querySelector('.scan-item')).toBeTruthy()
  })

  it('kênh vps:scan chưa đăng ký: lỗi trung thực, không treo, Retry vẫn gọi lại', async () => {
    mockApi({})

    renderTab()

    expect(await screen.findByText('Could not scan the server.')).toBeTruthy()
    fireEvent.click(screen.getByText(strings.common.retry))
    const list = document.querySelector('.scan-list')
    expect(list).toBeNull()
  })

  it('card Tài nguyên: hiển thị thông số CPU/RAM/Disk, gauges và nút refresh độc lập với scan', async () => {
    mockApi({ 'vps:scan': async () => ({ ok: true, data: SCAN_RESULT }) })
    const refreshResources = vi.fn()

    renderTab(
      {
        status: 'success',
        data: {
          ram_total_mb: 4096,
          ram_free_mb: 1024,
          disk_total_gb: 40,
          disk_free_gb: 28,
          cpu_count: 2,
          load_avg_1m: 0.5
        },
        fetchedAt: Date.now()
      },
      refreshResources
    )

    // Hiển thị card Tài nguyên hệ thống
    expect(screen.getByText(strings.vpsControl.overview.resourcesTitle)).toBeTruthy()
    // Hiển thị cores và load average
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('0.50')).toBeTruthy()
    // Bấm nút Refresh trong card tài nguyên chỉ gọi refreshResources, không quét scan
    const refreshBtn = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-label') === strings.common.refresh)!
    fireEvent.click(refreshBtn)
    expect(refreshResources).toHaveBeenCalledTimes(1)
  })

  it('không gọi diagnostics tự động khi mở Overview và giữ scan độc lập', async () => {
    const diagnostics = vi.fn()
    const scan = vi.fn().mockResolvedValue({ ok: true, data: SCAN_RESULT })
    mockApi({ 'vps:scan': scan, 'vps:get-operational-diagnostics': diagnostics })

    renderTab()
    await scanListEl()

    expect(scan).toHaveBeenCalledWith('vps:scan', VPS.id)
    expect(diagnostics).not.toHaveBeenCalled()
  })

  it('fetch diagnostics on explicit click and renders numeric zero as a measured value', async () => {
    const diagnostics = vi.fn().mockResolvedValue({ ok: true, data: DIAGNOSTICS })
    mockApi({
      'vps:scan': async () => ({ ok: true, data: SCAN_RESULT }),
      'vps:get-operational-diagnostics': diagnostics
    })

    renderTab()
    await scanListEl()
    fireEvent.click(
      screen.getByText(strings.vpsControl.overview.diagnosticsCheck).closest('button')!
    )

    expect(await screen.findByText('worker')).toBeTruthy()
    expect(diagnostics).toHaveBeenCalledWith('vps:get-operational-diagnostics', VPS.id)
    expect(screen.getByText(strings.vpsControl.overview.diagnosticsSampledAt)).toBeTruthy()
    expect(screen.getAllByText('0.00%')).toHaveLength(2)
    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.getByText(/one sample cannot show whether a new OOM occurred/i)).toBeTruthy()
  })

  it('distinguishes unavailable partial fields from numeric zero and a valid empty process list', async () => {
    const diagnostics = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...DIAGNOSTICS,
        top_processes_available: true,
        top_processes: [],
        memory_pressure: null,
        oom_kill_count: null
      }
    })
    mockApi({
      'vps:scan': async () => ({ ok: true, data: SCAN_RESULT }),
      'vps:get-operational-diagnostics': diagnostics
    })

    renderTab()
    await scanListEl()
    fireEvent.click(
      screen.getByText(strings.vpsControl.overview.diagnosticsCheck).closest('button')!
    )

    expect(await screen.findByText(strings.vpsControl.overview.diagnosticsNoProcesses)).toBeTruthy()
    expect(screen.getAllByText(strings.vpsControl.overview.diagnosticsUnavailable)).toHaveLength(3)
  })

  it('shows a safe SSH failure and allows retry without retaining the previous sample', async () => {
    const diagnostics = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'SSH_TIMEOUT',
          message: 'SSH timed out. Please retry.',
          technical: 'fake-secret-value'
        }
      })
      .mockResolvedValueOnce({ ok: true, data: DIAGNOSTICS })
    mockApi({
      'vps:scan': async () => ({ ok: true, data: SCAN_RESULT }),
      'vps:get-operational-diagnostics': diagnostics
    })

    renderTab()
    await scanListEl()
    fireEvent.click(
      screen.getByText(strings.vpsControl.overview.diagnosticsCheck).closest('button')!
    )
    expect(await screen.findByText(strings.vpsControl.overview.diagnosticsFailed)).toBeTruthy()
    expect(screen.getByText('SSH timed out. Please retry.')).toBeTruthy()
    expect(screen.queryByText('fake-secret-value')).toBeNull()
    expect(screen.queryByText('worker')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: strings.common.retry }))
    expect(await screen.findByText('worker')).toBeTruthy()
    expect(diagnostics).toHaveBeenCalledTimes(2)
  })

  it('ignores out-of-order refresh responses so the newer sample remains visible', async () => {
    let resolveFirst!: (result: { ok: true; data: VpsOperationalDiagnostics }) => void
    let resolveSecond!: (result: { ok: true; data: VpsOperationalDiagnostics }) => void
    const diagnostics = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)))
    mockApi({
      'vps:scan': async () => ({ ok: true, data: SCAN_RESULT }),
      'vps:get-operational-diagnostics': diagnostics
    })

    renderTab()
    await scanListEl()
    const checkButton = screen
      .getByText(strings.vpsControl.overview.diagnosticsCheck)
      .closest('button')!
    fireEvent.click(checkButton)
    fireEvent.click(checkButton)
    expect(diagnostics).toHaveBeenCalledTimes(2)

    resolveSecond({
      ok: true,
      data: { ...DIAGNOSTICS, top_processes: [{ pid: 2, name: 'newer-process', rss_mb: 8 }] }
    })
    expect(await screen.findByText('newer-process')).toBeTruthy()
    resolveFirst({
      ok: true,
      data: { ...DIAGNOSTICS, top_processes: [{ pid: 1, name: 'older-process', rss_mb: 4 }] }
    })
    await waitFor(() => expect(screen.getByText('newer-process')).toBeTruthy())
    expect(screen.queryByText('older-process')).toBeNull()
  })

  it('hides and ignores an outstanding response when the selected VPS changes', async () => {
    let resolveDiagnostics!: (result: { ok: true; data: VpsOperationalDiagnostics }) => void
    const diagnostics = vi.fn(
      () =>
        new Promise<{ ok: true; data: VpsOperationalDiagnostics }>((resolve) => {
          resolveDiagnostics = resolve
        })
    )
    const scan = vi.fn().mockResolvedValue({ ok: true, data: SCAN_RESULT })
    mockApi({ 'vps:scan': scan, 'vps:get-operational-diagnostics': diagnostics })

    const view = renderTab()
    await scanListEl()
    fireEvent.click(
      screen.getByText(strings.vpsControl.overview.diagnosticsCheck).closest('button')!
    )
    const otherVps = { ...VPS, id: 2, name: 'VM02' }
    view.rerender(otherVps)
    expect(screen.queryByText(strings.vpsControl.overview.diagnosticsLoading)).toBeNull()
    expect(screen.getByText(strings.vpsControl.overview.diagnosticsHint)).toBeTruthy()

    resolveDiagnostics({
      ok: true,
      data: { ...DIAGNOSTICS, top_processes: [{ pid: 1, name: 'old-vps-process', rss_mb: 1 }] }
    })
    await waitFor(() => expect(screen.queryByText('old-vps-process')).toBeNull())
    expect(diagnostics).toHaveBeenCalledWith('vps:get-operational-diagnostics', VPS.id)
    expect(scan).toHaveBeenCalledWith('vps:scan', otherVps.id)
  })

  it('card Tài nguyên báo lỗi: hiển thị Alert lỗi và nút Thử lại', async () => {
    mockApi({ 'vps:scan': async () => ({ ok: true, data: SCAN_RESULT }) })
    const refreshResources = vi.fn()

    renderTab(
      {
        status: 'error',
        message: 'SSH connection timeout reading /proc/meminfo'
      },
      refreshResources
    )

    expect(screen.getByText(strings.vpsControl.sidebar.resourceError)).toBeTruthy()
    expect(screen.getByText('SSH connection timeout reading /proc/meminfo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(strings.common.retry, 'i') }))
    expect(refreshResources).toHaveBeenCalledTimes(1)
  })
})
