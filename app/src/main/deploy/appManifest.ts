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
