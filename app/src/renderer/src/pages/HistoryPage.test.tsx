// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionLogEntry, Vps } from '@shared/ipc'

import { HistoryPage } from './HistoryPage'

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
    message: 'Deploy xong bản v7.',
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
    message: 'Rollback thất bại.',
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

describe('HistoryPage', () => {
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
    expect((await screen.findAllByText('Deploy xong bản v7.')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Rollback thất bại.')).length).toBeGreaterThan(0)
    expect(screen.getByText('Rollback tự động')).toBeTruthy()

    fireEvent.click(screen.getByRole('row', { name: /Deploy xong bản v7\./ }))
    expect(await screen.findByText('Chi tiết hoạt động')).toBeTruthy()
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

    expect(await screen.findByText('Không tải được lịch sử.')).toBeTruthy()
    expect(screen.getByText('Khong doc duoc DB.')).toBeTruthy()
    fireEvent.click(screen.getByText('Thử lại'))
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
    fireEvent.click(within(dropdown as HTMLElement).getByText('Deploy'))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'history:list',
        expect.objectContaining({ actions: ['deploy'] })
      )
    )
  })
})
