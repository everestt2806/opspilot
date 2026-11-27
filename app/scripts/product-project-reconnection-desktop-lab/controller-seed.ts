// Fixture metadata riêng cho native installed Root; không SSH tới target/Docker.
import { randomBytes, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  loadControllerCredentialCipher,
  encryptControllerCredential
} from '../../src/main/controlPlane/controllerSecrets'
import { ProductProjectRegistration } from '../../src/main/controlPlane/projectRegistration'
import { ProductPostgresRepository } from '../../src/main/db/productPostgresRepository'
import { ProductPostgresSelection } from '../../src/main/controlPlane/productPostgresSelection'

function seed(): void {
  const [directory, controllerId, nonce] = process.argv.slice(2)
  if (
    !/^\/opt\/opspilot-controller-upgrade-desktop-lab-[a-f0-9]{12}\/data$/.test(directory) ||
    realpathSync(directory) !== directory ||
    !/^[a-f0-9-]{36}$/.test(controllerId) ||
    !/^[a-f0-9]{12}$/.test(nonce) ||
    !process.getuid?.()
  )
    throw Error()
  const db = new Database(join(directory, 'opspilot.db'))
  db.pragma('foreign_keys=ON')
  try {
    const cipher = loadControllerCredentialCipher(directory)
    const target = {
      vps_id: 900001,
      host: 'metadata-only.test',
      port: 22,
      username: 'operator',
      auth_type: 'password' as const,
      host_fingerprint: 'SHA256:' + 'A'.repeat(43),
      ssh_security_revision: 1
    }
    const envelope = encryptControllerCredential(
      cipher,
      { controller_id: controllerId, target },
      randomBytes(32).toString('base64url')
    )
    db.prepare(
      `INSERT INTO vps(id,name,host,port,username,auth_type,host_fingerprint,ssh_security_revision,
      crypto_scheme,encrypted_secret,iv,auth_tag) VALUES(900001,'metadata-only','metadata-only.test',22,'operator','password',?,1,'aes_256_gcm',?,?,?)`
    ).run(target.host_fingerprint, envelope.encrypted_secret, envelope.iv, envelope.auth_tag)
    const registered = new ProductProjectRegistration(
      db,
      controllerId,
      `unix:${process.getuid!()}`,
      cipher
    ).register({
      format: 1,
      controller_id: controllerId,
      request_key: randomUUID(),
      target_vps_id: target.vps_id,
      expected_target_security_revision: 1,
      app_name: 'reconnect-' + nonce,
      framework: 'express',
      // Poller vẫn đọc Git khi app paused; dùng repo public thật để fixture
      // không làm controller degraded bởi URL giả. Không chạy deployment.
      repository_url: 'https://github.com/everestt2806/opspilot.git',
      production_ref: 'main',
      repository_root: '.',
      host_port: null,
      container_port: 3000,
      healthcheck_path: '/health'
    })
    const input = {
      format: 1 as const,
      request_key: randomUUID(),
      scope: {
        controller_id: controllerId,
        app_id: registered.app_id,
        ownership_generation: 1,
        target
      },
      expected_source_generation: 1,
      expected_source_config_sha256: registered.source_config_sha256
    }
    const pg = new ProductPostgresRepository(db, cipher).prepare(
      input,
      controllerId,
      `unix:${process.getuid!()}`
    )
    new ProductPostgresSelection(db, cipher).select(
      { ...input, database_id: pg.metadata.database_id },
      controllerId,
      `unix:${process.getuid!()}`
    )
    console.log(
      JSON.stringify({
        app_id: registered.app_id,
        database_id: pg.metadata.database_id,
        source_generation: 2
      })
    )
  } finally {
    db.close()
  }
}
try {
  seed()
} catch {
  console.error('NATIVE_RECONNECTION_SEED_FAILED')
  process.exitCode = 1
}
