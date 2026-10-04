// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { useUiState } from './store/uiState'

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
      if (channel === 'vps:list' || channel === 'app:list' || channel === 'migrate:list') {
        return { ok: true, data: [] }
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
})
