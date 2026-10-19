import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, ingressPreflightMock, readinessCheckMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  ingressPreflightMock: vi.fn(),
  readinessCheckMock: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: handleMock },
  shell: { openExternal: vi.fn() }
}))

vi.mock('./domain/ingress/preflight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./domain/ingress/preflight')>()),
  preflightSharedIngress: ingressPreflightMock
}))
vi.mock('./domain/ingress/dnsReadiness', () => ({ checkSharedIngressReadiness: readinessCheckMock }))

import { AppError } from './errors'
import { handle, registerIpcHandlers } from './ipc'
import { closeDatabase, initializeDatabase } from './db'
import { MonitorService } from './monitor/service'
import { SharedIngressService } from './domain/ingress/sharedIngressService'
import { AppRepository } from './db/appRepository'
import { DeploymentRepository } from './db/deploymentRepository'
import { DomainRepository } from './domain/repository'
import { VpsRepository } from './db/vpsRepository'
import type { SharedIngressServiceResult } from './domain/ingress/sharedIngressService'

function ingressCallback(channel: string): (event: unknown, input: unknown) => Promise<unknown> {
  const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
  if (typeof callback !== 'function') throw new Error(`IPC handler was not registered: ${channel}`)
  return callback as (event: unknown, input: unknown) => Promise<unknown>
}

function makeIngressIpcDb(): { dir: string; db: ReturnType<typeof initializeDatabase> } {
  const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-ipc-shared-ingress-'))
  const db = initializeDatabase(dir)
  db.exec(`
    INSERT INTO vps (id,name,host,port,username,auth_type,encrypted_secret)
      VALUES (1,'v1','192.0.2.10',22,'ops','password','cipher');
    INSERT INTO vps (id,name,host,port,username,auth_type,encrypted_secret)
      VALUES (2,'v2','192.0.2.20',22,'ops','password','cipher');
    INSERT INTO app (id,vps_id,name,framework,host_port,container_port,healthcheck_path)
      VALUES (1,1,'app1','express',30001,3000,'/');
    INSERT INTO app (id,vps_id,name,framework,host_port,container_port,healthcheck_path)
      VALUES (2,2,'app2','express',30002,3000,'/');
    INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES (1,1,1,'app1:v1','failed');
    INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES (2,2,1,'app2:v1','running');
    UPDATE app SET current_deployment_id=1 WHERE id=1;
    UPDATE app SET current_deployment_id=2 WHERE id=2;
    INSERT INTO domain_binding (id,app_id,hostname,mode,ownership_key,status)
      VALUES (1,1,'app1.example.test','shared_ingress','dns:1','pending');
  `)
  return { dir, db }
}

function createRealIngressService(
  db: ReturnType<typeof initializeDatabase>,
  ssh: { exec: ReturnType<typeof vi.fn> }
): SharedIngressService {
  return new SharedIngressService({
    vpsRepository: new VpsRepository(db),
    appRepository: new AppRepository(db),
    deploymentRepository: new DeploymentRepository(db),
    domainRepository: new DomainRepository(db),
    ssh: ssh as never,
    policy: { certificateEnvironment: 'production', stagingLabHostnames: [] }
  })
}

function registerIngressService(service: SharedIngressService): void {
  registerIpcHandlers(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    () => null,
    undefined,
    undefined,
    service
  )
}

function serviceResult(
  overrides: Partial<SharedIngressServiceResult> = {}
): SharedIngressServiceResult {
  return {
    operation: 'read',
    status: 'pending',
    failed_step: null,
    reason: null,
    retryable: false,
    http_url: 'http://192.0.2.10:30001',
    route_status: 'not_configured',
    certificate_status: 'not_requested',
    https_probe_status: 'not_run',
    ...overrides
  }
}

describe('shared ingress IPC contract and handlers', () => {
  beforeEach(() => handleMock.mockReset())

  it('keeps shared and documented IPC contract declarations in parity', () => {
    const shared = readFileSync(fileURLToPath(new URL('../shared/ipc.ts', import.meta.url)), 'utf8')
    const contract = readFileSync(
      fileURLToPath(new URL('../../../docs/contracts/ipc-contract.ts', import.meta.url)),
      'utf8'
    )
    const extractTypes = (source: string): string =>
      source.slice(
        source.indexOf('export type SharedIngressAction'),
        source.indexOf('export interface IpcInvokeMap')
      )
    expect(extractTypes(shared)).toBe(extractTypes(contract))
    const channels = (source: string): string[] =>
      source.match(/^\s*'domain:ingress-(?:list|status|action)':.*$/gm) ?? []
    expect(channels(shared)).toEqual(channels(contract))
  })

  it('lists pending bindings and reads status from SQLite without network or fingerprint', async () => {
    const { dir, db } = makeIngressIpcDb()
    const ssh = { exec: vi.fn() }
    try {
      registerIngressService(createRealIngressService(db, ssh))
      await expect(
        ingressCallback('domain:ingress-list')({}, { vps_id: 1, app_id: 1 })
      ).resolves.toMatchObject({
        ok: true,
        data: [
          {
            vps_id: 1,
            binding_id: 1,
            app_id: 1,
            hostname: 'app1.example.test',
            status: 'pending',
            dns_status: 'pending',
            http_url: 'http://192.0.2.10:30001'
          }
        ]
      })
      await expect(
        ingressCallback('domain:ingress-status')({}, { vps_id: 1, binding_id: 1 })
      ).resolves.toMatchObject({
        ok: true,
        data: {
          binding_id: 1,
          hostname: 'app1.example.test',
          status: 'blocked',
          reason: { code: 'APP_OR_DEPLOYMENT_INVALID' },
          http_url: 'http://192.0.2.10:30001'
        }
      })
      expect(ssh.exec).not.toHaveBeenCalled()
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects an app from another VPS and a binding from another VPS', async () => {
    const { dir, db } = makeIngressIpcDb()
    const ssh = { exec: vi.fn() }
    try {
      registerIngressService(createRealIngressService(db, ssh))
      await expect(
        ingressCallback('domain:ingress-list')({}, { vps_id: 1, app_id: 2 })
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' }
      })
      await expect(
        ingressCallback('domain:ingress-status')({}, { vps_id: 2, binding_id: 1 })
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' }
      })
      expect(ssh.exec).not.toHaveBeenCalled()
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    ['list null', 'domain:ingress-list', null],
    ['list missing app', 'domain:ingress-list', { vps_id: 1 }],
    ['list unsafe id', 'domain:ingress-list', { vps_id: Number.MAX_SAFE_INTEGER + 1, app_id: 1 }],
    ['list injected config', 'domain:ingress-list', { vps_id: 1, app_id: 1, config: {} }],
    ['status array', 'domain:ingress-status', []],
    ['status null id', 'domain:ingress-status', { vps_id: 1, binding_id: null }],
    ['action missing', 'domain:ingress-action', { vps_id: 1, binding_id: 1 }],
    ['action unknown', 'domain:ingress-action', { vps_id: 1, binding_id: 1, action: 'start' }],
    [
      'action command injection field',
      'domain:ingress-action',
      { vps_id: 1, binding_id: 1, action: 'reconcile', shell: 'id' }
    ]
  ])('rejects malformed runtime payload: %s', async (_label, channel, input) => {
    const service = {
      listBindings: vi.fn(),
      readStatus: vi.fn(),
      prepareOrInstall: vi.fn(),
      reconcile: vi.fn(),
      checkHttps: vi.fn()
    } as unknown as SharedIngressService
    registerIngressService(service)
    await expect(ingressCallback(channel)({}, input)).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(service.listBindings).not.toHaveBeenCalled()
    expect(service.readStatus).not.toHaveBeenCalled()
    expect(service.prepareOrInstall).not.toHaveBeenCalled()
    expect(service.reconcile).not.toHaveBeenCalled()
    expect(service.checkHttps).not.toHaveBeenCalled()
  })

  it('dispatches the allowlisted action and preserves blocked/uncertain outcomes without sensitive details', async () => {
    const { dir } = makeIngressIpcDb()
    const install = vi.fn(async () =>
      serviceResult({
        operation: 'install',
        status: 'blocked',
        failed_step: 'preflight',
        reason: { code: 'HOST_CONFLICT', message: 'do not expose token raw stdout plan' },
        retryable: true
      })
    )
    const reconcile = vi.fn(async () =>
      serviceResult({
        operation: 'reconcile',
        status: 'uncertain',
        failed_step: 'reconcile',
        reason: { code: 'RECONCILE_UNCERTAIN', message: 'secret raw stderr install plan' },
        retryable: false
      })
    )
    const checkHttps = vi.fn(async () =>
      serviceResult({
        operation: 'https_check',
        status: 'pending',
        failed_step: 'https_probe',
        reason: { code: 'HTTPS_PENDING', message: 'private output' },
        retryable: true
      })
    )
    const service = {
      prepareOrInstall: install,
      reconcile,
      checkHttps
    } as unknown as SharedIngressService
    try {
      registerIngressService(service)
      const call = async (action: string): Promise<unknown> =>
        ingressCallback('domain:ingress-action')({}, { vps_id: 1, binding_id: 1, action })
      const blocked = await call('install')
      const uncertain = await call('reconcile')
      const pending = await call('https_check')
      expect(install).toHaveBeenCalledWith(1, 1)
      expect(reconcile).toHaveBeenCalledWith(1, 1)
      expect(checkHttps).toHaveBeenCalledWith(1, 1)
      expect(blocked).toMatchObject({
        ok: true,
        data: {
          status: 'blocked',
          failed_step: 'preflight',
          retryable: true,
          reason: { code: 'HOST_CONFLICT' }
        }
      })
      expect(uncertain).toMatchObject({
        ok: true,
        data: {
          status: 'uncertain',
          failed_step: 'reconcile',
          retryable: false,
          reason: { code: 'RECONCILE_UNCERTAIN' }
        }
      })
      expect(pending).toMatchObject({
        ok: true,
        data: { status: 'pending', failed_step: 'https_probe', retryable: true }
      })
      const serialized = JSON.stringify([blocked, uncertain, pending])
      for (const sensitive of [
        'token',
        'secret',
        'stdout',
        'stderr',
        'install plan',
        'private output'
      ]) {
        expect(serialized).not.toContain(sensitive)
      }
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sanitizes an unexpected service exception', async () => {
    const { dir } = makeIngressIpcDb()
    const service = {
      prepareOrInstall: vi.fn(async () => {
        throw new Error('credential raw stdout private plan')
      })
    } as unknown as SharedIngressService
    try {
      registerIngressService(service)
      const result = await ingressCallback('domain:ingress-action')(
        {},
        { vps_id: 1, binding_id: 1, action: 'install' }
      )
      const serialized = JSON.stringify(result)
      expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN' } })
      for (const sensitive of ['credential', 'stdout', 'private plan'])
        expect(serialized).not.toContain(sensitive)
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('handle', () => {
  beforeEach(() => {
    handleMock.mockReset()
    ingressPreflightMock.mockReset()
    readinessCheckMock.mockReset()
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

  describe('domain:ingress-readiness IPC', () => {
    it('combines only the selected shared_ingress binding with pinned-SSH preflight and does not persist observations', async () => {
      const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-ipc-ingress-readiness-'))
      const db = initializeDatabase(dir)
      const ssh = { exec: vi.fn() }
      const readiness = { overall_status: 'unknown', certificate_status: 'not_requested' }
      ingressPreflightMock.mockResolvedValue({ ports_status: 'free', local_assessment: 'clear' })
      readinessCheckMock.mockResolvedValue(readiness)
      try {
        db.exec(
          "INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret) VALUES (1,'v','93.184.216.34','root','password','x'); " +
            "INSERT INTO app (id,vps_id,name,framework,host_port,container_port) VALUES (1,1,'app','express',30000,3000); " +
            "INSERT INTO deployment (id,app_id,version,image_tag,status) VALUES (1,1,1,'app:v1','running'); " +
            "INSERT INTO domain_binding (id,app_id,hostname,mode,ownership_key,status) VALUES (1,1,'app.example.com','shared_ingress','opspilot:1:app.example.com','pending');"
        )
        registerIpcHandlers(
          {} as never,
          {} as never,
          ssh as never,
          {} as never,
          {} as never,
          () => null
        )
        const callback = handleMock.mock.calls.find(([channel]) => channel === 'domain:ingress-readiness')?.[1] as (
          event: unknown,
          input: { vps_id: number; hostname: string; cloudflare_proxy_hint: 'enabled' | 'disabled' | 'unknown' }
        ) => Promise<unknown>
        const before = db.prepare('SELECT dns_status, route_status, certificate_status, https_probe_status FROM domain_binding WHERE id = 1').get()

        await expect(callback({}, {
          vps_id: 1, hostname: 'App.Example.com.', cloudflare_proxy_hint: 'enabled'
        })).resolves.toEqual({ ok: true, data: readiness })

        expect(ingressPreflightMock).toHaveBeenCalledWith(ssh, 1)
        expect(readinessCheckMock).toHaveBeenCalledWith(expect.objectContaining({
          hostname: 'app.example.com', vpsHost: '93.184.216.34',
          cloudflareProxyHint: 'enabled', ingress: { ports_status: 'free', local_assessment: 'clear' }
        }))
        expect(db.prepare('SELECT dns_status, route_status, certificate_status, https_probe_status FROM domain_binding WHERE id = 1').get()).toEqual(before)
      } finally {
        closeDatabase()
        rmSync(dir, { recursive: true, force: true })
      }
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
          dns_status: string
          dns_evidence_json: string
          route_status: string
          certificate_status: string
          https_probe_status: string
        }
        expect(binding).toBeDefined()
        expect(binding.app_id).toBe(1)
        expect(binding.ownership_key).toBe('opspilot:1:app.example.com')
        expect(binding.dns_status).toBe(result.data?.status)
        expect(binding.dns_status).not.toBe('active')
        expect(binding.status).toBe(binding.dns_status)
        expect(binding.route_status).toBe('not_configured')
        expect(binding.certificate_status).toBe('not_requested')
        expect(binding.https_probe_status).toBe('not_run')

        // Tuyệt đối không lưu token vào bất kỳ trường nào trong SQLite
        expect(JSON.stringify(binding)).not.toContain(scopedToken)
        expect(binding.dns_evidence_json).not.toContain(scopedToken)
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
          .get('app.example.com') as { status: string; dns_status: string; dns_evidence_json: string }
        expect(binding).toBeDefined()
        expect(binding.status).toBe('conflict')
        expect(binding.dns_status).toBe('conflict')
        expect(binding.dns_evidence_json).toContain('Xung đột quyền sở hữu')
        expect(binding.dns_evidence_json).not.toContain(secretToken)
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
          .get('app.example.com') as { status: string; dns_status: string; dns_evidence_json: string }
        expect(binding).toBeDefined()
        expect(binding.status).toBe('failed')
        expect(binding.dns_status).toBe('failed')
        expect(binding.dns_evidence_json).not.toContain(secretToken)
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
          .prepare('SELECT dns_evidence_json FROM domain_binding WHERE hostname = ?')
          .get('app.example.com') as { dns_evidence_json: string }
        expect(binding.dns_evidence_json).not.toContain('superSecretPass123')
        expect(binding.dns_evidence_json).not.toContain('leakToken')
      } finally {
        fetchSpy.mockRestore()
        closeDatabase()
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
