// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App as AntApp } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App, Deployment, Vps } from '@shared/ipc'
import { AppsPage } from './AppsPage'
import { useUiState } from '../store/uiState'

const VPS_1: Vps = {
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
  last_seen_at: '2026-08-19T00:00:00Z',
  created_at: '2026-08-19T00:00:00Z'
}

const APP_1: App = {
  id: 10,
  vps_id: 1,
  name: 'my-express-app',
  framework: 'express',
  host_port: 30000,
  container_port: 3000,
  healthcheck_path: '/health',
  needs_db: 0,
  current_deployment_id: 101,
  url: 'http://203.0.113.55:30000'
}

const APP_2: App = {
  id: 20,
  vps_id: 1,
  name: 'my-next-blog',
  framework: 'nextjs',
  host_port: 30001,
  container_port: 3000,
  healthcheck_path: '/api/health',
  needs_db: 0,
  current_deployment_id: 201,
  url: 'http://203.0.113.55:30001'
}

const DEPLOYMENT_ACTIVE: Deployment = {
  id: 101,
  app_id: 10,
  version: 2,
  image_tag: 'my-express-app:v2',
  status: 'running',
  failed_step: null,
  build_duration_ms: 12000,
  total_duration_ms: 25000,
  is_rollback_of: null,
  started_at: '2026-08-19T10:00:00Z',
  finished_at: '2026-08-19T10:00:25Z',
  exposure_status: 'degraded',
  exposure_evidence_json: 'Cổng 30000 bị UFW chặn'
}

const DEPLOYMENT_PAST: Deployment = {
  id: 100,
  app_id: 10,
  version: 1,
  image_tag: 'my-express-app:v1',
  status: 'running',
  failed_step: null,
  build_duration_ms: 10000,
  total_duration_ms: 20000,
  is_rollback_of: null,
  started_at: '2026-08-18T10:00:00Z',
  finished_at: '2026-08-18T10:00:20Z',
  exposure_status: 'reachable',
  exposure_evidence_json: null
}

function mockApi(customHandlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {}): {
  invoke: ReturnType<typeof vi.fn>
} {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    'vps:list': async () => ({ ok: true, data: [VPS_1] }),
    'app:list': async () => ({ ok: true, data: [APP_1, APP_2] }),
    'app:versions': async () => ({ ok: true, data: [DEPLOYMENT_ACTIVE, DEPLOYMENT_PAST] }),
    'doctor:diagnose': async () => ({
      ok: true,
      data: {
        code: 'PORT_BLOCKED_UFW',
        title: 'Mở cổng UFW 30000',
        confidence: 'high',
        evidence: ['Cổng 30000 bị UFW chặn'],
        fix_id: 'fix_ufw_port',
        verify_probe: 'external',
        safe_to_auto_fix: true,
        abstained: false
      }
    }),
    'doctor:fix': async () => ({
      ok: true,
      data: {
        status: 'verified',
        message: 'Đã mở cổng 30000 thành công',
        exposure_status: 'reachable'
      }
    }),
    'app:rollback': async () => ({
      ok: true,
      data: { deployment_id: 102 }
    }),
    ...customHandlers
  }

  const invoke = vi.fn((channel: string, ...args: unknown[]) => {
    const h = handlers[channel]
    if (!h) return Promise.reject(new Error(`No handler for channel ${channel}`))
    return h(...args)
  })

  vi.stubGlobal('api', {
    invoke,
    on: () => () => {}
  })

  return { invoke }
}

describe('AppsPage — real IPC and multi-language', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUiState.setState({ locale: 'vi' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tải danh sách app từ app:list, lọc theo tìm kiếm và hiển thị thông tin thực tế', async () => {
    const { invoke } = mockApi()

    render(
      <AntApp>
        <AppsPage />
      </AntApp>
    )

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list'))
    expect((await screen.findAllByText('my-express-app')).length).toBeGreaterThan(0)
    expect(screen.getByText('my-next-blog')).toBeTruthy()

    // Tìm kiếm app
    const search = screen.getByPlaceholderText(/Tìm ứng dụng/)
    fireEvent.change(search, { target: { value: 'next' } })
    const sidebar = screen.getByRole('complementary')
    expect(within(sidebar).queryByText('my-express-app')).toBeNull()
    expect(within(sidebar).getByText('my-next-blog')).toBeTruthy()
  })

  it('hiển thị Exposure thật từ deployment và thực hiện Doctor diagnose / fix theo dữ liệu thật', async () => {
    const { invoke } = mockApi()

    render(
      <AntApp>
        <AppsPage />
      </AntApp>
    )

    expect(
      await screen.findByText(/Cổng ngoài đang bị suy giảm/, {}, { timeout: 10000 })
    ).toBeTruthy()
    expect(screen.getByText('Cổng 30000 bị UFW chặn')).toBeTruthy()

    // Bấm Chẩn đoán với Doctor
    const diagnoseBtn = screen.getByText('Chẩn đoán với Doctor')
    fireEvent.click(diagnoseBtn)

    await waitFor(
      () =>
        expect(invoke).toHaveBeenCalledWith(
          'doctor:diagnose',
          expect.objectContaining({
            deployment_id: 101
          })
        ),
      { timeout: 10000 }
    )

    // Nút Safe auto-fix xuất hiện
    const autoFixBtn = await screen.findByText('Tự sửa lỗi an toàn', {}, { timeout: 10000 })
    expect(autoFixBtn).toBeTruthy()

    // Bấm Safe auto-fix
    fireEvent.click(autoFixBtn)
    await waitFor(
      () =>
        expect(invoke).toHaveBeenCalledWith('doctor:fix', {
          fix_id: 'fix_ufw_port',
          deployment_id: 101
        }),
      { timeout: 10000 }
    )

    // Chờ fix thành công và banner hiển thị thông báo kết quả
    await waitFor(
      () => {
        expect(screen.queryByText('Tự sửa lỗi an toàn')).toBeNull()
        expect(screen.getByText(/Đã mở cổng 30000 thành công/)).toBeTruthy()
      },
      { timeout: 10000 }
    )
  })

  it('rollback thật: mở modal, yêu cầu gõ tên app và gọi app:rollback thật', async () => {
    const { invoke } = mockApi()

    render(
      <AntApp>
        <AppsPage />
      </AntApp>
    )

    // Chuyển sang tab Lịch sử phiên bản
    fireEvent.click(await screen.findByRole('tab', { name: /Lịch sử phiên bản/ }))

    // Nút Rollback ở phiên bản v1
    const rollbackBtn = (await screen.findAllByRole('button', { name: /Rollback/ }))[0]
    fireEvent.click(rollbackBtn)

    expect(screen.getAllByText('Xác nhận rollback').length).toBeGreaterThan(0)
    const confirmBtn = screen.getByRole('button', {
      name: 'Xác nhận rollback'
    }) as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)

    // Điền sai tên app -> vẫn disabled
    const input = screen.getByPlaceholderText('my-express-app')
    fireEvent.change(input, { target: { value: 'sai-ten' } })
    expect(confirmBtn.disabled).toBe(true)

    // Điền đúng tên app -> enabled
    fireEvent.change(input, { target: { value: 'my-express-app' } })
    expect(confirmBtn.disabled).toBe(false)

    // Bấm xác nhận rollback
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:rollback', 10, 100))
  })

  it('đổi ngôn ngữ theo bốn ngôn ngữ và cập nhật nội dung AppsPage', async () => {
    mockApi()

    const { rerender } = render(
      <AntApp>
        <AppsPage />
      </AntApp>
    )

    // 1. Tiếng Việt
    expect((await screen.findAllByText('Ứng dụng')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Tổng quan')).toBeTruthy()
    expect(screen.getByText('Lịch sử phiên bản')).toBeTruthy()

    // 2. English
    act(() => {
      useUiState.setState({ locale: 'en' })
    })
    rerender(
      <AntApp>
        <AppsPage />
      </AntApp>
    )
    expect((await screen.findAllByText('Applications')).length).toBeGreaterThan(0)
    expect(screen.getByText('Overview')).toBeTruthy()
    expect(screen.getByText('Version history')).toBeTruthy()

    // 3. 简体中文
    act(() => {
      useUiState.setState({ locale: 'cn' })
    })
    rerender(
      <AntApp>
        <AppsPage />
      </AntApp>
    )
    expect((await screen.findAllByText('应用程序')).length).toBeGreaterThan(0)
    expect(screen.getByText('运行总览')).toBeTruthy()
    expect(screen.getByText('版本历史')).toBeTruthy()

    // 4. 日本語
    act(() => {
      useUiState.setState({ locale: 'jp' })
    })
    rerender(
      <AntApp>
        <AppsPage />
      </AntApp>
    )
    expect((await screen.findAllByText('アプリ一覧')).length).toBeGreaterThan(0)
    expect(screen.getByText('概要')).toBeTruthy()
    expect(screen.getByText('バージョン履歴')).toBeTruthy()
  })

  it('khi chuyển app: xóa trạng thái Doctor/rollback cũ, đóng modal rollback, hiển thị loading', async () => {
    mockApi()

    render(
      <AntApp>
        <AppsPage />
      </AntApp>
    )

    // Khởi tạo: APP_1 (id: 10) hoàn tất tải, hiển thị v2 và alert suy giảm của APP_1
    expect(await screen.findByText('v2', {}, { timeout: 10000 })).toBeTruthy()
    expect(
      await screen.findByText(/Cổng ngoài đang bị suy giảm/, {}, { timeout: 10000 })
    ).toBeTruthy()

    // Bấm Chẩn đoán với Doctor trên APP_1 để tạo state Doctor
    const diagnoseBtn = screen.getByText('Chẩn đoán với Doctor')
    fireEvent.click(diagnoseBtn)
    expect(await screen.findByText('Tự sửa lỗi an toàn', {}, { timeout: 10000 })).toBeTruthy()

    // Chuyển sang tab Lịch sử phiên bản và mở modal Rollback
    fireEvent.click(screen.getByRole('tab', { name: /Lịch sử phiên bản/ }))
    const rollbackBtn = (await screen.findAllByRole('button', { name: /Rollback/ }))[0]
    fireEvent.click(rollbackBtn)
    expect(screen.getAllByText('Xác nhận rollback').length).toBeGreaterThan(0)

    // Người dùng bấm chuyển sang APP_2 (id: 20)
    const nextAppBtn = screen.getByRole('option', { name: /my-next-blog/ })
    fireEvent.click(nextAppBtn)

    // Khi vừa chuyển app:
    // - Modal Rollback cũ bị đóng ngay lập tức
    expect(screen.queryByRole('dialog')).toBeNull()
    // - Nút Safe auto-fix bị xóa ngay lập tức
    expect(screen.queryByText('Tự sửa lỗi an toàn')).toBeNull()
    // - Alert suy giảm cũ của APP_1 bị xóa
    expect(screen.queryByText(/Cổng ngoài đang bị suy giảm/)).toBeNull()
    // - Deployment A không còn được hiển thị (bỏ fallback)
    expect(screen.queryByText('v2')).toBeNull()
  })

  it('chuyển app A→B với response trả sai thứ tự: request A thực sự đang pending trước khi chuyển B, response B đến trước, response A đến muộn bị bỏ qua', async () => {
    let resolveApp1Versions: (value: unknown) => void = () => {}
    let resolveApp2Versions: (value: unknown) => void = () => {}

    const DEPLOYMENT_APP_2: Deployment = {
      id: 201,
      app_id: 20,
      version: 5,
      image_tag: 'my-next-blog:v5',
      status: 'running',
      failed_step: null,
      build_duration_ms: 8000,
      total_duration_ms: 18000,
      is_rollback_of: null,
      started_at: '2026-08-20T10:00:00Z',
      finished_at: '2026-08-20T10:00:18Z',
      exposure_status: 'reachable',
      exposure_evidence_json: null
    }

    mockApi({
      'app:versions': async (appId: unknown) => {
        if (appId === 10) {
          return new Promise((resolve) => {
            resolveApp1Versions = resolve
          })
        }
        if (appId === 20) {
          return new Promise((resolve) => {
            resolveApp2Versions = resolve
          })
        }
        return { ok: true, data: [] }
      }
    })

    render(
      <AntApp>
        <AppsPage />
      </AntApp>
    )

    // Khởi tạo: app 10 được chọn tự động, request app:versions(10) thực sự đang pending
    await waitFor(() => {
      expect(document.querySelectorAll('.ant-spin').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('v2')).toBeNull()
    expect(screen.queryByText('v5')).toBeNull()

    // Khi request A đang pending, người dùng bấm chuyển sang APP_2 (id: 20)
    const nextAppBtn = await screen.findByRole('option', { name: /my-next-blog/ })
    fireEvent.click(nextAppBtn)

    // Lúc này request B (id: 20) cũng được gửi và đang pending
    // Vẫn đang loading, chưa hiển thị deployment nào
    expect(document.querySelectorAll('.ant-spin').length).toBeGreaterThan(0)
    expect(screen.queryByText('v2')).toBeNull()
    expect(screen.queryByText('v5')).toBeNull()

    // Response B trả về trước
    await act(async () => {
      resolveApp2Versions({ ok: true, data: [DEPLOYMENT_APP_2] })
    })

    // B đã tải xong: hiển thị đúng deployment của B (v5)
    expect(await screen.findByText('v5', {}, { timeout: 10000 })).toBeTruthy()
    expect(screen.queryByText('v2')).toBeNull()

    // Giờ response A mới trả về muộn (sai thứ tự)
    await act(async () => {
      resolveApp1Versions({ ok: true, data: [DEPLOYMENT_ACTIVE, DEPLOYMENT_PAST] })
    })

    // Response A phải bị bỏ qua hoàn toàn:
    // - Không hiển thị v2 hoặc v1 của A
    expect(screen.queryByText('v2')).toBeNull()
    expect(screen.queryByText('v1')).toBeNull()
    expect(screen.queryByText(/Cổng ngoài đang bị suy giảm/)).toBeNull()
    // - Vẫn giữ nguyên deployment của B (v5)
    expect(screen.getByText('v5')).toBeTruthy()
  })

  it('kết quả Doctor chẩn đoán của A trả về sau khi B đã tải: bỏ qua fix ID và thông báo của A, không xuất hiện trên B', async () => {
    let resolveDoctorDiagnoseA: (value: unknown) => void = () => {}

    const DEPLOYMENT_APP_2: Deployment = {
      id: 201,
      app_id: 20,
      version: 5,
      image_tag: 'my-next-blog:v5',
      status: 'running',
      failed_step: null,
      build_duration_ms: 8000,
      total_duration_ms: 18000,
      is_rollback_of: null,
      started_at: '2026-08-20T10:00:00Z',
      finished_at: '2026-08-20T10:00:18Z',
      exposure_status: 'reachable',
      exposure_evidence_json: null
    }

    mockApi({
      'app:versions': async (appId: unknown) => {
        if (appId === 10) {
          return { ok: true, data: [DEPLOYMENT_ACTIVE, DEPLOYMENT_PAST] }
        }
        if (appId === 20) {
          return { ok: true, data: [DEPLOYMENT_APP_2] }
        }
        return { ok: true, data: [] }
      },
      'doctor:diagnose': async () => {
        return new Promise((resolve) => {
          resolveDoctorDiagnoseA = resolve
        })
      }
    })

    render(
      <AntApp>
        <AppsPage />
      </AntApp>
    )

    // Khởi tạo: APP_1 (id: 10) hoàn tất tải, hiển thị alert suy giảm và nút Chẩn đoán với Doctor
    expect(
      await screen.findByText(/Cổng ngoài đang bị suy giảm/, {}, { timeout: 10000 })
    ).toBeTruthy()
    const diagnoseBtn = screen.getByText('Chẩn đoán với Doctor')

    // Bấm Chẩn đoán với Doctor trên APP_1 -> request doctor:diagnose của A đang pending
    fireEvent.click(diagnoseBtn)

    // Trong khi doctor:diagnose của A đang pending, người dùng bấm chuyển sang APP_2 (id: 20)
    const nextAppBtn = screen.getByRole('option', { name: /my-next-blog/ })
    fireEvent.click(nextAppBtn)

    // Chờ APP_2 tải xong deployment v5 (exposure reachable)
    expect(await screen.findByText('v5', {}, { timeout: 10000 })).toBeTruthy()
    expect(screen.queryByText(/Cổng ngoài đang bị suy giảm/)).toBeNull()
    expect(screen.queryByText('Tự sửa lỗi an toàn')).toBeNull()

    // Bây giờ kết quả doctor:diagnose của A mới trả về (sau khi B đã tải)
    await act(async () => {
      resolveDoctorDiagnoseA({
        ok: true,
        data: {
          code: 'PORT_BLOCKED_UFW',
          title: 'Mở cổng UFW 30000 cho App A',
          confidence: 'high',
          evidence: ['Cổng 30000 bị UFW chặn'],
          fix_id: 'fix_ufw_port_A',
          verify_probe: 'external',
          safe_to_auto_fix: true,
          abstained: false
        }
      })
    })

    // Kết quả Doctor của A phải bị bỏ qua:
    // - Không hiển thị thông báo của A ("Mở cổng UFW 30000 cho App A")
    expect(screen.queryByText(/Mở cổng UFW 30000 cho App A/)).toBeNull()
    // - Không hiển thị nút auto-fix của A
    expect(screen.queryByText('Tự sửa lỗi an toàn')).toBeNull()
    // - Không phục hồi trạng thái doctor trên B
    expect(screen.queryByText(/Chẩn đoán với Doctor/)).toBeNull()
  })
})
