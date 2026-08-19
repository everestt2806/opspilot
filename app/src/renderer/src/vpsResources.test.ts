import { describe, expect, it } from 'vitest'

import type { Vps, VpsResources } from '@shared/ipc'

import {
  clampPercent,
  formatGb,
  formatMb,
  resourcePercents,
  rowDisplayStatus
} from './vpsResources'

const VPS: Vps = {
  id: 1,
  name: 'VM01',
  host: '221.121.1.79',
  port: 22,
  username: 'root',
  auth_type: 'password',
  provider: 'WiService',
  region: 'Hanoi',
  docker_version: null,
  last_status: 'unknown',
  last_seen_at: null,
  created_at: '2026-08-19T00:00:00Z'
}

const RES: VpsResources = {
  ram_total_mb: 4096,
  ram_free_mb: 1024,
  disk_total_gb: 40,
  disk_free_gb: 28,
  cpu_count: 2,
  load_avg_1m: 0.5
}

describe('resourcePercents', () => {
  it('tinh dung phan tram RAM, Disk, CPU', () => {
    expect(resourcePercents(RES)).toEqual({ ram: 75, disk: 30, cpu: 25 })
  })

  it('chan gia tri ve [0, 100] ke ca du lieu bat thuong', () => {
    expect(
      clampPercent(
        resourcePercents({
          ...RES,
          ram_total_mb: 0,
          ram_free_mb: 0,
          disk_total_gb: 0,
          disk_free_gb: -5,
          cpu_count: 0
        }).ram
      )
    ).toBeGreaterThanOrEqual(0)

    expect(resourcePercents({ ...RES, ram_free_mb: 0 }).ram).toBe(100)
    expect(resourcePercents({ ...RES, load_avg_1m: 99 }).cpu).toBe(100)
  })
})

describe('formatMb / formatGb', () => {
  it('tren 1024 MB thi doi sang GB 1 chu so thap phan', () => {
    expect(formatMb(2048)).toBe('2.0 GB')
    expect(formatMb(512)).toBe('512 MB')
    expect(formatGb(28)).toBe('28 GB')
  })
})

describe('rowDisplayStatus', () => {
  it('trang thai tai nguyen live duoc uu tien hon last_status trong DB', () => {
    expect(rowDisplayStatus(VPS, undefined)).toBe('unknown')
    expect(rowDisplayStatus({ ...VPS, last_status: 'online' }, undefined)).toBe('online')

    expect(rowDisplayStatus(VPS, { status: 'loading' })).toBe('checking')
    expect(rowDisplayStatus(VPS, { status: 'success', data: RES })).toBe('online')
    expect(rowDisplayStatus(VPS, { status: 'error', message: 'sshd khong tra loi' })).toBe(
      'offline'
    )
  })
})
