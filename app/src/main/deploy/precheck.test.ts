import { describe, expect, it } from 'vitest'

import { baselineCommand, evaluateBaseline, parseBaselineOutput, RAM_MIN_MB } from './precheck'

describe('baselineCommand', () => {
  it('gom RAM/DISK/DOCKER vao mot lenh doc-only', () => {
    const command = baselineCommand(null)
    expect(command).toContain("printf 'RAM_MB|'")
    expect(command).toContain("printf 'DISK_GB|'")
    expect(command).toContain("printf 'DOCKER|'")
    expect(command).not.toContain("printf 'PORT|'")
  })

  it('them kiem tra port khi co port du kien', () => {
    const command = baselineCommand(30001)
    expect(command).toContain("printf 'PORT|'")
    expect(command).toContain(':30001 ')
  })
})

describe('parseBaselineOutput', () => {
  it('tach du nhan RAM/DISK/PORT/DOCKER tu output', () => {
    const raw = parseBaselineOutput(
      [
        'RAM_MB|2048',
        'DISK_GB|20',
        'PORT|FREE',
        'DOCKER|Docker version 27.1.0, build 6312585',
        'Docker Compose version v2.29.1'
      ].join('\n'),
      30001
    )
    expect(raw).toEqual({
      ramFreeMb: 2048,
      diskFreeGb: 20,
      portUsed: false,
      portInfo: 'chưa dùng',
      dockerVersion: '27.1.0'
    })
  })

  it('thieu marker DOCKER -> dockerVersion null; khong co ket qua PORT -> bao loi doc', () => {
    const raw = parseBaselineOutput('RAM_MB|128\nDISK_GB|3', 30001)
    expect(raw.dockerVersion).toBeNull()
    expect(raw.portInfo).toBe('không đọc được kết quả kiểm tra cổng')
    expect(raw.portUsed).toBe(false)
  })
})

describe('evaluateBaseline', () => {
  it('dat khi RAM/disk/docker du va port chua dung', () => {
    const detail = evaluateBaseline(
      {
        ramFreeMb: 1024,
        diskFreeGb: 10,
        portUsed: false,
        portInfo: 'chưa dùng',
        dockerVersion: '27.1.0'
      },
      30001
    )
    expect(detail.passed).toBe(true)
    expect(detail.checks).toHaveLength(4)
    expect(detail.checks.every((check) => check.ok)).toBe(true)
  })

  it('truot khi RAM duoi nguong', () => {
    const detail = evaluateBaseline(
      {
        ramFreeMb: RAM_MIN_MB - 1,
        diskFreeGb: 10,
        portUsed: false,
        portInfo: 'chưa dùng',
        dockerVersion: '27.1.0'
      },
      null
    )
    expect(detail.passed).toBe(false)
    expect(detail.checks.find((check) => check.label === 'RAM trống')?.ok).toBe(false)
  })

  it('truot khi port du kien dang duoc dung', () => {
    const detail = evaluateBaseline(
      {
        ramFreeMb: 1024,
        diskFreeGb: 10,
        portUsed: true,
        portInfo: 'đang dùng',
        dockerVersion: '27.1.0'
      },
      30001
    )
    expect(detail.passed).toBe(false)
    expect(detail.checks.find((check) => check.label === 'Cổng 30001')?.ok).toBe(false)
  })
})
