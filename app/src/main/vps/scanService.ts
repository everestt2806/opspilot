import type { VpsScanItem, VpsScanResult } from '@shared/ipc'

import { SshManager, type ExecResult } from '../ssh/manager'

const WORKDIR = '/opt/opspilot'

type ToolKey = 'docker' | 'compose' | 'node' | 'git'

const TOOLS: Record<ToolKey, { command: string; versionPrefix: string }> = {
  docker: { command: 'docker --version', versionPrefix: 'Docker version' },
  compose: { command: 'docker compose version', versionPrefix: 'Docker Compose version' },
  node: { command: 'node --version', versionPrefix: '' },
  git: { command: 'git --version', versionPrefix: 'git version' }
}

/** Gọt phiên bản khỏi stdout: bỏ tiền tố rồi lấy token đầu
 *  (vd 'Docker version 27.1.1, build...' -> '27.1.1'). Pure để test không cần SSH. */
export function stripVersion(output: string, prefix: string): string | null {
  const trimmed = output.trim()
  if (!trimmed) {
    return null
  }
  const rest = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : trimmed
  return rest.split(/[\s,]/)[0] || null
}

/** Dựng một hạng mục quét từ kết quả exec — pure để test không cần SSH. */
export function buildToolItem(key: ToolKey, result: ExecResult): VpsScanItem {
  const version = stripVersion(result.stdout, TOOLS[key].versionPrefix)
  const ok = result.code === 0 && version !== null
  return {
    key,
    ok,
    version: ok ? version : null,
    detail: ok ? undefined : result.stderr.trim() || result.stdout.trim() || undefined
  }
}

/** Quét môi trường một VPS đã lưu (không cần nhập lại credential — dùng credential
 *  đã mã hoá trong DB). Bước kết nối nằm ngoài try/catch để lỗi SSH trả mã chẩn đoán
 *  TK-A10 qua `toIpcError` của ipc handle; lệnh lẻ thất bại chỉ bôi đỏ hạng mục đó. */
export async function scanVpsEnvironment(ssh: SshManager, vpsId: number): Promise<VpsScanResult> {
  await ssh.connect(vpsId)

  const items: VpsScanItem[] = []
  for (const key of ['docker', 'compose', 'node', 'git'] as const) {
    try {
      items.push(buildToolItem(key, await ssh.exec(vpsId, TOOLS[key].command)))
    } catch {
      items.push({ key, ok: false, version: null, detail: 'lỗi SSH' })
    }
  }

  try {
    const probe = await ssh.exec(
      vpsId,
      `touch ${WORKDIR}/.opspilot-probe && rm ${WORKDIR}/.opspilot-probe`
    )
    const writable = probe.code === 0
    items.push({
      key: 'workdir',
      ok: writable,
      version: null,
      detail: writable ? undefined : probe.stderr.trim() || undefined
    })
  } catch {
    items.push({ key: 'workdir', ok: false, version: null, detail: 'lỗi SSH' })
  }

  items.unshift({ key: 'ssh', ok: true, version: null })

  return { scanned_at: new Date().toISOString(), ssh_ok: true, items }
}
