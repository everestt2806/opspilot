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
import { Badge, Button, ConfigProvider, Layout, Menu, Space, Typography, theme } from 'antd'

import { AppsPage } from './pages/AppsPage'
import { DashboardPage } from './pages/DashboardPage'
import { DeployPage } from './pages/DeployPage'
import { HistoryPage } from './pages/HistoryPage'
import { MigratePage } from './pages/MigratePage'
import { SettingsPage } from './pages/SettingsPage'
import { VpsPage } from './pages/VpsPage'
import opsPilotLogo from './assets/opspilot-logo.png'
import { strings } from './strings'

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

function renderPage(activePage: PageKey, open: (page: PageKey) => void): React.JSX.Element {
  const staticPages: Record<Exclude<PageKey, 'deploy' | 'dashboard'>, React.JSX.Element> = {
    vps: <VpsPage />,
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
  return staticPages[activePage]
}

function App(): React.JSX.Element {
  const [activePage, setActivePage] = useState<PageKey>('vps')
  const [collapsed, setCollapsed] = useState(false)
  const [mlRunning, setMlRunning] = useState(false)

  useEffect(() => {
    void window.api.invoke('system:ml-status').then((result) => {
      setMlRunning(result.ok && result.data.running)
    })

    return window.api.on('system:ml-status', (status) => {
      setMlRunning(status.running)
    })
  }, [])

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#60A5FA',
          colorSuccess: '#34D399',
          colorWarning: '#FBBF24',
          colorError: '#F87171',
          colorBgBase: '#0F1115',
          colorBgContainer: '#171A21',
          colorBorder: '#2A2F3A',
          borderRadius: 8
        }
      }}
    >
      <Layout className="app-shell">
        <Layout.Sider
          width={220}
          collapsedWidth={56}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          theme="dark"
        >
          <div className="brand" aria-label={strings.app.name}>
            <img className="brand-logo" src={opsPilotLogo} alt="" aria-hidden="true" />
            {!collapsed && <span className="brand-name">{strings.app.name}</span>}
          </div>
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[activePage]}
            items={menuItems}
            onClick={({ key }) => setActivePage(key as PageKey)}
          />
        </Layout.Sider>
        <Layout>
          <Layout.Header className="topbar">
            <Typography.Text>{strings.app.noSelection}</Typography.Text>
            <Space size={20}>
              <Badge status="default" text={`${strings.status.ssh}: ${strings.status.unknown}`} />
              <Button type="text" className="status-button">
                <Badge
                  status={mlRunning ? 'success' : 'error'}
                  text={`${strings.status.mlService}: ${
                    mlRunning ? strings.status.running : strings.status.stopped
                  }`}
                />
              </Button>
            </Space>
          </Layout.Header>
          <Layout.Content className="content">
            {renderPage(activePage, setActivePage)}
          </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}

export default App
