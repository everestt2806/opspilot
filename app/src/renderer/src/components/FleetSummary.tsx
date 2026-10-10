import { Skeleton } from 'antd'

import { useStrings } from '../strings'

interface FleetSummaryProps {
  total: number
  online?: number
  offline?: number
  checkedNow?: number
  checkFailed?: number
  appCount: number
  loading: boolean
}

/** Hàng 4 ô số liệu toàn đội VPS — chỉ checked_now/check_failed xác định được;
 *  trạng thái checking/unknown/stale không bị tính nhầm vào ô nào. */
export function FleetSummary({
  total,
  online,
  offline,
  checkedNow,
  checkFailed,
  appCount,
  loading
}: FleetSummaryProps): React.JSX.Element {
  const strings = useStrings()
  const checkedNowCount = checkedNow ?? online ?? 0
  const checkFailedCount = checkFailed ?? offline ?? 0

  return (
    <div className="panel-fleet summary-strip" aria-busy={loading}>
      <div className="summary-cell" aria-label={strings.vpsControl.fleet.totalVps}>
        <span>{strings.vpsControl.fleet.totalVps}</span>
        {loading ? <Skeleton active paragraph={false} /> : <strong>{total}</strong>}
      </div>
      <div
        className="summary-cell summary-cell-success"
        aria-label={strings.vpsControl.fleet.checkedNow}
      >
        <span>{strings.vpsControl.fleet.checkedNow}</span>
        {loading ? <Skeleton active paragraph={false} /> : <strong>{checkedNowCount}</strong>}
      </div>
      <div
        className="summary-cell summary-cell-danger"
        aria-label={strings.vpsControl.fleet.checkFailed}
      >
        <span>{strings.vpsControl.fleet.checkFailed}</span>
        {loading ? <Skeleton active paragraph={false} /> : <strong>{checkFailedCount}</strong>}
      </div>
      <div className="summary-cell" aria-label={strings.vpsControl.fleet.totalApps}>
        <span>{strings.vpsControl.fleet.totalApps}</span>
        {loading ? <Skeleton active paragraph={false} /> : <strong>{appCount}</strong>}
      </div>
    </div>
  )
}
