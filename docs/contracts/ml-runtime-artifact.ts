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
