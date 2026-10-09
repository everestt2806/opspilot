import { describe, expect, it, vi } from 'vitest'

import type { SshManager } from '../ssh/manager'
import {
  baselineCommand,
  evaluateBaseline,
  parseBaselineOutput,
  parseListeningPorts,
  readExistingEnvFile,
  RAM_MIN_MB
} from './precheck'

describe('parseListeningPorts', () => {
  it('tach port IPv4 va IPv6 tu ss, loai trung va sap xep', () => {
    expect(
      parseListeningPorts(
        [
          'LISTEN 0 4096 0.0.0.0:30023 0.0.0.0:*',
          'LISTEN 0 4096 [::]:30000 [::]:*',
          'LISTEN 0 4096 0.0.0.0:30000 0.0.0.0:*',
          'LISTEN 0 128 127.0.0.1:22 0.0.0.0:*'
        ].join('\n')
      )
    ).toEqual([22, 30000, 30023])
  })
})

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

  it('maps free -m available column to the RAM value used for the deployment gate', () => {
    const raw = parseBaselineOutput('RAM_MB|2989\nDISK_GB|17\nDOCKER|Docker version 29.8.2', null)
    expect(raw.ramFreeMb).toBe(2989)
    expect(
      evaluateBaseline(
        {
          ...raw,
          portUsed: false,
          portInfo: 'chưa dùng'
        },
        null
      ).passed
    ).toBe(true)
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

describe('readExistingEnvFile', () => {
  it('uses a bounded read-only SshManager command and accepts only its captured content', async () => {
    const ssh = {
      exec: vi.fn<SshManager['exec']>(async () => ({
        code: 0,
        stdout: 'API_TOKEN=fake-secret-value\n',
        stderr: ''
      }))
    }
    const result = await readExistingEnvFile(ssh as never, 7, '/opt/opspilot/demo/.env')

    expect(result).toBe('API_TOKEN=fake-secret-value\n')
    expect(ssh.exec).toHaveBeenCalledWith(
      7,
      expect.stringContaining('head -c'),
      expect.objectContaining({ timeoutMs: 10_000, logCommand: false })
    )
    expect(ssh.exec.mock.calls[0][1]).toContain("'/opt/opspilot/demo/.env'")
  })

  it.each([
    { name: 'missing or unreadable file', result: { code: 66, stdout: '', stderr: 'private fake detail' } },
    {
      name: 'oversized file',
      result: { code: 0, stdout: 'x'.repeat(64 * 1024 + 1), stderr: '' }
    }
  ])('fails closed for $name without returning raw source output', async ({ result }) => {
    const ssh = { exec: vi.fn(async () => result) }
    await expect(readExistingEnvFile(ssh as never, 7, '/opt/opspilot/demo/.env')).rejects.toMatchObject({
      userMessage: 'Không thể xác minh cấu hình environment hiện có trên VPS.'
    })
  })

  it('sanitizes SSH exceptions', async () => {
    const ssh = {
      exec: vi.fn(async () => Promise.reject(new Error('fake-secret-value in stderr')))
    }
    await expect(readExistingEnvFile(ssh as never, 7, '/opt/opspilot/demo/.env')).rejects.toMatchObject({
      userMessage: 'Không thể xác minh cấu hình environment hiện có trên VPS.'
    })
  })
})
