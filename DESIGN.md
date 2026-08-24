# MiniDash Design System

## Overview

MiniDash is a widget-like, compact design system engineered for desktop dashboard and widget-style apps. It packs maximum information into minimal space using tight grids, small-but-readable type, and color-coded metric widgets. The indigo-teal-amber palette provides distinct channels for different data categories. Every component is optimized for dense data display on desktop app windows, making complex dashboards feel organized and scannable at a glance.

---

## Colors

- **Primary** (#6366F1): Indigo -- main actions, primary metrics
- **Secondary** (#14B8A6): Teal -- secondary metrics, positive trends
- **Tertiary** (#F59E0B): Amber -- alerts, attention-required metrics
- **Background** (#F3F4F6): App background, dashboard canvas
- **Surface** (#FFFFFF): Widget cards, panels
- **Success** (#10B981): Positive metrics, upward trends
- **Warning** (#F59E0B): Threshold warnings, caution
- **Error** (#EF4444): Negative metrics, critical alerts
- **Info** (#6366F1): Informational widgets, tips

## Typography

- **Headline Font**: Inter
- **Body Font**: DM Sans
- **Mono Font**: IBM Plex Mono

- **Display**: Inter 28px bold, 34px line height
- **Headline**: Inter 22px bold, 28px line height
- **Subhead**: Inter 17px semibold, 24px line height
- **Body Large**: DM Sans 15px regular, 22px line height
- **Body**: DM Sans 13px regular, 20px line height
- **Body Small**: DM Sans 12px regular, 18px line height
- **Caption**: DM Sans 11px medium, 16px line height
- **Overline**: DM Sans 10px semibold, 14px line height
- **Code**: IBM Plex Mono 12px regular, 18px line height

---

## Spacing

- **Base unit:** 4px (compact)
- **Scale:** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48
- **Component padding:** 8px (tight) | 12px (default) | 16px (relaxed)
- **Section spacing:** 16px between widget rows, 8px between related widgets
- **Widget grid:** 2-column grid with 8px gap on default window width, expanding to 3-4 columns on wider desktop windows, full-width widgets for charts

## Border Radius

- **None** (0px): Full-width dividers, progress bars
- **Small** (4px): Badges, mini-chips, sparklines
- **Medium** (8px): Widget cards, inputs, buttons
- **Large** (12px): Modals, expanded widget views
- **XL** (16px): Bottom sheets, overlays
- **Full** (9999px): Metric dots, pill badges, avatars

## Elevation

Subtle, restrained shadows to keep the dense interface clean.

- **Subtle**: 1px offset, 2px blur, #000000 at 4%. Resting widgets.
- **Medium**: 2px offset, 6px blur, #000000 at 6%. Hover/press widgets.
- **Large**: 6px offset, 16px blur, #000000 at 10%. Expanded widgets, modals.
- **Overlay**: 12px offset, 32px blur, #000000 at 14%. Full-screen overlays.

## Components

### Buttons

- **Primary**: #6366F1 fill, #FFFFFF text, no border, #4F46E5 fill.
- **Secondary**: #FFFFFF fill, #6366F1 text, 1px #6366F1 border, #EEF2FF fill.
- **Ghost**: transparent fill, #6B7280 text, no border, #E5E7EB fill.
- **Destructive**: #EF4444 fill, #FFFFFF text, no border, #DC2626 fill.
- **Sizes**: Small (28px height, 8px pad) | Medium (36px, 12px) | Large (44px, 16px)
- **Disabled**: 40% opacity, no press feedback
- **Click target**: Minimum 32px (use padding to extend small button hit areas for mouse precision)

### Cards

** Background #FFFFFF, border 1px #E5E7EB, radius 8px, padding 12px, shadow Subtle **default, ** Background #FFFFFF, no border, radius 8px, padding 12px, shadow Medium **elevated, metric value large and bold at top, label below, optional sparkline or trend arrow widget cards, each widget occupies 1 cell; chart widgets span full width of the grid.

### Inputs

- **Default**: #D1D5DB border, #FFFFFF fill, no shadow.
- **Hover**: #9CA3AF border, #FFFFFF fill, no shadow.
- **Focus**: #6366F1 border, #FFFFFF fill, 2px ring #6366F1 at 12% shadow.
- **Error**: #EF4444 border, #FEF2F2 fill, 2px ring #EF4444 at 10% shadow.
- **Disabled**: #E5E7EB border, #F3F4F6 fill, no shadow.
  ** 11px, weight 600, color Text Secondary, 4px below label **label, ** 11px, color Text Tertiary; error helper uses Error color **helper text, 36px (compact), radius 8px input height.

### Chips

** Background #EEF2FF, text #6366F1, radius Full, padding 4px 10px, toggleable **filter chip, ** Semantic background at 10% opacity, semantic text, radius Full, padding 2px 8px **status chip, Up=green with arrow, Down=red with arrow, Flat=gray with dash metric status chips.

### Lists

40px, padding 8px 12px row height, 1px #E5E7EB between rows divider, background #E5E7EB, 80ms feedback press, background #EEF2FF, left border 2px #6366F1 active/selected. Hover state uses background #F9FAFB for pointer-driven row highlighting.

- Dashboard lists show metric icon, name, value, and trend indicator in a compact row

### Checkboxes

16px square, radius 4px. 24px click target. Unchecked: border 2px #D1D5DB, background transparent. Checked: background #6366F1, white checkmark icon. Focus: ring 2px ring #6366F1 at 20%. Disabled: 35% opacity.

### Radio Buttons

16px circle. border 2px #D1D5DB, background transparent unselected, 24px click target. Selected: border 2px #6366F1, inner dot 8px #6366F1. Focus: ring 2px ring #6366F1 at 20%. Disabled: 35% opacity.

### Tooltips

#111827, text: #FFFFFF, radius 8px, padding 6px 10px fill. 11px DM Sans regular. 5px, matching background arrow, 180px max width, 500ms on hover (desktop) delay.
---

## Do's and Don'ts

1. **Do** use the multi-column widget grid as the primary layout pattern for dashboard screens, expanding columns to fill wider desktop windows.
2. **Do** display metric values in large, bold type with contextual trend indicators (arrows, sparklines).
3. **Don't** exceed 12 widgets on a single screen -- scroll for additional data to avoid overwhelming users.
4. **Do** color-code metrics consistently: indigo for primary KPIs, teal for positive trends, amber for warnings.
5. **Don't** use text smaller than 10px even in compact mode -- readability must not be sacrificed for density.
6. **Do** allow users to reorder and customize their widget layout via drag-and-drop.
7. **Don't** animate data updates aggressively -- use subtle fade transitions (150ms) for changing values.
8. **Do** provide an expanded view for each widget that shows full data details on click.
9. **Don't** use heavy shadows on widgets in the grid -- keep them light so the layout reads as flat and organized.
10. **Do** use semantic colors for threshold indicators so users can instantly spot values that need attention.
11. **Do** show a visible hover state and keyboard focus ring on every interactive element, since desktop navigation relies on mouse and keyboard rather than touch.

---

## Translucent Panels (Layered Surfaces)

Every page renders inside **one frame**: `<section class="page-panel">` — the theme Surface color at **50% opacity** blended over Background, with the 1px border and the **8px** radius from the Card spec, padding 24px. The top of the frame holds a `page-heading` block (title + subtitle on the left, primary actions on the right). The canvas stays faintly visible through the frame, giving the page a layered look without extra shadows. This frame is the only translucent layer on the page.

- **Light theme:** frame fill `rgba(255, 255, 255, 0.5)`; page border `#E5E7EB`.
- **Dark theme:** frame fill `rgba(30, 41, 59, 0.5)`; page border `#334155` at 60% opacity.

Cards, tables, and widgets nested inside the frame (inputs, chips, inner cards, stat widgets) keep their **solid** token backgrounds — Surface (`--bg-panel`) or Elevated (`--bg-elevated`) — so text stays fully readable. Selected and hovered rows inside a solid card use the solid Elevated fill, never a translucent one. Widgets that float outside pages (modals, drawers, popovers) keep solid surfaces as well.

---

## Dark Theme

Same tokens, spacing, radius, and component structure as above -- only the color values change.

### Colors

- **Primary** (#6366F1): Indigo -- main actions, primary metrics
- **Secondary** (#2DD4BF): Teal -- secondary metrics, positive trends
- **Tertiary** (#FBBF24): Amber -- alerts, attention-required metrics
- **Background** (#0F172A): App background, dashboard canvas
- **Surface** (#1E293B): Widget cards, panels
- **Success** (#34D399): Positive metrics, upward trends
- **Warning** (#FBBF24): Threshold warnings, caution
- **Error** (#F87171): Negative metrics, critical alerts
- **Info** (#818CF8): Informational widgets, tips

### Components

### Buttons

- **Primary**: #6366F1 fill, #FFFFFF text, no border, #818CF8 fill.
- **Secondary**: #1E293B fill, #A5B4FC text, 1px #6366F1 border, #273449 fill.
- **Ghost**: transparent fill, #94A3B8 text, no border, #273449 fill.
- **Destructive**: #F87171 fill, #0F172A text, no border, #EF4444 fill.
- **Sizes**: Small (28px height, 8px pad) | Medium (36px, 12px) | Large (44px, 16px)
- **Disabled**: 35% opacity, no press feedback
- **Click target**: Minimum 32px (use padding to extend small button hit areas for mouse precision)

### Cards

** Background #1E293B, border 1px #334155, radius 8px, padding 12px, shadow Subtle **default, ** Background #273449, no border, radius 8px, padding 12px, shadow Medium **elevated, metric value large and bold at top, label below, optional sparkline or trend arrow widget cards, each widget occupies 1 cell; chart widgets span full width of the grid.

### Inputs

- **Default**: #334155 border, #1E293B fill, no shadow.
- **Hover**: #475569 border, #1E293B fill, no shadow.
- **Focus**: #818CF8 border, #1E293B fill, 2px ring #6366F1 at 25% shadow.
- **Error**: #F87171 border, #2A1618 fill, 2px ring #F87171 at 20% shadow.
- **Disabled**: #334155 border, #0F172A fill, no shadow.
  ** 11px, weight 600, color Text Secondary, 4px below label **label, ** 11px, color Text Tertiary; error helper uses Error color **helper text, 36px (compact), radius 8px input height.

### Chips

** Background #273449, text #A5B4FC, radius Full, padding 4px 10px, toggleable **filter chip, ** Semantic background at 16% opacity, semantic text, radius Full, padding 2px 8px **status chip, Up=green with arrow, Down=red with arrow, Flat=gray with dash metric status chips.

### Lists

40px, padding 8px 12px row height, 1px #334155 between rows divider, background #0F172A, 80ms feedback press, background #1E293B, left border 2px #6366F1 active/selected. Hover state uses background #273449 for pointer-driven row highlighting.

- Dashboard lists show metric icon, name, value, and trend indicator in a compact row

### Checkboxes

16px square, radius 4px. 24px click target. Unchecked: border 2px #334155, background transparent. Checked: background #6366F1, white checkmark icon. Focus: ring 2px ring #6366F1 at 25%. Disabled: 35% opacity.

### Radio Buttons

16px circle. border 2px #334155, background transparent unselected, 24px click target. Selected: border 2px #6366F1, inner dot 8px #6366F1. Focus: ring 2px ring #6366F1 at 25%. Disabled: 35% opacity.

### Tooltips

#334155, text: #F1F5F9, radius 8px, padding 6px 10px fill. 11px DM Sans regular. 5px, matching background arrow, 180px max width, 500ms on hover (desktop) delay.

### Text

- **Text Primary** (#F1F5F9): headings, metric values
- **Text Secondary** (#94A3B8): labels, body copy
- **Text Tertiary** (#64748B): captions, placeholders

### Elevation

Shadows read weakly on a dark canvas, so surface contrast (Surface vs Background, Elevated vs Surface) carries most of the visual separation; shadow values below stay for Large/Overlay states where a dark canvas still benefits from them.

- **Subtle**: no shadow, 1px border #334155 at 60% opacity. Resting widgets.
- **Medium**: 2px offset, 6px blur, #000000 at 10%. Hover/press widgets.
- **Large**: 6px offset, 16px blur, #000000 at 24%. Expanded widgets, modals.
- **Overlay**: 12px offset, 32px blur, #000000 at 32%, plus a #020617 scrim at 70% behind the overlay. Full-screen overlays.
