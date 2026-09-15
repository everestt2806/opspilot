import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { closeDatabase, initializeDatabase } from '../db'
import type { App } from '../../shared/ipc'
import { MigrateService } from './service'

describe('MigrateService guards and confirmation', () => {
  it('allocates the target port after excluding live listeners on the target VPS', async () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-port-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'),('target','127.0.0.2','u','password','x'); INSERT INTO app (vps_id,name,framework,source_path,host_port,container_port) VALUES (1,'demo','express','C:/demo',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'demo:v1','running'); UPDATE app SET current_deployment_id=1 WHERE id=1;"
      )
      const exec = vi.fn().mockResolvedValue({
        code: 0,
        stdout: 'LISTEN 0 4096 0.0.0.0:30000 0.0.0.0:*\nLISTEN 0 4096 [::]:30001 [::]:*\n',
        stderr: ''
      })
      const service = new MigrateService(database, { exec } as never, vi.fn())
      const privateService = service as unknown as {
        createTargetApp(source: App, targetVpsId: number, signal: AbortSignal): Promise<App>
      }
      const source = database
        .prepare("SELECT a.*, 'http://127.0.0.1:' || a.host_port AS url FROM app a WHERE id=1")
        .get() as App

      const target = await privateService.createTargetApp(source, 2, new AbortController().signal)

      expect(target.host_port).toBe(30002)
      expect(exec).toHaveBeenCalledWith(2, 'ss -H -ltn', expect.any(Object))
    } finally {
      closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('removes a target record when rollback happens before its remote directory exists', async () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-cleanup-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'),('target','127.0.0.2','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'demo','express',30000,3000),(2,'demo-target','express',30001,3000);"
      )
      const exec = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })
      const service = new MigrateService(database, { exec } as never, vi.fn())
      const privateService = service as unknown as {
        cleanupTarget(job: { target_vps_id: number }, target: App): Promise<boolean>
      }
      const target = database
        .prepare("SELECT a.*, 'http://127.0.0.2:' || a.host_port AS url FROM app a WHERE id=2")
        .get() as App

      await expect(privateService.cleanupTarget({ target_vps_id: 2 }, target)).resolves.toBe(true)
      expect(database.prepare('SELECT COUNT(*) AS count FROM app WHERE id=2').get()).toEqual({
        count: 0
      })
      expect(exec.mock.calls[0]?.[1]).toContain('if [ -f "$target_dir/docker-compose.yml" ]')
    } finally {
      closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('logs the failing precheck check, persists error_message and reports the reason on rollback', async () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-log-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'),('target','127.0.0.2','u','password','x'); INSERT INTO app (vps_id,name,framework,source_path,host_port,container_port) VALUES (1,'demo','express','C:/demo',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'demo:v1','running'); UPDATE app SET current_deployment_id=1 WHERE id=1;"
      )
      const events: unknown[] = []
      const exec = vi.fn().mockResolvedValue({
        code: 0,
        stdout: 'RAM_MB|100\nDISK_GB|31G\nDOCKER|Docker version 29.7.2\n',
        stderr: ''
      })
      const service = new MigrateService(database, { exec } as never, (event) => events.push(event))

      const { job_id } = service.start({ app_id: 1, target_vps_id: 2 })
      const deadline = Date.now() + 5_000
      let job: { status: string } | undefined
      while (Date.now() < deadline) {
        job = database.prepare('SELECT status FROM migration_job WHERE id=?').get(job_id) as {
          status: string
        }
        if (job.status === 'rolled_back' || job.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }

      expect(job?.status).toBe('rolled_back')
      const row = database
        .prepare('SELECT failed_step, error_message FROM migration_job WHERE id=?')
        .get(job_id) as { failed_step: string | null; error_message: string | null }
      expect(row.failed_step).toBe('preparing')
      expect(row.error_message).toContain('PRECHECK_FAILED')
      expect(row.error_message).toContain('RAM trống')
      expect(events).toContainEqual({
        type: 'finished',
        job_id,
        status: 'rolled_back',
        downtime_ms: 0,
        error: expect.stringContaining('PRECHECK_FAILED')
      })
      const logs = events.filter(
        (event): event is { type: 'log'; chunk: string } =>
          typeof event === 'object' && event !== null && (event as { type?: string }).type === 'log'
      )
      expect(
        logs.some((event) => event.chunk.includes('FAIL') && event.chunk.includes('RAM trống'))
      ).toBe(true)
      expect(logs.some((event) => event.chunk.includes('Gợi ý xử lý'))).toBe(true)
    } finally {
      closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    }
  })

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

  it('removes stale /tmp artifacts before packing so fs.protected_regular cannot block tar', async () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-stale-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'); INSERT INTO app (vps_id,name,framework,source_path,host_port,container_port) VALUES (1,'demo','express','C:/demo',30000,3000);"
      )
      const exec = vi.fn().mockResolvedValue({ code: 0, stdout: 'abc 22704', stderr: '' })
      const service = new MigrateService(database, { exec } as never, vi.fn())
      const privateService = service as unknown as {
        backup(
          job: { id: number; source_vps_id: number },
          source: App,
          sourceDir: string,
          signal: AbortSignal
        ): Promise<{ bytes: number; artifacts: Array<{ sha256: string; size: number }> }>
      }
      const source = database
        .prepare("SELECT a.*, 'http://127.0.0.1:' || a.host_port AS url FROM app a WHERE id=1")
        .get() as App

      const result = await privateService.backup(
        { id: 4, source_vps_id: 1 },
        source,
        '/opt/opspilot/demo',
        new AbortController().signal
      )

      expect(result.bytes).toBe(22704)
      const firstCommand = String(exec.mock.calls[0]?.[1])
      expect(firstCommand).toContain('rm -f')
      expect(firstCommand).toContain('/tmp/opspilot-migrate-4.tar.gz')
      expect(firstCommand).toContain('/tmp/opspilot-migrate-4.dump')
      const tarCommand = exec.mock.calls
        .map((call) => String(call[1]))
        .find((command) => command.includes('tar czf'))
      expect(tarCommand).toBeDefined()
    } finally {
      closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('cleans /tmp artifacts on both VPSes after confirming a migration', async () => {
    const directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-migrate-clean-'))
    const database = initializeDatabase(directory)
    try {
      database.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('source','127.0.0.1','u','password','x'),('target','127.0.0.2','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'demo','express',30000,3000),(2,'demo-m123','express',30001,3000); INSERT INTO migration_job (app_id,source_vps_id,target_vps_id,status,verify_json) VALUES (1,1,2,'awaiting_confirm','{\"target_app_id\":2}');"
      )
      const exec = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })
      const service = new MigrateService(database, { exec } as never, vi.fn())
      await service.confirm(1, true)

      const removeCommands = exec.mock.calls
        .map((call) => String(call[1]))
        .filter((command) => command.includes('rm -f') && command.includes('opspilot-migrate-1'))
      expect(removeCommands.length).toBe(2)
      expect(exec.mock.calls.some((call) => call[0] === 1)).toBe(true)
      expect(exec.mock.calls.some((call) => call[0] === 2)).toBe(true)
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
