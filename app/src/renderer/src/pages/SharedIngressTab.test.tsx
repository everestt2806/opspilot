// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  props = { vpsId: 1, appId: 3, httpUrl: 'http://198.51.100.2:30000', active: true }
): RenderResult & { invoke: ReturnType<typeof vi.fn> } {
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'domain:ingress-status') {
      const listed = (await handler('domain:ingress-list', {
        vps_id: props.vpsId,
        app_id: props.appId
      })) as { ok: boolean; data?: SharedIngressBindingDto[] }
      return listed.ok ? ok(listed.data?.[0] ?? binding()) : listed
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
  afterEach(() => vi.unstubAllGlobals())
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
    mount(async (channel, arg) => {
      if (channel === 'domain:ingress-list') return ok([binding()])
      const action = (arg as { action: string }).action
      calls.push(action)
      return ok(
        binding({
          status: action === 'install' ? 'uncertain' : 'blocked',
          reason: { code: 'INSTALL_UNCERTAIN', message: 'raw' }
        })
      )
    })
    await screen.findByRole('heading', { name: /Domain & HTTPS|Tên miền & HTTPS/ })
    fireEvent.click(screen.getByRole('button', { name: 'Thiết lập HTTPS' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy' }))
    expect(calls).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Thiết lập HTTPS' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục' }))
    await screen.findByText(/Thao tác trước có thể đã hoàn tất/)
    expect(calls).toEqual(['install'])
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
