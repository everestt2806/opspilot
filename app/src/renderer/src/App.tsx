import { useEffect, useState } from 'react'
import {
  AppstoreOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  HistoryOutlined,
  RocketOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { App as AntApp, ConfigProvider, Layout, Menu } from 'antd'

import { AppsPage } from './pages/AppsPage'
import { AppTitleBar } from './components/AppTitleBar'
import { DashboardPage } from './pages/DashboardPage'
import { DeployPage } from './pages/DeployPage'
import { HistoryPage } from './pages/HistoryPage'
import { MigratePage } from './pages/MigratePage'
import { SettingsPage } from './pages/SettingsPage'
import { VpsPage } from './pages/VpsPage'
import { strings } from './strings'
import { useUiState } from './store/uiState'
import { TITLEBAR_OVERLAY, applyTheme, themeTokens } from './utils/themeTokens'

type PageKey = 'vps' | 'apps' | 'deploy' | 'dashboard' | 'migrate' | 'history' | 'settings'

const menuItems = [
  { key: 'vps', icon: <CloudServerOutlined />, label: strings.navigation.vps },
  { key: 'apps', icon: <AppstoreOutlined />, label: strings.navigation.apps },
  { key: 'deploy', icon: <RocketOutlined />, label: strings.navigation.deploy },
  { key: 'dashboard', icon: <DashboardOutlined />, label: strings.navigation.dashboard },
  { key: 'migrate', icon: <DeploymentUnitOutlined />, label: strings.navigation.migrate },
  { key: 'history', icon: <HistoryOutlined />, label: strings.navigation.history },
  { key: 'settings', icon: <SettingOutlined />, label: strings.navigation.settings }
]

function renderPage(activePage: PageKey, open: (page: string) => void): React.JSX.Element {
  const staticPages: Record<Exclude<PageKey, 'deploy' | 'dashboard' | 'vps'>, React.JSX.Element> = {
    apps: <AppsPage />,
    migrate: <MigratePage />,
    history: <HistoryPage />,
    settings: <SettingsPage />
  }
  if (activePage === 'deploy') {
    return <DeployPage onOpenDashboard={() => open('dashboard')} />
  }
  if (activePage === 'dashboard') {
    return <DashboardPage onOpenVps={() => open('vps')} onOpenDeploy={() => open('deploy')} />
  }
  if (activePage === 'vps') {
    return <VpsPage />
  }
  return staticPages[activePage]
}

function App(): React.JSX.Element {
  const themeMode = useUiState((state) => state.theme)
  const activePage = useUiState((state) => state.activePage)
  const setActivePage = useUiState((state) => state.setActivePage)
  const [collapsed, setCollapsed] = useState(false)

  // activePage lưu dạng string (session) — rào lại về PageKey hợp lệ trước khi render.
  const page: PageKey = menuItems.some((item) => item.key === activePage)
    ? (activePage as PageKey)
    : 'vps'
  const pageTitle = menuItems.find((item) => item.key === page)?.label ?? strings.app.name

  useEffect(() => {
    applyTheme(themeMode)
    // Đổi luôn màu nút minimize/close của overlay native Windows cho khớp theme.
    window.api?.invoke('window:set-titlebar-overlay', TITLEBAR_OVERLAY[themeMode]).catch(() => {})
  }, [themeMode])

  return (
    <ConfigProvider theme={themeTokens[themeMode]}>
      <AntApp>
        <div className="app-window">
          <AppTitleBar pageTitle={pageTitle} />
          <Layout className="app-shell">
            {/* Không đặt theme="dark" ở đây: antd sẽ dùng bộ navy #001529 mặc định
                thay vì token trong themeTokens — sidebar lệch tông với nền xám. */}
            <Layout.Sider
              width={216}
              collapsedWidth={48}
              collapsible
              collapsed={collapsed}
              onCollapse={setCollapsed}
              breakpoint="lg"
            >
              <Menu
                className="app-navigation"
                mode="inline"
                selectedKeys={[page]}
                items={menuItems}
                onClick={({ key }) => setActivePage(key as PageKey)}
              />
            </Layout.Sider>
            <Layout>
              <Layout.Content className="content" data-page-key={page}>
                {renderPage(page, setActivePage)}
              </Layout.Content>
            </Layout>
          </Layout>
        </div>
      </AntApp>
    </ConfigProvider>
  )
}

export default App
