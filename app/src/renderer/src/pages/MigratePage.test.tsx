// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { App, MigrateEvent, MigrateJobView, Vps } from '@shared/ipc'
import { useUiState } from '../store/uiState'
import { MigratePage } from './MigratePage'

const app: App = {
  id: 1,
  vps_id: 1,
  name: 'demo-service',
  framework: 'express',
  host_port: 3000,
  container_port: 3000,
  healthcheck_path: '/',
  needs_db: 0,
  current_deployment_id: 1,
  imported_from_vps: 0,
  url: 'http://127.0.0.1:3000'
}

const sourceVps: Vps = {
  id: 1,
  name: 'source-node',
  host: '192.168.1.10',
  port: 22,
  host_fingerprint: null,
  username: 'root',
  auth_type: 'password',
  provider: null,
  region: null,
  docker_version: '27.0.1',
  last_status: 'online',
  last_seen_at: null,
  created_at: '2026-01-01T00:00:00Z'
}

const targetVps: Vps = {
  id: 2,
  name: 'target-node',
  host: '192.168.1.20',
  port: 22,
  host_fingerprint: null,
  username: 'root',
  auth_type: 'password',
  provider: null,
  region: null,
  docker_version: '27.0.1',
  last_status: 'online',
  last_seen_at: null,
  created_at: '2026-01-01T00:00:00Z'
}

const baseJob: MigrateJobView = {
  id: 7,
  app_id: 1,
  source_vps_id: 1,
  target_vps_id: 2,
  status: 'awaiting_confirm',
  failed_step: null,
  error_message: null,
  downtime_ms: 150,
  bytes_transferred: 4096,
  verify_json: JSON.stringify({ ok: true }),
  source_kept: null,
  started_at: '2026-01-01T00:00:00Z',
  finished_at: null
}

afterEach(() => {
  vi.unstubAllGlobals()
  useUiState.setState({ locale: 'vi' })
})

describe('MigratePage UI-1j-a', () => {
  it('chon app nguon va VPS dich bang control native de bat dau migration', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [] }
      if (channel === 'migrate:start') return { ok: true, data: { job_id: 8 } }
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)
    await screen.findByText(/demo-service · source-node/)

    const sourceSelect = await screen.findByRole('combobox', { name: 'Chọn app nguồn' })
    fireEvent.change(sourceSelect, { target: { value: '1' } })

    const targetSelect = screen.getByRole('combobox', { name: 'Chọn VPS đích' })
    fireEvent.change(targetSelect, { target: { value: '2' } })

    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu migrate' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('migrate:start', { app_id: 1, target_vps_id: 2 })
    )
  })

  it('khoi phuc job tu migrate:list hien thi dung app, VPS nguon/dich va job ID', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [baseJob] }
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)

    // Job ID is displayed
    expect(await screen.findByText(/#7/)).toBeTruthy()
    // Correct status tag
    expect(screen.getByText('Chờ xác nhận')).toBeTruthy()
    // Downtime displayed
    expect(screen.getByText(/Downtime: 150 ms/)).toBeTruthy()

    // Native dropdowns have restored values
    const sourceSelect = screen.getByRole('combobox', {
      name: 'Chọn app nguồn'
    }) as HTMLSelectElement
    expect(sourceSelect.value).toBe('1')

    const targetSelect = screen.getByRole('combobox', {
      name: 'Chọn VPS đích'
    }) as HTMLSelectElement
    expect(targetSelect.value).toBe('2')
  })

  it('event cua job khac khong duoc lam thay doi man hinh', async () => {
    let eventCallback: ((event: MigrateEvent) => void) | undefined

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [baseJob] }
      throw new Error(`unexpected ${channel}`)
    })
    const on = vi.fn((_channel: string, cb: (event: MigrateEvent) => void) => {
      eventCallback = cb
      return () => {}
    })
    vi.stubGlobal('api', { invoke, on })

    render(<MigratePage />)
    expect(await screen.findByText('Chờ xác nhận')).toBeTruthy()
    expect(screen.getByText(/#7/)).toBeTruthy()

    // Emit event from completely different job ID 999
    eventCallback!({
      type: 'finished',
      job_id: 999,
      status: 'failed',
      downtime_ms: 9999,
      error: 'CRITICAL_JOB_999_ERROR'
    })

    // Screen must NOT reflect job 999
    expect(screen.queryByText('CRITICAL_JOB_999_ERROR')).toBeNull()
    expect(screen.getByText('Chờ xác nhận')).toBeTruthy()
    expect(screen.getByText(/#7/)).toBeTruthy()
  })

  it('failed va rolled_back la trang thai ket thuc, khong hien nhu dang chay', async () => {
    const failedJob: MigrateJobView = {
      ...baseJob,
      status: 'failed',
      failed_step: 'BACKUP',
      error_message: 'DISK_FULL: Không đủ dung lượng ổ đĩa để sao lưu.'
    }
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [failedJob] }
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)

    // Tag displays "Thất bại"
    expect(await screen.findByText('Thất bại')).toBeTruthy()
    // Alert displays failure message
    expect(screen.getByText(/nguồn chưa khôi phục được/)).toBeTruthy()
    expect(screen.getByText(/DISK_FULL/)).toBeTruthy()

    // Huỷ & rollback is disabled because job has terminated
    const cancelBtn = screen.getByRole('button', { name: 'Huỷ & rollback' }) as HTMLButtonElement
    expect(cancelBtn.disabled).toBe(true)

    // "Bắt đầu migrate" button is NOT locked by running state
    const startBtn = screen.getByRole('button', { name: 'Bắt đầu migrate' }) as HTMLButtonElement
    expect(startBtn.disabled).toBe(false)
  })

  it('chan bam migrate:start hai lan (chi goi IPC mot lan)', async () => {
    let resolveStart: (value: { ok: true; data: { job_id: number } }) => void
    const startPromise = new Promise<{ ok: true; data: { job_id: number } }>((res) => {
      resolveStart = res
    })

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [] }
      if (channel === 'migrate:start') return startPromise
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)
    await screen.findByText(/demo-service · source-node/)

    const sourceSelect = screen.getByRole('combobox', { name: 'Chọn app nguồn' })
    fireEvent.change(sourceSelect, { target: { value: '1' } })
    const targetSelect = screen.getByRole('combobox', { name: 'Chọn VPS đích' })
    fireEvent.change(targetSelect, { target: { value: '2' } })

    const startBtn = screen.getByRole('button', { name: 'Bắt đầu migrate' })

    // Click twice rapidly
    fireEvent.click(startBtn)
    fireEvent.click(startBtn)

    expect(invoke).toHaveBeenCalledTimes(4) // app:list, vps:list, migrate:list, migrate:start (ONCE)
    const startCalls = invoke.mock.calls.filter((call) => call[0] === 'migrate:start')
    expect(startCalls.length).toBe(1)

    // Complete the call
    resolveStart!({ ok: true, data: { job_id: 10 } })
    await waitFor(() => expect(screen.getByText(/#10/)).toBeTruthy())
  })

  it('xu ly event den truoc khi lenh migrate:start tra job ID', async () => {
    let resolveStart: (value: { ok: true; data: { job_id: number } }) => void
    const startPromise = new Promise<{ ok: true; data: { job_id: number } }>((res) => {
      resolveStart = res
    })
    let eventCallback: ((event: MigrateEvent) => void) | undefined

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [] }
      if (channel === 'migrate:start') return startPromise
      throw new Error(`unexpected ${channel}`)
    })
    const on = vi.fn((_channel: string, cb: (event: MigrateEvent) => void) => {
      eventCallback = cb
      return () => {}
    })
    vi.stubGlobal('api', { invoke, on })

    render(<MigratePage />)
    await screen.findByText(/demo-service · source-node/)

    const sourceSelect = screen.getByRole('combobox', { name: 'Chọn app nguồn' })
    fireEvent.change(sourceSelect, { target: { value: '1' } })
    const targetSelect = screen.getByRole('combobox', { name: 'Chọn VPS đích' })
    fireEvent.change(targetSelect, { target: { value: '2' } })

    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu migrate' }))

    // Early events emitted before migrate:start resolves
    eventCallback!({
      type: 'log',
      job_id: 15,
      step: 'PREPARE',
      chunk: '[EARLY_LOG] Preparing transfer container...'
    })
    eventCallback!({
      type: 'step-start',
      job_id: 15,
      step: 'PREPARE',
      ts: '2026-01-01T00:00:01Z'
    })

    // Now migrate:start resolves with job_id 15
    resolveStart!({ ok: true, data: { job_id: 15 } })

    // Verify early buffered log and step were applied
    await waitFor(() => {
      expect(screen.getByText(/#15/)).toBeTruthy()
      expect(screen.getByText('[EARLY_LOG] Preparing transfer container...')).toBeTruthy()
    })
  })

  it('hop xac nhan truoc migrate:confirm neu ro 2 lua chon, ghi ro app/VPS, va lua chon dung keepSource=true', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [baseJob] }
      if (channel === 'migrate:confirm') return { ok: true, data: undefined }
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)
    expect(await screen.findByText('Chờ xác nhận')).toBeTruthy()

    // Click button to open confirmation modal
    const openModalBtn = screen.getByRole('button', { name: 'Xác nhận di chuyển' })
    expect((openModalBtn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(openModalBtn)

    // Modal is opened
    expect(await screen.findByText('Xác nhận hoàn tất di chuyển ứng dụng')).toBeTruthy()
    // App and VPS details inside modal
    expect(screen.getAllByText('demo-service').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/source-node/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/target-node/).length).toBeGreaterThan(0)

    // Two explicit choices described
    expect(screen.getByText(/Giữ app nguồn:/)).toBeTruthy()
    expect(screen.getByText(/Dừng app nguồn bằng docker compose down:/)).toBeTruthy()

    // Click Choice 1: Giữ app nguồn
    const keepSourceBtn = screen.getByRole('button', { name: 'Giữ app nguồn' })
    fireEvent.click(keepSourceBtn)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('migrate:confirm', 7, true))
  })

  it('hop xac nhan lua chon dung app nguon (keepSource=false) va khoa gui lap', async () => {
    let resolveConfirm: (value: { ok: true; data: undefined }) => void
    const confirmPromise = new Promise<{ ok: true; data: undefined }>((res) => {
      resolveConfirm = res
    })

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [baseJob] }
      if (channel === 'migrate:confirm') return confirmPromise
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)
    expect(await screen.findByText('Chờ xác nhận')).toBeTruthy()

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận di chuyển' }))
    expect(await screen.findByText('Xác nhận hoàn tất di chuyển ứng dụng')).toBeTruthy()

    // Choice 2: Dừng app nguồn
    const stopSourceBtn = screen.getByRole('button', {
      name: 'Dừng app nguồn bằng docker compose down'
    })

    // Click twice rapidly to test double-submit lock
    fireEvent.click(stopSourceBtn)
    fireEvent.click(stopSourceBtn)

    const confirmCalls = invoke.mock.calls.filter((call) => call[0] === 'migrate:confirm')
    expect(confirmCalls.length).toBe(1)
    expect(confirmCalls[0]).toEqual(['migrate:confirm', 7, false])

    // Finish confirmation
    resolveConfirm!({ ok: true, data: undefined })
    await waitFor(() => {
      expect(screen.queryByText('Xác nhận hoàn tất di chuyển ứng dụng')).toBeNull()
    })
  })

  it('khoa nut xac nhan khi verify khong dat (verifyOk=false)', async () => {
    const unverifiedJob: MigrateJobView = {
      ...baseJob,
      verify_json: JSON.stringify({ ok: false })
    }
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [unverifiedJob] }
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)
    expect(await screen.findByText('Chờ xác nhận')).toBeTruthy()

    // Confirmation button is disabled
    const openModalBtn = screen.getByRole('button', {
      name: 'Xác nhận di chuyển'
    }) as HTMLButtonElement
    expect(openModalBtn.disabled).toBe(true)
    expect(screen.getByText(/Chưa đạt kết quả kiểm tra \(VERIFY\)/)).toBeTruthy()
  })

  it('phan biet loi tai danh sach voi danh sach rong va co nut thu lai', async () => {
    let callCount = 0
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [] }
      if (channel === 'vps:list') return { ok: true, data: [] }
      if (channel === 'migrate:list') {
        callCount++
        if (callCount === 1) {
          return { ok: false, error: { code: 'FAIL', message: 'Lỗi kết nối cơ sở dữ liệu' } }
        }
        return { ok: true, data: [] }
      }
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)

    // Error alert is displayed with retry button
    expect(await screen.findByText('Lỗi tải danh sách')).toBeTruthy()
    expect(screen.getByText(/Lỗi kết nối cơ sở dữ liệu/)).toBeTruthy()

    const retryBtn = screen.getByRole('button', { name: 'Thử lại' })
    fireEvent.click(retryBtn)

    // After retry succeeds, error alert disappears and clean empty state is shown
    await waitFor(() => {
      expect(screen.queryByText('Lỗi tải danh sách')).toBeNull()
      expect(screen.getByText('Chưa có ứng dụng nào')).toBeTruthy()
    })
  })

  it('khoa doi app/VPS va migrate:start khi cho xac nhan, giu nguyen ngu canh job goc', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [baseJob] }
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)
    expect(await screen.findByText('Chờ xác nhận')).toBeTruthy()

    const sourceSelect = screen.getByRole('combobox', {
      name: 'Chọn app nguồn'
    }) as HTMLSelectElement
    const targetSelect = screen.getByRole('combobox', {
      name: 'Chọn VPS đích'
    }) as HTMLSelectElement
    const startBtn = screen.getByRole('button', {
      name: 'Bắt đầu migrate'
    }) as HTMLButtonElement

    // Both selects and start button are locked when awaiting confirmation
    expect(sourceSelect.disabled).toBe(true)
    expect(targetSelect.disabled).toBe(true)
    expect(startBtn.disabled).toBe(true)

    // Job banner displays correct context of active job
    expect(screen.getByText(/#7/)).toBeTruthy()
    expect(screen.getByText('demo-service')).toBeTruthy()
  })

  it('cho phep migrate:abort rollback khi o trang thai cho xac nhan', async () => {
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [baseJob] }
      if (channel === 'migrate:abort') return { ok: true, data: undefined }
      throw new Error(`unexpected ${channel}: ${JSON.stringify(args)}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)
    expect(await screen.findByText('Chờ xác nhận')).toBeTruthy()

    const cancelBtn = screen.getByRole('button', {
      name: 'Huỷ & rollback'
    }) as HTMLButtonElement
    // Must be ENABLED during awaiting_confirmation
    expect(cancelBtn.disabled).toBe(false)

    fireEvent.click(cancelBtn)
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('migrate:abort', 7)
    })
  })

  it('cho chon job can theo doi khi co nhieu job hoat dong, gan dung event va hanh dong', async () => {
    const app2: App = { ...app, id: 2, name: 'worker-service' }
    const targetVps3: Vps = { ...targetVps, id: 3, name: 'backup-node', host: '192.168.1.30' }
    const activeJobA: MigrateJobView = { ...baseJob, id: 10, status: 'awaiting_confirm' }
    const activeJobB: MigrateJobView = {
      ...baseJob,
      id: 20,
      app_id: 2,
      target_vps_id: 3,
      status: 'transferring'
    }

    let eventCallback: ((event: MigrateEvent) => void) | undefined
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:list') return { ok: true, data: [app, app2] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps, targetVps3] }
      if (channel === 'migrate:list') return { ok: true, data: [activeJobA, activeJobB] }
      if (channel === 'migrate:abort') return { ok: true, data: undefined }
      throw new Error(`unexpected ${channel}: ${JSON.stringify(args)}`)
    })
    const on = vi.fn((_channel: string, cb: (event: MigrateEvent) => void) => {
      eventCallback = cb
      return () => {}
    })
    vi.stubGlobal('api', { invoke, on })

    render(<MigratePage />)
    expect(await screen.findByText(/Có 2 tiến trình đang hoạt động/)).toBeTruthy()

    // Initially job 10 is selected
    expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#10')
    expect(screen.getByText('Chờ xác nhận')).toBeTruthy()

    // Switch to Job 20
    const jobSelector = screen.getByRole('combobox', {
      name: 'Chọn tiến trình cần theo dõi'
    }) as HTMLSelectElement
    expect(jobSelector.value).toBe('10')
    fireEvent.change(jobSelector, { target: { value: '20' } })

    // Screen updates to Job 20
    expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#20')
    expect(screen.getByText('worker-service')).toBeTruthy()
    expect(screen.getByText('Đang chạy')).toBeTruthy()

    // Emit event for Job 10 - must NOT alter Job 20's screen
    eventCallback!({
      type: 'finished',
      job_id: 10,
      status: 'failed',
      downtime_ms: 100,
      error: 'FAIL_JOB_10'
    })

    expect(screen.queryByText('FAIL_JOB_10')).toBeNull()
    expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#20')
    expect(screen.getByText('Đang chạy')).toBeTruthy()

    // Huỷ & rollback operates on Job 20, NOT Job 10
    const cancelBtn = screen.getByRole('button', { name: 'Huỷ & rollback' })
    fireEvent.click(cancelBtn)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('migrate:abort', 20)
    })
  })

  it('ngu canh modal lay tu job context va tu dong dong/khoa modal khi nhan event ket thuc', async () => {
    let eventCallback: ((event: MigrateEvent) => void) | undefined
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [baseJob] }
      throw new Error(`unexpected ${channel}`)
    })
    const on = vi.fn((_channel: string, cb: (event: MigrateEvent) => void) => {
      eventCallback = cb
      return () => {}
    })
    vi.stubGlobal('api', { invoke, on })

    render(<MigratePage />)
    expect(await screen.findByText('Chờ xác nhận')).toBeTruthy()

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận di chuyển' }))
    expect(await screen.findByText('Xác nhận hoàn tất di chuyển ứng dụng')).toBeTruthy()

    // Modal has fixed context details
    expect(screen.getAllByText('demo-service').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/source-node/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/target-node/).length).toBeGreaterThan(0)

    // Receive terminal event for active job while modal is open
    eventCallback!({
      type: 'finished',
      job_id: 7,
      status: 'rolled_back',
      downtime_ms: 120,
      error: 'Đã rollback về app nguồn do sự cố'
    })

    // Modal must be automatically closed & unmounted
    await waitFor(() => {
      expect(screen.queryByText('Xác nhận hoàn tất di chuyển ứng dụng')).toBeNull()
    })
    // Screen reflects terminal rolled_back state
    expect(screen.getByText('Đã rollback')).toBeTruthy()
    expect(screen.getByText(/Đã rollback về app nguồn do sự cố/)).toBeTruthy()
  })

  it('xu ly event den trong luc tai danh sach truoc khi khoi phuc job', async () => {
    let resolveList: (value: { ok: true; data: MigrateJobView[] }) => void
    const listPromise = new Promise<{ ok: true; data: MigrateJobView[] }>((res) => {
      resolveList = res
    })
    let eventCallback: ((event: MigrateEvent) => void) | undefined

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return listPromise
      throw new Error(`unexpected ${channel}`)
    })
    const on = vi.fn((_channel: string, cb: (event: MigrateEvent) => void) => {
      eventCallback = cb
      return () => {}
    })
    vi.stubGlobal('api', { invoke, on })

    render(<MigratePage />)

    // Events arrive while migrate:list is still fetching
    eventCallback!({
      type: 'log',
      job_id: 7,
      step: 'TRANSFER',
      chunk: '[EARLY_LIST_FETCH_LOG] Synchronizing files...'
    })
    eventCallback!({
      type: 'verify-result',
      job_id: 7,
      rows: [{ label: 'Database', source: '5 tables', target: '5 tables', ok: true }]
    })

    // Now migrate:list finishes
    resolveList!({ ok: true, data: [baseJob] })

    // Both the early log and verify row must be rendered after job restore
    await waitFor(() => {
      expect(screen.getByText(/#7/)).toBeTruthy()
      expect(screen.getByText('[EARLY_LIST_FETCH_LOG] Synchronizing files...')).toBeTruthy()
      expect(screen.getByText('Database')).toBeTruthy()
    })
  })

  it('A ket thuc khi B van chay, B van luon tim va chon duoc', async () => {
    const app2: App = { ...app, id: 2, name: 'worker-service' }
    const targetVps3: Vps = { ...targetVps, id: 3, name: 'backup-node', host: '192.168.1.30' }
    const jobA: MigrateJobView = { ...baseJob, id: 10, status: 'transferring' }
    const jobB: MigrateJobView = {
      ...baseJob,
      id: 20,
      app_id: 2,
      target_vps_id: 3,
      status: 'transferring'
    }

    let eventCallback: ((event: MigrateEvent) => void) | undefined
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app, app2] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps, targetVps3] }
      if (channel === 'migrate:list') return { ok: true, data: [jobA, jobB] }
      throw new Error(`unexpected ${channel}`)
    })
    const on = vi.fn((_channel: string, cb: (event: MigrateEvent) => void) => {
      eventCallback = cb
      return () => {}
    })
    vi.stubGlobal('api', { invoke, on })

    render(<MigratePage />)
    expect(await screen.findByText(/Có 2 tiến trình đang hoạt động/)).toBeTruthy()

    // Initially Job A is displayed
    expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#10')

    // Job A finishes while Job B is still running
    eventCallback!({
      type: 'finished',
      job_id: 10,
      status: 'completed',
      downtime_ms: 120
    })

    // Screen reflects Job A has completed
    await waitFor(() => {
      expect(screen.getByText('Hoàn tất')).toBeTruthy()
    })

    // Job selector is STILL accessible because Job B is still running!
    const jobSelector = screen.getByRole('combobox', {
      name: 'Chọn tiến trình cần theo dõi'
    }) as HTMLSelectElement
    expect(jobSelector).toBeTruthy()

    // Switch to Job B
    fireEvent.change(jobSelector, { target: { value: '20' } })

    // Screen now displays Job B
    expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#20')
    expect(screen.getByText('worker-service')).toBeTruthy()
    expect(screen.getByText('Đang chạy')).toBeTruthy()
  })

  it('B nhan hon 100 log roi finished luc khong duoc chon, cap nhat trang thai va khong lam roi finished', async () => {
    const app2: App = { ...app, id: 2, name: 'worker-service' }
    const targetVps3: Vps = { ...targetVps, id: 3, name: 'backup-node', host: '192.168.1.30' }
    const jobA: MigrateJobView = { ...baseJob, id: 10, status: 'awaiting_confirm' }
    const jobB: MigrateJobView = {
      ...baseJob,
      id: 20,
      app_id: 2,
      target_vps_id: 3,
      status: 'transferring'
    }

    let eventCallback: ((event: MigrateEvent) => void) | undefined
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app, app2] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps, targetVps3] }
      if (channel === 'migrate:list') return { ok: true, data: [jobA, jobB] }
      throw new Error(`unexpected ${channel}`)
    })
    const on = vi.fn((_channel: string, cb: (event: MigrateEvent) => void) => {
      eventCallback = cb
      return () => {}
    })
    vi.stubGlobal('api', { invoke, on })

    render(<MigratePage />)
    expect(await screen.findByText('Chờ xác nhận')).toBeTruthy()
    expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#10')

    // While looking at Job A, send >100 log events for Job B
    for (let i = 1; i <= 105; i++) {
      eventCallback!({
        type: 'log',
        job_id: 20,
        step: 'TRANSFER',
        chunk: `[LOG_${i}] Transferring block ${i}\n`
      })
    }

    // Now send finished event for Job B
    eventCallback!({
      type: 'finished',
      job_id: 20,
      status: 'completed',
      downtime_ms: 350
    })

    // Cho UI cap nhat hoan toan truoc khi tim va chon Job B
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /#20.*Hoàn tất/ })).toBeTruthy()
      expect(screen.getByText(/Có 1 tiến trình đang hoạt động/)).toBeTruthy()
    })

    // Now switch selector to Job B
    const jobSelector = screen.getByRole('combobox', {
      name: 'Chọn tiến trình cần theo dõi'
    }) as HTMLSelectElement
    fireEvent.change(jobSelector, { target: { value: '20' } })

    // Verify Job B is rendered with terminal completed status and full logs
    await waitFor(() => {
      expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#20')
      expect(screen.getByText('Hoàn tất')).toBeTruthy()
      expect(screen.getByText(/350 ms/)).toBeTruthy()
      expect(screen.getByText(/\[LOG_105\]/)).toBeTruthy()
    })

    // Verify copy buffer preserves early logs as well
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: /Sao chép/ }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[LOG_1]'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[LOG_105]'))
  })

  it('chuyen A<->B khong lan tien do hoac gui sai job ID', async () => {
    const app2: App = { ...app, id: 2, name: 'worker-service' }
    const targetVps3: Vps = { ...targetVps, id: 3, name: 'backup-node', host: '192.168.1.30' }
    const jobA: MigrateJobView = {
      ...baseJob,
      id: 10,
      app_id: 1,
      target_vps_id: 2,
      status: 'awaiting_confirm',
      verify_json: JSON.stringify({
        ok: true,
        rows: [{ label: 'DatabaseSchema', source: '5 tables', target: '5 tables', ok: true }]
      })
    }
    const jobB: MigrateJobView = {
      ...baseJob,
      id: 20,
      app_id: 2,
      target_vps_id: 3,
      status: 'transferring',
      verify_json: null
    }

    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'app:list') return { ok: true, data: [app, app2] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps, targetVps3] }
      if (channel === 'migrate:list') return { ok: true, data: [jobA, jobB] }
      if (channel === 'migrate:abort') return { ok: true, data: undefined }
      if (channel === 'migrate:confirm') return { ok: true, data: undefined }
      throw new Error(`unexpected ${channel}: ${JSON.stringify(args)}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)
    expect(await screen.findByText('DatabaseSchema')).toBeTruthy()
    expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#10')
    expect(screen.getByText('Chờ xác nhận')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Xác nhận di chuyển' })).toBeTruthy()

    // Switch to Job B
    const jobSelector = screen.getByRole('combobox', {
      name: 'Chọn tiến trình cần theo dõi'
    }) as HTMLSelectElement
    fireEvent.change(jobSelector, { target: { value: '20' } })

    // On Job B: verify table from Job A must NOT be displayed!
    expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#20')
    expect(screen.getByText('Đang chạy')).toBeTruthy()
    expect(screen.queryByText('DatabaseSchema')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xác nhận di chuyển' })).toBeNull()

    // Clicking abort on Job B must send Job ID 20
    const cancelBtn = screen.getByRole('button', { name: 'Huỷ & rollback' })
    fireEvent.click(cancelBtn)
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('migrate:abort', 20)
    })

    // Switch back to Job A
    fireEvent.change(jobSelector, { target: { value: '10' } })

    // On Job A: DatabaseSchema and confirmation are restored
    expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#10')
    expect(screen.getByText('DatabaseSchema')).toBeTruthy()
    expect(screen.getByText('Chờ xác nhận')).toBeTruthy()

    // Confirm Job A must send Job ID 10
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận di chuyển' }))
    expect(await screen.findByText('Xác nhận hoàn tất di chuyển ứng dụng')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Giữ app nguồn' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('migrate:confirm', 10, true)
    })
  })

  it('neu finished den truoc khi migrate:list tra du lieu cu, trang thai ket thuc tu event phai thang ban danh sach cu', async () => {
    const app2: App = { ...app, id: 2, name: 'worker-service' }
    const targetVps3: Vps = { ...targetVps, id: 3, name: 'backup-node', host: '192.168.1.30' }
    const jobA: MigrateJobView = {
      ...baseJob,
      id: 10,
      status: 'transferring'
    }
    const staleJobB: MigrateJobView = {
      ...baseJob,
      id: 20,
      app_id: 2,
      target_vps_id: 3,
      status: 'transferring' // Stale data from backend snapshot
    }

    let resolveList: (value: { ok: true; data: MigrateJobView[] }) => void
    const listPromise = new Promise<{ ok: true; data: MigrateJobView[] }>((res) => {
      resolveList = res
    })
    let eventCallback: ((event: MigrateEvent) => void) | undefined

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app, app2] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps, targetVps3] }
      if (channel === 'migrate:list') return listPromise
      throw new Error(`unexpected ${channel}`)
    })
    const on = vi.fn((_channel: string, cb: (event: MigrateEvent) => void) => {
      eventCallback = cb
      return () => {}
    })
    vi.stubGlobal('api', { invoke, on })

    render(<MigratePage />)

    // Event finished arrives for Job 20 while migrate:list is STILL pending
    eventCallback!({
      type: 'finished',
      job_id: 20,
      status: 'completed',
      downtime_ms: 280
    })

    // Now migrate:list resolves with STALE data (Job 20 still transferring in list)
    resolveList!({ ok: true, data: [jobA, staleJobB] })

    // Active job should be Job 10 (since Job 20 is already finished)
    await waitFor(() => {
      expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#10')
      expect(screen.getByText('Đang chạy')).toBeTruthy()
      expect(screen.getByText(/Có 1 tiến trình đang hoạt động/)).toBeTruthy()
    })

    // In selector, Job 20 must display "Hoàn tất" because terminal event beats stale list
    expect(screen.getByRole('option', { name: /#20.*Hoàn tất/ })).toBeTruthy()

    // Switch to Job 20
    const jobSelector = screen.getByRole('combobox', {
      name: 'Chọn tiến trình cần theo dõi'
    }) as HTMLSelectElement
    fireEvent.change(jobSelector, { target: { value: '20' } })

    // Job 20 must show completed status with downtime, NOT running
    await waitFor(() => {
      expect(screen.getByText('Job ID:').parentElement?.textContent).toContain('#20')
      expect(screen.getByText('Hoàn tất')).toBeTruthy()
      expect(screen.getByText(/280 ms/)).toBeTruthy()
    })
  })

  it('chuyen doi du 4 ngon ngu (vi, en, cn, jp) cap nhat dung tieu de, trang thai, buoc, terminal va verify; giu nguyen loi tho', async () => {
    const runningJob: MigrateJobView = {
      id: 55,
      app_id: 1,
      source_vps_id: 1,
      target_vps_id: 2,
      status: 'transferring',
      failed_step: null,
      error_message: null,
      downtime_ms: 120,
      bytes_transferred: 2048,
      verify_json: JSON.stringify({
        ok: true,
        rows: [
          { label: 'container', source: 'running', target: 'running', ok: true },
          { label: 'http_response', source: '200 OK', target: '200 OK', ok: true }
        ]
      }),
      source_kept: null,
      started_at: '2026-01-01T00:00:00Z',
      finished_at: null
    }

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [sourceVps, targetVps] }
      if (channel === 'migrate:list') return { ok: true, data: [runningJob] }
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    // 1. VI (default)
    useUiState.setState({ locale: 'vi' })
    const { rerender } = render(<MigratePage />)

    expect(await screen.findByText('Migrate giữa hai VPS')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bắt đầu migrate' })).toBeTruthy()
    expect(screen.getByText('Truyền dữ liệu')).toBeTruthy()
    expect(screen.getByText(/Truyền dữ liệu · 3\/7/)).toBeTruthy()
    expect(screen.getByText('Kết quả kiểm tra (VERIFY)')).toBeTruthy()

    // 2. EN
    useUiState.setState({ locale: 'en' })
    rerender(<MigratePage />)

    expect(screen.getByText('Migrate between two VPS')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start migration' })).toBeTruthy()
    expect(screen.getByText('Transfer')).toBeTruthy()
    expect(screen.getByText(/Transfer · 3\/7/)).toBeTruthy()
    expect(screen.getByText('Verification Results (VERIFY)')).toBeTruthy()

    // 3. CN
    useUiState.setState({ locale: 'cn' })
    rerender(<MigratePage />)

    expect(screen.getByText('VPS 之间迁移')).toBeTruthy()
    expect(screen.getByRole('button', { name: '开始迁移' })).toBeTruthy()
    expect(screen.getByText('传输')).toBeTruthy()
    expect(screen.getByText(/传输 · 3\/7/)).toBeTruthy()
    expect(screen.getByText('验证检查结果 (VERIFY)')).toBeTruthy()

    // 4. JP
    useUiState.setState({ locale: 'jp' })
    rerender(<MigratePage />)

    expect(screen.getByText('VPS間マイグレーション')).toBeTruthy()
    expect(screen.getByRole('button', { name: '移行開始' })).toBeTruthy()
    expect(screen.getByText('データ転送')).toBeTruthy()
    expect(screen.getByText(/データ転送 · 3\/7/)).toBeTruthy()
    expect(screen.getByText('検証結果（VERIFY）')).toBeTruthy()

    // Reset back to VI
    useUiState.setState({ locale: 'vi' })
  })
})
