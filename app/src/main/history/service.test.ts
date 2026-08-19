import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type Database from 'better-sqlite3'

import { closeDatabase, initializeDatabase } from '../db'
import { ActionLogRepository } from '../db/actionLogRepository'

import { HistoryService } from './service'

let service: HistoryService
let repository: ActionLogRepository
let database: Database.Database

beforeEach(() => {
  const directory = mkdtempSync(join(tmpdir(), 'opspilot-history-'))
  database = initializeDatabase(directory)
  repository = new ActionLogRepository(database)
  service = new HistoryService(repository)
})

afterEach(() => {
  closeDatabase()
})

const TS_1 = '2026-08-19T10:00:00Z'
const TS_2 = '2026-08-19T11:00:00Z'
const TS_3 = '2026-08-20T10:00:00Z'

/** insert rồi đặt lại ts để test lọc thời gian xác định (cột ts có DEFAULT khi insert). */
function seed(action: string, status: 'success' | 'failed', vpsId: number, ts: string): void {
  const id = repository.insert({ action, status, vps_id: vpsId })
  database.prepare('UPDATE action_log SET ts = ? WHERE id = ?').run(ts, id)
}

describe('HistoryService', () => {
  it('tra ve ban ghi moi truoc, dung limit va offset', () => {
    seed('deploy', 'success', 1, TS_1)
    seed('rollback_auto', 'success', 1, TS_2)
    seed('deploy', 'failed', 2, TS_3)

    const rows = service.list({ limit: 2, offset: 0 })

    expect(rows).toHaveLength(2)
    expect(rows[0].action).toBe('deploy')
    expect(rows[0].vps_id).toBe(2)
    expect(rows[1].action).toBe('rollback_auto')

    expect(service.list({ limit: 2, offset: 2 })).toHaveLength(1)
  })

  it('loc theo action, vps va khoang thoi gian', () => {
    seed('deploy', 'success', 1, TS_1)
    seed('deploy', 'failed', 2, TS_2)
    seed('rollback_auto', 'success', 1, TS_3)

    expect(service.list({ actions: ['deploy'], limit: 10, offset: 0 })).toHaveLength(2)

    const byVps = service.list({ vps_id: 1, limit: 10, offset: 0 })
    expect(byVps.map((row) => row.action)).toEqual(['rollback_auto', 'deploy'])

    const byTime = service.list({ from_ts: TS_1, to_ts: TS_2, limit: 10, offset: 0 })
    expect(byTime).toHaveLength(2)

    expect(service.list({ from_ts: TS_3, limit: 10, offset: 0 })).toHaveLength(1)
  })

  it('tu choi bo loc sai: limit khong hop le, thoi gian khong dung ISO', () => {
    seed('deploy', 'success', 1, TS_1)

    expect(() => service.list({ limit: 0, offset: 0 })).toThrow('VALIDATION')
    expect(() => service.list({ limit: -5, offset: 0 })).toThrow('VALIDATION')
    expect(() => service.list({ limit: 10, offset: 0, from_ts: 'hom qua' })).toThrow('VALIDATION')
  })
})
