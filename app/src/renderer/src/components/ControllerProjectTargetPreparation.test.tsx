// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type {
  DesktopProjectSetup,
  DesktopProjectTargetState
} from '@shared/desktopProjectRegistration'
import { ControllerProjectTargetPreparation } from './ControllerProjectTargetPreparation'
import { CONTROLLER_TARGET_COPY } from './controllerTargetCopy'
import { useUiState } from '../store/uiState'
const t = CONTROLLER_TARGET_COPY.en,
  invoke = vi.fn()
let binding: DesktopControllerConnection,
  project: DesktopProjectSetup,
  target: DesktopProjectTargetState
const view = (): React.JSX.Element => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <ControllerProjectTargetPreparation binding={binding} project={project} />
  </ConfigProvider>
)
const open = async (): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByText(t.rootHint)
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
    display_name: 'controller',
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
    app_name: 'target-api',
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
  target = {
    binding_id: binding.binding_id,
    binding_revision: 2,
    request_key: project.request_key,
    controller_id: binding.controller_id,
    app_id: 42,
    ownership_generation: 1,
    source_generation: 1,
    source_config_sha256: 'b'.repeat(64),
    target_vps_id: 77,
    target_security_revision: 3,
    target_host: 'target.test',
    target_port: 22,
    target_username: 'root',
    target_fingerprint: 'SHA256:' + 'B'.repeat(43),
    target_root: '/var/lib/opspilot-product',
    state: 'not_prepared',
    proof: 'not_available',
    deployment_started: false,
    runtime_preflight: 'required',
    checked_at: new Date().toISOString()
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async (channel: string, input: unknown) => {
    if (channel === 'controller:project-target-state') return { ok: true, data: { ...target } }
    if (channel === 'controller:enroll-project-target') {
      target = {
        ...target,
        state: 'enrolled',
        proof: 'persisted_verified',
        target_root: (input as { target_root: string }).target_root
      }
      return { ok: true, data: { ...target } }
    }
    throw new Error('Unexpected IPC')
  })
})
describe('Chuẩn bị target từ Desktop', () => {
  it('loads metadata only, reviews host/fingerprint/root, then prepares after explicit confirmation', async () => {
    render(view())
    await open()
    expect(invoke).toHaveBeenCalledWith('controller:project-target-state', project.request_key)
    expect(invoke).toHaveBeenCalledOnce()
    expect(screen.getByText(target.target_fingerprint)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(t.root), { target: { value: '/private/approved' } })
    fireEvent.click(screen.getByRole('button', { name: t.review }))
    await screen.findByText(t.reviewHint)
    expect(invoke).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    await screen.findByText(t.enrolledHint)
    expect(invoke).toHaveBeenCalledWith('controller:enroll-project-target', {
      request_key: project.request_key,
      target_root: '/private/approved'
    })
    expect(screen.queryByText('Deploy')).toBeNull()
  })
  it('does not load or mutate target for read-only bindings', () => {
    binding.scopes = ['read']
    render(view())
    expect(screen.getByRole('button', { name: t.open }).hasAttribute('disabled')).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })
  it('keeps unknown root locked and requires inspection of the same setup', async () => {
    target = { ...target, state: 'unknown', target_root: '/private/original' }
    render(view())
    await open()
    await screen.findByText(t.unknownHint)
    expect(screen.getByLabelText(t.root).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: t.review }))
    fireEvent.click(screen.getByRole('button', { name: t.inspect }))
    await screen.findByText(t.enrolledHint)
    expect(invoke).toHaveBeenCalledWith('controller:enroll-project-target', {
      request_key: project.request_key,
      target_root: '/private/original'
    })
  })
  it('never offers install when persisted proof or configuration conflicts', async () => {
    target = { ...target, state: 'conflict' }
    render(view())
    await open()
    await screen.findByText(t.conflictHint)
    expect(screen.queryByRole('button', { name: t.review })).toBeNull()
    expect(screen.queryByRole('button', { name: t.confirm })).toBeNull()
    expect(invoke).toHaveBeenCalledOnce()
  })
  it('rejects unsafe paths before confirmation and allows editing a review', async () => {
    render(view())
    await open()
    fireEvent.change(screen.getByLabelText(t.root), { target: { value: '/unsafe/../path' } })
    fireEvent.click(screen.getByRole('button', { name: t.review }))
    await screen.findByText(t.invalid)
    expect(invoke).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByLabelText(t.root), { target: { value: '/private/safe' } })
    fireEvent.click(screen.getByRole('button', { name: t.review }))
    await screen.findByText(t.reviewHint)
    fireEvent.click(screen.getByRole('button', { name: t.back }))
    expect(screen.getByLabelText(t.root).hasAttribute('disabled')).toBe(false)
  })
  it('requires status refresh after an uncertain transport error and never displays technical output', async () => {
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (...args) =>
      args[0] === 'controller:enroll-project-target'
        ? { ok: false, error: { technical: 'synthetic-private-stderr' } }
        : original(...args)
    )
    render(view())
    await open()
    fireEvent.click(screen.getByRole('button', { name: t.review }))
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    await screen.findByText(t.failed)
    expect(screen.queryByText(/synthetic-private/)).toBeNull()
    expect(screen.queryByRole('button', { name: t.review })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t.refresh }))
    await screen.findByText(t.rootHint)
  })
  it('locks duplicate confirmations and ignores a late enrolled reply after close', async () => {
    let finish!: (value: unknown) => void
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation((...args) =>
      args[0] === 'controller:enroll-project-target'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : original(...args)
    )
    render(view())
    await open()
    fireEvent.click(screen.getByRole('button', { name: t.review }))
    fireEvent.click(screen.getByRole('button', { name: t.confirm }))
    fireEvent.click(screen.getByText(t.confirm).closest('button')!)
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'controller:enroll-project-target')
    ).toHaveLength(1)
    fireEvent.click(screen.getByText(t.close).closest('button')!)
    await act(async () =>
      finish({ ok: true, data: { ...target, state: 'enrolled', proof: 'persisted_verified' } })
    )
    expect(screen.queryByText(t.enrolledHint)).toBeNull()
  })
  it('rejects replies for another app', async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: { ...target, app_id: 999 } })
    render(view())
    fireEvent.click(screen.getByRole('button', { name: t.open }))
    await screen.findByText(t.changed)
    expect(screen.queryByRole('button', { name: t.review })).toBeNull()
  })
  it.each(['vi', 'en', 'cn', 'jp'] as const)(
    'localizes %s and distinguishes enrolled from deployment',
    async (locale) => {
      useUiState.setState({ locale })
      const copy = CONTROLLER_TARGET_COPY[locale]
      target = { ...target, state: 'enrolled', proof: 'persisted_verified' }
      render(view())
      fireEvent.click(screen.getByRole('button', { name: copy.open }))
      await waitFor(() => expect(screen.getByText(copy.enrolledHint)).toBeTruthy())
      expect(screen.getByText(copy.source)).toBeTruthy()
    }
  )
})
