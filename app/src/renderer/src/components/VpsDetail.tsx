import { Card, Empty, Tabs } from 'antd'
import type { TabsProps } from 'antd'
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  HomeOutlined
} from '@ant-design/icons'

import type { Vps } from '@shared/ipc'

import { useStrings } from '../strings'
import type { PanelTabKey } from '../store/uiState'
import type { RowResourceState } from '../vpsResources'
import { VpsActivityTab } from './VpsActivityTab'
import { VpsAppsTab } from './VpsAppsTab'
import { VpsDatabaseTab } from './VpsDatabaseTab'
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

/** Vùng chi tiết VPS — Bố cục UI-1d: tab ngang toàn chiều rộng, không sub-sidebars. */
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
  const strings = useStrings()

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

  const tabItems: TabsProps['items'] = [
    {
      key: 'overview',
      label: (
        <span>
          <HomeOutlined style={{ marginRight: 6 }} />
          <span>{strings.vpsControl.tabs.overview}</span>
        </span>
      ),
      children: (
        <VpsOverviewTab
          vps={vps}
          resources={resources}
          onRefreshResources={onRefreshResources}
          onCheckConnection={onCheckConnection}
          onEdit={onEdit}
          onDelete={onDelete}
          onDockerInstalled={onDockerInstalled}
        />
      )
    },
    {
      key: 'apps',
      label: (
        <span>
          <AppstoreOutlined style={{ marginRight: 6 }} />
          <span>{strings.vpsControl.tabs.apps}</span>
          {appCount > 0 ? ` (${appCount})` : ''}
        </span>
      ),
      children: <VpsAppsTab vpsId={vps.id} />
    },
    {
      key: 'database',
      label: (
        <span>
          <DatabaseOutlined style={{ marginRight: 6 }} />
          <span>{strings.vpsControl.tabs.database}</span>
        </span>
      ),
      children: <VpsDatabaseTab vpsId={vps.id} />
    },
    {
      key: 'activity',
      label: (
        <span>
          <ClockCircleOutlined style={{ marginRight: 6 }} />
          <span>{strings.vpsControl.tabs.activity}</span>
        </span>
      ),
      children: <VpsActivityTab vpsId={vps.id} />
    }
  ]

  return (
    <div key={vps.id} className="panel-detail-column vps-detail-fullwidth">
      <Card className="panel-detail-card" styles={{ body: { padding: 16 } }}>
        <Tabs
          className="vps-detail-tabs"
          activeKey={tab}
          onChange={(key) => onTabChange(key as PanelTabKey)}
          destroyOnHidden
          items={tabItems}
        />
      </Card>
    </div>
  )
}
