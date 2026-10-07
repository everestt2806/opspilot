// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('bam nut Trien khai khi dang xem chi tiet app: goi app:get va truyen dung {appId, vpsId} sang deploy', async () => {
    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: 42,
      deployPreselect: null
    })
    const invokeMock = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:get' && args[0] === 42) {
        return { ok: true, data: { id: 42, vps_id: 8, name: 'my-app' } }
      }
      if (channel === 'vps:list' || channel === 'app:list' || channel === 'app:versions') {
        return { ok: true, data: [] }
      }
      return { ok: true, data: undefined }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    render(<App />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    })

    expect(invokeMock).toHaveBeenCalledWith('app:get', 42)
    expect(useUiState.getState().deployPreselect).toEqual({ appId: 42, vpsId: 8 })
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

  it('chan ket qua app:get den muon khi nguoi dung da doi trang hoac doi ngu canh', async () => {
    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: 42,
      deployPreselect: null
    })

    let resolveAppGet: (val: unknown) => void = () => {}
    const appGetPromise = new Promise((resolve) => {
      resolveAppGet = resolve
    })

    const invokeMock = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:get' && args[0] === 42) {
        return appGetPromise
      }
      return { ok: true, data: [] }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    render(<App />)

    // Bấm Triển khai trong khi xem app 42
    fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    expect(invokeMock).toHaveBeenCalledWith('app:get', 42)

    // Trong khi app:get đang chờ phản hồi, người dùng bấm chuyển sang Settings
    act(() => {
      useUiState.getState().setActivePage('settings')
    })
    expect(useUiState.getState().activePage).toBe('settings')

    // Giờ app:get mới trả về kết quả
    await act(async () => {
      resolveAppGet({ ok: true, data: { id: 42, vps_id: 8, name: 'my-app' } })
    })

    // Kết quả đến muộn phải bị bỏ qua: KHÔNG chuyển sang deploy, KHÔNG ghi đè preselect
    expect(useUiState.getState().activePage).toBe('settings')
    expect(useUiState.getState().deployPreselect).toBeNull()
  })

  it('xu ly loi tai app:get an toan va mo Deploy mac dinh, khong lam crash app', async () => {
    useUiState.setState({
      locale: 'vi',
      activePage: 'apps',
      selectedAppId: 99,
      deployPreselect: { vpsId: 1 }
    })

    const invokeMock = vi.fn(async (channel: string) => {
      if (channel === 'app:get') {
        throw new Error('IPC connection error')
      }
      return { ok: true, data: [] }
    })
    vi.stubGlobal('api', { invoke: invokeMock, on: vi.fn(() => () => {}) })

    render(<App />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Triển khai' }))
    })

    // Không crash, xóa preselect cũ và mở Deploy mặc định
    expect(useUiState.getState().deployPreselect).toBeNull()
    expect(useUiState.getState().activePage).toBe('deploy')
  })

  it('strings.vps.backToList duoc dinh nghia va dung cho ca 4 ngon ngu', async () => {
    const { getStrings } = await import('./strings')
    expect(getStrings('vi').vps.backToList).toBe('Quay lại danh sách máy chủ')
    expect(getStrings('cn').vps.backToList).toBe('返回服务器列表')
    expect(getStrings('jp').vps.backToList).toBe('サーバー一覧に戻る')
    expect(getStrings('en').vps.backToList).toBe('Back to VPS list')
  })
})
