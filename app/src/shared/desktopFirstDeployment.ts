import type { DesktopControllerCommand } from './desktopControllerCommands'
import type { ProductProjectReadiness } from './productProjectReadiness'

export interface DesktopProjectReadiness {
  binding_id: string
  binding_revision: number
  request_key: string
  controller_ready: boolean
  state: 'ready' | 'blocked'
  report: ProductProjectReadiness
  /** Opaque main-created ID, chỉ có khi report và controller capability đều ready. */
  readiness_id: string | null
  valid_until: string | null
}
export interface DesktopFirstDeploymentInput {
  request_key: string
  readiness_id: string
}
export interface DesktopFirstDeploymentPlan {
  request_key: string
  readiness_id: string
  binding_id: string
  binding_revision: number
  app_id: number
  source_sha: string
  valid_until: string
  command: DesktopControllerCommand
}
export type DesktopFirstDeploymentSendInput = DesktopFirstDeploymentInput & { command_key: string }
/** Main cache tốiđa100receipts, TTL60s, bound setup/body/controller/bindingrevision;
 * source SHA/target/generations không nhận từ renderer. Prepare tạo durable journal
 * trước POST; user review fullSHA và confirm. Send chỉ matching prepared intent,
 * same receipt chưa hết hạn; first-deployment flag được API check nguyên tử.
 * Cold prepared cần check readiness hoặc explicit cancel; unknown/inflight chỉ
 * check-command cùng key, không POST lại. State accepted không phải runtime success.
 */
