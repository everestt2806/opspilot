// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { VpsPreparationPanel } from './VpsPreparationPanel'
import { VPS_PREPARATION_COPY } from './vpsPreparationCopy'
import { useUiState } from '../store/uiState'

afterEach(() => {
  vi.unstubAllGlobals()
  useUiState.setState({ locale: 'en' })
})
const data = {
  vps_id: 1,
  docker_version: '29.10.0',
  compose_version: '5.8.0',
  installed_docker: true,
  workdir_ready: true,
  checked_at: '2026-11-18T12:00:00Z'
}
it('prepares only after a user click, disables duplicates and reports the result', async () => {
  useUiState.setState({ locale: 'en' })
  let finish!: (v: unknown) => void
  const invoke = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  vi.stubGlobal('api', { invoke })
  const prepared = vi.fn()
  render(<VpsPreparationPanel vpsId={1} onPrepared={prepared} />)
  expect(invoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText(VPS_PREPARATION_COPY.en.action))
  expect(invoke).toHaveBeenCalledExactlyOnceWith('vps:prepare-runtime', {
    vps_id: 1,
    consent: true
  })
  fireEvent.click(screen.getByText(VPS_PREPARATION_COPY.en.busy))
  expect(invoke).toHaveBeenCalledTimes(1)
  await act(async () => finish({ ok: true, data }))
  expect(screen.getByText(VPS_PREPARATION_COPY.en.ready)).toBeTruthy()
  expect(prepared).toHaveBeenCalledOnce()
})
it('shows a retry after failure and ignores a late result from another VPS', async () => {
  useUiState.setState({ locale: 'en' })
  let finish!: (v: unknown) => void
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: { message: 'Host unavailable' } })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
  vi.stubGlobal('api', { invoke })
  const prepared = vi.fn()
  const view = render(<VpsPreparationPanel vpsId={1} onPrepared={prepared} />)
  fireEvent.click(screen.getByText(VPS_PREPARATION_COPY.en.action))
  await screen.findByText('Host unavailable')
  fireEvent.click(screen.getByText(VPS_PREPARATION_COPY.en.retry))
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
  view.rerender(<VpsPreparationPanel vpsId={2} onPrepared={prepared} />)
  await act(async () => finish({ ok: true, data }))
  expect(screen.queryByText(VPS_PREPARATION_COPY.en.ready)).toBeNull()
  expect(prepared).not.toHaveBeenCalled()
})
