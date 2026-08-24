import { Card, Statistic } from 'antd'

import { strings } from '../strings'

interface FleetSummaryProps {
  total: number
  online: number
  offline: number
  appCount: number
  loading: boolean
}

/** Hàng 4 ô số liệu toàn đội VPS — chỉ online/offline *xác định được*;
 *  trạng thái checking/unknown không bị tính nhầm vào ô nào. */
export function FleetSummary({
  total,
  online,
  offline,
  appCount,
  loading
}: FleetSummaryProps): React.JSX.Element {
  return (
    <div className="panel-fleet">
      <Card aria-label={strings.vpsControl.fleet.totalVps}>
        <Statistic title={strings.vpsControl.fleet.totalVps} value={total} loading={loading} />
      </Card>
      <Card aria-label={strings.vpsControl.fleet.online}>
        <Statistic
          title={strings.vpsControl.fleet.online}
          value={online}
          valueStyle={{ color: 'var(--success)' }}
          loading={loading}
        />
      </Card>
      <Card aria-label={strings.vpsControl.fleet.offline}>
        <Statistic
          title={strings.vpsControl.fleet.offline}
          value={offline}
          valueStyle={{ color: 'var(--danger)' }}
          loading={loading}
        />
      </Card>
      <Card aria-label={strings.vpsControl.fleet.totalApps}>
        <Statistic title={strings.vpsControl.fleet.totalApps} value={appCount} loading={loading} />
      </Card>
    </div>
  )
}
