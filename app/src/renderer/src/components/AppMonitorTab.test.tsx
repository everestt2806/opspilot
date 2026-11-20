// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App as AntApp } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Alert, MetricSample, MonitorSetting } from '@shared/ipc'
import { AppMonitorTab } from './AppMonitorTab'
import { useUiState } from '../store/uiState'

const SETTING: MonitorSetting = {
  app_id: 1,
  collector_interval_s: 10,
  poll_interval_s: 30,
  rule_cpu_pct: 90,
  rule_mem_pct: 90,
  rule_latency_ms: 2000,
  rule_error_rate: 0.5,
  rule_consecutive: 3,
  ml_score_threshold: 0.7,
  ml_consecutive: 2,
  auto_rollback: 0,
  trusted_method: 'ensemble',
  rollback_consecutive: 3,
  cooldown_minutes: 10
}

const SAMPLE: MetricSample = {
  id: 1,
  deployment_id: 10,
  seq: 1,
  ts_vps: '2026-11-20T12:00:00Z',
  cpu_pct: 22.5,
  mem_mb: 140.2,
  mem_pct: 28.0,
  latency_ms: 42,
  http_error_rate: 0,
  db_response_ms: null,
  container_up: 1
}

const ALERT: Alert = {
  id: 5,
  deployment_id: 10,
  method: 'ensemble',
  ts_vps: '2026-11-20T12:01:00Z',
  ts_resolved: null,
  peak_score: 0.91,
  detail_json: null,
  label: null,
  acted: 'rollback_suppressed_cooldown'
}

beforeEach(() => {
  vi.clearAllMocks()
  useUiState.setState({ locale: 'en' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AppMonitorTab', () => {
  it('loads settings, samples, scores, alerts and requires confirmation to enable auto-rollback', async () => {
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'monitor:get-setting') return { ok: true, data: SETTING }
      if (channel === 'monitor:samples') return { ok: true, data: [SAMPLE] }
      if (channel === 'monitor:scores') {
        return {
          ok: true,
          data: [
            {
              ts_vps: '2026-11-20T12:00:00Z',
              rule: 0,
              zscore_ewma: 0.12,
              iforest: 0.18,
              ocsvm: 0.2,
              ensemble: 0.167
            }
          ]
        }
      }
      if (channel === 'monitor:alerts') return { ok: true, data: [ALERT] }
      if (channel === 'monitor:set-setting') {
        return { ok: true, data: { ...SETTING, ...(args[1] as Partial<MonitorSetting>) } }
      }
      if (channel === 'monitor:label-alert') return { ok: true, data: undefined }
      return { ok: true, data: undefined }
    })
    vi.stubGlobal('api', { invoke, on: vi.fn(() => () => {}) })

    render(
      <AntApp>
        <AppMonitorTab appId={1} deploymentId={10} importedFromVps={false} />
      </AntApp>
    )

    expect(await screen.findByText('Anomaly & Auto-Rollback Policy')).toBeTruthy()
    expect(screen.getByText('22.5%')).toBeTruthy()
    expect(screen.getByText('0.167')).toBeTruthy()
    expect(screen.getByText('Suppressed (cooldown)')).toBeTruthy()

    const switchBtn = screen.getByRole('switch', { name: 'Auto-rollback' })
    fireEvent.click(switchBtn)
    expect(await screen.findByText('Enable automatic rollback?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Enable auto-rollback' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('monitor:set-setting', 1, { auto_rollback: 1 })
    )

    fireEvent.click(screen.getByRole('button', { name: /True positive/i }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('monitor:label-alert', 5, 'true_positive')
    )
  })

  it('shows read-only notice for VPS-imported apps', () => {
    vi.stubGlobal('api', { invoke: vi.fn(), on: vi.fn(() => () => {}) })
    render(
      <AntApp>
        <AppMonitorTab appId={1} deploymentId={10} importedFromVps={true} />
      </AntApp>
    )
    expect(
      screen.getByText('Monitoring and auto-rollback are unavailable for VPS-imported apps.')
    ).toBeTruthy()
  })
})
