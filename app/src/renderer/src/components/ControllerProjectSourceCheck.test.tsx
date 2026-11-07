// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type {
  DesktopProjectSetup,
  DesktopProjectSourceVerification
} from '@shared/desktopProjectRegistration'
import { ControllerProjectSourceCheck } from './ControllerProjectSourceCheck'
import { CONTROLLER_SOURCE_COPY } from './controllerSourceCopy'
import { useUiState } from '../store/uiState'
const t = CONTROLLER_SOURCE_COPY.en,
  invoke = vi.fn()
let binding: DesktopControllerConnection, project: DesktopProjectSetup
const source = (): DesktopProjectSourceVerification => ({
  binding_id: binding.binding_id,
  binding_revision: binding.revision,
  request_key: project.request_key,
  controller_id: binding.controller_id,
  app_id: 42,
  ownership_generation: 1,
  source_generation: 1,
  source_config_sha256: 'b'.repeat(64),
  target_vps_id: 77,
  target_security_revision: 3,
  repository_url: project.repository_url,
  production_ref: 'main',
  repository_root: '.',
  commit_sha: 'c'.repeat(40),
  observation_sequence: 1,
  framework: 'express',
  configured_container_port: 3000,
  detected_container_port: 3000,
  source_file_count: 12,
  source_bytes: 64000,
  auto_deploy_paused: true,
  deployment_started: false,
  runtime_preflight: 'required',
  verified_at: new Date().toISOString(),
  state: 'source_verified'
})
const view = (): React.JSX.Element => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <ControllerProjectSourceCheck binding={binding} project={project} />
  </ConfigProvider>
)
const start = async (): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByRole('dialog')
  expect(invoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: t.run }))
}
beforeEach(() => {
  useUiState.setState({ locale: 'en' })
  invoke.mockReset()
  binding = {
    binding_id: '11111111-1111-4111-8111-111111111111',
    controller_id: 'controller-a',
    vps_id: 1,
    revision: 2,
    state: 'active',
    display_name: 'Controller',
    remote_client_id: '33333333-3333-4333-8333-333333333333',
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
    target_security_revision: 3,
    app_name: 'test-api',
    repository_url: 'https://github.com/example/api.git',
    production_ref: 'main',
    repository_root: '.',
    host_port: 30000,
    container_port: 3000,
    healthcheck_path: '/health',
    state: 'registered',
    app_id: 42,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async () => ({ ok: true, data: source() }))
})
describe('Kiểm tra source từ Desktop', () => {
  it('reviews source before explicit request, passes only setup key and shows full SHA without deployment claim', async () => {
    render(view())
    await start()
    await screen.findByText(t.verified)
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('controller:verify-project-source', project.request_key)
    expect(screen.getByText('c'.repeat(40))).toBeTruthy()
    expect(screen.getByText(t.remaining)).toBeTruthy()
    expect(screen.getByText(t.sourceOnly)).toBeTruthy()
    expect(screen.queryByText('Deploy')).toBeNull()
  })
  it('disables verification for read-only or stale bindings and unregistered requests', () => {
    binding.scopes = ['read']
    const rendered = render(view())
    expect(screen.getByRole('button', { name: t.open }).hasAttribute('disabled')).toBe(true)
    binding = { ...binding, scopes: ['read', 'deploy:manual', 'policy:write'] }
    project = { ...project, state: 'outcome_unknown' }
    rendered.rerender(view())
    expect(screen.getByRole('button', { name: t.open }).hasAttribute('disabled')).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })
  it.each([
    ['PROJECT_SOURCE_UNSUPPORTED', 'unsupported'],
    ['PROJECT_SOURCE_FETCH_FAILED', 'fetch'],
    ['PROJECT_SOURCE_REQUIRES_QUIESCENCE', 'blocked'],
    ['PROJECT_SOURCE_OBSERVATION_STALE', 'changed'],
    ['PROJECT_SOURCE_LIMIT_EXCEEDED', 'limit'],
    ['REQUEST_TIMEOUT', 'timeout']
  ] as const)(
    'localizes %s, never displays raw technical output and permits explicit recheck',
    async (code, copy) => {
      invoke.mockResolvedValueOnce({
        ok: false,
        error: { technical: code + ' synthetic-private-value' }
      })
      render(view())
      await start()
      await screen.findByText(t[copy])
      expect(screen.queryByText(/synthetic-private-value/)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: t.retry }))
      await screen.findByText(t.verified)
      expect(invoke).toHaveBeenCalledTimes(2)
    }
  )
  it('locks duplicate clicks and ignores a late source reply after close', async () => {
    let finish!: (value: unknown) => void
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    render(view())
    await start()
    fireEvent.click(screen.getByText(t.run).closest('button')!)
    expect(invoke).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText(t.close).closest('button')!)
    await act(async () => finish({ ok: true, data: source() }))
    fireEvent.click(screen.getByRole('button', { name: t.open }))
    await screen.findByRole('dialog')
    expect(screen.queryByText(t.verified)).toBeNull()
    expect(screen.queryByText('c'.repeat(40))).toBeNull()
  })
  it('drops pending result when binding authority changes or component unmounts', async () => {
    let finish!: (value: unknown) => void
    const response = source()
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const rendered = render(view())
    await start()
    binding = { ...binding, revision: 3 }
    rendered.rerender(view())
    await act(async () => finish({ ok: true, data: response }))
    expect(screen.queryByText(t.verified)).toBeNull()
    rendered.unmount()
  })
  it('rejects a response for another app and warns about a configured port override', async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: { ...source(), app_id: 999 } })
    render(view())
    await start()
    await screen.findByText(t.changed)
    invoke.mockResolvedValueOnce({ ok: true, data: { ...source(), detected_container_port: 4000 } })
    fireEvent.click(screen.getByRole('button', { name: t.retry }))
    await screen.findByText(t.portHint)
    expect(screen.getByText('3000 / 4000')).toBeTruthy()
  })
  it.each(['vi', 'en', 'cn', 'jp'] as const)(
    'supports %s without exposing runtime controls',
    async (locale) => {
      useUiState.setState({ locale })
      const copy = CONTROLLER_SOURCE_COPY[locale]
      render(view())
      fireEvent.click(screen.getByRole('button', { name: copy.open }))
      await screen.findByText(copy.intro)
      fireEvent.click(screen.getByRole('button', { name: copy.run }))
      await screen.findByText(copy.verified)
      await waitFor(() => expect(screen.getByText(copy.remaining)).toBeTruthy())
    }
  )
})
