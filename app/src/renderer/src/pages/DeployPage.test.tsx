// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeployEvent, DetectionResultDto, Vps } from '@shared/ipc'

import { DeployPage } from './DeployPage'

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
        eventHandlers['deploy:event']?.(event)
      })
    },
    invoke
  }
}

beforeEach(() => {
  vi.clearAllMocks()
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
  fireEvent.click(await screen.findByText('Chọn thư mục'))
  await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('deploy:detect', SOURCE_PATH))
  fireEvent.click(screen.getByText('Tiếp tục'))
  await screen.findByText('Express.js')
  fireEvent.click(screen.getByText('Tiếp tục'))
  await screen.findByLabelText('PORT')
  fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '3000' } })
  fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'sekret' } })
  fireEvent.click(screen.getByText('Tiếp tục'))
  await screen.findByText('RAM trống')
}

describe('DeployPage — wizard va log', () => {
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

    fireEvent.click(screen.getByText('Deploy'))

    expect(await screen.findByText('Deploy log')).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith('deploy:start', {
      vps_id: 1,
      app_id: undefined,
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

    expect(screen.getByText('Kiem tra RAM...')).toBeTruthy()
    expect((await screen.findAllByText('Deploy thành công sau 15s')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByText('Mở app')[0])
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('system:open-external', 'http://203.0.113.55:30000')
    )
  })

  it('deploy that bai: banner bao dung buoc + khong co nut Mo app, quay lai wizard giu source', async () => {
    const { emit, invoke } = mockApi(handersHappy)

    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(screen.getByText('Deploy'))
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

    expect((await screen.findAllByText('Lỗi ở bước BUILD')).length).toBeGreaterThan(0)
    expect(screen.getByText('Build that bai. Kiem tra build command.')).toBeTruthy()
    expect(screen.getByText('ERROR: npm install that bai')).toBeTruthy()
    expect(screen.queryByText('Mở app')).toBeNull()

    fireEvent.click(screen.getByText('Quay lại wizard'))
    expect(await screen.findByText('Chọn lại')).toBeTruthy()
    expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy()
  })

  it('huy giua chung: confirm roi goi deploy:cancel voi dung deployment id', async () => {
    const { invoke } = mockApi(handersHappy)

    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(screen.getByText('Deploy'))
    await screen.findByText('Deploy log')

    fireEvent.click(screen.getByText('Huỷ deploy'))
    expect((await screen.findAllByText(/Dừng deploy giữa chừng/)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Dừng lại'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('deploy:cancel', 7))
  })

  it('detect khong khop: buoc Nhan dien hien card do kem cac dau hieu, khong di tiep duoc', async () => {
    mockApi({ ...handersHappy, 'deploy:detect': async () => ({ ok: true, data: UNMATCHED }) })

    render(<DeployPage />)
    fireEvent.click(await screen.findByText('Chọn thư mục'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())
    fireEvent.click(screen.getByText('Tiếp tục'))

    expect(await screen.findByText('Không nhận diện được framework')).toBeTruthy()
    expect(screen.getByText('package.json co dependency express')).toBeTruthy()
    expect(() => screen.getByText('Express.js')).toThrow()
    expect((screen.getByRole('button', { name: 'Tiếp tục' }) as HTMLButtonElement).disabled).toBe(
      true
    )
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
    expect(screen.getByText('Precheck chưa xanh — sửa trên VPS rồi bấm Kiểm tra lại.')).toBeTruthy()
    expect((screen.getByText('Deploy').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
