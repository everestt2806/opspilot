// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopControllerConnection,
  DesktopControllerSnapshot,
  DesktopControllerAppStatus
} from '@shared/desktopController'
import type { DesktopControllerCommand } from '@shared/desktopControllerCommands'
import { ControllerCommandPanel } from './ControllerCommandPanel'
import { CONTROLLER_COMMAND_COPY } from './controllerCommandCopy'
import { useUiState } from '../store/uiState'
const t = CONTROLLER_COMMAND_COPY.vi,
  bindingId = '11111111-1111-4111-8111-111111111111',
  key = '22222222-2222-4222-8222-222222222222'
let binding: DesktopControllerConnection,
  snapshot: DesktopControllerSnapshot,
  records: DesktopControllerCommand[],
  loseReply: boolean
const invoke = vi.fn()
const command = (
  state: DesktopControllerCommand['state'] = 'prepared'
): DesktopControllerCommand => ({
  request_key: key,
  binding_id: bindingId,
  controller_id: 'controller-a',
  client_id: '33333333-3333-4333-8333-333333333333',
  binding_revision: 2,
  app_id: 1,
  operation: 'redeploy',
  state,
  reason_code: null,
  remote_state: null,
  job_id: null,
  target_sha: null,
  auto_deploy_paused: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
})
const status = (id: number): DesktopControllerAppStatus => ({
  binding_id: bindingId,
  binding_revision: 2,
  controller_id: 'controller-a',
  app_id: id,
  ownership_generation: 1,
  source_generation: 2,
  current_deployment_id: null,
  current_deployment_sha: null,
  current_deployment_state: null,
  latest_job_id: 'job-' + id,
  latest_job_state: 'queued',
  checked_at: new Date().toISOString(),
  data_freshness: 'current'
})
const view = (fresh = true): React.JSX.Element => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <App>
      <ControllerCommandPanel binding={binding} snapshot={snapshot} fresh={fresh} />
    </App>
  </ConfigProvider>
)
const choose = async (name = 'Remote one', waitForStatus = true): Promise<void> => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: t.choose }))
  const options = await screen.findAllByText(name)
  fireEvent.click(options.at(-1)!)
  await screen.findByRole('region', { name: t.status })
  if (waitForStatus) await screen.findByText(t.job)
}
beforeEach(() => {
  useUiState.setState({ locale: 'vi' })
  records = []
  loseReply = false
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
  snapshot = {
    binding_id: bindingId,
    binding_revision: 2,
    controller_id: 'controller-a',
    service_state: 'ready',
    data_freshness: 'current',
    checked_at: new Date().toISOString(),
    capabilities: { redeploy: 'available', pause: 'available', resume: 'available' },
    items: [1, 2].map((id) => ({
      app_id: id,
      app_name: id === 1 ? 'Remote one' : 'Remote two',
      ownership_generation: 1,
      source_generation: 2,
      production_ref: 'main',
      desired_sha: (id === 1 ? 'a' : 'b').repeat(40),
      auto_deploy_paused: true,
      reconciliation_state: 'paused',
      observed_at: null
    })),
    next_cursor: null,
    has_more: false
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, input?: unknown) => {
    if (channel === 'controller:commands')
      return { ok: true, data: records.map((row) => ({ ...row })) }
    if (channel === 'controller:app-status')
      return { ok: true, data: status((input as { app_id: number }).app_id) }
    if (channel === 'controller:prepare-command') {
      records = [
        { ...command(), operation: (input as { operation: 'redeploy' | 'policy' }).operation }
      ]
      return { ok: true, data: records[0] }
    }
    if (channel === 'controller:send-command') {
      records = [
        {
          ...(records[0] ?? command()),
          state: loseReply ? 'outcome_unknown' : 'accepted',
          remote_state: loseReply ? null : 'accepted',
          job_id: loseReply ? null : 'job-1'
        }
      ]
      return { ok: true, data: records[0] }
    }
    if (channel === 'controller:check-command') {
      records = [{ ...command('accepted'), remote_state: 'accepted', job_id: 'job-1' }]
      return { ok: true, data: records[0] }
    }
    if (channel === 'controller:cancel-command') {
      records = [command('cancelled')]
      return { ok: true, data: records[0] }
    }
    throw new Error('Unexpected IPC')
  })
})
afterEach(() => {
  vi.useRealTimers()
})
describe('Controller deployment and request UI', () => {
  it('keeps read-only registrations unable to prepare commands', async () => {
    binding.scopes = ['read']
    render(view())
    await choose()
    expect(screen.getByText(t.readOnly)).toBeTruthy()
    for (const name of [t.deploy, t.pause, t.resume])
      expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
    expect(invoke.mock.calls.some(([op]) => op === 'controller:prepare-command')).toBe(false)
  })
  it('confirms an exact observed SHA, prepares before send, and never calls accepted a successful deployment', async () => {
    render(view())
    await choose()
    fireEvent.click(screen.getByRole('button', { name: t.deploy }))
    await screen.findByRole('dialog')
    expect(screen.getByText('a'.repeat(40))).toBeTruthy()
    expect(invoke.mock.calls.some(([op]) => op === 'controller:prepare-command')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: t.ok }))
    await screen.findByText(t.acceptedHint)
    expect(invoke).toHaveBeenCalledWith('controller:prepare-command', {
      binding_id: bindingId,
      app_id: 1,
      expected_ownership_generation: 1,
      expected_source_generation: 2,
      operation: 'redeploy',
      target: { kind: 'specific_sha', sha: 'a'.repeat(40) }
    })
    expect(invoke.mock.calls.findIndex(([op]) => op === 'controller:prepare-command')).toBeLessThan(
      invoke.mock.calls.findIndex(([op]) => op === 'controller:send-command')
    )
    expect(screen.queryByText(t.succeeded)).toBeNull()
    expect(invoke.mock.calls.some(([op]) => op === 'deploy:start')).toBe(false)
  })
  it('only looks up the existing key after lost response, without creating or sending another request', async () => {
    loseReply = true
    render(view())
    await choose()
    fireEvent.click(screen.getByRole('button', { name: t.deploy }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: t.ok }))
    await screen.findByText(t.unknownHint)
    const row = screen.getByText(t.outcome_unknown).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: t.refresh }))
    await screen.findByText(t.acceptedHint)
    expect(invoke).toHaveBeenCalledWith('controller:check-command', key)
    expect(invoke.mock.calls.filter(([op]) => op === 'controller:prepare-command')).toHaveLength(1)
    expect(invoke.mock.calls.filter(([op]) => op === 'controller:send-command')).toHaveLength(1)
  })
  it('shows a cold unsent request with cancel, never sends it automatically', async () => {
    records = [command()]
    render(view())
    await screen.findByText(t.preparedHint)
    fireEvent.click(screen.getByRole('button', { name: t.cancel }))
    await screen.findByText(t.cancelled)
    expect(invoke).toHaveBeenCalledWith('controller:cancel-command', key)
    expect(invoke.mock.calls.some(([op]) => op === 'controller:send-command')).toBe(false)
  })
  it('refuses a confirmation when the observed commit changes while the dialog is open', async () => {
    const rendered = render(view())
    await choose()
    fireEvent.click(screen.getByRole('button', { name: t.deploy }))
    await screen.findByRole('dialog')
    snapshot = { ...snapshot, items: [{ ...snapshot.items[0], desired_sha: 'c'.repeat(40) }] }
    rendered.rerender(view())
    fireEvent.click(screen.getByRole('button', { name: t.ok }))
    await screen.findByText(t.changed)
    expect(invoke.mock.calls.some(([op]) => op === 'controller:prepare-command')).toBe(false)
  })
  it('keeps an unsent journal entry if the prepare response is lost', async () => {
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel, input) => {
      if (channel === 'controller:prepare-command') {
        records = [command()]
        throw new Error('IPC lost')
      }
      return original(channel, input)
    })
    render(view())
    await choose()
    fireEvent.click(screen.getByRole('button', { name: t.deploy }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: t.ok }))
    await screen.findByText(t.preparedHint)
    expect(invoke.mock.calls.some(([op]) => op === 'controller:send-command')).toBe(false)
  })
  it('blocks stale or unavailable capability actions and separates a history error from empty history', async () => {
    const rendered = render(view(false))
    await choose()
    expect(screen.getByRole('button', { name: t.deploy }).hasAttribute('disabled')).toBe(true)
    snapshot = {
      ...snapshot,
      capabilities: { redeploy: 'blocked', pause: 'unsupported', resume: 'blocked' }
    }
    rendered.rerender(view())
    expect(screen.getByRole('button', { name: t.deploy }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(t.blocked)).toBeTruthy()
    invoke.mockResolvedValue({ ok: false, error: { technical: 'CLIENT_REVOKED' } })
    fireEvent.click(screen.getAllByRole('button', { name: t.refresh }).at(-1)!)
    await screen.findAllByText(t.historyError)
    expect(screen.queryByText(t.empty)).toBeNull()
  })
  it('does not replace selected app status with a late response from the old app', async () => {
    let resolveOld!: (value: unknown) => void
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel, input) => {
      if (channel === 'controller:app-status' && input.app_id === 1)
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      return original(channel, input)
    })
    render(view())
    await choose('Remote one', false)
    await choose('Remote two')
    await screen.findByText(/job-2/)
    await act(async () =>
      resolveOld({ ok: true, data: { ...status(1), latest_job_id: 'late-job' } })
    )
    expect(screen.queryByText(/late-job/)).toBeNull()
  })
  it('renders action and journal copy in all supported languages', async () => {
    binding.scopes = ['read']
    render(view())
    await screen.findByText(t.empty)
    for (const locale of ['en', 'cn', 'jp', 'vi'] as const) {
      act(() => useUiState.setState({ locale }))
      expect(screen.getByText(CONTROLLER_COMMAND_COPY[locale].readOnly)).toBeTruthy()
      expect(
        screen.getByRole('button', { name: CONTROLLER_COMMAND_COPY[locale].deploy })
      ).toBeTruthy()
    }
  })
  it('confirms pause and resume with the selected remote generations and no arbitrary fields', async () => {
    render(view())
    await choose()
    for (const [index, action] of (['pause', 'resume'] as const).entries()) {
      await waitFor(() =>
        expect(screen.getByRole('button', { name: t[action] }).hasAttribute('disabled')).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: t[action] }))
      await screen.findByRole('dialog')
      fireEvent.click(screen.getByRole('button', { name: t.ok }))
      await waitFor(() =>
        expect(invoke.mock.calls.filter(([op]) => op === 'controller:send-command')).toHaveLength(
          index + 1
        )
      )
      expect(
        invoke.mock.calls.filter(([op]) => op === 'controller:prepare-command')[index][1]
      ).toEqual({
        binding_id: bindingId,
        app_id: 1,
        expected_ownership_generation: 1,
        expected_source_generation: 2,
        operation: 'policy',
        action
      })
    }
  })
  it('does not dispatch a prepared request after its screen unmounts', async () => {
    let resolvePrepared!: (value: unknown) => void
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel, input) => {
      if (channel === 'controller:prepare-command') {
        records = [command()]
        return new Promise((resolve) => {
          resolvePrepared = resolve
        })
      }
      return original(channel, input)
    })
    const rendered = render(view())
    await choose()
    fireEvent.click(screen.getByRole('button', { name: t.deploy }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: t.ok }))
    await waitFor(() => expect(resolvePrepared).toBeTypeOf('function'))
    rendered.unmount()
    await act(async () => resolvePrepared({ ok: true, data: records[0] }))
    expect(invoke.mock.calls.some(([op]) => op === 'controller:send-command')).toBe(false)
    expect(records[0].state).toBe('prepared')
  })
})
