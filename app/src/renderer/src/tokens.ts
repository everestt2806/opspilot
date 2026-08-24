/**
 * Design Tokens for OpsPilot Renderer UI
 * Spec: docs/02-ui-ux-spec.md + DESIGN.md (MiniDash)
 *
 * Bảng màu đã chuyển hẳn sang CSS var trong assets/tokens.css
 * (đổi theo data-theme="light|dark") và token AntD trong utils/themeTokens.ts.
 * File này chỉ còn font stack — mọi chỗ cần màu phải dùng var(--*) / token
 * AntD để luôn khớp theme đang chọn.
 */

export const fonts = {
  ui: "'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'IBM Plex Mono', 'JetBrains Mono', Consolas, monospace"
} as const
