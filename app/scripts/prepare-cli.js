/* eslint-disable */
// db/index.ts dùng import './migrations/001_init.sql?raw' (electron-vite xử lý ?raw).
// Bản build CLI (tsc commonjs) không có plugin đó — bước này chép .sql kèm ra thư mục
// biên dịch và trỏ require sang readFileSync. __importDefault của esModuleInterop tự
// bọc chuỗi thành { default: sql } nên đường dùng .default phía sau vẫn đúng.
const { mkdirSync, copyFileSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const migrationDir = join('.out-scripts', 'src', 'main', 'db', 'migrations')
const compiledIndex = join('.out-scripts', 'src', 'main', 'db', 'index.js')
const migrations = [
  '001_init.sql',
  '002_metric_activation.sql',
  '003_migration_error_message.sql',
  '004_publish_doctor_domain.sql',
  '005_experiment_run_attempt.sql',
  '006_vps_host_fingerprint.sql'
]

mkdirSync(migrationDir, { recursive: true })
for (const migration of migrations) {
  copyFileSync(join('src', 'main', 'db', 'migrations', migration), join(migrationDir, migration))
}

let code = readFileSync(compiledIndex, 'utf8')
for (const migration of migrations) {
  code = code.replace(
    `require("./migrations/${migration}?raw")`,
    `require('node:fs').readFileSync(require('node:path').join(__dirname, 'migrations', '${migration}'), 'utf8')`
  )
}
if (code.includes('?raw')) {
  console.error('prepare-cli: khong tim thay dong require ?raw trong db/index.js da bien dich')
  process.exit(1)
}
writeFileSync(compiledIndex, code)
console.log('prepare-cli: migrations prepared for CLI build')
