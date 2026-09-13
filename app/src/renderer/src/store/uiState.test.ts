// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { useUiState } from './uiState'

describe('uiState theme preference', () => {
  beforeEach(() => {
    localStorage.clear()
    useUiState.setState({ theme: 'dark' })
  })

  it('uses dark when no session has been stored', () => {
    expect(useUiState.getState().theme).toBe('dark')
  })

  it('persists an explicitly selected light theme', async () => {
    useUiState.getState().setTheme('light')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(JSON.parse(localStorage.getItem('opspilot-ui-session') ?? '{}').state.theme).toBe(
      'light'
    )
  })
})
