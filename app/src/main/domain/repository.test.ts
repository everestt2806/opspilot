import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import type { DomainIngressState } from '@shared/ipc'

import {
  DomainRepository,
  type DomainDnsBindingInput,
  type SharedIngressInventorySnapshot
} from './repository'

function createDatabase(): Database.Database {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE domain_binding (
      id INTEGER PRIMARY KEY,
      app_id INTEGER NOT NULL,
      hostname TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,
      provider TEXT,
      zone_id TEXT,
      record_type TEXT,
      record_name TEXT,
      target TEXT,
      ownership_key TEXT NOT NULL,
      status TEXT NOT NULL,
      dns_status TEXT NOT NULL DEFAULT 'pending' CHECK
        (dns_status IN ('pending','propagated','conflict','failed','disabled')),
      dns_evidence_json TEXT,
      route_status TEXT NOT NULL DEFAULT 'not_configured' CHECK
        (route_status IN ('not_configured','pending','active','degraded','conflict','failed','disabled')),
      certificate_status TEXT NOT NULL DEFAULT 'not_requested' CHECK
        (certificate_status IN ('not_requested','pending','valid','failed','expired')),
      https_probe_status TEXT NOT NULL DEFAULT 'not_run' CHECK
        (https_probe_status IN ('not_run','passed','failed')),
      desired_generation INTEGER NOT NULL DEFAULT 1,
      observed_generation INTEGER NOT NULL DEFAULT 0,
      route_ownership_key TEXT NOT NULL DEFAULT '',
      ingress_reason_code TEXT,
      last_check_at TEXT,
      route_checked_at TEXT,
      certificate_checked_at TEXT,
      certificate_hostname TEXT,
      https_probe_checked_at TEXT,
      https_probe_hostname TEXT,
      route_config_generation TEXT,
      route_inventory_revision TEXT,
      route_environment TEXT,
      https_probe_peer_ip TEXT,
      https_probe_peer_ips_json TEXT,
      https_probe_http_status INTEGER,
      https_probe_generation TEXT,
      https_probe_inventory_revision TEXT,
      https_probe_environment TEXT,
      updated_at TEXT
    );
    CREATE UNIQUE INDEX idx_domain_binding_route_ownership
      ON domain_binding(route_ownership_key);
    CREATE TRIGGER domain_binding_active_requires_https_update
    BEFORE UPDATE OF route_status, dns_status, certificate_status, https_probe_status,
      desired_generation, observed_generation, route_checked_at, certificate_checked_at,
      certificate_hostname, https_probe_checked_at, https_probe_hostname, route_environment,
      https_probe_environment, route_config_generation, route_inventory_revision,
      https_probe_generation, https_probe_inventory_revision, https_probe_peer_ip,
      https_probe_peer_ips_json, https_probe_http_status ON domain_binding
    WHEN NEW.route_status = 'active' AND (
      NEW.dns_status <> 'propagated' OR NEW.certificate_status <> 'valid' OR
      NEW.https_probe_status <> 'passed' OR NEW.desired_generation <> NEW.observed_generation OR
      NEW.certificate_hostname IS NOT NEW.hostname OR NEW.https_probe_hostname IS NOT NEW.hostname OR
      NEW.route_checked_at IS NULL OR NEW.certificate_checked_at IS NULL OR
      NEW.https_probe_checked_at IS NULL OR NEW.route_environment <> 'production' OR
      NEW.https_probe_environment <> 'production' OR NEW.route_config_generation IS NULL OR
      NEW.route_inventory_revision IS NULL OR NEW.https_probe_generation IS NOT NEW.route_config_generation OR
      NEW.https_probe_inventory_revision IS NOT NEW.route_inventory_revision OR
      NEW.https_probe_peer_ip IS NULL OR NEW.https_probe_peer_ips_json IS NULL OR
      NEW.https_probe_http_status NOT BETWEEN 200 AND 299
    )
    BEGIN SELECT RAISE(ABORT, 'domain_https_active_requires_verified_evidence'); END;
    CREATE TRIGGER domain_binding_active_requires_shared_ingress_update
    BEFORE UPDATE OF route_status, mode ON domain_binding
    WHEN NEW.route_status='active' AND NEW.mode <> 'shared_ingress'
    BEGIN SELECT RAISE(ABORT, 'domain_https_active_requires_shared_ingress'); END;
    CREATE TRIGGER domain_binding_invalidate_changed_route_identity
    AFTER UPDATE OF app_id, hostname, mode, target, record_type, record_name,
      ownership_key, route_ownership_key ON domain_binding
    WHEN OLD.app_id IS NOT NEW.app_id OR OLD.hostname IS NOT NEW.hostname OR
      OLD.mode IS NOT NEW.mode OR OLD.target IS NOT NEW.target OR
      OLD.record_type IS NOT NEW.record_type OR OLD.record_name IS NOT NEW.record_name OR
      OLD.ownership_key IS NOT NEW.ownership_key OR
      OLD.route_ownership_key IS NOT NEW.route_ownership_key
    BEGIN
      UPDATE domain_binding
      SET route_status=CASE WHEN OLD.route_status='not_configured' THEN 'not_configured' ELSE 'pending' END,
          desired_generation=desired_generation+1, observed_generation=0,
          certificate_status='not_requested', https_probe_status='not_run',
          ingress_reason_code=NULL, route_checked_at=NULL, certificate_checked_at=NULL,
          certificate_hostname=NULL, https_probe_checked_at=NULL, https_probe_hostname=NULL,
          route_config_generation=NULL, route_inventory_revision=NULL, route_environment=NULL,
          https_probe_peer_ip=NULL, https_probe_peer_ips_json=NULL,
          https_probe_http_status=NULL, https_probe_generation=NULL,
          https_probe_inventory_revision=NULL, https_probe_environment=NULL
      WHERE id=NEW.id;
    END;
  `)
  return database
}

function binding(overrides: Partial<DomainDnsBindingInput> = {}): DomainDnsBindingInput {
  return {
    app_id: 3,
    hostname: 'app.example.com',
    mode: 'shared_ingress',
    provider: 'cloudflare',
    zone_id: 'zone-1',
    record_type: 'A',
    record_name: 'app.example.com',
    target: '203.0.113.5',
    ownership_key: 'dns-owner:app.example.com',
    route_ownership_key: 'opspilot-ingress:3:app.example.com',
    dns_status: 'pending',
    ...overrides
  }
}

function observation(
  overrides: Partial<Parameters<DomainRepository['recordIngressObservation']>[0]> = {}
): Parameters<DomainRepository['recordIngressObservation']>[0] {
  return {
    hostname: 'app.example.com',
    ownership_key: 'dns-owner:app.example.com',
    route_ownership_key: 'opspilot-ingress:3:app.example.com',
    generation: 1,
    route_status: 'active',
    certificate_status: 'valid',
    https_probe_status: 'passed',
    reason_code: null,
    route_checked_at: '2026-10-14T10:00:00Z',
    certificate_checked_at: '2026-10-14T10:00:01Z',
    certificate_hostname: 'app.example.com',
    https_probe_checked_at: '2026-10-14T10:00:02Z',
    https_probe_hostname: 'app.example.com',
    ...overrides
  }
}

function setActiveEvidence(database: Database.Database): void {
  database.prepare(`UPDATE domain_binding SET route_status='active', certificate_status='valid',
    https_probe_status='passed', observed_generation=desired_generation,
    route_environment='production', https_probe_environment='production',
    route_config_generation=?, route_inventory_revision=?, https_probe_generation=?,
    https_probe_inventory_revision=?, https_probe_peer_ip='203.0.113.5',
    https_probe_peer_ips_json='["203.0.113.5"]', https_probe_http_status=200,
    route_checked_at='2026-10-14T10:00:00Z', certificate_checked_at='2026-10-14T10:00:01Z',
    certificate_hostname=hostname, https_probe_checked_at='2026-10-14T10:00:02Z',
    https_probe_hostname=hostname WHERE id=1`).run('a'.repeat(64), 'b'.repeat(64), 'a'.repeat(64), 'b'.repeat(64))
}

describe('DomainRepository ingress/TLS state', () => {
  it('keeps DNS upsert separate and never promotes it to HTTPS active', () => {
    const database = createDatabase()
    const repository = new DomainRepository(database)

    repository.upsertDns(binding({ dns_status: 'propagated' }))
    expect(repository.getByHostname('app.example.com')).toMatchObject({
      dns_status: 'propagated',
      route_status: 'not_configured',
      certificate_status: 'not_requested',
      https_probe_status: 'not_run',
      desired_generation: 1,
      observed_generation: 0
    })
    const columns = database.pragma('table_info(domain_binding)') as Array<{ name: string }>
    expect(columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(['api_token', 'private_key', 'certificate_secret'])
    )
    database.close()
  })

  it('rejects DNS and route ownership conflicts without overwriting the existing binding', () => {
    const database = createDatabase()
    const repository = new DomainRepository(database)
    repository.upsertDns(binding({ dns_status: 'propagated' }))

    expect(() =>
      repository.upsertDns(
        binding({ target: '203.0.113.8', ownership_key: 'other-dns-owner' })
      )
    ).toThrow(/VALIDATION/)
    expect(() =>
      repository.recordIngressObservation(observation({ route_ownership_key: 'other-route-owner' }))
    ).toThrow(/VALIDATION/)
    expect(
      database
        .prepare('SELECT app_id, target, ownership_key FROM domain_binding WHERE hostname=?')
        .get('app.example.com')
    ).toEqual({
      app_id: 3,
      target: '203.0.113.5',
      ownership_key: 'dns-owner:app.example.com',
    })
    database.close()
  })

  it('accepts active only with DNS, matching generation, valid certificate and passed HTTPS probe', () => {
    const database = createDatabase()
    const repository = new DomainRepository(database)
    repository.upsertDns(binding({ dns_status: 'propagated' }))

    expect(() => repository.recordIngressObservation(observation())).toThrow(/VALIDATION/)
    setActiveEvidence(database)
    expect(repository.getByHostname('app.example.com')).toMatchObject<Partial<DomainIngressState>>({
      route_status: 'active', certificate_status: 'valid', https_probe_status: 'passed',
      route_environment: 'production', https_probe_peer_ip: '203.0.113.5',
      https_probe_peer_ips_json: '["203.0.113.5"]'
    })

    repository.upsertDns(binding({ target: '203.0.113.6', dns_status: 'propagated' }))
    expect(repository.getByHostname('app.example.com')).toMatchObject({
      route_status: 'pending',
      https_probe_status: 'not_run',
      https_probe_peer_ips_json: null,
      desired_generation: 2,
      observed_generation: 0
    })
    expect(() => repository.recordIngressObservation(observation({ generation: 1 }))).toThrow(
      /VALIDATION/
    )
    expect(() => repository.recordIngressObservation(observation({ generation: 2 }))).toThrow(/VALIDATION/)
    database.close()
  })

  it('CAS-demotes a real active binding on DNS/runtime precheck failure and leaves newer generations intact', () => {
    const snapshot = {
      vps_id: 1,
      host: '198.51.100.5',
      port: 22,
      host_fingerprint: 'SHA256:PINNED',
      revision: 'b'.repeat(64),
      bindings: [{
        id: 1, app_id: 3, hostname: 'app.example.com',
        ownership_key: 'dns-owner:app.example.com',
        route_ownership_key: 'opspilot-ingress:3:app.example.com',
        desired_generation: 1, dns_status: 'propagated' as const, enabled: true,
        host_port: 30003, healthcheck_path: '/', healthcheck_response_type: 'status_2xx' as const,
        current_deployment_id: 9, deployment_version: 1, image_tag: 'app:v1'
      }]
    } satisfies SharedIngressInventorySnapshot
    const observation = {
      vps_id: 1, inventory_revision: snapshot.revision, environment: 'production' as const,
      generation: 'a'.repeat(64), config_sha256: 'c'.repeat(64)
    }

    for (const reasonCode of ['DNS_NOT_PROPAGATED', 'INGRESS_CONFIG_INVALID'] as const) {
      const database = createDatabase()
      const repository = new DomainRepository(database)
      repository.upsertDns(binding({ dns_status: 'propagated' }))
      setActiveEvidence(database)
      expect(repository.getByHostname('app.example.com')?.route_status).toBe('active')
      vi.spyOn(repository, 'getSharedIngressInventory').mockReturnValue(snapshot)
      vi.spyOn(repository, 'getSharedIngressReconcileObservation').mockReturnValue(observation)

      expect(repository.recordProductionHttpsPrecheckFailure({
        snapshot, binding: snapshot.bindings[0], generation: observation.generation,
        configSha256: observation.config_sha256, checkedAt: '2026-10-17T00:00:00Z', reasonCode
      })).toBe(true)
      expect(repository.getByHostname('app.example.com')).toMatchObject({
        route_status: 'degraded', ingress_reason_code: reasonCode,
        https_probe_status: 'not_run', https_probe_peer_ip: null,
        https_probe_peer_ips_json: null
      })
      database.close()
    }

    const database = createDatabase()
    const repository = new DomainRepository(database)
    repository.upsertDns(binding({ dns_status: 'propagated' }))
    setActiveEvidence(database)
    vi.spyOn(repository, 'getSharedIngressInventory').mockReturnValue(snapshot)
    vi.spyOn(repository, 'getSharedIngressReconcileObservation').mockReturnValue(observation)
    database.prepare(`UPDATE domain_binding SET route_status='pending', desired_generation=2,
      observed_generation=0, route_config_generation=? WHERE id=1`).run('d'.repeat(64))
    expect(repository.recordProductionHttpsPrecheckFailure({
      snapshot, binding: snapshot.bindings[0], generation: observation.generation,
      configSha256: observation.config_sha256, checkedAt: '2026-10-17T00:00:00Z',
      reasonCode: 'DNS_NOT_PROPAGATED'
    })).toBe(false)
    expect(repository.getByHostname('app.example.com')).toMatchObject({
      route_status: 'pending', desired_generation: 2
    })
    database.close()
  })

  it('rejects active without propagated DNS, certificate proof, external probe, or checked time', () => {
    const database = createDatabase()
    const repository = new DomainRepository(database)
    repository.upsertDns(binding({ dns_status: 'pending' }))

    expect(() => repository.recordIngressObservation(observation())).toThrow(/VALIDATION/)
    repository.upsertDns(binding({ dns_status: 'propagated' }))
    expect(() =>
      repository.recordIngressObservation(observation({ certificate_status: 'pending' }))
    ).toThrow(/VALIDATION/)
    expect(() =>
      repository.recordIngressObservation(observation({ https_probe_status: 'failed' }))
    ).toThrow(/VALIDATION/)
    expect(() =>
      repository.recordIngressObservation(observation({ https_probe_checked_at: null }))
    ).toThrow(/VALIDATION/)
    expect(() =>
      repository.recordIngressObservation(observation({ https_probe_hostname: 'other.example.com' }))
    ).toThrow(/VALIDATION/)
    expect(() =>
      database
        .prepare("UPDATE domain_binding SET route_status='active' WHERE hostname=?")
        .run('app.example.com')
    ).toThrow(/domain_https_active_requires_verified_evidence/)
    expect(repository.getByHostname('app.example.com')?.route_status).toBe('not_configured')
    database.close()
  })

  it('invalidates active evidence for every route identity or ownership field change', () => {
    const mutations: Array<{ column: string; value: string | number; reject?: boolean }> = [
      { column: 'app_id', value: 4 },
      { column: 'hostname', value: 'renamed.example.com' },
      { column: 'mode', value: 'direct_port', reject: true },
      { column: 'target', value: '203.0.113.9' },
      { column: 'record_type', value: 'AAAA' },
      { column: 'record_name', value: 'other.example.com' },
      { column: 'ownership_key', value: 'dns-owner:changed' },
      { column: 'route_ownership_key', value: 'route-owner:changed' }
    ]

    for (const mutation of mutations) {
      const database = createDatabase()
      const repository = new DomainRepository(database)
      repository.upsertDns(binding({ dns_status: 'propagated' }))
      setActiveEvidence(database)

      const update = database.prepare(`UPDATE domain_binding SET ${mutation.column}=? WHERE id=1`)
      if (mutation.reject) {
        expect(() => update.run(mutation.value)).toThrow(/domain_https_active_requires_shared_ingress/)
        expect(database.prepare('SELECT route_status FROM domain_binding WHERE id=1').get()).toEqual({
          route_status: 'active'
        })
      } else {
        update.run(mutation.value)
        expect(
          database
            .prepare(`SELECT route_status, desired_generation, observed_generation,
              certificate_status, https_probe_status, route_checked_at,
              certificate_checked_at, certificate_hostname, https_probe_checked_at,
              https_probe_hostname, route_config_generation, route_inventory_revision,
              route_environment, https_probe_peer_ip, https_probe_http_status,
              https_probe_generation, https_probe_inventory_revision, https_probe_environment
              FROM domain_binding WHERE id=1`)
            .get()
        ).toEqual({
          route_status: 'pending',
          desired_generation: 2,
          observed_generation: 0,
          certificate_status: 'not_requested',
          https_probe_status: 'not_run',
          route_checked_at: null,
          certificate_checked_at: null,
          certificate_hostname: null,
          https_probe_checked_at: null,
          https_probe_hostname: null,
          route_config_generation: null,
          route_inventory_revision: null,
          route_environment: null,
          https_probe_peer_ip: null,
          https_probe_http_status: null,
          https_probe_generation: null,
          https_probe_inventory_revision: null,
          https_probe_environment: null
        })
      }
      database.close()
    }
  })
})
