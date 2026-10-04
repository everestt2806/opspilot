import { describe, expect, it } from 'vitest'

import type { Vps, VpsResources } from '@shared/ipc'

import {
  clampPercent,
  evaluateVpsStatus,
  formatGb,
  formatMb,
  isVpsCheckedNow,
  isVpsCheckFailed,
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

describe('evaluateVpsStatus & rowDisplayStatus — quy tac trang thai trung thuc', () => {
  const baseNow = Date.parse('2026-10-04T12:00:00Z')

  it('VPS vua kiem tra: thanh cong trong phien -> checked_now (isFresh: true)', () => {
    const res = evaluateVpsStatus(VPS, { status: 'success', data: RES }, baseNow)
    expect(res.key).toBe('checked_now')
    expect(res.source).toBe('session_probe')
    expect(res.isFresh).toBe(true)
    expect(rowDisplayStatus(VPS, { status: 'success', data: RES }, baseNow)).toBe('checked_now')
    expect(isVpsCheckedNow(VPS, { status: 'success', data: RES }, baseNow)).toBe(true)
    expect(isVpsCheckFailed(VPS, { status: 'success', data: RES }, baseNow)).toBe(false)
  })

  it('loi doc tai nguyen: check_failed, khong tu ket luan VPS offline', () => {
    const res = evaluateVpsStatus(VPS, { status: 'error', message: 'sshd khong tra loi' }, baseNow)
    expect(res.key).toBe('check_failed')
    expect(res.source).toBe('session_probe')
    expect(res.isFresh).toBe(false)
    expect(rowDisplayStatus(VPS, { status: 'error', message: 'sshd khong tra loi' }, baseNow)).toBe(
      'check_failed'
    )
    expect(isVpsCheckFailed(VPS, { status: 'error', message: 'sshd khong tra loi' }, baseNow)).toBe(
      true
    )
    expect(isVpsCheckedNow(VPS, { status: 'error', message: 'sshd khong tra loi' }, baseNow)).toBe(
      false
    )
  })

  it('dang kiem tra: loading -> checking', () => {
    const res = evaluateVpsStatus(VPS, { status: 'loading' }, baseNow)
    expect(res.key).toBe('checking')
    expect(res.source).toBe('session_probe')
    expect(rowDisplayStatus(VPS, { status: 'loading' }, baseNow)).toBe('checking')
  })

  it('chua tung ket noi: last_seen_at null -> unknown du DB co last_status online', () => {
    const vps = { ...VPS, last_seen_at: null, last_status: 'online' as const }
    const res = evaluateVpsStatus(vps, undefined, baseNow)
    expect(res.key).toBe('unknown')
    expect(res.source).toBe('db_record')
    expect(rowDisplayStatus(vps, undefined, baseNow)).toBe('unknown')
    expect(isVpsCheckedNow(vps, undefined, baseNow)).toBe(false)
  })

  it('14 ngay chua kiem tra: >24h -> stale (chua kiem tra gan day)', () => {
    const fourteenDaysAgo = new Date(baseNow - 14 * 24 * 60 * 60 * 1000).toISOString()
    const vps = { ...VPS, last_seen_at: fourteenDaysAgo, last_status: 'online' as const }
    const res = evaluateVpsStatus(vps, undefined, baseNow)
    expect(res.key).toBe('stale')
    expect(res.source).toBe('db_record')
    expect(rowDisplayStatus(vps, undefined, baseNow)).toBe('stale')
    expect(isVpsCheckedNow(vps, undefined, baseNow)).toBe(false)
  })

  it('timestamp khong hop le: sai dinh dang -> unknown', () => {
    const vps = { ...VPS, last_seen_at: 'sai-dinh-dang-ngay', last_status: 'online' as const }
    const res = evaluateVpsStatus(vps, undefined, baseNow)
    expect(res.key).toBe('unknown')
    expect(rowDisplayStatus(vps, undefined, baseNow)).toBe('unknown')
  })

  it('timestamp tuong lai vuot 60s -> unknown', () => {
    const futureDate = new Date(baseNow + 2 * 60 * 60 * 1000).toISOString()
    const vps = { ...VPS, last_seen_at: futureDate, last_status: 'online' as const }
    const res = evaluateVpsStatus(vps, undefined, baseNow)
    expect(res.key).toBe('unknown')
    expect(rowDisplayStatus(vps, undefined, baseNow)).toBe('unknown')
  })

  it('da kiem tra trong 24h: recent_past, khong bao gio coi la checked_now', () => {
    const twoHoursAgo = new Date(baseNow - 2 * 60 * 60 * 1000).toISOString()
    const vps = { ...VPS, last_seen_at: twoHoursAgo, last_status: 'online' as const }
    const res = evaluateVpsStatus(vps, undefined, baseNow)
    expect(res.key).toBe('recent_past')
    expect(rowDisplayStatus(vps, undefined, baseNow)).toBe('recent_past')
    expect(isVpsCheckedNow(vps, undefined, baseNow)).toBe(false)
  })
})
