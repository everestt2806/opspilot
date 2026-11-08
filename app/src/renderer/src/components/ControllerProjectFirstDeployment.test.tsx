// @vitest-environment jsdom
import type { DesktopControllerCommand } from '@shared/desktopControllerCommands'
import type { DesktopProjectReadiness } from '@shared/desktopFirstDeployment'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type {
  DesktopProjectSetup,
  DesktopProjectSourceVerification
} from '@shared/desktopProjectRegistration'
import { ControllerProjectFirstDeployment } from './ControllerProjectFirstDeployment'
import { CONTROLLER_FIRST_DEPLOY_COPY } from './controllerFirstDeployCopy'
import { useUiState } from '../store/uiState'
const t = CONTROLLER_FIRST_DEPLOY_COPY.en,
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
    <ControllerProjectFirstDeployment binding={binding} project={project} />
  </ConfigProvider>
)
const start = async (): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByRole('dialog')

  await waitFor(() => expect(screen.getByRole('button', { name: t.check })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: t.check }))
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
  invoke.mockImplementation(async (channel, input) => {
    if (channel === 'controller:commands') return { ok: true, data: [] }
    if (channel === 'controller:project-readiness') return { ok: true, data: readiness() }
    if (channel === 'controller:prepare-first-deployment')
      return {
        ok: true,
        data: {
          ...input,
          binding_id: binding.binding_id,
          binding_revision: 2,
          app_id: 42,
          source_sha: 'c'.repeat(40),
          valid_until: until,
          command: command()
        }
      }
    if (channel === 'controller:send-first-deployment')
      return { ok: true, data: command('accepted') }
    if (channel === 'controller:check-command') return { ok: true, data: command('accepted') }
    throw new Error(channel)
  })
})

const until = new Date(Date.now() + 60_000).toISOString()
const command = (
  state: 'prepared' | 'accepted' | 'outcome_unknown' = 'prepared'
): DesktopControllerCommand => ({
  client_id: binding.remote_client_id!,
  reason_code: null,
  auto_deploy_paused: true,
  updated_at: new Date().toISOString(),
  request_key: '55555555-5555-4555-8555-555555555555',
  binding_id: binding.binding_id,
  binding_revision: 2,
  controller_id: binding.controller_id,
  app_id: 42,
  operation: 'redeploy',
  require_first_deployment: true,
  state,
  remote_state: state === 'accepted' ? 'accepted' : null,
  job_id: state === 'accepted' ? 'job-1' : null,
  target_sha: 'c'.repeat(40),
  created_at: new Date().toISOString()
})
const readiness = (): DesktopProjectReadiness => ({
  binding_id: binding.binding_id,
  binding_revision: 2,
  request_key: project.request_key,
  controller_ready: true,
  state: 'ready',
  readiness_id: '44444444-4444-4444-8444-444444444444',
  valid_until: until,
  report: {
    ...source(),
    state: 'ready',
    host_port: project.host_port!,
    checked_at: new Date().toISOString(),
    checks: (
      [
        'first_deployment',
        'controller_resources',
        'target_enrollment',
        'source',
        'target_resources'
      ] as const
    ).map((key) => ({ key, state: 'passed' })),
    reasons: [],
    controller_resources: null,
    target_resources: null
  }
})
describe('First deployment review', () => {
  it('checks without starting deployment, persists review then sends exact journal key explicitly', async () => {
    render(view())
    await start()
    await screen.findByText(t.ready)
    expect(invoke).not.toHaveBeenCalledWith(
      'controller:prepare-first-deployment',
      expect.anything()
    )
    fireEvent.click(screen.getByRole('button', { name: t.review }))
    await screen.findByText(t.confirm)
    expect(invoke).not.toHaveBeenCalledWith('controller:send-first-deployment', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: t.send }))
    await screen.findByText(t.accepted)
    expect(invoke).toHaveBeenCalledWith(
      'controller:send-first-deployment',
      expect.objectContaining({ command_key: command().request_key })
    )
    expect(screen.queryByText(t.healthy)).toBeNull()
    expect(screen.queryByRole('button', { name: t.send })).toBeNull()
  })
  it('recovers unknown journal and never exposes a resend action', async () => {
    invoke.mockImplementationOnce(async () => ({ ok: true, data: [command('outcome_unknown')] }))
    render(view())
    fireEvent.click(screen.getByRole('button', { name: t.open }))
    await screen.findByText(t.pending)
    expect(screen.queryByRole('button', { name: t.send })).toBeNull()
    expect(screen.queryByRole('button', { name: t.check })).toBeNull()
  })
  it('requires fresh conditions for cold prepared command and offers explicit cancellation', async () => {
    invoke.mockImplementationOnce(async () => ({ ok: true, data: [command()] }))
    render(view())
    fireEvent.click(screen.getByRole('button', { name: t.open }))
    await screen.findByText(t.prepared)
    expect(screen.queryByRole('button', { name: t.send })).toBeNull()
    expect(screen.getByRole('button', { name: t.cancel })).toBeTruthy()
  })
  it('blocks review after readiness expiry', async () => {
    invoke.mockImplementation(async (channel) => ({
      ok: true,
      data:
        channel === 'controller:commands'
          ? []
          : { ...readiness(), valid_until: new Date(Date.now() - 1).toISOString() }
    }))
    render(view())
    await start()
    await screen.findByText(t.expired)
    expect(screen.getByRole('button', { name: t.review }).hasAttribute('disabled')).toBe(true)
  })
  it('does not grant review to blocked or mismatched readiness', async () => {
    invoke.mockImplementation(async (channel) => ({
      ok: true,
      data: channel === 'controller:commands' ? [] : { ...readiness(), binding_revision: 99 }
    }))
    render(view())
    await start()
    await screen.findByText(t.failed)
    expect(screen.queryByRole('button', { name: t.review })).toBeNull()
  })
  it('ignores late readiness after close', async () => {
    let finish!: (value: unknown) => void
    invoke.mockImplementation(async (channel) =>
      channel === 'controller:commands'
        ? { ok: true, data: [] }
        : new Promise((resolve) => {
            finish = resolve
          })
    )
    render(view())
    await start()
    await waitFor(() => expect(finish).toBeTruthy())
    fireEvent.click(screen.getAllByRole('button', { name: t.close }).at(-1)!)
    await act(async () => {
      finish({ ok: true, data: readiness() })
    })
    expect(screen.queryByText(t.ready)).toBeNull()
  })
  it.each([
    ['succeeded', 'running', true],
    ['queued', null, false],
    ['failed', null, false],
    ['succeeded', 'failed', false]
  ] as const)(
    'only marks matching succeeded and running healthy: %s %s',
    async (jobState, runtimeState, healthy) => {
      invoke.mockImplementation(async (channel) => {
        if (channel === 'controller:commands') return { ok: true, data: [command('accepted')] }
        if (channel === 'controller:check-command')
          return { ok: true, data: { ...command('accepted'), remote_state: 'completed' } }
        if (channel === 'controller:app-status')
          return {
            ok: true,
            data: {
              binding_id: binding.binding_id,
              binding_revision: 2,
              controller_id: binding.controller_id,
              app_id: 42,
              current_deployment_id: 1,
              current_deployment_sha: 'c'.repeat(40),
              current_deployment_state: runtimeState,
              latest_job_id: 'job-1',
              latest_job_state: jobState,
              checked_at: new Date().toISOString(),
              data_freshness: 'current'
            }
          }
        throw new Error(channel)
      })
      render(view())
      fireEvent.click(screen.getByRole('button', { name: t.open }))
      await screen.findByText(t.accepted)
      fireEvent.click(screen.getByRole('button', { name: t.refresh }))
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('controller:app-status', expect.anything())
      )
      if (healthy) await screen.findByText(t.healthy)
      else await waitFor(() => expect(screen.queryByText(t.healthy)).toBeNull())
    }
  )
  it.each(['vi', 'en', 'cn', 'jp'] as const)(
    'renders %s without backend writes',
    async (locale) => {
      useUiState.setState({ locale })
      render(view())
      fireEvent.click(
        screen.getByRole('button', { name: CONTROLLER_FIRST_DEPLOY_COPY[locale].open })
      )
      await screen.findByText(CONTROLLER_FIRST_DEPLOY_COPY[locale].intro)
      expect(invoke.mock.calls.every(([channel]) => channel === 'controller:commands')).toBe(true)
    }
  )
})
