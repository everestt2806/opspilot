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

  it('switches the real persisted locale control and updates page content in 4 languages', () => {
    useUiState.setState({ locale: 'vi' })
    render(
      <AntApp>
        <SettingsPage />
      </AntApp>
    )

    // 1. Tiếng Việt
    expect(screen.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeTruthy()
    expect(screen.getByText('Giao diện và trạng thái các tính năng đang phát triển.')).toBeTruthy()

    // 2. English
    fireEvent.click(screen.getByText('English'))
    expect(useUiState.getState().locale).toBe('en')
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('Appearance and preview of upcoming features.')).toBeTruthy()

    // 3. 日本語
    fireEvent.click(screen.getByText('日本語'))
    expect(useUiState.getState().locale).toBe('jp')
    expect(screen.getByRole('heading', { level: 1, name: 'システム設定' })).toBeTruthy()
    expect(screen.getByText('外観および開発中の機能ステータス。')).toBeTruthy()

    // 4. 简体中文
    fireEvent.click(screen.getByText('简体中文'))
    expect(useUiState.getState().locale).toBe('cn')
    expect(screen.getByRole('heading', { level: 1, name: '系统设置' })).toBeTruthy()
    expect(screen.getByText('界面外观及正在开发的功能状态。')).toBeTruthy()
  })
})
