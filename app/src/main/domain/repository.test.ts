import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import type { DomainIngressState } from '@shared/ipc'

import { DomainRepository, type DomainDnsBindingInput } from './repository'

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
      updated_at TEXT
    );
    CREATE UNIQUE INDEX idx_domain_binding_route_ownership
      ON domain_binding(route_ownership_key);
    CREATE TRIGGER domain_binding_active_requires_https_update
    BEFORE UPDATE OF route_status, dns_status, certificate_status, https_probe_status,
      desired_generation, observed_generation, route_checked_at, certificate_checked_at,
      certificate_hostname, https_probe_checked_at, https_probe_hostname ON domain_binding
    WHEN NEW.route_status = 'active' AND (
      NEW.dns_status <> 'propagated' OR NEW.certificate_status <> 'valid' OR
      NEW.https_probe_status <> 'passed' OR NEW.desired_generation <> NEW.observed_generation OR
      NEW.certificate_hostname IS NOT NEW.hostname OR NEW.https_probe_hostname IS NOT NEW.hostname OR
      NEW.route_checked_at IS NULL OR NEW.certificate_checked_at IS NULL OR
      NEW.https_probe_checked_at IS NULL
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
          certificate_hostname=NULL, https_probe_checked_at=NULL, https_probe_hostname=NULL
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

    const active = repository.recordIngressObservation(observation())
    expect(active).toMatchObject<Partial<DomainIngressState>>({
      dns_status: 'propagated',
      route_status: 'active',
      certificate_status: 'valid',
      https_probe_status: 'passed',
      desired_generation: 1,
      observed_generation: 1
    })

    repository.upsertDns(binding({ target: '203.0.113.6', dns_status: 'propagated' }))
    expect(repository.getByHostname('app.example.com')).toMatchObject({
      route_status: 'pending',
      https_probe_status: 'not_run',
      desired_generation: 2,
      observed_generation: 0
    })
    expect(() => repository.recordIngressObservation(observation({ generation: 1 }))).toThrow(
      /VALIDATION/
    )
    expect(
      repository.recordIngressObservation(observation({ generation: 2 }))
    ).toMatchObject({ route_status: 'active', desired_generation: 2, observed_generation: 2 })
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
      repository.recordIngressObservation(observation())

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
              https_probe_hostname FROM domain_binding WHERE id=1`)
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
          https_probe_hostname: null
        })
      }
      database.close()
    }
  })
})
