// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App as AppModel, Deployment, Vps } from '@shared/ipc'
import App from './App'
import { useUiState } from './store/uiState'
import { useVpsStore } from './store/vpsStore'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn()
    loadAddon = vi.fn()
    open = vi.fn()
    dispose = vi.fn()
    scrollToBottom = vi.fn()
    getSelection = (): string => ''
  }
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  }
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext = vi.fn()
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
  useUiState.setState({ locale: 'en', activePage: 'apps' })
  vi.stubGlobal('api', {
    invoke: vi.fn(async (channel: string) => {
      if (
        channel === 'vps:list' ||
        channel === 'app:list' ||
        channel === 'migrate:list' ||
        channel === 'app:versions'
      ) {
        return { ok: true, data: [] }
      }
      if (channel === 'vps:get-resources') {
        return {
          ok: true,
          data: {
            ram_total_mb: 4096,
            ram_free_mb: 2048,
            disk_total_gb: 40,
            disk_free_gb: 20,
            cpu_count: 2,
            load_avg_1m: 0.1
          }
        }
      }
      return { ok: true, data: undefined }
    }),
    on: vi.fn(() => () => {})
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveActivePage', () => {
  it('chuan hoa history ve activity va giu nguyen cac trang hop le', async () => {
    const { resolveActivePage } = await import('./utils/navigation')
    expect(resolveActivePage('history')).toBe('activity')
    expect(resolveActivePage('activity')).toBe('activity')
    expect(resolveActivePage('migrate')).toBe('migrate')
    expect(resolveActivePage('deploy')).toBe('deploy')
    expect(resolveActivePage('dashboard')).toBe('dashboard')
    expect(resolveActivePage('apps')).toBe('apps')
    expect(resolveActivePage('vps')).toBe('vps')
    expect(resolveActivePage('settings')).toBe('settings')
    expect(resolveActivePage('unknown-legacy-page')).toBe('apps')
  })
})

describe('App — UI-1a Desktop Shell & Navigation', () => {
  it('hien thi dung 5 muc dieu huong chinh tren sidebar va nut deploy action', () => {
    useUiState.setState({ locale: 'vi', activePage: 'apps' })
    const { container } = render(<App />)

    // Nut Deploy action: dung 1 icon plus va chu Trien khai (khong co 2 dau cong)
    const deployBtn = screen.getByRole('button', { name: 'Triển khai' })
    expect(deployBtn).toBeTruthy()
    expect(deployBtn.querySelector('.anticon-plus')).toBeTruthy()
    expect(deployBtn.textContent).toBe('Triển khai')

    // 5 muc dieu huong chinh tren sidebar
    const nav = container.querySelector('.app-sidebar-nav')
    expect(nav).toBeTruthy()
    const navButtons = nav?.querySelectorAll('button')
    expect(navButtons?.length).toBe(5)
    expect(screen.getByRole('button', { name: 'Tổng quan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ứng dụng' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Máy chủ' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hoạt động' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cài đặt' })).toBeTruthy()

    // Sidebar khong con nut secondary migrate o day
    expect(container.querySelector('.app-sidebar-secondary')).toBeNull()
    const allSidebarButtons = container.querySelectorAll('.app-sidebar button')
    expect(allSidebarButtons.length).toBe(6) // 1 deploy action + 5 nav items

    // Khong co status bar hay chu Ready co dinh
    expect(container.querySelector('.app-statusbar')).toBeNull()
    expect(container.querySelector('.app-sidebar-footer')).toBeNull()
  })

  it('dieu huong sang Deploy qua nut Triển khai va co the quay lai apps', () => {
    useUiState.setState({ locale: 'vi', activePage: 'apps' })
    render(<App />)

    // Bam Trien khai
    fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    expect(useUiState.getState().activePage).toBe('deploy')

    // DeployPage co nut Quay lai
    const backBtn = screen.getByRole('button', { name: /Quay lại/i })
    expect(backBtn).toBeTruthy()
    fireEvent.click(backBtn)
    expect(useUiState.getState().activePage).toBe('apps')
  })

  it('giu loi vao MigratePage qua nut Di chuyển / Migrate o trang VPS', () => {
    useUiState.setState({ locale: 'vi', activePage: 'vps' })
    render(<App />)

    // O trang VPS co nut hanh dong 'Di chuyển'
    const migrateBtn = screen.getByRole('button', { name: /Di chuyển/i })
    expect(migrateBtn).toBeTruthy()

    fireEvent.click(migrateBtn)
    expect(useUiState.getState().activePage).toBe('migrate')
    expect(screen.getByText('Migrate giữa hai VPS')).toBeTruthy()
  })

  it('cap nhat dung nhan sidebar tren ca 4 ngon ngu (EN, VI, CN, JP)', () => {
    useUiState.setState({ locale: 'en', activePage: 'apps' })
    render(<App />)

    // EN
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Applications' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Servers' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Activity' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()

    // VI
    act(() => {
      useUiState.getState().setLocale('vi')
    })
    expect(screen.getByRole('button', { name: 'Triển khai' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tổng quan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ứng dụng' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Máy chủ' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hoạt động' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cài đặt' })).toBeTruthy()

    // CN
    act(() => {
      useUiState.getState().setLocale('cn')
    })
    expect(screen.getByRole('button', { name: '部署' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '总览' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '应用' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '服务器' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '操作动态' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '系统设置' })).toBeTruthy()

    // JP
    act(() => {
      useUiState.getState().setLocale('jp')
    })
    expect(screen.getByRole('button', { name: 'デプロイ' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ダッシュボード' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'アプリ' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'サーバー' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'アクティビティ' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'システム設定' })).toBeTruthy()
  })

  it('doi ngon ngu qua trang Settings va cap nhat menu sidebar', () => {
    useUiState.setState({ locale: 'en', activePage: 'settings' })
    render(<App />)

    // Tren trang Settings co segmented ngon ngu
    fireEvent.click(screen.getByText('Tiếng Việt'))
    expect(useUiState.getState().locale).toBe('vi')
    expect(screen.getByRole('button', { name: 'Triển khai' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ứng dụng' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cài đặt' })).toBeTruthy()
  })

  it('khoi phuc an toan khi activePage trong session la history', () => {
    useUiState.setState({ locale: 'vi', activePage: 'history' })
    const { container } = render(<App />)

    // Map thanh activity (HistoryPage)
    expect(container.querySelector('[data-page-key="activity"]')).toBeTruthy()
  })

  const fixtureApps: AppModel[] = [
    {
      id: 42,
      vps_id: 8,
      name: 'web-prod',
      framework: 'express',
      host_port: 3000,
      container_port: 3000,
      healthcheck_path: '/health',
      needs_db: 0,
      current_deployment_id: 101,
      url: 'http://1.2.3.4:3000'
    },
    {
      id: 43,
      vps_id: 8,
      name: 'api-service',
      framework: 'express',
      host_port: 8000,
      container_port: 8000,
      healthcheck_path: '/health',
      needs_db: 0,
      current_deployment_id: 102,
      url: 'http://1.2.3.4:8000'
    }
  ]

  const fixtureVpsList: Vps[] = [
    {
      id: 8,
      name: 'VPS-SG-01',
      host: '1.2.3.4',
      port: 22,
      username: 'root',
      auth_type: 'key',
      provider: 'aws',
      region: 'ap-southeast-1',
      docker_version: '27.0.0',
      last_status: 'online',
      last_seen_at: null,
      created_at: '2026-01-01T00:00:00Z'
    }
  ]

  const fixtureDeployments: Deployment[] = [
    {
      id: 101,
      app_id: 42,
      version: 1,
      image_tag: 'web-prod:v1.0.0',
      status: 'running',
      failed_step: null,
      build_duration_ms: 12000,
      total_duration_ms: 15000,
      is_rollback_of: null,
      started_at: '2026-01-01T00:00:00Z',
      finished_at: '2026-01-01T00:05:00Z',
      exposure_status: 'reachable',
      exposure_evidence_json: null
    },
    {
      id: 102,
      app_id: 43,
      version: 1,
      image_tag: 'api-service:v1.0.0',
      status: 'running',
      failed_step: null,
      build_duration_ms: 8000,
      total_duration_ms: 11000,
      is_rollback_of: null,
      started_at: '2026-01-01T00:00:00Z',
      finished_at: '2026-01-01T00:05:00Z',
      exposure_status: 'reachable',
      exposure_evidence_json: null
    }
  ]

  it('bam nut Trien khai khi dang xem chi tiet app fixture thuc su: goi app:get va truyen dung {appId, vpsId}', async () => {
    const invokeMock = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:get' && args[0] === 42) {
        return { ok: true, data: { ...fixtureApps[0] } }
      }
      if (channel === 'app:list') return { ok: true, data: fixtureApps }
      if (channel === 'vps:list') return { ok: true, data: fixtureVpsList }
      if (channel === 'app:versions') return { ok: true, data: fixtureDeployments }
      return { ok: true, data: undefined }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: 42,
      deployPreselect: null
    })

    const setDeployPreselectSpy = vi.spyOn(useUiState.getState(), 'setDeployPreselect')

    render(<App />)

    // Xác nhận app fixture 42 thực sự hiển thị trên màn hình chi tiết (có nút quay lại và tên app)
    expect(await screen.findByRole('heading', { level: 3, name: 'web-prod' })).toBeTruthy()
    expect(screen.getByTestId('app-detail-back-btn')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    })

    expect(invokeMock).toHaveBeenCalledWith('app:get', 42)
    expect(setDeployPreselectSpy).toHaveBeenCalledWith({ appId: 42, vpsId: 8 })
    expect(useUiState.getState().activePage).toBe('deploy')
  })

  it('bam nut Trien khai khi dang xem chi tiet VPS: truyen {vpsId} sang deploy', async () => {
    const invokeMock = vi.fn(async (channel: string) => {
      if (channel === 'vps:list') {
        return {
          ok: true,
          data: [
            {
              id: 9,
              name: 'VM09',
              host: '1.2.3.4',
              port: 22,
              username: 'root',
              auth_type: 'key',
              provider: 'test',
              region: 'test',
              docker_version: '27',
              last_status: 'online',
              last_seen_at: null,
              created_at: ''
            }
          ]
        }
      }
      if (channel === 'app:list' || channel === 'app:versions') {
        return { ok: true, data: [] }
      }
      if (channel === 'vps:get-resources') {
        return {
          ok: true,
          data: {
            ram_total_mb: 4096,
            ram_free_mb: 2048,
            disk_total_gb: 40,
            disk_free_gb: 20,
            cpu_count: 2,
            load_avg_1m: 0.1
          }
        }
      }
      return { ok: true, data: undefined }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    useVpsStore.setState({
      items: [
        {
          id: 9,
          name: 'VM09',
          host: '1.2.3.4',
          port: 22,
          username: 'root',
          auth_type: 'key',
          provider: 'test',
          region: 'test',
          docker_version: '27',
          last_status: 'online',
          last_seen_at: null,
          created_at: ''
        }
      ]
    })
    useUiState.setState({ locale: 'vi', activePage: 'vps', deployPreselect: null })
    render(<App />)

    await act(async () => {
      useUiState.getState().setSelectedVpsId(9)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))

    expect(useUiState.getState().deployPreselect).toEqual({ vpsId: 9 })
    expect(useUiState.getState().activePage).toBe('deploy')
  })

  it('bam nut Trien khai o trang khac hoac man danh sach: xoa preselect cu va mo Deploy mac dinh', () => {
    // Trường hợp 1: Ở dashboard với session còn lưu ID cũ từ trước
    useUiState.setState({
      locale: 'vi',
      activePage: 'dashboard',
      selectedAppId: 10,
      selectedVpsId: 20,
      deployPreselect: { appId: 10, vpsId: 20 }
    })
    const { unmount } = render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    expect(useUiState.getState().deployPreselect).toBeNull()
    expect(useUiState.getState().activePage).toBe('deploy')
    unmount()

    // Trường hợp 2: Ở màn danh sách apps (selectedAppId = null)
    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: null,
      deployPreselect: { vpsId: 5 }
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    expect(useUiState.getState().deployPreselect).toBeNull()
    expect(useUiState.getState().activePage).toBe('deploy')
  })

  it('roi trang roi quay lai cung app: vo hieu hoa yeu cau app:get dang cho, khong nhay sang deploy', async () => {
    let resolveAppGet: (val: unknown) => void = () => {}
    const pendingPromise = new Promise((resolve) => {
      resolveAppGet = resolve
    })

    const invokeMock = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:get' && args[0] === 42) {
        return pendingPromise
      }
      if (channel === 'app:list') return { ok: true, data: fixtureApps }
      if (channel === 'vps:list') return { ok: true, data: fixtureVpsList }
      if (channel === 'app:versions') return { ok: true, data: fixtureDeployments }
      return { ok: true, data: undefined }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: 42,
      deployPreselect: null
    })

    render(<App />)
    expect(await screen.findByRole('heading', { level: 3, name: 'web-prod' })).toBeTruthy()
    expect(screen.getByTestId('app-detail-back-btn')).toBeTruthy()

    // Bấm Triển khai trong khi xem app 42
    fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    expect(invokeMock).toHaveBeenCalledWith('app:get', 42)

    // Người dùng rời sang Dashboard
    await act(async () => {
      useUiState.getState().setActivePage('dashboard')
    })
    expect(useUiState.getState().activePage).toBe('dashboard')

    // Người dùng quay lại trang Apps cùng app 42
    await act(async () => {
      useUiState.getState().setActivePage('apps')
    })
    expect(useUiState.getState().activePage).toBe('apps')
    expect(await screen.findByRole('heading', { level: 3, name: 'web-prod' })).toBeTruthy()

    // Giờ app:get của lần bấm cũ mới trả về kết quả
    await act(async () => {
      resolveAppGet({ ok: true, data: { ...fixtureApps[0] } })
    })

    // Yêu cầu cũ đã bị vô hiệu hóa: người dùng vẫn ở lại trang Apps, KHÔNG nhảy sang Deploy
    expect(useUiState.getState().activePage).toBe('apps')
    expect(useUiState.getState().selectedAppId).toBe(42)
    expect(useUiState.getState().deployPreselect).toBeNull()
  })

  it('doi app roi quay lai cung app: vo hieu hoa yeu cau app:get dang cho, khong nhay sang deploy', async () => {
    let resolveAppGet: (val: unknown) => void = () => {}
    const pendingPromise = new Promise((resolve) => {
      resolveAppGet = resolve
    })

    const invokeMock = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:get' && args[0] === 42) {
        return pendingPromise
      }
      if (channel === 'app:list') return { ok: true, data: fixtureApps }
      if (channel === 'vps:list') return { ok: true, data: fixtureVpsList }
      if (channel === 'app:versions') return { ok: true, data: fixtureDeployments }
      return { ok: true, data: undefined }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: 42,
      deployPreselect: null
    })

    render(<App />)
    expect(await screen.findByRole('heading', { level: 3, name: 'web-prod' })).toBeTruthy()

    // Bấm Triển khai cho app 42
    fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    expect(invokeMock).toHaveBeenCalledWith('app:get', 42)

    // Người dùng chuyển sang xem app 43
    await act(async () => {
      useUiState.getState().setSelectedAppId(43)
    })
    expect(await screen.findByRole('heading', { level: 3, name: 'api-service' })).toBeTruthy()

    // Người dùng chuyển lại về xem app 42
    await act(async () => {
      useUiState.getState().setSelectedAppId(42)
    })
    expect(await screen.findByRole('heading', { level: 3, name: 'web-prod' })).toBeTruthy()

    // Giờ yêu cầu app:get cũ mới hoàn tất
    await act(async () => {
      resolveAppGet({ ok: true, data: { ...fixtureApps[0] } })
    })

    // Yêu cầu cũ bị hủy: không nhảy sang Deploy
    expect(useUiState.getState().activePage).toBe('apps')
    expect(useUiState.getState().selectedAppId).toBe(42)
    expect(useUiState.getState().deployPreselect).toBeNull()
  })

  it('bam Deploy lan hai: huy y dinh cu va chi thuc thi y dinh moi nhat', async () => {
    let resolveFirst: (val: unknown) => void = () => {}
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve
    })
    let resolveSecond: (val: unknown) => void = () => {}
    const secondPromise = new Promise((resolve) => {
      resolveSecond = resolve
    })

    let callCount = 0
    const invokeMock = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:get' && args[0] === 42) {
        callCount++
        return callCount === 1 ? firstPromise : secondPromise
      }
      if (channel === 'app:list') return { ok: true, data: fixtureApps }
      if (channel === 'vps:list') return { ok: true, data: fixtureVpsList }
      if (channel === 'app:versions') return { ok: true, data: fixtureDeployments }
      return { ok: true, data: undefined }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: 42,
      deployPreselect: null
    })

    const setDeployPreselectSpy = vi.spyOn(useUiState.getState(), 'setDeployPreselect')
    setDeployPreselectSpy.mockClear()

    render(<App />)
    expect(await screen.findByRole('heading', { level: 3, name: 'web-prod' })).toBeTruthy()

    // Bấm Deploy lần 1
    fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    expect(callCount).toBe(1)

    // Bấm Deploy lần 2 trong khi lần 1 còn đang chờ
    fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    expect(callCount).toBe(2)

    // Lần 1 trả về kết quả
    await act(async () => {
      resolveFirst({ ok: true, data: { ...fixtureApps[0] } })
    })

    // Lần 1 bị hủy, chưa chuyển trang
    expect(useUiState.getState().activePage).toBe('apps')
    expect(setDeployPreselectSpy).not.toHaveBeenCalled()

    // Giờ lần 2 trả về kết quả
    await act(async () => {
      resolveSecond({ ok: true, data: { ...fixtureApps[0] } })
    })

    // Lần 2 hợp lệ: chuyển sang Deploy với preselect
    expect(useUiState.getState().activePage).toBe('deploy')
    expect(setDeployPreselectSpy).toHaveBeenCalledWith({ appId: 42, vpsId: 8 })
  })

  it('phan hoi sai ID tu app:get: giu o trang hien tai, bao loi ro rang, khong mo form tao app moi', async () => {
    const invokeMock = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:get' && args[0] === 42) {
        return { ok: true, data: { id: 999, vps_id: 8, name: 'other-app' } }
      }
      if (channel === 'app:list') return { ok: true, data: fixtureApps }
      if (channel === 'vps:list') return { ok: true, data: fixtureVpsList }
      if (channel === 'app:versions') return { ok: true, data: fixtureDeployments }
      return { ok: true, data: undefined }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: 42,
      deployPreselect: null
    })

    render(<App />)
    expect(await screen.findByRole('heading', { level: 3, name: 'web-prod' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    })

    // Người dùng được giữ nguyên ở trang chi tiết app 42
    expect(useUiState.getState().activePage).toBe('apps')
    expect(useUiState.getState().selectedAppId).toBe(42)
    expect(useUiState.getState().deployPreselect).toBeNull()

    // Báo lỗi rõ ràng trên UI
    expect(
      await screen.findByText('Dữ liệu ứng dụng trả về không khớp với ứng dụng đang chọn.')
    ).toBeTruthy()
  })

  it('loi IPC khi tai app:get: giu o trang hien tai, bao loi ro rang, khong mo form tao app moi', async () => {
    const invokeMock = vi.fn(async (channel: string) => {
      if (channel === 'app:get') {
        throw new Error('IPC network error')
      }
      if (channel === 'app:list') return { ok: true, data: fixtureApps }
      if (channel === 'vps:list') return { ok: true, data: fixtureVpsList }
      if (channel === 'app:versions') return { ok: true, data: fixtureDeployments }
      return { ok: true, data: undefined }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: 42,
      deployPreselect: null
    })

    render(<App />)
    expect(await screen.findByRole('heading', { level: 3, name: 'web-prod' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    })

    // Giữ nguyên ở trang chi tiết hiện tại, không mở form tạo mới
    expect(useUiState.getState().activePage).toBe('apps')
    expect(useUiState.getState().selectedAppId).toBe(42)
    expect(useUiState.getState().deployPreselect).toBeNull()

    // Báo lỗi rõ ràng
    expect(
      await screen.findByText('Lỗi kết nối khi tải thông tin ứng dụng: IPC network error')
    ).toBeTruthy()
  })

  it('khong co vps_id hop le trong app:get: giu o trang hien tai, bao loi ro rang, khong mo form tao app moi', async () => {
    const invokeMock = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:get' && args[0] === 42) {
        return { ok: true, data: { ...fixtureApps[0], vps_id: null } }
      }
      if (channel === 'app:list') return { ok: true, data: fixtureApps }
      if (channel === 'vps:list') return { ok: true, data: fixtureVpsList }
      if (channel === 'app:versions') return { ok: true, data: fixtureDeployments }
      return { ok: true, data: undefined }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: 42,
      deployPreselect: null
    })

    render(<App />)
    expect(await screen.findByRole('heading', { level: 3, name: 'web-prod' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    })

    // Giữ nguyên ở trang chi tiết hiện tại, không mở form tạo mới
    expect(useUiState.getState().activePage).toBe('apps')
    expect(useUiState.getState().selectedAppId).toBe(42)
    expect(useUiState.getState().deployPreselect).toBeNull()

    // Báo lỗi rõ ràng
    expect(
      await screen.findByText('Ứng dụng chưa được liên kết với máy chủ (VPS) hợp lệ.')
    ).toBeTruthy()
  })

  it('strings.vps.backToList duoc dinh nghia va dung cho ca 4 ngon ngu', async () => {
    const { getStrings } = await import('./strings')
    expect(getStrings('vi').vps.backToList).toBe('Quay lại danh sách máy chủ')
    expect(getStrings('cn').vps.backToList).toBe('返回服务器列表')
    expect(getStrings('jp').vps.backToList).toBe('サーバー一覧に戻る')
    expect(getStrings('en').vps.backToList).toBe('Back to VPS list')
  })
})
