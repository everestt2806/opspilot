// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionLogEntry, App, Vps } from '@shared/ipc'

import { DashboardPage } from './DashboardPage'

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
    message: 'Deploy xong bản v7.',
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
    message: 'Rollback thất bại.'
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

function statCard(label: string): HTMLElement {
  const title = screen.getByText(label)
  const card = title.closest('.ant-card')
  if (!card || !(card instanceof HTMLElement)) {
    throw new Error(`Khong tim thay card cua "${label}"`)
  }
  return card
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DashboardPage', () => {
  it('hien thi thong ke tong quan va bang hoat dong gan day', async () => {
    const invoke = mockApi(happyHandlers)
    render(<DashboardPage onOpenVps={() => {}} onOpenDeploy={() => {}} />)

    await screen.findByText('Tổng quan')

    expect(within(statCard('VPS online')).getByText('1')).toBeTruthy()
    expect(within(statCard('App đang chạy')).getByText('1')).toBeTruthy()
    expect(within(statCard('Deploy 24 giờ')).getByText('2')).toBeTruthy()
    expect(within(statCard('Deploy gần nhất')).getByText(/trước|vừa xong/)).toBeTruthy()

    expect(screen.getAllByText('Deploy xong bản v7.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rollback thất bại.').length).toBeGreaterThan(0)
    expect(screen.getByText('Deploy')).toBeTruthy()
    expect(screen.getByText('Rollback tự động')).toBeTruthy()
    expect(screen.getByText('Thành công')).toBeTruthy()
    expect(screen.getByText('Thất bại')).toBeTruthy()
    expect(screen.getByText('Đã huỷ')).toBeTruthy()

    expect(invoke).toHaveBeenCalledWith('history:list', { limit: 10, offset: 0 })
    expect(invoke).toHaveBeenCalledWith(
      'history:list',
      expect.objectContaining({ actions: ['deploy'], limit: 200, offset: 0 })
    )
  })

  it('khong co VPS thi hien empty state va nap sang man VPS', async () => {
    const onOpenVps = vi.fn()
    mockApi({
      ...happyHandlers,
      'vps:list': async () => ({ ok: true, data: [] })
    })
    render(<DashboardPage onOpenVps={onOpenVps} />)

    expect(
      await screen.findByText('Chưa có VPS nào. Thêm VPS đầu tiên để bắt đầu deploy.')
    ).toBeTruthy()
    fireEvent.click(screen.getByText('Thêm VPS'))
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
    fireEvent.click(screen.getByText('Thử lại'))
    expect(await screen.findByText('Tổng quan')).toBeTruthy()
  })
})
