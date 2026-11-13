import Database from 'better-sqlite3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { initializeDatabase, runMigrations } from '../../src/main/db'
import { AesGcmCredentialCipher } from '../../src/main/crypto/credentialCipher'
import { DesktopControllerVault } from '../../src/main/controlPlane/desktopControllerVault'
import { DesktopProjectSetups } from '../../src/main/controlPlane/desktopProjectSetup'
import { DesktopProductEnvironment } from '../../src/main/controlPlane/desktopProductEnvironment'
import { ProductEnvironmentRepository } from '../../src/main/db/productEnvironmentRepository'
import { canonicalH2Json } from '../../src/main/controlPlane/productH2Proof'
import type { DesktopControllerEnrollment } from '../../src/main/controlPlane/desktopControllerEnrollment'

/** Private lab only: controller transport is synthetic; both SQLite/vaults are real. */
export async function fixture(directory: string): Promise<{
  db: ReturnType<typeof initializeDatabase>
  remote: Database.Database
  cipher: AesGcmCredentialCipher
  vault: DesktopControllerVault
  projects: DesktopProjectSetups
  main: DesktopProductEnvironment
  repo: ProductEnvironmentRepository
  bindingId: string
  projectKey: string
  admin: Pick<
    DesktopControllerEnrollment,
    'environmentContext' | 'environmentState' | 'stageEnvironment'
  >
  behavior: { lost: boolean; failBefore: boolean }
  controllerId: string
}> {
  const db = initializeDatabase(join(directory, 'desktop')),
    remote = new Database(join(directory, 'remote.db')),
    cipher = new AesGcmCredentialCipher(randomBytes(32)),
    remoteCipher = new AesGcmCredentialCipher(randomBytes(32)),
    controllerId = randomUUID(),
    bindingId = randomUUID(),
    pin = 'SHA256:' + 'A'.repeat(43)
  remote.pragma('journal_mode=WAL')
  remote.pragma('foreign_keys=ON')
  runMigrations(remote, Infinity, 'controller')
  remote
    .prepare(
      "INSERT INTO vps(id,name,host,username,auth_type,host_fingerprint,encrypted_secret) VALUES(77,'target','target.test','operator','key',?,X'00')"
    )
    .run(pin)
  remote.exec(
    "INSERT INTO app(id,vps_id,name,framework,host_port,container_port) VALUES(42,77,'env-ui','nextjs',30000,3000)"
  )
  remote
    .prepare("INSERT INTO product_controller VALUES(?,'2026-11-14T00:00:00.000Z','active')")
    .run(controllerId)
  const config = canonicalH2Json({
      framework: 'nextjs',
      host_port: 30000,
      container_port: 3000,
      healthcheck_path: '/',
      needs_db: false
    }),
    hash = createHash('sha256').update(config).digest('hex')
  remote
    .prepare(
      "INSERT INTO product_source_config VALUES(42,1,'https://github.com/example/app.git','main','.',?,?,?)"
    )
    .run(config, hash, '2026-11-14T00:00:00.000Z')
  remote
    .prepare(
      "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at) VALUES(42,'product',?,1,1,?,'2026-11-14T00:00:00.000Z')"
    )
    .run(controllerId, hash)
  db.prepare(
    "INSERT INTO vps(id,name,host,username,auth_type,host_fingerprint,encrypted_secret) VALUES(1,'controller','controller.test','operator','key',?,X'00')"
  ).run(pin)
  const vault = new DesktopControllerVault(db, cipher),
    expires = new Date(Date.now() + 86400000).toISOString()
  vault.prepare({
    binding_id: bindingId,
    controller_id: controllerId,
    vps_id: 1,
    ssh_security_revision: 1,
    principal: {
      vpsId: 1,
      host: 'controller.test',
      port: 22,
      username: 'operator',
      authType: 'key',
      hostFingerprint: pin
    },
    artifact_path: '/opt/opspilot/controller.cjs',
    node_path: '/opt/opspilot/node',
    data_directory: '/var/lib/opspilot',
    manifest_sha256: 'a'.repeat(64),
    display_name: 'Environment private lab',
    requested_scopes: ['read', 'deploy:manual', 'policy:write']
  })
  vault.activate(bindingId, 1, {
    state: 'issued_once',
    controller_id: controllerId,
    client: {
      client_id: randomUUID(),
      controller_id: controllerId,
      display_name: 'Environment private lab',
      scopes: ['read', 'deploy:manual', 'policy:write'],
      created_at: new Date().toISOString(),
      revoked_at: null,
      token_expires_at: expires
    },
    credential: {
      access_token: 'opspilot_' + randomBytes(32).toString('base64url'),
      token_type: 'Bearer',
      expires_at: expires
    }
  })
  const projects = new DesktopProjectSetups(db, vault, {
    projectTargets: async () => ({
      controller_id: controllerId,
      items: [
        {
          id: 77,
          name: 'Target',
          host: 'target.test',
          port: 22,
          username: 'operator',
          host_fingerprint: pin,
          ssh_security_revision: 1
        }
      ],
      has_more: false,
      next_after_id: null
    }),
    registerProject: async (_binding, request) => ({
      state: 'registered',
      controller_id: controllerId,
      request_key: request.request_key,
      app_id: 42,
      target_vps_id: 77,
      host_port: 30000,
      ownership_generation: 1,
      source_generation: 1,
      source_config_sha256: hash,
      auto_deploy_paused: true,
      target_enrollment: 'required',
      runtime_preflight: 'required',
      source_verification: 'required'
    })
  } as Pick<
    DesktopControllerEnrollment,
    'projectTargets' | 'registerProject'
  > as ConstructorParameters<typeof DesktopProjectSetups>[2])
  const prepared = await projects.prepare({
    binding_id: bindingId,
    target_vps_id: 77,
    app_name: 'env-ui',
    framework: 'nextjs',
    repository_url: 'https://github.com/example/app',
    production_ref: 'main',
    repository_root: '.',
    host_port: 30000,
    container_port: 3000,
    healthcheck_path: '/'
  })
  await projects.send(prepared.request_key)
  const repo = new ProductEnvironmentRepository(remote, remoteCipher),
    behavior = { lost: false, failBefore: false }
  const admin: Pick<
    DesktopControllerEnrollment,
    'environmentContext' | 'environmentState' | 'stageEnvironment'
  > = {
    environmentContext: async (_binding, request) =>
      repo.context(request, controllerId, 'unix:1000'),
    environmentState: async (_binding, request) => repo.state(request, controllerId, 'unix:1000'),
    stageEnvironment: async (_binding, request, guard) => {
      guard()
      if (behavior.failBefore) throw Error('SYNTHETIC_TRANSPORT_FAILURE')
      const result = repo.stage(request, controllerId, 'unix:1000')
      if (behavior.lost) {
        behavior.lost = false
        throw Error('SYNTHETIC_LOST_REPLY')
      }
      return result
    }
  }
  return {
    db,
    remote,
    cipher,
    vault,
    projects,
    repo,
    admin,
    behavior,
    controllerId,
    bindingId,
    projectKey: prepared.request_key,
    main: new DesktopProductEnvironment(db, cipher, vault, projects, admin)
  }
}
