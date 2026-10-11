import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: handleMock },
  shell: { openExternal: vi.fn() }
}))

import { AppError } from './errors'
import { handle, registerIpcHandlers } from './ipc'
import { closeDatabase, initializeDatabase } from './db'
import { MonitorService } from './monitor/service'

describe('handle', () => {
  beforeEach(() => {
    handleMock.mockReset()
  })

  it('boc du lieu thanh IpcResult ok', async () => {
    handle('vps:list', () => [])
    const callback = handleMock.mock.calls[0]?.[1]

    await expect(callback({})).resolves.toEqual({ ok: true, data: [] })
  })

  it('boc AppError thanh IpcResult error', async () => {
    handle('vps:list', () => {
      throw new AppError('DB_ERROR', 'Không đọc được VPS. Hãy thử lại.')
    })
    const callback = handleMock.mock.calls[0]?.[1]

    await expect(callback({})).resolves.toEqual({
      ok: false,
      error: {
        code: 'DB_ERROR',
        message: 'Không đọc được VPS. Hãy thử lại.',
        technical: undefined,
        step: undefined
      }
    })
  })

  it('disconnects a removed VPS after archiving its local profile', async () => {
    const events: string[] = []
    const vpsService = {
      delete: vi.fn(() => events.push('archive'))
    }
    const ssh = {
      disconnect: vi.fn(async () => {
        events.push('disconnect')
      })
    }
    registerIpcHandlers(
      {} as never,
      vpsService as never,
      ssh as never,
      {} as never,
      {} as never,
      () => null
    )
    const callback = handleMock.mock.calls.find(([channel]) => channel === 'vps:delete')?.[1] as (
      event: unknown,
      id: number
    ) => Promise<unknown>

    await expect(callback({}, 7)).resolves.toEqual({ ok: true, data: undefined })
    expect(vpsService.delete).toHaveBeenCalledWith(7)
    expect(ssh.disconnect).toHaveBeenCalledWith(7)
    expect(events).toEqual(['archive', 'disconnect'])
  })

  it('invokes read-only VPS diagnostics with vpsId only and wraps validation errors', async () => {
    const ssh = {
      exec: vi.fn(async (_vpsId: number, command: string) => ({
        code: 0,
        stdout: command.includes('/proc/pressure/memory')
          ? 'some avg10=0.1 avg60=0.1 avg300=0.1 total=1\nfull avg10=0.0 avg60=0.0 avg300=0.0 total=0'
          : command.includes('/proc/vmstat')
            ? 'oom_kill 0\n'
            : 'PID RSS COMMAND\n22 512 electron'
      }))
    }
    registerIpcHandlers(
      {} as never,
      {} as never,
      ssh as never,
      {} as never,
      {} as never,
      () => null
    )
    const callback = handleMock.mock.calls.find(
      ([registered]) => registered === 'vps:get-operational-diagnostics'
    )?.[1] as (event: unknown, vpsId: number) => Promise<unknown>

    await expect(callback({}, 2)).resolves.toMatchObject({
      ok: true,
      data: {
        top_processes_available: true,
        top_processes: [{ pid: 22, name: 'electron', rss_mb: 0.5 }],
        memory_pressure: { some_avg10: 0.1, full_avg10: 0 },
        oom_kill_count: 0
      }
    })
    expect(ssh.exec).toHaveBeenCalledTimes(3)
    expect(ssh.exec.mock.calls.every(([id]) => id === 2)).toBe(true)

    await expect(callback({}, 0)).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(ssh.exec).toHaveBeenCalledTimes(3)

    ssh.exec.mockRejectedValueOnce(new AppError('VALIDATION', 'Unknown VPS'))
    await expect(callback({}, 999)).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
  })

  it('dieu khien custom title bar tren dung BrowserWindow', async () => {
    let maximized = false
    const window = {
      minimize: vi.fn(),
      maximize: vi.fn(() => {
        maximized = true
      }),
      unmaximize: vi.fn(() => {
        maximized = false
      }),
      isMaximized: vi.fn(() => maximized),
      close: vi.fn(),
      setTitleBarOverlay: vi.fn()
    }

    registerIpcHandlers(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      () => window
    )
    const callbackFor = (channel: string): ((...args: unknown[]) => Promise<unknown>) => {
      const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
      expect(callback).toBeTypeOf('function')
      return callback
    }

    await expect(callbackFor('window:toggle-maximize')({})).resolves.toEqual({
      ok: true,
      data: { maximized: true }
    })
    expect(window.maximize).toHaveBeenCalledOnce()

    await expect(callbackFor('window:toggle-maximize')({})).resolves.toEqual({
      ok: true,
      data: { maximized: false }
    })
    expect(window.unmaximize).toHaveBeenCalledOnce()

    await callbackFor('window:minimize')({})
    await callbackFor('window:close')({})
    expect(window.minimize).toHaveBeenCalledOnce()
    expect(window.close).toHaveBeenCalledOnce()

    await expect(
      callbackFor('window:set-titlebar-overlay')(
        {},
        {
          color: '#F3F4F6',
          symbolColor: '#333333'
        }
      )
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(window.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#F3F4F6',
      symbolColor: '#333333'
    })
  })

  it('monitor handlers doc va sua SQLite that', async () => {
    const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-ipc-monitor-'))
    const db = initializeDatabase(dir)
    try {
      db.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v','127.0.0.1','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'app','express',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'app:v1','running'); INSERT INTO metric_sample (deployment_id,seq,ts_vps,ts_local,raw_json,container_up) VALUES (1,1,'2026-08-30T00:00:01Z','2026-08-30T00:00:01Z','{}',1); INSERT INTO alert (deployment_id,metric_sample_id,method,ts_vps,peak_score) VALUES (1,1,'rule','2026-08-30T00:00:01Z',1);"
      )
      const monitor = new MonitorService(db)
      const labelSpy = vi.spyOn(monitor, 'labelAlert')
      registerIpcHandlers(
        { getPort: () => 1234 } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        () => null,
        monitor
      )
      const callbackFor = (
        channel: string
      ): ((event: unknown, ...args: unknown[]) => Promise<unknown>) => {
        const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
        expect(callback).toBeTypeOf('function')
        return callback as (event: unknown, ...args: unknown[]) => Promise<unknown>
      }
      await expect(
        callbackFor('monitor:samples')({}, 1, '2026-08-30T00:00:00Z')
      ).resolves.toMatchObject({
        ok: true,
        data: [expect.objectContaining({ seq: 1 })]
      })
      await expect(
        callbackFor('monitor:scores')({}, 1, '2026-08-30T00:00:00Z')
      ).resolves.toMatchObject({
        ok: true,
        data: [expect.objectContaining({ rule: null })]
      })
      await expect(callbackFor('monitor:alerts')({}, 1, 10)).resolves.toMatchObject({
        ok: true,
        data: [expect.objectContaining({ id: 1 })]
      })
      await expect(callbackFor('monitor:get-setting')({}, 1)).resolves.toMatchObject({
        ok: true,
        data: expect.objectContaining({ app_id: 1 })
      })
      await expect(
        callbackFor('monitor:set-setting')({}, 1, { rule_cpu_pct: 80 })
      ).resolves.toMatchObject({
        ok: true,
        data: expect.objectContaining({ rule_cpu_pct: 80 })
      })
      await expect(callbackFor('monitor:label-alert')({}, 1, 'true_positive')).resolves.toEqual({
        ok: true,
        data: undefined
      })
      expect(labelSpy).toHaveBeenCalledWith(1, 'true_positive')
      const trainResult = await callbackFor('monitor:train-now')({}, 1)
      expect(trainResult).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(
        (db.prepare('SELECT label FROM alert WHERE id=1').get() as { label: string }).label
      ).toBe('true_positive')
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('doctor:diagnose luu run da redact vao SQLite de san sang cho doctor:fix', async () => {
    const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-ipc-doctor-'))
    const db = initializeDatabase(dir)
    try {
      db.exec(
        "INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret) VALUES (1,'v','127.0.0.1','root','password','x'); " +
          "INSERT INTO app (id,vps_id,name,framework,host_port,container_port) VALUES (1,1,'app','express',30000,3000); " +
          "INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES (1,1,1,'app:v1','running');"
      )
      registerIpcHandlers(
        { getPort: () => 1234 } as never,
        {
          getApp: () => ({
            id: 1,
            vps_id: 1,
            name: 'app',
            framework: 'express',
            host_port: 30000,
            container_port: 3000,
            healthcheck_path: '/',
            needs_db: 0,
            current_deployment_id: 1,
            url: 'http://127.0.0.1:30000'
          })
        } as never,
        {} as never,
        {} as never,
        {} as never,
        () => null
      )
      const callbackFor = (
        channel: string
      ): ((event: unknown, ...args: unknown[]) => Promise<unknown>) => {
        const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
        expect(callback).toBeTypeOf('function')
        return callback as (event: unknown, ...args: unknown[]) => Promise<unknown>
      }

      // Gọi doctor:diagnose kèm token nhạy cảm trong logs
      const diagResult = await callbackFor('doctor:diagnose')(
        {},
        {
          deployment_id: 1,
          evidence: {
            container_state: { status: 'running' },
            external_probe: 'unreachable',
            logs: 'connecting with token=secret123'
          }
        }
      )
      expect(diagResult).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          code: 'PORT_BLOCKED_EXTERNAL',
          safe_to_auto_fix: true,
          fix_id: 'reconcile_firewall'
        })
      })

      // Kiểm tra DB doctor_run được tạo và đã che token
      const run = db.prepare('SELECT * FROM doctor_run WHERE deployment_id = 1').get() as {
        id: number
        outcome: string
        diagnosis_code: string
        evidence_json: string
      }
      expect(run).toBeDefined()
      expect(run.outcome).toBe('pending')
      expect(run.diagnosis_code).toBe('PORT_BLOCKED_EXTERNAL')
      expect(run.evidence_json).not.toContain('secret123')
      expect(run.evidence_json).toContain('token=***')
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('domain:plan lập hướng dẫn chính xác cho các mode', async () => {
    registerIpcHandlers({} as never, {} as never, {} as never, {} as never, {} as never, () => null)
    const callbackFor = (
      channel: string
    ): ((event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
      expect(callback).toBeTypeOf('function')
      return callback as (event: unknown, ...args: unknown[]) => Promise<unknown>
    }

    const planDirect = await callbackFor('domain:plan')(
      {},
      {
        hostname: 'app.example.com',
        target: '203.0.113.10',
        app_port: 30000,
        mode: 'direct_port'
      }
    )
    expect(planDirect).toEqual({
      ok: true,
      data: expect.objectContaining({
        record_type: 'A',
        public_url: 'http://app.example.com:30000',
        instructions: expect.arrayContaining(['Mở TCP 30000 trên firewall.'])
      })
    })

    const planTunnel = await callbackFor('domain:plan')(
      {},
      {
        hostname: 'app.example.com',
        target: 'tunnel.target.com',
        app_port: 30000,
        mode: 'named_tunnel'
      }
    )
    expect(planTunnel).toEqual({
      ok: true,
      data: expect.objectContaining({
        record_type: 'CNAME',
        public_url: 'https://app.example.com',
        instructions: expect.arrayContaining([expect.stringContaining('tunnel')])
      })
    })
  })

  describe('domain:upsert IPC', () => {
    it('upsert thành công: idempotent, không lưu scoped token vào SQLite', async () => {
      const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-ipc-domain-'))
      const db = initializeDatabase(dir)
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      try {
        db.exec(
          "INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret) VALUES (1,'v','198.51.100.1','root','password','x'); " +
            "INSERT INTO app (id,vps_id,name,framework,host_port,container_port) VALUES (1,1,'app','express',30000,3000); " +
            "INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES (1,1,1,'app:v1','running');"
        )
        registerIpcHandlers(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          () => null
        )
        const callbackFor = (
          channel: string
        ): ((event: unknown, ...args: unknown[]) => Promise<unknown>) => {
          const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
          return callback as (event: unknown, ...args: unknown[]) => Promise<unknown>
        }

        // Mock Cloudflare API responses:
        // 1. GET returns empty (no existing records)
        // 2. POST returns created record
        fetchSpy
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, result: [] })
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              success: true,
              result: {
                id: 'cf-rec-1',
                type: 'A',
                name: 'app.example.com',
                content: '198.51.100.1',
                ttl: 300,
                proxied: false,
                comment: 'opspilot:1:app.example.com'
              }
            })
          } as Response)

        const scopedToken = 'cf_secret_token_123456789'
        const result = (await callbackFor('domain:upsert')(
          {},
          {
            deployment_id: 1,
            hostname: 'app.example.com',
            mode: 'direct_port',
            provider: 'cloudflare',
            api_token: scopedToken,
            zone_id: '0123456789abcdef0123456789abcdef'
          }
        )) as { ok: boolean; data?: { status: string; hostname: string } }

        expect(result.ok).toBe(true)
        expect(result.data?.hostname).toBe('app.example.com')

        // Kiểm tra domain_binding trong SQLite
        const binding = db
          .prepare('SELECT * FROM domain_binding WHERE hostname = ?')
          .get('app.example.com') as {
          app_id: number
          hostname: string
          provider: string
          ownership_key: string
          status: string
          evidence_json: string
        }
        expect(binding).toBeDefined()
        expect(binding.app_id).toBe(1)
        expect(binding.ownership_key).toBe('opspilot:1:app.example.com')

        // Tuyệt đối không lưu token vào bất kỳ trường nào trong SQLite
        expect(JSON.stringify(binding)).not.toContain(scopedToken)
        expect(binding.evidence_json).not.toContain(scopedToken)
      } finally {
        fetchSpy.mockRestore()
        closeDatabase()
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('xung đột ownership trong DB: từ chối khi hostname đã gắn cho app khác', async () => {
      const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-ipc-domain-conflict-'))
      const db = initializeDatabase(dir)
      try {
        db.exec(
          "INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret) VALUES (1,'v','198.51.100.1','root','password','x'); " +
            "INSERT INTO app (id,vps_id,name,framework,host_port,container_port) VALUES (1,1,'app1','express',30000,3000), (2,1,'app2','express',30001,3000); " +
            "INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES (1,1,1,'app1:v1','running'), (2,2,1,'app2:v1','running'); " +
            "INSERT INTO domain_binding (id,app_id,hostname,mode,ownership_key,status) VALUES (1,1,'shared.example.com','direct_port','opspilot:1:shared.example.com','propagated');"
        )
        registerIpcHandlers(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          () => null
        )
        const callbackFor = (
          channel: string
        ): ((event: unknown, ...args: unknown[]) => Promise<unknown>) => {
          const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
          return callback as (event: unknown, ...args: unknown[]) => Promise<unknown>
        }

        // App 2 cố gắn hostname của App 1
        const result = (await callbackFor('domain:upsert')(
          {},
          {
            deployment_id: 2,
            hostname: 'shared.example.com',
            mode: 'direct_port',
            provider: 'cloudflare',
            api_token: 'dummy-token',
            zone_id: '0123456789abcdef0123456789abcdef'
          }
        )) as { ok: boolean; error?: { code: string; message: string } }

        expect(result.ok).toBe(false)
        expect(result.error?.code).toBe('VALIDATION')
        expect(result.error?.message).toContain('Hostname này đã được gắn cho app khác')
      } finally {
        closeDatabase()
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('xung đột ownership trên Cloudflare: từ chối ghi đè record của bên khác, ghi status conflict và không rò rỉ token', async () => {
      const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-ipc-cf-conflict-'))
      const db = initializeDatabase(dir)
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      try {
        db.exec(
          "INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret) VALUES (1,'v','198.51.100.1','root','password','x'); " +
            "INSERT INTO app (id,vps_id,name,framework,host_port,container_port) VALUES (1,1,'app','express',30000,3000); " +
            "INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES (1,1,1,'app:v1','running');"
        )
        registerIpcHandlers(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          () => null
        )
        const callbackFor = (
          channel: string
        ): ((event: unknown, ...args: unknown[]) => Promise<unknown>) => {
          const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
          return callback as (event: unknown, ...args: unknown[]) => Promise<unknown>
        }

        // Cloudflare trả về record có comment của bên khác
        fetchSpy.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            result: [
              {
                id: 'cf-foreign-9',
                type: 'A',
                name: 'app.example.com',
                content: '1.2.3.4',
                ttl: 300,
                proxied: false,
                comment: 'other-team-fingerprint'
              }
            ]
          })
        } as Response)

        const secretToken = 'secret-token-conflict-test'
        const result = (await callbackFor('domain:upsert')(
          {},
          {
            deployment_id: 1,
            hostname: 'app.example.com',
            mode: 'direct_port',
            provider: 'cloudflare',
            api_token: secretToken,
            zone_id: '0123456789abcdef0123456789abcdef'
          }
        )) as { ok: boolean; error?: { code: string; message: string } }

        expect(result.ok).toBe(false)
        expect(result.error?.code).toBe('VALIDATION')
        expect(result.error?.message).toContain('Xung đột quyền sở hữu')

        // DB ghi nhận trạng thái 'conflict' và không chứa token
        const binding = db
          .prepare('SELECT * FROM domain_binding WHERE hostname = ?')
          .get('app.example.com') as { status: string; evidence_json: string }
        expect(binding).toBeDefined()
        expect(binding.status).toBe('conflict')
        expect(binding.evidence_json).toContain('Xung đột quyền sở hữu')
        expect(binding.evidence_json).not.toContain(secretToken)
      } finally {
        fetchSpy.mockRestore()
        closeDatabase()
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('lỗi provider: ghi status failed và không lưu token vào SQLite', async () => {
      const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-ipc-cf-err-'))
      const db = initializeDatabase(dir)
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      try {
        db.exec(
          "INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret) VALUES (1,'v','198.51.100.1','root','password','x'); " +
            "INSERT INTO app (id,vps_id,name,framework,host_port,container_port) VALUES (1,1,'app','express',30000,3000); " +
            "INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES (1,1,1,'app:v1','running');"
        )
        registerIpcHandlers(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          () => null
        )
        const callbackFor = (
          channel: string
        ): ((event: unknown, ...args: unknown[]) => Promise<unknown>) => {
          const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
          return callback as (event: unknown, ...args: unknown[]) => Promise<unknown>
        }

        // Cloudflare trả về lỗi 403
        fetchSpy.mockResolvedValueOnce({
          ok: false,
          json: async () => ({
            success: false,
            errors: [{ code: 10000, message: 'Authentication error' }]
          })
        } as Response)

        const secretToken = 'secret-token-err-test'
        const result = (await callbackFor('domain:upsert')(
          {},
          {
            deployment_id: 1,
            hostname: 'app.example.com',
            mode: 'direct_port',
            provider: 'cloudflare',
            api_token: secretToken,
            zone_id: '0123456789abcdef0123456789abcdef'
          }
        )) as { ok: boolean; error?: { code: string; message: string } }

        expect(result.ok).toBe(false)
        expect(result.error?.code).toBe('UNKNOWN')

        // DB ghi nhận trạng thái 'failed' và không chứa token
        const binding = db
          .prepare('SELECT * FROM domain_binding WHERE hostname = ?')
          .get('app.example.com') as { status: string; evidence_json: string }
        expect(binding).toBeDefined()
        expect(binding.status).toBe('failed')
        expect(binding.evidence_json).not.toContain(secretToken)
      } finally {
        fetchSpy.mockRestore()
        closeDatabase()
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('chặn domain:upsert với mode named_tunnel khi chưa có CNAME target/tunnel thật', async () => {
      const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-ipc-cf-tunnel-'))
      const db = initializeDatabase(dir)
      try {
        db.exec(
          "INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret) VALUES (1,'v','198.51.100.1','root','password','x'); " +
            "INSERT INTO app (id,vps_id,name,framework,host_port,container_port) VALUES (1,1,'app','express',30000,3000); " +
            "INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES (1,1,1,'app:v1','running');"
        )
        registerIpcHandlers(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          () => null
        )
        const callbackFor = (
          channel: string
        ): ((event: unknown, ...args: unknown[]) => Promise<unknown>) => {
          const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
          return callback as (event: unknown, ...args: unknown[]) => Promise<unknown>
        }

        const result = (await callbackFor('domain:upsert')(
          {},
          {
            deployment_id: 1,
            hostname: 'app.example.com',
            mode: 'named_tunnel',
            provider: 'cloudflare',
            api_token: 'dummy-token',
            zone_id: '0123456789abcdef0123456789abcdef'
          }
        )) as { ok: boolean; error?: { code: string; message: string } }

        expect(result.ok).toBe(false)
        expect(result.error?.code).toBe('VALIDATION')
        expect(result.error?.message).toContain('Mode named_tunnel yêu cầu CNAME target của tunnel')
      } finally {
        closeDatabase()
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('che cả Bearer token và mật khẩu URL trong lỗi provider trước khi trả IPC', async () => {
      const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-ipc-cf-redact-'))
      const db = initializeDatabase(dir)
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      try {
        db.exec(
          "INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret) VALUES (1,'v','198.51.100.1','root','password','x'); " +
            "INSERT INTO app (id,vps_id,name,framework,host_port,container_port) VALUES (1,1,'app','express',30000,3000); " +
            "INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES (1,1,1,'app:v1','running');"
        )
        registerIpcHandlers(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          () => null
        )
        const callbackFor = (
          channel: string
        ): ((event: unknown, ...args: unknown[]) => Promise<unknown>) => {
          const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
          return callback as (event: unknown, ...args: unknown[]) => Promise<unknown>
        }

        // Mock error containing Bearer token and URL password
        fetchSpy.mockResolvedValueOnce({
          ok: false,
          json: async () => ({
            success: false,
            errors: [
              {
                code: 10000,
                message:
                  'Upstream error at https://user:superSecretPass123@api.cloudflare.com with Bearer eyJhbGciOiJIUzI1NiJ9.leakToken'
              }
            ]
          })
        } as Response)

        const result = (await callbackFor('domain:upsert')(
          {},
          {
            deployment_id: 1,
            hostname: 'app.example.com',
            mode: 'direct_port',
            provider: 'cloudflare',
            api_token: 'valid-api-token',
            zone_id: '0123456789abcdef0123456789abcdef'
          }
        )) as { ok: boolean; error?: { code: string; message: string } }

        expect(result.ok).toBe(false)
        expect(result.error?.message).not.toContain('superSecretPass123')
        expect(result.error?.message).not.toContain('leakToken')
        expect(result.error?.message).toContain('https://user:***@api.cloudflare.com')
        expect(result.error?.message).toContain('Bearer ***')

        // Kiểm tra trong DB evidence_json
        const binding = db
          .prepare('SELECT evidence_json FROM domain_binding WHERE hostname = ?')
          .get('app.example.com') as { evidence_json: string }
        expect(binding.evidence_json).not.toContain('superSecretPass123')
        expect(binding.evidence_json).not.toContain('leakToken')
      } finally {
        fetchSpy.mockRestore()
        closeDatabase()
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
