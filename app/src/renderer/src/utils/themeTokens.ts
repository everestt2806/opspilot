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
  window: '#F8F9FA',
  sidebar: '#F0F2F6',
  content: '#F8F9FA',
  panel: '#FFFFFF',
  elevated: '#FFFFFF',
  border: '#E2E6ED',
  borderInput: 'rgba(0, 0, 0, 0.16)',
  borderInputHover: 'rgba(0, 0, 0, 0.32)',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',
  textDisabled: '#94A3B8',
  accent: '#0284C7',
  accentHover: '#0369A1',
  accentPressed: '#075985',
  primary: '#2563EB',
  primaryHover: '#1D4ED8',
  primaryPressed: '#1E40AF',
  fillHover: 'rgba(0, 0, 0, 0.04)',
  fillSelected: 'rgba(37, 99, 235, 0.08)',
  success: '#059669',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#0284C7',
  scrollThumb: '#CBD5E1',
  scrollThumbHover: '#94A3B8',
  scrollThumbActive: '#64748B'
}

const DARK: Palette = {
  window: '#0F1117',
  sidebar: '#121622',
  content: '#0A0D14',
  panel: '#121622',
  elevated: '#1A2030',
  border: '#1F2637',
  borderInput: '#273147',
  borderInputHover: '#3D4C6E',
  textPrimary: '#E2E8F0',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDisabled: '#475569',
  accent: '#38BDF8',
  accentHover: '#0EA5E9',
  accentPressed: '#0284C7',
  primary: '#2563EB',
  primaryHover: '#3B82F6',
  primaryPressed: '#1D4ED8',
  fillHover: 'rgba(255, 255, 255, 0.05)',
  fillSelected: 'rgba(37, 99, 235, 0.14)',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#38BDF8',
  scrollThumb: '#2C3549',
  scrollThumbHover: '#3F4D6B',
  scrollThumbActive: '#54668D'
}

/** Màu nút thu nhỏ/đóng của overlay native Windows — main đọc qua shared/ipc.ts. */
export const TITLEBAR_OVERLAY: Record<ThemeMode, { color: string; symbolColor: string }> = {
  light: { color: LIGHT.window, symbolColor: '#1E293B' },
  dark: { color: DARK.window, symbolColor: '#E2E8F0' }
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
