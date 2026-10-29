import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import Database from 'better-sqlite3'

import type { SshManager } from '../ssh/manager'
import { AppError } from '../errors'
import { AppRepository } from '../db/appRepository'
import { VpsRepository } from '../db/vpsRepository'
import { DeploymentRepository } from '../db/deploymentRepository'
import { MonitorRepository } from '../monitor/repository'
import { initializeDatabase } from '../db'
import { discoverVpsApps } from './discovery'
import { VpsAppImportService } from './importService'
import { RecoveryManifestService } from './recoveryManifestService'

export async function runRecoveryManifestCli(
  sourceDb: Database.Database,
  ssh: Pick<SshManager, 'exec' | 'writeFile'>,
  input: { vpsId: number; name: string; targetProfile: string }
): Promise<Record<string, unknown>> {
  const targetPath = resolve(input.targetProfile)
  const tempRoot = `${realpathSync(tmpdir())}${sep}`
  const targetRealPath = realpathSync(targetPath)
  const targetDbPath = resolve(targetPath, 'opspilot.db')
  const targetRealDbPath = realpathSync(targetDbPath)
  if (
    !targetRealPath.startsWith(tempRoot) ||
    targetRealDbPath === realpathSync(sourceDb.name) ||
    !existsSync(targetDbPath)
  ) {
    throw new AppError(
      'VALIDATION',
      'Hồ sơ đích phải là DB SQLite cô lập có sẵn trong thư mục tạm.'
    )
  }
  const sourceVps = new VpsRepository(sourceDb).getById(input.vpsId)
  if (!sourceVps.host_fingerprint)
    throw new AppError('VALIDATION', 'Profile không có SSH fingerprint đã ghim.')

  const targetReadOnly = new Database(targetDbPath, { readonly: true, fileMustExist: true })
  let targetVpsId: number | undefined
  try {
    targetReadOnly.pragma('query_only = ON')
    targetVpsId = (
      targetReadOnly
        .prepare(
          'SELECT id FROM vps WHERE host=? AND port=? AND host_fingerprint=? AND archived_at IS NULL'
        )
        .get(sourceVps.host, sourceVps.port, sourceVps.host_fingerprint) as
        { id: number } | undefined
    )?.id
    if (!targetVpsId) {
      throw new AppError('VALIDATION', 'DB đích thiếu VPS cùng endpoint và fingerprint đã ghim.')
    }
    if (targetVpsId !== input.vpsId) {
      throw new AppError(
        'VALIDATION',
        'ID VPS trong DB nguồn và DB đích khác nhau; từ chối trước khi kết nối SSH.'
      )
    }
    const occupied = targetReadOnly
      .prepare('SELECT 1 FROM app WHERE vps_id=? AND (name=? OR host_port=?)')
      .get(targetVpsId, input.name, firstCandidateHostPort(sourceDb, input.vpsId, input.name))
    if (occupied) {
      throw new AppError('VALIDATION', 'DB đích đã có app hoặc cổng trùng; chưa ghi manifest.')
    }
  } finally {
    targetReadOnly.close()
  }

  const firstScan = await discoverVpsApps(ssh as SshManager, input.vpsId)
  const candidate = firstScan.find((app) => app.name === input.name)
  if (!candidate) throw new AppError('VALIDATION', 'Không tìm thấy ứng dụng trong Docker scan mới.')
  const write = await new RecoveryManifestService(sourceDb, ssh).write(input.vpsId, input.name)
  const verifiedScan = await discoverVpsApps(ssh as SshManager, input.vpsId)
  const verified = verifiedScan.find((app) => app.name === input.name)
  if (!verified || verified.recovery_status !== 'verified') {
    throw new AppError('VALIDATION', 'Quét lại sau thao tác không xác nhận được manifest verified.')
  }

  const targetDb = initializeDatabase(targetPath)
  try {
    const targetVps = new VpsRepository(targetDb)
      .list()
      .find(
        (vps) =>
          vps.host === sourceVps.host &&
          vps.port === sourceVps.port &&
          vps.host_fingerprint === sourceVps.host_fingerprint
      )
    if (!targetVps || targetVps.id !== targetVpsId)
      throw new AppError('VALIDATION', 'DB đích đã thay đổi sau bước kiểm tra.')
    const imported = await new VpsAppImportService(targetDb, ssh as SshManager).importApp(
      targetVps.id,
      input.name,
      verified
    )
    const app = new AppRepository(targetDb).getById(imported.app_id)
    const deployment = new DeploymentRepository(targetDb).getById(imported.deployment_id)
    const monitorTargets = new MonitorRepository(targetDb).listTargets()
    return {
      scan_status: candidate.recovery_status,
      write_created: write.created,
      rescan_status: verified.recovery_status,
      imported: true,
      baseline: {
        version: deployment.version,
        image_tag: deployment.image_tag,
        origin: deployment.origin
      },
      imported_flag: app.imported_from_vps,
      monitor_target_excluded: !monitorTargets.some((target) => target.app_id === app.id)
    }
  } finally {
    targetDb.close()
  }
}

function firstCandidateHostPort(db: Database.Database, vpsId: number, name: string): number {
  const row = db.prepare('SELECT host_port FROM app WHERE vps_id=? AND name=?').get(vpsId, name) as
    { host_port: number } | undefined
  if (!row) throw new AppError('VALIDATION', 'Thiếu hồ sơ app trong DB nguồn.')
  return row.host_port
}
