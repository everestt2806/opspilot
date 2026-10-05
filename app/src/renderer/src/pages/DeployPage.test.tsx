// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App, DeployEvent, DetectionResultDto, Vps } from '@shared/ipc'

import { DeployPage } from './DeployPage'
import { strings } from '../strings'
import { useUiState } from '../store/uiState'

const { termInstances, terminalOptions } = vi.hoisted(() => {
  const termInstances: Array<{
    write: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }> = []
  const terminalOptions: Array<Record<string, unknown>> = []
  return { termInstances, terminalOptions }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn()
    loadAddon = vi.fn()
    open = vi.fn((container: HTMLElement) => {
      const viewport = document.createElement('div')
      viewport.className = 'xterm-viewport'
      container.appendChild(viewport)
    })
    dispose = vi.fn()
    scrollToBottom = vi.fn()
    getSelection = (): string => ''
    constructor(options: Record<string, unknown>) {
      terminalOptions.push(options)
      termInstances.push(this)
    }
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

function writtenLog(): string {
  return termInstances
    .flatMap((term) => term.write.mock.calls.map((call) => String(call[0])))
    .join('')
}

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
  last_status: 'unknown',
  last_seen_at: null,
  created_at: '2026-08-19T00:00:00Z'
}

const VPS_B: Vps = {
  ...VPS_A,
  id: 2,
  name: 'VM02',
  host: '203.0.113.56'
}

const APP_1: App = {
  id: 10,
  vps_id: 1,
  name: 'preselected-api',
  framework: 'express',
  host_port: 30000,
  container_port: 3000,
  healthcheck_path: '/health',
  needs_db: 0,
  current_deployment_id: 1,
  url: 'http://203.0.113.55:30000'
}

const APP_2: App = {
  id: 20,
  vps_id: 2,
  name: 'app-on-vps-2',
  framework: 'express',
  host_port: 30001,
  container_port: 3000,
  healthcheck_path: '/health',
  needs_db: 0,
  current_deployment_id: 2,
  url: 'http://203.0.113.56:30001'
}

const SOURCE_PATH = 'D:\\src\\express-api'

const MATCHED: DetectionResultDto = {
  matched: true,
  framework: 'express',
  display_name: 'Express.js',
  build_command: 'npm ci --omit=dev',
  container_port: 3000,
  healthcheck_path: '/health',
  dockerfile_template: 'express.Dockerfile',
  required_env: ['PORT', 'SECRET_KEY', 'DATABASE_URL'],
  optional_env: ['DB_HOST'],
  needs_db: true,
  manual_steps: [],
  detected_version: '4.19.2',
  file_tree_preview: ['package.json', 'server.js']
}

const UNMATCHED: DetectionResultDto = {
  matched: false,
  hint: 'Khong thay package.json.',
  signals: [
    { framework: 'express', description: 'package.json co dependency express', passed: false },
    { framework: 'nextjs', description: 'package.json co dependency next', passed: false }
  ]
}

const PRECHECK_PASS = {
  passed: true,
  checks: [
    { label: 'RAM trống', required: '> 512 MB', actual: '2048 MB', ok: true },
    { label: 'Disk trống', required: '> 2 GB', actual: '15 GB', ok: true },
    { label: 'Cổng chưa dùng', required: 'cổng trống', actual: '30000 trống', ok: true }
  ],
  assigned_host_port: 30000,
  app_url: 'http://203.0.113.55:30000'
}

type InvokeHandler = (...args: unknown[]) => Promise<unknown>

function mockApi(handlers: Record<string, InvokeHandler>): {
  emit: (event: DeployEvent) => void
  invoke: ReturnType<typeof vi.fn>
} {
  const eventHandlers: Record<string, (payload: DeployEvent) => void> = {}
  const invoke = vi.fn((channel: string, ...args: unknown[]) => {
    const handler = handlers[channel]
    if (!handler) return Promise.reject(new Error(`No handler registered for '${channel}'`))
    return handler(...args)
  })
  vi.stubGlobal('api', {
    invoke,
    on: (channel: string, callback: (payload: DeployEvent) => void) => {
      if (channel === 'deploy:event') eventHandlers[channel] = callback
      return () => {}
    }
  })
  return {
    emit: (event) => {
      act(() => {
        const handler = eventHandlers['deploy:event']
        if (!handler) {
          throw new Error('deploy:event listener is not registered yet!')
        }
        handler(event)
      })
    },
    invoke
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useUiState.setState({ locale: 'en' })
  termInstances.length = 0
  terminalOptions.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const handersHappy: Record<string, InvokeHandler> = {
  'vps:list': async () => ({ ok: true, data: [VPS_A] }),
  'app:list': async () => ({ ok: true, data: [] }),
  'system:pick-folder': async () => ({ ok: true, data: { path: SOURCE_PATH } }),
  'deploy:detect': async () => ({ ok: true, data: MATCHED }),
  'deploy:precheck': async () => ({ ok: true, data: PRECHECK_PASS }),
  'deploy:start': async () => ({ ok: true, data: { deployment_id: 7 } }),
  'deploy:cancel': async () => ({ ok: true, data: undefined }),
  'system:open-external': async () => ({ ok: true, data: undefined })
}

/** Đi wizard tới bước 3: chọn folder -> detect -> điền env -> precheck. */
async function reachStep3(invoke: ReturnType<typeof vi.fn>): Promise<void> {
  fireEvent.click(await screen.findByText('Choose folder'))
  await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('deploy:detect', SOURCE_PATH))
  fireEvent.click(screen.getByText('Next'))
  await screen.findByText('Express.js')
  fireEvent.click(screen.getByText('Next'))
  await screen.findByLabelText('PORT')
  fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '3000' } })
  fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'sekret' } })
  fireEvent.click(screen.getByText('Next'))
  await screen.findByText('RAM trống')
}

describe('DeployPage — wizard va log', () => {
  it('hien thi va cho chon tat ca VPS trong danh sach trien khai', async () => {
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] })
    })

    render(<DeployPage />)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    const target = screen.getByRole('combobox')
    expect(screen.getByRole('option', { name: 'VM01 — 203.0.113.55:22' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'VM02 — 203.0.113.56:22' })).toBeTruthy()
    fireEvent.change(target, { target: { value: '2' } })

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 2))
  })

  it('happy path: chon VPS tu dong, detect, dien env, precheck, deploy, log live, mo URL', async () => {
    const { emit, invoke } = mockApi(handersHappy)

    render(<DeployPage />)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    expect(screen.getByText('VM01 — 203.0.113.55:22')).toBeTruthy()

    await reachStep3(invoke)

    expect(invoke).toHaveBeenCalledWith('deploy:precheck', {
      vps_id: 1,
      app_id: undefined,
      app_name: 'express-api',
      source_path: SOURCE_PATH,
      env: { PORT: '3000', SECRET_KEY: 'sekret' }
    })
    expect(screen.getByText('http://203.0.113.55:30000')).toBeTruthy()

    fireEvent.click(screen.getByText(strings.deploy.review.deploy))

    expect(await screen.findByText('Deploy log')).toBeTruthy()
    expect(screen.getByText('Live output')).toBeTruthy()
    expect(terminalOptions[0]?.convertEol).toBe(true)
    expect(invoke).toHaveBeenCalledWith('deploy:start', {
      vps_id: 1,
      app_id: undefined,
      host_port: 30000,
      app_name: 'express-api',
      source_path: SOURCE_PATH,
      env: { PORT: '3000', SECRET_KEY: 'sekret' }
    })

    emit({ type: 'step-start', deployment_id: 7, step: 'PRECHECK', ts: '2026-08-19T10:00:00Z' })
    emit({
      type: 'log',
      deployment_id: 7,
      step: 'PRECHECK',
      chunk: 'Kiem tra RAM...\n',
      stream: 'stdout'
    })
    emit({ type: 'step-done', deployment_id: 7, step: 'PRECHECK', duration_ms: 2000 })
    emit({ type: 'step-start', deployment_id: 9, step: 'UPLOAD', ts: '2026-08-19T10:00:02Z' })
    emit({ type: 'step-done', deployment_id: 7, step: 'UPLOAD', duration_ms: 8000 })
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 15000,
      app_url: 'http://203.0.113.55:30000'
    })

    await waitFor(() => expect(writtenLog()).toContain('Kiem tra RAM...'))
    expect((await screen.findAllByText('Deploy succeeded in 15s')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByText('Open app')[0])
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('system:open-external', 'http://203.0.113.55:30000')
    )
  })

  it('deploy that bai: banner bao dung buoc + khong co nut Mo app, quay lai wizard giu source', async () => {
    const { emit, invoke } = mockApi(handersHappy)

    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(screen.getByText(strings.deploy.review.deploy))
    await screen.findByText('Deploy log')

    emit({ type: 'step-start', deployment_id: 7, step: 'BUILD', ts: '2026-08-19T10:00:00Z' })
    emit({
      type: 'log',
      deployment_id: 7,
      step: 'BUILD',
      chunk: 'ERROR: npm install that bai\n',
      stream: 'stderr'
    })
    emit({
      type: 'step-failed',
      deployment_id: 7,
      step: 'BUILD',
      error: {
        code: 'DOCKER_BUILD_FAILED',
        message: 'Build that bai. Kiem tra build command.',
        technical: 'exit 1'
      },
      last_log_lines: ['ERROR: npm install that bai']
    })
    emit({ type: 'finished', deployment_id: 7, status: 'failed', total_duration_ms: 30000 })

    expect((await screen.findAllByText('Failed at step BUILD')).length).toBeGreaterThan(0)
    expect(screen.getByText('Build that bai. Kiem tra build command.')).toBeTruthy()
    await waitFor(() => expect(writtenLog()).toContain('ERROR: npm install that bai'))
    expect(screen.queryByText('Open app')).toBeNull()

    fireEvent.click(screen.getByText('Back to wizard'))
    expect(await screen.findByText('Choose again')).toBeTruthy()
    expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy()
  })

  it('huy giua chung: confirm roi goi deploy:cancel voi dung deployment id', async () => {
    const { invoke } = mockApi(handersHappy)

    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(screen.getByText(strings.deploy.review.deploy))
    await screen.findByText('Deploy log')

    fireEvent.click(screen.getByText('Cancel deploy'))
    expect((await screen.findAllByText(/Stop the deploy midway/)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Stop'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('deploy:cancel', 7))
  })

  it('detect khong khop: buoc Nhan dien hien card do kem cac dau hieu, khong di tiep duoc', async () => {
    mockApi({ ...handersHappy, 'deploy:detect': async () => ({ ok: true, data: UNMATCHED }) })

    render(<DeployPage />)
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())
    fireEvent.click(screen.getByText('Next'))

    expect(await screen.findByText('Framework not recognized')).toBeTruthy()
    expect(screen.getByText('package.json co dependency express')).toBeTruthy()
    expect(() => screen.getByText('Express.js')).toThrow()
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('precheck khong dat: hang do + nut Deploy disabled + giai thich', async () => {
    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:precheck': async () => ({
        ok: true,
        data: {
          passed: false,
          checks: [
            { label: 'RAM trống', required: '> 512 MB', actual: '100 MB', ok: false },
            { label: 'Disk trống', required: '> 2 GB', actual: '15 GB', ok: true },
            { label: 'Cổng chưa dùng', required: 'cổng trống', actual: '30000 trống', ok: true }
          ],
          assigned_host_port: 30000,
          app_url: 'http://203.0.113.55:30000'
        }
      })
    })

    render(<DeployPage />)
    await reachStep3(invoke)

    expect(screen.getByText('100 MB')).toBeTruthy()
    expect(
      screen.getByText('Precheck is not green — fix it on the VPS, then click Check again.')
    ).toBeTruthy()
    expect(
      (screen.getByText(strings.deploy.review.deploy).closest('button') as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it('exposure bi degraded: Doctor chan doan, hien Safe auto-fix, fix xong cap nhat reachable va hien nut Mo app', async () => {
    const { emit, invoke } = mockApi({
      ...handersHappy,
      'doctor:diagnose': async () => ({
        ok: true,
        data: {
          fix_id: 'fix_ufw_port',
          safe_to_auto_fix: true,
          title: 'Mở cổng UFW 30000',
          confidence: 'high',
          evidence: ['Cổng 30000 bị UFW chặn'],
          suggested_action: 'Mở cổng 30000 trên UFW'
        }
      }),
      'doctor:fix': async () => ({
        ok: true,
        data: {
          action_id: 1,
          fix_id: 'fix_ufw_port',
          status: 'verified',
          exposure_status: 'reachable',
          message: 'Đã mở cổng 30000 trên UFW và kiểm tra thành công.'
        }
      })
    })

    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(screen.getByText(strings.deploy.review.deploy))
    await screen.findByText('Deploy log')

    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 12000,
      exposure_status: 'degraded'
    })

    expect(await screen.findByText(strings.deploy.exposure.degradedTitle)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.blockedHint)).toBeTruthy()
    expect(screen.getByText(strings.deploy.doctor.diagnose)).toBeTruthy()
    expect(screen.queryByText(strings.deploy.doctor.autoFix)).toBeNull()

    // Chạy Doctor diagnose
    fireEvent.click(screen.getByText(strings.deploy.doctor.diagnose))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('doctor:diagnose', {
        deployment_id: 7,
        evidence: {
          logs: '',
          container_state: { status: 'running' },
          external_probe: 'unreachable'
        }
      })
    )

    // Bằng chứng chẩn đoán và nút Safe auto-fix xuất hiện
    expect(await screen.findByText(/Mở cổng UFW 30000/)).toBeTruthy()
    const autoFixBtn = screen.getByText(strings.deploy.doctor.autoFix)
    expect(autoFixBtn).toBeTruthy()

    // Chạy Safe auto-fix
    fireEvent.click(autoFixBtn)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('doctor:fix', {
        fix_id: 'fix_ufw_port',
        deployment_id: 7
      })
    )

    // Reactive update: trạng thái chuyển sang reachable, banner thành công và nút Open app xuất hiện
    await waitFor(
      () => {
        expect(screen.queryByText(strings.deploy.exposure.degradedTitle)).toBeNull()
        expect(screen.getAllByText(strings.deploy.log.openApp).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/Deploy succeeded/).length).toBeGreaterThan(0)
        expect(screen.getByText('http://203.0.113.55:30000')).toBeTruthy()
      },
      { timeout: 10000 }
    )
  })

  it('named_tunnel bi vo hieu hoa khi chua co CNAME target hop le', async () => {
    const { emit, invoke } = mockApi(handersHappy)

    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(screen.getByText(strings.deploy.review.deploy))

    // Bảo đảm deploy:start đã được gọi và trạng thái deploy (Deploy log, Live output) đã sẵn sàng
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('deploy:start', expect.anything()))
    expect(await screen.findByText('Deploy log')).toBeTruthy()
    expect(await screen.findByText('Live output')).toBeTruthy()

    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 10000,
      app_url: 'http://203.0.113.55:30000'
    })

    // Chờ kết quả UI Domain xuất hiện với thời gian phù hợp
    expect(
      await screen.findByText(strings.deploy.domain.title, {}, { timeout: 10000 })
    ).toBeTruthy()
    const select = screen.getByRole('combobox', { name: 'Domain mode' })
    expect(select).toBeTruthy()

    fireEvent.mouseDown(select)
    const disabledOption = await screen.findByText(
      strings.deploy.domain.namedTunnelDisabled,
      {},
      { timeout: 10000 }
    )
    expect(disabledOption.closest('.ant-select-item-option-disabled')).toBeTruthy()
  })

  it('đổi ngôn ngữ theo bốn ngôn ngữ và cập nhật nội dung DeployPage', async () => {
    mockApi(handersHappy)
    useUiState.setState({ locale: 'vi' })

    const { rerender } = render(<DeployPage />)

    // 1. Tiếng Việt
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Triển khai ứng dụng' })
    ).toBeTruthy()
    expect(screen.getByText('Chọn thư mục')).toBeTruthy()
    expect(screen.getByText('Thư mục mã nguồn')).toBeTruthy()
    expect(
      screen.getByText('Chữ thường a-z, chữ số và dấu gạch ngang — phải bắt đầu bằng chữ cái.')
    ).toBeTruthy()

    // 2. English
    act(() => {
      useUiState.setState({ locale: 'en' })
    })
    rerender(<DeployPage />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Deploy an application' })
    ).toBeTruthy()
    expect(screen.getByText('Choose folder')).toBeTruthy()
    expect(screen.getByText('Source folder')).toBeTruthy()
    expect(
      screen.getByText('Lowercase a-z, digits and dashes — must start with a letter.')
    ).toBeTruthy()

    // 3. 简体中文
    act(() => {
      useUiState.setState({ locale: 'cn' })
    })
    rerender(<DeployPage />)
    expect(await screen.findByRole('heading', { level: 1, name: '部署应用程序' })).toBeTruthy()
    expect(screen.getByText('选择文件夹')).toBeTruthy()
    expect(screen.getByText('源码文件夹')).toBeTruthy()
    expect(screen.getByText('仅限小写字母 a-z、数字和连字符，且必须以字母开头。')).toBeTruthy()

    // 4. 日本語
    act(() => {
      useUiState.setState({ locale: 'jp' })
    })
    rerender(<DeployPage />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'アプリケーションデプロイ' })
    ).toBeTruthy()
    expect(screen.getByText('フォルダを選択')).toBeTruthy()
    expect(screen.getByText('ソースフォルダ')).toBeTruthy()
    expect(
      screen.getByText('英小文字 a-z、数字、ハイフン（先頭は英文字である必要があります）。')
    ).toBeTruthy()
  })

  it('preselect voi app ton tai: giu nguyen VPS va app sau khi load, dien dung appName, truyen dung app_id len precheck', async () => {
    useUiState.setState({ deployPreselect: { vpsId: 1, appId: 10 } })
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'app:list': async (id) => (id === 1 ? { ok: true, data: [APP_1] } : { ok: true, data: [] })
    })

    render(<DeployPage />)

    // Chờ tải xong và kiểm tra VPS + app được giữ nguyên
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    expect(screen.getByRole('option', { name: 'VM01 — 203.0.113.55:22' })).toBeTruthy()

    // Radio Ứng dụng hiện có được chọn
    const existingRadio = screen.getByRole('radio', { name: strings.deploy.targetApp.existing })
    expect((existingRadio as HTMLInputElement).checked).toBe(true)

    // Combobox app hiển thị tên APP_1
    expect(screen.getByRole('option', { name: /preselected-api — port 30000/ })).toBeTruthy()

    // Chọn thư mục mã nguồn: appName không bị ghi đè thành tên thư mục
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())

    // Đi tiếp tới review/precheck
    fireEvent.click(screen.getByText('Next'))
    await screen.findByText('Express.js')
    fireEvent.click(screen.getByText('Next'))
    await screen.findByLabelText('PORT')
    fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'sekret' } })
    fireEvent.click(screen.getByText('Next'))
    await screen.findByText('RAM trống')

    // Precheck nhận đúng app_id: 10 và app_name: 'preselected-api'
    expect(invoke).toHaveBeenCalledWith('deploy:precheck', {
      vps_id: 1,
      app_id: 10,
      app_name: 'preselected-api',
      source_path: SOURCE_PATH,
      env: { PORT: '3000', SECRET_KEY: 'sekret' }
    })
  })

  it('preselect voi app khong ton tai tren VPS: hien thi loi co nut chuyen sang app moi, khong am tham doi sang app/VPS khac', async () => {
    useUiState.setState({ deployPreselect: { vpsId: 1, appId: 999 } })
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'app:list': async () => ({ ok: true, data: [APP_1] })
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Banner lỗi xuất hiện giải thích app không thuộc VPS
    expect(await screen.findByText(strings.deploy.preselectAppNotFound)).toBeTruthy()
    expect(screen.getByText('App ID: 999')).toBeTruthy()

    // Nút Next bị vô hiệu hoá
    const nextBtn = screen.getByRole('button', { name: strings.deploy.next }) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Bấm nút khôi phục: "Chuyển sang ứng dụng mới"
    const switchBtn = screen.getByText(strings.deploy.switchToNewApp)
    fireEvent.click(switchBtn)

    // Lỗi biến mất và chuyển sang chế độ ứng dụng mới
    expect(screen.queryByText(strings.deploy.preselectAppNotFound)).toBeNull()
    const newRadio = screen.getByRole('radio', { name: strings.deploy.targetApp.new })
    expect((newRadio as HTMLInputElement).checked).toBe(true)
  })

  it('preselect voi VPS khong ton tai: hien thi loi co nut chon VPS co san, khong am tham doi VPS', async () => {
    useUiState.setState({ deployPreselect: { vpsId: 888, appId: 10 } })
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] })
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('vps:list'))

    // Banner lỗi xuất hiện
    expect(await screen.findByText(strings.deploy.preselectVpsNotFound)).toBeTruthy()
    expect(screen.getByText('VPS ID: 888')).toBeTruthy()

    // Không âm thầm gọi app:list với VPS khác
    expect(invoke).not.toHaveBeenCalledWith('app:list', 1)

    // Nút Next bị vô hiệu hoá
    const nextBtn = screen.getByRole('button', { name: strings.deploy.next }) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Bấm nút khôi phục: "Chọn máy chủ có sẵn"
    const chooseBtn = screen.getByText(strings.deploy.chooseAvailableVps)
    fireEvent.click(chooseBtn)

    // Lỗi biến mất và chọn VPS 1
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    expect(screen.queryByText(strings.deploy.preselectVpsNotFound)).toBeNull()
  })

  it('app:list gap loi: hien thi thong bao kem nut thu lai', async () => {
    let callCount = 0
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'app:list': async () => {
        callCount++
        if (callCount === 1) {
          return { ok: false, error: { message: 'SSH connection refused' } }
        }
        return { ok: true, data: [APP_1] }
      }
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Chuyển sang radio Ứng dụng hiện có để xem app:list
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.existing }))

    // Hiển thị lỗi appLoadError
    expect(await screen.findByText(strings.deploy.appLoadError)).toBeTruthy()
    expect(screen.getByText('SSH connection refused')).toBeTruthy()

    // Bấm nút thử lại
    fireEvent.click(screen.getByRole('button', { name: strings.common.retry }))

    // Gọi lại app:list lần 2 thành công, hiển thị APP_1
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3)) // 1 vps:list + 2 app:list
    expect(await screen.findByRole('option', { name: /preselected-api — port 30000/ })).toBeTruthy()
    expect(screen.queryByText(strings.deploy.appLoadError)).toBeNull()
  })

  it('doi VPS nhanh: phan hoi cu cua app:list khong ghi de danh sach app cua VPS moi', async () => {
    let resolveVps1: (val: unknown) => void = () => {}
    const vps1Promise = new Promise((res) => {
      resolveVps1 = res
    })

    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'app:list': async (id) => {
        if (id === 1) {
          await vps1Promise
          return { ok: true, data: [APP_1] }
        }
        return { ok: true, data: [APP_2] }
      }
    })

    render(<DeployPage />)

    // Khởi tạo app:list(1) nhưng bị hoãn
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Người dùng nhanh tay đổi sang VPS 2
    const vpsSelect = screen.getByRole('combobox')
    fireEvent.change(vpsSelect, { target: { value: '2' } })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 2))

    // Bật chế độ existing để kiểm tra danh sách app
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.existing }))

    // VPS 2 đã trả về APP_2
    expect(await screen.findByRole('option', { name: /app-on-vps-2 — port 30001/ })).toBeTruthy()

    // Bây giờ phản hồi cũ của VPS 1 mới hoàn thành
    act(() => {
      resolveVps1(undefined)
    })

    // Danh sách vẫn giữ APP_2, không bị APP_1 ghi đè
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /app-on-vps-2 — port 30001/ })).toBeTruthy()
    })
    expect(screen.queryByRole('option', { name: /preselected-api/ })).toBeNull()
  })

  it('phan biet loi vps:list voi danh sach VPS rong', async () => {
    // 1. Khi vps:list bị lỗi: hiển thị Alert kèm nút Thử lại, không hiển thị Empty
    const { invoke: invokeError } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: false, error: { message: 'Database connection failed' } })
    })

    const { unmount } = render(<DeployPage />)
    await waitFor(() => expect(invokeError).toHaveBeenCalledWith('vps:list'))

    expect(await screen.findByText(strings.deploy.vpsLoadError)).toBeTruthy()
    expect(screen.getByText('Database connection failed')).toBeTruthy()
    expect(screen.queryByText(strings.deploy.noVps)).toBeNull()
    unmount()

    // 2. Khi vps:list thành công nhưng rỗng: hiển thị Empty, không hiển thị Alert lỗi
    const { invoke: invokeEmpty } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [] })
    })

    render(<DeployPage />)
    await waitFor(() => expect(invokeEmpty).toHaveBeenCalledWith('vps:list'))

    expect(await screen.findByText(strings.deploy.noVps)).toBeTruthy()
    expect(screen.queryByText(strings.deploy.vpsLoadError)).toBeNull()
  })

  it('doi VPS khi app:list dang cho: vo hieu hoa Tiep tuc va bo app_id cu ngay', async () => {
    let resolveVps2Apps: (val: unknown) => void = () => {}
    const vps2AppsPromise = new Promise((res) => {
      resolveVps2Apps = res
    })

    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'app:list': async (id) => {
        if (id === 1) return { ok: true, data: [APP_1] }
        await vps2AppsPromise
        return { ok: true, data: [APP_2] }
      }
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Chọn thư mục nguồn
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())

    // Chuyển sang Ứng dụng hiện có và chọn APP_1
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.existing }))
    const appSelect = await screen.findByRole('combobox', {
      name: strings.deploy.targetApp.selectApp
    })
    fireEvent.change(appSelect, { target: { value: '10' } })

    // Lúc này nút Tiếp tục đã enabled
    const nextBtn = screen.getByRole('button', { name: strings.deploy.next }) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(false)

    // Đổi sang VPS 2 (app:list đang chờ)
    const vpsSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(vpsSelect, { target: { value: '2' } })

    // Ngay trong lúc app:list đang chờ:
    // 1. Nút Tiếp tục bị vô hiệu hoá
    expect(nextBtn.disabled).toBe(true)
    // 2. Hiển thị trạng thái đang tải app
    expect(screen.getByText(strings.deploy.appLoading)).toBeTruthy()

    // Cho app:list VPS 2 resolve
    act(() => {
      resolveVps2Apps(undefined)
    })
    await waitFor(() => expect(screen.queryByText(strings.deploy.appLoading)).toBeNull())

    // Sau khi tải xong, app đầu tiên KHÔNG tự chọn: giá trị appSelect vẫn là -1
    const updatedAppSelect = screen.getByRole('combobox', {
      name: strings.deploy.targetApp.selectApp
    }) as HTMLSelectElement
    expect(updatedAppSelect.value).toBe('-1')
    expect(nextBtn.disabled).toBe(true)
  })

  it('chon app sau khi tai o che do ung dung hien co va chay precheck voi dung cap VPS/app', async () => {
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'app:list': async (id) => {
        if (id === 1) return { ok: true, data: [APP_1] }
        return { ok: true, data: [APP_2] }
      }
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Chọn thư mục nguồn
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())

    // Đổi sang VPS 2
    const vpsSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(vpsSelect, { target: { value: '2' } })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 2))

    // Chọn radio Ứng dụng hiện có
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.existing }))

    // Tiếp tục vẫn disabled vì chưa chọn app
    const nextBtn = screen.getByRole('button', { name: strings.deploy.next }) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Chọn APP_2 từ combobox
    const appSelect = screen.getByRole('combobox', {
      name: strings.deploy.targetApp.selectApp
    })
    fireEvent.change(appSelect, { target: { value: '20' } })

    // Giờ Tiếp tục đã enabled
    expect(nextBtn.disabled).toBe(false)
    fireEvent.click(nextBtn)

    // Đi qua Step 1 (Detect)
    await screen.findByText('Express.js')
    fireEvent.click(screen.getByText('Next'))

    // Step 2 (Config)
    await screen.findByLabelText('PORT')
    fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'sekret' } })
    fireEvent.click(screen.getByText('Next'))

    // Step 3 (Review & Precheck)
    await screen.findByText('RAM trống')
    expect(invoke).toHaveBeenCalledWith('deploy:precheck', {
      vps_id: 2,
      app_id: 20,
      app_name: 'app-on-vps-2',
      source_path: SOURCE_PATH,
      env: { PORT: '3000', SECRET_KEY: 'sekret' }
    })
  })

  it('retry vps:list giu nguyen preselect cho den khi ap dung thanh cong', async () => {
    useUiState.setState({ deployPreselect: { vpsId: 2, appId: 20 } })
    let callCount = 0
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => {
        callCount++
        if (callCount === 1) {
          return { ok: false, error: { message: 'Network timeout' } }
        }
        return { ok: true, data: [VPS_A, VPS_B] }
      },
      'app:list': async (id) => (id === 2 ? { ok: true, data: [APP_2] } : { ok: true, data: [] })
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('vps:list'))

    // Lần 1 lỗi: hiển thị alert kèm nút Thử lại
    expect(await screen.findByText(strings.deploy.vpsLoadError)).toBeTruthy()
    expect(screen.getByText('Network timeout')).toBeTruthy()

    // Bấm nút Thử lại
    const retryBtn = screen.getByRole('button', { name: strings.common.retry })
    fireEvent.click(retryBtn)

    // Lần 2 thành công: preselect vẫn giữ nguyên VPS 2 và APP 2!
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 2))
    expect(await screen.findByRole('option', { name: 'VM02 — 203.0.113.56:22' })).toBeTruthy()
    expect(screen.getByRole('option', { name: /app-on-vps-2 — port 30001/ })).toBeTruthy()

    // Sau khi áp dụng thành công, preselect trong store đã được xóa
    expect(useUiState.getState().deployPreselect).toBeNull()
  })

  it('hien thi trang thai dang tai ban dau thay cho thong bao chua co VPS thoang qua', async () => {
    let resolveVpsList: (val: unknown) => void = () => {}
    const vpsListPromise = new Promise((res) => {
      resolveVpsList = res
    })

    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => {
        await vpsListPromise
        return { ok: true, data: [] }
      }
    })

    render(<DeployPage />)
    expect(invoke).toHaveBeenCalledWith('vps:list')

    // Trong lúc đang tải: hiển thị spinner loading, KHÔNG hiển thị thông báo chưa có VPS
    expect(screen.getByText(strings.deploy.vpsLoading)).toBeTruthy()
    expect(screen.queryByText(strings.deploy.noVps)).toBeNull()

    // Cho vps:list hoàn thành với danh sách rỗng
    act(() => {
      resolveVpsList(undefined)
    })

    // Bây giờ mới hiển thị thông báo chưa có VPS
    expect(await screen.findByText(strings.deploy.noVps)).toBeTruthy()
    expect(screen.queryByText(strings.deploy.vpsLoading)).toBeNull()
  })
})
