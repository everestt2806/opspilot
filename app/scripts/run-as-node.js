/* eslint-disable */
// Chạy script CLI dưới chế độ Electron-as-Node: better-sqlite3 đã được electron-rebuild
// nên chạy bằng node thường sẽ lỗi ABI — phải dùng chính binary Electron làm runtime.
const { spawnSync } = require('child_process')
const electron = require('electron')

const result = spawnSync(electron, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(result.status ?? 1)
