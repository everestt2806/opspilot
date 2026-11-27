import { theme } from 'antd'

import type { ThemeConfig } from 'antd'

/** Nguồn duy nhất của bảng màu app: antd ThemeConfig và biến CSS (--*) đều sinh từ đây.
 *  Không khai báo màu trực tiếp trong CSS hay inline style — thêm vào Palette rồi dùng qua var. */

export type ThemeMode = 'light' | 'dark'

export const FONT_UI =
  "'Segoe UI Variable', 'Segoe UI', 'Inter', system-ui, -apple-system, sans-serif"
export const FONT_MONO = "'JetBrains Mono', 'Cascadia Mono', 'SFMono-Regular', Consolas, monospace"

interface Palette {
  /** Thanh tiêu đề native-overlay */
  window: string
  /** Thanh điều hướng trái */
  sidebar: string
  /** Nền vùng nội dung */
  content: string
  /** Nền thẻ / bảng / panel */
  panel: string
  /** Hover, menu nổi, nền input */
  elevated: string
  border: string
  borderSubtle: string
  borderInput: string
  borderInputHover: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  textDisabled: string
  accent: string
  accentHover: string
  accentPressed: string
  primary: string
  primaryHover: string
  primaryPressed: string
  primaryGlow: string
  fillHover: string
  fillSecondary: string
  fillSelected: string
  success: string
  warning: string
  danger: string
  info: string
  shadowSm: string
  shadowMd: string
  scrollThumb: string
  scrollThumbHover: string
  scrollThumbActive: string
}

/** Bảng màu Light trung tính theo tinh thần Fluent / GitHub Desktop: phẳng, sắc nét, không màu mè. */
const LIGHT: Palette = {
  window: '#F3F4F6',
  sidebar: '#F8F9FA',
  content: '#F3F4F6',
  panel: '#FFFFFF',
  elevated: '#F4F5F7',
  border: '#E4E4E7',
  borderSubtle: 'rgba(24, 24, 27, 0.06)',
  borderInput: '#D4D4D8',
  borderInputHover: '#A1A1AA',
  textPrimary: '#18181B',
  textSecondary: '#52525B',
  textMuted: '#71717A',
  textDisabled: '#A1A1AA',
  accent: '#0284C7',
  accentHover: '#0369A1',
  accentPressed: '#075985',
  primary: '#0969DA',
  primaryHover: '#0550AE',
  primaryPressed: '#033D8B',
  primaryGlow: 'rgba(9, 105, 218, 0.14)',
  fillHover: 'rgba(24, 24, 27, 0.04)',
  fillSecondary: '#E4E4E7',
  fillSelected: 'rgba(9, 105, 218, 0.09)',
  success: '#1A7F37',
  warning: '#9A6700',
  danger: '#CF222E',
  info: '#0969DA',
  shadowSm: '0 1px 2px rgba(24, 24, 27, 0.04)',
  shadowMd: '0 6px 20px rgba(24, 24, 27, 0.08)',
  scrollThumb: '#D4D4D8',
  scrollThumbHover: '#A1A1AA',
  scrollThumbActive: '#71717A'
}

/** Bảng màu Dark graphite trung tính kiểu Docker Desktop / VS Code / Linear: không tím AI. */
const DARK: Palette = {
  window: '#141518',
  sidebar: '#17191D',
  content: '#101114',
  panel: '#191B20',
  elevated: '#21242B',
  border: '#2A2D35',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderInput: '#363A45',
  borderInputHover: '#4D5363',
  textPrimary: '#ECEEF2',
  textSecondary: '#9BA1AE',
  textMuted: '#6E7681',
  textDisabled: '#484F58',
  accent: '#38BDF8',
  accentHover: '#7DD3FC',
  accentPressed: '#0EA5E9',
  primary: '#2F81F7',
  primaryHover: '#4C93FA',
  primaryPressed: '#1F6FEB',
  primaryGlow: 'rgba(47, 129, 247, 0.18)',
  fillHover: 'rgba(255, 255, 255, 0.045)',
  fillSecondary: '#20232A',
  fillSelected: 'rgba(47, 129, 247, 0.14)',
  success: '#3FB950',
  warning: '#D29922',
  danger: '#F85149',
  info: '#58A6FF',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.22)',
  shadowMd: '0 8px 24px rgba(0, 0, 0, 0.45)',
  scrollThumb: '#323640',
  scrollThumbHover: '#474D5C',
  scrollThumbActive: '#5C6478'
}

/** Màu nút thu nhỏ/đóng của overlay native Windows — main đọc qua shared/ipc.ts. */
export const TITLEBAR_OVERLAY: Record<ThemeMode, { color: string; symbolColor: string }> = {
  light: { color: LIGHT.window, symbolColor: '#18181B' },
  dark: { color: DARK.window, symbolColor: '#ECEEF2' }
}

/** Palette xterm cho terminal deploy/migrate — xterm cần màu cụ thể (không đọc được
 *  CSS var). Trùng giá trị --term-* sinh ở cssVarsFor: terminal luôn tối ở cả hai theme. */
export const TERM_COLORS = {
  background: '#0C0D10',
  foreground: '#E2E6EE',
  cursor: '#58A6FF'
} as const

function cssVarsFor(mode: ThemeMode): Record<string, string> {
  const c = mode === 'light' ? LIGHT : DARK
  return {
    '--font-ui': FONT_UI,
    '--font-mono': FONT_MONO,
    '--window-bg': c.window,
    '--sidebar-bg': c.sidebar,
    '--content-bg': c.content,
    '--bg-base': c.content,
    '--bg-panel': c.panel,
    '--bg-elevated': c.elevated,
    '--border': c.border,
    '--border-subtle': c.borderSubtle,
    '--border-input': c.borderInput,
    '--border-input-hover': c.borderInputHover,
    '--text-primary': c.textPrimary,
    '--text-secondary': c.textSecondary,
    '--text-muted': c.textMuted,
    '--text-disabled': c.textDisabled,
    '--accent': c.accent,
    '--accent-hover': c.accentHover,
    '--accent-pressed': c.accentPressed,
    '--primary': c.primary,
    '--primary-hover': c.primaryHover,
    '--primary-pressed': c.primaryPressed,
    '--primary-glow': c.primaryGlow,
    '--fill-hover': c.fillHover,
    '--fill-secondary': c.fillSecondary,
    '--fill-selected': c.fillSelected,
    '--success': c.success,
    '--warning': c.warning,
    '--danger': c.danger,
    '--error': c.danger,
    '--info': c.info,
    '--shadow-sm': c.shadowSm,
    '--shadow-md': c.shadowMd,
    '--scroll-thumb': c.scrollThumb,
    '--scroll-thumb-hover': c.scrollThumbHover,
    '--scroll-thumb-active': c.scrollThumbActive,
    // Terminal deploy luôn tối ở cả hai theme — đây là quy ước của công cụ terminal.
    '--term-bg': '#0C0D10',
    '--term-toolbar': '#15171C',
    '--term-border': '#262932',
    '--term-text': '#E2E6EE',
    '--term-muted': '#8B949E',
    '--term-btn-bg': '#1F232B',
    '--term-btn-border': '#323846',
    '--term-live': '#3FB950',
    '--term-failed': '#F85149',
    '--term-idle': '#6E7681'
  }
}

function antdThemeFor(mode: ThemeMode): ThemeConfig {
  const c = mode === 'light' ? LIGHT : DARK
  return {
    algorithm: mode === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm,
    token: {
      fontFamily: FONT_UI,
      fontFamilyCode: FONT_MONO,
      fontSize: 13,
      fontSizeSM: 12,
      borderRadius: 6,
      borderRadiusSM: 4,
      borderRadiusLG: 8,
      controlHeight: 32,
      controlHeightSM: 26,
      controlHeightLG: 38,
      colorPrimary: c.primary,
      colorPrimaryHover: c.primaryHover,
      colorPrimaryActive: c.primaryPressed,
      colorInfo: c.info,
      colorLink: c.info,
      colorLinkHover: c.primaryHover,
      colorSuccess: c.success,
      colorWarning: c.warning,
      colorError: c.danger,
      colorBgBase: c.content,
      colorBgContainer: c.panel,
      colorBgElevated: c.elevated,
      colorBorder: c.border,
      colorBorderSecondary: c.border,
      colorText: c.textPrimary,
      colorTextSecondary: c.textSecondary,
      colorTextTertiary: c.textMuted,
      colorTextQuaternary: c.textDisabled
    },
    components: {
      Layout: {
        siderBg: c.sidebar,
        bodyBg: c.content,
        headerBg: c.window,
        triggerBg: c.sidebar,
        triggerColor: c.textSecondary
      },
      Menu: {
        itemHeight: 34,
        itemMarginInline: 8,
        itemBorderRadius: 6,
        itemPaddingInline: 10,
        itemBg: 'transparent',
        itemColor: c.textSecondary,
        itemHoverColor: c.textPrimary,
        itemHoverBg: c.fillHover,
        itemSelectedColor: c.textPrimary,
        itemSelectedBg: c.fillSelected,
        activeBarBorderWidth: 0
      },
      Button: {
        borderRadius: 6,
        borderRadiusSM: 4,
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none'
      },
      Card: {
        borderRadiusLG: 8,
        paddingLG: 16,
        headerFontSize: 13.5,
        headerHeight: 42
      },
      Table: {
        headerBg: c.elevated,
        headerColor: c.textSecondary,
        headerSplitColor: 'transparent',
        headerBorderRadius: 0,
        rowHoverBg: c.fillHover,
        cellPaddingBlock: 10,
        cellPaddingInline: 12
      },
      Modal: {
        borderRadiusLG: 8,
        contentBg: c.panel,
        headerBg: c.panel
      },
      Drawer: {
        colorBgElevated: c.panel
      },
      Tag: {
        borderRadiusSM: 4,
        fontSize: 12
      },
      Tabs: {
        itemSelectedColor: c.textPrimary,
        itemHoverColor: c.textPrimary,
        inkBarColor: c.primary
      },
      Segmented: {
        trackBg: c.content,
        itemSelectedBg: c.elevated,
        itemSelectedColor: c.textPrimary,
        borderRadius: 6,
        borderRadiusSM: 4
      }
    }
  }
}

export const themeTokens: Record<ThemeMode, ThemeConfig> = {
  light: antdThemeFor('light'),
  dark: antdThemeFor('dark')
}

/** Đặt data-theme + toàn bộ biến CSS lên <html>. Gọi trước render đầu (main.tsx)
 *  và mỗi khi đổi theme để CSS var không nháy màu cũ. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  root.dataset.theme = mode
  for (const [name, value] of Object.entries(cssVarsFor(mode))) {
    root.style.setProperty(name, value)
  }
}
