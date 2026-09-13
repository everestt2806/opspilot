import { theme } from 'antd'

import type { ThemeConfig } from 'antd'

/** Hai bộ token chuyển 1–1 từ DESIGN.md (MiniDash) mục Colors + Dark Theme.
 *  Font bó local vào assets/fonts/ — nếu máy chưa có thì rơi về stack hệ thống
 *  khai trong base.css. */
export type ThemeMode = 'light' | 'dark'

const FONT_UI = "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
const FONT_MONO = "'Cascadia Mono', Consolas, monospace"

const shared: ThemeConfig['token'] = {
  colorPrimary: '#60CDFF',
  borderRadius: 5,
  controlHeight: 33,
  fontFamily: FONT_UI,
  fontFamilyCode: FONT_MONO,
  fontSize: 13
}

export const themeTokens: Record<ThemeMode, ThemeConfig> = {
  light: {
    algorithm: theme.defaultAlgorithm,
    token: {
      ...shared,
      colorInfo: '#6366F1',
      colorSuccess: '#10B981',
      colorWarning: '#F59E0B',
      colorError: '#EF4444',
      colorBgBase: '#F3F4F6',
      colorBgContainer: '#FFFFFF',
      colorBgElevated: '#FFFFFF',
      colorBorder: '#E5E7EB',
      colorBorderSecondary: '#D1D5DB',
      colorText: '#111827',
      colorTextSecondary: '#4B5563',
      colorTextTertiary: '#6B7280',
      colorTextPlaceholder: '#6B7280',
      colorLink: '#6366F1'
    }
  },
  dark: {
    algorithm: theme.darkAlgorithm,
    token: {
      ...shared,
      colorInfo: '#60CDFF',
      colorSuccess: '#4CC2A3',
      colorWarning: '#F4C152',
      colorError: '#F28B82',
      colorBgBase: '#202020',
      colorBgContainer: 'rgba(255,255,255,0.045)',
      colorBgElevated: 'rgba(255,255,255,0.065)',
      colorBorder: 'rgba(255,255,255,0.06)',
      colorBorderSecondary: 'rgba(255,255,255,0.12)',
      colorText: 'rgba(255,255,255,0.9)',
      colorTextSecondary: 'rgba(255,255,255,0.62)',
      colorTextTertiary: 'rgba(255,255,255,0.45)',
      colorTextPlaceholder: 'rgba(255,255,255,0.36)',
      colorLink: '#60CDFF'
    }
  }
}
