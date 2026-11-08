// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeEach, it, expect, vi } from 'vitest'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopTargetSetup } from '@shared/desktopTargetRegistration'
import { ControllerTargetRegistrationPanel } from './ControllerTargetRegistrationPanel'
import { CONTROLLER_TARGET_REGISTRATION_COPY } from './controllerTargetRegistrationCopy'
import { useUiState } from '../store/uiState'
const invoke = vi.fn(),
  t = CONTROLLER_TARGET_REGISTRATION_COPY.en
let binding: DesktopControllerConnection, rows: DesktopTargetSetup[]
const profile = {
  name: 'Lab target',
  host: '192.0.2.2',
  port: 22,
  username: 'operator',
  auth_type: 'password' as const,
  host_fingerprint: 'SHA256:' + 'B'.repeat(43)
}
const setup = (): DesktopTargetSetup => ({
  request_key: '33333333-3333-4333-8333-333333333333',
  binding_id: binding.binding_id,
  binding_revision: binding.revision,
  controller_id: binding.controller_id,
  local_vps_id: 5,
  local_security_revision: 1,
  profile,
  state: 'prepared',
  remote_vps_id: null,
  remote_security_revision: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
})
const view = (): React.JSX.Element => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <ControllerTargetRegistrationPanel binding={binding} />
  </ConfigProvider>
)
const start = async (): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByRole('combobox')
  fireEvent.mouseDown(screen.getByRole('combobox'))
  fireEvent.click(await screen.findByText('Lab target (192.0.2.2:22)'))
  fireEvent.click(screen.getByRole('button', { name: t.review }))
  await screen.findByText(t.prepared)
}
beforeEach(() => {
  useUiState.setState({ locale: 'en' })
  invoke.mockReset()
  rows = []
  binding = {
    binding_id: '11111111-1111-4111-8111-111111111111',
    controller_id: 'controller-unit',
    vps_id: 1,
    revision: 2,
    state: 'active',
    display_name: 'Controller lab',
    remote_client_id: '22222222-2222-4222-8222-222222222222',
    credential_expires_at: '2030-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    scopes: ['read', 'deploy:manual', 'policy:write']
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async (channel, input) => {
    if (channel === 'controller:target-setups') return { ok: true, data: rows }
    if (channel === 'vps:list') return { ok: true, data: [{ id: 5, ...profile }] }
    if (channel === 'controller:prepare-target') {
      rows = [setup()]
      return { ok: true, data: rows[0] }
    }
    if (channel === 'controller:send-target') {
      rows = [{ ...rows[0], state: 'registered', remote_vps_id: 7, remote_security_revision: 1 }]
      return { ok: true, data: rows[0] }
    }
    if (channel === 'controller:cancel-target') {
      expect(input).toBe(rows[0].request_key)
      rows = [{ ...rows[0], state: 'cancelled' }]
      return { ok: true, data: rows[0] }
    }
    throw new Error(channel)
  })
})
it('reviews profile without sending credentials and requires a separate consent checkbox', async () => {
  render(view())
  await start()
  expect(screen.getByText(profile.host_fingerprint)).toBeTruthy()
  expect(screen.getByText('192.0.2.2:22')).toBeTruthy()
  expect(screen.getByRole('button', { name: t.send }).hasAttribute('disabled')).toBe(true)
  expect(invoke).toHaveBeenCalledWith('controller:prepare-target', {
    binding_id: binding.binding_id,
    local_vps_id: 5
  })
  expect(invoke.mock.calls.some(([channel]) => channel === 'controller:send-target')).toBe(false)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: t.send }))
  await screen.findByText(t.registered)
  expect(invoke).toHaveBeenCalledWith('controller:send-target', {
    request_key: setup().request_key,
    confirm_transfer: true
  })
  expect(document.querySelector('input[type="password"]')).toBeNull()
  expect(
    invoke.mock.calls.every(
      ([, input]) =>
        typeof input !== 'object' || !input || (!('secret' in input) && !('password' in input))
    )
  ).toBe(true)
})
it('reopens an unknown request and retries only its original UUID after fresh consent', async () => {
  rows = [{ ...setup(), state: 'outcome_unknown' }]
  render(view())
  await screen.findByText(t.labels.outcome_unknown)
  fireEvent.click(screen.getByRole('button', { name: t.resume }))
  await screen.findByText(t.unknown)
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByRole('button', { name: t.cancel })).toBeNull()
  expect(screen.getByRole('button', { name: t.retry }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: t.retry }))
  await screen.findByText(t.registered)
  expect(invoke.mock.calls.some(([channel]) => channel === 'controller:prepare-target')).toBe(false)
  expect(invoke).toHaveBeenCalledWith('controller:send-target', {
    request_key: rows[0].request_key,
    confirm_transfer: true
  })
})
it('reloads journal after a lost reply and does not show unsent cancellation', async () => {
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation(async (channel, input) => {
    if (channel === 'controller:send-target') {
      rows = [{ ...rows[0], state: 'outcome_unknown' }]
      return {
        ok: false,
        error: { technical: 'CONTROLLER_ADMIN_FAILED synthetic-private-material' }
      }
    }
    return original(channel, input)
  })
  render(view())
  await start()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: t.send }))
  await screen.findByText(t.unknown)
  expect(screen.queryByRole('button', { name: t.cancel })).toBeNull()
  expect(screen.getByRole('button', { name: t.retry }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByText(/synthetic-private-material/)).toBeNull()
})
it('cancels only a prepared request without a transfer', async () => {
  render(view())
  await start()
  fireEvent.click(screen.getByRole('button', { name: t.cancel }))
  await screen.findByText(t.cancelled)
  expect(invoke.mock.calls.some(([channel]) => channel === 'controller:send-target')).toBe(false)
})
it('disables registration for a read-only connection', () => {
  binding = { ...binding, scopes: ['read'] }
  render(view())
  expect(screen.getByRole('button', { name: t.open }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText(t.scope)).toBeTruthy()
})
it('rejects prepared metadata from another binding', async () => {
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation(async (channel, input) =>
    channel === 'controller:prepare-target'
      ? { ok: true, data: { ...setup(), binding_id: 'other' } }
      : original(channel, input)
  )
  render(view())
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  fireEvent.mouseDown(await screen.findByRole('combobox'))
  fireEvent.click(await screen.findByText('Lab target (192.0.2.2:22)'))
  fireEvent.click(screen.getByRole('button', { name: t.review }))
  await screen.findByText(t.failed)
  expect(screen.queryByRole('checkbox')).toBeNull()
})
it('ignores a late profile list after the dialog closes', async () => {
  let finish!: (value: unknown) => void
  invoke.mockImplementation(async (channel) =>
    channel === 'vps:list'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : { ok: true, data: [] }
  )
  render(view())
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await waitFor(() => expect(finish).toBeTruthy())
  fireEvent.click(screen.getAllByRole('button', { name: t.close }).at(-1)!)
  await act(async () => {
    finish({ ok: true, data: [{ id: 5, ...profile }] })
  })
  expect(screen.queryByRole('dialog')).toBeNull()
})
it.each(['vi', 'en', 'cn', 'jp'] as const)(
  'uses %s copy without transferring on open',
  async (locale) => {
    useUiState.setState({ locale })
    render(view())
    fireEvent.click(
      screen.getByRole('button', { name: CONTROLLER_TARGET_REGISTRATION_COPY[locale].open })
    )
    await screen.findByText(CONTROLLER_TARGET_REGISTRATION_COPY[locale].intro)
    expect(
      invoke.mock.calls.every(([channel]) =>
        ['controller:target-setups', 'vps:list'].includes(channel)
      )
    ).toBe(true)
  }
)
