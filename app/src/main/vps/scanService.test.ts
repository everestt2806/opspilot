import { describe, expect, it, vi } from 'vitest'

import type { SshManager } from '../ssh/manager'

import { buildToolItem, scanVpsEnvironment, stripVersion } from './scanService'

function okRun(stdout: string): { code: number; stdout: string; stderr: string } {
  return { code: 0, stdout, stderr: '' }
}

describe('stripVersion — gọt phiên bản khỏi stdout', () => {
  it('docker: bỏ tiền tố + lấy token đầu, bỏ phần build', () => {
    expect(stripVersion('Docker version 27.1.1, build 123\n', 'Docker version')).toBe('27.1.1')
  })

  it('node: không tiền tố, stdout chỉ có version', () => {
    expect(stripVersion('v20.11.1\n', '')).toBe('v20.11.1')
  })

  it('rỗng hoặc toàn khoảng trắng -> null', () => {
    expect(stripVersion('', 'Docker version')).toBeNull()
    expect(stripVersion('   \n', 'Docker version')).toBeNull()
  })
})

describe('buildToolItem — dựng hạng mục quét từ kết quả exec', () => {
  it('thành công: ok + version đã gọt', () => {
    expect(buildToolItem('docker', okRun('Docker version 27.1.1, build 123'))).toEqual({
      key: 'docker',
      ok: true,
      version: '27.1.1'
    })
  })

  it('thiếu lệnh: thất bại + detail từ stderr', () => {
    const item = buildToolItem('docker', {
      code: 127,
      stdout: '',
      stderr: 'docker: command not found'
    })
    expect(item.ok).toBe(false)
    expect(item.version).toBeNull()
    expect(item.detail).toBe('docker: command not found')
  })

  it('thoát 0 nhưng stdout không có version -> tính là thất bại', () => {
    const item = buildToolItem('node', { code: 0, stdout: '', stderr: '' })
    expect(item.ok).toBe(false)
    expect(item.detail).toBeUndefined()
  })
})

describe('scanVpsEnvironment — quét tuần tự qua ssh exec', () => {
  it('đủ 6 hạng mục đúng thứ tự, mỗi lệnh có version riêng', async () => {
    const exec = vi.fn(async (_vpsId: number, command: string) => {
      if (command.startsWith('docker compose')) {
        return okRun('Docker Compose version v2.29.1\n')
      }
      if (command.startsWith('docker')) {
        return okRun('Docker version 27.1.1, build 123')
      }
      if (command.startsWith('node')) {
        return okRun('v20.11.1\n')
      }
      if (command.startsWith('git')) {
        return okRun('git version 2.43.0\n')
      }
      return okRun('') // probe workdir
    })
    const ssh = { connect: vi.fn(), exec } as unknown as SshManager

    const result = await scanVpsEnvironment(ssh, 7)

    expect(ssh.connect).toHaveBeenCalledWith(7)
    expect(result.ssh_ok).toBe(true)
    expect(result.scanned_at).toBeTruthy()
    expect(result.items.map((item) => item.key)).toEqual([
      'ssh',
      'docker',
      'compose',
      'node',
      'git',
      'workdir'
    ])
    expect(result.items.find((item) => item.key === 'docker')?.version).toBe('27.1.1')
    expect(result.items.find((item) => item.key === 'compose')?.version).toBe('v2.29.1')
    expect(result.items.find((item) => item.key === 'ssh')?.ok).toBe(true)
    expect(result.items.find((item) => item.key === 'workdir')?.ok).toBe(true)
  })

  it('thiếu git: chỉ hạng mục đó đỏ, các hạng mục khác vẫn chạy', async () => {
    const exec = vi.fn(async (_vpsId: number, command: string) => {
      if (command.startsWith('git')) {
        return { code: 127, stdout: '', stderr: 'git: command not found' }
      }
      return okRun('v20.11.1\n')
    })
    const ssh = { connect: vi.fn(), exec } as unknown as SshManager

    const result = await scanVpsEnvironment(ssh, 7)

    const git = result.items.find((item) => item.key === 'git')
    expect(git?.ok).toBe(false)
    expect(git?.detail).toBe('git: command not found')
    expect(result.items.find((item) => item.key === 'node')?.ok).toBe(true)
    expect(result.items.filter((item) => item.ok).length).toBe(5)
  })

  it('lệnh lẻ ném lỗi SSH giữa chừng: hạng mục đó đỏ, không nuốt cả lượt quét', async () => {
    const exec = vi.fn(async (_vpsId: number, command: string) => {
      if (command.startsWith('docker')) {
        throw new Error('connection lost')
      }
      return okRun('git version 2.43.0\n')
    })
    const ssh = { connect: vi.fn(), exec } as unknown as SshManager

    const result = await scanVpsEnvironment(ssh, 7)

    expect(result.items.find((item) => item.key === 'docker')?.ok).toBe(false)
    expect(result.items.find((item) => item.key === 'git')?.ok).toBe(true)
    expect(result.items.length).toBe(6)
  })

  it('connect thất bại: ném ra ngoài để ipc handle trả mã SSH_* chẩn đoán', async () => {
    const ssh = {
      connect: vi.fn().mockRejectedValue(new Error('x')),
      exec: vi.fn()
    } as unknown as SshManager

    await expect(scanVpsEnvironment(ssh, 7)).rejects.toThrow('x')
    expect(ssh.exec).not.toHaveBeenCalled()
  })
})
