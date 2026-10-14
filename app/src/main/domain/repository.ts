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

/** DNS state is independent of route/certificate/probe observations. No credential or secret is persisted. */
export class DomainRepository {
  constructor(private readonly database: Database.Database) {}

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
