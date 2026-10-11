import { randomUUID } from 'node:crypto'

import type { App } from '@shared/ipc'

import { canonicalizeGitHubUrl } from '../git/snapshot'
import { shellQuote } from '../ssh/shellQuote'
import type { SshManager } from '../ssh/manager'

export interface AppManifest {
  schema_version: 1
  app: { name: string }
  framework: App['framework']
  source:
    | { type: 'local'; locator_available: false }
    | { type: 'git'; locator_available: true; remote: string; ref: string; root: string }
  ports: { host: number; container: number }
  healthcheck: string
  needs_db: boolean
}

function safeGitRemote(remote: string | null | undefined): string | null {
  if (!remote || remote.length > 2048 || containsControl(remote)) return null
  try {
    return canonicalizeGitHubUrl(remote)
  } catch {
    return null
  }
}

function safeGitRef(ref: string | null | undefined): string | null {
  if (
    !ref ||
    ref.length > 512 ||
    ref.startsWith('-') ||
    ref.startsWith('/') ||
    ref.endsWith('/') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)
  )
    return null
  return ref
}

function safeGitRoot(root: string | null | undefined): string | null {
  if (
    !root ||
    root.length > 1024 ||
    root.startsWith('/') ||
    root.includes('\\') ||
    root.split('/').some((part) => part === '..') ||
    containsControl(root)
  )
    return null
  return root
}

function containsControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
}

export function createAppManifest(app: App): AppManifest {
  let source: AppManifest['source'] = { type: 'local', locator_available: false }
  if (app.source_type === 'git') {
    const remote = safeGitRemote(app.git_repo_url)
    const ref = safeGitRef(app.git_ref)
    const root = safeGitRoot(app.git_root)
    if (!remote || !ref || !root) throw new Error('Unsafe Git locator')
    source = { type: 'git', locator_available: true, remote, ref, root }
  }
  return {
    schema_version: 1,
    app: { name: app.name },
    framework: app.framework,
    source,
    ports: { host: app.host_port, container: app.container_port },
    healthcheck: app.healthcheck_path,
    needs_db: app.needs_db === 1
  }
}

export async function writeAppManifest(ssh: SshManager, vpsId: number, app: App): Promise<void> {
  const manifestPath = `/opt/opspilot/${app.name}/.opspilot-app.json`
  const tempPath = `${manifestPath}.${randomUUID()}.tmp`
  const content = `${JSON.stringify(createAppManifest(app), null, 2)}\n`
  let renamed = false
  try {
    await ssh.writeFile(vpsId, tempPath, content, { mode: 0o600, silent: true })
    const result = await ssh.exec(
      vpsId,
      `mv -f -- ${shellQuote(tempPath)} ${shellQuote(manifestPath)}`,
      { retryOnReconnect: false }
    )
    if (result.code !== 0) throw new Error('Manifest rename failed')
    renamed = true
  } finally {
    if (!renamed) {
      try {
        await ssh.exec(vpsId, `rm -f -- ${shellQuote(tempPath)}`, { retryOnReconnect: false })
      } catch {
        // Preserve the original write/rename failure; cleanup is best effort.
      }
    }
  }
}

const FRAMEWORKS = new Set(['nextjs', 'express', 'static-spa', 'flask'])
const MAX_MANIFEST_BYTES = 16_384

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value)
}

function validPort(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 65_535
}

/** Parse only the documented v1 allowlist; callers must discard the input string. */
export function parseAppManifest(input: string): AppManifest | null {
  if (Buffer.byteLength(input, 'utf8') > MAX_MANIFEST_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schema_version',
      'app',
      'framework',
      'source',
      'ports',
      'healthcheck',
      'needs_db'
    ]) ||
    value.schema_version !== 1 ||
    !isRecord(value.app) ||
    !hasExactKeys(value.app, ['name']) ||
    typeof value.app.name !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,30}$/.test(value.app.name) ||
    typeof value.framework !== 'string' ||
    !FRAMEWORKS.has(value.framework) ||
    !isRecord(value.ports) ||
    !hasExactKeys(value.ports, ['host', 'container']) ||
    !validPort(value.ports.host) ||
    !validPort(value.ports.container) ||
    typeof value.healthcheck !== 'string' ||
    value.healthcheck.length > 256 ||
    !/^\/[A-Za-z0-9/._~-]*$/.test(value.healthcheck) ||
    typeof value.needs_db !== 'boolean' ||
    !isRecord(value.source)
  )
    return null

  let source: AppManifest['source']
  if (
    hasExactKeys(value.source, ['type', 'locator_available']) &&
    value.source.type === 'local' &&
    value.source.locator_available === false
  ) {
    source = { type: 'local', locator_available: false }
  } else if (
    hasExactKeys(value.source, ['type', 'locator_available', 'remote', 'ref', 'root']) &&
    value.source.type === 'git' &&
    value.source.locator_available === true &&
    typeof value.source.remote === 'string' &&
    typeof value.source.ref === 'string' &&
    typeof value.source.root === 'string'
  ) {
    const remote = safeGitRemote(value.source.remote)
    const ref = safeGitRef(value.source.ref)
    const root = safeGitRoot(value.source.root)
    if (!remote || !ref || !root || remote !== value.source.remote) return null
    source = { type: 'git', locator_available: true, remote, ref, root }
  } else {
    return null
  }

  return {
    schema_version: 1,
    app: { name: value.app.name },
    framework: value.framework as AppManifest['framework'],
    source,
    ports: { host: value.ports.host, container: value.ports.container },
    healthcheck: value.healthcheck,
    needs_db: value.needs_db
  }
}
