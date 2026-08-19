import { AppError } from '../errors'
import type { SshManager } from '../ssh/manager'

/**
 * FR-A2: cài Docker bằng script chính thức (get.docker.com) khi "Kiểm tra kết nối"
 * phát hiện máy chủ chưa có Docker. Mất thường 1-3 phút, chặn trên 10 phút.
 */
export const DOCKER_INSTALL_TIMEOUT_MS = 600_000

export async function installDockerOnVps(ssh: SshManager, vpsId: number): Promise<string> {
  const install = await ssh.exec(vpsId, 'curl -fsSL https://get.docker.com | sh', {
    timeoutMs: DOCKER_INSTALL_TIMEOUT_MS
  })
  if (install.code !== 0) {
    throw new AppError(
      'DOCKER_MISSING',
      'Cài Docker không thành công. Hãy kiểm tra Internet của máy chủ rồi thử lại, hoặc cài thủ công theo hướng dẫn của Docker.',
      { cause: new Error(install.stderr.trim() || install.stdout.trim()) }
    )
  }

  const version = await readDockerVersion(ssh, vpsId)
  if (!version) {
    throw new AppError(
      'DOCKER_MISSING',
      'Script cài Docker đã chạy xong nhưng không đọc được phiên bản. Hãy thử "Kiểm tra kết nối" lại.',
      { cause: new Error(install.stdout.trim()) }
    )
  }
  return version
}

export async function readDockerVersion(ssh: SshManager, vpsId: number): Promise<string | null> {
  const result = await ssh.exec(vpsId, 'docker --version')
  if (result.code !== 0) {
    return null
  }
  const version = result.stdout.trim().replace(/^Docker version\s+/i, '')
  return version.length > 0 ? version : null
}
