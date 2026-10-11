// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App, Deployment } from '@shared/ipc'
import { VpsAppsTab } from './VpsAppsTab'

function mockApi(handlers: Record<string, (...args: unknown[]) => Promise<unknown>>): void {
  window.api = {
    invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'vps:discover-apps' && !handlers[channel]) {
        return { ok: true, data: [] }
      }
      const handler = handlers[channel]
      if (!handler) {
        throw new Error(`Unhandled mock channel: ${channel}`)
      }
      return handler(...args)
    }),
    on: vi.fn(() => () => {})
  } as unknown as typeof window.api
}

const APP_MATCHING: App = {
  id: 1,
  vps_id: 10,
  name: 'app-matched',
  framework: 'express',
  host_port: 3001,
  container_port: 3000,
  healthcheck_path: '/health',
  needs_db: 0,
  current_deployment_id: 101,
  url: 'http://10.0.0.1:3001'
}

const APP_MISMATCHED: App = {
  id: 2,
  vps_id: 10,
  name: 'app-mismatched',
  framework: 'nextjs',
  host_port: 3002,
  container_port: 3000,
  healthcheck_path: '/',
  needs_db: 0,
  current_deployment_id: 999, // Không tồn tại trong danh sách versions
  url: 'http://10.0.0.1:3002'
}

const APP_NO_DEPLOYMENT: App = {
  id: 3,
  vps_id: 10,
  name: 'app-no-deploy',
  framework: 'static-spa',
  host_port: 3003,
  container_port: 80,
  healthcheck_path: '/',
  needs_db: 0,
  current_deployment_id: null,
  url: 'http://10.0.0.1:3003'
}

const VERSIONS: Deployment[] = [
  {
    id: 102,
    app_id: 2,
    version: 5,
    image_tag: 'v5',
    status: 'running',
    failed_step: null,
    build_duration_ms: 1000,
    total_duration_ms: 2000,
    is_rollback_of: null,
    started_at: '2026-10-01T00:00:00Z',
    finished_at: '2026-10-01T00:01:00Z',
    exposure_status: 'reachable',
    exposure_evidence_json: null
  },
  {
    id: 101,
    app_id: 1,
    version: 3,
    image_tag: 'v3',
    status: 'running',
    failed_step: null,
    build_duration_ms: 1000,
    total_duration_ms: 2000,
    is_rollback_of: null,
    started_at: '2026-10-01T00:00:00Z',
    finished_at: '2026-10-01T00:01:00Z',
    exposure_status: 'reachable',
    exposure_evidence_json: null
  }
]

import { useUiState } from '../store/uiState'
import { getStrings } from '../strings'

describe('VpsAppsTab — quy tắc hiển thị deployment trung thực', () => {
  beforeEach(() => {
    useUiState.setState({ locale: 'vi' })
    mockApi({
      'app:list': async () => ({
        ok: true,
        data: [APP_MATCHING, APP_MISMATCHED, APP_NO_DEPLOYMENT]
      }),
      'app:versions': async (appId: unknown) => {
        if (appId === 1) return { ok: true, data: [VERSIONS[1]] }
        if (appId === 2) return { ok: true, data: [VERSIONS[0]] }
        return { ok: true, data: [] }
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('chỉ dùng đúng current_deployment_id, đổi nhãn trạng thái deployment thành "Ghi nhận: …" và dùng locale hiện tại', async () => {
    const { rerender } = render(<VpsAppsTab vpsId={10} />)

    // Chờ tải xong bảng app
    expect(await screen.findByText('app-matched')).toBeTruthy()
    expect(screen.getByText('app-mismatched')).toBeTruthy()
    expect(screen.getByText('app-no-deploy')).toBeTruthy()

    // 1. App 1 (khớp current_deployment_id = 101): hiển thị v3 và status "Ghi nhận: running (v3)"
    expect(screen.getByText('v3')).toBeTruthy()
    expect(screen.getByText('Ghi nhận: running (v3)')).toBeTruthy()

    // 2. App 2 (mismatch current_deployment_id = 999): KHÔNG được fallback sang v5, KHÔNG được ghi "Chưa triển khai", hiện "Không tìm thấy (#999)"
    expect(screen.queryByText('v5')).toBeNull()
    expect(screen.queryByText('#999')).toBeNull() // Không hiển thị ID trần giả vờ làm version
    expect(screen.getByText('Không tìm thấy (#999)')).toBeTruthy()

    // 3. App 3 (current_deployment_id === null): hiển thị "Chưa triển khai"
    expect(screen.getByText('Chưa triển khai')).toBeTruthy()

    // 4. Status của app-matched (running) KHÔNG được tô màu xanh (ant-tag-success)
    const runningTag = screen.getByText('Ghi nhận: running (v3)').closest('.ant-tag')
    expect(runningTag).toBeTruthy()
    expect(runningTag?.classList.contains('ant-tag-success')).toBe(false)

    // 5. Đổi locale sang 'en' -> nhãn đổi theo locale
    useUiState.setState({ locale: 'en' })
    rerender(<VpsAppsTab vpsId={10} />)
    expect(await screen.findByText('Recorded: running (v3)')).toBeTruthy()
    expect(screen.getByText('Record not found (#999)')).toBeTruthy()
    expect(screen.getByText('Not deployed')).toBeTruthy()
  })

  it('lỗi tải versions không được ghi "Chưa triển khai" nếu current_deployment_id có giá trị', async () => {
    mockApi({
      'app:list': async () => ({
        ok: true,
        data: [APP_MATCHING, APP_NO_DEPLOYMENT]
      }),
      'app:versions': async () => ({
        ok: false,
        error: { code: 'FAIL', message: 'Network timeout' }
      })
    })

    render(<VpsAppsTab vpsId={10} />)

    expect(await screen.findByText('app-matched')).toBeTruthy()
    expect(screen.getByText('app-no-deploy')).toBeTruthy()

    // App 1 có current_deployment_id = 101 nhưng lỗi versions -> KHÔNG được ghi "Chưa triển khai", hiện versionsLoadError
    const expectedError = getStrings('vi').apps.versionsLoadError
    expect(screen.getByText(expectedError)).toBeTruthy()
    const errorTag = screen.getByText(expectedError).closest('.ant-tag')
    expect(errorTag?.classList.contains('ant-tag-error')).toBe(true)

    // App 3 không có deployment (current_deployment_id = null) -> ghi "Chưa triển khai"
    expect(screen.getByText('Chưa triển khai')).toBeTruthy()
  })

  it('hiển thị container phát hiện trên VPS nhưng không cho thao tác quản lý khi thiếu hồ sơ', async () => {
    mockApi({
      'app:list': async () => ({ ok: true, data: [] }),
      'vps:discover-apps': async () => ({
        ok: true,
        data: [
          {
            name: 'legacy-app',
            image_tag: 'legacy-app:v4',
            version: 4,
            host_port: 32001,
            state: 'running'
          }
        ]
      })
    })

    render(<VpsAppsTab vpsId={10} />)

    expect(await screen.findByText('legacy-app')).toBeTruthy()
    expect(screen.getByText('Phát hiện trên VPS')).toBeTruthy()
    expect(screen.getByText('legacy-app:v4')).toBeTruthy()
    expect(screen.queryByText('Triển khai lại')).toBeNull()
  })
})
