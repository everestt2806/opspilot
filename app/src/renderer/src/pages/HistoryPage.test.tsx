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
        limit: 200,
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

    // Reset về vi
    useUiState.setState({ locale: 'vi' })
  })
})
