import type Database from 'better-sqlite3'

import type { DoctorDiagnosis, DoctorEvidence } from './engine'

export type DoctorTrigger = 'deploy' | 'manual' | 'monitor' | 'domain'
export type DoctorOutcome = 'pending' | 'fixed' | 'verified' | 'failed' | 'abstained'
export type DoctorActionStatus = 'planned' | 'running' | 'success' | 'failed' | 'skipped'

export interface DoctorActionRow {
  id: number
  doctor_run_id: number
  action_type: string
  precondition_json: string | null
  result_json: string | null
  verify_json: string | null
  rollback_json: string | null
  status: DoctorActionStatus
  started_at: string
  finished_at: string | null
}

export class DoctorRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: {
    deploymentId: number | null
    trigger: DoctorTrigger
    evidence: DoctorEvidence
    diagnosis: DoctorDiagnosis
  }): number {
    const outcome: DoctorOutcome = input.diagnosis.abstained ? 'abstained' : 'pending'
    const result = this.database
      .prepare(
        `INSERT INTO doctor_run
         (deployment_id, trigger, evidence_json, diagnosis_code, confidence, selected_fix, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.deploymentId,
        input.trigger,
        JSON.stringify(input.evidence),
        input.diagnosis.code,
        input.diagnosis.confidence,
        input.diagnosis.fixId,
        outcome
      )
    return Number(result.lastInsertRowid)
  }

  finish(id: number, outcome: Exclude<DoctorOutcome, 'pending'>): void {
    this.database
      .prepare(
        `UPDATE doctor_run SET outcome = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?`
      )
      .run(outcome, id)
  }

  getRun(id: number): {
    id: number
    deployment_id: number | null
    trigger: DoctorTrigger
    evidence_json: string
    diagnosis_code: DoctorDiagnosis['code']
    confidence: DoctorDiagnosis['confidence']
    selected_fix: string | null
    outcome: DoctorOutcome
    started_at: string
    finished_at: string | null
  } | null {
    return (
      (this.database
        .prepare(
          `SELECT id, deployment_id, trigger, evidence_json, diagnosis_code, confidence, selected_fix, outcome, started_at, finished_at
           FROM doctor_run WHERE id = ?`
        )
        .get(id) as
        | {
            id: number
            deployment_id: number | null
            trigger: DoctorTrigger
            evidence_json: string
            diagnosis_code: DoctorDiagnosis['code']
            confidence: DoctorDiagnosis['confidence']
            selected_fix: string | null
            outcome: DoctorOutcome
            started_at: string
            finished_at: string | null
          }
        | undefined) ?? null
    )
  }

  latestForDeployment(deploymentId: number): {
    id: number
    diagnosis_code: DoctorDiagnosis['code']
    confidence: DoctorDiagnosis['confidence']
    selected_fix: string | null
    outcome: DoctorOutcome
    evidence_json: string
    started_at: string
  } | null {
    return (
      (this.database
        .prepare(
          `SELECT id, diagnosis_code, confidence, selected_fix, outcome, evidence_json, started_at
           FROM doctor_run WHERE deployment_id = ? ORDER BY id DESC LIMIT 1`
        )
        .get(deploymentId) as
        | {
            id: number
            diagnosis_code: DoctorDiagnosis['code']
            confidence: DoctorDiagnosis['confidence']
            selected_fix: string | null
            outcome: DoctorOutcome
            evidence_json: string
            started_at: string
          }
        | undefined) ?? null
    )
  }

  createAction(input: {
    doctorRunId: number
    actionType: string
    preconditionJson?: string | null
    status?: DoctorActionStatus
  }): number {
    const status = input.status ?? 'planned'
    const result = this.database
      .prepare(
        `INSERT INTO doctor_action
         (doctor_run_id, action_type, precondition_json, status)
         VALUES (?, ?, ?, ?)`
      )
      .run(input.doctorRunId, input.actionType, input.preconditionJson ?? null, status)
    return Number(result.lastInsertRowid)
  }

  updateAction(
    id: number,
    patch: {
      status?: DoctorActionStatus
      resultJson?: string | null
      verifyJson?: string | null
      rollbackJson?: string | null
      finishedAt?: string | null
    }
  ): void {
    const fields: string[] = []
    const values: unknown[] = []

    if (patch.status !== undefined) {
      fields.push('status = ?')
      values.push(patch.status)
    }
    if (patch.resultJson !== undefined) {
      fields.push('result_json = ?')
      values.push(patch.resultJson)
    }
    if (patch.verifyJson !== undefined) {
      fields.push('verify_json = ?')
      values.push(patch.verifyJson)
    }
    if (patch.rollbackJson !== undefined) {
      fields.push('rollback_json = ?')
      values.push(patch.rollbackJson)
    }
    if (patch.finishedAt !== undefined) {
      fields.push('finished_at = ?')
      values.push(patch.finishedAt)
    }

    if (fields.length === 0) return

    values.push(id)
    this.database
      .prepare(`UPDATE doctor_action SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)
  }

  actionsForRun(doctorRunId: number): DoctorActionRow[] {
    return this.database
      .prepare(
        `SELECT id, doctor_run_id, action_type, precondition_json, result_json, verify_json, rollback_json, status, started_at, finished_at
         FROM doctor_action WHERE doctor_run_id = ? ORDER BY id ASC`
      )
      .all(doctorRunId) as DoctorActionRow[]
  }

  latestActionForRun(doctorRunId: number): DoctorActionRow | null {
    return (
      (this.database
        .prepare(
          `SELECT id, doctor_run_id, action_type, precondition_json, result_json, verify_json, rollback_json, status, started_at, finished_at
           FROM doctor_action WHERE doctor_run_id = ? ORDER BY id DESC LIMIT 1`
        )
        .get(doctorRunId) as DoctorActionRow | undefined) ?? null
    )
  }
}
