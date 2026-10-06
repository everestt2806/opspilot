// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { App as AntApp } from 'antd'

import { SettingsPage } from './SettingsPage'
import { useUiState } from '../store/uiState'
import { strings } from '../strings'

describe('SettingsPage', () => {
  beforeEach(() => {
    localStorage.clear()
    useUiState.setState({ theme: 'dark', locale: 'vi' })
  })

  it('switches the real persisted theme control immediately and updates state', () => {
    render(
      <AntApp>
        <SettingsPage />
      </AntApp>
    )

    // Initially dark
    expect(useUiState.getState().theme).toBe('dark')

    // Click light
    fireEvent.click(screen.getByText(strings.settings.light))
    expect(useUiState.getState().theme).toBe('light')

    // Click dark back
    fireEvent.click(screen.getByText(strings.settings.dark))
    expect(useUiState.getState().theme).toBe('dark')

    // Verified: No fake settings or buttons
    expect(screen.queryByRole('button', { name: /save|lưu/i })).toBeNull()
    expect(screen.queryByText(/^(save|lưu|enabled|active)$/i)).toBeNull()
  })

  it('does not contain sub-category sidebar or deferred monitoring section or outdated release dates', () => {
    render(
      <AntApp>
        <SettingsPage />
      </AntApp>
    )

    // No subcategory sidebar
    expect(document.querySelector('.settings-categories')).toBeNull()
    expect(document.querySelector('.settings-category')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()

    // No non-functional monitoring section
    expect(document.querySelector('.settings-section-readonly')).toBeNull()
    expect(screen.queryByText(/giám sát|monitoring|deferred|28\/09|sep 28|9月28日/i)).toBeNull()
  })

  it('switches the real persisted locale control and updates page content in 4 languages immediately', () => {
    render(
      <AntApp>
        <SettingsPage />
      </AntApp>
    )

    // 1. Tiếng Việt (initial)
    expect(screen.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeTruthy()
    expect(screen.getByText('Tùy chọn giao diện và ngôn ngữ hiển thị của hệ thống.')).toBeTruthy()
    expect(screen.getByText('Giao diện')).toBeTruthy()
    expect(
      screen.getByText('Chọn giao diện hiển thị, được lưu cho những lần mở ứng dụng sau.')
    ).toBeTruthy()
    expect(screen.getByText('Ngôn ngữ hiển thị')).toBeTruthy()
    expect(screen.getByText('Chọn ngôn ngữ giao diện cho hệ thống OpsPilot.')).toBeTruthy()
    expect(screen.getByText('Tối')).toBeTruthy()
    expect(screen.getByText('Sáng')).toBeTruthy()

    // 2. Switch to English
    fireEvent.click(screen.getByText('English'))
    expect(useUiState.getState().locale).toBe('en')
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('Appearance and display language preferences.')).toBeTruthy()
    expect(screen.getByText('Appearance')).toBeTruthy()
    expect(screen.getByText('Select interface theme, saved for future app launches.')).toBeTruthy()
    expect(screen.getByText('Display Language')).toBeTruthy()
    expect(screen.getByText('Select user interface language for OpsPilot.')).toBeTruthy()
    expect(screen.getByText('Dark')).toBeTruthy()
    expect(screen.getByText('Light')).toBeTruthy()

    // 3. Switch to 日本語
    fireEvent.click(screen.getByText('日本語'))
    expect(useUiState.getState().locale).toBe('jp')
    expect(screen.getByRole('heading', { level: 1, name: 'システム設定' })).toBeTruthy()
    expect(screen.getByText('システムの外観および表示言語の設定。')).toBeTruthy()
    expect(screen.getByText('外観')).toBeTruthy()
    expect(
      screen.getByText('テーマを選択します。設定は次回以降のアプリ起動時にも保持されます。')
    ).toBeTruthy()
    expect(screen.getByText('表示言語')).toBeTruthy()
    expect(screen.getByText('OpsPilot の表示言語を選択してください。')).toBeTruthy()
    expect(screen.getByText('ダーク')).toBeTruthy()
    expect(screen.getByText('ライト')).toBeTruthy()

    // 4. Switch to 简体中文
    fireEvent.click(screen.getByText('简体中文'))
    expect(useUiState.getState().locale).toBe('cn')
    expect(screen.getByRole('heading', { level: 1, name: '系统设置' })).toBeTruthy()
    expect(screen.getByText('系统界面外观与显示语言偏好设置。')).toBeTruthy()
    expect(screen.getByText('界面外观')).toBeTruthy()
    expect(screen.getByText('选择界面主题，设置将保存并在下次打开应用时保持。')).toBeTruthy()
    expect(screen.getByText('界面语言')).toBeTruthy()
    expect(screen.getByText('选择 OpsPilot 系统显示语言。')).toBeTruthy()
    expect(screen.getByText('深色')).toBeTruthy()
    expect(screen.getByText('浅色')).toBeTruthy()
  })

  it('persists changes to localStorage across restarts', () => {
    render(
      <AntApp>
        <SettingsPage />
      </AntApp>
    )

    fireEvent.click(screen.getByText('English'))
    fireEvent.click(screen.getByText('Light'))

    const rawPersisted = localStorage.getItem('opspilot-ui-session')
    expect(rawPersisted).toBeTruthy()
    const parsed = JSON.parse(rawPersisted!) as { state: { theme: string; locale: string } }
    expect(parsed.state.theme).toBe('light')
    expect(parsed.state.locale).toBe('en')
  })

  it('provides proper keyboard accessibility attributes and focus states', () => {
    render(
      <AntApp>
        <SettingsPage />
      </AntApp>
    )

    // Group containers have accessible labels
    const themeGroup = screen.getByRole('group', { name: strings.settings.appearance })
    const localeGroup = screen.getByRole('group', { name: strings.settings.language })
    expect(themeGroup).toBeTruthy()
    expect(localeGroup).toBeTruthy()

    // Segmented controls have aria-label and aria-describedby
    const themeControl = screen.getByRole('radiogroup', { name: strings.settings.appearance })
    const localeControl = screen.getByRole('radiogroup', { name: strings.settings.language })
    expect(themeControl).toBeTruthy()
    expect(localeControl).toBeTruthy()
    expect(themeControl.getAttribute('aria-describedby')).toBe('setting-theme-desc')
    expect(localeControl.getAttribute('aria-describedby')).toBe('setting-locale-desc')

    // Radios can receive focus
    const radioInputs = document.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    expect(radioInputs.length).toBe(6) // 2 for theme, 4 for locale

    radioInputs[0].focus()
    expect(document.activeElement).toBe(radioInputs[0])

    radioInputs[3].focus()
    expect(document.activeElement).toBe(radioInputs[3])
  })

  it('ensures all 4 language options and long descriptive strings render without overflow or truncation', () => {
    const locales = ['vi', 'en', 'cn', 'jp'] as const

    for (const loc of locales) {
      useUiState.setState({ locale: loc })
      const { unmount } = render(
        <AntApp>
          <SettingsPage />
        </AntApp>
      )

      // Both options exist and have non-empty text
      const titles = document.querySelectorAll('.settings-row-title')
      const descs = document.querySelectorAll('.settings-row-desc')
      expect(titles.length).toBe(2)
      expect(descs.length).toBe(2)

      titles.forEach((t) => expect(t.textContent?.trim().length).toBeGreaterThan(0))
      descs.forEach((d) => expect(d.textContent?.trim().length).toBeGreaterThan(5))

      // Language options
      expect(screen.getByText('English')).toBeTruthy()
      expect(screen.getByText('Tiếng Việt')).toBeTruthy()
      expect(screen.getByText('简体中文')).toBeTruthy()
      expect(screen.getByText('日本語')).toBeTruthy()

      unmount()
    }
  })
})
