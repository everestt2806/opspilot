// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { VpsResources } from '@shared/ipc'

import { VpsResourcesCell } from './VpsResourcesCell'

const RES: VpsResources = {
  ram_total_mb: 4096,
  ram_free_mb: 1024,
  disk_total_gb: 40,
  disk_free_gb: 28,
  cpu_count: 2,
  load_avg_1m: 0.5
}

describe('VpsResourcesCell — 4 state', () => {
  it('empty: chua kiem tra', () => {
    render(<VpsResourcesCell vpsName="VM01" state={undefined} onRetry={() => {}} />)
    expect(screen.getByText('Not checked')).toBeTruthy()
  })

  it('loading: spinner dang kiem tra', () => {
    render(<VpsResourcesCell vpsName="VM01" state={{ status: 'loading' }} onRetry={() => {}} />)
    expect(screen.getByLabelText('Checking')).toBeTruthy()
  })

  it('success: 3 thanh RAM/Disk/CPU voi so lieu thuc', () => {
    render(
      <VpsResourcesCell
        vpsName="VM01"
        state={{ status: 'success', data: RES }}
        onRetry={() => {}}
      />
    )

    expect(screen.getByText('RAM')).toBeTruthy()
    expect(screen.getByText('Disk')).toBeTruthy()
    expect(screen.getByText('CPU load (1 min)')).toBeTruthy()
    // so lieu chi tiet trong aria-label cua tung thanh
    expect(screen.getByLabelText('3.0 GB / 4.0 GB used')).toBeTruthy()
    expect(screen.getByLabelText('12 GB / 40 GB used')).toBeTruthy()
    expect(screen.getByLabelText('0.50 · 2 cores')).toBeTruthy()

    const bars = screen.getAllByRole('progressbar')
    expect(bars.map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['75', '30', '25'])
  })

  it('error: hien canh bao + nut thu lai goi onRetry', () => {
    const onRetry = vi.fn()
    render(
      <VpsResourcesCell
        vpsName="VM01"
        state={{ status: 'error', message: 'SSH timeout' }}
        onRetry={onRetry}
      />
    )

    expect(screen.getByLabelText('Could not read resources')).toBeTruthy()
    const retry = screen.getByRole('button', { name: 'Re-read resources of VM01' })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
