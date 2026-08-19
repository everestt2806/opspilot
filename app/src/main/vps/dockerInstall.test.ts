import { describe, expect, it, vi } from 'vitest'

import type { SshManager } from '../ssh/manager'
import { installDockerOnVps, readDockerVersion } from './dockerInstall'

function stubSsh(execResult: { code: number; stdout: string; stderr: string }): SshManager {
  return { exec: vi.fn(async () => execResult) } as unknown as SshManager
}

describe('readDockerVersion', () => {
  it('cat duoc version tu output lenh docker --version', async () => {
    const ssh = stubSsh({ code: 0, stdout: 'Docker version 27.1.0, build 6312585\n', stderr: '' })
    expect(await readDockerVersion(ssh, 1)).toBe('27.1.0, build 6312585')
  })

  it('tra null khi lenh that bai', async () => {
    const ssh = stubSsh({ code: 127, stdout: '', stderr: 'not found' })
    expect(await readDockerVersion(ssh, 1)).toBeNull()
  })
})

describe('installDockerOnVps', () => {
  it('bao DOCKER_MISSING khi script cai Docker that bai', async () => {
    const ssh = stubSsh({ code: 1, stdout: '', stderr: 'curl: network error' })
    let error: unknown
    try {
      await installDockerOnVps(ssh, 1)
    } catch (caught) {
      error = caught
    }
    expect((error as { code?: string }).code).toBe('DOCKER_MISSING')
  })

  it('bao DOCKER_MISSING khi cai xong nhung khong doc duoc version', async () => {
    const ssh = {
      exec: vi.fn(async (_vpsId: number, command: string) =>
        command === 'docker --version'
          ? { code: 127, stdout: '', stderr: 'not found' }
          : { code: 0, stdout: 'ok\n', stderr: '' }
      )
    } as unknown as SshManager

    let error: unknown
    try {
      await installDockerOnVps(ssh, 1)
    } catch (caught) {
      error = caught
    }
    expect((error as { code?: string }).code).toBe('DOCKER_MISSING')
  })
})
