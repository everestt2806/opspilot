import type { VpsConnectionCheck, VpsResources } from '@shared/ipc'

import { SshManager, type SshConnectionInfo } from '../ssh/manager'

const WORKDIR = '/opt/opspilot'

/** FR-A2: test kết nối bằng credential người dùng vừa nhập (trước khi lưu VPS).
 *  Dùng manager dùng một lần, không đụng pool/DB — UI gọi khi bấm "Kiểm tra". */
export async function testConnectionWithCredentials(
  config: SshConnectionInfo
): Promise<VpsConnectionCheck> {
  const ssh = new SshManager(() => config)
  await ssh.connect(1)
  const check = await probeVps(ssh, 1)
  await ssh.disconnect(1)
  return check
}

/** FR-A2: kiểm tra một VPS đã lưu — trả `VpsConnectionCheck` với các bước tuần tự. */
export async function checkVpsConnection(
  ssh: SshManager,
  vpsId: number
): Promise<VpsConnectionCheck> {
  await ssh.connect(vpsId)
  return probeVps(ssh, vpsId)
}

async function probeVps(ssh: SshManager, vpsId: number): Promise<VpsConnectionCheck> {
  const steps: VpsConnectionCheck['steps'] = []
  let dockerVersion: string | null = null
  let dockerInstalled = false
  let workdirWritable = false

  try {
    const dockerResult = await ssh.exec(vpsId, 'docker --version')
    const version = dockerResult.stdout.trim().replace(/^Docker version\s+/i, '')
    dockerInstalled = dockerResult.code === 0 && version.length > 0
    dockerVersion = dockerInstalled ? version : null
    steps.push({
      label: 'Docker',
      ok: dockerInstalled,
      detail: dockerInstalled ? (dockerVersion ?? 'OK') : dockerResult.stderr.trim() || 'chưa cài'
    })
  } catch {
    steps.push({ label: 'Docker', ok: false, detail: 'lỗi SSH' })
  }

  try {
    const probeResult = await ssh.exec(
      vpsId,
      `touch ${WORKDIR}/.opspilot-probe && rm ${WORKDIR}/.opspilot-probe`
    )
    workdirWritable = probeResult.code === 0
    steps.push({
      label: `Ghi được ${WORKDIR}`,
      ok: workdirWritable,
      detail: workdirWritable ? 'OK' : probeResult.stderr.trim() || 'tail / không cho ghi'
    })
  } catch {
    steps.push({ label: `Ghi được ${WORKDIR}`, ok: false, detail: 'lỗi SSH' })
  }

  steps.unshift({ label: 'Kết nối SSH', ok: true, detail: 'OK' })

  return {
    ssh_ok: true,
    docker_installed: dockerInstalled,
    docker_version: dockerVersion,
    workdir_writable: workdirWritable,
    steps
  }
}

/** FR-A3: đọc tài nguyên khả dụng của VPS bằng SSH. */
export async function readVpsResources(ssh: SshManager, vpsId: number): Promise<VpsResources> {
  const command = [
    "printf 'RAM|'; free -b | awk 'NR==2{print $2,$4}'",
    "printf 'DISK|'; df -P -m / | tail -1",
    "printf 'CPU|'; nproc",
    "printf 'LOAD|'; cut -d' ' -f1 /proc/loadavg"
  ].join('; ')

  const result = await ssh.exec(vpsId, command)
  if (result.code !== 0) {
    throw new Error(`Đọc tài nguyên VPS thất bại: ${result.stderr.trim() || result.stdout.trim()}`)
  }

  return parseResourcesOutput(result.stdout)
}

/** Tách phần pure để test không cần SSH (docs/10 mục 2: validate ngay ranh giới). */
export function parseResourcesOutput(output: string): VpsResources {
  const parsed: Record<string, number> = {}
  for (const line of output.split('\n')) {
    const [key, value] = line.split('|')
    if (!value) {
      continue
    }
    if (key === 'RAM') {
      const [totalBytes, freeBytes] = value.trim().split(/\s+/).map(Number)
      parsed.ram_total_mb = Math.round(totalBytes / (1024 * 1024))
      parsed.ram_free_mb = Math.round(freeBytes / (1024 * 1024))
    } else if (key === 'DISK') {
      const fields = value.trim().split(/\s+/)
      parsed.disk_total_gb = Math.round(Number(fields[1]) / 1024)
      parsed.disk_free_gb = Math.round(Number(fields[3]) / 1024)
    } else if (key === 'CPU') {
      parsed.cpu_count = Number(value.trim())
    } else if (key === 'LOAD') {
      parsed.load_avg_1m = Number(value.trim())
    }
  }

  if (
    parsed.ram_total_mb === undefined ||
    parsed.ram_free_mb === undefined ||
    parsed.disk_total_gb === undefined ||
    parsed.disk_free_gb === undefined ||
    parsed.cpu_count === undefined ||
    parsed.load_avg_1m === undefined
  ) {
    throw new Error(`Phân tích tài nguyên VPS không đầy đủ. Kết quả thô: ${output.trim()}`)
  }

  return {
    ram_total_mb: parsed.ram_total_mb,
    ram_free_mb: parsed.ram_free_mb,
    disk_total_gb: parsed.disk_total_gb,
    disk_free_gb: parsed.disk_free_gb,
    cpu_count: parsed.cpu_count,
    load_avg_1m: parsed.load_avg_1m
  }
}
