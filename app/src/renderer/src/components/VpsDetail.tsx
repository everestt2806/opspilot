import { Card, Empty } from 'antd'

import type { Vps } from '@shared/ipc'

import { strings } from '../strings'
import type { PanelTabKey } from '../store/uiState'
import type { RowResourceState } from '../vpsResources'
import { VpsActivityTab } from './VpsActivityTab'
import { VpsAppsTab } from './VpsAppsTab'
import { VpsDatabaseTab } from './VpsDatabaseTab'
import { VpsInfoSidebar } from './VpsInfoSidebar'
import { VpsNavSidebar } from './VpsNavSidebar'
import { VpsOverviewTab } from './VpsOverviewTab'

const PANEL_TABS: PanelTabKey[] = ['overview', 'apps', 'database', 'activity']

interface VpsDetailProps {
  vps: Vps | null
  resources: RowResourceState | undefined
  appCount: number
  activeTab: PanelTabKey
  onTabChange: (tab: PanelTabKey) => void
  onRefreshResources: () => void
  onCheckConnection: () => void
  onEdit: () => void
  onDelete: () => void
  onDockerInstalled: () => void
}

/** Vùng chi tiết panel VPS — layout FlashPanel: header + nav + nội dung + sidebar thông tin. */
export function VpsDetail({
  vps,
  resources,
  appCount,
  activeTab,
  onTabChange,
  onRefreshResources,
  onCheckConnection,
  onEdit,
  onDelete,
  onDockerInstalled
}: VpsDetailProps): React.JSX.Element {
  if (!vps) {
    return (
      <Card className="panel-detail">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={strings.vpsControl.selector.noSelection}
        />
      </Card>
    )
  }

  const tab = PANEL_TABS.includes(activeTab) ? activeTab : 'overview'

  return (
    <div key={vps.id} className="panel-detail-column">
      <div
        className={`panel-detail-layout${tab === 'overview' ? '' : ' panel-detail-layout-full'}`}
      >
        <VpsNavSidebar activeTab={tab} appCount={appCount} onTabChange={onTabChange} />
        <Card className="panel-detail-main" styles={{ body: { padding: 16 } }}>
          {tab === 'overview' && (
            <VpsOverviewTab
              vps={vps}
              onRefreshResources={onRefreshResources}
              onCheckConnection={onCheckConnection}
              onEdit={onEdit}
              onDelete={onDelete}
              onDockerInstalled={onDockerInstalled}
            />
          )}
          {tab === 'apps' && <VpsAppsTab vpsId={vps.id} />}
          {tab === 'database' && <VpsDatabaseTab vpsId={vps.id} />}
          {tab === 'activity' && <VpsActivityTab vpsId={vps.id} />}
        </Card>
        {tab === 'overview' && (
          <VpsInfoSidebar vps={vps} resources={resources} onRefreshResources={onRefreshResources} />
        )}
      </div>
    </div>
  )
}
