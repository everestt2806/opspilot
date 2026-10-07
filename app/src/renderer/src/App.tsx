import { useEffect, useRef } from 'react'
import {
  AppstoreOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  HistoryOutlined,
  PlusOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { App as AntApp, ConfigProvider } from 'antd'

import { AppsPage } from './pages/AppsPage'
import { AppTitleBar } from './components/AppTitleBar'
import { DashboardPage } from './pages/DashboardPage'
import { DeployPage } from './pages/DeployPage'
import { HistoryPage } from './pages/HistoryPage'
import { MigratePage } from './pages/MigratePage'
import { SettingsPage } from './pages/SettingsPage'
import { VpsPage } from './pages/VpsPage'
import { useUiState } from './store/uiState'
import { TITLEBAR_OVERLAY, applyTheme, themeTokens } from './utils/themeTokens'
import { ANTD_LOCALES, LOCALES } from './utils/locales'
import { resolveActivePage, type ActivePageKey, type NavPageKey } from './utils/navigation'

function renderPage(page: ActivePageKey, open: (page: string) => void): React.JSX.Element {
  switch (page) {
    case 'dashboard':
      return (
        <DashboardPage
          onOpenApps={() => open('apps')}
          onOpenVps={() => open('vps')}
          onOpenDeploy={() => open('deploy')}
          onOpenActivity={() => open('activity')}
        />
      )
    case 'apps':
      return <AppsPage />
    case 'vps':
      return <VpsPage />
    case 'activity':
      return (
        <HistoryPage
          onOpenVps={() => open('vps')}
          onOpenApps={() => open('apps')}
          onOpenDeploy={() => open('deploy')}
        />
      )
    case 'settings':
      return <SettingsPage />
    case 'deploy':
      return <DeployPage onOpenDashboard={() => open('dashboard')} onBack={() => open('apps')} />
    case 'migrate':
      return <MigratePage />
  }
}

function App(): React.JSX.Element {
  const themeMode = useUiState((state) => state.theme)
  const locale = useUiState((state) => state.locale)
  const rawActivePage = useUiState((state) => state.activePage)
  const setActivePage = useUiState((state) => state.setActivePage)

  const t = LOCALES[locale]
  const page = resolveActivePage(rawActivePage)

  const navItems: Array<{ key: NavPageKey; icon: React.ReactNode; label: string }> = [
    { key: 'dashboard', icon: <DashboardOutlined />, label: t.navigation.dashboard },
    { key: 'apps', icon: <AppstoreOutlined />, label: t.navigation.apps },
    { key: 'vps', icon: <CloudServerOutlined />, label: t.navigation.vps },
    { key: 'activity', icon: <HistoryOutlined />, label: t.navigation.activity },
    { key: 'settings', icon: <SettingOutlined />, label: t.navigation.settings }
  ]

  useEffect(() => {
    applyTheme(themeMode)
    window.api?.invoke('window:set-titlebar-overlay', TITLEBAR_OVERLAY[themeMode]).catch(() => {})
  }, [themeMode])

  const deployRequestIdRef = useRef(0)

  const handleDeployClick = async (): Promise<void> => {
    const rawPage = useUiState.getState().activePage
    const currentPage = resolveActivePage(rawPage)
    const currentAppId = useUiState.getState().selectedAppId
    const currentVpsId = useUiState.getState().selectedVpsId

    if (currentPage === 'apps' && currentAppId !== null) {
      const requestId = ++deployRequestIdRef.current
      try {
        const res = await window.api?.invoke('app:get', currentAppId)
        if (requestId !== deployRequestIdRef.current) return
        const latestPage = resolveActivePage(useUiState.getState().activePage)
        const latestAppId = useUiState.getState().selectedAppId
        if (latestPage !== 'apps' || latestAppId !== currentAppId) return

        if (res?.ok && res.data && typeof res.data.vps_id === 'number') {
          useUiState.getState().setDeployPreselect({ appId: currentAppId, vpsId: res.data.vps_id })
          setActivePage('deploy')
        } else {
          useUiState.getState().setDeployPreselect(null)
          setActivePage('deploy')
        }
      } catch {
        if (requestId !== deployRequestIdRef.current) return
        const latestPage = resolveActivePage(useUiState.getState().activePage)
        const latestAppId = useUiState.getState().selectedAppId
        if (latestPage !== 'apps' || latestAppId !== currentAppId) return

        useUiState.getState().setDeployPreselect(null)
        setActivePage('deploy')
      }
      return
    }

    if (currentPage === 'vps' && currentVpsId !== null) {
      useUiState.getState().setDeployPreselect({ vpsId: currentVpsId })
      setActivePage('deploy')
      return
    }

    useUiState.getState().setDeployPreselect(null)
    setActivePage('deploy')
  }

  return (
    <ConfigProvider theme={themeTokens[themeMode]} locale={ANTD_LOCALES[locale]}>
      <AntApp>
        <div className="app-window">
          <AppTitleBar />
          <div className="app-shell">
            <aside className="app-sidebar" aria-label="Điều hướng chính">
              <div className="app-sidebar-action">
                <button
                  type="button"
                  className="app-sidebar-deploy-btn"
                  onClick={() => void handleDeployClick()}
                  aria-label={t.navigation.deployAction}
                >
                  <PlusOutlined className="app-sidebar-deploy-icon" />
                  <span>{t.navigation.deployAction}</span>
                </button>
              </div>

              <nav className="app-sidebar-nav" aria-label="Khu vực điều hướng chính">
                {navItems.map((item) => (
                  <button
                    className={`app-sidebar-item${item.key === page ? ' app-sidebar-item-active' : ''}`}
                    key={item.key}
                    type="button"
                    aria-label={item.label}
                    aria-current={item.key === page ? 'page' : undefined}
                    onClick={() => setActivePage(item.key)}
                  >
                    <span className="app-sidebar-item-icon">{item.icon}</span>
                    <span className="app-sidebar-item-label">{item.label}</span>
                    {item.key === page && <span className="app-sidebar-item-pill" />}
                  </button>
                ))}
              </nav>
            </aside>

            <main className="app-main">
              <div className="content" data-page-key={page}>
                {renderPage(page, setActivePage)}
              </div>
            </main>
          </div>
        </div>
      </AntApp>
    </ConfigProvider>
  )
}

export default App
