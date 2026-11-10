// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopExposureResult } from '@shared/desktopControllerExposure'
import { ControllerExposurePanel } from './ControllerExposurePanel'
import { CONTROLLER_EXPOSURE_COPY } from './controllerExposureCopy'
import { useUiState } from '../store/uiState'

const binding: DesktopControllerConnection = {
  binding_id: '11111111-1111-4111-8111-111111111111',
  controller_id: 'fixture',
  vps_id: 1,
  revision: 1,
  state: 'active',
  display_name: 'Fixture',
  remote_client_id: null,
  credential_expires_at: null,
  updated_at: '2026-11-10T12:00:00Z',
  scopes: ['read', 'policy:write']
}
let invoke: ReturnType<typeof vi.fn>, result: DesktopExposureResult
function observed(appId = 1): DesktopExposureResult {
  const time = new Date().toISOString(),
    observationId = '22222222-2222-4222-8222-222222222222'
  return {
    binding_id: binding.binding_id,
    binding_revision: 1,
    controller_id: 'fixture',
    app_id: appId,
    state: 'read',
    reason_code: null,
    checked_at: time,
    view: {
      app_id: appId,
      deployment_id: appId,
      status: 'reachable',
      freshness: 'current',
      unavailable_reason: null,
      context: {
        app_id: appId,
        deployment_id: appId,
        authority_sha256: 'a'.repeat(64),
        previous_observation_id: observationId,
        url: `http://167.71.202.116:${29999 + appId}`
      },
      observation: {
        format: 1,
        app_id: appId,
        deployment_id: appId,
        authority_sha256: 'a'.repeat(64),
        previous_observation_id: null,
        observer: 'desktop_external',
        started_at: time,
        checked_at: time,
        outcome: 'reachable',
        http_status: 200,
        reason: 'none',
        observation_id: observationId,
        client_id: '33333333-3333-4333-8333-333333333333',
        body_sha256: 'b'.repeat(64),
        url: `http://167.71.202.116:${29999 + appId}`,
        status: 'reachable',
        received_at: time
      }
    }
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
  useUiState.setState({ locale: 'vi' })
  result = observed()
  invoke = vi.fn(async () => ({ ok: true, data: result }))
  window.api = {
    invoke,
    hasHandler: () => true,
    on: () => () => {}
  } as unknown as typeof window.api
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
async function show(connection = binding): Promise<void> {
  await act(async () => {
    render(<ControllerExposurePanel binding={connection} appId={1} currentDeploymentId={1} fresh />)
  })
}
it('reads saved evidence on mount, checks explicitly with IDs only, and never sends URL or body', async () => {
  await show()
  expect(screen.getByText('Truy cập được')).toBeTruthy()
  expect(invoke).toHaveBeenCalledExactlyOnceWith('controller:exposure-read', {
    binding_id: binding.binding_id,
    app_id: 1
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra truy cập' }))
  })
  expect(invoke).toHaveBeenLastCalledWith('controller:exposure-check', {
    binding_id: binding.binding_id,
    app_id: 1
  })
})
it('keeps checks disabled until the initial read finishes', async () => {
  let finish!: (value: unknown) => void
  invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await show()
  expect(screen.getByRole('button', { name: 'Kiểm tra truy cập' })).toHaveProperty('disabled', true)
  await act(async () => {
    finish({ ok: true, data: result })
  })
  expect(screen.getByRole('button', { name: 'Kiểm tra truy cập' })).toHaveProperty(
    'disabled',
    false
  )
})
it('expires the green status without a new request', async () => {
  await show()
  await act(async () => {
    vi.advanceTimersByTime(61_000)
  })
  expect(screen.queryByText('Truy cập được')).toBeNull()
  expect(screen.getByText(CONTROLLER_EXPOSURE_COPY.vi.stale)).toBeTruthy()
  expect(invoke).toHaveBeenCalledOnce()
})
it('shows an old controller as unsupported and never substitutes a deploy action', async () => {
  result = { ...result, state: 'unavailable', reason_code: 'UNSUPPORTED', view: null }
  await show()
  expect(screen.getByText(CONTROLLER_EXPOSURE_COPY.vi.unsupported)).toBeTruthy()
  expect(screen.queryByText('Truy cập được')).toBeNull()
})
it('keeps an unknown write unconfirmed and permits only explicit follow-up actions', async () => {
  await show()
  result = {
    ...result,
    state: 'outcome_unknown',
    view: null,
    reason_code: 'OBSERVATION_OUTCOME_UNKNOWN'
  }
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra truy cập' }))
  })
  expect(screen.getByText(CONTROLLER_EXPOSURE_COPY.vi.unknown)).toBeTruthy()
  expect(screen.queryByText('Truy cập được')).toBeNull()
  expect(invoke).toHaveBeenCalledTimes(2)
})
it('allows a read-only connection to read but disables checks with a clear reason', async () => {
  await show({ ...binding, scopes: ['read'] })
  expect(screen.getByRole('button', { name: 'Kiểm tra truy cập' })).toHaveProperty('disabled', true)
  expect(screen.getByText(CONTROLLER_EXPOSURE_COPY.vi.denied)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Tải kết quả đã lưu' })).toHaveProperty(
    'disabled',
    false
  )
})
it('discards a late result after changing apps', async () => {
  let late!: (value: unknown) => void
  invoke.mockImplementation((_channel, input) =>
    input.app_id === 1
      ? new Promise((resolve) => {
          late = resolve
        })
      : Promise.resolve({ ok: true, data: observed(2) })
  )
  let ui!: ReturnType<typeof render>
  await act(async () => {
    ui = render(
      <ControllerExposurePanel binding={binding} appId={1} currentDeploymentId={1} fresh />
    )
  })
  await act(async () => {
    ui.rerender(
      <ControllerExposurePanel binding={binding} appId={2} currentDeploymentId={2} fresh />
    )
  })
  expect(screen.getByText('http://167.71.202.116:30001')).toBeTruthy()
  await act(async () => {
    late({ ok: true, data: observed(1) })
  })
  expect(screen.queryByText('http://167.71.202.116:30000')).toBeNull()
})
it.each(['vi', 'en', 'jp', 'cn'] as const)('renders the exposure actions in %s', async (locale) => {
  useUiState.setState({ locale })
  await show()
  expect(screen.getByRole('button', { name: CONTROLLER_EXPOSURE_COPY[locale].check })).toBeTruthy()
  expect(screen.getByText(CONTROLLER_EXPOSURE_COPY[locale].scope)).toBeTruthy()
})
