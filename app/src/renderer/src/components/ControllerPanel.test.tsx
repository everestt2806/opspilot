// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App as AntApp, ConfigProvider } from 'antd'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import type {
  DesktopControllerConnection,
  DesktopControllerSnapshot
} from '@shared/desktopController'
import { ControllerPanel } from './ControllerPanel'
import { CONTROLLER_COPY } from './controllerCopy'
import { useUiState } from '../store/uiState'
const t = CONTROLLER_COPY.vi
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222'
const row = (id = a, name = 'Controller A'): DesktopControllerConnection => ({
  binding_id: id,
  controller_id: id === a ? 'controller-a' : 'controller-b',
  vps_id: 1,
  revision: 2,
  state: 'active',
  display_name: name,
  remote_client_id: '33333333-3333-4333-8333-333333333333',
  credential_expires_at: new Date(Date.now() + 86400000).toISOString(),
  updated_at: new Date().toISOString()
})
const snapshot = (id = a, name = 'Remote app'): DesktopControllerSnapshot => ({
  binding_id: id,
  controller_id: id === a ? 'controller-a' : 'controller-b',
  binding_revision: 2,
  service_state: 'ready',
  data_freshness: 'current',
  checked_at: new Date().toISOString(),
  items: [
    {
      app_id: 1,
      app_name: name,
      production_ref: 'main',
      desired_sha: 'a'.repeat(40),
      auto_deploy_paused: true,
      reconciliation_state: 'paused',
      observed_at: null
    }
  ],
  next_cursor: null,
  has_more: false
})
const invoke = vi.fn()
let rows: DesktopControllerConnection[]
const show = (): void => {
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AntApp>
        <ControllerPanel />
      </AntApp>
    </ConfigProvider>
  )
}
beforeEach(() => {
  useUiState.setState({ locale: 'vi' })
  rows = [row()]
  invoke.mockReset()
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'controller:list') return { ok: true, data: rows }
    if (channel === 'controller:apps') return { ok: true, data: snapshot() }
    if (channel === 'vps:list')
      return {
        ok: true,
        data: [
          {
            id: 1,
            name: 'Lab VPS',
            host: '192.0.2.1',
            host_fingerprint: 'SHA256:' + 'A'.repeat(43)
          }
        ]
      }
    return { ok: true, data: row() }
  })
})
afterEach(() => {
  vi.useRealTimers()
})
describe('Controller settings onboarding and authoritative app reads', () => {
  it('lists saved registrations truthfully and reads Product apps only after explicit selection', async () => {
    show()
    await screen.findByText('Controller A')
    expect(screen.getByText(t.active)).toBeTruthy()
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:apps')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: t.view }))
    await screen.findByText('Remote app')
    expect(invoke).toHaveBeenCalledWith('controller:apps', { binding_id: a })
    expect(
      invoke.mock.calls.some(([channel]) => channel === 'app:list' || channel === 'deploy:start')
    ).toBe(false)
    expect(screen.getByText(t.ready)).toBeTruthy()
  })
  it('keeps errors separate from empty state and clears stale app data after refresh fails', async () => {
    show()
    await screen.findByText('Controller A')
    fireEvent.click(screen.getByRole('button', { name: t.view }))
    await screen.findByText('Remote app')
    invoke.mockImplementation(async (channel: string) =>
      channel === 'controller:list'
        ? { ok: true, data: rows }
        : { ok: false, error: { code: 'VALIDATION', technical: 'CLIENT_REVOKED' } }
    )
    const panel = screen.getByRole('region', { name: t.apps })
    fireEvent.click(within(panel).getByRole('button', { name: t.refresh }))
    await screen.findByText('CLIENT_REVOKED')
    expect(screen.queryByText('Remote app')).toBeNull()
    expect(screen.queryByText(t.noApps)).toBeNull()
    expect(screen.queryByText(t.empty)).toBeNull()
  })
  it('ignores a late app response from the previously selected controller', async () => {
    rows = [row(), row(b, 'Controller B')]
    let resolveA!: (value: unknown) => void
    invoke.mockImplementation(async (channel: string, input?: { binding_id: string }) => {
      if (channel === 'controller:list') return { ok: true, data: rows }
      if (input?.binding_id === a)
        return new Promise((resolve) => {
          resolveA = resolve
        })
      return { ok: true, data: snapshot(b, 'App B') }
    })
    show()
    await screen.findByText('Controller B')
    const buttons = screen.getAllByRole('button', { name: t.view })
    fireEvent.click(buttons[0])
    fireEvent.click(buttons[1])
    await screen.findByText('App B')
    await act(async () => resolveA({ ok: true, data: snapshot(a, 'Late App A') }))
    expect(screen.queryByText('Late App A')).toBeNull()
    expect(screen.getByText('App B')).toBeTruthy()
  })
  it('does not show ready as current after snapshot TTL expires', async () => {
    vi.useFakeTimers()
    invoke.mockImplementation(async (channel: string) =>
      channel === 'controller:list'
        ? { ok: true, data: rows }
        : {
            ok: true,
            data: { ...snapshot(), checked_at: new Date(Date.now() - 29000).toISOString() }
          }
    )
    show()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Controller A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t.view }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Remote app')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(screen.getByText(t.stale)).toBeTruthy()
    expect(document.querySelector('.ant-tag-success')).toBeNull()
  })
  it('loads the next controller page and never merges a page from a changed binding revision', async () => {
    let calls = 0
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'controller:list') return { ok: true, data: rows }
      calls++
      if (calls === 1)
        return {
          ok: true,
          data: { ...snapshot(a, 'App page 1'), next_cursor: 'page2', has_more: true }
        }
      if (calls === 2)
        return {
          ok: true,
          data: {
            ...snapshot(a, 'App page 2'),
            items: [{ ...snapshot().items[0], app_id: 2, app_name: 'App page 2' }],
            next_cursor: 'page3',
            has_more: true
          }
        }
      return { ok: true, data: { ...snapshot(a, 'Wrong revision app'), binding_revision: 3 } }
    })
    show()
    await screen.findByText('Controller A')
    fireEvent.click(screen.getByRole('button', { name: t.view }))
    await screen.findByText('App page 1')
    fireEvent.click(await screen.findByRole('button', { name: t.more }))
    await screen.findByText('App page 2')
    expect(screen.getByText('App page 1')).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith('controller:apps', { binding_id: a, cursor: 'page2' })
    fireEvent.click(await screen.findByRole('button', { name: t.more }))
    await screen.findByText('BINDING_CHANGED')
    expect(screen.queryByText('App page 1')).toBeNull()
    expect(screen.queryByText('Wrong revision app')).toBeNull()
  })
  it('retries lost enrollment with the original binding UUID and never creates a new registration', async () => {
    rows = [{ ...row(), state: 'delivery_unknown', remote_client_id: null }]
    show()
    await screen.findByText('Controller A')
    expect(screen.getByText(t.deliveryHelp)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t.retry }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('controller:retry-enrollment', a))
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:register')).toBe(false)
  })
  it('confirms remote revoke separately from local disconnect', async () => {
    show()
    await screen.findByText('Controller A')
    fireEvent.click(screen.getByRole('button', { name: t.revoke }))
    await screen.findByRole('dialog')
    expect(screen.getAllByText(t.revokeConfirm).length).toBeGreaterThan(0)
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:revoke')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: t.ok }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('controller:revoke', a))
    await waitFor(() => expect(screen.queryAllByText(t.revokeConfirm)).toHaveLength(0))
    fireEvent.click(screen.getByRole('button', { name: t.disconnect }))
    await screen.findByRole('dialog')
    expect(screen.getAllByText(t.disconnectConfirm).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: t.ok }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('controller:disconnect', a))
  })
  it('renders the registration fields without asking for SSH or API secrets', async () => {
    show()
    await screen.findByText('Controller A')
    fireEvent.click(screen.getByRole('button', { name: t.add }))
    await screen.findByLabelText(t.controllerId)
    expect(screen.getByLabelText(t.artifact)).toBeTruthy()
    expect(screen.getByLabelText(t.pin)).toBeTruthy()
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByText(/access_token|api token|private key/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t.register }))
    await waitFor(() => expect(screen.getAllByText(t.required).length).toBeGreaterThan(0))
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:register')).toBe(false)
  })
  it('submits a valid enrollment with one UUID and only public installation fields', async () => {
    rows = []
    const defaultInvoke = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, input?: unknown) => {
      if (channel === 'controller:register') {
        const value = input as { binding_id: string }
        rows = [{ ...row(), binding_id: value.binding_id }]
        return { ok: true, data: rows[0] }
      }
      return defaultInvoke(channel, input)
    })
    show()
    await screen.findByText(t.empty)
    fireEvent.click(screen.getByRole('button', { name: t.add }))
    await screen.findByLabelText(t.controllerId)
    fireEvent.mouseDown(screen.getByRole('combobox'))
    const options = await screen.findAllByText('Lab VPS · 192.0.2.1')
    fireEvent.click(options.at(-1)!)
    for (const [label, value] of [
      [t.name, 'Desktop test'],
      [t.controllerId, 'test-controller'],
      [t.artifact, '/opt/opspilot/payload/control-plane.cjs'],
      [t.data, '/var/lib/opspilot'],
      [t.node, '/opt/opspilot/node'],
      [t.pin, 'a'.repeat(64)]
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: t.register }))
    await waitFor(() =>
      expect(invoke.mock.calls.some(([channel]) => channel === 'controller:register')).toBe(true)
    )
    const submitted = invoke.mock.calls.find(([channel]) => channel === 'controller:register')![1]
    expect(submitted).toMatchObject({
      vps_id: 1,
      controller_id: 'test-controller',
      manifest_sha256: 'a'.repeat(64)
    })
    expect(submitted.binding_id).toMatch(/^[a-f0-9-]{36}$/)
    expect(submitted).not.toHaveProperty('access_token')
    expect(submitted).not.toHaveProperty('principal')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
  it('renders genuine empty and load-error states in each supported locale', async () => {
    rows = []
    show()
    await screen.findByText(t.empty)
    for (const locale of ['en', 'cn', 'jp', 'vi'] as const) {
      act(() => useUiState.setState({ locale }))
      expect(screen.getByText(CONTROLLER_COPY[locale].title)).toBeTruthy()
      expect(screen.getByText(CONTROLLER_COPY[locale].empty)).toBeTruthy()
    }
    invoke.mockResolvedValue({ ok: false, error: { technical: 'BINDING_CHANGED' } })
    fireEvent.click(screen.getByRole('button', { name: t.refresh }))
    await screen.findByText('BINDING_CHANGED')
    expect(screen.queryByText(t.empty)).toBeNull()
    expect(screen.getByText(t.loadError)).toBeTruthy()
  })
})
