import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

import type {
  DomainCertificateStatus,
  DomainDnsStatus,
  DomainIngressState,
  DomainHttpsProbeStatus,
  DomainReasonCode,
  DomainRouteStatus
} from '@shared/ipc'

import { AppError } from '../errors'

export interface DomainDnsBindingInput {
  app_id: number
  hostname: string
  mode: 'direct_port' | 'shared_ingress' | 'named_tunnel'
  provider: string
  zone_id: string
  record_type: 'A' | 'AAAA' | 'CNAME'
  record_name: string
  target: string
  ownership_key: string
  route_ownership_key: string
  dns_status: DomainDnsStatus
  dns_evidence_json?: string | null
}

export interface DomainIngressObservation {
  hostname: string
  ownership_key: string
  route_ownership_key: string
  generation: number
  route_status: DomainRouteStatus
  certificate_status: DomainCertificateStatus
  https_probe_status: DomainHttpsProbeStatus
  reason_code: DomainReasonCode | null
  route_checked_at: string
  certificate_checked_at: string | null
  certificate_hostname: string | null
  https_probe_checked_at: string | null
  https_probe_hostname: string | null
}

export interface SharedIngressInventoryBinding {
  id: number
  app_id: number
  hostname: string
  ownership_key: string
  route_ownership_key: string
  desired_generation: number
  dns_status: DomainDnsStatus
  enabled: boolean
  host_port: number | null
  current_deployment_id: number | null
  deployment_version: number | null
  image_tag: string | null
}

export interface SharedIngressInventorySnapshot {
  vps_id: number
  host: string
  port: number
  host_fingerprint: string | null
  revision: string
  bindings: SharedIngressInventoryBinding[]
}

export interface SharedIngressReconcileObservation {
  vps_id: number
  inventory_revision: string
  environment: 'production' | 'acme_staging'
  generation: string
  config_sha256: string
}

/** DNS state is independent of route/certificate/probe observations. No credential or secret is persisted. */
export class DomainRepository {
  constructor(private readonly database: Database.Database) {}

  /** Reads every shared-ingress binding; enabled routes fail closed unless their current runtime is valid. */
  getSharedIngressInventory(vpsId: number): SharedIngressInventorySnapshot {
    const rows = this.database.prepare(
      `SELECT v.id AS vps_id, v.host, v.port AS ssh_port, v.host_fingerprint, v.archived_at,
              b.id, b.app_id, b.hostname, b.ownership_key, b.route_ownership_key,
              b.desired_generation, b.dns_status, b.route_status,
              a.host_port, a.imported_from_vps, a.current_deployment_id,
              d.id AS joined_deployment_id, d.version AS deployment_version,
              d.image_tag, d.status AS deployment_status, d.origin AS deployment_origin
       FROM vps v
       LEFT JOIN app a ON a.vps_id = v.id
       LEFT JOIN domain_binding b ON b.app_id = a.id AND b.mode = 'shared_ingress'
       LEFT JOIN deployment d ON d.id = a.current_deployment_id AND d.app_id = a.id
       WHERE v.id = ? AND (b.id IS NULL OR b.mode = 'shared_ingress')
       ORDER BY b.hostname, b.id`
    ).all(vpsId) as Array<{
      vps_id: number; host: string; ssh_port: number; host_fingerprint: string | null; archived_at: string | null
      id: number | null; app_id: number | null; hostname: string | null; ownership_key: string | null
      route_ownership_key: string | null; desired_generation: number | null; dns_status: DomainDnsStatus | null
      route_status: string | null; host_port: number | null; imported_from_vps: number | null
      current_deployment_id: number | null; joined_deployment_id: number | null; deployment_version: number | null
      image_tag: string | null; deployment_status: string | null; deployment_origin: string | null
    }>
    const host = rows[0]
    if (!host || host.archived_at !== null) throw new AppError('VALIDATION', 'VPS ingress inventory không tồn tại hoặc đã lưu trữ.')
    const bindings: SharedIngressInventoryBinding[] = []
    for (const row of rows) {
      if (row.id === null) continue
      const isDisabled = row.dns_status === 'disabled' || row.route_status === 'disabled'
      if (!row.hostname || !row.ownership_key || !row.route_ownership_key || !row.desired_generation || !row.dns_status) {
        throw new AppError('VALIDATION', 'Shared-ingress inventory thiếu định danh hoặc generation.')
      }
      const enabled = !isDisabled
      if (enabled && (
        row.dns_status !== 'propagated' ||
        row.route_ownership_key !== `opspilot-ingress:${row.app_id}:${row.hostname}` ||
        row.imported_from_vps !== 0 ||
        !Number.isInteger(row.host_port) || row.host_port! < 1 || row.host_port! > 65_535 ||
        row.current_deployment_id === null || row.joined_deployment_id !== row.current_deployment_id ||
        row.deployment_status !== 'running' || row.deployment_origin !== 'opspilot' ||
        !Number.isInteger(row.deployment_version) || !row.image_tag
      )) {
        throw new AppError('VALIDATION', `Shared-ingress binding ${row.hostname} không khớp app/deployment hiện hành hoặc chưa sẵn sàng.`)
      }
      bindings.push({
        id: row.id,
        app_id: row.app_id!,
        hostname: row.hostname,
        ownership_key: row.ownership_key,
        route_ownership_key: row.route_ownership_key,
        desired_generation: row.desired_generation,
        dns_status: row.dns_status,
        enabled,
        host_port: enabled ? row.host_port : null,
        current_deployment_id: enabled ? row.current_deployment_id : null,
        deployment_version: enabled ? row.deployment_version : null,
        image_tag: enabled ? row.image_tag : null
      })
    }
    const identity = { vps_id: host.vps_id, host: host.host, port: host.ssh_port, host_fingerprint: host.host_fingerprint }
    const revision = createHash('sha256').update(JSON.stringify({ identity, bindings })).digest('hex')
    return { ...identity, revision, bindings }
  }

  getSharedIngressReconcileObservation(vpsId: number): SharedIngressReconcileObservation | null {
    return (this.database.prepare(
      `SELECT vps_id, inventory_revision, environment, generation, config_sha256
       FROM ingress_reconcile_observation WHERE vps_id=?`
    ).get(vpsId) as SharedIngressReconcileObservation | undefined) ?? null
  }

  /** Commits only pending/disabled observations. HTTPS evidence remains unrequested/unrun. */
  recordSharedIngressReconcile(
    snapshot: SharedIngressInventorySnapshot,
    environment: 'production' | 'acme_staging',
    generation: string,
    configSha256: string
  ): void {
    this.database.transaction(() => {
      const current = this.getSharedIngressInventory(snapshot.vps_id)
      if (current.revision !== snapshot.revision) {
        throw new AppError('VALIDATION', 'Shared-ingress inventory changed during reconcile.')
      }
      const update = this.database.prepare(
        `UPDATE domain_binding
         SET route_status=@route_status, certificate_status='not_requested',
             https_probe_status='not_run', observed_generation=@generation,
             ingress_reason_code=NULL,
             route_checked_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
             certificate_checked_at=NULL, certificate_hostname=NULL,
             https_probe_checked_at=NULL, https_probe_hostname=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id=@id AND app_id=@app_id AND hostname=@hostname
           AND ownership_key=@ownership_key AND route_ownership_key=@route_ownership_key
           AND desired_generation=@generation`
      )
      for (const binding of snapshot.bindings) {
        const result = update.run({
          id: binding.id,
          app_id: binding.app_id,
          hostname: binding.hostname,
          ownership_key: binding.ownership_key,
          route_ownership_key: binding.route_ownership_key,
          generation: binding.desired_generation,
          route_status: binding.enabled ? 'pending' : 'disabled'
        })
        if (result.changes !== 1) throw new AppError('VALIDATION', 'Binding generation changed during reconcile.')
      }
      this.database.prepare(
        `INSERT INTO ingress_reconcile_observation
          (vps_id, inventory_revision, environment, generation, config_sha256, updated_at)
         VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         ON CONFLICT(vps_id) DO UPDATE SET
           inventory_revision=excluded.inventory_revision, environment=excluded.environment,
           generation=excluded.generation, config_sha256=excluded.config_sha256,
           updated_at=excluded.updated_at`
      ).run(snapshot.vps_id, snapshot.revision, environment, generation, configSha256)
    })()
  }

  upsertDns(input: DomainDnsBindingInput): void {
    const result = this.database
      .prepare(
        `INSERT INTO domain_binding
          (app_id, hostname, mode, provider, zone_id, record_type, record_name, target,
           ownership_key, route_ownership_key, status, dns_status, dns_evidence_json,
           last_check_at, updated_at)
         VALUES (@app_id, @hostname, @mode, @provider, @zone_id, @record_type, @record_name,
           @target, @ownership_key, @route_ownership_key, @dns_status, @dns_status,
           @dns_evidence_json,
           strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         ON CONFLICT(hostname) DO UPDATE SET
           mode=excluded.mode,
           provider=excluded.provider,
           zone_id=excluded.zone_id,
           record_type=excluded.record_type,
           record_name=excluded.record_name,
           target=excluded.target,
           status=excluded.dns_status,
           dns_status=excluded.dns_status,
           dns_evidence_json=excluded.dns_evidence_json,
           last_check_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
           route_status=CASE WHEN
             domain_binding.mode IS NOT excluded.mode OR
             domain_binding.record_type IS NOT excluded.record_type OR
             domain_binding.record_name IS NOT excluded.record_name OR
             domain_binding.target IS NOT excluded.target OR
             excluded.dns_status <> 'propagated'
             THEN CASE WHEN domain_binding.route_status = 'not_configured'
               THEN 'not_configured' ELSE 'pending' END
             ELSE domain_binding.route_status END,
           https_probe_status=CASE WHEN
             domain_binding.mode IS NOT excluded.mode OR
             domain_binding.record_type IS NOT excluded.record_type OR
             domain_binding.record_name IS NOT excluded.record_name OR
             domain_binding.target IS NOT excluded.target OR
             excluded.dns_status <> 'propagated'
             THEN 'not_run' ELSE domain_binding.https_probe_status END,
           route_checked_at=CASE WHEN
             domain_binding.mode IS NOT excluded.mode OR
             domain_binding.record_type IS NOT excluded.record_type OR
             domain_binding.record_name IS NOT excluded.record_name OR
             domain_binding.target IS NOT excluded.target OR
             excluded.dns_status <> 'propagated'
             THEN NULL ELSE domain_binding.route_checked_at END,
           https_probe_checked_at=CASE WHEN
             domain_binding.mode IS NOT excluded.mode OR
             domain_binding.record_type IS NOT excluded.record_type OR
             domain_binding.record_name IS NOT excluded.record_name OR
             domain_binding.target IS NOT excluded.target OR
             excluded.dns_status <> 'propagated'
             THEN NULL ELSE domain_binding.https_probe_checked_at END,
           https_probe_hostname=CASE WHEN
             domain_binding.mode IS NOT excluded.mode OR
             domain_binding.record_type IS NOT excluded.record_type OR
             domain_binding.record_name IS NOT excluded.record_name OR
             domain_binding.target IS NOT excluded.target OR
             excluded.dns_status <> 'propagated'
             THEN NULL ELSE domain_binding.https_probe_hostname END,
           ingress_reason_code=CASE WHEN excluded.dns_status <> 'propagated'
             THEN 'DNS_NOT_PROPAGATED'
             WHEN domain_binding.target IS NOT excluded.target THEN NULL
             ELSE domain_binding.ingress_reason_code END,
           updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE domain_binding.app_id = excluded.app_id
           AND domain_binding.ownership_key = excluded.ownership_key
           AND domain_binding.route_ownership_key = excluded.route_ownership_key`
      )
      .run({ ...input, dns_evidence_json: input.dns_evidence_json ?? null })

    if (result.changes === 0) {
      throw new AppError(
        'VALIDATION',
        'Xung đột quyền sở hữu: hostname đã thuộc app hoặc ingress owner khác.'
      )
    }
  }

  recordIngressObservation(input: DomainIngressObservation): DomainIngressState {
    const current = this.getByHostname(input.hostname)
    if (!current) throw new AppError('VALIDATION', 'Không tìm thấy domain binding.')
    if (
      current.ownership_key !== input.ownership_key ||
      current.route_ownership_key !== input.route_ownership_key
    ) {
      throw new AppError('VALIDATION', 'Xung đột quyền sở hữu route ingress.')
    }
    if (current.desired_generation !== input.generation) {
      throw new AppError('VALIDATION', 'Kết quả ingress đã cũ; cần reconcile lại generation hiện tại.')
    }
    if (
      input.certificate_status === 'valid' &&
      (input.certificate_checked_at === null || input.certificate_hostname !== input.hostname)
    ) {
      throw new AppError('VALIDATION', 'Certificate phải hợp lệ cho hostname và có thời điểm kiểm tra.')
    }
    if (
      input.https_probe_status === 'passed' &&
      (input.https_probe_checked_at === null || input.https_probe_hostname !== input.hostname)
    ) {
      throw new AppError('VALIDATION', 'HTTPS probe ngoài phải xác minh đúng hostname và có thời điểm kiểm tra.')
    }
    if (input.https_probe_status === 'passed' && input.certificate_status !== 'valid') {
      throw new AppError('VALIDATION', 'HTTPS probe chỉ hợp lệ khi certificate đã được xác minh.')
    }
    if (
      input.route_status === 'failed' ||
      input.route_status === 'conflict' ||
      input.route_status === 'degraded' ||
      input.certificate_status === 'failed' ||
      input.certificate_status === 'expired' ||
      input.https_probe_status === 'failed'
    ) {
      if (!input.reason_code) {
        throw new AppError('VALIDATION', 'Kết quả ingress lỗi phải có reason code.')
      }
    }
    if (input.route_status === 'active') {
      if (
        current.mode !== 'shared_ingress' ||
        current.dns_status !== 'propagated' ||
        input.certificate_status !== 'valid' ||
        input.https_probe_status !== 'passed' ||
        input.certificate_checked_at === null ||
        input.certificate_hostname !== input.hostname ||
        input.https_probe_checked_at === null ||
        input.https_probe_hostname !== input.hostname
      ) {
        throw new AppError(
          'VALIDATION',
          'Chỉ được active sau khi DNS, route, certificate và external HTTPS probe đều hợp lệ.'
        )
      }
    }

    const update = this.database
      .prepare(
        `UPDATE domain_binding
         SET route_status=@route_status,
             certificate_status=@certificate_status,
             https_probe_status=@https_probe_status,
             observed_generation=@generation,
             ingress_reason_code=@reason_code,
             route_checked_at=@route_checked_at,
             certificate_checked_at=@certificate_checked_at,
             certificate_hostname=@certificate_hostname,
             https_probe_checked_at=@https_probe_checked_at,
             https_probe_hostname=@https_probe_hostname,
             updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE hostname=@hostname AND ownership_key=@ownership_key
           AND route_ownership_key=@route_ownership_key
           AND desired_generation=@generation`
      )
      .run(input)
    if (update.changes !== 1) {
      throw new AppError('VALIDATION', 'Ingress state hoặc generation đã đổi; kết quả bị từ chối.')
    }
    return this.getByHostname(input.hostname)!
  }

  getByHostname(hostname: string): DomainIngressState | undefined {
    return this.database
      .prepare(
        `SELECT id, app_id, hostname, mode, dns_status, route_status,
                certificate_status, https_probe_status, desired_generation,
                observed_generation, ownership_key, route_ownership_key,
                ingress_reason_code, last_check_at, route_checked_at,
                certificate_checked_at, certificate_hostname, https_probe_checked_at,
                https_probe_hostname
         FROM domain_binding WHERE hostname=?`
      )
      .get(hostname) as DomainIngressState | undefined
  }
}
