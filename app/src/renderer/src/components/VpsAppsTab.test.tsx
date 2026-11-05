// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App, Deployment, DiscoveredVpsApp } from '@shared/ipc'
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
  imported_from_vps: 0,
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
  imported_from_vps: 0,
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
  imported_from_vps: 0,
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
    origin: 'opspilot',
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
    origin: 'opspilot',
    finished_at: '2026-10-01T00:01:00Z',
    exposure_status: 'reachable',
    exposure_evidence_json: null
  }
]

const VERIFIED_CANDIDATE: DiscoveredVpsApp = {
  name: 'verified-app',
  image_tag: 'verified-app:v3',
  version: 3,
  host_port: 32001,
  container_port: 3000,
  state: 'running',
  recovery_status: 'verified',
  recovery_reason: null,
  framework: 'express',
  source_type: 'git',
  git_remote: 'https://github.com/example/app.git',
  git_ref: 'main',
  git_root: '.',
  healthcheck: '/health',
  needs_db: false
}

const LEGACY_MANAGED: DiscoveredVpsApp = {
  ...VERIFIED_CANDIDATE,
  name: APP_MATCHING.name,
  image_tag: 'v3',
  host_port: APP_MATCHING.host_port,
  container_port: APP_MATCHING.container_port,
  recovery_status: 'legacy',
  recovery_reason: 'manifest_missing',
  framework: null,
  source_type: null,
  git_remote: null,
  git_ref: null,
  git_root: null,
  healthcheck: null,
  needs_db: null
}

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
            container_port: null,
            state: 'running',
            recovery_status: 'legacy',
            recovery_reason: 'manifest_missing',
            framework: null,
            source_type: null,
            git_remote: null,
            git_ref: null,
            git_root: null,
            healthcheck: null,
            needs_db: null
          }
        ]
      })
    })

    render(<VpsAppsTab vpsId={10} />)

    expect(await screen.findByText('legacy-app')).toBeTruthy()
    expect(screen.getByText('Phát hiện trên VPS')).toBeTruthy()
    expect(screen.getByText('legacy-app:v4')).toBeTruthy()
    expect(screen.getByText('Ứng dụng cũ: thiếu manifest')).toBeTruthy()
    expect(screen.getByText('Metadata đã xác minh')).toBeTruthy()
    expect(screen.queryByText('Triển khai lại')).toBeNull()
  })

  it('shows verified recovery status and sanitized metadata in all four locales', async () => {
    mockApi({
      'app:list': async () => ({ ok: true, data: [] }),
      'vps:discover-apps': async () => ({
        ok: true,
        data: [
          {
            name: 'verified-app',
            image_tag: 'verified-app:v3',
            version: 3,
            host_port: 32001,
            container_port: 3000,
            state: 'running',
            recovery_status: 'verified',
            recovery_reason: null,
            framework: 'express',
            source_type: 'git',
            git_remote: 'https://github.com/example/app.git',
            git_ref: 'main',
            git_root: '.',
            healthcheck: '/health',
            needs_db: false
          }
        ]
      })
    })

    const { rerender } = render(<VpsAppsTab vpsId={10} />)
    expect(await screen.findByText('verified-app')).toBeTruthy()
    expect(
      screen.getByText(
        (content) =>
          content.includes('https://github.com/example/app.git') &&
          content.includes('needs_db:false')
      )
    ).toBeTruthy()
    for (const locale of ['en', 'vi', 'cn', 'jp'] as const) {
      useUiState.setState({ locale })
      rerender(<VpsAppsTab vpsId={10} />)
      expect(
        await screen.findByText(getStrings(locale).vpsControl.apps.recoveryStatus.verified)
      ).toBeTruthy()
    }
  })
  it('shows the unreadable manifest reason in all four locales', async () => {
    mockApi({
      'app:list': async () => ({ ok: true, data: [] }),
      'vps:discover-apps': async () => ({
        ok: true,
        data: [
          {
            name: 'unreadable-app',
            image_tag: 'unreadable-app:v3',
            version: 3,
            host_port: 32001,
            container_port: 3000,
            state: 'running',
            recovery_status: 'unverifiable',
            recovery_reason: 'manifest_unreadable',
            framework: null,
            source_type: null,
            git_remote: null,
            git_ref: null,
            git_root: null,
            healthcheck: null,
            needs_db: null
          }
        ]
      })
    })

    const { rerender } = render(<VpsAppsTab vpsId={10} />)
    for (const locale of ['en', 'vi', 'cn', 'jp'] as const) {
      useUiState.setState({ locale })
      rerender(<VpsAppsTab vpsId={10} />)
      expect(
        await screen.findByText(
          getStrings(locale).vpsControl.apps.recoveryStatus.manifestUnreadable
        )
      ).toBeTruthy()
    }
  })
  it('provides confirmation copy in all four locales', () => {
    for (const locale of ['en', 'vi', 'cn', 'jp'] as const) {
      const confirmation = getStrings(locale).vpsControl.apps.importConfirmation
      expect(confirmation.title).toBeTruthy()
      expect(confirmation.name).toBeTruthy()
      expect(confirmation.imageVersion).toBeTruthy()
      expect(confirmation.port).toBeTruthy()
      expect(confirmation.readOnly).toBeTruthy()
      expect(confirmation.confirm).toBeTruthy()
      expect(confirmation.cancel).toBeTruthy()
    }
  })

  it('shows preparation copy in all four locales', () => {
    for (const locale of ['en', 'vi', 'cn', 'jp'] as const) {
      const copy = getStrings(locale).vpsControl.apps.recoveryPreparation
      expect(copy.action).toBeTruthy()
      expect(copy.explanation).toBeTruthy()
      expect(copy.created).toBeTruthy()
      expect(copy.alreadyExists).toBeTruthy()
      expect(copy.noLocalRecord).toBeTruthy()
    }
  })

  it('requires confirmation before creating a manifest and explains the action', async () => {
    mockApi({
      'app:list': async () => ({ ok: true, data: [APP_MATCHING] }),
      'app:versions': async () => ({ ok: true, data: [VERSIONS[1]] }),
      'vps:discover-apps': async () => ({ ok: true, data: [LEGACY_MANAGED] }),
      'vps:write-recovery-manifest': async () => ({ ok: true, data: { created: true } })
    })
    render(<VpsAppsTab vpsId={10} />)
    const copy = getStrings('vi').vpsControl.apps.recoveryPreparation
    const actionButton = await screen.findByRole('button', { name: copy.action })
    expect(actionButton.closest('tr')?.textContent).toContain(APP_MATCHING.name)
    fireEvent.click(actionButton)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(APP_MATCHING.name)
    expect(dialog.textContent).toContain(LEGACY_MANAGED.image_tag)
    expect(dialog.textContent).toContain(copy.explanation)
    expect(window.api.invoke).not.toHaveBeenCalledWith(
      'vps:write-recovery-manifest',
      10,
      APP_MATCHING.name
    )
    fireEvent.click(screen.getByRole('button', { name: copy.cancel }))
    expect(window.api.invoke).not.toHaveBeenCalledWith(
      'vps:write-recovery-manifest',
      10,
      APP_MATCHING.name
    )
    fireEvent.click(await screen.findByRole('button', { name: copy.action }))
    fireEvent.click(screen.getByRole('button', { name: copy.confirm }))
    await screen.findByText(copy.savedUnverified)
    expect(window.api.invoke).toHaveBeenCalledWith(
      'vps:write-recovery-manifest',
      10,
      APP_MATCHING.name
    )
  })

  it('shows the newly verified result after successful write and rescan, including already-present result', async () => {
    let scanCount = 0
    mockApi({
      'app:list': async () => ({ ok: true, data: [APP_MATCHING] }),
      'app:versions': async () => ({ ok: true, data: [VERSIONS[1]] }),
      'vps:discover-apps': async () => ({
        ok: true,
        data: [
          ++scanCount === 1
            ? LEGACY_MANAGED
            : { ...LEGACY_MANAGED, recovery_status: 'verified', recovery_reason: null }
        ]
      }),
      'vps:write-recovery-manifest': async () => ({ ok: true, data: { created: false } })
    })
    render(<VpsAppsTab vpsId={10} />)
    const copy = getStrings('vi').vpsControl.apps.recoveryPreparation
    fireEvent.click(await screen.findByRole('button', { name: copy.action }))
    fireEvent.click(await screen.findByRole('button', { name: copy.confirm }))
    expect(await screen.findByText(copy.alreadyExists)).toBeTruthy()
    expect(
      await screen.findByText(getStrings('vi').vpsControl.apps.recoveryStatus.verified)
    ).toBeTruthy()
    expect(scanCount).toBeGreaterThanOrEqual(2)
  })

  it('hides preparation unless the local running deployment and legacy runtime snapshot match', async () => {
    for (const candidate of [
      { ...LEGACY_MANAGED, state: 'exited' },
      { ...LEGACY_MANAGED, recovery_status: 'mismatch', recovery_reason: 'runtime_mismatch' },
      { ...LEGACY_MANAGED, recovery_status: 'invalid', recovery_reason: 'manifest_invalid' },
      { ...LEGACY_MANAGED, image_tag: 'other:v9' }
    ]) {
      mockApi({
        'app:list': async () => ({ ok: true, data: [APP_MATCHING] }),
        'app:versions': async () => ({ ok: true, data: [VERSIONS[1]] }),
        'vps:discover-apps': async () => ({ ok: true, data: [candidate] })
      })
      const { unmount } = render(<VpsAppsTab vpsId={10} />)
      expect(await screen.findByText(APP_MATCHING.name)).toBeTruthy()
      expect(
        screen.queryByRole('button', {
          name: getStrings('vi').vpsControl.apps.recoveryPreparation.action
        })
      ).toBeNull()
      unmount()
      cleanup()
    }
    mockApi({
      'app:list': async () => ({ ok: true, data: [] }),
      'vps:discover-apps': async () => ({ ok: true, data: [LEGACY_MANAGED] })
    })
    render(<VpsAppsTab vpsId={10} />)
    expect(
      await screen.findByText(getStrings('vi').vpsControl.apps.recoveryPreparation.noLocalRecord)
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', {
        name: getStrings('vi').vpsControl.apps.recoveryPreparation.action
      })
    ).toBeNull()
  })

  it('shows preparation errors and permits retry', async () => {
    let writes = 0
    let scans = 0
    mockApi({
      'app:list': async () => ({ ok: true, data: [APP_MATCHING] }),
      'app:versions': async () => ({ ok: true, data: [VERSIONS[1]] }),
      'vps:discover-apps': async () => {
        scans += 1
        return {
          ok: true,
          data: [
            scans === 1
              ? LEGACY_MANAGED
              : { ...LEGACY_MANAGED, recovery_status: 'verified', recovery_reason: null }
          ]
        }
      },
      'vps:write-recovery-manifest': async () =>
        ++writes === 1
          ? { ok: false, error: { code: 'FAIL', message: 'Write failed' } }
          : { ok: true, data: { created: true } }
    })
    render(<VpsAppsTab vpsId={10} />)
    const copy = getStrings('vi').vpsControl.apps.recoveryPreparation
    fireEvent.click(await screen.findByRole('button', { name: copy.action }))
    fireEvent.click(screen.getByRole('button', { name: copy.confirm }))
    expect(await screen.findByText('Write failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: copy.retry }))
    expect(await screen.findByText(copy.created)).toBeTruthy()
    expect(writes).toBe(2)
  })

  it('hides preparation for imported apps and when discovery fails', async () => {
    const importedApp = { ...APP_MATCHING, imported_from_vps: 1 }
    mockApi({
      'app:list': async () => ({ ok: true, data: [importedApp] }),
      'app:versions': async () => ({ ok: true, data: [VERSIONS[1]] }),
      'vps:discover-apps': async () => ({ ok: true, data: [LEGACY_MANAGED] })
    })
    const importedView = render(<VpsAppsTab vpsId={10} />)
    const action = getStrings('vi').vpsControl.apps.recoveryPreparation.action
    expect(await screen.findByText(APP_MATCHING.name)).toBeTruthy()
    expect(screen.queryByRole('button', { name: action })).toBeNull()
    importedView.unmount()
    cleanup()

    mockApi({
      'app:list': async () => ({ ok: true, data: [APP_MATCHING] }),
      'app:versions': async () => ({ ok: true, data: [VERSIONS[1]] }),
      'vps:discover-apps': async () => ({
        ok: false,
        error: { code: 'SSH', message: 'Scan unavailable' }
      })
    })
    render(<VpsAppsTab vpsId={10} />)
    expect(await screen.findByText('Scan unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: action })).toBeNull()
    expect(window.api.invoke).not.toHaveBeenCalledWith(
      'vps:write-recovery-manifest',
      expect.anything(),
      expect.anything()
    )
  })

  it('ignores a late manifest response after switching VPS', async () => {
    let finishWrite: ((value: unknown) => void) | undefined
    mockApi({
      'app:list': async () => ({ ok: true, data: [APP_MATCHING] }),
      'app:versions': async () => ({ ok: true, data: [VERSIONS[1]] }),
      'vps:discover-apps': async () => ({ ok: true, data: [LEGACY_MANAGED] }),
      'vps:write-recovery-manifest': () =>
        new Promise((resolve) => {
          finishWrite = resolve
        })
    })
    const { rerender } = render(<VpsAppsTab vpsId={10} />)
    const copy = getStrings('vi').vpsControl.apps.recoveryPreparation
    fireEvent.click(await screen.findByRole('button', { name: copy.action }))
    fireEvent.click(screen.getByRole('button', { name: copy.confirm }))
    await vi.waitFor(() => expect(finishWrite).toBeDefined())
    rerender(<VpsAppsTab vpsId={11} />)
    finishWrite?.({ ok: true, data: { created: true } })
    await vi.waitFor(() => expect(window.api.invoke).toHaveBeenCalledWith('vps:discover-apps', 11))
    expect(screen.queryByText(copy.created)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores a late response from VPS A after switching A to B and back to A', async () => {
    let finishWrite: ((value: unknown) => void) | undefined
    mockApi({
      'app:list': async (vpsId: unknown) => ({
        ok: true,
        data: [{ ...APP_MATCHING, vps_id: vpsId as number }]
      }),
      'app:versions': async () => ({ ok: true, data: [VERSIONS[1]] }),
      'vps:discover-apps': async () => ({ ok: true, data: [LEGACY_MANAGED] }),
      'vps:write-recovery-manifest': () =>
        new Promise((resolve) => {
          finishWrite = resolve
        })
    })
    const { rerender } = render(<VpsAppsTab vpsId={10} />)
    const copy = getStrings('vi').vpsControl.apps.recoveryPreparation
    fireEvent.click(await screen.findByRole('button', { name: copy.action }))
    fireEvent.click(screen.getByRole('button', { name: copy.confirm }))
    await vi.waitFor(() => expect(finishWrite).toBeDefined())

    rerender(<VpsAppsTab vpsId={11} />)
    rerender(<VpsAppsTab vpsId={10} />)
    expect(await screen.findByRole('button', { name: copy.action })).toBeTruthy()
    finishWrite?.({ ok: true, data: { created: true } })
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(window.api.invoke)
          .mock.calls.filter((call) => call[0] === 'vps:discover-apps' && call[1] === 10)
      ).toHaveLength(2)
    )
    expect(screen.queryByText(copy.created)).toBeNull()
    expect(screen.queryByText(copy.savedUnverified)).toBeNull()
  })

  it('does not show stale app or scan data while changing VPS', async () => {
    let finishAppsA: ((value: unknown) => void) | undefined
    let finishScanA: ((value: unknown) => void) | undefined
    mockApi({
      'app:list': (vpsId: unknown) =>
        vpsId === 10
          ? new Promise((resolve) => {
              finishAppsA = resolve
            })
          : Promise.resolve({
              ok: true,
              data: [{ ...APP_MATCHING, name: 'app-on-b', vps_id: 11 }]
            }),
      'app:versions': async () => ({ ok: true, data: [VERSIONS[1]] }),
      'vps:discover-apps': (vpsId: unknown) =>
        vpsId === 10
          ? new Promise((resolve) => {
              finishScanA = resolve
            })
          : Promise.resolve({ ok: true, data: [] })
    })
    const { rerender } = render(<VpsAppsTab vpsId={10} />)
    await vi.waitFor(() => {
      expect(finishAppsA).toBeDefined()
      expect(finishScanA).toBeDefined()
    })
    rerender(<VpsAppsTab vpsId={11} />)
    expect(await screen.findByText('app-on-b')).toBeTruthy()
    finishAppsA?.({ ok: true, data: [{ ...APP_MATCHING, name: 'stale-app-from-a' }] })
    finishScanA?.({ ok: true, data: [LEGACY_MANAGED] })
    await Promise.resolve()
    expect(screen.queryByText('stale-app-from-a')).toBeNull()
    expect(screen.queryByText('legacy-app')).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: getStrings('vi').vpsControl.apps.recoveryPreparation.action
      })
    ).toBeNull()
  })

  it('reports a saved but unverified manifest after scan failure and retry only scans', async () => {
    let scanCount = 0
    let writeCount = 0
    mockApi({
      'app:list': async () => ({ ok: true, data: [APP_MATCHING] }),
      'app:versions': async () => ({ ok: true, data: [VERSIONS[1]] }),
      'vps:discover-apps': async () => {
        scanCount += 1
        if (scanCount === 1) return { ok: true, data: [LEGACY_MANAGED] }
        if (scanCount === 2) return { ok: false, error: { code: 'SSH', message: 'Scan failed' } }
        return {
          ok: true,
          data: [{ ...LEGACY_MANAGED, recovery_status: 'verified', recovery_reason: null }]
        }
      },
      'vps:write-recovery-manifest': async () => {
        writeCount += 1
        return { ok: true, data: { created: true } }
      }
    })
    render(<VpsAppsTab vpsId={10} />)
    const copy = getStrings('vi').vpsControl.apps.recoveryPreparation
    fireEvent.click(await screen.findByRole('button', { name: copy.action }))
    fireEvent.click(screen.getByRole('button', { name: copy.confirm }))
    expect(await screen.findByText(copy.savedUnverified)).toBeTruthy()
    expect(screen.queryByText(copy.created)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: copy.retryScan }))
    expect(
      await screen.findByText(getStrings('vi').vpsControl.apps.recoveryStatus.verified)
    ).toBeTruthy()
    expect(writeCount).toBe(1)
    expect(scanCount).toBe(3)
  })

  it('shows import details and cancellation never calls the import IPC', async () => {
    useUiState.setState({ locale: 'vi' })
    mockApi({
      'app:list': async () => ({ ok: true, data: [] }),
      'vps:discover-apps': async () => ({ ok: true, data: [VERIFIED_CANDIDATE] })
    })
    render(<VpsAppsTab vpsId={10} />)

    const strings = getStrings('vi').vpsControl.apps
    fireEvent.click(await screen.findByRole('button', { name: strings.importVerified }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(VERIFIED_CANDIDATE.name)
    expect(dialog.textContent).toContain('verified-app:v3 (v3)')
    expect(dialog.textContent).toContain(String(VERIFIED_CANDIDATE.host_port))
    expect(dialog.textContent).toContain(String(VERIFIED_CANDIDATE.container_port))
    expect(dialog.textContent).toContain(strings.importConfirmation.readOnly)
    fireEvent.click(screen.getByRole('button', { name: strings.importConfirmation.cancel }))
    expect(window.api.invoke).not.toHaveBeenCalledWith(
      'vps:import-app',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  it('imports only after confirmation and hides redeploy after it becomes an imported app', async () => {
    const importedApp: App = {
      ...APP_MATCHING,
      id: 55,
      name: 'verified-app',
      imported_from_vps: 1,
      current_deployment_id: 77
    }
    const importedDeployment: Deployment = {
      ...VERSIONS[1],
      id: 77,
      app_id: 55,
      version: 3,
      image_tag: 'verified-app:v3',
      origin: 'vps_import',
      started_at: null,
      total_duration_ms: null,
      build_duration_ms: null
    }
    let appLoads = 0
    const candidate = VERIFIED_CANDIDATE
    mockApi({
      'app:list': async () => ({
        ok: true,
        data: appLoads++ === 0 ? [] : [importedApp]
      }),
      'app:versions': async () => ({ ok: true, data: [importedDeployment] }),
      'vps:discover-apps': async () => ({
        ok: true,
        data: appLoads > 1 ? [] : [candidate]
      }),
      'vps:import-app': async () => ({ ok: true, data: { app_id: 55, deployment_id: 77 } })
    })

    render(<VpsAppsTab vpsId={10} />)
    const importButton = await screen.findByRole('button', {
      name: getStrings('vi').vpsControl.apps.importVerified
    })
    fireEvent.click(importButton)
    const confirmation = getStrings('vi').vpsControl.apps.importConfirmation
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).toContain('verified-app:v3 (v3)')
    expect(screen.getByRole('dialog').textContent).toContain(String(candidate.host_port))
    expect(screen.getByRole('dialog').textContent).toContain(String(candidate.container_port))
    expect(screen.getByRole('dialog').textContent).toContain(confirmation.readOnly)
    expect(window.api.invoke).not.toHaveBeenCalledWith(
      'vps:import-app',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
    fireEvent.click(screen.getByRole('button', { name: confirmation.confirm }))
    expect(
      await screen.findByText(getStrings('vi').vpsControl.apps.recoveryStatus.importedFromVps)
    ).toBeTruthy()
    expect(screen.queryByText(getStrings('vi').vpsControl.apps.redeploy)).toBeNull()
    expect(window.api.invoke).toHaveBeenCalledWith('vps:import-app', 10, 'verified-app', {
      recovery_status: 'verified',
      image_tag: candidate.image_tag,
      version: candidate.version,
      host_port: candidate.host_port,
      container_port: candidate.container_port,
      state: candidate.state,
      framework: candidate.framework,
      source_type: candidate.source_type,
      git_remote: candidate.git_remote,
      git_ref: candidate.git_ref,
      git_root: candidate.git_root,
      healthcheck: candidate.healthcheck,
      needs_db: candidate.needs_db
    })
  })
})
