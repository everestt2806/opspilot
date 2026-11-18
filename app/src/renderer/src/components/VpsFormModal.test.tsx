// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VpsFormModal } from './VpsFormModal'
import { strings } from '../strings'
import { useUiState } from '../store/uiState'

afterEach(() => {
  vi.unstubAllGlobals()
  useUiState.setState({ locale: 'en' })
})

function renderForm(): { submit: ReturnType<typeof vi.fn> } {
  const submit = vi.fn()
  render(
    <VpsFormModal open initialVps={null} saving={false} onCancel={() => {}} onSubmit={submit} />
  )
  return { submit }
}
function fill(): void {
  fireEvent.change(screen.getByLabelText(strings.vps.fields.host), {
    target: { value: 'test.invalid' }
  })
  fireEvent.change(
    screen.getByLabelText(strings.vps.fields.password, { selector: 'input[type="password"]' }),
    {
      target: { value: 'synthetic-ui-credential' }
    }
  )
}

describe('simple VPS form', () => {
  it('saves IP/password with default root/22 and uses the host as name without a fingerprint', async () => {
    const { submit } = renderForm()
    fill()
    expect((screen.getByLabelText(strings.vps.fields.username) as HTMLInputElement).value).toBe(
      'root'
    )
    expect(screen.getByText(strings.vps.form.advanced).closest('details')?.open).toBe(false)
    fireEvent.click(screen.getByText(strings.common.save))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test.invalid',
          host: 'test.invalid',
          port: 22,
          username: 'root',
          auth_type: 'password'
        })
      )
    )
    expect(submit.mock.calls[0][0].host_fingerprint).toBe('')
  })
  it('keeps the check pin for Save without requiring it from the user', async () => {
    const pin = 'SHA256:' + 'A'.repeat(43)
    const invoke = vi.fn(async () => ({
      ok: true,
      data: {
        ssh_ok: true,
        host_fingerprint: pin,
        docker_installed: true,
        docker_version: 'test',
        workdir_writable: true,
        steps: []
      }
    }))
    vi.stubGlobal('api', { invoke })
    const { submit } = renderForm()
    fill()
    fireEvent.click(screen.getByText(strings.vps.check.button))
    await screen.findByText(strings.vps.check.success)
    fireEvent.click(screen.getByText(strings.common.save))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ host_fingerprint: pin }))
    )
  })
  it('does not apply an old endpoint pin after the host changes during a check', async () => {
    let finish!: (value: unknown) => void
    const invoke = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal('api', { invoke })
    const { submit } = renderForm()
    fill()
    fireEvent.click(screen.getByText(strings.vps.check.button))
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText(strings.vps.fields.host), {
      target: { value: 'other.invalid' }
    })
    await act(async () =>
      finish({
        ok: true,
        data: {
          ssh_ok: true,
          host_fingerprint: 'SHA256:' + 'A'.repeat(43),
          docker_installed: false,
          docker_version: null,
          workdir_writable: false,
          steps: []
        }
      })
    )
    fireEvent.click(screen.getByText(strings.common.save))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'other.invalid', host_fingerprint: '' })
      )
    )
  })
  it.each(['vi', 'en', 'cn', 'jp'] as const)(
    'shows translated advanced settings and optional first-contact explanation: %s',
    (locale) => {
      useUiState.setState({ locale })
      renderForm()
      expect(screen.getByText(strings.vps.form.advanced)).toBeTruthy()
      expect(screen.getByText(strings.vps.form.hostFingerprintHint)).toBeTruthy()
    }
  )
})
