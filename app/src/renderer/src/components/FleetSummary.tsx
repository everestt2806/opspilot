import { Skeleton } from 'antd'

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
    <div className="panel-fleet summary-strip" aria-busy={loading}>
      <div className="summary-cell" aria-label={strings.vpsControl.fleet.totalVps}>
        <span>{strings.vpsControl.fleet.totalVps}</span>
        {loading ? <Skeleton active paragraph={false} /> : <strong>{total}</strong>}
      </div>
      <div
        className="summary-cell summary-cell-success"
        aria-label={strings.vpsControl.fleet.online}
      >
        <span>{strings.vpsControl.fleet.online}</span>
        {loading ? <Skeleton active paragraph={false} /> : <strong>{online}</strong>}
      </div>
      <div
        className="summary-cell summary-cell-danger"
        aria-label={strings.vpsControl.fleet.offline}
      >
        <span>{strings.vpsControl.fleet.offline}</span>
        {loading ? <Skeleton active paragraph={false} /> : <strong>{offline}</strong>}
      </div>
      <div className="summary-cell" aria-label={strings.vpsControl.fleet.totalApps}>
        <span>{strings.vpsControl.fleet.totalApps}</span>
        {loading ? <Skeleton active paragraph={false} /> : <strong>{appCount}</strong>}
      </div>
    </div>
  )
}
