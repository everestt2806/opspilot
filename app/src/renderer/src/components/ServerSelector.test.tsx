// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Vps, VpsResources } from '@shared/ipc'

import { ServerSelector } from './ServerSelector'
import type { RowResourceState } from '../vpsResources'

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

const VPS_B: Vps = {
  ...VPS_A,
  id: 2,
  name: 'VM02',
  host: '221.121.1.80',
  docker_version: null,
  last_status: 'offline'
}

const RES: VpsResources = {
  ram_total_mb: 4096,
  ram_free_mb: 1024,
  disk_total_gb: 40,
  disk_free_gb: 28,
  cpu_count: 2,
  load_avg_1m: 0.5
}

interface Options {
  items?: Vps[]
  resources?: Record<number, RowResourceState | undefined>
  appCounts?: Record<number, number>
  loading?: boolean
  search?: string
  selectedIds?: number[]
  onSelect?: (vps: Vps) => void
  onSearchChange?: (search: string) => void
  onSelectionChange?: (ids: number[]) => void
  onAddVps?: () => void
  onDelete?: (vps: Vps) => void
  onRetryResources?: (vpsId: number) => void
}

function renderSelector(options: Options = {}): ReturnType<typeof vi.fn> {
  const onSelect = vi.fn(options.onSelect)
  render(
    <ServerSelector
      items={options.items ?? []}
      resources={options.resources ?? {}}
      appCounts={options.appCounts ?? {}}
      loading={options.loading ?? false}
      search={options.search ?? ''}
      selectedIds={options.selectedIds ?? []}
      onSelect={onSelect}
      onSearchChange={options.onSearchChange ?? ((): void => undefined)}
      onSelectionChange={options.onSelectionChange ?? ((): void => undefined)}
      onAddVps={options.onAddVps ?? ((): void => undefined)}
      onDelete={options.onDelete ?? ((): void => undefined)}
      onRetryResources={options.onRetryResources ?? ((): void => undefined)}
    />
  )
  return onSelect
}

/** Checkbox của đúng hàng dữ liệu — tránh nhầm với bản clone trong ant-table-measure-row (bị ẩn). */
function rowCheckbox(name: string): HTMLInputElement {
  const row = screen.getByText(name).closest('tr')
  if (!row) throw new Error(`không tìm thấy hàng ${name}`)
  const input = row.querySelector('.ant-checkbox-input')
  if (!input) throw new Error(`không tìm thấy checkbox dòng ${name}`)
  return input as HTMLInputElement
}

describe('ServerSelector — bang danh sach VPS', () => {
  it('empty: hien huong dan them VPS dau tien + CTA', () => {
    const onAddVps = vi.fn()
    renderSelector({ items: [], onAddVps })

    expect(screen.getByText('No VPS yet. Add your first VPS to start deploying.')).toBeTruthy()
    fireEvent.click(screen.getByText('Add your first VPS'))
    expect(onAddVps).toHaveBeenCalledTimes(1)
  })

  it('khong co nut Add VPS trong card — chi co o page heading', () => {
    renderSelector({ items: [VPS_A], resources: { 1: { status: 'success', data: RES } } })

    const card = document.querySelector('.server-list-card') as HTMLElement
    expect(within(card).queryByRole('button', { name: 'Add VPS' })).toBeNull()
  })

  it('2 VPS online/offline: cot Status + Site + bam dong goi onSelect', () => {
    const onSelect = renderSelector({
      items: [VPS_A, VPS_B],
      resources: {
        1: { status: 'success', data: RES },
        2: { status: 'error', message: 'SSH timeout 15s' }
      },
      appCounts: { 1: 2, 2: 0 }
    })

    expect(screen.getByText('VM01')).toBeTruthy()
    expect(screen.getByText('VM02')).toBeTruthy()
    expect(screen.getByText('Online')).toBeTruthy()
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0)
    expect(screen.getByText('221.121.1.79')).toBeTruthy()
    expect(screen.getByText('29.4.3')).toBeTruthy()
    expect(screen.getByText('No Docker')).toBeTruthy()

    const table = document.querySelector('.server-list-table') as HTMLElement
    expect(within(table).getByText('2')).toBeTruthy()

    fireEvent.click(screen.getByText('VM02'))
    expect(onSelect).toHaveBeenCalledWith(VPS_B)
  })

  it('checkbox cot dau: danh dau hang goi onSelectionChange dung id cua hang duoc click', () => {
    const onSelectionChange = vi.fn()
    renderSelector({
      items: [VPS_A, VPS_B],
      resources: {
        1: { status: 'success', data: RES },
        2: { status: 'error', message: 'SSH timeout 15s' }
      },
      onSelectionChange
    })

    fireEvent.click(rowCheckbox(VPS_A.name))
    expect(onSelectionChange).toHaveBeenCalledWith([VPS_A.id])
    expect(onSelectionChange).not.toHaveBeenCalledWith([VPS_A.id, VPS_B.id])
  })

  it('chon nhieu VPS bang click: giu nguyen hang da chon, bo 1 hang khong anh huong hang kia', () => {
    function Harness(): React.JSX.Element {
      const [ids, setIds] = useState<number[]>([])
      return (
        <ServerSelector
          items={[VPS_A, VPS_B]}
          resources={{
            1: { status: 'success', data: RES },
            2: { status: 'error', message: 'x' }
          }}
          appCounts={{}}
          loading={false}
          search=""
          selectedIds={ids}
          onSelect={(): void => undefined}
          onSearchChange={(): void => undefined}
          onSelectionChange={setIds}
          onAddVps={(): void => undefined}
          onDelete={(): void => undefined}
          onRetryResources={(): void => undefined}
        />
      )
    }

    render(<Harness />)

    fireEvent.click(rowCheckbox(VPS_A.name))
    expect(rowCheckbox(VPS_A.name).checked).toBe(true)
    expect(rowCheckbox(VPS_B.name).checked).toBe(false)

    fireEvent.click(rowCheckbox(VPS_B.name))
    expect(rowCheckbox(VPS_A.name).checked).toBe(true)
    expect(rowCheckbox(VPS_B.name).checked).toBe(true)

    fireEvent.click(rowCheckbox(VPS_A.name))
    expect(rowCheckbox(VPS_A.name).checked).toBe(false)
    expect(rowCheckbox(VPS_B.name).checked).toBe(true)
  })

  it('loi resource: hien nut Retry goi dung VPS, khong kich hoat chon VPS', () => {
    const onRetryResources = vi.fn()
    const onSelect = renderSelector({
      items: [VPS_B],
      resources: { 2: { status: 'error', message: 'SSH timeout 15s' } },
      onRetryResources
    })

    fireEvent.click(screen.getByLabelText('Re-read resources of VM02'))
    expect(onRetryResources).toHaveBeenCalledWith(2)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('icon xoa: goi onDelete dung VPS, khong kich hoat chon VPS', () => {
    const onDelete = vi.fn()
    const onSelect = renderSelector({
      items: [VPS_B],
      resources: { 2: { status: 'error', message: 'x' } },
      onDelete
    })

    fireEvent.click(screen.getByLabelText('Delete VPS VM02'))
    expect(onDelete).toHaveBeenCalledWith(VPS_B)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('tim kiem theo ten/host chi hien dong khop', () => {
    renderSelector({
      items: [VPS_A, VPS_B],
      resources: { 1: { status: 'success', data: RES }, 2: { status: 'error', message: 'x' } },
      search: 'VM02'
    })

    expect(screen.getByText('VM02')).toBeTruthy()
    expect(screen.queryByText('VM01')).toBeNull()
  })

  it('filter dropdown: loc theo trang thai offline', async () => {
    renderSelector({
      items: [VPS_A, VPS_B],
      resources: {
        1: { status: 'success', data: RES },
        2: { status: 'error', message: 'SSH timeout 15s' }
      }
    })

    fireEvent.click(screen.getByLabelText('Filter by status'))
    const menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getByText('Offline'))
    expect(screen.queryByText('VM01')).toBeNull()
    expect(screen.getByText('VM02')).toBeTruthy()
  })
})
