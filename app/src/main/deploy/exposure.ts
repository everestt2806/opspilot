import type { App, Vps, VpsDiagnosis } from '@shared/ipc'

import type { SshManager } from '../ssh/manager'
import type { CloudFirewallProvider } from './firewall'
import {
  assessReachability,
  decideUfw,
  parseUfwState,
  probeExternalReachable,
  type ExternalProbeOutcome,
  type UfwState
} from './reachability'

export type ExposureStatus = 'reachable' | 'degraded' | 'tunnel_only' | 'not_checked'

export interface ExposureEvidence {
  status: ExposureStatus
  url: string
  external_probe: ExternalProbeOutcome | 'not_run'
  ufw_state: UfwState | 'not_checked'
  ufw_reconciled: boolean
  cloud_firewall: 'not_configured' | 'reconciled' | 'failed'
  diagnosis: VpsDiagnosis | null
  checked_at: string
}

export interface ExposureRequest {
  vps: Vps
  app: App
  signal?: AbortSignal
}

export interface ExposureResult extends ExposureEvidence {}

export interface ExposureManager {
  reconcile(request: ExposureRequest): Promise<ExposureResult>
}

export interface ExposureManagerOptions {
  probe?: (url: string) => Promise<boolean>
  probeAttempts?: number
  /** Cho phép tắt external probe trong test/unit environment, không dùng trong production. */
  skipExternalProbe?: boolean
  cloudFirewall?: CloudFirewallProvider
}

/**
 * Reconcile publish state sau khi container đã healthy nội bộ.
 *
 * V1 tự động được firewall OS qua UFW và nhận cloud-firewall adapter đã được cấp quyền. DNS/
 * ingress vẫn là desired-state riêng; không được đánh dấu reachable nếu external probe chưa pass.
 */
export class SshExposureManager implements ExposureManager {
  constructor(
    private readonly ssh: SshManager,
    private readonly options: ExposureManagerOptions = {}
  ) {}

  async reconcile(request: ExposureRequest): Promise<ExposureResult> {
    const { vps, app, signal } = request
    let ufwState: UfwState = 'unknown'
    let ufwReconciled = false
    let cloudFirewall: ExposureEvidence['cloud_firewall'] = this.options.cloudFirewall
      ? 'failed'
      : 'not_configured'

    try {
      const status = await this.ssh.exec(vps.id, 'sudo -n ufw status 2>&1', {
        timeoutMs: 15_000,
        signal,
        retryOnReconnect: true
      })
      ufwState = parseUfwState(`${status.stdout}\n${status.stderr}`)
      const decision = decideUfw(ufwState, app.host_port)
      if (decision.shouldAllow && decision.command) {
        const result = await this.ssh.exec(vps.id, `sudo -n ${decision.command}`, {
          timeoutMs: 15_000,
          signal,
          retryOnReconnect: false
        })
        ufwReconciled = result.code === 0
      }
    } catch {
      // UFW không cài hoặc thiếu sudo không được làm mất deploy healthy. External probe sẽ
      // quyết định exposure cuối cùng và diagnosis sẽ hướng dẫn thao tác còn thiếu.
      ufwState = 'unknown'
    }

    if (this.options.cloudFirewall) {
      try {
        const result = await this.options.cloudFirewall.ensureIngress(app.host_port)
        cloudFirewall = result.ok ? 'reconciled' : 'failed'
      } catch {
        cloudFirewall = 'failed'
      }
    }

    const url = app.url
    const externalOutcome: ExternalProbeOutcome | 'not_run' = this.options.skipExternalProbe
      ? 'not_run'
      : await probeExternalReachable(
          url,
          this.options.probeAttempts,
          this.options.probe ?? undefined
        )

    if (externalOutcome === 'not_run') {
      return {
        status: 'not_checked',
        url,
        external_probe: externalOutcome,
        ufw_state: ufwState,
        ufw_reconciled: ufwReconciled,
        cloud_firewall: cloudFirewall,
        diagnosis: null,
        checked_at: new Date().toISOString()
      }
    }

    const assessed = assessReachability(true, externalOutcome, app.host_port)
    return {
      status: assessed.externalOk ? 'reachable' : 'degraded',
      url,
      external_probe: externalOutcome,
      ufw_state: ufwState,
      ufw_reconciled: ufwReconciled,
      cloud_firewall: cloudFirewall,
      diagnosis: assessed.diagnosis,
      checked_at: new Date().toISOString()
    }
  }
}

/** Dùng cho unit test cũ và offline migration: không tự tuyên bố production reachability. */
export class UncheckedExposureManager implements ExposureManager {
  async reconcile({ app }: ExposureRequest): Promise<ExposureResult> {
    return {
      status: 'not_checked',
      url: app.url,
      external_probe: 'not_run',
      ufw_state: 'not_checked',
      ufw_reconciled: false,
      cloud_firewall: 'not_configured',
      diagnosis: null,
      checked_at: new Date().toISOString()
    }
  }
}
