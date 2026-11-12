import type {
  ControllerBootstrapLocator,
  ControllerInstallationResult
} from './controllerInstaller'
/** Fixed readonly receiver verifies original staging, locks original installation,
 * reads root-owned receipt/current journal. This alone never authorizes adoption:
 * Main must match both protected catalogs, inspect through the pinned current
 * updater, then repeat and compare this entire observation under unchanged SSH.
 */
export type ControllerCurrentDiscovery =
  | { state: 'not_upgraded' }
  | {
      state: 'current_revision'
      original: ControllerBootstrapLocator & { installation: ControllerInstallationResult }
      upgrade: ControllerBootstrapLocator & {
        installation_request_key: string
        controller_id: string
        parent_upgrade_key: string | null
        parent_release_sha256: string
      }
      original_receipt_sha256: string
      current_journal_sha256: string
    }
export type ControllerAdoptionReview = {
  plan_id: string
  expires_at: string
  installation_request_key: string
  upgrade_request_key: string
  controller_id: string
  vps_id: number
  host: string
  username: string
  host_fingerprint: string
  release_id: string
}
/** IDs/consent only; never caller paths, pins, UID or remote history rows. */
export type ControllerAdoptionReviewInput = { vps_id: number }
export type ControllerAdoptionConfirmInput = { plan_id: string; consent: true }
export type ControllerAdoptionResult = {
  installation_request_key: string
  upgrade_request_key: string
  controller_id: string
  vps_id: number
  enrollment_required: true
}
