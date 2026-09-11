import type Database from 'better-sqlite3'

export type ActivationReason =
  'deploy' | 'manual_rollback' | 'auto_rollback' | 'rotation' | 'legacy'
export type ActivationState = 'prepared' | 'active' | 'closed' | 'aborted'
export interface StreamIdentity {
  generation: string
  device?: number
  inode?: number
}
export interface ActivationEpisode {
  id: number
  appId: number
  deploymentId: number
  generation: string
  startOffset: number
  endOffset: number | null
  reason: ActivationReason
  state: ActivationState
}

const now = (): string => new Date().toISOString()

export class ActivationRepository {
  constructor(private readonly database: Database.Database) {}

  ensureLegacy(
    appId: number,
    deploymentId: number,
    offset: number,
    identity: StreamIdentity
  ): void {
    const active = this.database
      .prepare(
        "SELECT 1 FROM deployment_activation WHERE app_id=? AND state IN ('prepared','active')"
      )
      .get(appId) as { deployment_id?: number } | undefined
    if (active) {
      const activeDeployment = this.database
        .prepare(
          "SELECT deployment_id FROM deployment_activation WHERE app_id=? AND state='active' ORDER BY id DESC LIMIT 1"
        )
        .get(appId) as { deployment_id: number } | undefined
      if (activeDeployment?.deployment_id === deploymentId) return
      this.database.transaction(() => {
        const activeRange = this.database
          .prepare(
            "SELECT start_offset FROM deployment_activation WHERE app_id=? AND state='active'"
          )
          .get(appId) as { start_offset: number } | undefined
        this.database
          .prepare(
            "UPDATE deployment_activation SET state='closed', end_offset=?, closed_at=? WHERE app_id=? AND state='active'"
          )
          .run(Math.max(offset, activeRange?.start_offset ?? offset), now(), appId)
        this.database
          .prepare(
            `INSERT INTO deployment_activation
             (app_id,deployment_id,stream_generation,start_offset,reason,state,activated_at)
             VALUES (?,?,?,?,'deploy','active',?)`
          )
          .run(appId, deploymentId, identity.generation, offset, now())
      })()
      return
    }
    this.database.transaction(() => {
      this.database
        .prepare(
          'UPDATE app SET metrics_stream_generation=?, metrics_stream_device=?, metrics_stream_inode=? WHERE id=?'
        )
        .run(identity.generation, identity.device ?? null, identity.inode ?? null, appId)
      this.database
        .prepare(
          `INSERT INTO deployment_activation
           (app_id,deployment_id,stream_generation,start_offset,reason,state,activated_at)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(appId, deploymentId, identity.generation, offset, 'legacy', 'active', now())
    })()
  }

  active(appId: number): ActivationEpisode | undefined {
    const row = this.database
      .prepare(
        "SELECT id,app_id,deployment_id,stream_generation,start_offset,end_offset,reason,state FROM deployment_activation WHERE app_id=? AND state='active' ORDER BY id DESC LIMIT 1"
      )
      .get(appId) as Record<string, unknown> | undefined
    return row ? this.map(row) : undefined
  }

  prepared(appId: number): boolean {
    return Boolean(
      this.database
        .prepare("SELECT 1 FROM deployment_activation WHERE app_id=? AND state='prepared'")
        .get(appId)
    )
  }

  prepare(
    appId: number,
    deploymentId: number,
    identity: StreamIdentity,
    startOffset: number,
    reason: Exclude<ActivationReason, 'legacy'>
  ): number {
    const result = this.database
      .prepare(
        `INSERT INTO deployment_activation
         (app_id,deployment_id,stream_generation,start_offset,reason,state)
         VALUES (?,?,?,?,?,'prepared')`
      )
      .run(appId, deploymentId, identity.generation, startOffset, reason)
    return Number(result.lastInsertRowid)
  }

  activate(id: number, previousId: number | null): void {
    this.database.transaction(() => {
      const prepared = this.database
        .prepare(
          'SELECT app_id,start_offset,stream_generation FROM deployment_activation WHERE id=? AND state=?'
        )
        .get(id, 'prepared') as
        { app_id: number; start_offset: number; stream_generation: string } | undefined
      if (!prepared) throw new Error('Activation is not prepared')
      if (previousId !== null) {
        this.database
          .prepare(
            "UPDATE deployment_activation SET end_offset=?, state='closed', closed_at=? WHERE id=? AND state='active'"
          )
          .run(prepared.start_offset, now(), previousId)
      }
      this.database
        .prepare("UPDATE deployment_activation SET state='active', activated_at=? WHERE id=?")
        .run(now(), id)
    })()
  }

  closeActive(appId: number, endOffset: number): void {
    this.database
      .prepare(
        "UPDATE deployment_activation SET state='closed', end_offset=?, closed_at=? WHERE app_id=? AND state='active'"
      )
      .run(endOffset, now(), appId)
  }

  abort(id: number): void {
    this.database
      .prepare("UPDATE deployment_activation SET state='aborted' WHERE id=? AND state='prepared'")
      .run(id)
  }

  route(episodes: ActivationEpisode[], byteOffset: number): number | null {
    const episode = episodes.find(
      (candidate) =>
        candidate.state !== 'aborted' &&
        byteOffset >= candidate.startOffset &&
        (candidate.endOffset === null || byteOffset < candidate.endOffset)
    )
    return episode?.deploymentId ?? null
  }

  rotate(appId: number, deploymentId: number, identity: StreamIdentity, endOffset: number): void {
    this.database.transaction(() => {
      this.database
        .prepare(
          "UPDATE deployment_activation SET state='closed', end_offset=?, closed_at=? WHERE app_id=? AND state='active'"
        )
        .run(Math.max(endOffset, 1), now(), appId)
      this.database
        .prepare(
          'UPDATE app SET metrics_stream_generation=?, metrics_stream_device=?, metrics_stream_inode=?, metrics_offset=1 WHERE id=?'
        )
        .run(identity.generation, identity.device ?? null, identity.inode ?? null, appId)
      this.database
        .prepare(
          `INSERT INTO deployment_activation
           (app_id,deployment_id,stream_generation,start_offset,reason,state,activated_at)
           VALUES (?,?,?,1,'rotation','active',?)`
        )
        .run(appId, deploymentId, identity.generation, now())
      this.database
        .prepare(
          "INSERT INTO action_log (action,status,message,app_id,deployment_id) VALUES ('ssh_error','failed','Metric file generation changed; new generation opened with an explicit data-gap boundary',?,?)"
        )
        .run(appId, deploymentId)
    })()
  }

  logFailClosed(appId: number): void {
    this.database
      .prepare(
        "INSERT INTO action_log (action,status,message,app_id) VALUES ('ssh_error','failed','Prepared activation requires reconciliation before polling',?)"
      )
      .run(appId)
  }

  episodes(appId: number, generation: string): ActivationEpisode[] {
    return (
      this.database
        .prepare(
          'SELECT id,app_id,deployment_id,stream_generation,start_offset,end_offset,reason,state FROM deployment_activation WHERE app_id=? AND stream_generation=? ORDER BY start_offset,id'
        )
        .all(appId, generation) as Array<Record<string, unknown>>
    ).map((row) => this.map(row))
  }

  private map(row: Record<string, unknown>): ActivationEpisode {
    return {
      id: Number(row.id),
      appId: Number(row.app_id),
      deploymentId: Number(row.deployment_id),
      generation: String(row.stream_generation),
      startOffset: Number(row.start_offset),
      endOffset: row.end_offset === null ? null : Number(row.end_offset),
      reason: String(row.reason) as ActivationReason,
      state: String(row.state) as ActivationState
    }
  }
}
