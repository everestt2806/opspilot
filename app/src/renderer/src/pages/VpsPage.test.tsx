// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionLogEntry, App, Vps, VpsResources } from '@shared/ipc'

import { useUiState } from '../store/uiState'
import { useVpsStore } from '../store/vpsStore'
import { VpsPage } from './VpsPage'

const VPS_A: Vps = {
  id: 1,
  name: 'VM01',
  host: '221.121.1.79',
  port: 22,
  username: 'root',
  auth_type: 'password',
  provider: 'WiService',
  region: 'Hanoi',
  docker_version: '29.4.3',
  last_status: 'unknown',
  last_seen_at: null,
  created_at: '2026-08-19T00:00:00Z'
}

const VPS_B: Vps = { ...VPS_A, id: 2, name: 'VM02', host: '221.121.1.80', last_status: 'offline' }

const RES: VpsResources = {
  ram_total_mb: 4096,
  ram_free_mb: 1024,
  disk_total_gb: 40,
  disk_free_gb: 28,
  cpu_count: 2,
  load_avg_1m: 0.5
}

const APP_X: App = {
  id: 11,
  vps_id: 1,
  name: 'express-api',
  framework: 'express',
  host_port: 30001,
  container_port: 3000,
  healthcheck_path: '/health',
  needs_db: 1,
  current_deployment_id: 101,
  url: 'http://221.121.1.79:30001'
}

const ACTIVITY: ActionLogEntry = {
  id: 1,
  ts: '2026-08-20T10:00:00Z',
  action: 'deploy',
  status: 'success',
  message: 'Deploy succeeded',
  vps_id: 1,
  app_id: 11,
  deployment_id: 101,
  detail_json: '{"step":"RECORD"}'
}

type InvokeHandler = (...args: unknown[]) => Promise<unknown>

function mockApi(handlers: Record<string, InvokeHandler>): void {
  vi.stubGlobal('api', {
    invoke: (channel: string, ...args: unknown[]) => {
      const handler = handlers[channel]
      if (!handler) return Promise.reject(new Error(`No handler registered for '${channel}'`))
      return handler(...args)
    },
    on: () => () => {}
  })
}

function resetStores(): void {
  useVpsStore.setState({ items: [], loading: false, loadError: null, resources: {} })
  useUiState.setState({
    selectedVpsId: null,
    activePanelTab: 'overview',
    vpsSearch: '',
    deployPreselect: null,
    selectedVpsIds: []
  })
}

/** Checkbox của đúng hàng dữ liệu theo tên — bỏ qua bản clone trong ant-table-measure-row (hàng đo ẩn). */
function rowCheckbox(name: string): HTMLInputElement {
  const row = screen.getByText(name).closest('tr')
  if (!row) throw new Error(`không tìm thấy hàng ${name}`)
  const input = row.querySelector('.ant-checkbox-input')
  if (!input) throw new Error(`không tìm thấy checkbox dòng ${name}`)
  return input as HTMLInputElement
}

beforeEach(() => {
  localStorage.clear()
  resetStores()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VpsPage — list trước, trang chi tiết riêng', () => {
  it('empty: chua co VPS -> fleet so 0, huong dan them VPS dau tien', async () => {
    mockApi({
      'vps:list': async () => ({ ok: true, data: [] }),
      'app:list': async () => ({ ok: true, data: [] })
    })

    render(<VpsPage />)

    expect(
      await screen.findByText('No VPS yet. Add your first VPS to start deploying.')
    ).toBeTruthy()
    expect(screen.getByText('Add your first VPS')).toBeTruthy()
    expect(screen.getByLabelText('Total VPS').textContent).toContain('0')
    expect(screen.queryByText('Back to VPS list')).toBeNull()
  })

  it('error: vps:list loi -> Alert co nut Thu lai goi lai list', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'DB_ERROR', message: 'Khong doc duoc bang vps. Thu khoi dong lai app.' }
      })
      .mockResolvedValueOnce({ ok: true, data: [] })
    mockApi({
      'vps:list': list,
      'app:list': async () => ({ ok: true, data: [] })
    })

    render(<VpsPage />)

    expect(await screen.findByText('Could not load the VPS list')).toBeTruthy()
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it('loading: trong khi get-resources chay, dong VPS hien tag Checking', async () => {
    let resolveResources!: (value: unknown) => void
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'vps:get-resources': () => new Promise((resolve) => (resolveResources = resolve)),
      'app:list': async () => ({ ok: true, data: [] })
    })

    render(<VpsPage />)

    expect((await screen.findAllByText('Checking')).length).toBeGreaterThan(0)

    await act(async () => {
      resolveResources({ ok: true, data: RES })
    })
    expect(await screen.findAllByText('Online')).toBeTruthy()
  })

  it('fleet summary: checking/unknown khong bi tinh nham thanh online/offline; tong app dung', async () => {
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'vps:get-resources': async (...args: unknown[]) => {
        const vpsId = args[0] as number
        return vpsId === 1
          ? { ok: true, data: RES }
          : { ok: false, error: { code: 'SSH_TIMEOUT', message: 'SSH timeout 15s' } }
      },
      'app:list': async () => ({ ok: true, data: [APP_X] })
    })

    render(<VpsPage />)

    await waitFor(() => expect(screen.getByLabelText('Total VPS').textContent).toContain('2'))
    const fleet = document.querySelector('.panel-fleet') as HTMLElement
    expect(within(fleet).getByLabelText('Online').textContent).toContain('1')
    expect(within(fleet).getByLabelText('Offline').textContent).toContain('1')
    expect(within(fleet).getByLabelText('Total apps').textContent).toContain('1')
  })

  it('list truoc: bam dong VM02 chuyen sang trang chi tiết, Back quay ve danh sach', async () => {
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'vps:get-resources': async () => ({ ok: true, data: RES }),
      'app:list': async () => ({ ok: true, data: [APP_X] })
    })

    render(<VpsPage />)

    await waitFor(() => expect(screen.getByText('VM01')).toBeTruthy())
    expect(screen.getByText('VM02')).toBeTruthy()
    expect(screen.queryByText('Back to VPS list')).toBeNull()

    fireEvent.click(screen.getByText('VM02'))
    await waitFor(() => {
      expect(screen.getByLabelText('Back to VPS list')).toBeTruthy()
      expect(screen.getByText('VM02')).toBeTruthy()
    })
    expect(screen.queryByText('VM01')).toBeNull()

    fireEvent.click(screen.getByLabelText('Back to VPS list'))
    await waitFor(() => expect(screen.getByText('VM01')).toBeTruthy())
    expect(screen.getByText('VM02')).toBeTruthy()
  })

  it('tab Apps: hien bang app va goi app:list theo vpsId', async () => {
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'vps:get-resources': async () => ({ ok: true, data: RES }),
      'app:list': async (...args: unknown[]) => {
        const vpsId = args[0] as number | undefined
        return vpsId === 1 ? { ok: true, data: [APP_X] } : { ok: true, data: [] }
      },
      'app:versions': async () => ({
        ok: true,
        data: [
          {
            id: 101,
            app_id: 11,
            version: 3,
            image_tag: 'v3',
            status: 'running',
            failed_step: null,
            build_duration_ms: 1000,
            total_duration_ms: 2000,
            is_rollback_of: null,
            started_at: '2026-08-20T00:00:00Z',
            finished_at: '2026-08-20T00:01:00Z'
          }
        ]
      })
    })

    render(<VpsPage />)
    fireEvent.click(await screen.findByText('VM01'))

    // Overview: card thông tin nhanh (IP/port/SSH) + sidebar Server info hiển thị
    expect(await screen.findByText('Main IP')).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.panel-info-sidebar')).toBeTruthy())

    fireEvent.click(await screen.findByText('Apps & deploy'))
    expect(await screen.findByText('express-api')).toBeTruthy()
    expect(screen.getByText('v3')).toBeTruthy()

    // Tab khác: card thông tin nhanh + sidebar ẩn, nội dung chiếm full
    await waitFor(() => expect(screen.queryByText('Main IP')).toBeNull())
    expect(document.querySelector('.panel-info-sidebar')).toBeNull()
  })

  it('quick deploy: bam Deploy new app luu deployPreselect', async () => {
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'vps:get-resources': async () => ({ ok: true, data: RES }),
      'app:list': async () => ({ ok: true, data: [] })
    })

    render(<VpsPage />)
    fireEvent.click(await screen.findByText('VM01'))
    fireEvent.click(await screen.findByText('Apps & deploy'))
    fireEvent.click(await screen.findByText('Deploy new app'))

    expect(useUiState.getState().deployPreselect).toEqual({ vpsId: 1 })
    expect(useUiState.getState().activePage).toBe('deploy')
  })

  it('tab Activity: goi history:list loc theo vps_id', async () => {
    const history = vi.fn().mockResolvedValue({ ok: true, data: [ACTIVITY] })
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'vps:get-resources': async () => ({ ok: true, data: RES }),
      'app:list': async () => ({ ok: true, data: [] }),
      'history:list': history
    })

    render(<VpsPage />)
    fireEvent.click(await screen.findByText('VM01'))
    fireEvent.click(await screen.findByText('Activity'))
    await waitFor(() =>
      expect(history).toHaveBeenCalledWith({ vps_id: 1, limit: 20, offset: 0 })
    )
    expect(await screen.findByText('Deploy succeeded')).toBeTruthy()
  })

  it('doi VPS trong tab Activity: khong hien du lieu cu cua VPS truoc', async () => {
    const history = vi
      .fn()
      .mockImplementation(async (filter: { vps_id?: number }) => ({
        ok: true,
        data: filter.vps_id === 1 ? [ACTIVITY] : []
      }))
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'vps:get-resources': async () => ({ ok: true, data: RES }),
      'app:list': async () => ({ ok: true, data: [APP_X] }),
      'history:list': history
    })

    render(<VpsPage />)
    fireEvent.click(await screen.findByText('VM01'))
    fireEvent.click(await screen.findByText('Activity'))
    expect(await screen.findByText('Deploy succeeded')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Back to VPS list'))
    await waitFor(() => expect(screen.getByText('VM02')).toBeTruthy())
    fireEvent.click(screen.getByText('VM02'))
    fireEvent.click(await screen.findByText('Activity'))
    await waitFor(() => expect(screen.queryByText('Deploy succeeded')).toBeNull())
  })

  it('xoa VPS dang xem: quay ve danh sach, het may hien empty CTA', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: [VPS_A] })
      .mockResolvedValue({ ok: true, data: [] })
    mockApi({
      'vps:list': list,
      'vps:get-resources': async () => ({ ok: true, data: RES }),
      'app:list': async () => ({ ok: true, data: [] }),
      'vps:delete': async () => ({ ok: true, data: undefined })
    })

    render(<VpsPage />)
    fireEvent.click(await screen.findByText('VM01'))
    fireEvent.click(await screen.findByLabelText('Delete VPS VM01'))
    fireEvent.click((await screen.findAllByText('Delete VPS'))[0])
    fireEvent.click((await screen.findAllByText('Delete VPS'))[1])

    await waitFor(() =>
      expect(screen.getByText('No VPS yet. Add your first VPS to start deploying.')).toBeTruthy()
    )
    expect(screen.queryByText('Back to VPS list')).toBeNull()
  })

  it('checkbox cot chon: danh dau VPS cap nhat selectedVpsIds cho header chinh', async () => {
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'vps:get-resources': async () => ({ ok: true, data: RES }),
      'app:list': async () => ({ ok: true, data: [] })
    })

    render(<VpsPage />)
    await waitFor(() => expect(screen.getByText(VPS_A.name)).toBeTruthy())

    // Click máy nào thì ghi đúng id máy đó — không phụ thuộc số máy hay thứ tự
    fireEvent.click(rowCheckbox(VPS_A.name))
    expect(useUiState.getState().selectedVpsIds).toEqual([VPS_A.id])

    fireEvent.click(rowCheckbox(VPS_B.name))
    expect(useUiState.getState().selectedVpsIds).toEqual([VPS_A.id, VPS_B.id])
  })

  it('nut Refresh goi lai get-resources cho tung VPS', async () => {
    const getResources = vi.fn().mockResolvedValue({ ok: true, data: RES })
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'vps:get-resources': getResources,
      'app:list': async () => ({ ok: true, data: [] })
    })

    render(<VpsPage />)

    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getAllByText('Refresh')[0])
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(4))
  })
})
