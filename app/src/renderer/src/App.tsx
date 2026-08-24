import { useEffect, useState } from 'react'
import {
  AppstoreOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  HistoryOutlined,
  MoonOutlined,
  RocketOutlined,
  SettingOutlined,
  SunOutlined
} from '@ant-design/icons'
import {
  App as AntApp,
  Badge,
  Button,
  ConfigProvider,
  Layout,
  Menu,
  Segmented,
  Space,
  Tooltip,
  Typography
} from 'antd'

import { AppsPage } from './pages/AppsPage'
import { AppTitleBar } from './components/AppTitleBar'
import { DashboardPage } from './pages/DashboardPage'
import { DeployPage } from './pages/DeployPage'
import { HistoryPage } from './pages/HistoryPage'
import { MigratePage } from './pages/MigratePage'
import { SettingsPage } from './pages/SettingsPage'
import { VpsPage } from './pages/VpsPage'
import opsPilotLogo from './assets/opspilot-logo.png'
import { strings } from './strings'
import { useUiState } from './store/uiState'
import { themeTokens, type ThemeMode } from './utils/themeTokens'

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
  const setTheme = useUiState((state) => state.setTheme)
  const activePage = useUiState((state) => state.activePage)
  const setActivePage = useUiState((state) => state.setActivePage)
  const selectedVpsIds = useUiState((state) => state.selectedVpsIds)
  const [collapsed, setCollapsed] = useState(false)
  const [mlRunning, setMlRunning] = useState(false)

  // activePage lưu dạng string (session) — rào lại về PageKey hợp lệ trước khi render.
  const page: PageKey = menuItems.some((item) => item.key === activePage)
    ? (activePage as PageKey)
    : 'vps'
  const pageTitle = menuItems.find((item) => item.key === page)?.label ?? strings.app.name

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
  }, [themeMode])

  useEffect(() => {
    void window.api.invoke('system:ml-status').then((result) => {
      setMlRunning(result.ok && result.data.running)
    })

    return window.api.on('system:ml-status', (status) => {
      setMlRunning(status.running)
    })
  }, [])

  return (
    <ConfigProvider theme={themeTokens[themeMode]}>
      <AntApp>
        <div className="app-window">
          <AppTitleBar pageTitle={pageTitle} />
          <Layout className="app-shell">
            <Layout.Sider
              width={220}
              collapsedWidth={56}
              collapsible
              collapsed={collapsed}
              onCollapse={setCollapsed}
              breakpoint="lg"
              onBreakpoint={(broken) => {
                if (broken) setCollapsed(true)
              }}
              theme={themeMode === 'dark' ? 'dark' : 'light'}
            >
              <div className="brand" aria-label={strings.app.name}>
                <img className="brand-logo" src={opsPilotLogo} alt="" aria-hidden="true" />
                {!collapsed && <span className="brand-name">{strings.app.name}</span>}
              </div>
              <Menu
                mode="inline"
                theme={themeMode === 'dark' ? 'dark' : 'light'}
                selectedKeys={[page]}
                items={menuItems}
                onClick={({ key }) => setActivePage(key as PageKey)}
              />
            </Layout.Sider>
            <Layout>
              <Layout.Header className="topbar">
                <Typography.Text className="topbar-summary">
                  {selectedVpsIds.length > 0
                    ? strings.app.vpsSelected(selectedVpsIds.length)
                    : strings.app.noSelection}
                </Typography.Text>
                <Space size={20} className="topbar-status">
                  <Badge
                    className="topbar-ssh-status"
                    status="default"
                    text={`${strings.status.ssh}: ${strings.status.unknown}`}
                  />
                  <Button type="text" className="status-button">
                    <Badge
                      status={mlRunning ? 'success' : 'error'}
                      text={`${strings.status.mlService}: ${
                        mlRunning ? strings.status.running : strings.status.stopped
                      }`}
                    />
                  </Button>
                  <Tooltip title={strings.appearance.label}>
                    <Segmented<ThemeMode>
                      value={themeMode}
                      onChange={(value) => setTheme(value)}
                      options={[
                        {
                          value: 'light',
                          icon: <SunOutlined aria-hidden="true" />,
                          label: strings.appearance.light
                        },
                        {
                          value: 'dark',
                          icon: <MoonOutlined aria-hidden="true" />,
                          label: strings.appearance.dark
                        }
                      ]}
                    />
                  </Tooltip>
                </Space>
              </Layout.Header>
              <Layout.Content className="content">{renderPage(page, setActivePage)}</Layout.Content>
            </Layout>
          </Layout>
        </div>
      </AntApp>
    </ConfigProvider>
  )
}

export default App
