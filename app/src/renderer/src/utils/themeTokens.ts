import { theme } from 'antd'

import type { ThemeConfig } from 'antd'

/** Hai bộ token chuyển 1–1 từ DESIGN.md (MiniDash) mục Colors + Dark Theme.
 *  Font bó local vào assets/fonts/ — nếu máy chưa có thì rơi về stack hệ thống
 *  khai trong base.css. */
export type ThemeMode = 'light' | 'dark'

const FONT_UI = "'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const FONT_MONO = "'IBM Plex Mono', 'JetBrains Mono', Consolas, monospace"

const shared: ThemeConfig['token'] = {
  colorPrimary: '#6366F1',
  borderRadius: 8,
  controlHeight: 36,
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
      colorInfo: '#818CF8',
      colorSuccess: '#34D399',
      colorWarning: '#FBBF24',
      colorError: '#F87171',
      colorBgBase: '#0F172A',
      colorBgContainer: '#1E293B',
      colorBgElevated: '#273449',
      colorBorder: '#334155',
      colorBorderSecondary: '#334155',
      colorText: '#F1F5F9',
      colorTextSecondary: '#94A3B8',
      colorTextTertiary: '#64748B',
      colorTextPlaceholder: '#64748B',
      colorLink: '#A5B4FC'
    }
  }
}
