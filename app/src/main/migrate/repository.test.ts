import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { closeDatabase, initializeDatabase } from '../db'
import { MigrationRepository } from './repository'

describe('MigrationRepository', () => {
  it('persists the state machine fields and terminal timestamp', () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-repo-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'),('target','127.0.0.2','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'demo','express',30000,3000);"
      )
      const repository = new MigrationRepository(database)
      const job = repository.create(1, 1, 2)
      expect(job.status).toBe('preparing')
      repository.update(job.id, {
        status: 'awaiting_confirm',
        verify_json: JSON.stringify({ target_app_id: 2 }),
        downtime_ms: 123
      })
      expect(repository.get(job.id)).toMatchObject({ status: 'awaiting_confirm', downtime_ms: 123 })
      repository.update(job.id, { status: 'completed', source_kept: 1 })
      expect(repository.get(job.id).finished_at).toBeTruthy()
    } finally {
      closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
