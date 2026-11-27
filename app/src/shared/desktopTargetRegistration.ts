/** Main derive profile + secret từ local VPS; renderer chỉ chọn ID và xác nhận. */
export interface DesktopTargetPrepareInput {
  binding_id: string
  local_vps_id: number
}
export interface DesktopTargetSendInput {
  request_key: string
  confirm_transfer: true
}
export interface DesktopTargetSetup {
  request_key: string
  binding_id: string
  binding_revision: number
  controller_id: string
  local_vps_id: number
  local_security_revision: number
  profile: {
    name: string
    host: string
    port: number
    username: string
    auth_type: 'key' | 'password'
    host_fingerprint: string
  }
  state: 'prepared' | 'in_flight' | 'outcome_unknown' | 'registered' | 'cancelled'
  remote_vps_id: number | null
  remote_security_revision: number | null
  created_at: string
  updated_at: string
}
/** Prepare ghi UUID + profile/revision + ciphertext digest trước mạng, không secret.
 * Explicit send phải confirm_transfer=true; main kiểm current local/profile/cipher
 * và binding trước dispatch/stdin và sau reply. Chỉ gửi secret qua fixed verified
 * SSH-admin register-vps; helper không ghi secret vào argv/env/stderr/output.
 * Unknown/cold in_flight explicit retry cùng UUID/body, không auto retry. Cancel chỉ
 * prepared, tombstone giữ khi xóa VPS/binding. Registered không có nghĩa installed,
 * Docker ready hoặc deployed. Không tự init/rotate controller key.
 * Riêng register-vps: maxrequest512KiB, secret256KiB, helperprocess60s/adminwhole90s;
 * mọi operation khác giữ giới hạn/deadline hiện hành. */
