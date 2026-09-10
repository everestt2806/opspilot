// Read-only runtime probe; the only database created is in memory.
const { createRequire } = require('node:module')
const { resolve } = require('node:path')
const appRequire = createRequire(resolve(__dirname, '../app/package.json'))
function probe() {
  console.log(JSON.stringify({ executable: process.execPath, node: process.version,
    electron: process.versions.electron ?? null, abi: process.versions.modules,
    sqliteModule: appRequire.resolve('better-sqlite3') }))
  const Database = appRequire('better-sqlite3')
  const db = new Database(':memory:')
  console.log(JSON.stringify(db.prepare('select sqlite_version() as sqlite, 1 as ok').get()))
  db.close()
}
if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
  const { app } = appRequire('electron')
  app.whenReady().then(() => { probe(); app.exit(0) }).catch(error => {
    console.error(error.message); app.exit(1)
  })
} else {
  probe()
}
