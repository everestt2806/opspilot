/** Main tạo UUID; renderer không chọn request key hoặc HTTP endpoint.
 * Journal chỉ lưu metadata, không credential, env, log hay operator note.
 * accepted = controller đã nhận intent; không đồng nghĩa app chạy thành công.
 */
export type DesktopControllerCommandInput = {
  binding_id: string
  app_id: number
  expected_ownership_generation: number
  expected_source_generation: number
} & (
  | {
      operation: 'redeploy'
      target: { kind: 'current_desired' } | { kind: 'specific_sha'; sha: string }
    }
  | { operation: 'policy'; action: 'pause' | 'resume' }
)
export interface DesktopControllerCommand {
  request_key: string
  binding_id: string
  controller_id: string
  client_id: string
  binding_revision: number
  app_id: number
  operation: 'redeploy' | 'policy'
  state: 'prepared' | 'in_flight' | 'outcome_unknown' | 'accepted' | 'rejected' | 'cancelled'
  reason_code: string | null
  remote_state: 'accepted' | 'completed' | 'blocked' | 'uncertain' | null
  job_id: string | null
  target_sha: string | null
  auto_deploy_paused: boolean | null
  created_at: string
  updated_at: string
}
/** Prepare bền trước mạng, một pending request/controller/app trên mọi binding.
 * Cùng nội dung chưa gửi trả lại prepared UUID; nội dung khác bị chặn.
 * Claim in_flight nguyên tử trước POST. in_flight/outcome_unknown không được POST
 * lần nữa. Mở lại process chỉ lookup key cũ; lookup not found vẫn unknown.
 * Lookup và response phải khớp controller/client/binding revision/app/action/gens.
 * Cancel chỉ cho prepared; không xóa tombstone khi xóa VPS/binding.
 * IPC cụ thể: prepare-command/send-command/check-command/cancel-command/commands.
 */
