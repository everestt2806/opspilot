import { Button, Progress, Space, Spin, Tooltip, Typography } from 'antd'
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons'

import type { VpsResources } from '@shared/ipc'

import { strings } from '../strings'
import { formatGb, formatMb, resourcePercents, type RowResourceState } from '../vpsResources'

interface VpsResourcesCellProps {
  vpsName: string
  state: RowResourceState | undefined
  onRetry: () => void
}

/** Ô CPU/RAM/Disk của một hàng VPS — đủ 4 state: empty / loading / error / success. */
export function VpsResourcesCell({
  vpsName,
  state,
  onRetry
}: VpsResourcesCellProps): React.JSX.Element {
  if (!state) {
    return <Typography.Text type="secondary">{strings.vps.resources.empty}</Typography.Text>
  }

  if (state.status === 'loading') {
    return <Spin size="small" aria-label={strings.vps.status.checking} />
  }

  if (state.status === 'error') {
    return (
      <Space size="small">
        <Tooltip title={state.message}>
          <WarningOutlined className="step-icon-fail" aria-label={strings.vps.resources.error} />
        </Tooltip>
        <Button
          size="small"
          type="link"
          danger
          icon={<ReloadOutlined />}
          aria-label={strings.vps.resources.retry(vpsName)}
          onClick={onRetry}
        >
          {strings.common.retry}
        </Button>
      </Space>
    )
  }

  return <ResourceBars data={state.data} />
}

function ResourceBars({ data }: { data: VpsResources }): React.JSX.Element {
  const { ram, disk, cpu } = resourcePercents(data)
  const bars = [
    {
      label: strings.vps.resources.ram,
      percent: ram,
      detail: strings.vps.resources.usedOf(
        formatMb(data.ram_total_mb - data.ram_free_mb),
        formatMb(data.ram_total_mb)
      )
    },
    {
      label: strings.vps.resources.disk,
      percent: disk,
      detail: strings.vps.resources.usedOf(
        formatGb(data.disk_total_gb - data.disk_free_gb),
        formatGb(data.disk_total_gb)
      )
    },
    {
      label: strings.vps.resources.cpu,
      percent: cpu,
      detail: `${data.load_avg_1m.toFixed(2)} · ${strings.vps.resources.cores(data.cpu_count)}`
    }
  ]

  return (
    <div className="resource-bars">
      {bars.map((bar) => (
        <Tooltip key={bar.label} title={bar.detail}>
          <div className="resource-bar" aria-label={bar.detail}>
            <Typography.Text type="secondary" className="resource-bar-label">
              {bar.label}
            </Typography.Text>
            <Progress
              percent={bar.percent}
              showInfo={false}
              size="small"
              status={bar.percent > 90 ? 'exception' : 'normal'}
            />
          </div>
        </Tooltip>
      ))}
    </div>
  )
}
