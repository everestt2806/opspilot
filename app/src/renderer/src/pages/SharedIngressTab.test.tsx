// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App as AntApp } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RenderResult } from '@testing-library/react'
import type { SharedIngressBindingDto } from '@shared/ipc'
import { SharedIngressTab } from './SharedIngressTab'
import { useUiState } from '../store/uiState'

const binding = (patch: Partial<SharedIngressBindingDto> = {}): SharedIngressBindingDto => ({
  vps_id: 1,
  binding_id: 2,
  app_id: 3,
  hostname: 'demo.example.test',
  operation: 'read',
  status: 'ready',
  failed_step: null,
  reason: null,
  retryable: true,
  http_url: 'http://198.51.100.2:30000',
  dns_status: 'pending',
  route_status: 'pending',
  certificate_status: 'not_requested',
  https_probe_status: 'not_run',
  ...patch
})
function mount(
  handler: (channel: string, ...args: unknown[]) => Promise<unknown>,
  props = { vpsId: 1, appId: 3, httpUrl: 'http://198.51.100.2:30000', active: true },
  statusOverride?: SharedIngressBindingDto
): RenderResult & { invoke: ReturnType<typeof vi.fn> } {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (media: string) => ({
        matches: false,
        media,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      })
    })
  }
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'domain:ingress-status') {
      if (statusOverride) return ok(statusOverride)
      const listed = (await handler('domain:ingress-list', {
        vps_id: props.vpsId,
        app_id: props.appId
      })) as { ok: boolean; data?: SharedIngressBindingDto[] }
      const bindingId = (args[0] as { binding_id?: number } | undefined)?.binding_id
      return listed.ok
        ? ok(
            listed.data?.find((item) => item.binding_id === bindingId) ??
              listed.data?.[0] ??
              binding()
          )
        : listed
    }
    return handler(channel, ...args)
  })
  vi.stubGlobal('api', { invoke, on: () => () => {} })
  const view = render(
    <AntApp>
      <SharedIngressTab {...props} />
    </AntApp>
  )
  return { ...view, invoke }
}
const ok = <T,>(data: T): { ok: true; data: T } => ({ ok: true as const, data })
const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('SharedIngressTab', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })
  it('shows loading, retries read errors, and has a correct empty state without actions', async () => {
    let calls = 0
    const firstRead = deferred<unknown>()
    const { invoke } = mount(async (channel) => {
      if (channel === 'domain:ingress-list' && calls++ === 0) return firstRead.promise
      if (channel === 'domain:ingress-list') return ok([])
      throw new Error('unexpected action')
    })
    await waitFor(() => expect(document.querySelector('.ant-spin-spinning')).toBeTruthy())
    firstRead.resolve({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'raw' } })
    expect(await screen.findByText('Không thể tải trạng thái tên miền.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('Ứng dụng chưa có tên miền dùng ingress chung.')).toBeTruthy()
    expect(screen.getByText(/Deploy Wizard/)).toBeTruthy()
    expect(invoke.mock.calls.some(([name]) => name === 'domain:ingress-action')).toBe(false)
  })
  it('shows disabled state without offering a write or HTTPS action', async () => {
    const { invoke } = mount(async () =>
      ok([
        binding({
          status: 'blocked',
          route_status: 'disabled',
          reason: { code: 'BINDING_DISABLED', message: 'raw' },
          retryable: false
        })
      ])
    )
    expect(await screen.findByText('Tên miền này đã bị tắt.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Thiết lập HTTPS' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kiểm tra HTTPS lại' })).toBeNull()
    expect(invoke.mock.calls.some(([channel]) => channel === 'domain:ingress-action')).toBe(false)
  })
  it('keeps HTTP fallback and withholds HTTPS unless all persisted evidence is active', async () => {
    const { invoke } = mount(async () =>
      ok([
        binding({
          status: 'degraded',
          route_status: 'failed',
          reason: { code: 'RECONCILE_BLOCKED', message: 'unsafe raw' }
        })
      ])
    )
    expect(await screen.findByText('http://198.51.100.2:30000')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mở HTTPS' })).toBeNull()
    expect(screen.getByText(/RECONCILE_BLOCKED/)).toBeTruthy()
    expect(screen.queryByText('unsafe raw')).toBeNull()
    await act(async () => {
      invoke.mockClear()
    })
  })
  it('asks confirmation then runs install, reconcile and HTTPS check in order', async () => {
    const calls: string[] = []
    let latest = binding()
    const { invoke } = mount(async (channel, arg) => {
      if (channel === 'domain:ingress-list') return ok([latest])
      const action = (arg as { action: string }).action
      calls.push(action)
      if (action === 'install') latest = binding({ operation: 'install', status: 'installed' })
      else if (action === 'reconcile')
        latest = binding({ operation: 'reconcile', status: 'reconciled_pending' })
      else
        latest = binding({
          operation: 'https_check',
          status: 'active',
          dns_status: 'propagated',
          route_status: 'active',
          certificate_status: 'valid',
          https_probe_status: 'passed'
        })
      return ok(latest)
    })
    await screen.findByRole('heading', { name: /Domain & HTTPS|Tên miền & HTTPS/ })
    fireEvent.click(screen.getByRole('button', { name: 'Thiết lập HTTPS' }))
    expect(calls).toEqual([])
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục' }))
    await waitFor(() => expect(calls).toEqual(['install', 'reconcile', 'https_check']))
    expect(await screen.findByText('HTTPS đang hoạt động')).toBeTruthy()
    expect(
      screen.getAllByRole('button').some((button) => button.textContent?.includes('HTTPS'))
    ).toBe(true)
    expect(invoke).toHaveBeenCalledWith('domain:ingress-action', {
      vps_id: 1,
      binding_id: 2,
      action: 'install'
    })
    expect(invoke).toHaveBeenCalledWith('domain:ingress-status', { vps_id: 1, binding_id: 2 })
  })
  it('cancels confirmation and stops at blocked or uncertain step without retrying writes', async () => {
    const calls: string[] = []
    const { invoke } = mount(
      async (channel, arg) => {
        if (channel === 'domain:ingress-list') return ok([binding({ vps_id: 51, binding_id: 52 })])
        const action = (arg as { action: string }).action
        calls.push(action)
        return ok(
          binding({
            vps_id: 51,
            binding_id: 52,
            status: action === 'install' ? 'uncertain' : 'blocked',
            reason: { code: 'INSTALL_UNCERTAIN', message: 'raw' }
          })
        )
      },
      { vpsId: 51, appId: 3, httpUrl: 'http://198.51.100.2:30000', active: true }
    )
    await screen.findByRole('heading', { name: /Domain & HTTPS|Tên miền & HTTPS/ })
    fireEvent.click(screen.getByRole('button', { name: 'Thiết lập HTTPS' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy' }))
    expect(calls).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Thiết lập HTTPS' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục' }))
    await screen.findAllByText(/Thao tác trước có thể đã hoàn tất/)
    await waitFor(() => expect(document.querySelector('.ant-btn-loading')).toBeNull())
    // The completed DB refresh reports ready, but it cannot prove the earlier
    // install write did not finish remotely. The binding remains locked.
    expect(invoke).toHaveBeenCalledWith('domain:ingress-status', { vps_id: 51, binding_id: 52 })
    expect(calls).toEqual(['install'])
    expect(screen.queryByRole('button', { name: 'Thiết lập HTTPS' })).toBeNull()
  })
  it('keeps an uncertain write locked after list and status refresh complete', async () => {
    let latest = binding({ vps_id: 61, binding_id: 62 })
    const { invoke, unmount } = mount(
      async (channel) => {
        if (channel === 'domain:ingress-list') return ok([latest])
        if (channel === 'domain:ingress-action') {
          latest = binding({
            vps_id: 61,
            binding_id: 62,
            status: 'uncertain',
            reason: { code: 'INSTALL_UNCERTAIN', message: 'raw' }
          })
          return ok(latest)
        }
        if (channel === 'domain:ingress-status')
          return ok(binding({ vps_id: 61, binding_id: 62, status: 'ready' }))
        throw new Error('unexpected IPC')
      },
      { vpsId: 61, appId: 3, httpUrl: 'http://host.test:30000', active: true },
      binding({ vps_id: 61, binding_id: 62, status: 'ready' })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Thiết lập HTTPS' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục' }))
    await screen.findAllByText(/Thao tác trước có thể đã hoàn tất/)
    await waitFor(() => expect(document.querySelector('.ant-btn-loading')).toBeNull())
    expect(invoke).toHaveBeenCalledWith('domain:ingress-status', { vps_id: 61, binding_id: 62 })
    expect(screen.queryByRole('button', { name: 'Thiết lập HTTPS' })).toBeNull()
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'domain:ingress-action')
    ).toHaveLength(1)
    expect(window.localStorage.getItem('opspilot-ingress-uncertain:61:62')).toBe('1')
    unmount()
    const reopened = mount(
      async () => ok([binding({ vps_id: 61, binding_id: 62, status: 'ready' })]),
      { vpsId: 61, appId: 3, httpUrl: 'http://host.test:30000', active: true }
    )
    await waitFor(() =>
      expect(document.querySelector('.apps-section-heading h3')?.textContent).toContain('HTTPS')
    )
    await waitFor(() => expect(document.querySelector('.ant-spin-spinning')).toBeNull())
    expect(window.localStorage.getItem('opspilot-ingress-uncertain:61:62')).toBe('1')
    expect(
      within(document.querySelector('.ant-card') as HTMLElement).getAllByRole('button')
    ).toHaveLength(3)
    expect(
      reopened.invoke.mock.calls.some(([channel]) => channel === 'domain:ingress-action')
    ).toBe(false)
  })
  it('requires confirmation to reconcile degraded routes and scopes progress and notice to that binding', async () => {
    const first = binding({
      binding_id: 71,
      hostname: 'alpha.example.test',
      status: 'degraded',
      route_status: 'failed',
      reason: { code: 'RECONCILE_BLOCKED', message: 'untrusted raw output' }
    })
    const second = binding({ binding_id: 72, hostname: 'beta.example.test' })
    const result = deferred<unknown>()
    const { invoke } = mount(
      async (channel) => {
        if (channel === 'domain:ingress-list') return ok([first, second])
        if (channel === 'domain:ingress-action') return result.promise
        return ok(first)
      },
      { vpsId: 91, appId: 3, httpUrl: 'http://host.test:30000', active: true }
    )
    await waitFor(() => expect(document.querySelectorAll('.ant-card')).toHaveLength(2))
    const cards = document.querySelectorAll('.ant-card')
    const alpha = cards[0] as HTMLElement
    const beta = cards[1] as HTMLElement
    fireEvent.click(within(alpha).getByRole('button', { name: 'Áp dụng tuyến ingress' }))
    expect(invoke.mock.calls.some(([name]) => name === 'domain:ingress-action')).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục' }))
    await waitFor(() => expect(alpha.querySelector('.ant-steps')).toBeTruthy())
    expect(beta.querySelector('.ant-steps')).toBeNull()
    expect(invoke).toHaveBeenCalledWith('domain:ingress-action', {
      vps_id: 91,
      binding_id: 71,
      action: 'reconcile'
    })
    result.resolve(
      ok(
        binding({
          binding_id: 71,
          status: 'blocked',
          reason: { code: 'RECONCILE_BLOCKED', message: 'raw' }
        })
      )
    )
    await within(alpha).findAllByText(/Chưa xác nhận được cấu hình tuyến/)
    expect(within(beta).queryByText(/Chưa xác nhận được cấu hình tuyến/)).toBeNull()
  })
  it('does not offer reconcile or writes for disabled bindings and localizes all stored enum labels', async () => {
    const labels = [
      ['en', 'Not configured', 'Not requested'],
      ['vi', 'Chưa cấu hình', 'Chưa yêu cầu'],
      ['cn', '未配置', '未请求'],
      ['jp', '未設定', '未要求']
    ] as const
    for (const [index, [locale, notConfigured, notRequested]] of labels.entries()) {
      useUiState.setState({ locale })
      const view = mount(
        async () =>
          ok([
            binding({
              vps_id: 100 + index,
              binding_id: 200 + index,
              status: 'pending',
              route_status: 'not_configured',
              certificate_status: 'not_requested'
            })
          ]),
        { vpsId: 100 + index, appId: 3, httpUrl: 'http://host.test:30000', active: true }
      )
      expect(await screen.findAllByText(notConfigured)).not.toHaveLength(0)
      expect(screen.getAllByText(notRequested).length).toBeGreaterThan(0)
      expect(view.invoke.mock.calls.some(([channel]) => channel === 'domain:ingress-action')).toBe(
        false
      )
      view.unmount()
    }
    useUiState.setState({ locale: 'vi' })
    mount(async () =>
      ok([
        binding({
          status: 'blocked',
          route_status: 'disabled',
          certificate_status: 'not_requested'
        })
      ])
    )
    await screen.findByText('Tên miền này đã bị tắt.')
    expect(screen.queryByRole('button', { name: 'Áp dụng tuyến ingress' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Thiết lập HTTPS' })).toBeNull()
  })
  it.each(['install', 'reconcile', 'https_check'] as const)(
    'stops setup at a blocked %s step',
    async (failedStep) => {
      const calls: string[] = []
      mount(async (channel, arg) => {
        if (channel === 'domain:ingress-list') return ok([binding()])
        const action = (arg as { action: string }).action as 'install' | 'reconcile' | 'https_check'
        calls.push(action)
        if (action === failedStep)
          return ok(
            binding({ status: 'blocked', reason: { code: 'HOST_CONFLICT', message: 'raw' } })
          )
        return ok(
          binding({
            status: action === 'install' ? 'installed' : 'reconciled_pending',
            operation: action
          })
        )
      })
      await screen.findByRole('heading', { name: /Domain & HTTPS|Tên miền & HTTPS/ })
      fireEvent.click(screen.getByRole('button', { name: 'Thiết lập HTTPS' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục' }))
      const order = ['install', 'reconcile', 'https_check'] as const
      await waitFor(() => expect(calls).toEqual(order.slice(0, order.indexOf(failedStep) + 1)))
    }
  )
  it('locks double submit and ignores late action result after app switch', async () => {
    const action = deferred<unknown>()
    const nextList = deferred<unknown>()
    const { rerender, invoke } = mount(async (channel, input) =>
      channel === 'domain:ingress-list'
        ? (input as { vps_id: number }).vps_id === 1
          ? ok([binding()])
          : nextList.promise
        : action.promise
    )
    await screen.findByRole('button', { name: /Tải lại trạng thái/ })
    fireEvent.click(screen.getByRole('button', { name: 'Thiết lập HTTPS' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('domain:ingress-action', expect.anything())
    )
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'domain:ingress-action')
    ).toHaveLength(1)
    rerender(
      <AntApp>
        <SharedIngressTab
          key="2:4:domainHttps"
          vpsId={2}
          appId={4}
          httpUrl="http://198.51.100.2:30000"
          active
        />
      </AntApp>
    )
    action.resolve(ok(binding({ status: 'active' })))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryAllByText('demo.example.test')).toHaveLength(0)
    expect(document.querySelector('.ant-spin-spinning')).toBeTruthy()
  })
  it('clears binding progress and ignores an action result after switching away from the tab', async () => {
    const action = deferred<unknown>()
    const { rerender, invoke } = mount(async (channel) =>
      channel === 'domain:ingress-list' ? ok([binding({ binding_id: 301 })]) : action.promise
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Thiết lập HTTPS' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục' }))
    await waitFor(() =>
      expect(invoke.mock.calls.some(([channel]) => channel === 'domain:ingress-action')).toBe(true)
    )
    rerender(
      <AntApp>
        <SharedIngressTab vpsId={1} appId={3} httpUrl="http://host.test:30000" active={false} />
      </AntApp>
    )
    expect(document.querySelector('.ant-steps')).toBeNull()
    rerender(
      <AntApp>
        <SharedIngressTab vpsId={1} appId={3} httpUrl="http://host.test:30000" active />
      </AntApp>
    )
    await screen.findByText(/Yêu cầu trước vẫn đang chờ kết quả/)
    expect(screen.queryByRole('button', { name: 'Thiết lập HTTPS' })).toBeNull()
    action.resolve(ok(binding({ binding_id: 301, status: 'active' })))
    await waitFor(() =>
      expect(window.localStorage.getItem('opspilot-ingress-pending:1:301')).toBeNull()
    )
    await screen.findByRole('button', { name: 'Thiết lập HTTPS' })
    await waitFor(() => expect(document.querySelector('.ant-steps')).toBeNull())
    expect(screen.queryByText('Hoàn tất')).toBeNull()
  })
  it('localizes tab copy in all four locales', async () => {
    for (const [locale, label] of [
      ['en', 'Domain & HTTPS'],
      ['vi', 'Tên miền & HTTPS'],
      ['cn', '域名与 HTTPS'],
      ['jp', 'ドメインと HTTPS']
    ] as const) {
      useUiState.setState({ locale })
      const view = mount(async () => ok([]))
      expect(await screen.findByText(label)).toBeTruthy()
      view.unmount()
    }
  })
})
