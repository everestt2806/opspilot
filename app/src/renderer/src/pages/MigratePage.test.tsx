// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { App, MigrateJobView, Vps } from '@shared/ipc'
import { MigratePage } from './MigratePage'

const app: App = {
  id: 1,
  vps_id: 1,
  name: 'demo',
  framework: 'express',
  host_port: 3000,
  container_port: 3000,
  healthcheck_path: '/',
  needs_db: 0,
  current_deployment_id: 1,
  url: 'http://127.0.0.1:3000'
}
const vps: Vps = {
  id: 2,
  name: 'target',
  host: '127.0.0.2',
  port: 22,
  username: 'u',
  auth_type: 'password',
  provider: null,
  region: null,
  docker_version: null,
  last_status: 'online',
  last_seen_at: null,
  created_at: '2026-01-01T00:00:00Z'
}
const job: MigrateJobView = {
  id: 7,
  app_id: 1,
  source_vps_id: 1,
  target_vps_id: 2,
  status: 'awaiting_confirm',
  failed_step: null,
  downtime_ms: 12,
  bytes_transferred: 4,
  verify_json: JSON.stringify({ ok: true }),
  source_kept: null,
  started_at: '2026-01-01T00:00:00Z',
  finished_at: null
}

afterEach(() => vi.unstubAllGlobals())

describe('MigratePage persisted state', () => {
  it('chon app nguon va VPS dich bang control native de bat dau migration', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [vps] }
      if (channel === 'migrate:list') return { ok: true, data: [] }
      if (channel === 'migrate:start') return { ok: true, data: { job_id: 8 } }
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)
    const sourceSelect = await screen.findByRole('combobox', { name: 'Chọn app nguồn' })
    fireEvent.change(sourceSelect, { target: { value: '1' } })
    const targetSelect = screen.getByRole('combobox', { name: 'Chọn VPS đích' })
    fireEvent.change(targetSelect, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu migrate' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('migrate:start', { app_id: 1, target_vps_id: 2 })
    )
  })

  it('reloads awaiting confirmation and uses the persisted job id', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:list') return { ok: true, data: [app] }
      if (channel === 'vps:list') return { ok: true, data: [vps] }
      if (channel === 'migrate:list') return { ok: true, data: [job] }
      if (channel === 'migrate:confirm') return { ok: true, data: undefined }
      throw new Error(`unexpected ${channel}`)
    })
    vi.stubGlobal('api', { invoke, on: () => () => {} })

    render(<MigratePage />)
    expect(await screen.findByText('Đang chờ xác nhận')).toBeTruthy()
    const buttons = await screen.findAllByRole('button', { name: /Xác nhận/ })
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(buttons[0])
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('migrate:confirm', 7, true))
  })
})
