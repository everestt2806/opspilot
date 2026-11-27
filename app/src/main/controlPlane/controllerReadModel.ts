import type Database from 'better-sqlite3'
import { isIP } from 'node:net'
import type {
  ProductControllerAppSummary,
  ProductControllerAppDetail,
  ProductControllerJobSummary,
  ProductControllerDeploymentSummary,
  ProductControllerHistoryItem,
  ProductControllerPage,
  ProductControllerCursorPayload
} from '../../../../docs/contracts/product-controller-api'
import {
  PRODUCT_CONTROLLER_API_DEFAULT_PAGE_SIZE,
  PRODUCT_CONTROLLER_API_MAX_PAGE_SIZE
} from '../../../../docs/contracts/product-controller-api'
import { ControllerClientAuthError } from './controllerClientAuth'
import { ControllerReadCursor } from './controllerReadCursor'

const base = `FROM product_app_control c JOIN app a ON a.id=c.app_id
  JOIN vps v ON v.id=a.vps_id AND v.archived_at IS NULL
  JOIN product_source_config s ON s.app_id=c.app_id AND s.source_generation=c.source_generation AND s.config_sha256=c.source_config_sha256
  LEFT JOIN product_desired_branch d ON d.app_id=c.app_id AND d.source_generation=c.source_generation AND d.ref=s.production_ref
  WHERE c.mode='product' AND c.controller_id=?`
const fields = `a.id AS app_id,a.name AS app_name,c.controller_id,c.ownership_generation,c.source_generation,
  c.source_config_sha256,s.production_ref,c.auto_deploy_paused,c.pause_reason,c.pause_policy_provenance,
  d.desired_sha,d.reconciliation_state,(SELECT MAX(o.observed_at) FROM product_branch_observation o
    WHERE o.app_id=a.id AND o.source_generation=c.source_generation AND o.ref=s.production_ref) AS observed_at`
type AppRow = Omit<ProductControllerAppSummary, 'sampled_at' | 'auto_deploy_paused'> & {
  auto_deploy_paused: number
}
type PagePosition = Extract<ProductControllerCursorPayload, { app_id: number }>

export class ControllerReadModel {
  constructor(
    private readonly db: Database.Database,
    private readonly controllerId: string,
    private readonly cursors: ControllerReadCursor
  ) {}
  apps(
    query: URLSearchParams,
    sampled: string
  ): ProductControllerPage<ProductControllerAppSummary> {
    const { limit, cursor } = this.query(query)
    let after = 0,
      ceiling = 0
    if (cursor) {
      if (cursor.collection !== 'apps') throw new ControllerClientAuthError('REQUEST_INVALID')
      after = cursor.after_app_id
      ceiling = cursor.upper_bound_app_id
    } else
      ceiling = (
        this.db.prepare(`SELECT COALESCE(MAX(a.id),0) AS id ${base}`).get(this.controllerId) as {
          id: number
        }
      ).id
    const rows = this.db
      .prepare(`SELECT ${fields} ${base} AND a.id>? AND a.id<=? ORDER BY a.id ASC LIMIT ?`)
      .all(this.controllerId, after, ceiling, limit + 1) as AppRow[]
    const items = rows.slice(0, limit).map((row) => ({
      ...row,
      auto_deploy_paused: row.auto_deploy_paused === 1,
      sampled_at: sampled
    }))
    const more = rows.length > limit
    return {
      items,
      has_more: more,
      next_cursor: more
        ? this.cursors.encode({
            controller_id: this.controllerId,
            collection: 'apps',
            after_app_id: items.at(-1)!.app_id,
            upper_bound_app_id: ceiling
          })
        : null
    }
  }
  app(appId: number, sampled: string): ProductControllerAppDetail {
    const row = this.db
      .prepare(`SELECT ${fields} ${base} AND a.id=?`)
      .get(this.controllerId, appId) as AppRow | undefined
    if (!row) throw new ControllerClientAuthError('APP_NOT_FOUND')
    const deployment = this.db
      .prepare(
        `SELECT dep.id,dep.git_commit_sha,dep.status,v.host,a.host_port FROM app a
      JOIN vps v ON v.id=a.vps_id LEFT JOIN deployment dep ON dep.id=a.current_deployment_id AND dep.app_id=a.id WHERE a.id=?`
      )
      .get(appId) as {
      id: number | null
      git_commit_sha: string | null
      status: ProductControllerAppDetail['current_deployment_state']
      host: string
      host_port: number
    }
    const job = this.db
      .prepare(
        `SELECT job_id,state FROM product_deploy_job WHERE controller_id=? AND app_id=? ORDER BY rowid DESC LIMIT 1`
      )
      .get(this.controllerId, appId) as
      | {
          job_id: string
          state: ProductControllerAppDetail['latest_job_state']
        }
      | undefined
    let url: string | null = null
    if (
      deployment.status === 'running' &&
      deployment.id &&
      (isIP(deployment.host) || /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(deployment.host)) &&
      Number.isInteger(deployment.host_port) &&
      deployment.host_port > 0 &&
      deployment.host_port <= 65535
    )
      url = `http://${isIP(deployment.host) === 6 ? `[${deployment.host}]` : deployment.host}:${deployment.host_port}`
    return {
      ...row,
      auto_deploy_paused: row.auto_deploy_paused === 1,
      sampled_at: sampled,
      current_deployment_id: deployment.id ?? null,
      current_deployment_sha: deployment.git_commit_sha ?? null,
      current_deployment_state: deployment.status ?? null,
      latest_job_id: job?.job_id ?? null,
      latest_job_state: job?.state ?? null,
      http_url: url
    }
  }
  collection(
    appId: number,
    collection: 'jobs' | 'deployments' | 'history',
    query: URLSearchParams,
    sampled: string
  ): ProductControllerPage<
    ProductControllerJobSummary | ProductControllerDeploymentSummary | ProductControllerHistoryItem
  > {
    this.app(appId, sampled) // Recheck current Product owner before every page, including old cursor.
    const { limit, cursor } = this.query(query)
    if (
      cursor &&
      (cursor.collection !== collection || !('app_id' in cursor) || cursor.app_id !== appId)
    )
      throw new ControllerClientAuthError('REQUEST_INVALID')
    const position = cursor as PagePosition | undefined
    const from =
      collection === 'jobs'
        ? 'product_deploy_job j'
        : collection === 'history'
          ? 'product_history_event j'
          : 'deployment j JOIN product_deploy_attempt a ON a.deployment_id=j.id JOIN product_deploy_job p ON p.job_id=a.job_id'
    const identity =
      collection === 'deployments'
        ? 'p.controller_id=? AND j.app_id=?'
        : 'j.controller_id=? AND j.app_id=?'
    const sequence = collection === 'history' ? 'j.event_id' : 'j.rowid'
    const upper =
      position?.event_id ??
      (
        this.db
          .prepare(`SELECT COALESCE(MAX(${sequence}),0) AS id FROM ${from} WHERE ${identity}`)
          .get(this.controllerId, appId) as { id: number }
      ).id
    const offset = position?.offset ?? 0
    const selected =
      collection === 'jobs'
        ? `j.job_id,j.app_id,j.ownership_generation,j.source_generation,j.target_sha,j.state,j.trigger,j.attempt_count,j.created_at,j.updated_at,j.finished_at,j.safe_error_code AS reason_code`
        : collection === 'deployments'
          ? `j.id AS deployment_id,j.app_id,j.version,j.git_commit_sha AS commit_sha,j.status,j.started_at,j.finished_at,a.job_id,a.attempt_id`
          : `j.event_id,j.app_id,j.job_id,j.attempt_id,(SELECT a.deployment_id FROM product_deploy_attempt a WHERE a.attempt_id=j.attempt_id) AS deployment_id,
        j.kind,(SELECT p.state FROM product_deploy_job p WHERE p.job_id=j.job_id) AS state,j.created_at,NULL AS reason_code`
    const rows = this.db
      .prepare(
        `SELECT ${selected} FROM ${from} WHERE ${identity} AND ${sequence}<=? ORDER BY ${sequence} DESC LIMIT ? OFFSET ?`
      )
      .all(this.controllerId, appId, upper, limit + 1, offset) as (
      | ProductControllerJobSummary
      | ProductControllerDeploymentSummary
      | ProductControllerHistoryItem
    )[]
    const more = rows.length > limit
    return {
      items: rows.slice(0, limit),
      has_more: more,
      next_cursor: more
        ? this.cursors.encode({
            controller_id: this.controllerId,
            collection,
            app_id: appId,
            event_id: upper,
            offset: offset + limit
          })
        : null
    }
  }
  private query(query: URLSearchParams): {
    limit: number
    cursor: ProductControllerCursorPayload | undefined
  } {
    for (const key of query.keys())
      if (!['limit', 'cursor'].includes(key) || query.getAll(key).length !== 1)
        throw new ControllerClientAuthError('REQUEST_INVALID')
    const raw = query.get('limit'),
      limit = raw === null ? PRODUCT_CONTROLLER_API_DEFAULT_PAGE_SIZE : Number(raw)
    if (
      (raw !== null && !/^[1-9][0-9]{0,2}$/.test(raw)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > PRODUCT_CONTROLLER_API_MAX_PAGE_SIZE
    )
      throw new ControllerClientAuthError('REQUEST_INVALID')
    const cursor = query.get('cursor')
    return { limit, cursor: cursor === null ? undefined : this.cursors.decode(cursor) }
  }
}
