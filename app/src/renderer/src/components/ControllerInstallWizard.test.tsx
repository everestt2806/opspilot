// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App as AntApp, ConfigProvider } from 'antd'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type {
  ControllerInstallerOverview,
  ControllerInstallerReview,
  DesktopInstallation
} from '@shared/controllerInstaller'
import { useUiState } from '../store/uiState'
import { ControllerInstallWizard } from './ControllerInstallWizard'
import { CONTROLLER_INSTALLER_COPY } from './controllerInstallerCopy'
import { CONTROLLER_ADOPTION_COPY } from './controllerAdoptionCopy'

const key = '11111111-1111-4111-8111-111111111111',
  planId = '22222222-2222-4222-8222-222222222222',
  binding = '33333333-3333-4333-8333-333333333333'
const t = CONTROLLER_INSTALLER_COPY.vi,
  invoke = vi.fn(),
  closed = vi.fn(),
  changed = vi.fn()
let overview: ControllerInstallerOverview,
  review: ControllerInstallerReview,
  stored: DesktopInstallation | null
const receipt = (state: DesktopInstallation['state'] = 'prepared'): DesktopInstallation => ({
  request_key: key,
  vps_id: 1,
  authority_revision: 1,
  release_id: 'linux22',
  release_sha256: 'a'.repeat(64),
  installer_sha256: 'b'.repeat(64),
  state,
  controller_id: state === 'installed' ? key : null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_result:
    state === 'installed'
      ? {
          format: 1,
          request_key: key,
          phase: 'installed',
          controller_id: key,
          service_state: 'running',
          runtime_uid: 1001,
          service_enabled: true,
          artifact_path: '/opt/controller/payload/control-plane.cjs',
          node_path: '/opt/controller/node',
          data_directory: '/var/lib/controller',
          payload_sha256: 'c'.repeat(64)
        }
      : null
})
const connection = (
  state: 'pending' | 'active' = 'pending'
): ControllerInstallerOverview['connections'][number] => ({
  binding_id: binding,
  controller_id: key,
  vps_id: 1,
  revision: 1,
  state,
  display_name: 'Fixture VPS',
  remote_client_id: state === 'active' ? binding : null,
  credential_expires_at: null,
  updated_at: new Date().toISOString(),
  scopes: ['read'],
  installation: { request_key: key, authority_revision: 1 }
})
const servers = [
  {
    id: 1,
    name: 'Fixture VPS',
    host: '127.0.0.1',
    username: 'root',
    host_fingerprint: 'SHA256:' + 'A'.repeat(43)
  }
]
const ok = <T,>(data: T): { ok: true; data: T } => ({ ok: true, data })
const show = (): ReturnType<typeof render> =>
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AntApp>
        <ControllerInstallWizard open onClose={closed} onChanged={changed} />
      </AntApp>
    </ConfigProvider>
  )
beforeEach(() => {
  useUiState.setState({ locale: 'vi' })
  invoke.mockReset()
  closed.mockReset()
  changed.mockReset()
  stored = null
  overview = {
    releases: [
      {
        release_id: 'linux22',
        node_version: '22.23.4',
        minimum_glibc: '2.39',
        platform: 'linux-x64-glibc',
        state: 'available'
      }
    ],
    installations: [],
    connections: []
  }
  review = {
    next: 'install',
    root_required: false,
    plan: {
      plan_id: planId,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      vps_id: 1,
      host: '127.0.0.1',
      username: 'root',
      host_fingerprint: 'SHA256:' + 'A'.repeat(43),
      release_id: 'linux22',
      request_key: key,
      remote_existing: false,
      rebind_required: false
    },
    host: {
      state: 'compatible_snapshot',
      service_mode: 'system',
      reasons: [],
      facts: {
        format: 1,
        system: 'Linux',
        architecture: 'x86_64',
        libc: 'glibc',
        libc_version: '2.39',
        uid: 0,
        available_memory_bytes: 1024 ** 3,
        free_disk_bytes: 8 * 1024 ** 3,
        systemd_system: true,
        systemd_user_bus: false,
        user_linger: false,
        installation_conflict: false
      }
    }
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async (channel: string, input?: unknown) => {
    if (channel === 'vps:list') return ok(servers)
    if (channel === 'controller:installer-overview')
      return ok({ ...overview, installations: stored ? [stored] : overview.installations })
    if (channel === 'controller:review-installation') return ok(review)
    if (channel === 'controller:review-adoption')
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: 'No current revision',
          technical: 'UPGRADE_UNAVAILABLE'
        }
      }
    if (channel === 'controller:prepare-installation') {
      stored = receipt()
      return ok(stored)
    }
    if (channel === 'controller:rebind-installation') {
      stored = { ...receipt('outcome_unknown'), authority_revision: 2 }
      return ok(stored)
    }
    if (channel === 'controller:send-installation') {
      const operation = (input as { operation: string }).operation
      stored = operation === 'transfer' ? receipt('transferred') : receipt('installed')
      return ok(stored)
    }
    if (channel === 'controller:inspect-installation') {
      stored = { ...receipt('installed'), authority_revision: stored?.authority_revision ?? 1 }
      return ok(stored)
    }
    if (channel === 'controller:prepare-installed-binding') return ok(connection())
    if (channel === 'controller:register-installed') return ok(connection('active'))
    if (channel === 'controller:cancel-installation') {
      stored = receipt('cancelled')
      return ok(stored)
    }
    throw Error('UNEXPECTED_FIXTURE_CHANNEL')
  })
})
afterEach(() => {
  cleanup()
  useUiState.setState({ locale: 'vi' })
})
const reviewVps = async (): Promise<void> => {
  const button = await screen.findByRole('button', { name: t.review })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
  await screen.findByRole('checkbox', { name: t.consent })
  await waitFor(() =>
    expect((screen.getByRole('checkbox', { name: t.consent }) as HTMLInputElement).disabled).toBe(
      false
    )
  )
}
it('keeps writes behind review/consent and performs the complete same-key installation/binding plan', async () => {
  show()
  await reviewVps()
  const install = screen.getByRole('button', { name: t.install })
  expect((install as HTMLButtonElement).disabled).toBe(true)
  expect(invoke.mock.calls.some(([channel]) => channel === 'controller:send-installation')).toBe(
    false
  )
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(install)
  await screen.findByText(t.connected)
  expect(
    invoke.mock.calls
      .filter(([channel]) => channel === 'controller:send-installation')
      .map(([, input]) => input)
  ).toEqual([
    { request_key: key, operation: 'transfer', consent: true },
    { request_key: key, operation: 'install', consent: true }
  ])
  expect(invoke).toHaveBeenCalledWith('controller:register-installed', {
    installation_request_key: key,
    binding_id: binding,
    display_name: 'Fixture VPS',
    allow_write: false
  })
  expect(
    invoke.mock.calls.findIndex(([v]) => v === 'controller:prepare-installed-binding')
  ).toBeLessThan(invoke.mock.calls.findIndex(([v]) => v === 'controller:register-installed'))
  expect(screen.queryByDisplayValue('/opt/controller/node')).toBeNull()
  expect(changed).toHaveBeenCalledTimes(1)
})
it('does not expose an install action when the app has no trusted runtime package', async () => {
  overview.releases = []
  show()
  await screen.findByText(t.noPackage)
  expect(screen.queryByRole('button', { name: t.install })).toBeNull()
  expect(invoke.mock.calls.some(([v]) => v === 'controller:prepare-installation')).toBe(false)
})
it('does not continue installation after the wizard closes while transfer is pending', async () => {
  let resolve!: (value: unknown) => void
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation((channel: string, input?: unknown) =>
    channel === 'controller:send-installation'
      ? new Promise((done) => {
          resolve = done
        })
      : original(channel, input)
  )
  const view = show()
  await reviewVps()
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.install }))
  await waitFor(() => expect(resolve).toBeDefined())
  fireEvent.click(screen.getByRole('button', { name: t.close }))
  await act(async () => resolve(ok(receipt('transferred'))))
  expect(invoke.mock.calls.filter(([v]) => v === 'controller:send-installation')).toHaveLength(1)
  expect(invoke.mock.calls.some(([v]) => v === 'controller:register-installed')).toBe(false)
  view.unmount()
})
it('does not issue an enrollment after closing while durable binding preparation is pending', async () => {
  let resolve!: (value: unknown) => void
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation((channel: string, input?: unknown) =>
    channel === 'controller:prepare-installed-binding'
      ? new Promise((done) => {
          resolve = done
        })
      : original(channel, input)
  )
  const view = show()
  await reviewVps()
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.install }))
  await waitFor(() => expect(resolve).toBeDefined())
  view.unmount()
  await act(async () => resolve(ok(connection())))
  expect(invoke.mock.calls.some(([v]) => v === 'controller:register-installed')).toBe(false)
})
it('handles a lost install reply through explicit inspect without replaying install', async () => {
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation((channel: string, input?: unknown) => {
    if (
      channel === 'controller:send-installation' &&
      (input as { operation: string }).operation === 'install'
    ) {
      stored = receipt('outcome_unknown')
      return Promise.resolve({
        ok: false,
        error: { code: 'UNKNOWN', technical: 'BOOTSTRAP_OUTCOME_UNKNOWN', message: 'Fixture' }
      })
    }
    return original(channel, input)
  })
  show()
  await reviewVps()
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.install }))
  await waitFor(() => expect(screen.getAllByText(t.unknown).length).toBeGreaterThan(0))
  const check = screen.getByRole('button', { name: t.check })
  await waitFor(() => expect((check as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(check)
  await screen.findByRole('button', { name: t.connect })
  expect(
    invoke.mock.calls.filter(
      ([v, input]) =>
        v === 'controller:send-installation' &&
        (input as { operation: string }).operation === 'install'
    )
  ).toHaveLength(1)
  expect(invoke.mock.calls.some(([v]) => v === 'controller:register-installed')).toBe(false)
})
it('keeps an explicitly stopped service stopped and offers no ready connection action', async () => {
  stored = receipt('installed')
  stored.last_result!.service_state = 'stopped'
  review.next = 'inspect_existing'
  review.plan!.remote_existing = true
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation((channel: string, input?: unknown) =>
    channel === 'controller:inspect-installation'
      ? Promise.resolve(ok(stored))
      : original(channel, input)
  )
  show()
  await reviewVps()
  fireEvent.click(screen.getByRole('button', { name: t.check }))
  await screen.findByText(t.stopped)
  expect(screen.queryByRole('button', { name: t.connect })).toBeNull()
  expect(invoke.mock.calls.some(([v]) => v === 'controller:send-installation')).toBe(false)
})
it('clears the rebind gate only after explicit same-key rebind and inspect', async () => {
  stored = receipt('installed')
  review.next = 'inspect_existing'
  review.plan!.remote_existing = true
  review.plan!.rebind_required = true
  show()
  await reviewVps()
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.rebindAction }))
  const connect = await screen.findByRole('button', { name: t.connect })
  await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false))
  expect(invoke).toHaveBeenCalledWith('controller:rebind-installation', {
    plan_id: planId,
    request_key: key,
    confirm: true
  })
  expect(invoke.mock.calls.some(([v]) => v === 'controller:send-installation')).toBe(false)
})
it.each(['vi', 'en', 'cn', 'jp'] as const)('renders the installer flow in %s', async (locale) => {
  useUiState.setState({ locale })
  show()
  await screen.findByRole('button', { name: CONTROLLER_INSTALLER_COPY[locale].review })
  expect(screen.getByText(CONTROLLER_INSTALLER_COPY[locale].title)).toBeTruthy()
  expect(
    screen.getAllByRole('button', {
      name: (name) =>
        name.replace(/\s+/g, '') === CONTROLLER_INSTALLER_COPY[locale].close.replace(/\s+/g, '')
    }).length
  ).toBeGreaterThan(0)
})

it('adopts current revision separately from granting API permissions and never reinstalls', async () => {
  const a = CONTROLLER_ADOPTION_COPY.vi,
    original = invoke.getMockImplementation()!
  review.next = 'inspect_existing'
  review.plan!.remote_existing = true
  const current = {
    ...receipt('installed'),
    last_result: { ...receipt('installed').last_result!, service_state: 'stopped' as const }
  }
  current.current_revision = {
    request_key: binding,
    installation_request_key: key,
    controller_id: key,
    parent_upgrade_key: null,
    parent_release_sha256: 'a'.repeat(64),
    release_sha256: 'd'.repeat(64),
    vps_id: 1,
    authority_revision: 1,
    release_id: 'current22',
    installer_sha256: 'b'.repeat(64),
    state: 'active',
    is_current: true,
    created_at: current.created_at,
    updated_at: current.updated_at,
    last_result: {
      format: 1,
      request_key: binding,
      installation_request_key: key,
      controller_id: key,
      parent_upgrade_key: null,
      parent_release_sha256: 'a'.repeat(64),
      release_sha256: 'd'.repeat(64),
      payload_sha256: 'e'.repeat(64),
      runtime_release_sha256: 'd'.repeat(64),
      runtime_payload_sha256: 'e'.repeat(64),
      runtime_upgrade_key: binding,
      phase: 'active',
      is_current: true,
      service_state: 'running',
      runtime_uid: 1001,
      artifact_path: '/opt/controller/revisions/current/payload/control-plane.cjs',
      node_path: '/opt/controller/revisions/current/node',
      data_directory: '/var/lib/controller'
    }
  }
  invoke.mockImplementation(async (channel: string, input?: unknown) => {
    if (channel === 'controller:review-adoption')
      return ok({
        plan_id: planId,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        installation_request_key: key,
        upgrade_request_key: binding,
        controller_id: key,
        vps_id: 1,
        host: servers[0].host,
        username: 'root',
        host_fingerprint: servers[0].host_fingerprint,
        release_id: 'current22'
      })
    if (channel === 'controller:confirm-adoption') {
      stored = current
      return ok({
        installation_request_key: key,
        upgrade_request_key: binding,
        controller_id: key,
        vps_id: 1,
        enrollment_required: true
      })
    }
    return original(channel, input)
  })
  show()
  const find = await screen.findByRole('button', { name: t.review })
  await waitFor(() => expect((find as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(find)
  const confirm = await screen.findByRole('button', { name: a.confirm })
  expect((confirm as HTMLButtonElement).disabled).toBe(true)
  expect(invoke.mock.calls.some(([c]) => c === 'controller:confirm-adoption')).toBe(false)
  fireEvent.click(screen.getByRole('checkbox', { name: a.consent }))
  fireEvent.click(confirm)
  await screen.findByText(a.adopted)
  const connect = screen.getByRole('button', { name: t.connect })
  expect((connect as HTMLButtonElement).disabled).toBe(true)
  expect(invoke.mock.calls.some(([c]) => c === 'controller:register-installed')).toBe(false)
  expect(screen.queryByText(t.stopped)).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: a.connectConsent }))
  fireEvent.click(connect)
  await screen.findByText(t.connected)
  expect(invoke.mock.calls.some(([c]) => c === 'controller:send-installation')).toBe(false)
  expect(invoke).toHaveBeenCalledWith('controller:register-installed', {
    installation_request_key: key,
    binding_id: binding,
    display_name: 'Fixture VPS',
    allow_write: false
  })
})
it('drops a late adoption review after closing the wizard', async () => {
  const a = CONTROLLER_ADOPTION_COPY.vi,
    original = invoke.getMockImplementation()!
  let finish!: (v: unknown) => void
  invoke.mockImplementation((channel: string, input?: unknown) =>
    channel === 'controller:review-adoption'
      ? new Promise((done) => {
          finish = done
        })
      : original(channel, input)
  )
  show()
  const find = await screen.findByRole('button', { name: a.review })
  await waitFor(() => expect((find as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(find)
  await waitFor(() => expect(finish).toBeDefined())
  fireEvent.click(screen.getByRole('button', { name: t.close }))
  await act(async () => finish(ok({ plan_id: planId, host: 'late.invalid' })))
  expect(screen.queryByRole('button', { name: a.confirm })).toBeNull()
  expect(invoke.mock.calls.some(([c]) => c === 'controller:confirm-adoption')).toBe(false)
})

it('does not fall back to original installation when current-revision verification fails', async () => {
  review.next = 'inspect_existing'
  review.plan!.remote_existing = true
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation((channel: string, input?: unknown) =>
    channel === 'controller:review-adoption'
      ? Promise.resolve({
          ok: false,
          error: { code: 'VALIDATION', message: 'Unverified', technical: 'UPGRADE_CONFLICT' }
        })
      : original(channel, input)
  )
  show()
  const button = await screen.findByRole('button', { name: t.review })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
  await screen.findByText(CONTROLLER_ADOPTION_COPY.vi.unavailable)
  expect(
    invoke.mock.calls.some(([c]) =>
      [
        'controller:prepare-installation',
        'controller:send-installation',
        'controller:confirm-adoption'
      ].includes(c)
    )
  ).toBe(false)
  expect(screen.queryByRole('checkbox', { name: t.consent })).toBeNull()
})
