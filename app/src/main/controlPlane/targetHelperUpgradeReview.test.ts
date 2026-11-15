import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { SshManager } from '../ssh/manager'
import { loadControllerRuntimeKey } from './controllerRuntimeKeys'
import { readVerifiedControllerBundleFile, verifyControllerBundle } from './controllerBundle'
import { exchangeProductBootstrapJson } from './targetEnrollment'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { makeTargetEnrollmentPayload } from './targetEnrollmentProof'
import { canonicalH2Json } from './productH2Proof'
import {
  PRODUCT_TARGET_ENROLLMENT_DOMAIN,
  type ProductTargetEnrollmentPayload
} from '../../../../docs/contracts/product-target-enrollment'
import {
  CONTROLLER_ENVIRONMENT_ASSET_TRANSITION,
  CONTROLLER_SPA_ASSET_TRANSITION
} from './controllerUpgradeAssets'
import { reviewProductTargetHelperUpgrade } from './targetHelperUpgradeReview'
vi.mock('./controllerRuntimeKeys', async (original) => ({
  ...(await original<typeof import('./controllerRuntimeKeys')>()),
  loadControllerRuntimeKey: vi.fn()
}))
vi.mock('./controllerBundle', () => ({
  verifyControllerBundle: vi.fn(),
  readVerifiedControllerBundleFile: vi.fn()
}))
vi.mock('./targetEnrollment', async (original) => ({
  ...(await original<typeof import('./targetEnrollment')>()),
  exchangeProductBootstrapJson: vi.fn()
}))
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const current = new Map(
  ['target_execution_guard.py', 'target_guarded_ssh_helper.py', 'target_product_runtime.py'].map(
    (name) => [
      `target-helper/${name}`,
      Buffer.from(readFileSync(join(import.meta.dirname, name), 'utf8').replace(/\r\n/g, '\n'))
    ]
  )
)
let directory: string
let database: ReturnType<typeof initializeDatabase>
let key: Buffer
let payload: ProductTargetEnrollmentPayload
let input: {
  format: 1
  controller_id: string
  app_id: number
  ownership_generation: number
  artifact: string
  manifest_sha256: string
  retained_manifest: string
}
let loaded: Buffer[]
const destroy = vi.fn()
const disconnect = vi.fn(async () => {})
const open = vi.fn()
function proof(value = payload): unknown {
  return {
    payload: value,
    signature: createHmac('sha256', key)
      .update(PRODUCT_TARGET_ENROLLMENT_DOMAIN + '\n')
      .update(canonicalH2Json(value))
      .digest('hex')
  }
}
function install(
  framework = 'express',
  legacy: { size: number; sha256: string } = CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0].before
): void {
  database.prepare('UPDATE app SET framework=? WHERE id=1').run(framework)
  const entries = [...current].map(([path, bytes]) => ({
    path,
    size: bytes.length,
    sha256: hash(bytes)
  }))
  Object.assign(
    entries.find((file) => file.path.endsWith('/target_product_runtime.py'))!,
    legacy
  )
  input.retained_manifest = JSON.stringify({
    format: 1,
    node_major: 22,
    entrypoint: 'control-plane.cjs',
    files: entries
  })
  payload = makeTargetEnrollmentPayload(
    'test-controller',
    1,
    1,
    new TargetEnrollmentRepository(database).target('test-controller', 1, 1, true),
    hash(input.retained_manifest),
    '/var/lib/unit-targets'
  )
  database
    .prepare(
      `INSERT OR REPLACE INTO product_target_enrollment
    (controller_id,app_id,ownership_generation,target_binding_json,manifest_sha256,target_root,state,receipt_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'enrolled',?,'now','now')`
    )
    .run(
      payload.controller_id,
      1,
      1,
      canonicalH2Json(payload.target),
      payload.manifest_sha256,
      payload.target_root,
      canonicalH2Json(proof())
    )
}
function insertJob(state = 'succeeded'): void {
  database
    .prepare(
      `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
    trigger,idempotency_key,ref,target_sha,state,available_at,created_at,updated_at)
    SELECT 'job','test-controller',1,1,1,config_sha256,'manual_redeploy','unit','main',?,?,'now','now','now'
    FROM product_source_config WHERE app_id=1`
    )
    .run('a'.repeat(40), state)
}
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'opspilot-helper-review-'))
  database = initializeDatabase(directory)
  const config = hash('{}')
  database.exec(`INSERT INTO vps(id,name,host,host_fingerprint,username,auth_type,encrypted_secret)
    VALUES(1,'unit','target.test','SHA256:${'A'.repeat(43)}','deploy','key',X'00');
    INSERT INTO product_controller VALUES('test-controller','now','active');
    INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
    VALUES(1,1,'unit-app','express',30000,3000,'git','https://github.com/demo/app','main','.');
    INSERT INTO product_source_config(app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at)
    VALUES(1,1,'https://github.com/demo/app','main','.','{}','${config}','now');
    INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,auto_deploy_paused,pause_reason,pause_policy_provenance)
    VALUES(1,'product','test-controller',1,1,'${config}','now',1,'operator','explicit');`)
  key = randomBytes(32)
  loaded = []
  vi.mocked(loadControllerRuntimeKey).mockImplementation(() => {
    const copy = Buffer.from(key)
    loaded.push(copy)
    return copy
  })
  input = {
    format: 1,
    controller_id: 'test-controller',
    app_id: 1,
    ownership_generation: 1,
    artifact: '/unit/control-plane.cjs',
    manifest_sha256: 'b'.repeat(64),
    retained_manifest: ''
  }
  install()
  vi.mocked(verifyControllerBundle).mockReturnValue({
    state: 'bundle_verified',
    manifest_sha256: input.manifest_sha256
  } as never)
  vi.mocked(readVerifiedControllerBundleFile).mockImplementation((_bundle, path) =>
    path.endsWith('/target_enrollment.py')
      ? Buffer.from('trusted synthetic inspect')
      : Buffer.from(current.get(path)!)
  )
  open.mockResolvedValue({
    channel: { destroy },
    identity: {
      vpsId: 1,
      host: 'target.test',
      port: 22,
      username: 'deploy',
      authType: 'key',
      hostFingerprint: payload.target.host_fingerprint
    }
  })
  vi.spyOn(SshManager.prototype, 'openProductBootstrapChannel').mockImplementation(open)
  vi.spyOn(SshManager.prototype, 'disconnectAll').mockImplementation(disconnect)
  vi.mocked(exchangeProductBootstrapJson).mockImplementation(async () => ({
    state: 'enrolled',
    proof: proof()
  }))
})
afterEach(() => {
  for (const copy of loaded) expect(copy.equals(Buffer.alloc(32))).toBe(true)
  key.fill(0)
  closeDatabase()
  rmSync(directory, { recursive: true })
  vi.restoreAllMocks()
})
const review = (): ReturnType<typeof reviewProductTargetHelperUpgrade> =>
  reviewProductTargetHelperUpgrade(database, directory, 'test-controller', input)
describe('Retained helper upgrade read-only review', () => {
  it.each(['activation', 'experiment', 'unknown-attempt', 'unsettled-runtime'])(
    'rejects %s even when the deploy job is terminal',
    async (kind) => {
      database.exec(
        "INSERT INTO deployment(id,app_id,version,image_tag,status) VALUES(1,1,1,'unit:v1','running')"
      )
      if (kind === 'activation')
        database.exec(
          "INSERT INTO deployment_activation(app_id,deployment_id,stream_generation,start_offset,reason,state) VALUES(1,1,'unit',1,'deploy','prepared')"
        )
      else if (kind === 'experiment')
        database.exec(
          "INSERT INTO experiment_run(scenario,repeat_index,deployment_id,vps_id) VALUES('cpu_spike',1,1,1)"
        )
      else {
        insertJob('failed')
        database.exec(`INSERT INTO product_app_fence VALUES(1,1);
          INSERT INTO product_app_lease VALUES(1,'app-lease','test-controller',1,1,'job','now','now','now','now');
          INSERT INTO product_worker_lease VALUES('build','build-lease','test-controller',1,'job','now','now','now','now');
          INSERT INTO product_deploy_attempt(attempt_id,job_id,attempt_number,lease_id,fencing_token,build_slot_lease_id,build_slot_fence,state,remote_outcome,started_at)
          VALUES('attempt','job',1,'app-lease',1,'build-lease',1,'failed','${kind === 'unknown-attempt' ? 'unknown' : 'applied'}','now');`)
        if (kind === 'unsettled-runtime')
          database.exec(
            `INSERT INTO product_runtime_execution(attempt_id,deployment_id,context_json,context_sha256,created_at) VALUES('attempt',1,'{}','${'a'.repeat(64)}','now')`
          )
      }
      await expect(review()).rejects.toThrow('QUIESCENCE')
      expect(open).not.toHaveBeenCalled()
    }
  )
  it.each(['express', 'static-spa', 'nextjs'])(
    'authenticates %s bytes without SQL writes or granting apply',
    async (framework) => {
      install(framework)
      const before = database.prepare('SELECT * FROM product_target_enrollment').get()
      database.pragma('query_only=ON')
      const result = await review()
      expect(result).toMatchObject({
        purpose: 'product-target-helper-upgrade-review',
        apply_available: false,
        changes: [
          {
            path: 'target-helper/target_product_runtime.py',
            before: CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0].before,
            after: CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0].after
          }
        ]
      })
      expect(database.prepare('SELECT * FROM product_target_enrollment').get()).toEqual(before)
      expect(JSON.parse(vi.mocked(exchangeProductBootstrapJson).mock.calls[0][1])).toMatchObject({
        operation: 'inspect',
        helpers: {},
        manifest: input.retained_manifest
      })
      expect(JSON.stringify(result)).not.toContain(key.toString('base64'))
      expect(JSON.stringify(result)).not.toContain((proof() as { signature: string }).signature)
      expect(destroy).toHaveBeenCalledOnce()
      expect(disconnect).toHaveBeenCalledOnce()
    }
  )
  it('permits oldest Express helper and rejects that helper for SPA', async () => {
    install('express', CONTROLLER_SPA_ASSET_TRANSITION[0].before)
    await expect(review()).resolves.toMatchObject({ apply_available: false })
    install('static-spa', CONTROLLER_SPA_ASSET_TRANSITION[0].before)
    await expect(review()).rejects.toThrow('TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED')
    expect(open).toHaveBeenCalledOnce()
  })
  it('rejects a retained manifest with the wrong SQL pin before SSH', async () => {
    input.retained_manifest += ' '
    await expect(review()).rejects.toThrow('RETAINED_PIN_MISMATCH')
    expect(open).not.toHaveBeenCalled()
  })
  it.each(['current', 'unknown', 'guard'])(
    'rejects %s helper transition before SSH',
    async (kind) => {
      const manifest = JSON.parse(input.retained_manifest)
      const entry = manifest.files.find((file: { path: string }) =>
        file.path.endsWith(
          kind === 'guard' ? '/target_execution_guard.py' : '/target_product_runtime.py'
        )
      )
      Object.assign(
        entry,
        kind === 'current'
          ? CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0].after
          : { sha256: 'c'.repeat(64) }
      )
      input.retained_manifest = JSON.stringify(manifest)
      payload = { ...payload, manifest_sha256: hash(input.retained_manifest) }
      database
        .prepare('UPDATE product_target_enrollment SET manifest_sha256=?,receipt_json=?')
        .run(payload.manifest_sha256, canonicalH2Json(proof()))
      await expect(review()).rejects.toThrow(/(TRANSITION_REJECTED|HELPER_UPGRADE_REQUIRED)/)
      expect(open).not.toHaveBeenCalled()
    }
  )
  it.each(['unpaused', 'queued', 'worker', 'unknown-enrollment'])(
    'rejects %s authority before SSH',
    async (kind) => {
      if (kind === 'unpaused')
        database.exec(
          "UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL,pause_policy_provenance='explicit'"
        )
      else if (kind === 'queued') insertJob('queued')
      else if (kind === 'worker') {
        insertJob()
        database.exec(
          "INSERT INTO product_worker_lease VALUES('build','worker','test-controller',1,'job','now','now','now',NULL)"
        )
      } else database.exec("UPDATE product_target_enrollment SET state='unknown'")
      await expect(review()).rejects.toThrow(/(QUIESCENCE|NOT_READY)/)
      expect(open).not.toHaveBeenCalled()
    }
  )
  it('rejects persisted HMAC tamper before SSH', async () => {
    database
      .prepare('UPDATE product_target_enrollment SET receipt_json=?')
      .run(JSON.stringify({ payload, signature: '0'.repeat(64) }))
    await expect(review()).rejects.toThrow('PROOF_REJECTED')
    expect(open).not.toHaveBeenCalled()
  })
  it('rejects remote proof tamper and cleans up', async () => {
    vi.mocked(exchangeProductBootstrapJson).mockResolvedValue({
      state: 'enrolled',
      proof: { payload, signature: '0'.repeat(64) }
    })
    await expect(review()).rejects.toThrow('REMOTE_PROOF_REJECTED')
    expect(destroy).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it.each(['before-packet', 'after-proof'])('rejects authority race %s', async (when) => {
    const drift = (): void => {
      database.exec('UPDATE product_target_enrollment SET revision=revision+1')
    }
    if (when === 'before-packet') {
      const result = await open()
      open.mockImplementation(async () => {
        drift()
        return result
      })
      open.mockClear()
    } else
      vi.mocked(exchangeProductBootstrapJson).mockImplementation(async () => {
        drift()
        return { state: 'enrolled', proof: proof() }
      })
    await expect(review()).rejects.toThrow('AUTHORITY_CHANGED')
    expect(destroy).toHaveBeenCalledOnce()
    if (when === 'before-packet') expect(exchangeProductBootstrapJson).not.toHaveBeenCalled()
  })
  it('does not leak raw remote exceptions', async () => {
    vi.mocked(exchangeProductBootstrapJson).mockRejectedValue(Error('SYNTHETIC_SECRET_STDERR'))
    await expect(review()).rejects.toThrow('TARGET_HELPER_REVIEW_REMOTE_UNKNOWN')
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it('rejects invalid input, wrong controller and cancellation before bundle or SSH', async () => {
    await expect(
      reviewProductTargetHelperUpgrade(database, directory, 'other', input)
    ).rejects.toThrow('INPUT_INVALID')
    await expect(
      reviewProductTargetHelperUpgrade(database, directory, 'test-controller', {
        ...input,
        extra: true
      })
    ).rejects.toThrow('INPUT_INVALID')
    await expect(
      reviewProductTargetHelperUpgrade(
        database,
        directory,
        'test-controller',
        input,
        AbortSignal.abort()
      )
    ).rejects.toThrow('ABORTED')
    expect(verifyControllerBundle).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })
})
