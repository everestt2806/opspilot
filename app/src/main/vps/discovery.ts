import type { DiscoveredVpsApp } from '@shared/ipc'

import { AppError } from '../errors'
import { parseAppManifest, type AppManifest } from '../deploy/appManifest'
import type { SshManager } from '../ssh/manager'

const MAX_BYTES = 65_536
const MAX_CONTAINERS = 100
const MAX_MANIFEST_BYTES = 16_384
const MAX_CONCURRENT_MANIFEST_READS = 4
const TEMPLATE =
  '{"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Ports":{{json .Ports}},"Directory":{{json (.Label "com.docker.compose.project.working_dir")}},"Service":{{json (.Label "com.docker.compose.service")}},"Config":{{json (.Label "com.docker.compose.project.config_files")}}}'
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

type DockerCandidate = {
  name: string
  image_tag: string
  version: number
  host_port: number | null
  container_port: number | null
  state: string
  ambiguous: boolean
}

function parsePorts(value: string): { host: number | null; container: number | null } {
  const matches = [...value.matchAll(/(?:0\.0\.0\.0:|\[::\]:|:::)(\d+)->(\d+)\/tcp/g)]
  const pairs = new Set(matches.map((match) => `${match[1]}:${match[2]}`))
  if (pairs.size !== 1) return { host: null, container: null }
  const [host, container] = [...pairs][0].split(':').map(Number)
  if (
    ![host, container].every((port) => Number.isSafeInteger(port) && port > 0 && port <= 65_535)
  ) {
    return { host: null, container: null }
  }
  return { host, container }
}

function parseDockerCandidates(output: string): DockerCandidate[] {
  if (Buffer.byteLength(output, 'utf8') > MAX_BYTES)
    throw new AppError('VALIDATION', 'Danh sách container quá lớn để xác minh an toàn.')
  const lines = output.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length > MAX_CONTAINERS)
    throw new AppError('VALIDATION', 'VPS có quá nhiều container; không thể quét đầy đủ.')
  const candidates = new Map<string, DockerCandidate>()
  const duplicates = new Set<string>()
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
    )
      continue
    const match = /^([a-z0-9][a-z0-9-]{0,30})-app$/.exec(row.Names)
    if (!match) continue
    const name = match[1]
    const image = new RegExp(`^${name}:v([1-9][0-9]*)$`).exec(row.Image)
    if (!image || !Number.isSafeInteger(Number(image[1]))) continue
    const dir = `/opt/opspilot/${name}`
    if (
      row.Service !== 'app' ||
      row.Directory !== dir ||
      row.Config !== `${dir}/docker-compose.yml`
    )
      continue
    if (!/^(running|exited|created|restarting|paused|dead)$/.test(row.State)) continue
    if (candidates.has(name) || duplicates.has(name)) {
      candidates.delete(name)
      duplicates.add(name)
      continue
    }
    const ports = parsePorts(row.Ports)
    candidates.set(name, {
      name,
      image_tag: row.Image,
      version: Number(image[1]),
      ...{ host_port: ports.host, container_port: ports.container },
      state: row.State,
      ambiguous: false
    })
  }
  for (const name of duplicates) {
    const source = lines
      .map((line) => {
        try {
          return JSON.parse(line) as DockerRow
        } catch {
          return {}
        }
      })
      .find((row) => row.Names === `${name}-app`)
    const image =
      typeof source?.Image === 'string'
        ? new RegExp(`^${name}:v([1-9][0-9]*)$`).exec(source.Image)
        : null
    if (image && Number.isSafeInteger(Number(image[1]))) {
      const ports = parsePorts(typeof source?.Ports === 'string' ? source.Ports : '')
      candidates.set(name, {
        name,
        image_tag: source!.Image as string,
        version: Number(image[1]),
        host_port: ports.host,
        container_port: ports.container,
        state: typeof source?.State === 'string' ? source.State : 'unknown',
        ambiguous: true
      })
    }
  }
  return [...candidates.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function metadata(
  manifest: AppManifest | null
): Pick<
  DiscoveredVpsApp,
  'framework' | 'source_type' | 'git_remote' | 'git_ref' | 'git_root' | 'healthcheck' | 'needs_db'
> {
  const git = manifest?.source.type === 'git' ? manifest.source : null
  return {
    framework: manifest?.framework ?? null,
    source_type: manifest?.source.type ?? null,
    git_remote: git?.remote ?? null,
    git_ref: git?.ref ?? null,
    git_root: git?.root ?? null,
    healthcheck: manifest?.healthcheck ?? null,
    needs_db: manifest?.needs_db ?? null
  }
}

function candidateStatus(
  candidate: DockerCandidate,
  manifest: AppManifest | null,
  manifestState: 'verified' | 'missing' | 'invalid' | 'unreadable'
): DiscoveredVpsApp {
  let status: DiscoveredVpsApp['recovery_status']
  let reason: DiscoveredVpsApp['recovery_reason']
  if (candidate.ambiguous) {
    status = 'ambiguous'
    reason = 'duplicate_runtime'
  } else if (manifestState === 'missing') {
    status = 'legacy'
    reason = 'manifest_missing'
  } else if (manifestState === 'unreadable') {
    status = 'unverifiable'
    reason = 'manifest_unreadable'
  } else if (manifestState === 'invalid' || !manifest) {
    status = 'invalid'
    reason = 'manifest_invalid'
  } else if (candidate.state !== 'running') {
    status = 'stopped'
    reason = 'container_not_running'
  } else if (candidate.host_port === null || candidate.container_port === null) {
    status = 'unverifiable'
    reason = 'runtime_port_unverifiable'
  } else if (
    manifest.app.name !== candidate.name ||
    candidate.image_tag !== `${manifest.app.name}:v${candidate.version}` ||
    manifest.ports.host !== candidate.host_port ||
    manifest.ports.container !== candidate.container_port
  ) {
    status = 'mismatch'
    reason = 'runtime_mismatch'
  } else {
    status = 'verified'
    reason = null
  }
  return {
    name: candidate.name,
    image_tag: candidate.image_tag,
    version: candidate.version,
    host_port: candidate.host_port,
    container_port: candidate.container_port,
    state: candidate.state,
    recovery_status: status,
    recovery_reason: reason,
    ...metadata(status === 'verified' ? manifest : null)
  }
}

async function readManifest(
  ssh: Pick<SshManager, 'exec'>,
  vpsId: number,
  name: string
): Promise<{
  manifest: AppManifest | null
  state: 'verified' | 'missing' | 'invalid' | 'unreadable'
}> {
  // name came from the strict Docker slug expression; renderer never supplies this path.
  const path = `/opt/opspilot/${name}/.opspilot-app.json`
  const command = `if [ ! -e '${path}' ]; then exit 5; elif [ ! -r '${path}' ]; then exit 6; else head -c ${MAX_MANIFEST_BYTES + 1} '${path}'; fi 2>/dev/null`
  let result
  try {
    result = await ssh.exec(vpsId, command, {
      timeoutMs: 5_000,
      logCommand: false,
      retryOnReconnect: false
    })
  } catch {
    return { manifest: null, state: 'unreadable' }
  }
  if (result.code === 5) return { manifest: null, state: 'missing' }
  if (result.code !== 0) return { manifest: null, state: 'unreadable' }
  const parsed = parseAppManifest(result.stdout)
  return parsed ? { manifest: parsed, state: 'verified' } : { manifest: null, state: 'invalid' }
}

export function parseDiscoveredApps(output: string): DiscoveredVpsApp[] {
  return parseDockerCandidates(output).map((candidate) =>
    candidateStatus(candidate, null, 'missing')
  )
}

export async function discoverVpsApps(
  ssh: Pick<SshManager, 'exec'>,
  vpsId: number
): Promise<DiscoveredVpsApp[]> {
  if (!Number.isSafeInteger(vpsId) || vpsId <= 0)
    throw new AppError('VALIDATION', 'VPS không hợp lệ. Hãy tải lại danh sách.')
  let result
  try {
    result = await ssh.exec(vpsId, COMMAND, {
      timeoutMs: 10_000,
      logCommand: false,
      retryOnReconnect: false
    })
  } catch {
    throw new AppError('UNKNOWN', 'Không thể đọc danh sách container Docker trên VPS.')
  }
  if (result.code !== 0)
    throw new AppError('UNKNOWN', 'Không thể đọc danh sách container Docker trên VPS.')
  const candidates = parseDockerCandidates(result.stdout)
  const apps: DiscoveredVpsApp[] = new Array(candidates.length)
  let next = 0
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_MANIFEST_READS, candidates.length) },
    async () => {
      while (next < candidates.length) {
        const index = next++
        const candidate = candidates[index]
        if (candidate.ambiguous) {
          apps[index] = candidateStatus(candidate, null, 'unreadable')
          continue
        }
        const { manifest, state } = await readManifest(ssh, vpsId, candidate.name)
        apps[index] = candidateStatus(candidate, manifest, state)
      }
    }
  )
  await Promise.all(workers)
  return apps
}
