import { describe, expect, it, vi } from 'vitest'

import {
  assessReachability,
  decideUfw,
  diagnosePortBlockedExternal,
  parseUfwState,
  probeExternalReachable,
  ufwAllowCommand,
  type UfwState
} from './reachability'

describe('parseUfwState', () => {
  it('nhan dien active / inactive khong phan biet hoa thuong', () => {
    expect(parseUfwState('Status: active')).toBe('active')
    expect(parseUfwState('STATUS: ACTIVE\nTo Action')).toBe('active')
    expect(parseUfwState('Status: inactive')).toBe('inactive')
  })

  it('output la khi chua cai / loi sudo -> unknown', () => {
    expect(parseUfwState('sudo: ufw: command not found')).toBe('unknown')
    expect(parseUfwState('')).toBe('unknown')
    expect(parseUfwState('bat ky text nao khac')).toBe('unknown')
  })
})

describe('ufwAllowCommand', () => {
  it('sinh lenh dung cong tcp', () => {
    expect(ufwAllowCommand(30001)).toBe('ufw allow 30001/tcp')
  })

  it('nem loi voi cong khong hop le', () => {
    expect(() => ufwAllowCommand(0)).toThrow()
    expect(() => ufwAllowCommand(70000)).toThrow()
    expect(() => ufwAllowCommand(3.5)).toThrow()
  })
})

describe('decideUfw', () => {
  it('active -> mo cong', () => {
    const d = decideUfw('active', 30001)
    expect(d.shouldAllow).toBe(true)
    expect(d.command).toBe('ufw allow 30001/tcp')
    expect(d.logMessage).toContain('30001')
  })

  it('inactive -> no-op, khong lenh', () => {
    const d = decideUfw('inactive', 30001)
    expect(d.shouldAllow).toBe(false)
    expect(d.command).toBeNull()
    expect(d.logMessage).toContain('tắt')
  })

  it('unknown -> no-op an toan', () => {
    const d = decideUfw('unknown', 30001)
    expect(d.shouldAllow).toBe(false)
    expect(d.command).toBeNull()
  })

  it('phu het moi trang thai UfwState', () => {
    for (const state of ['active', 'inactive', 'unknown'] as UfwState[]) {
      expect(() => decideUfw(state, 30001)).not.toThrow()
    }
  })
})

describe('diagnosePortBlockedExternal', () => {
  it('dung code PORT_BLOCKED_EXTERNAL + co cong trong cause va fixes', () => {
    const diag = diagnosePortBlockedExternal(30002)
    expect(diag.code).toBe('PORT_BLOCKED_EXTERNAL')
    expect(diag.cause).toContain('30002')
    expect(diag.fixes.length).toBeGreaterThanOrEqual(3)
    expect(diag.fixes[0]).toContain('30002')
  })
})

describe('assessReachability', () => {
  it('loopback fail -> khong ket luan them, khong diagnosis', () => {
    const r = assessReachability(false, 'unreachable', 30001)
    expect(r.externalOk).toBe(false)
    expect(r.diagnosis).toBeNull()
    expect(r.logMessage).toContain('healthcheck nội bộ')
  })

  it('loopback ok + external ok -> URL dung duoc, khong diagnosis', () => {
    const r = assessReachability(true, 'reachable', 30001)
    expect(r.externalOk).toBe(true)
    expect(r.diagnosis).toBeNull()
    expect(r.logMessage).toContain('OK')
  })

  it('loopback ok + external fail -> dung PORT_BLOCKED_EXTERNAL', () => {
    const r = assessReachability(true, 'unreachable', 30001)
    expect(r.externalOk).toBe(false)
    expect(r.diagnosis?.code).toBe('PORT_BLOCKED_EXTERNAL')
    expect(r.logMessage).toContain('THẤT BẠI')
  })
})

describe('probeExternalReachable', () => {
  it('reachable neu bat ky lan nao thong', async () => {
    const probe = vi
      .fn<[string], Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const outcome = await probeExternalReachable('http://x:30001/', 3, probe)
    expect(outcome).toBe('reachable')
    expect(probe).toHaveBeenCalledTimes(2) // dung ngay khi thong
  })

  it('unreachable khi moi lan deu fail, thu du so lan', async () => {
    const probe = vi.fn<[string], Promise<boolean>>().mockResolvedValue(false)
    const outcome = await probeExternalReachable('http://x:30001/', 3, probe)
    expect(outcome).toBe('unreachable')
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('it nhat 1 lan du truyen attempts < 1', async () => {
    const probe = vi.fn<[string], Promise<boolean>>().mockResolvedValue(false)
    await probeExternalReachable('http://x:30001/', 0, probe)
    expect(probe).toHaveBeenCalledTimes(1)
  })
})
