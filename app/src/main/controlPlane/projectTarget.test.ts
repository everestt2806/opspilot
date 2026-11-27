import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { AppRepository } from '../db/appRepository'
import { canonicalH2Json } from './productH2Proof'
import { enrollProductTarget, readEnrolledProductTarget } from './targetEnrollment'
import { verifyControllerBundle } from './controllerBundle'
import { readProjectTargetState, enrollProjectTarget } from './projectTarget'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { makeTargetEnrollmentPayload } from './targetEnrollmentProof'
import type { ProductProjectTargetEnrollmentInput } from '../../../../docs/contracts/product-project-target'
vi.mock('./controllerBundle', () => ({ verifyControllerBundle: vi.fn() }))
vi.mock('./targetEnrollment', async (original) => ({
  ...(await original<typeof import('./targetEnrollment')>()),
  enrollProductTarget: vi.fn(),
  readEnrolledProductTarget: vi.fn()
}))
let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  input: ProductProjectTargetEnrollmentInput
const read = (): ReturnType<typeof readProjectTargetState> => {
  const value = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'target_root'))
  return readProjectTargetState(db, 'controller-test', directory, value)
}
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'opspilot-project-target-'))
  db = initializeDatabase(directory)
  db.prepare("INSERT INTO product_controller VALUES('controller-test',?,'active')").run(
    new Date().toISOString()
  )
  db.prepare(
    "INSERT INTO vps(id,name,host,username,auth_type,host_fingerprint,encrypted_secret) VALUES(1,'target','target.test','root','key',?,X'0102')"
  ).run('SHA256:' + 'A'.repeat(43))
  new AppRepository(db).create({
    vps_id: 1,
    name: 'target-api',
    framework: 'express',
    source_path: null,
    source_type: 'git',
    git_repo_url: 'https://github.com/example/api.git',
    git_ref: 'main',
    git_root: '.',
    host_port: 30000,
    container_port: 3000,
    healthcheck_path: '/health',
    needs_db: 0
  })
  const config = canonicalH2Json({
      framework: 'express',
      host_port: 30000,
      container_port: 3000,
      healthcheck_path: '/health',
      needs_db: false
    }),
    hash = createHash('sha256').update(config).digest('hex')
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://github.com/example/api.git','main','.',?,?,?)"
  ).run(config, hash, new Date().toISOString())
  db.prepare(
    "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,auto_deploy_paused,pause_reason,pause_policy_provenance) VALUES(1,'product','controller-test',1,1,?,?,1,'operator','explicit')"
  ).run(hash, new Date().toISOString())
  input = {
    format: 1,
    controller_id: 'controller-test',
    app_id: 1,
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    expected_source_config_sha256: hash,
    expected_target_security_revision: 1,
    artifact: '/approved/control-plane.cjs',
    manifest_sha256: 'b'.repeat(64),
    target_root: '/var/lib/test-product'
  }
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
})
describe('Project target wrappers', () => {
  it('reads missing state without creating keys, rows, work or remote mutations', () => {
    const before = db.prepare('SELECT total_changes() AS n').get()
    expect(read()).toMatchObject({
      state: 'not_prepared',
      proof: 'not_available',
      target_host: 'target.test',
      target_root: '/var/lib/opspilot-product',
      deployment_started: false,
      runtime_preflight: 'required'
    })
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before)
    expect(enrollProductTarget).not.toHaveBeenCalled()
    expect(readEnrolledProductTarget).not.toHaveBeenCalled()
    expect(verifyControllerBundle).toHaveBeenCalledWith(input.artifact, input.manifest_sha256)
  })
  it('uses existing installer and keeps unknown enrollment for explicit inspect recovery', async () => {
    vi.mocked(enrollProductTarget).mockImplementationOnce(
      async (_db, _controller, _directory, _input, _signal, guard) => {
        guard!()
        const repo = new TargetEnrollmentRepository(db),
          payload = makeTargetEnrollmentPayload(
            'controller-test',
            1,
            1,
            repo.target('controller-test', 1, 1, true),
            input.manifest_sha256,
            input.target_root
          )
        repo.prepare(payload, () => {}, guard)
        repo.begin(payload, false, guard)
        return { state: 'unknown', app_id: 1, ownership_generation: 1 }
      }
    )
    expect(await enrollProjectTarget(db, 'controller-test', directory, input)).toMatchObject({
      state: 'unknown',
      proof: 'not_available',
      target_root: input.target_root
    })
    expect(enrollProductTarget).toHaveBeenCalledWith(
      db,
      'controller-test',
      directory,
      expect.objectContaining({ target_root: input.target_root, app_id: 1 }),
      undefined,
      expect.any(Function)
    )
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_deploy_job').get()).toEqual({ n: 0 })
    await expect(
      enrollProjectTarget(db, 'controller-test', directory, {
        ...input,
        target_root: '/other/root'
      })
    ).rejects.toThrow('PROJECT_TARGET_CONFLICT')
    expect(enrollProductTarget).toHaveBeenCalledOnce()
  })
  it('rejects config/target changes after awaiting installer and guards inside its transaction', async () => {
    vi.mocked(enrollProductTarget).mockImplementationOnce(
      async (_db, _controller, _directory, _input, _signal, guard) => {
        db.exec("UPDATE vps SET host='changed.test'")
        expect(() => db.transaction(() => guard!()).immediate()).toThrow(
          'PROJECT_TARGET_AUTHORITY_CHANGED'
        )
        return { state: 'unknown', app_id: 1, ownership_generation: 1 }
      }
    )
    await expect(enrollProjectTarget(db, 'controller-test', directory, input)).rejects.toThrow(
      'PROJECT_TARGET_AUTHORITY_CHANGED'
    )
  })
  it('requires a stored valid HMAC proof before projecting enrolled and never treats it as readiness', () => {
    const repo = new TargetEnrollmentRepository(db),
      payload = makeTargetEnrollmentPayload(
        'controller-test',
        1,
        1,
        repo.target('controller-test', 1, 1, true),
        input.manifest_sha256,
        input.target_root
      )
    repo.prepare(payload, () => {})
    repo.begin(payload)
    db.exec("UPDATE product_target_enrollment SET state='enrolled',receipt_json='{}'")
    vi.mocked(readEnrolledProductTarget).mockImplementationOnce(() => {
      throw new Error('corrupt-private-data')
    })
    expect(read()).toMatchObject({ state: 'conflict', proof: 'not_available' })
    vi.mocked(readEnrolledProductTarget).mockReturnValueOnce(payload)
    expect(read()).toMatchObject({
      state: 'enrolled',
      proof: 'persisted_verified',
      deployment_started: false,
      runtime_preflight: 'required'
    })
  })
  it.each([
    { target_root: '/' },
    { target_root: '../escape' },
    { target_root: '/var/lib/../etc' },
    { target_root: '/bad path' },
    { expected_source_generation: 2 },
    { expected_target_security_revision: 2 },
    { script: 'no' }
  ])('rejects invalid or stale review %j before installer', async (change) => {
    await expect(
      enrollProjectTarget(db, 'controller-test', directory, { ...input, ...change })
    ).rejects.toThrow()
    expect(enrollProductTarget).not.toHaveBeenCalled()
  })
})
