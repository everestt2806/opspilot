// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App as AntApp } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App, Deployment, Vps } from '@shared/ipc'
import { AppsPage } from './AppsPage'
import { strings } from '../strings'
import { useUiState } from '../store/uiState'

const VPS_1: Vps = {
  id: 1,
  name: 'VM01',
  host: '203.0.113.55',
  port: 22,
  host_fingerprint: null,
  username: 'root',
  auth_type: 'password',
  provider: 'WiService',
  region: 'Hanoi',
  docker_version: '29.4.3',
  last_status: 'online',
  last_seen_at: '2026-08-19T00:00:00Z',
  created_at: '2026-08-19T00:00:00Z'
}

const VPS_2: Vps = {
  id: 2,
  name: 'VM02',
  host: '203.0.113.56',
  port: 22,
  host_fingerprint: null,
  username: 'root',
  auth_type: 'password',
  provider: 'WiService',
  region: 'Saigon',
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
  vps_id: 2,
  name: 'my-next-blog',
  framework: 'nextjs',
  host_port: 30001,
  container_port: 3000,
  healthcheck_path: '/api/health',
  needs_db: 0,
  current_deployment_id: 201,
  url: 'http://203.0.113.56:30001'
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
    'vps:list': async () => ({ ok: true, data: [VPS_1, VPS_2] }),
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

describe(
  'AppsPage — UI-1c full-width list, 3 horizontal tabs, honest status and real IPC',
  { timeout: 30000 },
  () => {
    beforeEach(() => {
      vi.clearAllMocks()
      useUiState.setState({ locale: 'vi', selectedAppId: null })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('tải danh sách app từ app:list, lọc kết hợp tìm kiếm và chọn VPS đồng thời (AND logic)', async () => {
      const { invoke } = mockApi()

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list'))
      expect(await screen.findByText('my-express-app')).toBeTruthy()
      expect(screen.getByText('my-next-blog')).toBeTruthy()

      // 1. Tìm kiếm theo tên app
      const search = screen.getByPlaceholderText(/Tìm ứng dụng/)
      fireEvent.change(search, { target: { value: 'next' } })
      expect(screen.queryByText('my-express-app')).toBeNull()
      expect(screen.getByText('my-next-blog')).toBeTruthy()

      // Xóa từ khóa tìm kiếm -> hiện lại cả hai
      fireEvent.change(search, { target: { value: '' } })
      expect(screen.getByText('my-express-app')).toBeTruthy()
      expect(screen.getByText('my-next-blog')).toBeTruthy()

      // 2. Lọc theo VPS dropdown: chọn VPS_1 (id: 1, VM01)
      const select = screen.getByRole('combobox')
      fireEvent.mouseDown(select)
      const optionVps1 =
        (await screen.findAllByText(/VM01 \(203\.0\.113\.55\)/)).find((el) =>
          el.classList.contains('ant-select-item-option-content')
        ) || (await screen.findAllByText(/VM01 \(203\.0\.113\.55\)/))[1]
      fireEvent.click(optionVps1)

      // Chỉ có my-express-app thuộc VPS_1
      expect(screen.getByText('my-express-app')).toBeTruthy()
      expect(screen.queryByText('my-next-blog')).toBeNull()

      // 3. Kết hợp AND: tìm từ khóa 'next' trong khi đang lọc VPS_1 -> kết quả rỗng
      fireEvent.change(search, { target: { value: 'next' } })
      expect(screen.queryByText('my-express-app')).toBeNull()
      expect(screen.queryByText('my-next-blog')).toBeNull()
    })

    it('chọn app để mở trang chi tiết toàn chiều rộng có nút quay lại và đúng 3 tab ngang', async () => {
      mockApi()

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // Đang ở màn hình danh sách, bấm vào app my-express-app
      const appLink = await screen.findByText('my-express-app')
      fireEvent.click(appLink)

      // Chuyển sang màn chi tiết:
      // Có nút quay lại
      const backBtn = await screen.findByRole('button', { name: /Quay lại danh sách/ })
      expect(backBtn).toBeTruthy()

      // Tiêu đề h3 hiển thị tên app
      expect(screen.getByRole('heading', { level: 3, name: 'my-express-app' })).toBeTruthy()

      // Đúng 3 tab ngang: Tổng quan, Lịch sử & Rollback, Bác sĩ & Exposure
      expect(screen.getByRole('tab', { name: /Tổng quan/ })).toBeTruthy()
      expect(screen.getByRole('tab', { name: /Lịch sử & Rollback/ })).toBeTruthy()
      expect(screen.getByRole('tab', { name: /Bác sĩ & Exposure/ })).toBeTruthy()

      // Chuyển sang tab Bác sĩ & Exposure
      fireEvent.click(screen.getByRole('tab', { name: /Bác sĩ & Exposure/ }))
      expect(await screen.findByText('Bằng chứng chẩn đoán')).toBeTruthy()

      // Bấm nút quay lại -> quay về danh sách ứng dụng
      fireEvent.click(backBtn)
      expect(await screen.findByPlaceholderText(/Tìm ứng dụng/)).toBeTruthy()
      expect(screen.getByText('my-express-app')).toBeTruthy()
      expect(screen.getByText('my-next-blog')).toBeTruthy()
    })

    it('hiển thị Exposure thật từ deployment và thực hiện Doctor diagnose / fix theo dữ liệu thật', async () => {
      const { invoke } = mockApi()
      useUiState.setState({ selectedAppId: 10 })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      expect(
        await screen.findByText(/Cổng ngoài đang bị suy giảm/, {}, { timeout: 10000 })
      ).toBeTruthy()
      expect(screen.getAllByText('Cổng 30000 bị UFW chặn').length).toBeGreaterThan(0)

      // Bấm Chẩn đoán với Doctor
      const diagnoseBtn = screen.getAllByRole('button', { name: /Chẩn đoán với Doctor/ })[0]
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
      const autoFixBtn = await screen.findByRole(
        'button',
        { name: /Tự sửa lỗi an toàn/ },
        { timeout: 10000 }
      )
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
          expect(screen.getAllByText(/Đã mở cổng 30000 thành công/).length).toBeGreaterThan(0)
        },
        { timeout: 10000 }
      )
    })

    it('rollback thật: mở modal, yêu cầu gõ tên app và gọi app:rollback thật', async () => {
      const { invoke } = mockApi()
      useUiState.setState({ selectedAppId: 10 })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // Chuyển sang tab Lịch sử & Rollback
      fireEvent.click(await screen.findByRole('tab', { name: /Lịch sử & Rollback/ }))

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

    it('đổi ngôn ngữ theo bốn ngôn ngữ và cập nhật nội dung AppsPage cả danh sách lẫn chi tiết', async () => {
      mockApi()
      useUiState.setState({ selectedAppId: 10 })

      const { rerender } = render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // 1. Tiếng Việt
      expect(await screen.findByText('Tổng quan')).toBeTruthy()
      expect(screen.getByText('Lịch sử & Rollback')).toBeTruthy()
      expect(screen.getByText('Bác sĩ & Exposure')).toBeTruthy()

      // 2. English
      act(() => {
        useUiState.setState({ locale: 'en' })
      })
      rerender(
        <AntApp>
          <AppsPage />
        </AntApp>
      )
      expect(screen.getByText('Overview')).toBeTruthy()
      expect(screen.getByText('History & Rollback')).toBeTruthy()
      expect(screen.getByText('Doctor & Exposure')).toBeTruthy()

      // 3. 简体中文
      act(() => {
        useUiState.setState({ locale: 'cn' })
      })
      rerender(
        <AntApp>
          <AppsPage />
        </AntApp>
      )
      expect(screen.getByText('运行总览')).toBeTruthy()
      expect(screen.getByText('历史与回滚')).toBeTruthy()
      expect(screen.getByText('Doctor 与公开检测')).toBeTruthy()

      // 4. 日本語
      act(() => {
        useUiState.setState({ locale: 'jp' })
      })
      rerender(
        <AntApp>
          <AppsPage />
        </AntApp>
      )
      expect(screen.getByText('概要')).toBeTruthy()
      expect(screen.getByText('履歴 & ロールバック')).toBeTruthy()
      expect(screen.getByText('ドクター & 公開診断')).toBeTruthy()
    })

    it('khi chuyển app: xóa trạng thái Doctor/rollback cũ, đóng modal rollback, hiển thị loading', async () => {
      mockApi()
      useUiState.setState({ selectedAppId: 10 })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // Khởi tạo: APP_1 (id: 10) hoàn tất tải, hiển thị v2 và alert suy giảm của APP_1
      expect(await screen.findByText('Ghi nhận: running (v2)', {}, { timeout: 10000 })).toBeTruthy()
      expect(
        await screen.findByText(/Cổng ngoài đang bị suy giảm/, {}, { timeout: 10000 })
      ).toBeTruthy()

      // Bấm Chẩn đoán với Doctor trên APP_1 để tạo state Doctor
      const diagnoseBtn = screen.getAllByRole('button', { name: /Chẩn đoán với Doctor/ })[0]
      fireEvent.click(diagnoseBtn)
      expect(
        await screen.findByRole('button', { name: /Tự sửa lỗi an toàn/ }, { timeout: 10000 })
      ).toBeTruthy()

      // Chuyển sang tab Lịch sử & Rollback và mở modal Rollback
      fireEvent.click(screen.getByRole('tab', { name: /Lịch sử & Rollback/ }))
      const rollbackBtn = (await screen.findAllByRole('button', { name: /Rollback/ }))[0]
      fireEvent.click(rollbackBtn)
      expect(screen.getAllByText('Xác nhận rollback').length).toBeGreaterThan(0)

      // Người dùng chuyển sang APP_2 (id: 20) qua nút quay lại rồi chọn App 2
      const backBtn = screen.getByRole('button', { name: /Quay lại danh sách/ })
      fireEvent.click(backBtn)
      const nextApp = await screen.findByText('my-next-blog')
      fireEvent.click(nextApp)

      // Khi vừa chuyển app:
      // - Modal Rollback cũ bị đóng ngay lập tức
      expect(screen.queryByRole('dialog')).toBeNull()
      // - Nút Safe auto-fix bị xóa ngay lập tức
      expect(screen.queryByRole('button', { name: /Tự sửa lỗi an toàn/ })).toBeNull()
      // - Alert suy giảm cũ của APP_1 bị xóa
      expect(screen.queryByText(/Cổng ngoài đang bị suy giảm/)).toBeNull()
      // - Deployment A không còn được hiển thị (bỏ fallback)
      expect(screen.queryByText('Ghi nhận: running (v2)')).toBeNull()
    }, 30000)

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

      useUiState.setState({ selectedAppId: 10 })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // Khởi tạo: app 10 được chọn, request app:versions(10) thực sự đang pending
      await waitFor(() => {
        expect(document.querySelectorAll('.ant-spin').length).toBeGreaterThan(0)
      })
      expect(screen.queryByText('v2')).toBeNull()
      expect(screen.queryByText('v5')).toBeNull()

      // Khi request A đang pending, người dùng chuyển sang APP_2 (id: 20)
      act(() => {
        useUiState.setState({ selectedAppId: 20 })
      })

      // Lúc này request B (id: 20) cũng được gửi và đang pending
      expect(document.querySelectorAll('.ant-spin').length).toBeGreaterThan(0)
      expect(screen.queryByText('v2')).toBeNull()
      expect(screen.queryByText('v5')).toBeNull()

      // Response B trả về trước
      await act(async () => {
        resolveApp2Versions({ ok: true, data: [DEPLOYMENT_APP_2] })
      })

      // B đã tải xong: hiển thị đúng deployment của B (v5)
      expect((await screen.findAllByText(/v5/, {}, { timeout: 10000 })).length).toBeGreaterThan(0)
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
      expect(screen.getAllByText(/v5/).length).toBeGreaterThan(0)
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

      useUiState.setState({ selectedAppId: 10 })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // Khởi tạo: APP_1 (id: 10) hoàn tất tải, hiển thị alert suy giảm và nút Chẩn đoán với Doctor
      expect(
        await screen.findByText(/Cổng ngoài đang bị suy giảm/, {}, { timeout: 10000 })
      ).toBeTruthy()
      const diagnoseBtn = screen.getAllByRole('button', { name: /Chẩn đoán với Doctor/ })[0]

      // Bấm Chẩn đoán với Doctor trên APP_1 -> request doctor:diagnose của A đang pending
      fireEvent.click(diagnoseBtn)

      // Trong khi doctor:diagnose của A đang pending, người dùng chuyển sang APP_2 (id: 20)
      act(() => {
        useUiState.setState({ selectedAppId: 20 })
      })

      // Chờ APP_2 tải xong deployment v5 (exposure reachable)
      expect((await screen.findAllByText(/v5/, {}, { timeout: 10000 })).length).toBeGreaterThan(0)
      expect(screen.queryByText(/Cổng ngoài đang bị suy giảm/)).toBeNull()
      expect(screen.queryByRole('button', { name: /Tự sửa lỗi an toàn/ })).toBeNull()

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
      expect(screen.queryByRole('button', { name: /Tự sửa lỗi an toàn/ })).toBeNull()
    })

    it('hiển thị trạng thái triển khai ghi nhận thay vì Healthy và không tự kết luận runtime sống', async () => {
      mockApi({
        'app:list': async () => ({
          ok: true,
          data: [APP_1, { ...APP_2, current_deployment_id: null }]
        })
      })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // Danh sách ứng dụng: hiện "Đã ghi nhận" và "Chưa triển khai"
      expect(await screen.findByText('Đã ghi nhận')).toBeTruthy()
      expect(screen.getByText('Chưa triển khai')).toBeTruthy()

      // Mở chi tiết App 1: ghi nhận running (v2), Exposure (lần publish)
      fireEvent.click(screen.getByText('my-express-app'))
      expect(await screen.findByText('Ghi nhận: running (v2)')).toBeTruthy()
      expect(screen.getByText('Bản triển khai ghi nhận')).toBeTruthy()
      expect(screen.getAllByText('Exposure (lần publish)').length).toBeGreaterThan(0)
    })

    it('app có deployment ID nhưng VPS target chưa kiểm tra gần đây (>24h) -> hiện cảnh báo vpsStaleNotice', async () => {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      const STALE_VPS: Vps = {
        ...VPS_1,
        last_seen_at: fourteenDaysAgo
      }

      mockApi({
        'vps:list': async () => ({ ok: true, data: [STALE_VPS] }),
        'app:list': async () => ({ ok: true, data: [APP_1] })
      })

      useUiState.setState({ selectedAppId: 10 })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      expect(await screen.findByText('Máy chủ chưa kiểm tra gần đây (>24h)')).toBeTruthy()
    })

    it('current deployment ID không tìm thấy trong lịch sử phiên bản -> không fallback vào deployments[0], hiện cảnh báo mismatch', async () => {
      const MISMATCH_APP: App = {
        ...APP_1,
        current_deployment_id: 999
      }

      mockApi({
        'app:list': async () => ({ ok: true, data: [MISMATCH_APP] })
      })

      useUiState.setState({ selectedAppId: 10 })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // Alert mismatch xuất hiện
      expect(
        (await screen.findAllByText('Bản triển khai hiện tại không có trong lịch sử')).length
      ).toBeGreaterThan(0)
      expect(
        screen.getByText('Bản ghi triển khai #999 không tìm thấy trong lịch sử phiên bản.')
      ).toBeTruthy()

      // Không fallback vào v2 hay v1 làm activeDeployment
      expect(screen.queryByText('Ghi nhận: running (v2)')).toBeNull()
    })

    it('kiểm tra runtime theo yêu cầu (app:runtime-inspect): lỗi hoặc timeout hiện Chưa xác minh, không đổi thành Healthy', async () => {
      let inspectResolve: (val: unknown) => void = () => {}
      const inspectPromise = new Promise((res) => {
        inspectResolve = res
      })

      const { invoke } = mockApi({
        'app:runtime-inspect': async () => inspectPromise
      })

      useUiState.setState({ selectedAppId: 10 })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // Bấm nút "Kiểm tra runtime"
      const inspectBtn = await screen.findByRole('button', { name: /Kiểm tra runtime/ })
      fireEvent.click(inspectBtn)

      expect(invoke).toHaveBeenCalledWith('app:runtime-inspect', 10)

      // Lỗi từ IPC runtime inspect
      await act(async () => {
        inspectResolve({
          ok: false,
          error: { code: 'SSH_TIMEOUT', message: 'SSH timeout 15s when running docker inspect' }
        })
      })

      // Hiện "Chưa xác minh", tuyệt đối không đổi thành Healthy
      expect(await screen.findByText('Chưa xác minh')).toBeTruthy()
      expect(screen.queryByText('Đang chạy · Healthy')).toBeNull()

      // Thử lại thành công -> Hiện "Live: running"
      mockApi({
        'app:runtime-inspect': async () => ({
          ok: true,
          data: { image: 'my-express-app:v2', state: 'running' }
        })
      })

      const retryBtn = screen.getByRole('button', {
        name: new RegExp(`${strings.apps.recheckLive}|${strings.common.retry}`)
      })
      fireEvent.click(retryBtn)

      expect(await screen.findByText('Live: running')).toBeTruthy()
    })

    it('runtime inspect trạng thái exited: hiển thị màu error (đỏ), không tô xanh success, có nút kiểm tra lại', async () => {
      mockApi({
        'app:runtime-inspect': async () => ({
          ok: true,
          data: { image: 'my-express-app:v2', state: 'exited' }
        })
      })

      useUiState.setState({ selectedAppId: 10 })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      const inspectBtn = await screen.findByRole('button', { name: /Kiểm tra runtime/ })
      fireEvent.click(inspectBtn)

      // Tag hiển thị Live: exited
      const stateTag = await screen.findByText('Live: exited')
      expect(stateTag).toBeTruthy()

      // Phải có class error (ant-tag-error), tuyệt đối không tô màu success
      const tagEl = stateTag.closest('.ant-tag')
      expect(tagEl?.classList.contains('ant-tag-error')).toBe(true)
      expect(tagEl?.classList.contains('ant-tag-success')).toBe(false)

      // Có nút "Kiểm tra lại"
      expect(screen.getByRole('button', { name: strings.apps.recheckLive })).toBeTruthy()
    })

    it('hiển thị tiêu đề cột ID bản triển khai trong bảng danh sách ứng dụng', async () => {
      mockApi()

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      expect(await screen.findByText('my-express-app')).toBeTruthy()
      expect(screen.getByText(strings.apps.deploymentIdTitle)).toBeTruthy()
    })

    it('lỗi tải app:list: hiển thị thông báo lỗi và nút thử lại, bấm thử lại tải lại danh sách thành công', async () => {
      let failAppList = true
      mockApi({
        'app:list': async () => {
          if (failAppList) {
            return { ok: false, error: { message: 'Database query timeout' } }
          }
          return { ok: true, data: [APP_1, APP_2] }
        }
      })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // Hiển thị thông báo lỗi
      expect(await screen.findByText(strings.apps.loadError)).toBeTruthy()
      expect(screen.getByText('Database query timeout')).toBeTruthy()
      expect(screen.queryByText('my-express-app')).toBeNull()

      // Bấm nút thử lại
      failAppList = false
      const retryButtons = screen.getAllByRole('button', { name: strings.common.retry })
      fireEvent.click(retryButtons[0])

      // Sau khi thử lại thành công, danh sách app hiển thị
      expect(await screen.findByText('my-express-app')).toBeTruthy()
      expect(screen.getByText('my-next-blog')).toBeTruthy()
      expect(screen.queryByText(strings.apps.loadError)).toBeNull()
    })

    it('lỗi tải app:versions trong chi tiết: hiển thị thông báo lỗi và nút thử lại, KHÔNG kích hoạt cảnh báo mismatch', async () => {
      let failVersions = true
      mockApi({
        'app:versions': async () => {
          if (failVersions) {
            return { ok: false, error: { message: 'Versions fetch failed' } }
          }
          return { ok: true, data: [DEPLOYMENT_ACTIVE] }
        }
      })

      useUiState.setState({ selectedAppId: 10 })

      render(
        <AntApp>
          <AppsPage />
        </AntApp>
      )

      // Hiển thị thông báo lỗi tải phiên bản
      await waitFor(() => {
        expect(screen.getAllByText(strings.apps.versionsLoadError).length).toBeGreaterThan(0)
      })
      expect(screen.getAllByText('Versions fetch failed').length).toBeGreaterThan(0)

      // TUYỆT ĐỐI KHÔNG hiển thị cảnh báo mismatch current deployment ID
      expect(screen.queryByText(strings.apps.currentDeploymentNotFound)).toBeNull()
      expect(screen.queryByText(strings.apps.currentDeploymentMismatchDesc(101))).toBeNull()

      // Bấm nút Thử lại trong Alert
      failVersions = false
      const retryBtn = screen.getByRole('button', { name: strings.common.retry })
      fireEvent.click(retryBtn)

      // Sau khi thử lại thành công, hiển thị deployment active và hết lỗi
      expect((await screen.findAllByText(/running \(v2\)/)).length).toBeGreaterThan(0)
      expect(screen.queryByText(strings.apps.versionsLoadError)).toBeNull()
    })
  }
)
