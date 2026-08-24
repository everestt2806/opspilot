import { Menu } from 'antd'
import type { MenuProps } from 'antd'
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  HomeOutlined
} from '@ant-design/icons'

import { strings } from '../strings'
import type { PanelTabKey } from '../store/uiState'

interface VpsNavSidebarProps {
  activeTab: PanelTabKey
  appCount: number
  onTabChange: (tab: PanelTabKey) => void
}

/** Menu dọc trong panel chi tiết — đồng bộ style với sidebar chính (DESIGN.md Lists). */
export function VpsNavSidebar({
  activeTab,
  appCount,
  onTabChange
}: VpsNavSidebarProps): React.JSX.Element {
  const items: MenuProps['items'] = [
    {
      key: 'overview',
      icon: <HomeOutlined />,
      label: strings.vpsControl.tabs.overview
    },
    {
      key: 'apps',
      icon: <AppstoreOutlined />,
      label: strings.vpsControl.tabs.apps,
      ...(appCount > 0 ? { extra: String(appCount) } : {})
    },
    {
      key: 'database',
      icon: <DatabaseOutlined />,
      label: strings.vpsControl.tabs.database
    },
    {
      key: 'activity',
      icon: <ClockCircleOutlined />,
      label: strings.vpsControl.tabs.activity
    }
  ]

  return (
    <Menu
      className="panel-nav-menu"
      mode="inline"
      selectedKeys={[activeTab]}
      items={items}
      onClick={({ key }) => onTabChange(key as PanelTabKey)}
    />
  )
}
