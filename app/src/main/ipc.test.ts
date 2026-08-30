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
      close: vi.fn()
    }

    registerIpcHandlers(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      () => window
    )
    const callbackFor = (channel: string): ((event: unknown) => Promise<unknown>) => {
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
})
