import type Database from 'better-sqlite3'

import { AppError } from '../errors'

export interface DomainBindingRecord {
  app_id: number
  hostname: string
  mode: 'direct_port' | 'shared_ingress' | 'named_tunnel'
  provider: string
  zone_id: string
  record_type: 'A' | 'AAAA' | 'CNAME'
  record_name: string
  target: string
  ownership_key: string
  status: 'pending' | 'propagated' | 'active' | 'conflict' | 'failed' | 'disabled'
  evidence_json?: string | null
}

/** Lưu desired-state DNS, không lưu API token hoặc secret provider. */
export class DomainRepository {
  constructor(private readonly database: Database.Database) {}

  upsert(record: DomainBindingRecord): void {
    const result = this.database
      .prepare(
        `INSERT INTO domain_binding
          (app_id, hostname, mode, provider, zone_id, record_type, record_name, target,
           ownership_key, status, evidence_json, updated_at)
         VALUES (@app_id, @hostname, @mode, @provider, @zone_id, @record_type, @record_name,
           @target, @ownership_key, @status, @evidence_json, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         ON CONFLICT(hostname) DO UPDATE SET
           mode=excluded.mode,
           provider=excluded.provider,
           zone_id=excluded.zone_id,
           record_type=excluded.record_type,
           record_name=excluded.record_name,
           target=excluded.target,
           status=excluded.status,
           evidence_json=excluded.evidence_json,
           updated_at=excluded.updated_at
         WHERE domain_binding.app_id = excluded.app_id
           AND domain_binding.ownership_key = excluded.ownership_key`
      )
      .run({ ...record, evidence_json: record.evidence_json ?? null })

    if (result.changes === 0) {
      throw new AppError(
        'VALIDATION',
        'Xung đột quyền sở hữu: Hostname này đã được gắn cho app khác hoặc ownership key không khớp.'
      )
    }
  }
}
