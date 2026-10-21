import type Database from 'better-sqlite3'

import type {
  ProductAppOwnership,
  ProductBranchObservation,
  ProductControllerId,
  ProductDesiredBranchState,
  ProductSourceConfigIdentity
} from '../../../../docs/contracts/product-auto-deploy'

export type ProductRecord<T> = { kind: 'present'; value: T } | { kind: 'absent' }

export interface ProductControllerRecord {
  controller_id: ProductControllerId
  created_at: string
  status: 'active' | 'maintenance' | 'revoked'
}

export interface ProductAppOwnershipRecord extends ProductAppOwnership {}
export interface ProductSourceConfigRecord extends ProductSourceConfigIdentity {
  deploy_config_json: string
  created_at: string
}

type ProductDesiredBranchRow = Omit<ProductDesiredBranchState, 'auto_paused'> & {
  auto_paused: 0 | 1
}

/** Read-only persistence access; this repository never enrolls or infers mode. */
export class ProductDeployRepository {
  constructor(private readonly database: Database.Database) {}

  getController(controllerId: ProductControllerId): ProductRecord<ProductControllerRecord> {
    return readOne(
      this.database
        .prepare(
          'SELECT controller_id, created_at, status FROM product_controller WHERE controller_id = ?'
        )
        .get(controllerId) as ProductControllerRecord | undefined
    )
  }

  getOwnership(appId: number): ProductRecord<ProductAppOwnershipRecord> {
    return readOne(
      this.database
        .prepare(
          `SELECT app_id, mode, controller_id, ownership_generation, changed_at
                  FROM product_app_control WHERE app_id = ?`
        )
        .get(appId) as ProductAppOwnershipRecord | undefined
    )
  }

  getSourceConfig(
    appId: number,
    sourceGeneration: number
  ): ProductRecord<ProductSourceConfigRecord> {
    return readOne(
      this.database
        .prepare(
          `SELECT app_id, source_generation, config_sha256, repository_url,
                         production_ref, repository_root, deploy_config_json, created_at
                  FROM product_source_config WHERE app_id = ? AND source_generation = ?`
        )
        .get(appId, sourceGeneration) as ProductSourceConfigRecord | undefined
    )
  }

  getDesiredState(
    appId: number,
    sourceGeneration: number,
    ref: string
  ): ProductRecord<ProductDesiredBranchState> {
    const row = this.database
      .prepare(
        `SELECT app_id, source_generation, ref, desired_observation_sequence,
                       desired_sha, reconcile_epoch, reconciled_observation_sequence,
                       reconciled_epoch, reconciliation_state, reconciliation_job_id,
                       auto_paused, pause_reason, updated_at
                FROM product_desired_branch
                WHERE app_id = ? AND source_generation = ? AND ref = ?`
      )
      .get(appId, sourceGeneration, ref) as ProductDesiredBranchRow | undefined
    if (row === undefined) return { kind: 'absent' }
    return { kind: 'present', value: { ...row, auto_paused: row.auto_paused === 1 } }
  }

  getLatestObservation(
    appId: number,
    sourceGeneration: number,
    ref: string
  ): ProductRecord<ProductBranchObservation> {
    return readOne(
      this.database
        .prepare(
          `SELECT app_id, source_generation, ref, observation_sequence, observed_sha, observed_at
                  FROM product_branch_observation
                  WHERE app_id = ? AND source_generation = ? AND ref = ?
                  ORDER BY observation_sequence DESC LIMIT 1`
        )
        .get(appId, sourceGeneration, ref) as ProductBranchObservation | undefined
    )
  }
}

function readOne<T>(row: T | undefined): ProductRecord<T> {
  return row === undefined ? { kind: 'absent' } : { kind: 'present', value: row }
}
