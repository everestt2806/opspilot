import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { DomainRepository } from './repository'

describe('DomainRepository', () => {
  it('upsert desired-state theo hostname và không lưu credential', () => {
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
        evidence_json TEXT,
        updated_at TEXT
      )
    `)
    const repository = new DomainRepository(database)
    repository.upsert({
      app_id: 3,
      hostname: 'app.example.com',
      mode: 'direct_port',
      provider: 'cloudflare',
      zone_id: 'zone-1',
      record_type: 'A',
      record_name: 'app.example.com',
      target: '203.0.113.5',
      ownership_key: 'opspilot:3:app.example.com',
      status: 'pending',
      evidence_json: JSON.stringify({ message: 'created' })
    })
    repository.upsert({
      app_id: 3,
      hostname: 'app.example.com',
      mode: 'direct_port',
      provider: 'cloudflare',
      zone_id: 'zone-1',
      record_type: 'A',
      record_name: 'app.example.com',
      target: '203.0.113.6',
      ownership_key: 'opspilot:3:app.example.com',
      status: 'propagated'
    })

    expect(database.prepare('SELECT COUNT(*) AS count FROM domain_binding').get()).toEqual({
      count: 1
    })
    expect(
      database.prepare('SELECT target,status,evidence_json FROM domain_binding').get()
    ).toEqual({ target: '203.0.113.6', status: 'propagated', evidence_json: null })
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%token%'").get()).toBe(
      undefined
    )
    database.close()
  })

  it('guard SQL: từ chối chuyển binding sang app hoặc ownership_key khác khi bị race condition', () => {
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
        evidence_json TEXT,
        updated_at TEXT
      )
    `)
    const repository = new DomainRepository(database)
    // App 1 tạo binding
    repository.upsert({
      app_id: 1,
      hostname: 'app.example.com',
      mode: 'direct_port',
      provider: 'cloudflare',
      zone_id: 'zone-1',
      record_type: 'A',
      record_name: 'app.example.com',
      target: '203.0.113.1',
      ownership_key: 'opspilot:1:app.example.com',
      status: 'propagated'
    })

    // App 2 cố overwrite binding của App 1 (mô phỏng race condition vượt qua IPC precheck)
    try {
      repository.upsert({
        app_id: 2,
        hostname: 'app.example.com',
        mode: 'direct_port',
        provider: 'cloudflare',
        zone_id: 'zone-1',
        record_type: 'A',
        record_name: 'app.example.com',
        target: '203.0.113.2',
        ownership_key: 'opspilot:2:app.example.com',
        status: 'pending'
      })
      expect.unreachable('Cần ném lỗi khi race condition xảy ra')
    } catch (err) {
      expect((err as Error).message).toBe('VALIDATION')
      expect((err as { userMessage?: string }).userMessage).toContain('Xung đột quyền sở hữu')
    }

    // Kiểm tra dữ liệu trong DB vẫn giữ nguyên của App 1
    const row = database
      .prepare('SELECT app_id, ownership_key, target FROM domain_binding')
      .get() as {
      app_id: number
      ownership_key: string
      target: string
    }
    expect(row.app_id).toBe(1)
    expect(row.ownership_key).toBe('opspilot:1:app.example.com')
    expect(row.target).toBe('203.0.113.1')
    database.close()
  })
})
