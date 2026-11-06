import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import {
  PRODUCT_TARGET_ENROLLMENT_DOMAIN,
  type ProductTargetEnrollmentPayload
} from '../../../../docs/contracts/product-target-enrollment'
import { canonicalH2Json } from './productH2Proof'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { makeTargetEnrollmentPayload, verifyTargetEnrollmentProof } from './targetEnrollmentProof'
import { readEnrolledProductTarget } from './targetEnrollment'
import { loadControllerRuntimeKey } from './controllerRuntimeKeys'

vi.mock('./controllerRuntimeKeys', async (original) => ({
  ...(await original<typeof import('./controllerRuntimeKeys')>()),
  loadControllerRuntimeKey: vi.fn()
}))
let directory: string
let database: ReturnType<typeof initializeDatabase>
let repository: TargetEnrollmentRepository
let payload: ProductTargetEnrollmentPayload
let key: Buffer
function syntheticProof(value = payload): {
  payload: ProductTargetEnrollmentPayload
  signature: string
} {
  return {
    payload: value,
    signature: createHmac('sha256', key)
      .update(PRODUCT_TARGET_ENROLLMENT_DOMAIN + '\n')
      .update(canonicalH2Json(value))
      .digest('hex')
  }
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-enroll-sql-'))
  database = initializeDatabase(directory)
  const config = createHash('sha256').update('{}').digest('hex')
  database.exec(`INSERT INTO vps (id,name,host,host_fingerprint,username,auth_type,encrypted_secret)
    VALUES (1,'unit','target.test','SHA256:${'A'.repeat(43)}','deploy','key',X'00');
    INSERT INTO product_controller VALUES ('test-controller','2026-11-06T00:00:00Z','active');
    INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
    VALUES(1,1,'unit-app','express',30000,3000,'git','https://github.com/demo/app','main','.');
    INSERT INTO product_source_config(app_id,source_generation,repository_url,production_ref,repository_root,
      deploy_config_json,config_sha256,created_at) VALUES(1,1,'https://github.com/demo/app','main','.','{}','${config}','2026-11-06T00:00:00Z');
    INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,
      source_config_sha256,changed_at,auto_deploy_paused,pause_reason,pause_policy_provenance)
    VALUES(1,'product','test-controller',1,1,'${config}','2026-11-06T00:00:00Z',1,'operator','explicit')`)
  repository = new TargetEnrollmentRepository(database)
  payload = makeTargetEnrollmentPayload(
    'test-controller',
    1,
    1,
    repository.target('test-controller', 1, 1, true),
    'a'.repeat(64),
    '/var/lib/unit-targets'
  )
  key = randomBytes(32)
  vi.mocked(loadControllerRuntimeKey).mockImplementation(() => Buffer.from(key))
})
afterEach(() => {
  key.fill(0)
  closeDatabase()
  rmSync(directory, { recursive: true })
})

describe('Durable Product target enrollment', () => {
  it('inspects retained material while unpaused without reopening first-install authority', () => {
    const create = vi.fn()
    repository.prepare(payload, create)
    database.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
    expect(() => repository.begin(payload)).toThrow('TARGET_ENROLLMENT_REQUIRES_QUIESCENCE')
    expect(repository.begin(payload, true).operation).toBe('inspect')
    repository.complete(payload, syntheticProof(), key, true)
    expect(repository.get(payload)?.state).toBe('enrolled')
    expect(create).toHaveBeenCalledOnce()
    expect(() => repository.prepare(payload, create)).toThrow(
      'TARGET_ENROLLMENT_REQUIRES_QUIESCENCE'
    )
  })
  it('creates material once, commits unknown before transport, and never rearms on replay', () => {
    const create = vi.fn()
    expect(repository.prepare(payload, create).state).toBe('prepared')
    const dispatch = repository.begin(payload)
    expect(dispatch.operation).toBe('enroll')
    expect(repository.get(payload)?.state).toBe('unknown')
    repository.prepare(payload, create)
    expect(create).toHaveBeenCalledOnce()
    expect(repository.begin(payload).operation).toBe('inspect')
    expect(database.prepare('SELECT COUNT(*) AS n FROM deployment').get()).toEqual({ n: 0 })
  })

  it('does not prepare or mutate material for unpaused/foreign ownership', () => {
    const create = vi.fn()
    database.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
    expect(() => repository.prepare(payload, create)).toThrow(
      'TARGET_ENROLLMENT_REQUIRES_QUIESCENCE'
    )
    expect(() => repository.target('foreign-controller', 1, 1, false)).toThrow(
      'TARGET_ENROLLMENT_AUTHORITY_REJECTED'
    )
    expect(create).not.toHaveBeenCalled()
    expect(repository.get(payload)).toBeUndefined()
  })

  it('rejects changed binding/release/path on prepare without replacing existing material', () => {
    repository.prepare(payload, () => {})
    for (const changed of [
      { ...payload, manifest_sha256: 'b'.repeat(64) },
      { ...payload, target_root: '/var/lib/other' }
    ])
      expect(() =>
        repository.prepare(changed, () => {
          throw new Error('MUST_NOT_CREATE')
        })
      ).toThrow('TARGET_ENROLLMENT_CONFLICT')
    expect(repository.get(payload)?.manifest_sha256).toBe(payload.manifest_sha256)
  })

  it('rolls back preparation on material failure and preserves caller transaction', () => {
    expect(() =>
      repository.prepare(payload, () => {
        throw new Error('SYNTHETIC_MATERIAL_FAILURE')
      })
    ).toThrow('SYNTHETIC_MATERIAL_FAILURE')
    expect(repository.get(payload)).toBeUndefined()
    database.exec('BEGIN IMMEDIATE')
    expect(() => repository.prepare(payload, () => {})).toThrow(
      'TARGET_ENROLLMENT_TRANSACTION_ACTIVE'
    )
    expect(database.inTransaction).toBe(true)
    database.exec('ROLLBACK')
  })

  it('accepts only exact domain/key/identity proof after unknown dispatch', () => {
    repository.prepare(payload, () => {})
    expect(() => repository.complete(payload, syntheticProof(), key)).toThrow(
      'TARGET_ENROLLMENT_NOT_PREPARED'
    )
    repository.begin(payload)
    for (const invalid of [
      { ...syntheticProof(), signature: '0'.repeat(64) },
      syntheticProof({ ...payload, app_id: 2 }),
      { ...syntheticProof(), extra: 'unexpected' }
    ])
      expect(() => repository.complete(payload, invalid, key)).toThrow(
        'TARGET_ENROLLMENT_PROOF_REJECTED'
      )
    repository.complete(payload, syntheticProof(), key)
    expect(repository.get(payload)?.state).toBe('enrolled')
    expect(verifyTargetEnrollmentProof(payload, syntheticProof(), randomBytes(32))).toBe(false)
  })

  it('rejects profile drift between SSH and SQLite completion', () => {
    repository.prepare(payload, () => {})
    repository.begin(payload)
    database.exec('UPDATE vps SET ssh_security_revision=2')
    expect(() => repository.complete(payload, syntheticProof(), key)).toThrow(
      'TARGET_ENROLLMENT_AUTHORITY_REJECTED'
    )
    expect(repository.get(payload)?.state).toBe('unknown')
  })

  it('does not let an old transport failure invalidate a newer verified completion', () => {
    repository.prepare(payload, () => {})
    const started = repository.begin(payload)
    repository.complete(payload, syntheticProof(), key)
    repository.failed(started.row)
    expect(repository.get(payload)?.state).toBe('enrolled')
    expect(repository.get(payload)?.last_error_code).toBeNull()
    expect(repository.begin(payload).operation).toBe('inspect')
  })

  it('read-ready proof checks current SQLite identity and exact historical key without writes', () => {
    repository.prepare(payload, () => {})
    repository.begin(payload)
    repository.complete(payload, syntheticProof(), key)
    const before = database.prepare('SELECT total_changes() AS n').get()
    expect(
      readEnrolledProductTarget(
        database,
        directory,
        'test-controller',
        1,
        1,
        payload.manifest_sha256
      )
    ).toEqual(payload)
    expect(database.prepare('SELECT total_changes() AS n').get()).toEqual(before)
    database.exec("UPDATE vps SET archived_at='2026-11-06T00:00:00Z'")
    expect(() =>
      readEnrolledProductTarget(
        database,
        directory,
        'test-controller',
        1,
        1,
        payload.manifest_sha256
      )
    ).toThrow('TARGET_ENROLLMENT_AUTHORITY_REJECTED')
  })
})
