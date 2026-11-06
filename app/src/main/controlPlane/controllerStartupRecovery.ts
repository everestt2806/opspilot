import type Database from 'better-sqlite3'
import {
  PRODUCT_STARTUP_MAX_RECORDS,
  type ProductStartupRecoveryReport
} from '../../../../docs/contracts/product-controller-readiness'
import { SshManager } from '../ssh/manager'
import type { VerifiedControllerBundle } from './controllerBundle'
import { createControllerSshResolver } from './controllerSshResolver'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { makeTargetEnrollmentPayload } from './targetEnrollmentProof'
import { inspectStoredProductTarget, readEnrolledProductTarget } from './targetEnrollment'
import { observeProductTarget } from './controllerTargetProbe'
import { openControllerRuntimeRepository } from './controllerRuntimeExecutor'
import { recoverProductRuntimeTerminal } from './productRuntimePipeline'

type Identity = { app_id: number; ownership_generation: number }
type Pending = Identity & { attempt_id: string; has_terminal: number }

/** Startup không tái chạy pipeline. Chỉ exact T1 đã ký mới được trao attestation để settle T2. */
export class ControllerStartupRecovery {
  private ready = false
  constructor(
    private readonly database: Database.Database,
    private readonly directory: string,
    private readonly controllerId: string,
    private readonly bundle: VerifiedControllerBundle
  ) {}

  isReady(): boolean {
    return this.ready
  }

  async run(signal: AbortSignal): Promise<ProductStartupRecoveryReport> {
    this.ready = false
    const blockers: ProductStartupRecoveryReport['blockers'][number][] = []
    let inspected = 0,
      recovered = 0
    const report = (): ProductStartupRecoveryReport => ({
      state: signal.aborted ? 'aborted' : blockers.length ? 'reconciliation_required' : 'ready',
      inspected_enrollments: inspected,
      recovered_terminals: recovered,
      blockers
    })
    const ssh = new SshManager(
      createControllerSshResolver(this.database, this.controllerId, this.directory)
    )
    try {
      const controller = this.database
        .prepare("SELECT 1 FROM product_controller WHERE controller_id=? AND status='active'")
        .get(this.controllerId)
      if (!controller) throw new Error('STARTUP_AUTHORITY_REJECTED')
      const owners = this.database
        .prepare(
          `SELECT c.app_id,c.ownership_generation,c.auto_deploy_paused,
        e.state AS enrollment_state FROM product_app_control c LEFT JOIN product_target_enrollment e
        ON e.controller_id=c.controller_id AND e.app_id=c.app_id AND e.ownership_generation=c.ownership_generation
        WHERE c.controller_id=? AND c.mode='product' ORDER BY c.app_id LIMIT ?`
        )
        .all(this.controllerId, PRODUCT_STARTUP_MAX_RECORDS + 1) as (Identity & {
        auto_deploy_paused: number
        enrollment_state: string | null
      })[]
      const pending = this.database
        .prepare(
          `SELECT a.attempt_id,j.app_id,j.ownership_generation,
        CASE WHEN t.attempt_id IS NULL THEN 0 ELSE 1 END AS has_terminal
        FROM product_deploy_attempt a JOIN product_deploy_job j ON j.job_id=a.job_id
        LEFT JOIN product_runtime_terminal t ON t.attempt_id=a.attempt_id
        WHERE j.controller_id=? AND ((t.attempt_id IS NOT NULL AND t.leases_released_at IS NULL)
          OR (t.attempt_id IS NULL AND a.remote_outcome='unknown')) ORDER BY a.started_at,a.attempt_id LIMIT ?`
        )
        .all(this.controllerId, PRODUCT_STARTUP_MAX_RECORDS + 1) as Pending[]
      if (owners.length + pending.length > PRODUCT_STARTUP_MAX_RECORDS) {
        blockers.push({ app_id: null, attempt_id: null, reason: 'scan_limit' })
        return report()
      }
      const enrolled = new Set<string>()
      const repository = new TargetEnrollmentRepository(this.database)
      for (const owner of owners) {
        if (signal.aborted) return report()
        // Paused, never-enrolled app without pending runtime is an operator draft, not runnable work.
        if (
          owner.auto_deploy_paused &&
          !owner.enrollment_state &&
          !pending.some((p) => p.app_id === owner.app_id)
        )
          continue
        try {
          const row = repository.get({ controller_id: this.controllerId, ...owner })
          if (!row) throw new Error('TARGET_NOT_ENROLLED')
          const payload = makeTargetEnrollmentPayload(
            this.controllerId,
            owner.app_id,
            owner.ownership_generation,
            repository.target(this.controllerId, owner.app_id, owner.ownership_generation, false),
            row.manifest_sha256,
            row.target_root
          )
          const observed = await observeProductTarget(
            this.database,
            this.controllerId,
            payload,
            ssh,
            false,
            signal
          )
          const result = await inspectStoredProductTarget(
            this.database,
            this.directory,
            this.controllerId,
            owner.app_id,
            owner.ownership_generation,
            this.bundle,
            observed.manifest,
            signal
          )
          if (result.state !== 'enrolled') throw new Error('TARGET_NOT_ENROLLED')
          inspected++
          enrolled.add(`${owner.app_id}:${owner.ownership_generation}`)
        } catch {
          blockers.push({ app_id: owner.app_id, attempt_id: null, reason: 'enrollment_not_ready' })
        }
      }
      for (const attempt of pending) {
        if (signal.aborted) return report()
        if (!attempt.has_terminal) {
          blockers.push({
            app_id: attempt.app_id,
            attempt_id: attempt.attempt_id,
            reason: 'preterminal_unknown'
          })
          continue
        }
        try {
          if (!enrolled.has(`${attempt.app_id}:${attempt.ownership_generation}`))
            throw new Error('TARGET_NOT_ENROLLED')
          const row = repository.get({ controller_id: this.controllerId, ...attempt })!
          const target = readEnrolledProductTarget(
            this.database,
            this.directory,
            this.controllerId,
            attempt.app_id,
            attempt.ownership_generation,
            row.manifest_sha256
          )
          const runtime = openControllerRuntimeRepository(this.database, this.directory, {
            controller_id: this.controllerId,
            ...attempt
          })
          await recoverProductRuntimeTerminal(runtime, ssh, attempt.attempt_id, {
            vps_id: target.target.vps_id,
            target_helper_path: target.helper_path,
            target_state_root: target.state_root,
            signal
          })
          recovered++
        } catch {
          blockers.push({
            app_id: attempt.app_id,
            attempt_id: attempt.attempt_id,
            reason: 'terminal_not_settled'
          })
        }
      }
      this.ready = !signal.aborted && blockers.length === 0
      return report()
    } catch {
      blockers.push({ app_id: null, attempt_id: null, reason: 'authority_unavailable' })
      return report()
    } finally {
      await ssh.disconnectAll()
    }
  }
}
