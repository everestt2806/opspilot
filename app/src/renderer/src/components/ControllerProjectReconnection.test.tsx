// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { ControllerProjectReconnection } from './ControllerProjectReconnection'
import { PROJECT_RECONNECTION_COPY } from './projectReconnectionCopy'
import { reconnectionTestData } from './projectReconnectionTestData'
import { useUiState } from '../store/uiState'
const t = PROJECT_RECONNECTION_COPY.en,
  invoke = vi.fn()
let f: ReturnType<typeof reconnectionTestData>
const view = (): React.JSX.Element => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <ControllerProjectReconnection binding={f.binding} app={f.app} />
  </ConfigProvider>
)
beforeEach(() => {
  f = reconnectionTestData()
  useUiState.setState({ locale: 'en' })
  invoke.mockReset()
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async (channel) => ({
    ok: true,
    data:
      channel === 'controller:latest-project-reconnection'
        ? null
        : channel === 'controller:review-project-reconnection'
          ? structuredClone(f.review)
          : structuredClone(f.confirmed)
  }))
})
afterEach(() => vi.restoreAllMocks())
async function open(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByRole('checkbox', { name: t.consent })
}
it('previews only then requires explicit consent; sends only plan ID and consent', async () => {
  render(view())
  await open()
  expect(screen.getByText(f.review.context.source.repository_url)).toBeTruthy()
  expect((screen.getByRole('button', { name: t.confirm }) as HTMLButtonElement).disabled).toBe(true)
  expect(invoke.mock.calls.some(([c]) => c === 'controller:confirm-project-reconnection')).toBe(
    false
  )
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.confirm }))
  await screen.findByText(t.confirmed)
  expect(invoke).toHaveBeenCalledWith('controller:confirm-project-reconnection', {
    plan_id: f.review.plan_id,
    consent: true
  })
  expect(
    invoke.mock.calls.every(
      ([c]) => !['controller:send-command', 'controller:send-postgres-intent'].includes(c)
    )
  ).toBe(true)
})
it('restores a saved confirmation only after current verification without reconfirming', async () => {
  invoke.mockImplementation(async () => ({ ok: true, data: structuredClone(f.confirmed) }))
  render(view())
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByText(t.confirmed)
  expect(invoke).toHaveBeenCalledWith(
    'controller:current-project-reconnection',
    f.confirmed.request_key
  )
  expect(invoke.mock.calls.some(([c]) => c === 'controller:confirm-project-reconnection')).toBe(
    false
  )
})
it('shows previous/current metadata after drift and requires another explicit confirmation', async () => {
  const previous = structuredClone(f.confirmed)
  previous.context.source.generation = 1
  previous.snapshot_sha256 = 'c'.repeat(64)
  previous.context.snapshot_sha256 = previous.snapshot_sha256
  invoke.mockImplementation(async (c) =>
    c === 'controller:latest-project-reconnection'
      ? { ok: true, data: previous }
      : c === 'controller:current-project-reconnection'
        ? { ok: false, error: { technical: 'RECONNECTION_CHANGED' } }
        : { ok: true, data: f.review }
  )
  render(view())
  await open()
  expect(screen.getByRole('region', { name: t.previous })).toBeTruthy()
  expect(screen.queryByText(t.confirmed)).toBeNull()
})
it('recovers a lost confirmation reply by reading saved state without sending again', async () => {
  let saved = false
  invoke.mockImplementation(async (c) => {
    if (c === 'controller:latest-project-reconnection')
      return { ok: true, data: saved ? f.confirmed : null }
    if (c === 'controller:confirm-project-reconnection') {
      saved = true
      throw Error('SIMULATED_REPLY_LOST')
    }
    return {
      ok: true,
      data: c === 'controller:review-project-reconnection' ? f.review : f.confirmed
    }
  })
  render(view())
  await open()
  fireEvent.click(screen.getByRole('checkbox', { name: t.consent }))
  fireEvent.click(screen.getByRole('button', { name: t.confirm }))
  await screen.findByText(t.error)
  fireEvent.click(screen.getByRole('button', { name: t.check }))
  await screen.findByText(t.confirmed)
  expect(
    invoke.mock.calls.filter(([c]) => c === 'controller:confirm-project-reconnection')
  ).toHaveLength(1)
})
it('restores an older matching confirmation after A to B to A using a fresh current check', async () => {
  const b = structuredClone(f.confirmed)
  b.request_key = '66666666-6666-4666-8666-666666666666'
  b.snapshot_sha256 = 'c'.repeat(64)
  b.context.snapshot_sha256 = b.snapshot_sha256
  f.review.matching_confirmation_key = f.confirmed.request_key
  invoke.mockImplementation(async (c, input) => {
    if (c === 'controller:latest-project-reconnection') return { ok: true, data: b }
    if (c === 'controller:current-project-reconnection')
      return input === b.request_key
        ? { ok: false, error: { technical: 'RECONNECTION_CHANGED' } }
        : { ok: true, data: f.confirmed }
    return { ok: true, data: f.review }
  })
  render(view())
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByText(t.confirmed)
  expect(invoke).toHaveBeenCalledWith(
    'controller:current-project-reconnection',
    f.confirmed.request_key
  )
  expect(invoke.mock.calls.some(([c]) => c === 'controller:confirm-project-reconnection')).toBe(
    false
  )
})
it('expires the preview and refuses to submit it', async () => {
  f.review.expires_at = new Date(Date.now() + 100).toISOString()
  render(view())
  await open()
  await screen.findByText(t.expired)
  expect((screen.getByRole('button', { name: t.confirm }) as HTMLButtonElement).disabled).toBe(true)
  expect(invoke.mock.calls.some(([c]) => c === 'controller:confirm-project-reconnection')).toBe(
    false
  )
})
it('discards a late preview after close and a late confirmation after binding change', async () => {
  let finish!: (value: unknown) => void
  invoke.mockImplementation((c) =>
    c === 'controller:latest-project-reconnection'
      ? Promise.resolve({ ok: true, data: null })
      : new Promise((r) => {
          finish = r
        })
  )
  const r = render(view())
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await waitFor(() => expect(finish).toBeTruthy())
  fireEvent.click(screen.getAllByRole('button', { name: t.close }).at(-1)!)
  await act(async () => finish({ ok: true, data: f.review }))
  expect(screen.queryByRole('checkbox')).toBeNull()
  invoke.mockImplementation(async (c) => ({
    ok: true,
    data: c === 'controller:latest-project-reconnection' ? null : f.review
  }))
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByRole('checkbox')
  invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: t.confirm }))
  f.binding = { ...f.binding, revision: 3 }
  r.rerender(view())
  await act(async () => finish({ ok: true, data: f.confirmed }))
  expect(screen.queryByText(t.confirmed)).toBeNull()
})
it('blocks readonly binding and rejects a confirmation for a different app', async () => {
  f.binding.scopes = ['read']
  const r = render(view())
  expect((screen.getByRole('button', { name: t.open }) as HTMLButtonElement).disabled).toBe(true)
  expect(invoke).not.toHaveBeenCalled()
  f.binding.scopes = ['read', 'deploy:manual', 'policy:write']
  r.rerender(view())
  await open()
  invoke.mockResolvedValue({ ok: true, data: { ...f.confirmed, app_id: 99 } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: t.confirm }))
  await screen.findByText(t.error)
  expect(screen.queryByText(t.confirmed)).toBeNull()
})
it.each(['vi', 'en', 'jp', 'cn'] as const)(
  'provides translated review/consent in %s',
  async (locale) => {
    useUiState.setState({ locale })
    render(view())
    const copy = PROJECT_RECONNECTION_COPY[locale]
    fireEvent.click(screen.getByRole('button', { name: copy.open }))
    await screen.findByRole('checkbox', { name: copy.consent })
    expect(screen.getByText(copy.boundary)).toBeTruthy()
  }
)
