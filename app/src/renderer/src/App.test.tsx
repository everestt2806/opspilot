// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { useUiState } from './store/uiState'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn()
    loadAddon = vi.fn()
    open = vi.fn()
    dispose = vi.fn()
    scrollToBottom = vi.fn()
    getSelection = (): string => ''
  }
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  }
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext = vi.fn()
  }
}))

beforeEach(() => {
  useUiState.setState({ locale: 'en', activePage: 'vps' })
  vi.stubGlobal('api', {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'vps:list') return { ok: true, data: [] }
      if (channel === 'app:list') return { ok: true, data: [] }
      return { ok: true, data: undefined }
    }),
    on: vi.fn(() => () => {})
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App — language switching', () => {
  it('chuyen doi ngon ngu sang VI, CN, JP va cap nhat menu sidebar', () => {
    render(<App />)

    // Default locale 'en'
    expect(screen.getByRole('button', { name: 'VPS Fleet' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Applications' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeTruthy()

    // Switch to Vietnamese
    fireEvent.click(screen.getByText('VI'))
    expect(useUiState.getState().locale).toBe('vi')
    expect(screen.getByRole('button', { name: 'VPS' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ứng dụng' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Triển khai' })).toBeTruthy()

    // Switch to Chinese
    fireEvent.click(screen.getByText('CN'))
    expect(useUiState.getState().locale).toBe('cn')
    expect(screen.getByRole('button', { name: 'VPS 集群' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '应用程序' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '部署服务' })).toBeTruthy()

    // Switch to Japanese
    fireEvent.click(screen.getByText('JP'))
    expect(useUiState.getState().locale).toBe('jp')
    expect(screen.getByRole('button', { name: 'VPS サーバー' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'アプリ一覧' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'デプロイ' })).toBeTruthy()
  })
})
