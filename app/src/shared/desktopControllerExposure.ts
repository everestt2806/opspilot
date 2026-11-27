import type { ProductExposureView } from './productExposure'

/** Renderer supplies IDs only; URL, observation and credentials belong to Main. */
export interface DesktopExposureInput {
  binding_id: string
  app_id: number
}
export interface DesktopExposureResult extends DesktopExposureInput {
  binding_revision: number
  controller_id: string
  state: 'read' | 'recorded' | 'unavailable' | 'outcome_unknown'
  reason_code: string | null
  view: ProductExposureView | null
  checked_at: string
}
/** controller:exposure-read/check: (DesktopExposureInput) => IpcResult<DesktopExposureResult>.
 * Check is explicit; policy:write required before public probe and POST. No
 * automatic retry/periodic probe. Unknown write does one read-current comparison
 * in Main; exact observation ID/body/authority only proves acceptance. Otherwise
 * return outcome_unknown. A later read reports current evidence, never retroactively
 * claims an unknown older write succeeded. No durable retry intent/command lookup.
 * Old server UNSUPPORTED is displayed; no root SQL writer or legacy executor fallback.
 */
