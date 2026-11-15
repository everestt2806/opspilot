import type Database from 'better-sqlite3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { ProductClaimToken } from '../../../docs/contracts/product-auto-deploy'
import type { H2TerminalReceipt } from '../../../docs/contracts/product-h2-runtime'
import { ProductRuntimeRepository } from '../../src/main/db/productRuntimeRepository'
import { canonicalH2Json, hashH2, signH2 } from '../../src/main/controlPlane/productH2Proof'
import { AesGcmCredentialCipher } from '../../src/main/crypto/credentialCipher'
import { ProductEnvironmentRepository } from '../../src/main/db/productEnvironmentRepository'
import { ProductEnvironmentSelection } from '../../src/main/controlPlane/productEnvironmentSelection'

/** Private test/lab DB only. Real H2 repository finalizes and settles synthetic runtime evidence. */
export function seedExposureFixture(
  db: Database.Database,
  now: number,
  targetHost = '203.0.113.10'
): { controllerId: string; settle: () => void; selectEnvironment: (revision: number) => void } {
  const controllerId = 'exposure-fixture',
    time = new Date(now).toISOString(),
    expires = new Date(now + 60000).toISOString(),
    sha = 'a'.repeat(40),
    configJson = canonicalH2Json({
      framework: 'express',
      host_port: 30000,
      container_port: 3000,
      healthcheck_path: '/health',
      needs_db: false
    }),
    config = createHash('sha256').update(configJson).digest('hex'),
    cipher = new AesGcmCredentialCipher(randomBytes(32))
  db.exec(`INSERT INTO vps(id,name,host,port,host_fingerprint,username,auth_type,encrypted_secret)
    VALUES(1,'fixture','203.0.113.10',22,'SHA256:${'A'.repeat(43)}','ops','key',X'00');
    INSERT INTO app(id,vps_id,name,framework,host_port,container_port,healthcheck_path,source_type,git_repo_url,git_ref,git_root)
    VALUES(1,1,'exposure-app','express',30000,3000,'/health','git','https://github.com/example/demo.git','main','.');
    INSERT INTO deployment(id,app_id,version,image_tag,git_commit_sha,status) VALUES(1,1,1,'exposure-app:v1','${sha}','building');`)
  db.prepare('INSERT INTO product_controller VALUES(?,?,?)').run(controllerId, time, 'active')
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://github.com/example/demo.git','main','.',?,?,?)"
  ).run(configJson, config, time)
  db.prepare(
    `INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at)
    VALUES(1,'product',?,1,1,?,?)`
  ).run(controllerId, config, time)
  db.prepare(
    `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
    trigger,idempotency_key,ref,target_sha,state,attempt_count,max_attempts,available_at,created_at,updated_at)
    VALUES('fixture-job',?,1,1,1,?,'manual_redeploy','fixture-key','main',?,'deploying',1,3,?,?,?)`
  ).run(controllerId, config, sha, time, time, time)
  db.exec('INSERT INTO product_app_fence VALUES(1,1)')
  db.prepare(
    `INSERT INTO product_app_lease(app_id,lease_id,controller_id,ownership_generation,fence,job_id,acquired_at,expires_at,heartbeat_at)
    VALUES(1,'fixture-lease',?,1,1,'fixture-job',?,?,?)`
  ).run(controllerId, time, expires, time)
  db.prepare(
    `INSERT INTO product_worker_lease(slot_name,lease_id,controller_id,fence,job_id,acquired_at,expires_at,heartbeat_at)
    VALUES('build','fixture-slot',?,1,'fixture-job',?,?,?)`
  ).run(controllerId, time, expires, time)
  db.prepare(
    `INSERT INTO product_deploy_attempt(attempt_id,job_id,attempt_number,lease_id,fencing_token,build_slot_lease_id,build_slot_fence,state,deployment_id,remote_outcome,started_at)
    VALUES('fixture-attempt','fixture-job',1,'fixture-lease',1,'fixture-slot',1,'deploying',1,'unknown',?)`
  ).run(time)
  db.prepare('UPDATE vps SET host=? WHERE id=1').run(targetHost)
  const claim: ProductClaimToken = {
    controller_id: controllerId,
    app_id: 1,
    job_id: 'fixture-job',
    attempt_id: 'fixture-attempt',
    attempt_number: 1,
    ownership_generation: 1,
    source_generation: 1,
    source_config_sha256: config,
    app_lease_id: 'fixture-lease',
    app_fence: 1,
    build_slot_lease_id: 'fixture-slot',
    build_slot_fence: 1,
    expires_at: expires
  }
  const secret = randomBytes(32),
    repository = new ProductRuntimeRepository(db, { secret, clock: () => now })
  let context = repository.createContext(claim, 1, {
    state: 'build_succeeded',
    image_tag: 'exposure-app:v1',
    image_id: `sha256:${'c'.repeat(64)}`,
    target_sha: sha
  })
  context = repository.beginActivationBarrier(context)
  const boundary = { generation: 'fixture-stream', device: 1, inode: 1, next_offset: 1 }
  repository.bindActivationBoundary(context, boundary)
  const runtime = {
    deployment_id: 1,
    image_tag: context.candidate_image_tag,
    image_id: context.candidate_image_id!,
    source_sha: sha,
    container_id: 'd'.repeat(64),
    collector_container_id: 'e'.repeat(64),
    collector_image_id: `sha256:${'f'.repeat(64)}`,
    config_sha256: '1'.repeat(64),
    health: 'healthy' as const,
    http_status: 200
  }
  const receipt: H2TerminalReceipt = {
    version: 1,
    context,
    outcome: 'succeeded',
    failed_step: null,
    active_runtime: runtime,
    candidate_runtime: runtime,
    previous_runtime: null,
    boundary,
    exposure_status: 'not_checked',
    remote_quiescent: true,
    sealed_at: time
  }
  const terminal = repository.finalize({
    receipt,
    receipt_sha256: hashH2(receipt),
    signature: signH2('receipt', receipt, secret)
  })
  return {
    controllerId,
    selectEnvironment: (revision) => {
      db.exec(
        "UPDATE product_app_control SET auto_deploy_paused=1,pause_reason='operator',pause_policy_provenance='explicit'"
      )
      const owner = db
        .prepare(
          'SELECT source_generation,source_config_sha256 FROM product_app_control WHERE app_id=1'
        )
        .get() as { source_generation: number; source_config_sha256: string }
      const target = {
          vps_id: 1,
          host: targetHost,
          port: 22,
          host_fingerprint: 'SHA256:' + 'A'.repeat(43),
          username: 'ops',
          auth_type: 'key' as const,
          ssh_security_revision: 1
        },
        scope = { controller_id: controllerId, app_id: 1, ownership_generation: 1, target }
      new ProductEnvironmentRepository(db, cipher).append({
        scope,
        expected_latest_revision: revision === 1 ? null : revision - 1,
        expected_source_generation: owner.source_generation,
        expected_source_config_sha256: owner.source_config_sha256,
        values: {
          runtime_env: { APP_TOKEN: 'SYNTHETIC_EXPOSURE_ONLY_' + revision },
          public_build_args: {}
        }
      })
      new ProductEnvironmentSelection(db, cipher).select(
        {
          format: 1,
          request_key: randomUUID(),
          scope,
          expected_source_generation: owner.source_generation,
          expected_source_config_sha256: owner.source_config_sha256,
          expected_latest_revision: revision,
          environment_revision: revision
        },
        controllerId,
        'unix:1000'
      )
    },
    settle: () => {
      const attestation = repository.commitAttestation(claim.attempt_id)
      const payload = {
        version: 1 as const,
        kind: 'product-h2-settlement' as const,
        commit_id: terminal.commit_id,
        receipt_sha256: attestation.payload.receipt_sha256,
        context_sha256: attestation.payload.context_sha256,
        execution_nonce: attestation.payload.execution_nonce,
        attempt_id: claim.attempt_id,
        deployment_id: 1,
        settled_at: time
      }
      repository.completeSettlement(context, {
        payload,
        signature: signH2('settlement', payload, secret)
      })
      secret.fill(0)
    }
  }
}
