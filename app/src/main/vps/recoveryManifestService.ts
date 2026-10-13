import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

import type { App } from '@shared/ipc'

import { AppError } from '../errors'
import { createAppManifest, parseAppManifest } from '../deploy/appManifest'
import { shellQuote } from '../ssh/shellQuote'
import type { SshManager } from '../ssh/manager'
import { discoverVpsApps } from './discovery'

type SourceRecord = App & {
  image_tag: string
  version: number
  status: string
  origin: string
  fingerprint: string | null
}

export class RecoveryManifestService {
  constructor(
    private readonly database: Database.Database,
    private readonly ssh: Pick<SshManager, 'exec' | 'writeFile' | 'disconnect'>,
    private readonly discover: typeof discoverVpsApps = discoverVpsApps
  ) {}

  async write(vpsId: number, name: string): Promise<{ created: boolean }> {
    if (!Number.isSafeInteger(vpsId) || vpsId <= 0 || !/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) {
      throw new AppError('VALIDATION', 'Há»“ sÆ¡ app VPS khÃ´ng há»£p lá»‡.')
    }
    const record = this.database
      .prepare(
        `
      SELECT ${appColumns}, d.image_tag, d.version, d.status, d.origin, v.host_fingerprint AS fingerprint
      FROM app a JOIN vps v ON v.id=a.vps_id
      JOIN deployment d ON d.id=a.current_deployment_id AND d.app_id=a.id
      WHERE a.vps_id=? AND a.name=? AND v.archived_at IS NULL
    `
      )
      .get(vpsId, name) as SourceRecord | undefined
    if (!record)
      throw new AppError('VALIDATION', 'Thiếu hồ sơ app hoặc deployment hiện hành trong OpsPilot.')
    if (record.imported_from_vps === 1 || record.origin !== 'opspilot') {
      throw new AppError('VALIDATION', 'Không thể tạo manifest recovery cho app đã nhập từ VPS.')
    }
    if (!record.fingerprint)
      throw new AppError('VALIDATION', 'VPS chưa có fingerprint SSH đã ghim.')
    if (record.status !== 'running')
      throw new AppError(
        'VALIDATION',
        'Deployment hiện hành trong OpsPilot không ở trạng thái running.'
      )

    let content: string
    try {
      content = `${JSON.stringify(createAppManifest(record), null, 2)}\n`
    } catch {
      throw new AppError('VALIDATION', 'Git locator trong hồ sơ OpsPilot không an toàn.')
    }
    // Force a fresh handshake so the connection is checked against the fingerprint currently saved in this DB.
    await this.ssh.disconnect(vpsId)
    const candidates = await this.discover(this.ssh as SshManager, vpsId)
    const runtime = candidates.find((candidate) => candidate.name === name)
    if (
      !runtime ||
      runtime.state !== 'running' ||
      runtime.recovery_status !== 'legacy' ||
      runtime.recovery_reason !== 'manifest_missing' ||
      runtime.image_tag !== record.image_tag ||
      runtime.version !== record.version ||
      runtime.host_port !== record.host_port ||
      runtime.container_port !== record.container_port
    ) {
      throw new AppError(
        'VALIDATION',
        'Docker runtime không khớp hồ sơ deployment hiện hành; không ghi manifest.'
      )
    }

    const path = `/opt/opspilot/${name}/.opspilot-app.json`
    const check = await this.ssh.exec(
      vpsId,
      `if [ -e ${shellQuote(path)} ]; then head -c 16385 ${shellQuote(path)}; exit 0; else exit 5; fi`,
      {
        timeoutMs: 5_000,
        logCommand: false,
        retryOnReconnect: false
      }
    )
    if (check.code === 0) {
      const existing = parseAppManifest(check.stdout)
      if (existing && JSON.stringify(existing) === JSON.stringify(JSON.parse(content)))
        return { created: false }
      throw new AppError(
        'VALIDATION',
        'Manifest đã tồn tại với nội dung khác hoặc không hợp lệ; không ghi đè.'
      )
    }
    if (check.code !== 5)
      throw new AppError('UNKNOWN', 'Không xác minh được trạng thái manifest hiện có.')

    const temp = `${path}.${randomUUID()}.tmp`
    let linked = false
    try {
      await this.ssh.writeFile(vpsId, temp, content, { mode: 0o600, silent: true })
      // POSIX link is atomic and fails if destination already exists; unlike mv it cannot replace it.
      const result = await this.ssh.exec(
        vpsId,
        `ln -- ${shellQuote(temp)} ${shellQuote(path)} && rm -- ${shellQuote(temp)}`,
        {
          timeoutMs: 5_000,
          logCommand: false,
          retryOnReconnect: false
        }
      )
      if (result.code !== 0) throw new Error('Atomic no-clobber link failed')
      linked = true
      return { created: true }
    } finally {
      if (!linked) {
        try {
          await this.ssh.exec(vpsId, `rm -f -- ${shellQuote(temp)}`, {
            retryOnReconnect: false,
            logCommand: false
          })
        } catch {
          /* cleanup best effort */
        }
      }
    }
  }
}

const appColumns = `a.id, a.vps_id, a.name, a.framework, a.source_path, a.source_type,
 a.git_repo_url, a.git_ref, a.git_root, a.host_port, a.container_port, a.healthcheck_path,
 a.needs_db, a.current_deployment_id, a.imported_from_vps, '' AS url`
