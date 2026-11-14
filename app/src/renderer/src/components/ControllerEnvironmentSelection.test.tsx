// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeEach, it, expect, vi } from 'vitest'
import {
  ControllerEnvironmentSelection,
  ENVIRONMENT_SELECTION_COPY
} from './ControllerEnvironmentSelection'
import { useUiState } from '../store/uiState'
import type {
  DesktopEnvironmentContext,
  DesktopEnvironmentSelectionIntent
} from '@shared/desktopProductEnvironment'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopProjectSetup } from '@shared/desktopProjectRegistration'
const invoke = vi.fn(),
  changed = vi.fn(async () => undefined),
  t = ENVIRONMENT_SELECTION_COPY.en
const binding = {
  binding_id: '11111111-1111-4111-8111-111111111111',
  revision: 2,
  controller_id: 'controller-a'
} as DesktopControllerConnection
const project = {
  request_key: '22222222-2222-4222-8222-222222222222',
  app_id: 42
} as DesktopProjectSetup
let context: DesktopEnvironmentContext, row: DesktopEnvironmentSelectionIntent
const view = (stagingPending = false): React.JSX.Element => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <ControllerEnvironmentSelection
      key={context.source_generation}
      binding={binding}
      project={project}
      context={context}
      stagingPending={stagingPending}
      onChanged={changed}
    />
  </ConfigProvider>
)
const choose = async (): Promise<void> => {
  await screen.findByRole('button', { name: t.choose + ' #1' })
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t.choose + ' #1' })).toHaveProperty('disabled', false)
  )
  fireEvent.click(screen.getByRole('button', { name: t.choose + ' #1' }))
  await screen.findByText(t.prepared)
}
beforeEach(() => {
  invoke.mockReset()
  changed.mockClear()
  useUiState.setState({ locale: 'en' })
  context = {
    project_request_key: project.request_key,
    binding_id: binding.binding_id,
    binding_revision: 2,
    controller_id: binding.controller_id,
    app_id: 42,
    ownership_generation: 1,
    source_generation: 1,
    source_config_sha256: 'a'.repeat(64),
    selected: null,
    auto_deploy_paused: true,
    latest: {
      controller_id: binding.controller_id,
      app_id: 42,
      ownership_generation: 1,
      revision: 1,
      basis_source_generation: 1,
      basis_source_config_sha256: 'a'.repeat(64),
      framework: 'nextjs',
      runtime_keys: ['APP_TOKEN'],
      public_build_keys: [],
      created_at: new Date().toISOString(),
      activation: 'staged'
    }
  }
  row = {
    request_key: '33333333-3333-4333-8333-333333333333',
    project_request_key: project.request_key,
    binding_id: binding.binding_id,
    binding_revision: 2,
    controller_id: binding.controller_id,
    app_id: 42,
    ownership_generation: 1,
    source_generation: 1,
    source_config_sha256: 'a'.repeat(64),
    environment_revision: 1,
    expected_latest_revision: 1,
    state: 'prepared',
    result: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async (channel: string) => ({
    ok: true,
    data: channel === 'controller:environment-selections' ? [] : row
  }))
})
it('prepares only identity/CAS with separate confirmation and never invokes deploy or unpause', async () => {
  render(view())
  expect(screen.getByRole('button', { name: t.choose + ' #1' })).toHaveProperty('disabled', true)
  await choose()
  expect(invoke).toHaveBeenCalledWith('controller:prepare-environment-selection', {
    project_request_key: project.request_key,
    expected_binding_revision: 2,
    expected_source_generation: 1,
    expected_source_config_sha256: 'a'.repeat(64),
    expected_latest_revision: 1,
    environment_revision: 1
  })
  expect(screen.getByRole('button', { name: t.send })).toHaveProperty('disabled', true)
  expect(JSON.stringify(invoke.mock.calls)).not.toContain('runtime_env')
  expect(JSON.stringify(invoke.mock.calls)).not.toContain('deploy:start')
})
it('recovers unknown send with same UUID check and invokes refresh only after verified selection', async () => {
  render(view())
  await choose()
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'controller:send-environment-selection')
      return { ok: false, error: { message: 'lost' } }
    return { ok: true, data: { ...row, state: 'selected' } }
  })
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.send }))
  await screen.findByText(t.unknown)
  expect(changed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: t.check }))
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(invoke).toHaveBeenCalledWith('controller:check-environment-selection', row.request_key)
  expect(
    invoke.mock.calls.filter(([channel]) => channel === 'controller:prepare-environment-selection')
  ).toHaveLength(1)
})
it('blocks selection for an unpaused project or pending stage intent', async () => {
  context.auto_deploy_paused = false
  const shown = render(view())
  expect(screen.getByRole('button', { name: t.choose + ' #1' })).toHaveProperty('disabled', true)
  await screen.findByText(t.paused)
  context.auto_deploy_paused = true
  shown.rerender(view(true))
  expect(screen.getByRole('button', { name: t.choose + ' #1' })).toHaveProperty('disabled', true)
})
it('refreshes after an authoritative unapplied result and does not send a deployment', async () => {
  render(view())
  await choose()
  invoke.mockResolvedValue({ ok: true, data: { ...row, state: 'not_applied' } })
  fireEvent.click(screen.getByRole('button', { name: t.check }))
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(invoke).toHaveBeenCalledWith('controller:check-environment-selection', row.request_key)
  expect(invoke.mock.calls.some(([channel]) => channel === 'deploy:start')).toBe(false)
})
it('rejects a list belonging to another app and cannot prepare until a valid list is loaded', async () => {
  invoke.mockResolvedValue({ ok: true, data: [{ ...row, app_id: 99 }] })
  render(view())
  await screen.findByText(t.failure)
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  expect(screen.getByRole('button', { name: t.choose + ' #1' })).toHaveProperty('disabled', true)
})
it('does not apply late results after the project view is unmounted', async () => {
  const shown = render(view())
  await choose()
  let finish: (value: unknown) => void = () => undefined
  invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.send }))
  shown.unmount()
  await act(async () => finish({ ok: true, data: { ...row, state: 'selected' } }))
  expect(changed).not.toHaveBeenCalled()
})
it.each(['vi', 'en', 'cn', 'jp'] as const)(
  'shows distinct selected/latest meaning in %s',
  (locale) => {
    useUiState.setState({ locale })
    context.selected = context.latest
    render(view())
    expect(screen.getByText(ENVIRONMENT_SELECTION_COPY[locale].selected)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: ENVIRONMENT_SELECTION_COPY[locale].choose + ' #1' })
    ).toBeNull()
  }
)
