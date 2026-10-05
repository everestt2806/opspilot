// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionLogEntry, Vps } from '@shared/ipc'

import { HistoryPage } from './HistoryPage'
import { strings } from '../strings'

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
  last_seen_at: '2026-08-19T09:00:00Z',
  created_at: '2026-08-19T00:00:00Z'
}

const ROWS: ActionLogEntry[] = [
  {
    id: 1,
    ts: '2026-08-19T10:00:00Z',
    action: 'deploy',
    status: 'success',
    message: 'Deployed v7 successfully.',
    vps_id: 1,
    app_id: 1,
    deployment_id: 7,
    detail_json: JSON.stringify({ step: 'HEALTHCHECK', duration_ms: 1500 })
  },
  {
    id: 2,
    ts: '2026-08-19T09:50:00Z',
    action: 'rollback_auto',
    status: 'failed',
    message: 'Rollback failed.',
    vps_id: 1,
    app_id: 1,
    deployment_id: 6,
    detail_json: null
  }
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

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HistoryPage', { timeout: 30000 }, () => {
  it('hien bang lich su va drawer chi tiet key-value', async () => {
    const invoke = mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async () => ({ ok: true, data: ROWS })
    })
    render(<HistoryPage />)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('history:list', {
        actions: undefined,
        vps_id: undefined,
        from_ts: undefined,
        to_ts: undefined,
        limit: 21,
        offset: 0
      })
    )
    expect((await screen.findAllByText('Deployed v7 successfully.')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Rollback failed.')).length).toBeGreaterThan(0)
    expect(screen.getByText(strings.dashboard.actions.rollback_auto)).toBeTruthy()

    fireEvent.click(screen.getByRole('row', { name: /Deployed v7 successfully\./ }))
    expect(await screen.findByText(strings.history.detail.title)).toBeTruthy()
    expect(screen.getByText('step')).toBeTruthy()
    expect(screen.getByText('HEALTHCHECK')).toBeTruthy()
    expect(screen.getByText('duration_ms')).toBeTruthy()
    expect(screen.getByText('1500')).toBeTruthy()
  })

  it('load loi thi hien Alert kem nut Thu lai', async () => {
    const invoke = mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async () => ({
        ok: false,
        error: { code: 'DB_ERROR', message: 'Khong doc duoc DB.', technical: 'db down' }
      })
    })
    render(<HistoryPage />)

    expect(await screen.findByText(strings.history.loadFailed)).toBeTruthy()
    expect(screen.getByText('Khong doc duoc DB.')).toBeTruthy()
    fireEvent.click(screen.getByText(strings.history.retry))
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
  })

  it('loc theo hanh dong thi goi history:list voi filter actions', async () => {
    const invoke = mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async (filter) => ({ ok: true, data: ROWS, filter })
    })
    render(<HistoryPage />)

    const actionSelect = document.querySelector('.ant-select-multiple')
    if (!actionSelect) throw new Error('khong tim thay select hanh dong')
    fireEvent.mouseDown(actionSelect.querySelector('.ant-select-selector') as HTMLElement)
    await waitFor(() => expect(document.querySelector('.ant-select-dropdown')).toBeTruthy())
    const dropdown = document.querySelector('.ant-select-dropdown')
    if (!dropdown) throw new Error('dropdown khong mo')
    fireEvent.click(within(dropdown as HTMLElement).getByText(strings.dashboard.actions.deploy))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'history:list',
        expect.objectContaining({ actions: ['deploy'] })
      )
    )
  })

  it('drawer chi tiet co nut dieu huong sang VPS va Ứng dụng', async () => {
    const onOpenVps = vi.fn()
    const onOpenApps = vi.fn()
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async () => ({ ok: true, data: ROWS })
    })

    render(<HistoryPage onOpenVps={onOpenVps} onOpenApps={onOpenApps} />)
    await screen.findByText('Deployed v7 successfully.')

    fireEvent.click(screen.getByRole('row', { name: /Deployed v7 successfully\./ }))
    expect(await screen.findByText(strings.history.detail.title)).toBeTruthy()

    // Nút xem máy chủ trong Drawer
    const vpsBtn = screen.getByText(strings.dashboard.viewVps)
    fireEvent.click(vpsBtn)
    expect(onOpenVps).toHaveBeenCalled()

    // Bấm lại dòng để mở lại drawer
    fireEvent.click(screen.getByRole('row', { name: /Deployed v7 successfully\./ }))
    expect(await screen.findByText(strings.history.detail.title)).toBeTruthy()

    // Nút mở ứng dụng trong Drawer
    const appBtn = screen.getByText(strings.dashboard.apps.openApp)
    fireEvent.click(appBtn)
    expect(onOpenApps).toHaveBeenCalled()
  })

  it('ban dia hoa toan bo nhan, cot, filter va relativeTime tren 4 ngon ngu', async () => {
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async () => ({ ok: true, data: ROWS })
    })

    const { useUiState } = await import('../store/uiState')

    // 1. Tiếng Việt (vi)
    useUiState.setState({ locale: 'vi' })
    const { rerender } = render(<HistoryPage />)
    await screen.findByText('Nhật ký hoạt động')
    expect(screen.getByText('Thời gian')).toBeTruthy()
    expect(screen.getByText('Thao tác')).toBeTruthy()
    expect(screen.getByText('Máy chủ')).toBeTruthy()
    expect(screen.getByText('Trạng thái')).toBeTruthy()
    expect(screen.getByText('Thông điệp')).toBeTruthy()
    expect(screen.getByText('Tất cả thao tác')).toBeTruthy()
    expect(screen.getByText('Tất cả máy chủ')).toBeTruthy()
    expect(screen.getByText('Triển khai')).toBeTruthy()
    expect(screen.getByText('Tự động khôi phục')).toBeTruthy()
    expect(screen.getByText('Thành công')).toBeTruthy()
    expect(screen.getByText('Thất bại')).toBeTruthy()
    expect(screen.getByTitle('Trang trước')).toBeTruthy()
    expect(screen.getByTitle('Trang kế')).toBeTruthy()
    expect(screen.getByText('1–2 trong 2')).toBeTruthy()

    // 2. English (en)
    useUiState.setState({ locale: 'en' })
    rerender(<HistoryPage />)
    await screen.findByText('Audit Log')
    expect(screen.getByText('Time')).toBeTruthy()
    expect(screen.getByText('Action')).toBeTruthy()
    expect(screen.getByText('Server')).toBeTruthy()
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getByText('Message')).toBeTruthy()
    expect(screen.getByText('All actions')).toBeTruthy()
    expect(screen.getByText('All servers')).toBeTruthy()
    expect(screen.getByText('Deploy')).toBeTruthy()
    expect(screen.getByText('Auto rollback')).toBeTruthy()
    expect(screen.getByText('Success')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByTitle('Previous page')).toBeTruthy()
    expect(screen.getByTitle('Next page')).toBeTruthy()
    expect(screen.getByText('1–2 of 2')).toBeTruthy()

    // 3. 简体中文 (cn)
    useUiState.setState({ locale: 'cn' })
    rerender(<HistoryPage />)
    await screen.findByText('审计日志')
    expect(screen.getByText('时间')).toBeTruthy()
    expect(screen.getByText('操作')).toBeTruthy()
    expect(screen.getByText('服务器')).toBeTruthy()
    expect(screen.getByText('状态')).toBeTruthy()
    expect(screen.getByText('信息')).toBeTruthy()
    expect(screen.getByText('全部操作')).toBeTruthy()
    expect(screen.getByText('全部服务器')).toBeTruthy()
    expect(screen.getByText('部署')).toBeTruthy()
    expect(screen.getByText('自动回滚')).toBeTruthy()
    expect(screen.getByText('成功')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
    expect(screen.getByTitle('上一页')).toBeTruthy()
    expect(screen.getByTitle('下一页')).toBeTruthy()
    expect(screen.getByText('1–2 / 共 2')).toBeTruthy()

    // 4. 日本語 (jp)
    useUiState.setState({ locale: 'jp' })
    rerender(<HistoryPage />)
    await screen.findByText('監査ログ')
    expect(screen.getByText('日時')).toBeTruthy()
    expect(screen.getByText('操作')).toBeTruthy()
    expect(screen.getByText('サーバー')).toBeTruthy()
    expect(screen.getByText('ステータス')).toBeTruthy()
    expect(screen.getByText('メッセージ')).toBeTruthy()
    expect(screen.getByText('すべての操作')).toBeTruthy()
    expect(screen.getByText('すべてのサーバー')).toBeTruthy()
    expect(screen.getByText('デプロイ')).toBeTruthy()
    expect(screen.getByText('自動ロールバック')).toBeTruthy()
    expect(screen.getByText('成功')).toBeTruthy()
    expect(screen.getByText('失敗')).toBeTruthy()
    expect(screen.getByTitle('前のページ')).toBeTruthy()
    expect(screen.getByTitle('次のページ')).toBeTruthy()
    expect(screen.getByText('1–2 / 全 2')).toBeTruthy()

    // Reset về vi
    useUiState.setState({ locale: 'vi' })
  })

  it('truong hop bien dung 20 dong: lay 21 dong nhung chi co 20 dong -> khong co trang ke, nut Trang ke bi vo hieu', async () => {
    const exactly20Rows = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      ts: '2026-08-19T10:00:00Z',
      action: 'deploy',
      status: 'success' as const,
      message: `Exact20 #${i + 1}`,
      vps_id: 1,
      app_id: 1,
      deployment_id: i + 1,
      detail_json: null
    }))

    const invoke = mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async () => ({ ok: true, data: exactly20Rows })
    })

    render(<HistoryPage />)
    expect(await screen.findByText('Exact20 #1')).toBeTruthy()
    expect(screen.getByText('Exact20 #20')).toBeTruthy()

    // IPC được gọi với limit: 21, offset: 0
    expect(invoke).toHaveBeenCalledWith(
      'history:list',
      expect.objectContaining({ limit: 21, offset: 0 })
    )

    // Nhãn tổng số: 1–20 trong 20 (không phải "còn bản ghi")
    expect(screen.getByText(/1–20 trong 20/)).toBeTruthy()

    // Nút Trang kế bị vô hiệu hóa
    const nextItem = screen.getByTitle('Trang kế')
    expect(nextItem.classList.contains('ant-pagination-disabled')).toBe(true)
  })

  it('truong hop bien 21 dong: lay 21 dong, hien thi 20 dong va dung dong thu 21 de mo trang ke', async () => {
    const exactly21Rows = Array.from({ length: 21 }, (_, i) => ({
      id: i + 1,
      ts: '2026-08-19T10:00:00Z',
      action: 'deploy',
      status: 'success' as const,
      message: `Exact21 #${i + 1}`,
      vps_id: 1,
      app_id: 1,
      deployment_id: i + 1,
      detail_json: null
    }))

    const invoke = mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async () => ({ ok: true, data: exactly21Rows })
    })

    render(<HistoryPage />)
    expect(await screen.findByText('Exact21 #1')).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith(
      'history:list',
      expect.objectContaining({ limit: 21, offset: 0 })
    )

    // Dòng thứ 21 KHÔNG được hiển thị trên bảng của trang 1
    expect(screen.queryByText('Exact21 #21')).toBeNull()

    // Nhãn hiển thị trang 1 còn bản ghi
    expect(screen.getByText(/1–20 \(còn bản ghi\)/)).toBeTruthy()

    // Nút Trang kế được kích hoạt (enabled) và có nút trang 2
    const nextItem = screen.getByTitle('Trang kế')
    expect(nextItem.classList.contains('ant-pagination-disabled')).toBe(false)
    expect(screen.getByTitle('2')).toBeTruthy()
  })

  it('khi tai trang loi thi khong trinh bay dong cua trang cu nhu ket qua trang moi', async () => {
    const page1Rows = Array.from({ length: 21 }, (_, i) => ({
      id: i + 1,
      ts: '2026-08-19T10:00:00Z',
      action: 'deploy',
      status: 'success' as const,
      message: `Page1 Row #${i + 1}`,
      vps_id: 1,
      app_id: 1,
      deployment_id: i + 1,
      detail_json: null
    }))

    const invoke = mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async (filter) => {
        const f = filter as { offset: number }
        if (f.offset === 0) return { ok: true, data: page1Rows }
        if (f.offset === 20) {
          return {
            ok: false,
            error: { code: 'NETWORK_ERR', message: 'Mất kết nối cơ sở dữ liệu' }
          }
        }
        return { ok: true, data: [] }
      }
    })

    render(<HistoryPage />)
    expect(await screen.findByText('Page1 Row #1')).toBeTruthy()

    // Bấm nút chuyển sang trang 2 qua giao diện UI
    const nextBtn = screen.getByTitle('Trang kế')
    fireEvent.click(nextBtn.querySelector('button') ?? nextBtn)

    // Trang 2 bị lỗi: hiển thị Alert thông báo lỗi
    expect(await screen.findByText('Mất kết nối cơ sở dữ liệu')).toBeTruthy()
    expect(screen.getByText(strings.history.loadFailed)).toBeTruthy()

    // CÁC DÒNG CỦA TRANG 1 PHẢI ĐƯỢC XÓA KHỎI BẢNG, KHÔNG ĐƯỢC TRÌNH BÀY NHƯ KẾT QUẢ TRANG 2
    expect(screen.queryByText('Page1 Row #1')).toBeNull()
    expect(screen.queryByText('Page1 Row #20')).toBeNull()

    // Nút Thử lại hoạt động và gọi lại trang 2
    const retryBtn = screen.getByRole('button', { name: strings.history.retry })
    fireEvent.click(retryBtn)
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith(
        'history:list',
        expect.objectContaining({ offset: 20, limit: 21 })
      )
    )
  })

  it('thao tac bam qua cac trang tren UI de thay dong #201 ma khong goi mock IPC truc tiep', async () => {
    // Tạo 210 dòng dữ liệu để qua 11 trang (mỗi trang 20 dòng, trang 11 chứa dòng 201-210)
    const all210Rows = Array.from({ length: 210 }, (_, i) => ({
      id: i + 1,
      ts: '2026-08-19T10:00:00Z',
      action: 'deploy',
      status: 'success' as const,
      message: `Sequential Log #${i + 1}`,
      vps_id: 1,
      app_id: 1,
      deployment_id: i + 1,
      detail_json: null
    }))

    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async (filter) => {
        const f = filter as { offset: number; limit: number }
        const offset = f.offset || 0
        const limit = f.limit || 21
        return { ok: true, data: all210Rows.slice(offset, offset + limit) }
      }
    })

    render(<HistoryPage />)
    expect(await screen.findByText('Sequential Log #1')).toBeTruthy()

    // Bấm liên tiếp qua các trang bằng nút Trang kế trên UI, không gọi trực tiếp invoke
    for (let pageNum = 1; pageNum < 11; pageNum++) {
      const nextBtn = screen.getByTitle('Trang kế')
      fireEvent.click(nextBtn.querySelector('button') ?? nextBtn)
      // Chờ dòng đầu tiên của trang kế tiếp hiển thị trên bảng
      await screen.findByText(`Sequential Log #${pageNum * 20 + 1}`)
    }

    // Đã tới trang 11 qua 10 lần bấm nút Trang kế trên UI
    expect(await screen.findByText('Sequential Log #201')).toBeTruthy()
    expect(screen.getByText('Sequential Log #210')).toBeTruthy()
  })

  it('neu du lieu thay doi khien trang hien tai rong thi cho nguoi dung quay ve trang truoc', async () => {
    let page2HasData = true
    const page1Rows = Array.from({ length: 21 }, (_, i) => ({
      id: i + 1,
      ts: '2026-08-19T10:00:00Z',
      action: 'deploy',
      status: 'success' as const,
      message: `Initial Page1 #${i + 1}`,
      vps_id: 1,
      app_id: 1,
      deployment_id: i + 1,
      detail_json: null
    }))

    const page2Rows = [
      {
        id: 21,
        ts: '2026-08-19T09:00:00Z',
        action: 'deploy',
        status: 'success' as const,
        message: 'Initial Page2 #21',
        vps_id: 1,
        app_id: 1,
        deployment_id: 21,
        detail_json: null
      }
    ]

    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async (filter) => {
        const f = filter as { offset: number }
        if (f.offset === 0) return { ok: true, data: page1Rows }
        if (f.offset === 20) {
          return { ok: true, data: page2HasData ? page2Rows : [] }
        }
        return { ok: true, data: [] }
      }
    })

    render(<HistoryPage />)
    expect(await screen.findByText('Initial Page1 #1')).toBeTruthy()

    // Bấm sang trang 2
    const nextBtn = screen.getByTitle('Trang kế')
    fireEvent.click(nextBtn.querySelector('button') ?? nextBtn)
    expect(await screen.findByText('Initial Page2 #21')).toBeTruthy()

    // Giả lập dữ liệu bị xóa trên backend khiến trang 2 trở nên rỗng khi làm mới
    page2HasData = false
    const refreshBtn = screen.getByRole('button', { name: /Làm mới|Refresh/ })
    fireEvent.click(refreshBtn)

    // Bảng hiển thị thông báo trang rỗng và nút cho người dùng quay về trang trước
    expect(await screen.findByText(strings.history.emptyPage)).toBeTruthy()
    const backBtn = screen.getByRole('button', { name: strings.history.pagination.prevPageAction })
    expect(backBtn).toBeTruthy()

    // Người dùng bấm quay về trang trước
    fireEvent.click(backBtn)

    // Trang 1 được nạp lại và các dòng của trang 1 xuất hiện
    expect(await screen.findByText('Initial Page1 #1')).toBeTruthy()
  })

  it('khi doi bo loc thi quay ve trang dau', async () => {
    const page1Rows = Array.from({ length: 21 }, (_, i) => ({
      id: i + 1,
      ts: `2026-08-19T10:00:00Z`,
      action: 'deploy',
      status: 'success' as const,
      message: `Row #${i + 1}`,
      vps_id: 1,
      app_id: 1,
      deployment_id: i + 1,
      detail_json: null
    }))

    const page2Rows = [
      {
        id: 21,
        ts: '2026-08-19T09:00:00Z',
        action: 'deploy',
        status: 'success' as const,
        message: 'Row #21',
        vps_id: 1,
        app_id: 1,
        deployment_id: 21,
        detail_json: null
      }
    ]

    const invoke = mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'history:list': async (filter) => {
        const f = filter as { offset: number; actions?: string[] }
        if (f.actions && f.actions.includes('deploy')) {
          return { ok: true, data: [page1Rows[0]] }
        }
        if (f.offset === 20) return { ok: true, data: page2Rows }
        return { ok: true, data: page1Rows }
      }
    })

    render(<HistoryPage />)
    await screen.findByText('Row #1')

    // Chuyển sang trang 2
    const nextBtn = screen.getByTitle('Trang kế')
    fireEvent.click(nextBtn.querySelector('button') ?? nextBtn)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('history:list', expect.objectContaining({ offset: 20 }))
    )

    // Đổi bộ lọc hành động sang 'deploy'
    const actionSelect = document.querySelector('.ant-select-multiple')
    if (!actionSelect) throw new Error('khong tim thay select hanh dong')
    fireEvent.mouseDown(actionSelect.querySelector('.ant-select-selector') as HTMLElement)
    await waitFor(() => expect(document.querySelector('.ant-select-dropdown')).toBeTruthy())
    const dropdown = document.querySelector('.ant-select-dropdown')
    if (!dropdown) throw new Error('dropdown khong mo')
    fireEvent.click(within(dropdown as HTMLElement).getByText('Triển khai'))

    // Xác nhận khi đổi bộ lọc, trang quay về trang đầu (offset = 0)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'history:list',
        expect.objectContaining({ actions: ['deploy'], offset: 0, limit: 21 })
      )
    )
  })

  it('ngan phan hoi cu ghi de ket qua bo loc moi (chong race condition)', async () => {
    let resolveFirstQuery!: (value: unknown) => void
    const firstPromise = new Promise((resolve) => {
      resolveFirstQuery = resolve
    })

    const staleRow: ActionLogEntry = {
      id: 999,
      ts: '2026-08-19T10:00:00Z',
      action: 'scan',
      status: 'success',
      message: 'STALE SCAN RESULT FROM OLD FILTER',
      vps_id: 1,
      app_id: null,
      deployment_id: null,
      detail_json: null
    }

    const freshRow: ActionLogEntry = {
      id: 888,
      ts: '2026-08-19T10:05:00Z',
      action: 'deploy',
      status: 'success',
      message: 'FRESH DEPLOY RESULT FROM NEW FILTER',
      vps_id: 1,
      app_id: 1,
      deployment_id: 1,
      detail_json: null
    }

    const VPS_B: Vps = { ...VPS_A, id: 2, name: 'VM02', host: '203.0.113.56' }

    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'history:list': async (filter) => {
        const f = filter as { vps_id?: number }
        if (f.vps_id === 1) {
          // Yêu cầu filter VPS 1 bị delay
          await firstPromise
          return { ok: true, data: [staleRow] }
        }
        if (f.vps_id === 2) {
          // Yêu cầu filter VPS 2 phản hồi ngay
          return { ok: true, data: [freshRow] }
        }
        return { ok: true, data: [] }
      }
    })

    render(<HistoryPage />)
    await screen.findByText(strings.history.title)

    // 1. Chọn filter Máy chủ 1 (yêu cầu 1, đang bị treo bởi firstPromise)
    const vpsSelect = document.querySelectorAll('.ant-select')[1]
    if (!vpsSelect) throw new Error('khong tim thay select vps')
    fireEvent.mouseDown(vpsSelect.querySelector('.ant-select-selector') as HTMLElement)
    await waitFor(() => expect(document.querySelector('.ant-select-dropdown')).toBeTruthy())
    let dropdown = document.querySelector('.ant-select-dropdown')
    if (!dropdown) throw new Error('dropdown khong mo')
    fireEvent.click(within(dropdown as HTMLElement).getByText('VM01 — 203.0.113.55'))

    // 2. Ngay sau đó, người dùng đổi ý và chọn Máy chủ 2 (yêu cầu 2)
    fireEvent.mouseDown(vpsSelect.querySelector('.ant-select-selector') as HTMLElement)
    dropdown = document.querySelector('.ant-select-dropdown')
    if (!dropdown) throw new Error('dropdown khong mo')
    fireEvent.click(within(dropdown as HTMLElement).getByText('VM02 — 203.0.113.56'))

    // Kết quả mới từ filter VPS 2 hiển thị
    expect(await screen.findByText('FRESH DEPLOY RESULT FROM NEW FILTER')).toBeTruthy()

    // 3. Bây giờ yêu cầu 1 cũ mới hoàn thành và trả về
    resolveFirstQuery(null)
    await new Promise((r) => setTimeout(r, 50))

    // Kết quả cũ 'STALE SCAN RESULT FROM OLD FILTER' không được phép ghi đè lên kết quả mới
    expect(screen.queryByText('STALE SCAN RESULT FROM OLD FILTER')).toBeNull()
    expect(screen.getByText('FRESH DEPLOY RESULT FROM NEW FILTER')).toBeTruthy()
  })
})
