import type Database from 'better-sqlite3'
import type { ProductDispatchTargetBinding } from '../../../../docs/contracts/product-auto-deploy'
import type {
  ProductTargetEnrollmentPayload,
  ProductTargetEnrollmentProof
} from '../../../../docs/contracts/product-target-enrollment'
import { canonicalH2Json } from './productH2Proof'
import { verifyTargetEnrollmentProof } from './targetEnrollmentProof'

export type TargetEnrollmentRow = {
  controller_id: string
  app_id: number
  ownership_generation: number
  target_binding_json: string
  manifest_sha256: string
  target_root: string
  state: 'prepared' | 'unknown' | 'enrolled'
  revision: number
  receipt_json: string | null
  last_error_code: string | null
}

export class TargetEnrollmentRepository {
  constructor(private readonly database: Database.Database) {}

  target(
    controllerId: string,
    appId: number,
    generation: number,
    paused: boolean
  ): ProductDispatchTargetBinding {
    const row = this.database
      .prepare(
        `SELECT v.id AS vps_id,v.host,v.port,v.host_fingerprint,v.username,
      v.auth_type,v.ssh_security_revision,c.auto_deploy_paused FROM app a
      JOIN vps v ON v.id=a.vps_id AND v.archived_at IS NULL
      JOIN product_app_control c ON c.app_id=a.id AND c.mode='product'
      JOIN product_controller pc ON pc.controller_id=c.controller_id AND pc.status='active'
      JOIN product_source_config s ON s.app_id=c.app_id AND s.source_generation=c.source_generation
        AND s.config_sha256=c.source_config_sha256
      WHERE a.id=? AND c.controller_id=? AND c.ownership_generation=?`
      )
      .get(appId, controllerId, generation) as
      (ProductDispatchTargetBinding & { auto_deploy_paused: number }) | undefined
    if (
      !row ||
      !row.host_fingerprint ||
      row.host_fingerprint.length !== 50 ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(row.host_fingerprint)
    )
      throw new Error('TARGET_ENROLLMENT_AUTHORITY_REJECTED')
    if (
      paused &&
      (row.auto_deploy_paused !== 1 ||
        this.database
          .prepare(
            `SELECT 1 FROM product_deploy_job
      WHERE app_id=? AND state NOT IN ('succeeded','failed','rolled_back','superseded','cancelled') LIMIT 1`
          )
          .get(appId) ||
        this.database
          .prepare('SELECT 1 FROM product_app_lease WHERE app_id=? AND released_at IS NULL LIMIT 1')
          .get(appId) ||
        this.database
          .prepare(
            `SELECT 1 FROM product_runtime_terminal t
          JOIN product_deploy_attempt a ON a.attempt_id=t.attempt_id JOIN product_deploy_job j ON j.job_id=a.job_id
          WHERE j.app_id=? AND t.leases_released_at IS NULL LIMIT 1`
          )
          .get(appId))
    )
      throw new Error('TARGET_ENROLLMENT_REQUIRES_QUIESCENCE')
    return {
      vps_id: row.vps_id,
      host: row.host,
      port: row.port,
      username: row.username,
      auth_type: row.auth_type,
      host_fingerprint: row.host_fingerprint,
      ssh_security_revision: row.ssh_security_revision
    }
  }

  assertCurrent(payload: ProductTargetEnrollmentPayload, paused = true): void {
    if (
      canonicalH2Json(
        this.target(payload.controller_id, payload.app_id, payload.ownership_generation, paused)
      ) !== canonicalH2Json(payload.target)
    )
      throw new Error('TARGET_ENROLLMENT_AUTHORITY_REJECTED')
  }

  get(
    payload: Pick<
      ProductTargetEnrollmentPayload,
      'controller_id' | 'app_id' | 'ownership_generation'
    >
  ): TargetEnrollmentRow | undefined {
    return this.database
      .prepare(
        `SELECT * FROM product_target_enrollment
      WHERE controller_id=? AND app_id=? AND ownership_generation=?`
      )
      .get(payload.controller_id, payload.app_id, payload.ownership_generation) as
      TargetEnrollmentRow | undefined
  }

  prepare(
    payload: ProductTargetEnrollmentPayload,
    createMaterial: () => void,
    assertAuthority?: () => void
  ): TargetEnrollmentRow {
    if (this.database.inTransaction) throw new Error('TARGET_ENROLLMENT_TRANSACTION_ACTIVE')
    return this.database
      .transaction(() => {
        assertAuthority?.()
        this.assertCurrent(payload)
        const previous = this.get(payload)
        if (previous) {
          if (
            previous.target_binding_json !== canonicalH2Json(payload.target) ||
            previous.manifest_sha256 !== payload.manifest_sha256 ||
            previous.target_root !== payload.target_root
          )
            throw new Error('TARGET_ENROLLMENT_CONFLICT')
          return previous
        }
        createMaterial()
        const now = new Date().toISOString()
        this.database
          .prepare(
            `INSERT INTO product_target_enrollment
        (controller_id,app_id,ownership_generation,target_binding_json,manifest_sha256,target_root,state,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'prepared',?,?)`
          )
          .run(
            payload.controller_id,
            payload.app_id,
            payload.ownership_generation,
            canonicalH2Json(payload.target),
            payload.manifest_sha256,
            payload.target_root,
            now,
            now
          )
        return this.get(payload)!
      })
      .immediate()
  }

  begin(
    payload: ProductTargetEnrollmentPayload,
    inspectionOnly = false,
    assertAuthority?: () => void
  ): {
    row: TargetEnrollmentRow
    operation: 'enroll' | 'inspect'
  } {
    return this.database
      .transaction(() => {
        assertAuthority?.()
        this.assertCurrent(payload, !inspectionOnly)
        const row = this.get(payload)
        if (!row) throw new Error('TARGET_ENROLLMENT_NOT_PREPARED')
        if (
          row.target_binding_json !== canonicalH2Json(payload.target) ||
          row.manifest_sha256 !== payload.manifest_sha256 ||
          row.target_root !== payload.target_root
        )
          throw new Error('TARGET_ENROLLMENT_CONFLICT')
        const operation: 'enroll' | 'inspect' =
          !inspectionOnly && row.state === 'prepared' ? 'enroll' : 'inspect'
        this.database
          .prepare(
            `UPDATE product_target_enrollment
        SET state='unknown',revision=revision+1,updated_at=? WHERE controller_id=? AND app_id=? AND ownership_generation=?`
          )
          .run(
            new Date().toISOString(),
            payload.controller_id,
            payload.app_id,
            payload.ownership_generation
          )
        return { row: this.get(payload)!, operation }
      })
      .immediate()
  }

  complete(
    payload: ProductTargetEnrollmentPayload,
    proof: unknown,
    key: Buffer,
    inspectionOnly = false,
    assertAuthority?: () => void
  ): ProductTargetEnrollmentProof {
    if (!verifyTargetEnrollmentProof(payload, proof, key))
      throw new Error('TARGET_ENROLLMENT_PROOF_REJECTED')
    return this.database
      .transaction(() => {
        assertAuthority?.()
        this.assertCurrent(payload, !inspectionOnly)
        const row = this.get(payload)
        if (!row || row.state === 'prepared') throw new Error('TARGET_ENROLLMENT_NOT_PREPARED')
        if (
          row.target_binding_json !== canonicalH2Json(payload.target) ||
          row.manifest_sha256 !== payload.manifest_sha256 ||
          row.target_root !== payload.target_root
        )
          throw new Error('TARGET_ENROLLMENT_CONFLICT')
        this.database
          .prepare(
            `UPDATE product_target_enrollment SET state='enrolled',receipt_json=?,last_error_code=NULL,
        revision=revision+1,updated_at=? WHERE controller_id=? AND app_id=? AND ownership_generation=?`
          )
          .run(
            canonicalH2Json(proof),
            new Date().toISOString(),
            payload.controller_id,
            payload.app_id,
            payload.ownership_generation
          )
        return proof
      })
      .immediate()
  }

  failed(row: TargetEnrollmentRow): void {
    this.database
      .prepare(
        `UPDATE product_target_enrollment SET state='unknown',last_error_code='TARGET_ENROLLMENT_UNKNOWN',
      revision=revision+1,updated_at=? WHERE controller_id=? AND app_id=? AND ownership_generation=? AND revision=?`
      )
      .run(
        new Date().toISOString(),
        row.controller_id,
        row.app_id,
        row.ownership_generation,
        row.revision
      )
  }
}
