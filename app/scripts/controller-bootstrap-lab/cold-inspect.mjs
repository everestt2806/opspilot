import { createRequire, Module } from 'node:module'
import { readFileSync } from 'node:fs'
const input = JSON.parse(readFileSync(0, 'utf8'))
process.env.NODE_PATH = input.modules
Module._initPaths()
const require = createRequire(import.meta.url)
const {
  SshManager,
  DesktopControllerInstallations,
  initializeDatabase,
  closeDatabase,
  VpsRepository,
  AesGcmCredentialCipher,
  loadSecret
} = require(input.tool)
const db = initializeDatabase(input.directory)
const cipher = new AesGcmCredentialCipher(Buffer.from(input.key, 'base64'))
const repository = new VpsRepository(db)
const ssh = new SshManager((id) => {
  const v = repository.getById(id)
  return {
    host: v.host,
    port: v.port,
    username: v.username,
    authType: v.auth_type,
    hostFingerprint: v.host_fingerprint,
    secret: loadSecret(db, cipher, id)
  }
})
try {
  const journal = new DesktopControllerInstallations(db, ssh, [input.release], {
    bootstrapScript: input.bootstrapScript
  })
  const before = journal.list()
  const result = await journal.inspect(input.request_key)
  console.log(
    JSON.stringify({
      before,
      result,
      schema: db.prepare('SELECT max(version) n FROM schema_version').get().n
    })
  )
} finally {
  await ssh.disconnectAll()
  closeDatabase()
}
