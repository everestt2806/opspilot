import { Button, Progress, Spin, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

import type { Vps } from '@shared/ipc'

import { strings } from '../strings'
import { localDateTime, relativeTime } from '../utils/format'
import {
  formatGb,
  formatMb,
  resourcePercents,
  type RowResourceState
} from '../vpsResources'

interface VpsInfoSidebarProps {
  vps: Vps
  resources: RowResourceState | undefined
  onRefreshResources: () => void
}

/** Sidebar phải: gauge CPU/RAM + thông số hệ thống — tham chiếu FlashPanel server info panel. */
export function VpsInfoSidebar({
  vps,
  resources,
  onRefreshResources
}: VpsInfoSidebarProps): React.JSX.Element {
  return (
    <aside className="panel-info-sidebar">
      <h3 className="panel-info-sidebar-title">{strings.vpsControl.sidebar.title}</h3>

      {resources?.status === 'loading' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Spin size="small" />
          <Typography.Text
            type="secondary"
            style={{ display: 'block', marginTop: 8, fontSize: 12 }}
          >
            {strings.vpsControl.sidebar.checking}
          </Typography.Text>
        </div>
      )}

      {resources?.status === 'error' && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type="danger" style={{ fontSize: 12, display: 'block' }}>
            {strings.vpsControl.sidebar.resourceError}
          </Typography.Text>
          <Typography.Text type="secondary" className="mono-text" style={{ fontSize: 11 }}>
            {resources.message}
          </Typography.Text>
          <Button
            size="small"
            type="link"
            icon={<ReloadOutlined />}
            onClick={onRefreshResources}
            style={{ paddingLeft: 0, marginTop: 4 }}
          >
            {strings.vpsControl.sidebar.retryResources}
          </Button>
        </div>
      )}

      {resources?.status === 'success' && <ResourceGauges data={resources.data} />}

      <div className="panel-spec-list" style={{ marginTop: resources?.status === 'success' ? 0 : 8 }}>
        {resources?.status === 'success' && (
          <>
            <SpecRow
              label={strings.vpsControl.sidebar.cores}
              value={String(resources.data.cpu_count)}
            />
            <SpecRow
              label={strings.vpsControl.sidebar.ramTotal}
              value={`${formatMb(resources.data.ram_total_mb - resources.data.ram_free_mb)} / ${formatMb(resources.data.ram_total_mb)}`}
            />
            <SpecRow
              label={strings.vpsControl.sidebar.disk}
              value={`${formatGb(resources.data.disk_total_gb - resources.data.disk_free_gb)} / ${formatGb(resources.data.disk_total_gb)}`}
            />
            <SpecRow
              label={strings.vpsControl.sidebar.loadAvg}
              value={resources.data.load_avg_1m.toFixed(2)}
            />
          </>
        )}
        <SpecRow
          label={strings.vpsControl.sidebar.docker}
          value={vps.docker_version ?? strings.vpsControl.overview.dockerMissing}
        />
        <SpecRow
          label={strings.vpsControl.sidebar.lastSeen}
          value={
            vps.last_seen_at
              ? relativeTime(vps.last_seen_at)
              : strings.vpsControl.overview.neverSeen
          }
          title={vps.last_seen_at ? localDateTime(vps.last_seen_at) : undefined}
        />
      </div>
    </aside>
  )
}

function ResourceGauges({
  data
}: {
  data: import('@shared/ipc').VpsResources
}): React.JSX.Element {
  const { ram, cpu } = resourcePercents(data)
  const gauges = [
    { label: strings.vpsControl.sidebar.cpu, percent: cpu },
    { label: strings.vpsControl.sidebar.ram, percent: ram }
  ]

  return (
    <div className="panel-gauge-row">
      {gauges.map((gauge) => (
        <div key={gauge.label} className="panel-gauge">
          <Progress
            type="circle"
            percent={gauge.percent}
            size={72}
            strokeColor={gauge.percent > 90 ? 'var(--danger)' : 'var(--info)'}
            format={(value) => `${value}%`}
          />
          <span className="panel-gauge-label">{gauge.label}</span>
        </div>
      ))}
    </div>
  )
}

function SpecRow({
  label,
  value,
  title
}: {
  label: string
  value: string
  title?: string
}): React.JSX.Element {
  return (
    <div className="panel-spec-row" title={title}>
      <span className="panel-spec-label">{label}</span>
      <span className="panel-spec-value mono-text">{value}</span>
    </div>
  )
}
