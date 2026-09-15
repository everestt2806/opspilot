import { theme } from 'antd'

import type { ThemeConfig } from 'antd'

/** Nguồn duy nhất của bảng màu app: antd ThemeConfig và biến CSS (--*) đều sinh từ đây.
 *  Không khai báo màu trực tiếp trong CSS hay inline style — thêm vào Palette rồi dùng qua var. */

export type ThemeMode = 'light' | 'dark'

export const FONT_UI = "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
export const FONT_MONO = "'Cascadia Mono', Consolas, monospace"

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
  fillHover: string
  fillSelected: string
  success: string
  warning: string
  danger: string
  info: string
  scrollThumb: string
  scrollThumbHover: string
  scrollThumbActive: string
}

/** Bảng màu desktop-tool theo tinh thần VS Code/Fluent: phẳng, viền mảnh, xanh #0E639C làm primary. */
const LIGHT: Palette = {
  window: '#F3F4F6',
  sidebar: '#ECEFF3',
  content: '#F3F4F6',
  panel: '#FFFFFF',
  elevated: '#FFFFFF',
  border: '#E3E6EA',
  borderInput: 'rgba(0, 0, 0, 0.22)',
  borderInputHover: 'rgba(0, 0, 0, 0.4)',
  textPrimary: 'rgba(0, 0, 0, 0.88)',
  textSecondary: 'rgba(0, 0, 0, 0.6)',
  textMuted: 'rgba(0, 0, 0, 0.45)',
  textDisabled: 'rgba(0, 0, 0, 0.35)',
  accent: '#0078D4',
  accentHover: '#106EBE',
  accentPressed: '#005A9E',
  primary: '#0E639C',
  primaryHover: '#1177BB',
  primaryPressed: '#094771',
  fillHover: 'rgba(0, 0, 0, 0.045)',
  fillSelected: 'rgba(0, 120, 212, 0.1)',
  success: '#107C41',
  warning: '#B25F00',
  danger: '#C42B1C',
  info: '#0078D4',
  scrollThumb: '#C7CBD1',
  scrollThumbHover: '#9CA3AF',
  scrollThumbActive: '#6B7280'
}

const DARK: Palette = {
  window: '#181818',
  sidebar: '#181818',
  content: '#1E1E1E',
  panel: '#252526',
  elevated: '#2A2D2E',
  border: '#333333',
  borderInput: '#3C3C3C',
  borderInputHover: '#5A5A5A',
  textPrimary: '#CCCCCC',
  textSecondary: '#969696',
  textMuted: '#737373',
  textDisabled: '#656565',
  accent: '#007ACC',
  accentHover: '#1C8BD1',
  accentPressed: '#0062A3',
  primary: '#0E639C',
  primaryHover: '#1177BB',
  primaryPressed: '#094771',
  fillHover: '#2A2D2E',
  fillSelected: '#37373D',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  info: '#4DAAFC',
  scrollThumb: '#46505C',
  scrollThumbHover: '#657384',
  scrollThumbActive: '#8291A2'
}

/** Màu nút thu nhỏ/đóng của overlay native Windows — main đọc qua shared/ipc.ts. */
export const TITLEBAR_OVERLAY: Record<ThemeMode, { color: string; symbolColor: string }> = {
  light: { color: LIGHT.window, symbolColor: '#333333' },
  dark: { color: DARK.window, symbolColor: '#CCCCCC' }
}

/** Palette xterm cho terminal deploy/migrate — xterm cần màu cụ thể (không đọc được
 *  CSS var). Trùng giá trị --term-* sinh ở cssVarsFor: terminal luôn tối ở cả hai theme. */
export const TERM_COLORS = {
  background: '#0B0E14',
  foreground: '#D7DBE4',
  cursor: '#60A5FA'
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
    '--fill-hover': c.fillHover,
    '--fill-selected': c.fillSelected,
    '--success': c.success,
    '--warning': c.warning,
    '--danger': c.danger,
    '--info': c.info,
    '--scroll-thumb': c.scrollThumb,
    '--scroll-thumb-hover': c.scrollThumbHover,
    '--scroll-thumb-active': c.scrollThumbActive,
    // Terminal deploy luôn tối ở cả hai theme — đây là quy ước của công cụ terminal.
    '--term-bg': '#0B0E14',
    '--term-toolbar': '#111722',
    '--term-border': '#1F2838',
    '--term-text': '#CBD5E1',
    '--term-muted': '#7C8AA0',
    '--term-btn-bg': '#151D2A',
    '--term-btn-border': '#2C3A50',
    '--term-live': '#34D399',
    '--term-failed': '#F87171',
    '--term-idle': '#64748B'
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
      borderRadius: 3,
      borderRadiusSM: 2,
      borderRadiusLG: 4,
      controlHeight: 30,
      colorPrimary: c.primary,
      colorPrimaryHover: c.primaryHover,
      colorPrimaryActive: c.primaryPressed,
      colorInfo: c.accent,
      colorLink: c.accent,
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
        // Nút collapse của Sider — mặc định antd là navy #002140, phá tông xám.
        triggerBg: c.sidebar,
        triggerColor: c.textSecondary
      },
      Menu: {
        itemHeight: 34,
        itemMarginInline: 8,
        itemBorderRadius: 4,
        itemPaddingInline: 10,
        // itemBg transparent để nền sider (Layout.siderBg) hiện xuyên — không bị
        // khối màu riêng của menu.
        itemBg: 'transparent',
        itemColor: c.textSecondary,
        itemHoverColor: c.textPrimary,
        itemHoverBg: c.fillHover,
        // Item đang chọn: nền fill trầm, đồng bộ với hàng bảng được chọn.
        itemSelectedColor: c.textPrimary,
        itemSelectedBg: c.fillSelected,
        activeBarBorderWidth: 0
      },
      Button: {
        // Bóng của antd mặc định là "đths web" — bỏ hết, giữ nút phẳng viền mảnh.
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none'
      },
      Card: {
        paddingLG: 16,
        headerFontSize: 13,
        headerHeight: 40
      },
      Table: {
        // Bảng clean kiểu desktop tool: header trong suốt, chỉ kẻ ngang giữa các hàng.
        headerBg: 'transparent',
        headerColor: c.textSecondary,
        headerSplitColor: 'transparent',
        rowHoverBg: c.fillHover,
        cellPaddingBlock: 12,
        cellPaddingInline: 12
      },
      Tag: {
        // antd để Tag co theo fontSizeSM — cứng lại 12px, hết chữ li ti 10px.
        fontSize: 12
      },
      Segmented: {
        itemSelectedBg: c.elevated
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
