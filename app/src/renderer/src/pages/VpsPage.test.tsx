// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Vps, VpsResources } from '@shared/ipc'

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

beforeEach(() => {
  useVpsStore.setState({ items: [], loading: false, loadError: null, resources: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VpsPage — 4 state', () => {
  it('empty: chua co VPS -> huong dan them VPS dau tien', async () => {
    mockApi({ 'vps:list': async () => ({ ok: true, data: [] }) })

    render(<VpsPage />)

    expect(
      await screen.findByText('Chưa có VPS nào. Thêm VPS đầu tiên để bắt đầu deploy.')
    ).toBeTruthy()
    expect(screen.getByText('Thêm VPS đầu tiên')).toBeTruthy()
  })

  it('error: vps:list loi -> Alert co nut Thu lai goi lai list', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'DB_ERROR', message: 'Khong doc duoc bang vps. Thu khoi dong lai app.' }
      })
      .mockResolvedValueOnce({ ok: true, data: [] })
    mockApi({ 'vps:list': list })

    render(<VpsPage />)

    expect(await screen.findByText('Không tải được danh sách VPS')).toBeTruthy()
    expect(screen.getByText('Khong doc duoc bang vps. Thu khoi dong lai app.')).toBeTruthy()

    fireEvent.click(screen.getByText('Thử lại'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it('loading: trong khi get-resources chay, hang VPS hien tag Dang kiem tra', async () => {
    let resolveResources!: (value: unknown) => void
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'vps:get-resources': () => new Promise((resolve) => (resolveResources = resolve))
    })

    render(<VpsPage />)

    expect(await screen.findByText('Đang kiểm tra')).toBeTruthy()

    await act(async () => {
      resolveResources({ ok: true, data: RES })
    })
    expect(await screen.findByText('Online')).toBeTruthy()
  })

  it('success + error: tag phan anh ket qua tai nguyen moi hang', async () => {
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'vps:get-resources': async (...args: unknown[]) => {
        const vpsId = args[0] as number
        return vpsId === 1
          ? { ok: true, data: RES }
          : { ok: false, error: { code: 'SSH_TIMEOUT', message: 'SSH timeout 15s' } }
      }
    })

    render(<VpsPage />)

    expect(await screen.findByText('Online')).toBeTruthy()
    expect(screen.getByText('Offline')).toBeTruthy()
    expect(screen.getByText('VM01')).toBeTruthy()
    expect(screen.getByText('VM02')).toBeTruthy()
  })

  it('nut Kiem tra lai goi lai get-resources cho tung VPS', async () => {
    const getResources = vi.fn().mockResolvedValue({ ok: true, data: RES })
    mockApi({
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'vps:get-resources': getResources
    })

    render(<VpsPage />)

    const onlineTags = await screen.findAllByText('Online')
    expect(onlineTags.length).toBe(2)
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByText('Kiểm tra lại'))
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(4))
  })
})
