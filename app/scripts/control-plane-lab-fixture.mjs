import { createHash } from 'node:crypto'
import { existsSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const dataDirectory = resolve(process.argv[2] ?? '')
const allowedRoot = '/var/tmp/opspilot-p3c-lab-'
if (process.env.OPSPILOT_P3C_LAB_FIXTURE !== '1' || !dataDirectory.startsWith(allowedRoot)) {
  throw new Error('LAB_FIXTURE_REQUIRES_ISOLATED_TMP_DATA_DIR')
}
if (!existsSync(resolve(dataDirectory, '.product-controller-initialized'))) {
  throw new Error('LAB_FIXTURE_REQUIRES_INITIALIZED_CONTROLLER')
}
const pathInfo = lstatSync(dataDirectory)
if (pathInfo.isSymbolicLink() || !pathInfo.isDirectory())
  throw new Error('LAB_FIXTURE_DATA_DIR_INVALID')

const runtimeModules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
if (!runtimeModules) throw new Error('LAB_FIXTURE_REQUIRES_ISOLATED_RUNTIME_MODULES')
const require = createRequire(resolve(runtimeModules, '../package.json'))
const Database = require('better-sqlite3')
const database = new Database(resolve(dataDirectory, 'opspilot.db'))
try {
  database.pragma('foreign_keys = ON')
  const alreadySeeded = database
    .prepare("SELECT COUNT(*) AS count FROM product_app_control WHERE mode='product'")
    .get().count
  if (alreadySeeded !== 0) throw new Error('LAB_FIXTURE_ALREADY_SEEDED')
  const sourceConfig = '{}'
  const configSha = createHash('sha256').update(sourceConfig).digest('hex')
  const controllerId = database
    .prepare("SELECT controller_id FROM product_controller WHERE status='active'")
    .get()?.controller_id
  if (!controllerId) throw new Error('LAB_FIXTURE_CONTROLLER_IDENTITY_MISSING')

  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
       VALUES (93001, 'p3c-lab-target', 'fixture.invalid', 'unused', 'key', X'00')`
      )
      .run()
    database
      .prepare(
        `INSERT INTO app (id, vps_id, name, framework, host_port, container_port,
         source_type, git_repo_url, git_ref, git_root)
       VALUES (93001, 93001, 'p3c-lab-app', 'express', 30991, 3000,
         'git', 'https://github.com/octocat/Hello-World.git', 'master', '.')`
      )
      .run()
    database
      .prepare(
        `INSERT INTO product_source_config
       (app_id, source_generation, repository_url, production_ref, repository_root,
        deploy_config_json, config_sha256, created_at)
       VALUES (93001, 1, 'https://github.com/octocat/Hello-World.git', 'master', '.', ?, ?, ?)`
      )
      .run(sourceConfig, configSha, new Date().toISOString())
    database
      .prepare(
        `INSERT INTO product_app_control
       (app_id, mode, controller_id, ownership_generation, source_generation,
        source_config_sha256, changed_at)
       VALUES (93001, 'product', ?, 1, 1, ?, ?)`
      )
      .run(controllerId, configSha, new Date().toISOString())
  })()
  console.log(
    JSON.stringify({
      fixture: 'isolated_public_repo',
      app_id: 93001,
      repository: 'https://github.com/octocat/Hello-World.git',
      production_ref: 'master',
      fake_target_host: 'fixture.invalid'
    })
  )
} finally {
  database.close()
}
