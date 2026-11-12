/** Windows release resource. Hash is baked into trusted Main at build time. */
export interface MlRuntimeManifest {
  format: 1
  platform: 'win32-x64'
  python_version: string
  interpreter: 'python.exe'
  service_directory: 'service'
  packages: Record<string, string>
  files: Array<{ path: string; size: number; sha256: string }>
}
/**
 * Generated resource, not a virtualenv. Exact bounded sorted file inventory/hash,
 * no symlink/junction/extra files, no state or credentials. python312._pth has only
 * python312.zip, DLLs, Lib/site-packages, service; no import site/registry/user PATH.
 * Main uses -I -B, explicit loopback/single-worker/h11/asyncio/no-websocket launch.
 * Packaged state is userData/ml-state via OPSPILOT_ML_STATE_DIRECTORY, never inside
 * resources. Missing/hash-mismatched artifact refuses packaged launch/packaging;
 * never fall back to global Python or developer .venv. No IPC/API/schema change.
 */

/**
 * Nâng cấp Windows: trước khi NSIS gỡ bản cũ, migration đọc riêng
 * <installation>/resources/ml-service/state. Chỉ nhận service source pins và
 * scientific-library versions trong chính sách đóng gói đã duyệt; không chạy
 * Python/pickle hoặc script trong bản cũ để kiểm chứng. Dữ liệu bounded/no-link,
 * deployment IDs dương và đúng cặp state.pkl/meta.json; ghi vào userData/ml-state
 * bằng staging + atomic directory rename, giữ nguyên nguồn. Target đã có chỉ
 * được chấp nhận khi cùng bytes, không merge/ghi đè model khác. Conflict, app
 * đang chạy, state không hoàn chỉnh hoặc nguồn không được duyệt phải abort
 * installer trước uninstall, với hướng dẫn giữ nguyên bản cũ và sao lưu.
 * Không tự chuyển profile/key giữa Windows accounts hoặc đổi feature/model.
 */
