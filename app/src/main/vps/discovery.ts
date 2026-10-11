import type { DiscoveredVpsApp } from '@shared/ipc'

import { AppError } from '../errors'
import type { SshManager } from '../ssh/manager'

const MAX_BYTES = 65_536
const MAX_CONTAINERS = 100
// Chỉ chọn ba nhãn Compose cần xác minh. `.Labels` có thể chứa dữ liệu tùy ý.
const TEMPLATE =
  '{"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Ports":{{json .Ports}},"Directory":{{json (.Label "com.docker.compose.project.working_dir")}},"Service":{{json (.Label "com.docker.compose.service")}},"Config":{{json (.Label "com.docker.compose.project.config_files")}}}'
// Không dùng docker inspect vì dữ liệu inspect chứa Env.
const COMMAND = `out=$(docker ps -a --last 101 --filter label=com.docker.compose.service=app --format '${TEMPLATE}' 2>/dev/null) || exit 4; printf '%s\n' "$out" | head -c ${MAX_BYTES + 1}`

type DockerRow = {
  Names?: unknown
  Image?: unknown
  State?: unknown
  Ports?: unknown
  Directory?: unknown
  Service?: unknown
  Config?: unknown
}

function parsePort(value: string): number | null {
  const matches = [...value.matchAll(/(?:0\.0\.0\.0:|\[::\]:|:::)(\d+)->\d+\/tcp/g)]
  if (matches.length === 0) return null
  const ports = new Set(matches.map((match) => Number(match[1])))
  if (ports.size !== 1) return null
  const port = [...ports][0]
  return Number.isSafeInteger(port) && port > 0 && port <= 65_535 ? port : null
}

/** Đọc chỉ các thuộc tính không nhạy cảm, rồi xác thực bộ ba tên/image/Compose path. */
export function parseDiscoveredApps(output: string): DiscoveredVpsApp[] {
  if (Buffer.byteLength(output, 'utf8') > MAX_BYTES) {
    throw new AppError('VALIDATION', 'Danh sách container quá lớn để xác minh an toàn.')
  }
  const lines = output.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length > MAX_CONTAINERS) {
    throw new AppError('VALIDATION', 'VPS có quá nhiều container; không thể quét đầy đủ.')
  }
  const discovered = new Map<string, DiscoveredVpsApp>()
  const ambiguous = new Set<string>()
  for (const line of lines) {
    let row: DockerRow
    try {
      row = JSON.parse(line) as DockerRow
    } catch {
      throw new AppError('VALIDATION', 'Docker trả về dữ liệu container không hợp lệ.')
    }
    if (
      typeof row?.Names !== 'string' ||
      typeof row.Image !== 'string' ||
      typeof row.State !== 'string' ||
      typeof row.Ports !== 'string' ||
      typeof row.Directory !== 'string' ||
      typeof row.Service !== 'string' ||
      typeof row.Config !== 'string'
    ) {
      continue
    }
    const match = /^([a-z0-9][a-z0-9-]{0,30})-app$/.exec(row.Names)
    if (!match) continue
    const name = match[1]
    const image = new RegExp(`^${name}:v([1-9][0-9]*)$`).exec(row.Image)
    if (!image) continue
    const version = Number(image[1])
    if (!Number.isSafeInteger(version)) continue
    const dir = `/opt/opspilot/${name}`
    if (
      row.Service !== 'app' ||
      row.Directory !== dir ||
      row.Config !== `${dir}/docker-compose.yml`
    ) {
      continue
    }
    if (!/^(running|exited|created|restarting|paused|dead)$/.test(row.State)) continue
    if (discovered.has(name) || ambiguous.has(name)) {
      // Hai container cùng tên app không đủ bằng chứng để chọn bản hiện hành.
      discovered.delete(name)
      ambiguous.add(name)
      continue
    }
    discovered.set(name, {
      name,
      image_tag: row.Image,
      version,
      host_port: parsePort(row.Ports),
      state: row.State
    })
  }
  return [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function discoverVpsApps(
  ssh: Pick<SshManager, 'exec'>,
  vpsId: number
): Promise<DiscoveredVpsApp[]> {
  if (!Number.isSafeInteger(vpsId) || vpsId <= 0) {
    throw new AppError('VALIDATION', 'VPS không hợp lệ. Hãy tải lại danh sách.')
  }
  const result = await ssh.exec(vpsId, COMMAND, {
    timeoutMs: 10_000,
    logCommand: false,
    retryOnReconnect: false
  })
  if (result.code !== 0) {
    throw new AppError('UNKNOWN', 'Không thể đọc danh sách container Docker trên VPS.')
  }
  return parseDiscoveredApps(result.stdout)
}
