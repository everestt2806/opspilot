// Seed 1 VPS vao DB app dung code path that (safeStorage). Dung mot lan cho demo.
// Chay: pnpm exec tsc -p tsconfig.scripts.json && node scripts/prepare-cli.js
//       OPSPILOT_SEED_SECRET=... OPSPILOT_SEED_HOST=221.121.1.80 OPSPILOT_SEED_NAME=VM02 npx electron .out-scripts/scripts/seed-vps.js
// Mặc định (không set host/name): VM01 / 221.121.1.79 như cũ.
import { app } from 'electron'

import { createCredentialCipher } from '../src/main/crypto/masterKey'
import { closeDatabase, initializeDatabase } from '../src/main/db'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { VpsService } from '../src/main/vps/service'

const USER_DATA = process.env.OPSPILOT_SEED_USER_DATA ?? ''
const SEED_NAME = process.env.OPSPILOT_SEED_NAME ?? 'VM01'
const SEED_HOST = process.env.OPSPILOT_SEED_HOST ?? '221.121.1.79'

// Giu nguyen danh tinh app nhu index.ts — safeStorage Windows ma hoa theo danh tinh app.
app.setAppUserModelId('vn.opspilot.desktop')
app.setName('OpsPilot')

void app
  .whenReady()
  .then(() => {
    const database = initializeDatabase(USER_DATA)
    try {
      const cipher = createCredentialCipher(USER_DATA)
      const service = new VpsService(new VpsRepository(database), cipher)
      const vps = service.create({
        name: SEED_NAME,
        host: SEED_HOST,
        port: 22,
        username: 'root',
        auth_type: 'password',
        secret: process.env.OPSPILOT_SEED_SECRET ?? '',
        provider: 'WiService',
        region: 'Hanoi'
      })
      console.log(`da tao VPS id=${vps.id} name=${vps.name} host=${vps.host}`)
      console.log(`tong so VPS trong DB: ${service.list().length}`)
    } finally {
      closeDatabase()
    }
    app.quit()
  })
  .catch((error: unknown) => {
    console.error(
      'SEED FAIL',
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    )
    app.exit(1)
  })
