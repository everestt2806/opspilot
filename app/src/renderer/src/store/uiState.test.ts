// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('uiState theme preference', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('uses dark when storage is empty', async () => {
    const { useUiState } = await import('./uiState')
    expect(useUiState.getState().theme).toBe('dark')
  })

  it('rehydrates an explicitly persisted light theme', async () => {
    localStorage.setItem(
      'opspilot-ui-session',
      JSON.stringify({ state: { theme: 'light', activePage: 'settings' }, version: 0 })
    )
    const { useUiState } = await import('./uiState')
    await useUiState.persist.rehydrate()
    expect(useUiState.getState().theme).toBe('light')
  })
})
