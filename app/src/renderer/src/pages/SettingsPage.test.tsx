// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { App as AntApp } from 'antd'

import { SettingsPage } from './SettingsPage'
import { useUiState } from '../store/uiState'
import { strings } from '../strings'

describe('SettingsPage', () => {
  beforeEach(() => useUiState.setState({ theme: 'dark' }))

  it('switches the real persisted theme control', () => {
    render(
      <AntApp>
        <SettingsPage />
      </AntApp>
    )

    fireEvent.click(screen.getByText(strings.settings.light))
    expect(useUiState.getState().theme).toBe('light')
    expect(screen.getByText(strings.settings.deferred)).toBeTruthy()
    expect(screen.queryByText(/active|enabled|Save/i)).toBeNull()
  })
})
