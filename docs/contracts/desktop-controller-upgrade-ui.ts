import type { DesktopUpgrade, DesktopUpgradePlan } from './desktop-controller-upgrade'
import type { ControllerInstallerRelease } from './desktop-controller-installer'
import type { DesktopControllerConnection } from './desktop-controller-ipc'
import type { DesktopInstallation } from './desktop-controller-installation'

export type ControllerUpgradeOverview = { ssh_candidates?: {id:number;name:string;host:string}[]; releases:ControllerInstallerRelease[]; installations:DesktopInstallation[]; upgrades:DesktopUpgrade[]; connections:DesktopControllerConnection[] }
export type ControllerUpgradeReviewInput = {installation_request_key:string;release_id:string}
export type ControllerUpgradeSendInput = {request_key:string;operation:'transfer'|'upgrade'|'recover'|'rollback';consent:true}
export type ControllerUpgradeBindingReview = {plan_id:string;expires_at:string;binding_id:string;upgrade_request_key:string;binding_revision:number;controller_id:string;release_id:string}
export type ControllerUpgradeReview = DesktopUpgradePlan
/** IDs/consent only. Main derives pins/paths/UID/current authority. Refresh preserves
 * access token/client/scopes, checks old encrypted intent/revision and fresh remote
 * settled ready evidence, then increments local binding epoch atomically. No implicit
 * enrollment/rotation; credential/VPS identity changes require separate authority review.
 */
