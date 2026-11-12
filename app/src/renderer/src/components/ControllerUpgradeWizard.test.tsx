// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { ControllerUpgradeWizard } from './ControllerUpgradeWizard'
import { useUiState } from '../store/uiState'
import type { ControllerUpgradeOverview, DesktopUpgrade } from '@shared/controllerUpgrade'

const ik = '11111111-1111-4111-8111-111111111111',
  uk = '22222222-2222-4222-8222-222222222222',
  cid = '33333333-3333-4333-8333-333333333333',
  binding = '44444444-4444-4444-8444-444444444444',
  plan = '55555555-5555-4555-8555-555555555555'
let overview: ControllerUpgradeOverview,
  invoke: ReturnType<typeof vi.fn<(channel: string, input?: unknown) => Promise<unknown>>>
const record = (state: DesktopUpgrade['state']): DesktopUpgrade => ({
  request_key: uk,
  installation_request_key: ik,
  controller_id: cid,
  parent_upgrade_key: null,
  parent_release_sha256: 'a'.repeat(64),
  release_sha256: 'b'.repeat(64),
  installer_sha256: 'c'.repeat(64),
  vps_id: 1,
  authority_revision: 1,
  release_id: 'upgrade-fixture',
  state,
  is_current: state === 'active' || state === 'rolled_back',
  last_result: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
})
const expiry = (): string => new Date(Date.now() + 60000).toISOString()
beforeEach(() => {
  useUiState.setState({ locale: 'vi' })
  overview = {
    releases: [
      {
        release_id: 'upgrade-fixture',
        node_version: '22.23.4',
        minimum_glibc: '2.39',
        platform: 'linux-x64-glibc',
        state: 'available',
        upgrade_supported: true
      }
    ],
    installations: [
      {
        request_key: ik,
        release_sha256: 'a'.repeat(64),
        installer_sha256: 'd'.repeat(64),
        vps_id: 1,
        authority_revision: 1,
        release_id: 'original',
        state: 'installed',
        controller_id: cid,
        last_result: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ],
    upgrades: [],
    connections: [
      {
        installation: { request_key: ik, authority_revision: 1 },
        binding_id: binding,
        controller_id: cid,
        vps_id: 1,
        revision: 2,
        state: 'active',
        display_name: 'Demo connection',
        remote_client_id: null,
        credential_expires_at: null,
        updated_at: new Date().toISOString(),
        scopes: ['read']
      }
    ]
  }
  invoke = vi.fn(async (channel: string, input: unknown) => {
    if (channel === 'controller:upgrade-overview')
      return { ok: true, data: structuredClone(overview) }
    if (channel === 'controller:review-upgrade')
      return {
        ok: true,
        data: {
          plan_id: plan,
          expires_at: expiry(),
          installation_request_key: ik,
          controller_id: cid,
          vps_id: 1,
          host: 'fixture.test',
          release_id: 'upgrade-fixture',
          parent_upgrade_key: null
        }
      }
    if (channel === 'controller:prepare-upgrade') {
      overview.upgrades = [record('prepared')]
      return { ok: true, data: overview.upgrades[0] }
    }
    if (channel === 'controller:send-upgrade') {
      const op = (input as { operation: string }).operation
      overview.upgrades = [
        record(op === 'transfer' ? 'transferred' : op === 'rollback' ? 'rolled_back' : 'active')
      ]
      return { ok: true, data: overview.upgrades[0] }
    }
    if (channel === 'controller:inspect-upgrade') return { ok: true, data: overview.upgrades[0] }
    if (channel === 'controller:review-upgrade-binding')
      return {
        ok: true,
        data: {
          plan_id: plan,
          expires_at: expiry(),
          binding_id: binding,
          upgrade_request_key: uk,
          binding_revision: 2,
          controller_id: cid,
          release_id: 'upgrade-fixture'
        }
      }
    if (channel === 'controller:refresh-upgrade-binding')
      return { ok: true, data: { ...overview.connections[0], revision: 3 } }
    return {
      ok: false,
      error: { code: 'UNKNOWN', message: 'fixture error', technical: 'SECRET_FAKE_MUST_NOT_RENDER' }
    }
  })
  Object.defineProperty(window, 'api', { value: { invoke }, configurable: true })
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }),
    configurable: true
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
const opened = async (): Promise<ReturnType<typeof render>> => {
  const view = render(<ControllerUpgradeWizard open onClose={() => {}} onChanged={() => {}} />)
  await screen.findByRole('button', { name: 'Kiểm tra nâng cấp' })
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Kiểm tra nâng cấp' }) as HTMLButtonElement).disabled
    ).toBe(false)
  )
  return view
}
const click = async (name: string): Promise<void> => {
  const button = await screen.findByRole('button', { name })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
}
it('requires explicit consent for each write, manual transfer/upgrade and token-preserving binding confirmation', async () => {
  await opened()
  await click('Kiểm tra nâng cấp')
  await screen.findByRole('button', { name: 'Tạo giao dịch' })
  expect(
    (screen.getByRole('button', { name: 'Tạo giao dịch' }) as HTMLButtonElement).disabled
  ).toBe(true)
  expect(invoke.mock.calls.some(([c]) => c === 'controller:prepare-upgrade')).toBe(false)
  fireEvent.click(screen.getByRole('checkbox'))
  await click('Tạo giao dịch')
  await click('Chuyển gói')
  await screen.findByRole('button', { name: 'Nâng cấp' })
  expect(invoke.mock.calls.filter(([c]) => c === 'controller:send-upgrade')).toHaveLength(1)
  await click('Nâng cấp')
  await click('Kiểm tra cập nhật kết nối')
  await click('Xác nhận cập nhật kết nối')
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('controller:refresh-upgrade-binding', {
      plan_id: plan,
      consent: true
    })
  )
  expect(invoke).toHaveBeenCalledWith('controller:send-upgrade', {
    request_key: uk,
    operation: 'upgrade',
    consent: true
  })
  expect(JSON.stringify(invoke.mock.calls)).not.toMatch(
    /artifact_path|access_token|password|runtime_uid/
  )
})
it('loads unknown transactions without retrying writes and provides explicit same-key inspection/recovery', async () => {
  overview.upgrades = [record('outcome_unknown')]
  render(<ControllerUpgradeWizard open onClose={() => {}} onChanged={() => {}} />)
  await screen.findByText(/Chưa rõ kết quả\. Kiểm tra cùng giao dịch/)
  expect(invoke.mock.calls.every(([c]) => c === 'controller:upgrade-overview')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Nâng cấp' })).toBeNull()
  await click('Kiểm tra lại')
  expect(invoke).toHaveBeenCalledWith('controller:inspect-upgrade', uk)
  expect(
    (screen.getByRole('button', { name: 'Tiếp tục khôi phục' }) as HTMLButtonElement).disabled
  ).toBe(true)
})
it('ignores a late review after closing and reopening and never starts a mutation', async () => {
  let finish: (value: unknown) => void = () => {}
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation((channel: string, input: unknown) =>
    channel === 'controller:review-upgrade'
      ? new Promise((done) => {
          finish = done
        })
      : original(channel, input)
  )
  const view = await opened()
  await click('Kiểm tra nâng cấp')
  view.rerender(<ControllerUpgradeWizard open={false} onClose={() => {}} onChanged={() => {}} />)
  view.rerender(<ControllerUpgradeWizard open onClose={() => {}} onChanged={() => {}} />)
  finish({
    ok: true,
    data: { plan_id: plan, expires_at: expiry(), host: 'late-host', release_id: 'upgrade-fixture' }
  })
  await waitFor(() =>
    expect(
      invoke.mock.calls.filter(([c]) => c === 'controller:upgrade-overview').length
    ).toBeGreaterThan(1)
  )
  expect(screen.queryByText('late-host')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Tạo giao dịch' })).toBeNull()
  expect(invoke.mock.calls.some(([c]) => c === 'controller:prepare-upgrade')).toBe(false)
})
it('renders safe error text without leaking raw IPC details or starting another transaction', async () => {
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation((channel: string, input: unknown) =>
    channel === 'controller:review-upgrade'
      ? Promise.resolve({ ok: false, error: { technical: 'SECRET_FAKE_MUST_NOT_RENDER' } })
      : original(channel, input)
  )
  await opened()
  await click('Kiểm tra nâng cấp')
  await screen.findByText(/Không hoàn tất thao tác/)
  expect(document.body.textContent).not.toContain('SECRET_FAKE')
  expect(invoke.mock.calls.some(([c]) => c === 'controller:prepare-upgrade')).toBe(false)
})
it.each([
  ['en', 'Upgrade controller'],
  ['cn', '升级控制器'],
  ['jp', 'コントローラーを更新']
] as const)('renders %s locale and never dispatches mutation on open', async (locale, title) => {
  useUiState.setState({ locale })
  render(<ControllerUpgradeWizard open onClose={() => {}} onChanged={() => {}} />)
  await screen.findByText(title)
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('controller:upgrade-overview'))
  expect(invoke.mock.calls.every(([c]) => c === 'controller:upgrade-overview')).toBe(true)
})
