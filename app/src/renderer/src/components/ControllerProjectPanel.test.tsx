// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopProjectSetup } from '@shared/desktopProjectRegistration'
import { ControllerProjectPanel } from './ControllerProjectPanel'
import { CONTROLLER_PROJECT_COPY } from './controllerProjectCopy'
import { useUiState } from '../store/uiState'
const t = CONTROLLER_PROJECT_COPY.vi,
  bindingId = '11111111-1111-4111-8111-111111111111',
  key = '22222222-2222-4222-8222-222222222222'
let binding: DesktopControllerConnection, rows: DesktopProjectSetup[], lost: boolean
const invoke = vi.fn(),
  remote = new Set<string>()
const row = (state: DesktopProjectSetup['state'] = 'prepared'): DesktopProjectSetup => ({
  request_key: key,
  binding_id: bindingId,
  binding_revision: 2,
  controller_id: 'controller-a',
  target_vps_id: 77,
  target_security_revision: 3,
  framework: 'express',
  app_name: 'ui-api',
  repository_url: 'https://github.com/example/api.git',
  production_ref: 'main',
  repository_root: '.',
  host_port: null,
  container_port: 3000,
  healthcheck_path: '/health',
  state,
  app_id: state === 'registered' ? 42 : null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
})
const view = (): React.JSX.Element => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <App>
      <ControllerProjectPanel binding={binding} />
    </App>
  </ConfigProvider>
)
const begin = async (): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: t.create }))
  await screen.findByRole('dialog')
  await waitFor(() =>
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:project-targets')).toBe(
      true
    )
  )
}
const configure = async (
  framework: 'express' | 'static-spa' | 'nextjs' = 'express'
): Promise<void> => {
  await begin()
  if (framework === 'static-spa') {
    fireEvent.mouseDown(screen.getByLabelText(t.framework))
    fireEvent.click((await screen.findAllByText('Vite SPA')).at(-1)!)
    expect((screen.getByLabelText(t.containerPort) as HTMLInputElement).value).toBe('80')
    expect((screen.getByLabelText(t.containerPort) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(t.health) as HTMLInputElement).value).toBe('/')
  }
  if (framework === 'nextjs') {
    fireEvent.mouseDown(screen.getByLabelText(t.framework))
    fireEvent.click((await screen.findAllByText('Next.js')).at(-1)!)
    expect((screen.getByLabelText(t.containerPort) as HTMLInputElement).value).toBe('3000')
    expect((screen.getByLabelText(t.health) as HTMLInputElement).value).toBe('/')
  }
  fireEvent.mouseDown(screen.getByLabelText(t.target))
  const options = await screen.findAllByText('Remote target · target.test (#77)')
  fireEvent.click(options.at(-1)!)
  fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'ui-api' } })
  fireEvent.change(screen.getByLabelText(t.repo), {
    target: { value: 'https://github.com/example/api' }
  })
  fireEvent.click(screen.getByRole('button', { name: t.review }))
  await screen.findByText(t.confirmHint)
}
beforeEach(() => {
  useUiState.setState({ locale: 'vi' })
  rows = []
  lost = false
  remote.clear()
  invoke.mockReset()
  binding = {
    binding_id: bindingId,
    controller_id: 'controller-a',
    vps_id: 1,
    revision: 2,
    state: 'active',
    display_name: 'Controller A',
    remote_client_id: '33333333-3333-4333-8333-333333333333',
    scopes: ['read', 'deploy:manual', 'policy:write'],
    credential_expires_at: '2030-01-01T00:00:00Z',
    updated_at: new Date().toISOString()
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async (channel: string, input?: unknown) => {
    if (channel === 'controller:projects')
      return { ok: true, data: rows.map((value) => ({ ...value })) }
    if (channel === 'controller:project-targets')
      return {
        ok: true,
        data: {
          binding_id: bindingId,
          binding_revision: 2,
          controller_id: 'controller-a',
          items: [
            {
              id: 77,
              name: 'Remote target',
              host: 'target.test',
              port: 22,
              username: 'operator',
              host_fingerprint: 'SHA256:' + 'A'.repeat(43),
              ssh_security_revision: 3
            }
          ],
          next_after_id: null,
          has_more: false
        }
      }
    if (channel === 'controller:prepare-project') {
      rows = [{ ...row(), ...(input as object) }]
      return { ok: true, data: rows[0] }
    }
    if (channel === 'controller:send-project') {
      remote.add(input as string)
      rows = [{ ...rows[0], state: lost ? 'outcome_unknown' : 'registered', app_id: 42 }]
      if (lost) {
        lost = false
        return { ok: false, error: { technical: 'CONTROLLER_ADMIN_FAILED' } }
      }
      return { ok: true, data: rows[0] }
    }
    if (channel === 'controller:cancel-project') {
      rows = [row('cancelled')]
      return { ok: true, data: rows[0] }
    }
    throw new Error('Unexpected IPC')
  })
})
afterEach(() => {
  vi.useRealTimers()
})
describe('Product project registration form and recovery', () => {
  it('xem lại và gửi SPA với cổng nginx80, không tự gửi Express', async () => {
    render(view())
    await configure('static-spa')
    expect(within(screen.getByRole('dialog')).getAllByText('Vite SPA').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    await screen.findByText(t.registeredHint)
    expect(invoke).toHaveBeenCalledWith(
      'controller:prepare-project',
      expect.objectContaining({
        framework: 'static-spa',
        container_port: 80,
        healthcheck_path: '/'
      })
    )
    expect(remote.size).toBe(1)
  })
  it('review và đăng ký Next.js đúng framework, default3000 và root health', async () => {
    render(view())
    await configure('nextjs')
    expect(within(screen.getByRole('dialog')).getAllByText('Next.js').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    await screen.findByText(t.registeredHint)
    expect(invoke).toHaveBeenCalledWith(
      'controller:prepare-project',
      expect.objectContaining({ framework: 'nextjs', container_port: 3000, healthcheck_path: '/' })
    )
    expect(remote.size).toBe(1)
  })
  it('không send khi prepare trả framework khác phần đã duyệt', async () => {
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel, ...args) =>
      channel === 'controller:prepare-project'
        ? { ok: true, data: row() }
        : original(channel, ...args)
    )
    render(view())
    await configure('static-spa')
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    await screen.findAllByText(t.changed)
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:send-project')).toBe(false)
  })
  it('does not allow read-only bindings to prepare projects or load administrative targets', async () => {
    binding.scopes = ['read']
    render(view())
    await screen.findByText(t.empty)
    expect(screen.getByText(t.readOnly)).toBeTruthy()
    expect(screen.getByRole('button', { name: t.create }).hasAttribute('disabled')).toBe(true)
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:project-targets')).toBe(
      false
    )
  })
  it('reviews remote target and canonical Git metadata before main prepares and sends the project', async () => {
    render(view())
    await configure()
    expect(screen.getByText('https://github.com/example/api.git')).toBeTruthy()
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:prepare-project')).toBe(
      false
    )
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    await screen.findByText(t.registeredHint)
    expect(invoke).toHaveBeenCalledWith('controller:prepare-project', {
      binding_id: bindingId,
      target_vps_id: 77,
      app_name: 'ui-api',
      framework: 'express',
      repository_url: 'https://github.com/example/api.git',
      production_ref: 'main',
      repository_root: '.',
      host_port: null,
      container_port: 3000,
      healthcheck_path: '/health'
    })
    expect(invoke).toHaveBeenCalledWith('controller:send-project', key)
    expect(remote.size).toBe(1)
    expect(
      invoke.mock.calls.some(([channel]) => channel === 'vps:list' || channel === 'deploy:start')
    ).toBe(false)
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })
  it('retains an unknown result and retries only the original setup key after confirmation', async () => {
    lost = true
    render(view())
    await configure()
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    await screen.findByText(t.unknownHint)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: t.retry }))
    await screen.findByRole('dialog')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t.retry }))
    await screen.findByText(t.registeredHint)
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'controller:prepare-project')
    ).toHaveLength(1)
    expect(
      invoke.mock.calls
        .filter(([channel]) => channel === 'controller:send-project')
        .map(([, value]) => value)
    ).toEqual([key, key])
    expect(remote.size).toBe(1)
  })
  it('keeps a prepared request after lost prepare response and never sends it automatically', async () => {
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel, input) => {
      if (channel === 'controller:prepare-project') {
        rows = [row()]
        throw new Error('IPC reply lost')
      }
      return original(channel, input)
    })
    render(view())
    await configure()
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    await screen.findByText(t.prepared)
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:send-project')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: t.cancel }))
    await screen.findByText(t.cancelled)
  })
  it('does not send after target revision changed between review and durable prepare', async () => {
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel, input) => {
      if (channel === 'controller:prepare-project') {
        rows = [{ ...row(), target_security_revision: 4 }]
        return { ok: true, data: rows[0] }
      }
      return original(channel, input)
    })
    render(view())
    await configure()
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    await screen.findAllByText(t.changed)
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:send-project')).toBe(false)
  })
  it('leaves the main-prepared request unsent if the screen closes before prepare completes', async () => {
    let resolvePrepare!: (value: unknown) => void
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel, input) => {
      if (channel === 'controller:prepare-project') {
        rows = [row()]
        return new Promise((resolve) => {
          resolvePrepare = resolve
        })
      }
      return original(channel, input)
    })
    const rendered = render(view())
    await configure()
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    await waitFor(() => expect(resolvePrepare).toBeTypeOf('function'))
    rendered.unmount()
    await act(async () => resolvePrepare({ ok: true, data: rows[0] }))
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:send-project')).toBe(false)
    expect(rows[0].state).toBe('prepared')
  })
  it('shows target and history errors as errors rather than an empty eligible list', async () => {
    invoke.mockResolvedValue({ ok: false, error: { technical: 'CONTROLLER_ADMIN_FAILED' } })
    render(view())
    await screen.findAllByText(t.historyError)
    expect(screen.queryByText(t.empty)).toBeNull()
    await begin()
    await screen.findByText(t.targetError)
    expect(screen.queryByText(t.targetEmpty)).toBeNull()
    expect(screen.getByRole('button', { name: t.review }).hasAttribute('disabled')).toBe(true)
  })
  it('renders copy in all supported languages and validates credential-free GitHub URLs before prepare', async () => {
    render(view())
    await screen.findByText(t.empty)
    for (const locale of ['en', 'cn', 'jp', 'vi'] as const) {
      act(() => useUiState.setState({ locale }))
      expect(screen.getByText(CONTROLLER_PROJECT_COPY[locale].intro)).toBeTruthy()
    }
    await begin()
    fireEvent.change(screen.getByLabelText(t.repo), {
      target: { value: 'https://token@github.com/example/api' }
    })
    fireEvent.click(screen.getByRole('button', { name: t.review }))
    await screen.findByText(t.repoInvalid)
    expect(invoke.mock.calls.some(([channel]) => channel === 'controller:prepare-project')).toBe(
      false
    )
  })
})
