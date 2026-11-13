// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeEach, expect, it, vi } from 'vitest'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopProjectSetup } from '@shared/desktopProjectRegistration'
import type {
  DesktopEnvironmentContext,
  DesktopEnvironmentIntent
} from '@shared/desktopProductEnvironment'
import { ControllerProjectEnvironment } from './ControllerProjectEnvironment'
import { CONTROLLER_ENVIRONMENT_COPY } from './controllerEnvironmentCopy'
import { useUiState } from '../store/uiState'
const invoke = vi.fn(),
  t = CONTROLLER_ENVIRONMENT_COPY.en
let binding: DesktopControllerConnection,
  project: DesktopProjectSetup,
  rows: DesktopEnvironmentIntent[],
  context: DesktopEnvironmentContext
const intent = (): DesktopEnvironmentIntent => ({
  request_key: '33333333-3333-4333-8333-333333333333',
  project_request_key: project.request_key,
  binding_id: binding.binding_id,
  binding_revision: 2,
  controller_id: binding.controller_id,
  app_id: 42,
  ownership_generation: 1,
  source_generation: 1,
  source_config_sha256: 'a'.repeat(64),
  expected_latest_revision: null,
  runtime_keys: ['APP_TOKEN'],
  public_build_keys: [],
  state: 'prepared',
  result: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
})
const view = (): React.JSX.Element => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <ControllerProjectEnvironment binding={binding} project={project} />
  </ConfigProvider>
)
const open = async (): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByRole('dialog')
  await screen.findByText(t.none)
}
beforeEach(() => {
  useUiState.setState({ locale: 'en' })
  invoke.mockReset()
  rows = []
  binding = {
    binding_id: '11111111-1111-4111-8111-111111111111',
    controller_id: 'controller-a',
    vps_id: 1,
    revision: 2,
    state: 'active',
    display_name: 'Controller',
    remote_client_id: '44444444-4444-4444-8444-444444444444',
    scopes: ['read', 'deploy:manual', 'policy:write'],
    credential_expires_at: '2030-01-01T00:00:00Z',
    updated_at: new Date().toISOString()
  }
  project = {
    request_key: '22222222-2222-4222-8222-222222222222',
    binding_id: binding.binding_id,
    binding_revision: 2,
    controller_id: binding.controller_id,
    target_vps_id: 77,
    target_security_revision: 1,
    framework: 'nextjs',
    app_name: 'env-ui',
    repository_url: 'https://github.com/example/app.git',
    production_ref: 'main',
    repository_root: '.',
    host_port: 30000,
    container_port: 3000,
    healthcheck_path: '/',
    state: 'registered',
    app_id: 42,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  context = {
    project_request_key: project.request_key,
    binding_id: binding.binding_id,
    binding_revision: 2,
    controller_id: binding.controller_id,
    app_id: 42,
    ownership_generation: 1,
    source_generation: 1,
    source_config_sha256: 'a'.repeat(64),
    latest: null
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async (channel: string) => ({
    ok: true,
    data:
      channel === 'controller:environment-context'
        ? context
        : channel === 'controller:environment-intents'
          ? rows
          : intent()
  }))
})
it('loads context only on open and clears entered secret after preparing without sending', async () => {
  render(view())
  expect(invoke).not.toHaveBeenCalled()
  await open()
  fireEvent.click(screen.getByRole('button', { name: `${t.add} — ${t.runtime}` }))
  fireEvent.change(screen.getByRole('textbox', { name: `${t.runtime} ${t.key} 1` }), {
    target: { value: 'APP_TOKEN' }
  })
  const password = screen.getByLabelText(`${t.runtime} ${t.value} 1`)
  expect(password.getAttribute('type')).toBe('password')
  fireEvent.change(password, { target: { value: 'SYNTHETIC_ONLY_UI_SECRET' } })
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.prepare }))
  await screen.findByText(t.prepared)
  expect(invoke).toHaveBeenCalledWith('controller:prepare-environment', {
    project_request_key: project.request_key,
    expected_binding_revision: 2,
    expected_latest_revision: null,
    runtime_env: { APP_TOKEN: 'SYNTHETIC_ONLY_UI_SECRET' },
    public_build_args: {}
  })
  expect(screen.queryByDisplayValue('SYNTHETIC_ONLY_UI_SECRET')).toBeNull()
  expect(invoke.mock.calls.some((c) => c[0] === 'controller:send-environment')).toBe(false)
  expect(screen.getByText(t.stagedOnly)).toBeTruthy()
})
it('keeps an uncertain request and permits metadata check or exact request-ID resend', async () => {
  rows = [{ ...intent(), state: 'outcome_unknown' }]
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'controller:environment-context') return { ok: true, data: context }
    if (channel === 'controller:environment-intents') return { ok: true, data: rows }
    return { ok: false, error: { technical: 'SYNTHETIC_RAW_SECRET_SHOULD_NOT_SHOW' } }
  })
  render(view())
  await open()
  expect(screen.getByText(t.unknown)).toBeTruthy()
  expect(screen.queryByRole('button', { name: t.prepare })).toBeNull()
  expect(screen.queryByRole('button', { name: t.cancel })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: t.check }))
  await screen.findByText(t.failure)
  expect(invoke).toHaveBeenCalledWith('controller:check-environment', rows[0].request_key)
  expect(screen.queryByText(/SYNTHETIC_RAW_SECRET/)).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.retry }))
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('controller:send-environment', rows[0].request_key)
  )
})
it('disables write actions for read-only or stale connection and rejects wrong context', async () => {
  binding.scopes = ['read']
  const rendered = render(view())
  expect(screen.getByRole('button', { name: t.open }).hasAttribute('disabled')).toBe(true)
  binding = { ...binding, scopes: ['read', 'deploy:manual', 'policy:write'] }
  context = { ...context, app_id: 999 }
  rendered.rerender(view())
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByText(t.failure)
  expect(screen.queryByRole('button', { name: t.prepare })).toBeNull()
})
it('does not apply a late context after closing or switching projects', async () => {
  let finish!: (value: unknown) => void
  invoke.mockImplementation(async (channel: string) =>
    channel === 'controller:environment-context'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : { ok: true, data: [] }
  )
  const rendered = render(view())
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByRole('dialog')
  fireEvent.click(screen.getAllByRole('button', { name: t.close }).at(-1)!)
  await act(async () => finish({ ok: true, data: context }))
  expect(screen.queryByText(t.none)).toBeNull()
  project = { ...project, app_id: 99, app_name: 'other' }
  rendered.rerender(view())
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('shows public warning, rejects a wrong framework prefix and duplicate variable names', async () => {
  render(view())
  await open()
  expect(screen.getByText(t.publicWarning)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: `${t.add} — ${t.public}` }))
  fireEvent.change(screen.getByRole('textbox', { name: `${t.public} ${t.key} 1` }), {
    target: { value: 'VITE_WRONG' }
  })
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.prepare }))
  await screen.findByText(t.invalid)
  expect(invoke.mock.calls.some((c) => c[0] === 'controller:prepare-environment')).toBe(false)
})
it.each(['vi', 'en', 'cn', 'jp'] as const)(
  'renders %s with staged-only and snapshot instructions',
  async (locale) => {
    useUiState.setState({ locale })
    render(view())
    const copy = CONTROLLER_ENVIRONMENT_COPY[locale]
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(copy.open.split('').join('\\s*')) })
    )
    await screen.findByText(copy.snapshot)
    expect(screen.getByText(copy.stagedOnly)).toBeTruthy()
    expect(screen.getByText(copy.publicWarning)).toBeTruthy()
  }
)
