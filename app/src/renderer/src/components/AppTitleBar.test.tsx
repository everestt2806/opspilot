// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IpcEventMap } from '@shared/ipc'

import { AppTitleBar } from './AppTitleBar'

describe('AppTitleBar', () => {
  const invoke = vi.fn()
  let maximizeListener: ((payload: IpcEventMap['window:maximized-changed']) => void) | undefined

  beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'window:is-maximized') return { ok: true, data: { maximized: false } }
      if (channel === 'window:toggle-maximize') return { ok: true, data: { maximized: true } }
      return { ok: true, data: undefined }
    })
    maximizeListener = undefined
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn((channel: string, callback: typeof maximizeListener) => {
          if (channel === 'window:maximized-changed') maximizeListener = callback
          return vi.fn()
        })
      }
    })
  })

  it('hien page title va dieu khien cua so qua IPC', async () => {
    render(<AppTitleBar pageTitle="Servers" />)

    expect(screen.getByText('OpsPilot — Servers')).toBeTruthy()
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('window:is-maximized'))

    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximize window' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }))

    expect(invoke).toHaveBeenCalledWith('window:minimize')
    expect(invoke).toHaveBeenCalledWith('window:toggle-maximize')
    expect(invoke).toHaveBeenCalledWith('window:close')
    expect(await screen.findByRole('button', { name: 'Restore window' })).toBeTruthy()
  })

  it('dong bo icon khi main process gui su kien maximize', async () => {
    render(<AppTitleBar pageTitle="Deploy" />)
    await waitFor(() => expect(maximizeListener).toBeTypeOf('function'))

    act(() => maximizeListener?.({ maximized: true }))

    expect(await screen.findByRole('button', { name: 'Restore window' })).toBeTruthy()
  })
})
