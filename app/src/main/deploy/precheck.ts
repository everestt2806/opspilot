import type { PrecheckResult } from '@shared/ipc'

import type { SshManager } from '../ssh/manager'

/** Ngưỡng precheck đã chốt (m04): RAM >512MB · disk >2GB · port chưa dùng · Docker có. */
export const RAM_MIN_MB = 512
export const DISK_MIN_GB = 2

export interface BaselineRaw {
  ramFreeMb: number
  diskFreeGb: number
  portUsed: boolean
  portInfo: string
  dockerVersion: string | null
}

export type PrecheckDetail = {
  checks: PrecheckResult['checks']
  passed: boolean
  dockerVersion: string | null
  portUsed: boolean
}

/** Một lệnh đọc-only, tách phần bằng marker để log gọn và parse chắc. */
export function baselineCommand(port: number | null): string {
  const portCheck =
    port === null
      ? ''
      : `printf 'PORT|'; ss -tlnp | grep ':${port} ' >/dev/null 2>&1 && echo 'USED' || echo 'FREE'\n`
  return [
    "printf 'RAM_MB|'; free -m | awk 'NR==2{print $7}'",
    "printf 'DISK_GB|'; df -BG --output=avail / | tail -1 | tr -d ' '",
    portCheck,
    "printf 'DOCKER|'; docker --version 2>&1; docker compose version 2>&1 | head -1"
  ]
    .filter((part) => part.length > 0)
    .join('\n')
}

export function parseBaselineOutput(output: string, port: number | null): BaselineRaw {
  const lines = output.split('\n')
  let ramFreeMb = 0
  let diskFreeGb = 0
  let portUsed = false
  let portInfo = ''
  let dockerVersion: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line.startsWith('RAM_MB|')) {
      ramFreeMb = Number.parseInt(line.slice('RAM_MB|'.length).trim(), 10) || 0
    } else if (line.startsWith('DISK_GB|')) {
      diskFreeGb = Number.parseInt(line.slice('DISK_GB|'.length).trim(), 10) || 0
    } else if (line.startsWith('PORT|')) {
      portUsed = line.includes('USED')
      portInfo = portUsed ? 'đang dùng' : 'chưa dùng'
    } else if (line.startsWith('DOCKER|')) {
      const match = line.match(/Docker version\s+(\S+)/)
      dockerVersion = match?.[1]?.replace(/,$/, '') ?? null
    }
  }

  if (port !== null && portInfo === '') {
    portInfo = 'không đọc được kết quả kiểm tra cổng'
  }

  return { ramFreeMb, diskFreeGb, portUsed, portInfo, dockerVersion }
}

export function evaluateBaseline(raw: BaselineRaw, port: number | null): PrecheckDetail {
  const checks: PrecheckResult['checks'] = [
    {
      label: 'RAM trống',
      required: `> ${RAM_MIN_MB} MB`,
      actual: `${raw.ramFreeMb} MB`,
      ok: raw.ramFreeMb > RAM_MIN_MB
    },
    {
      label: 'Disk trống',
      required: `> ${DISK_MIN_GB} GB`,
      actual: `${raw.diskFreeGb} GB`,
      ok: raw.diskFreeGb > DISK_MIN_GB
    }
  ]

  if (port !== null) {
    checks.push({
      label: `Cổng ${port}`,
      required: 'chưa dùng',
      actual: raw.portInfo,
      ok: !raw.portUsed
    })
  }

  checks.push({
    label: 'Docker',
    required: 'đã cài',
    actual: raw.dockerVersion ?? 'không tìm thấy',
    ok: raw.dockerVersion !== null
  })

  return {
    checks,
    passed: checks.every((check) => check.ok),
    dockerVersion: raw.dockerVersion,
    portUsed: raw.portUsed
  }
}

/** Chạy lệnh baseline trên VPS, trả kết quả có cấu trúc (không throw khi không đạt). */
export async function runPrecheck(
  ssh: SshManager,
  vpsId: number,
  opts: { port: number | null; signal?: AbortSignal }
): Promise<PrecheckDetail & { command: string }> {
  const command = baselineCommand(opts.port)
  const result = await ssh.exec(vpsId, command, { signal: opts.signal, timeoutMs: 30_000 })
  const raw = parseBaselineOutput(`${result.stdout}\n${result.stderr}`, opts.port)
  return { ...evaluateBaseline(raw, opts.port), command }
}

/** Dùng cho wizard deploy:precheck — app_url cần host thật của VPS. */
export function toPrecheckResult(
  detail: PrecheckDetail,
  assignedHostPort: number,
  vpsHost: string
): PrecheckResult {
  return {
    passed: detail.passed,
    checks: detail.checks,
    assigned_host_port: assignedHostPort,
    app_url: `http://${vpsHost}:${assignedHostPort}`
  }
}
