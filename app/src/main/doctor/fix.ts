import type Database from 'better-sqlite3'

import type { App, Vps } from '@shared/ipc'

import { DeploymentRepository } from '../db/deploymentRepository'
import { SshExposureManager, type ExposureManager } from '../deploy/exposure'
import { probeExternalReachable } from '../deploy/reachability'
import { maskSecrets } from '../logger'
import type { SshManager } from '../ssh/manager'
import { shellQuote } from '../ssh/shellQuote'
import { DoctorRepository } from './repository'
import { redactText } from './engine'

export interface DoctorFixResult {
  status: 'fixed' | 'verified' | 'failed' | 'manual'
  message: string
  exposure_status?: 'reachable' | 'degraded' | 'tunnel_only' | 'not_checked'
  evidence?: unknown
}

export interface DoctorFixOptions {
  checkInternalHealth?: (app: App, vps: Vps) => Promise<boolean>
  checkExternalProbe?: (url: string) => Promise<'reachable' | 'unreachable'>
}

const MAX_EVIDENCE_AGE_MS = 15 * 60 * 1000 // 15 phút

/** Safe-fix allowlist dùng chung cho UI và pipeline; không sửa source hoặc xóa volume. */
export class DoctorFixService {
  private readonly deployments: DeploymentRepository
  private readonly doctor: DoctorRepository
  private readonly exposureManager?: ExposureManager
  private readonly options?: DoctorFixOptions

  constructor(
    private readonly ssh: SshManager,
    database: Database.Database,
    exposureManager?: ExposureManager,
    options?: DoctorFixOptions
  ) {
    this.deployments = new DeploymentRepository(database)
    this.doctor = new DoctorRepository(database)
    this.exposureManager = exposureManager
    this.options = options
  }

  async execute(input: {
    fixId: string
    deploymentId: number
    app: App
    vps: Vps
  }): Promise<DoctorFixResult> {
    if (input.fixId !== 'reconcile_firewall') {
      return {
        status: 'manual',
        message: 'Thao tác này cần user kiểm tra cấu hình hoặc source; Doctor không tự sửa.'
      }
    }

    const run = this.doctor.latestForDeployment(input.deploymentId)
    if (!run || run.outcome !== 'pending') {
      return {
        status: 'failed',
        message: 'Không tìm thấy Doctor run đang chờ xử lý (pending) cho deployment này.'
      }
    }

    if (
      run.diagnosis_code !== 'PORT_BLOCKED_EXTERNAL' ||
      run.selected_fix !== 'reconcile_firewall'
    ) {
      return {
        status: 'failed',
        message: `Doctor run không khớp điều kiện sửa: diagnosis_code=${run.diagnosis_code}, selected_fix=${run.selected_fix ?? 'null'}.`
      }
    }

    // Gate: kiểm tra bằng chứng cũ (stale evidence)
    const startedAtTime = new Date(run.started_at).getTime()
    if (!isNaN(startedAtTime) && Date.now() - startedAtTime > MAX_EVIDENCE_AGE_MS) {
      return {
        status: 'failed',
        message:
          'Bằng chứng trong Doctor run đã quá hạn (cũ); hãy chạy lại chẩn đoán trước khi sửa.'
      }
    }

    // Gate: kiểm tra bằng chứng tự khai / không có probe thực tế
    let evidenceMatches = false
    try {
      const parsed = JSON.parse(run.evidence_json) as Record<string, unknown>
      const probe = parsed.externalProbe ?? parsed.external_probe
      const probeUnreachable = probe === 'unreachable'
      const containerState = (parsed.containerState ?? parsed.container_state) as
        { status?: string } | undefined
      const isRunning = containerState?.status === 'running'
      const isUfwActive = parsed.ufwState === 'active' || parsed.ufw_state === 'active'
      const isSelfReported = Boolean(parsed.selfReported || parsed.self_reported)

      evidenceMatches = Boolean(probeUnreachable && (isRunning || isUfwActive) && !isSelfReported)
    } catch {
      evidenceMatches = false
    }

    if (!evidenceMatches) {
      return {
        status: 'failed',
        message:
          'Bằng chứng trong Doctor run không phù hợp hoặc là thông tin tự khai chưa qua kiểm chứng.'
      }
    }

    const deployment = this.deployments.getById(input.deploymentId)
    if (deployment.app_id !== input.app.id || input.app.vps_id !== input.vps.id) {
      const actionId = this.doctor.createAction({
        doctorRunId: run.id,
        actionType: 'reconcile_firewall',
        preconditionJson: JSON.stringify({
          passed: false,
          error: 'DEPLOYMENT_APP_VPS_MISMATCH',
          deployment_id: input.deploymentId,
          deployment_app_id: deployment.app_id,
          app_id: input.app.id,
          app_vps_id: input.app.vps_id,
          vps_id: input.vps.id
        }),
        status: 'failed'
      })
      this.doctor.updateAction(actionId, { finishedAt: new Date().toISOString() })
      this.doctor.finish(run.id, 'failed')
      return {
        status: 'failed',
        message: 'Thông tin deployment, app và VPS không khớp nhau.'
      }
    }

    // Kiểm tra điều kiện tiên quyết: deployment phải running và host_port hợp lệ
    const preconditionPassed =
      deployment.status === 'running' &&
      typeof input.app.host_port === 'number' &&
      input.app.host_port > 0 &&
      input.app.host_port <= 65535

    const preconditionJson = JSON.stringify({
      passed: preconditionPassed,
      deployment_id: input.deploymentId,
      deployment_status: deployment.status,
      host_port: input.app.host_port,
      vps_id: input.vps.id
    })

    if (!preconditionPassed) {
      const actionId = this.doctor.createAction({
        doctorRunId: run.id,
        actionType: 'reconcile_firewall',
        preconditionJson,
        status: 'failed'
      })
      this.doctor.updateAction(actionId, {
        finishedAt: new Date().toISOString()
      })
      this.doctor.finish(run.id, 'failed')
      return {
        status: 'failed',
        message: 'Điều kiện tiên quyết không đạt: Deployment chưa running hoặc cổng không hợp lệ.'
      }
    }

    const actionId = this.doctor.createAction({
      doctorRunId: run.id,
      actionType: 'reconcile_firewall',
      preconditionJson,
      status: 'running'
    })

    // Preflight check theo hướng fail closed:
    // Kiểm tra lại từ main process: app còn healthy nội bộ và external probe hiện vẫn unreachable
    const checkInternal =
      this.options?.checkInternalHealth ??
      (async (app: App, vps: Vps) => {
        if (typeof this.ssh?.exec !== 'function') {
          throw new Error('Thiếu SSH capability để kiểm tra runtime ứng dụng trên VPS.')
        }
        const url = `http://127.0.0.1:${app.host_port}${app.healthcheck_path || '/'}`
        const result = await this.ssh.exec(
          vps.id,
          `curl -fsS -m 5 -o /dev/null ${shellQuote(url)}`,
          { timeoutMs: 10_000 }
        )
        return result.code === 0
      })

    const checkExternal =
      this.options?.checkExternalProbe ?? (async (url: string) => probeExternalReachable(url, 1))

    try {
      if (typeof this.ssh?.exec !== 'function' && !this.options?.checkInternalHealth) {
        throw new Error('Thiếu SSH capability để kiểm tra runtime ứng dụng trên VPS.')
      }

      const isInternallyHealthy = await checkInternal(input.app, input.vps)
      if (!isInternallyHealthy) {
        this.doctor.updateAction(actionId, {
          status: 'failed',
          resultJson: JSON.stringify({
            error: 'App không còn healthy nội bộ trước khi mở firewall.'
          }),
          finishedAt: new Date().toISOString()
        })
        this.doctor.finish(run.id, 'failed')
        return {
          status: 'failed',
          message: 'App không còn healthy nội bộ; hủy thao tác mở firewall.'
        }
      }

      const appUrl = input.app.url || `http://${input.vps.host}:${input.app.host_port}`
      const currentExternalProbe = await checkExternal(appUrl)
      if (currentExternalProbe === 'reachable') {
        // Trạng thái đã đổi: app đã reachable từ ngoài -> ghi verify_json, xóa exposure_evidence_json cũ (null) và không mở lại firewall
        const verifyJson = JSON.stringify({
          verified: true,
          reason: 'already_reachable',
          external_probe: 'reachable',
          app_url: appUrl,
          checked_at: new Date().toISOString()
        })
        this.doctor.updateAction(actionId, {
          status: 'skipped',
          resultJson: JSON.stringify({
            message: 'External probe đã reachable trước khi sửa; không cần thao tác firewall.'
          }),
          verifyJson,
          finishedAt: new Date().toISOString()
        })
        this.doctor.finish(run.id, 'verified')

        // Xóa exposure_evidence_json cũ (null) và giữ bằng chứng probe mới trong doctor_action.verify_json
        this.deployments.update(input.deploymentId, {
          exposure_status: 'reachable',
          exposure_evidence_json: null
        })

        return {
          status: 'verified',
          message: 'App đã có thể truy cập được từ bên ngoài; không cần mở lại firewall.',
          exposure_status: 'reachable',
          evidence: null
        }
      }
    } catch (preflightError) {
      const rawError =
        preflightError instanceof Error ? preflightError.message : String(preflightError)
      const safeError = redactText(maskSecrets(rawError))
      this.doctor.updateAction(actionId, {
        status: 'failed',
        resultJson: JSON.stringify({ error: safeError }),
        finishedAt: new Date().toISOString()
      })
      this.doctor.finish(run.id, 'failed')
      return {
        status: 'failed',
        message: `Kiểm tra trước khi sửa thất bại: ${safeError}`
      }
    }

    try {
      const exposure = this.exposureManager ?? new SshExposureManager(this.ssh)
      const evidence = await exposure.reconcile({
        app: input.app,
        vps: input.vps
      })

      const verified = evidence.status === 'reachable'
      const verifyJson = JSON.stringify({
        verified,
        exposure_status: evidence.status,
        external_probe: evidence.external_probe,
        ufw_state: evidence.ufw_state,
        cloud_firewall: evidence.cloud_firewall
      })

      this.deployments.update(input.deploymentId, {
        exposure_status: evidence.status,
        exposure_evidence_json: JSON.stringify(evidence)
      })

      this.doctor.updateAction(actionId, {
        status: verified ? 'success' : 'failed',
        resultJson: JSON.stringify(evidence),
        verifyJson,
        finishedAt: new Date().toISOString()
      })
      this.doctor.finish(run.id, verified ? 'verified' : 'failed')

      return {
        status: verified ? 'verified' : 'failed',
        message: verified
          ? 'Đã reconcile firewall và external probe đã truy cập được app.'
          : 'Đã thử reconcile nhưng app vẫn chưa reachable từ ngoài.',
        exposure_status: evidence.status,
        evidence
      }
    } catch (error) {
      const rawError = error instanceof Error ? error.message : String(error)
      const safeError = redactText(maskSecrets(rawError))
      this.doctor.updateAction(actionId, {
        status: 'failed',
        resultJson: JSON.stringify({ error: safeError }),
        finishedAt: new Date().toISOString()
      })
      this.doctor.finish(run.id, 'failed')
      return {
        status: 'failed',
        message: `Không thể tự sửa publish: ${safeError}`
      }
    }
  }
}
