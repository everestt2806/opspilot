// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionLogEntry, App, Vps } from '@shared/ipc'

import { DashboardPage } from './DashboardPage'
import { strings } from '../strings'
import { useUiState } from '../store/uiState'
import { useVpsStore } from '../store/vpsStore'

const VPS_A: Vps = {
  id: 1,
  name: 'VM01',
  host: '203.0.113.55',
  port: 22,
  username: 'root',
  auth_type: 'password',
  provider: 'WiService',
  region: 'Hanoi',
  docker_version: '29.4.3',
  last_status: 'online',
  last_seen_at: '2026-08-20T09:00:00Z',
  created_at: '2026-08-19T00:00:00Z'
}

const VPS_B: Vps = { ...VPS_A, id: 2, name: 'VM02', last_status: 'unknown' }

const APP_A: App = {
  id: 1,
  vps_id: 1,
  name: 'blog-demo',
  framework: 'nextjs',
  host_port: 30000,
  container_port: 3000,
  healthcheck_path: '/health',
  needs_db: 1,
  current_deployment_id: 7,
  url: 'http://203.0.113.55:30000'
}

const APP_B: App = { ...APP_A, id: 2, name: 'api-demo', current_deployment_id: null }

function logEntry(partial: Partial<ActionLogEntry> & { id: number }): ActionLogEntry {
  return {
    ts: '2026-08-20T09:55:00Z',
    action: 'deploy',
    status: 'success',
    message: 'Deployed v7 successfully.',
    vps_id: 1,
    app_id: 1,
    deployment_id: 7,
    detail_json: null,
    ...partial
  }
}

const RECENT: ActionLogEntry[] = [
  logEntry({ id: 1, ts: '2026-08-20T09:55:00Z' }),
  logEntry({
    id: 2,
    ts: '2026-08-20T09:53:00Z',
    action: 'rollback_auto',
    status: 'failed',
    message: 'Rollback failed.'
  }),
  logEntry({ id: 3, ts: '2026-08-19T23:10:00Z', action: 'rollback_manual', status: 'cancelled' })
]

type InvokeHandler = (...args: unknown[]) => Promise<unknown>

function mockApi(handlers: Record<string, InvokeHandler>): ReturnType<typeof vi.fn> {
  const invoke = vi.fn((channel: string, ...args: unknown[]) => {
    const handler = handlers[channel]
    if (!handler) return Promise.reject(new Error(`No handler registered for '${channel}'`))
    return handler(...args)
  })
  vi.stubGlobal('api', { invoke, on: () => () => {} })
  return invoke
}

const happyHandlers: Record<string, InvokeHandler> = {
  'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
  'app:list': async () => ({ ok: true, data: [APP_A, APP_B] }),
  'history:list': async (filter) => {
    const actions = (filter as { actions?: string[] }).actions
    if (actions && actions.length === 1 && actions[0] === 'deploy') {
      return { ok: true, data: [RECENT[0], { ...RECENT[0], id: 4 }] }
    }
    return { ok: true, data: RECENT }
  }
}

function statCell(label: string): HTMLElement {
  const title = screen.getByText(label)
  const cell = title.closest('.summary-cell')
  if (!cell || !(cell instanceof HTMLElement)) {
    throw new Error(`Khong tim thay summary cell cua "${label}"`)
  }
  return cell
}

beforeEach(() => {
  vi.clearAllMocks()
  useVpsStore.setState({ resources: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DashboardPage', () => {
  it('hien thi thong ke tong quan va bang hoat dong gan day (0/2 khi chua probe trong phien)', async () => {
    const invoke = mockApi(happyHandlers)
    render(<DashboardPage onOpenVps={() => {}} onOpenDeploy={() => {}} />)

    await screen.findByText(strings.dashboard.title)

    // Khong dem last_status='online' tu DB: chua probe trong phien nen la 0 / 2
    expect(statCell(strings.dashboard.stats.vpsOnline).textContent).toContain('0 / 2')
    expect(statCell(strings.dashboard.stats.appsRunning).textContent).toContain('1 / 2')
    expect(statCell(strings.dashboard.stats.deploy24h).textContent).toContain('2')
    expect(statCell(strings.dashboard.stats.lastDeploy).textContent).toMatch(
      /ago|just now|trước|vừa xong/
    )

    expect(screen.getAllByText('Deployed v7 successfully.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rollback failed.').length).toBeGreaterThan(0)
    expect(screen.getByText(strings.dashboard.actions.deploy)).toBeTruthy()
    expect(screen.getByText(strings.dashboard.actions.rollback_auto)).toBeTruthy()
    expect(screen.getByText(strings.dashboard.statuses.success)).toBeTruthy()
    expect(screen.getByText(strings.dashboard.statuses.failed)).toBeTruthy()
    expect(screen.getByText(strings.dashboard.statuses.cancelled)).toBeTruthy()

    expect(invoke).toHaveBeenCalledWith('history:list', { limit: 10, offset: 0 })
    expect(invoke).toHaveBeenCalledWith(
      'history:list',
      expect.objectContaining({ actions: ['deploy'], limit: 200, offset: 0 })
    )
  })

  it('tinh dung so VPS online khi co ket qua probe trong phien', async () => {
    useVpsStore.setState({
      resources: {
        1: {
          status: 'success',
          data: {
            ram_total_mb: 4096,
            ram_free_mb: 1024,
            disk_total_gb: 40,
            disk_free_gb: 20,
            cpu_count: 2,
            load_avg_1m: 0.2
          }
        }
      }
    })
    mockApi(happyHandlers)
    render(<DashboardPage />)

    await screen.findByText(strings.dashboard.title)
    expect(statCell(strings.dashboard.stats.vpsOnline).textContent).toContain('1 / 2')
  })

  it('khong co VPS thi hien empty state va nap sang man VPS', async () => {
    const onOpenVps = vi.fn()
    mockApi({
      ...happyHandlers,
      'vps:list': async () => ({ ok: true, data: [] })
    })
    render(<DashboardPage onOpenVps={onOpenVps} />)

    expect(await screen.findByText(strings.dashboard.emptyVps)).toBeTruthy()
    fireEvent.click(screen.getByText(strings.dashboard.addVps))
    expect(onOpenVps).toHaveBeenCalled()
  })

  it('load loi thi hien Alert va nut Thu lai nap lai duoc', async () => {
    let calls = 0
    mockApi({
      ...happyHandlers,
      'vps:list': async () => {
        calls += 1
        if (calls === 1) {
          return {
            ok: false,
            error: { code: 'DB_ERROR', message: 'Khong doc duoc DB.', technical: 'db down' }
          }
        }
        return { ok: true, data: [VPS_A] }
      }
    })
    render(<DashboardPage />)

    expect(await screen.findByText('Khong doc duoc DB.')).toBeTruthy()
    fireEvent.click(screen.getByText(strings.dashboard.retry))
    expect(await screen.findByText(strings.dashboard.title)).toBeTruthy()
  })

  it('hien thi bang ung dung uu tien dau tien voi trang thai ghi nhan, ho tro dieu huong apps va vps', async () => {
    const onOpenApps = vi.fn()
    const onOpenVps = vi.fn()
    const onOpenDeploy = vi.fn()
    mockApi(happyHandlers)

    render(
      <DashboardPage onOpenApps={onOpenApps} onOpenVps={onOpenVps} onOpenDeploy={onOpenDeploy} />
    )

    await screen.findByText(strings.dashboard.title)

    // Bảng ứng dụng đang quản lý hiển thị ưu tiên
    expect(screen.getByText(strings.dashboard.apps.title)).toBeTruthy()
    expect(screen.getByText('blog-demo')).toBeTruthy()
    expect(screen.getByText('api-demo')).toBeTruthy()

    // Phân biệt trạng thái đã ghi nhận (không tự khẳng định running/healthy)
    expect(screen.getByText(`${strings.dashboard.apps.statusDeployed} (#7)`)).toBeTruthy()
    expect(screen.getByText(strings.dashboard.apps.statusNotDeployed)).toBeTruthy()

    // Bấm xem tất cả ứng dụng
    fireEvent.click(screen.getByText(strings.dashboard.apps.viewAll))
    expect(onOpenApps).toHaveBeenCalled()

    // Bấm vào ứng dụng lưu selectedAppId và gọi onOpenApps
    fireEvent.click(screen.getByText('blog-demo'))
    expect(useUiState.getState().selectedAppId).toBe(1)

    // Bấm vào máy chủ trên bảng lưu selectedVpsId và gọi onOpenVps
    const vpsLinks = screen.getAllByText('VM01')
    expect(vpsLinks.length).toBeGreaterThan(0)
    fireEvent.click(vpsLinks[0])
    expect(onOpenVps).toHaveBeenCalled()
    expect(useUiState.getState().selectedVpsId).toBe(1)

    // Bấm nút Triển khai trên header
    fireEvent.click(screen.getByText(strings.dashboard.deployAction))
    expect(onOpenDeploy).toHaveBeenCalled()
  })

  it('cap nhat dung toan bo nhan va thoi gian tuong doi khi doi 4 ngon ngu', async () => {
    mockApi(happyHandlers)

    // Test English
    useUiState.setState({ locale: 'en' })
    const { rerender } = render(<DashboardPage />)
    await screen.findByText('Dashboard')
    expect(
      screen.getByText('System overview, managed applications, and recent activities.')
    ).toBeTruthy()
    expect(screen.getByText('Managed applications')).toBeTruthy()
    expect(screen.getByText('Recent activity')).toBeTruthy()
    expect(statCell('Last deployment').textContent).toMatch(/ago|just now/)

    // Test Vietnamese
    useUiState.setState({ locale: 'vi' })
    rerender(<DashboardPage />)
    await screen.findByText('Tổng quan hệ thống')
    expect(screen.getByText('Ứng dụng đang quản lý')).toBeTruthy()
    expect(screen.getByText('Hoạt động gần đây')).toBeTruthy()
    expect(statCell('Lần triển khai gần nhất').textContent).toMatch(/trước|vừa xong/)

    // Test Chinese
    useUiState.setState({ locale: 'cn' })
    rerender(<DashboardPage />)
    await screen.findByText('系统总览')
    expect(screen.getByText('管理的应用')).toBeTruthy()
    expect(screen.getByText('近期活动')).toBeTruthy()
    expect(statCell('最近部署').textContent).toMatch(/前|刚刚/)

    // Test Japanese
    useUiState.setState({ locale: 'jp' })
    rerender(<DashboardPage />)
    await screen.findByText('システム概要')
    expect(screen.getByText('管理中のアプリ')).toBeTruthy()
    expect(screen.getByText('最近のアクティビティ')).toBeTruthy()
    expect(statCell('最終デプロイ').textContent).toMatch(/前|たった今/)

    // Reset về Vietnamese cho các test tiếp theo
    useUiState.setState({ locale: 'vi' })
  })

  it('lay lan trien khai gan nhat bang truy van history:list rieng biet ma khong suy ra tu 10 hoat dong gan nhat', async () => {
    // 10 hoạt động gần nhất toàn là scan và restart (không có deploy nào)
    const recentWithoutDeploy: ActionLogEntry[] = [
      logEntry({ id: 10, action: 'scan', message: 'Scanned VM01' }),
      logEntry({ id: 11, action: 'restart', message: 'Restarted VM01' })
    ]
    const dedicatedDeployLog = logEntry({
      id: 99,
      action: 'deploy',
      ts: '2026-08-10T12:00:00Z',
      message: 'Dedicated deploy log v5'
    })

    const invoke = mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'app:list': async () => ({ ok: true, data: [APP_A] }),
      'history:list': async (filter) => {
        const f = filter as { actions?: string[]; limit?: number }
        if (f.actions && f.actions.includes('deploy') && f.limit === 1) {
          return { ok: true, data: [dedicatedDeployLog] }
        }
        if (f.actions && f.actions.includes('deploy') && f.limit === 200) {
          return { ok: true, data: [dedicatedDeployLog] }
        }
        return { ok: true, data: recentWithoutDeploy }
      }
    })

    render(<DashboardPage />)
    await screen.findByText(strings.dashboard.title)

    // Xác nhận history:list được gọi đúng để lấy lần deploy gần nhất
    expect(invoke).toHaveBeenCalledWith('history:list', {
      actions: ['deploy'],
      limit: 1,
      offset: 0
    })

    // Dù trong 10 hoạt động gần nhất không có deploy, ô Lần triển khai gần nhất vẫn hiển thị đúng
    const lastDeployCell = statCell(strings.dashboard.stats.lastDeploy)
    expect(lastDeployCell.textContent).not.toBe('—')
    expect(lastDeployCell.textContent).toMatch(/ago|just now|trước|vừa xong/)
  })

  it('thong ke 24 gio neu cham moc 200 thi hien thi ro >=200 chu khong ghi 200 chinh xac', async () => {
    const cappedArray = Array.from({ length: 200 }, (_, i) =>
      logEntry({ id: 1000 + i, action: 'deploy' })
    )

    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'app:list': async () => ({ ok: true, data: [APP_A] }),
      'history:list': async (filter) => {
        const f = filter as { actions?: string[]; limit?: number }
        if (f.actions && f.actions.includes('deploy') && f.limit === 200) {
          return { ok: true, data: cappedArray }
        }
        if (f.actions && f.actions.includes('deploy') && f.limit === 1) {
          return { ok: true, data: [cappedArray[0]] }
        }
        return { ok: true, data: RECENT }
      }
    })

    render(<DashboardPage />)
    await screen.findByText(strings.dashboard.title)

    // Thống kê 24h hiển thị rõ ràng "≥200"
    expect(statCell(strings.dashboard.stats.deploy24h).textContent).toContain('≥200')
  })
})
