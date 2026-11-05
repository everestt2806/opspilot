import type Database from 'better-sqlite3'

import type { DiscoveredVpsApp, VpsAppImportSnapshot } from '@shared/ipc'

import { AppRepository } from '../db/appRepository'
import { VpsRepository } from '../db/vpsRepository'
import { AppError } from '../errors'
import type { SshManager } from '../ssh/manager'
import { discoverVpsApps } from './discovery'

const SNAPSHOT_FIELDS = [
  'recovery_status',
  'image_tag',
  'version',
  'host_port',
  'container_port',
  'state',
  'framework',
  'source_type',
  'git_remote',
  'git_ref',
  'git_root',
  'healthcheck',
  'needs_db'
] as const satisfies readonly (keyof VpsAppImportSnapshot)[]

export class VpsAppImportService {
  private readonly apps: AppRepository
  private readonly vps: VpsRepository

  constructor(
    db: Database.Database,
    private readonly ssh: Pick<SshManager, 'exec'>,
    private readonly discover: typeof discoverVpsApps = discoverVpsApps
  ) {
    this.apps = new AppRepository(db)
    this.vps = new VpsRepository(db)
  }

  async importApp(
    vpsId: number,
    name: string,
    snapshot: VpsAppImportSnapshot
  ): Promise<{ app_id: number; deployment_id: number }> {
    if (!Number.isSafeInteger(vpsId) || vpsId <= 0 || !/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) {
      throw new AppError('VALIDATION', 'Ứng dụng VPS cần được quét lại trước khi nhập.')
    }
    if (!snapshot || snapshot.recovery_status !== 'verified') {
      throw new AppError('VALIDATION', 'Chỉ có thể nhập ứng dụng đã xác minh từ VPS.')
    }

    const trustedVps = this.vps.getById(vpsId)
    if (!trustedVps.host_fingerprint) {
      throw new AppError('VALIDATION', 'VPS chưa có fingerprint SSH đã xác minh.')
    }

    const current = (await this.discover(this.ssh as SshManager, vpsId)).find(
      (candidate) => candidate.name === name
    )
    if (!current || current.recovery_status !== 'verified' || !sameSnapshot(current, snapshot)) {
      throw new AppError(
        'VALIDATION',
        'Runtime hoặc manifest đã thay đổi. Hãy quét lại VPS trước khi nhập ứng dụng.'
      )
    }

    const trustedNow = this.vps.getById(vpsId)
    if (
      trustedNow.host !== trustedVps.host ||
      trustedNow.port !== trustedVps.port ||
      trustedNow.host_fingerprint !== trustedVps.host_fingerprint
    ) {
      throw new AppError('VALIDATION', 'Danh tính VPS đã thay đổi. Hãy xác minh kết nối rồi thử lại.')
    }
    if (this.apps.getByVpsAndName(vpsId, name)) {
      throw new AppError('VALIDATION', 'Ứng dụng này đã được nhập vào OpsPilot.')
    }
    if (this.apps.usedPorts(vpsId).includes(current.host_port!)) {
      throw new AppError('PORT_EXHAUSTED', 'Cổng của ứng dụng đã được gán cho app khác trên VPS.')
    }

    const imported = this.apps.createVpsImportedBaseline(
      {
        vps_id: vpsId,
        name,
        framework: current.framework!,
        source_type: current.source_type!,
        source_path: null,
        git_repo_url: current.source_type === 'git' ? current.git_remote : null,
        git_ref: current.source_type === 'git' ? current.git_ref : null,
        git_root: current.source_type === 'git' ? current.git_root : null,
        host_port: current.host_port!,
        container_port: current.container_port!,
        healthcheck_path: current.healthcheck!,
        needs_db: current.needs_db ? 1 : 0
      },
      { version: current.version, image_tag: current.image_tag }
    )
    return { app_id: imported.app.id, deployment_id: imported.deploymentId }
  }
}

function sameSnapshot(
  current: DiscoveredVpsApp,
  snapshot: VpsAppImportSnapshot
): boolean {
  return SNAPSHOT_FIELDS.every((field) => current[field] === snapshot[field])
}
