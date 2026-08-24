/* eslint-disable */
// db/index.ts dùng import './migrations/001_init.sql?raw' (electron-vite xử lý ?raw).
// Bản build CLI (tsc commonjs) không có plugin đó — bước này chép .sql kèm ra thư mục
// biên dịch và trỏ require sang readFileSync. __importDefault của esModuleInterop tự
// bọc chuỗi thành { default: sql } nên đường dùng .default phía sau vẫn đúng.
const { mkdirSync, copyFileSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const migrationDir = join('.out-scripts', 'src', 'main', 'db', 'migrations')
const compiledIndex = join('.out-scripts', 'src', 'main', 'db', 'index.js')

mkdirSync(migrationDir, { recursive: true })
copyFileSync(
  join('src', 'main', 'db', 'migrations', '001_init.sql'),
  join(migrationDir, '001_init.sql')
)

let code = readFileSync(compiledIndex, 'utf8')
const before = code
code = code.replace(
  'require("./migrations/001_init.sql?raw")',
  "require('node:fs').readFileSync(require('node:path').join(__dirname, 'migrations', '001_init.sql'), 'utf8')"
)
if (code === before) {
  console.error('prepare-cli: khong tim thay dong require ?raw trong db/index.js da bien dich')
  process.exit(1)
}
writeFileSync(compiledIndex, code)
console.log('prepare-cli: da chuan bi 001_init.sql cho bản build CLI')
