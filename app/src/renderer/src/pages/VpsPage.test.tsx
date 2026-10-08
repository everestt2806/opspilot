// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionLogEntry, App, Vps, VpsResources } from '@shared/ipc'

import { useUiState } from '../store/uiState'
import { useVpsStore } from '../store/vpsStore'
import { VpsPage } from './VpsPage'
import { strings } from '../strings'

const VPS_A: Vps = {
  id: 1,
  name: 'VM01',
  host: '221.121.1.79',
  port: 22,
  host_fingerprint: null,
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

    expect(await screen.findByText(strings.vps.empty)).toBeTruthy()
    expect(screen.getByText(strings.vps.createFirst)).toBeTruthy()
    expect(screen.getByLabelText(strings.vpsControl.fleet.totalVps).textContent).toContain('0')
    expect(screen.queryByText(strings.vps.backToList)).toBeNull()
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

    expect(await screen.findByText(strings.vps.loadError)).toBeTruthy()
    fireEvent.click(screen.getByText(strings.common.retry))
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

    expect((await screen.findAllByText(strings.vps.status.checking)).length).toBeGreaterThan(0)

    await act(async () => {
      resolveResources({ ok: true, data: RES })
    })
    expect(await screen.findAllByText(strings.vps.status.online)).toBeTruthy()
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

    await waitFor(() =>
      expect(screen.getByLabelText(strings.vpsControl.fleet.totalVps).textContent).toContain('2')
    )
    const fleet = document.querySelector('.panel-fleet') as HTMLElement
    expect(within(fleet).getByLabelText(strings.vpsControl.fleet.online).textContent).toContain('1')
    expect(within(fleet).getByLabelText(strings.vpsControl.fleet.offline).textContent).toContain(
      '1'
    )
    expect(within(fleet).getByLabelText(strings.vpsControl.fleet.totalApps).textContent).toContain(
      '1'
    )
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
    expect(screen.queryByText(strings.vps.backToList)).toBeNull()

    fireEvent.click(screen.getByText('VM02'))
    await waitFor(() => {
      expect(screen.getByLabelText(strings.vps.backToList)).toBeTruthy()
      expect(screen.getByText('VM02')).toBeTruthy()
    })
    expect(screen.queryByText('VM01')).toBeNull()

    fireEvent.click(screen.getByLabelText(strings.vps.backToList))
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

    // Overview: card thông tin nhanh (IP/port/SSH) + card Tài nguyên hệ thống hiển thị toàn chiều rộng
    expect(await screen.findByText(strings.vpsControl.header.mainIp)).toBeTruthy()
    expect(screen.getByText(strings.vpsControl.overview.resourcesTitle)).toBeTruthy()
    expect(document.querySelector('.panel-info-sidebar')).toBeNull()

    fireEvent.click(await screen.findByText(strings.vpsControl.tabs.apps))
    expect(await screen.findByText('express-api')).toBeTruthy()
    expect(screen.getByText('v3')).toBeTruthy()

    // Tab khác: nội dung tab Overview ẩn, bảng app chiếm toàn chiều rộng
    await waitFor(() => expect(screen.queryByText(strings.vpsControl.header.mainIp)).toBeNull())
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
    fireEvent.click(await screen.findByText(strings.vpsControl.tabs.apps))
    fireEvent.click(await screen.findByText(strings.vpsControl.apps.deployNew))

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
    fireEvent.click(await screen.findByText(strings.vpsControl.tabs.activity))
    await waitFor(() => expect(history).toHaveBeenCalledWith({ vps_id: 1, limit: 20, offset: 0 }))
    expect(await screen.findByText('Deploy succeeded')).toBeTruthy()
  })

  it('doi VPS trong tab Activity: khong hien du lieu cu cua VPS truoc', async () => {
    const history = vi.fn().mockImplementation(async (filter: { vps_id?: number }) => ({
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
    fireEvent.click(await screen.findByText(strings.vpsControl.tabs.activity))
    expect(await screen.findByText('Deploy succeeded')).toBeTruthy()

    fireEvent.click(screen.getByLabelText(strings.vps.backToList))
    await waitFor(() => expect(screen.getByText('VM02')).toBeTruthy())
    fireEvent.click(screen.getByText('VM02'))
    fireEvent.click(await screen.findByText(strings.vpsControl.tabs.activity))
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
    fireEvent.click(await screen.findByLabelText(strings.vps.actions.delete('VM01')))
    fireEvent.click((await screen.findAllByText(strings.vps.delete.confirm))[0])
    fireEvent.click((await screen.findAllByText(strings.vps.delete.confirm))[1])

    await waitFor(() => expect(screen.getByText(strings.vps.empty)).toBeTruthy())
    expect(screen.queryByText(strings.vps.backToList)).toBeNull()
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

    fireEvent.click(screen.getAllByText(strings.vps.checkResources)[0])
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(4))
  })

  it('nut Migrate tren PageHeader chuyen activePage ve migrate', async () => {
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'vps:get-resources': async () => ({ ok: true, data: RES }),
      'app:list': async () => ({ ok: true, data: [] })
    })

    render(<VpsPage />)
    const migrateBtn = screen.getByRole('button', {
      name: new RegExp(strings.navigation.migrate, 'i')
    })
    expect(migrateBtn).toBeTruthy()
    fireEvent.click(migrateBtn)
    expect(useUiState.getState().activePage).toBe('migrate')
  })

  it('sau vps:scan thanh cong: lam moi rieng ban ghi VPS (docker_version, last_seen_at) khong goi lai vps:get-resources cho fleet va khong bi quet lap', async () => {
    const vpsInitial: Vps = {
      ...VPS_A,
      docker_version: null,
      last_seen_at: null
    }
    const vpsUpdated: Vps = {
      ...VPS_A,
      docker_version: '27.1.1',
      last_seen_at: '2026-08-23T10:00:00Z'
    }

    let listCallCount = 0
    const listHandler = vi.fn().mockImplementation(() => {
      listCallCount++
      return Promise.resolve({
        ok: true,
        data: [listCallCount === 1 ? vpsInitial : vpsUpdated, VPS_B]
      })
    })

    const getResources = vi.fn().mockResolvedValue({ ok: true, data: RES })
    const scanHandler = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        scanned_at: '2026-08-23T10:00:00Z',
        ssh_ok: true,
        items: [
          { key: 'ssh', ok: true, version: null },
          { key: 'docker', ok: true, version: '27.1.1' },
          { key: 'compose', ok: true, version: 'v2.29.1' },
          { key: 'node', ok: true, version: 'v20.11.1' },
          { key: 'git', ok: true, version: '2.43.0' },
          { key: 'workdir', ok: true, version: null }
        ]
      }
    })

    mockApi({
      'vps:list': listHandler,
      'vps:get-resources': getResources,
      'vps:scan': scanHandler,
      'app:list': async () => ({ ok: true, data: [] })
    })

    render(<VpsPage />)

    // Lúc load ban đầu: get-resources được gọi cho 2 máy (fleet)
    await waitFor(() => expect(screen.getByText(vpsInitial.name)).toBeTruthy())
    expect(getResources).toHaveBeenCalledTimes(2)

    // Bấm vào VM01 để mở trang chi tiết (mặc định tab Overview)
    fireEvent.click(screen.getByText(vpsInitial.name))

    // Khi tab Overview mở, vps:scan tự động chạy
    await waitFor(() => expect(scanHandler).toHaveBeenCalledTimes(1))

    await waitFor(() => expect(listHandler).toHaveBeenCalledTimes(2))

    // Scan thành công kích hoạt làm mới riêng VPS qua refreshVps (gọi vps:list)
    // Sau khi cập nhật, Docker version '27.1.1' được hiển thị ở bảng Machine info
    await waitFor(() => {
      const machineCard = screen
        .getByText(strings.vpsControl.overview.machineTitle)
        .closest('.ant-card')
      expect(machineCard).toBeTruthy()
      expect(within(machineCard as HTMLElement).getByText('27.1.1')).toBeTruthy()
    })

    // Quan trọng: get-resources KHÔNG bị gọi thêm lần nào nữa (vẫn là 2 lần ban đầu của fleet)
    expect(getResources).toHaveBeenCalledTimes(2)

    // Giữ callback ổn định: vps:scan KHÔNG bị quét lặp vô hạn (chỉ đúng 1 lần khi mở tab)
    expect(scanHandler).toHaveBeenCalledTimes(1)
  })
})
