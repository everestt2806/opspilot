import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { closeDatabase, initializeDatabase } from '../db'
import { MigrateService } from './service'

describe('MigrateService guards and confirmation', () => {
  it('rejects same-VPS migration before creating a job', () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-guard-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'demo','express',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'demo:v1','running'); UPDATE app SET current_deployment_id=1 WHERE id=1;"
      )
      const service = new MigrateService(database, {} as never, vi.fn())
      expect(() => service.start({ app_id: 1, target_vps_id: 1 })).toThrow()
      expect(database.prepare('SELECT COUNT(*) count FROM migration_job').get()).toEqual({
        count: 0
      })
    } finally {
      closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('confirms a verified job and emits completed without deleting the source', async () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-confirm-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'),('target','127.0.0.2','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'demo','express',30000,3000),(2,'demo-m123','express',30001,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'demo:v1','running'),(2,1,'demo-m123:v1','running'); UPDATE app SET current_deployment_id=1 WHERE id=1; UPDATE app SET current_deployment_id=2 WHERE id=2; INSERT INTO migration_job (app_id,source_vps_id,target_vps_id,status,verify_json) VALUES (1,1,2,'awaiting_confirm','{\"target_app_id\":2}');"
      )
      const events: unknown[] = []
      const exec = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })
      const service = new MigrateService(database, { exec } as never, (event) => events.push(event))
      await service.confirm(1, true)
      expect(
        database.prepare('SELECT status,source_kept FROM migration_job WHERE id=1').get()
      ).toEqual({ status: 'completed', source_kept: 1 })
      expect(database.prepare('SELECT COUNT(*) count FROM app WHERE id=1').get()).toEqual({
        count: 1
      })
      expect(events).toContainEqual({
        type: 'finished',
        job_id: 1,
        status: 'completed',
        downtime_ms: 0
      })
      expect(database.prepare('SELECT current_deployment_id FROM app WHERE id=1').get()).toEqual({
        current_deployment_id: 1
      })
      expect(exec).toHaveBeenCalled()
    } finally {
      closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a source without a running deployment', () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-status-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'),('target','127.0.0.2','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'demo','express',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'demo:v1','stopped'); UPDATE app SET current_deployment_id=1 WHERE id=1;"
      )
      const service = new MigrateService(database, {} as never, vi.fn())
      expect(() => service.start({ app_id: 1, target_vps_id: 2 })).toThrow()
      expect(database.prepare('SELECT COUNT(*) count FROM migration_job').get()).toEqual({
        count: 0
      })
    } finally {
      closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps an awaiting job when source recovery fails during confirmation', async () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-recovery-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'),('target','127.0.0.2','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'demo', 'express',30000,3000),(2,'demo-m123','express',30001,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'demo:v1','running'),(2,1,'demo-m123:v1','running'); UPDATE app SET current_deployment_id=1 WHERE id=1; UPDATE app SET current_deployment_id=2 WHERE id=2; INSERT INTO migration_job (app_id,source_vps_id,target_vps_id,status,verify_json) VALUES (1,1,2,'awaiting_confirm','{\"target_app_id\":2}');"
      )
      const exec = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'source unavailable' })
      const service = new MigrateService(database, { exec } as never, vi.fn())
      await expect(service.confirm(1, true)).rejects.toThrow()
      expect(database.prepare('SELECT status FROM migration_job WHERE id=1').get()).toEqual({
        status: 'awaiting_confirm'
      })
      expect(exec).toHaveBeenCalledTimes(1)
    } finally {
      closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a second active migration before any remote command', () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-active-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'),('target','127.0.0.2','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'demo','express',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'demo:v1','running'); UPDATE app SET current_deployment_id=1 WHERE id=1; INSERT INTO migration_job (app_id,source_vps_id,target_vps_id,status) VALUES (1,1,2,'preparing');"
      )
      const exec = vi.fn()
      const service = new MigrateService(database, { exec } as never, vi.fn())
      expect(() => service.start({ app_id: 1, target_vps_id: 2 })).toThrow()
      expect(exec).not.toHaveBeenCalled()
      expect(database.prepare('SELECT COUNT(*) count FROM migration_job').get()).toEqual({
        count: 1
      })
    } finally {
      closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
