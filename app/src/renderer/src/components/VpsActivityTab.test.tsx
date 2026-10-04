// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionLogEntry } from '@shared/ipc'

import { useUiState } from '../store/uiState'
import { VpsActivityTab } from './VpsActivityTab'

const ENTRIES: ActionLogEntry[] = [
  {
    id: 1,
    ts: '2026-08-20T10:00:00Z',
    action: 'deploy',
    status: 'success',
    message: 'Deploy completed',
    vps_id: 1,
    app_id: 11,
    deployment_id: 101,
    detail_json: null
  },
  {
    id: 2,
    ts: '2026-08-20T09:00:00Z',
    action: 'scan',
    status: 'failed',
    message: 'SSH timeout',
    vps_id: 1,
    app_id: null,
    deployment_id: null,
    detail_json: null
  }
]

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

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VpsActivityTab — bản địa hóa 4 ngôn ngữ', () => {
  it('tiếng Việt (vi): cột, action, status đều được dịch; không còn "Time", "Action", "Success"', async () => {
    useUiState.setState({ locale: 'vi' })
    mockApi({
      'history:list': async () => ({ ok: true, data: ENTRIES })
    })

    render(<VpsActivityTab vpsId={1} />)

    // Tiêu đề cột tiếng Việt
    expect(await screen.findByText('Thời gian')).toBeTruthy()
    expect(screen.getByText('Thao tác')).toBeTruthy()
    expect(screen.getByText('Trạng thái')).toBeTruthy()
    expect(screen.getByText('Thông điệp')).toBeTruthy()

    // Không còn từ tiếng Anh trong bảng
    expect(screen.queryByText('Time')).toBeNull()
    expect(screen.queryByText('Action')).toBeNull()
    expect(screen.queryByText('Success')).toBeNull()

    // Action và status bản địa hóa
    expect(screen.getByText('Triển khai')).toBeTruthy()
    expect(screen.getByText('Quét môi trường')).toBeTruthy()
    expect(screen.getByText('Thành công')).toBeTruthy()
    expect(screen.getByText('Thất bại')).toBeTruthy()
  })

  it('English (en): cột Time, Action, Status, Deploy, Success', async () => {
    useUiState.setState({ locale: 'en' })
    mockApi({
      'history:list': async () => ({ ok: true, data: ENTRIES })
    })

    render(<VpsActivityTab vpsId={1} />)

    expect(await screen.findByText('Time')).toBeTruthy()
    expect(screen.getByText('Action')).toBeTruthy()
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getByText('Message')).toBeTruthy()

    expect(screen.getByText('Deploy')).toBeTruthy()
    expect(screen.getByText('Environment scan')).toBeTruthy()
    expect(screen.getByText('Success')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('简体中文 (cn): 时间, 操作, 状态, 信息, 部署, 成功', async () => {
    useUiState.setState({ locale: 'cn' })
    mockApi({
      'history:list': async () => ({ ok: true, data: ENTRIES })
    })

    render(<VpsActivityTab vpsId={1} />)

    expect(await screen.findByText('时间')).toBeTruthy()
    expect(screen.getByText('操作')).toBeTruthy()
    expect(screen.getByText('状态')).toBeTruthy()
    expect(screen.getByText('信息')).toBeTruthy()

    expect(screen.getByText('部署')).toBeTruthy()
    expect(screen.getByText('环境检查')).toBeTruthy()
    expect(screen.getByText('成功')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
  })

  it('日本語 (jp): 日時, 操作, ステータス, メッセージ, デプロイ, 成功', async () => {
    useUiState.setState({ locale: 'jp' })
    mockApi({
      'history:list': async () => ({ ok: true, data: ENTRIES })
    })

    render(<VpsActivityTab vpsId={1} />)

    expect(await screen.findByText('日時')).toBeTruthy()
    expect(screen.getByText('操作')).toBeTruthy()
    expect(screen.getByText('ステータス')).toBeTruthy()
    expect(screen.getByText('メッセージ')).toBeTruthy()

    expect(screen.getByText('デプロイ')).toBeTruthy()
    expect(screen.getByText('環境スキャン')).toBeTruthy()
    expect(screen.getByText('成功')).toBeTruthy()
    expect(screen.getByText('失敗')).toBeTruthy()
  })
})
