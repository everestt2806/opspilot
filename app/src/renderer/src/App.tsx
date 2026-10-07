import { useEffect, useRef } from 'react'
import {
  AppstoreOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  HistoryOutlined,
  PlusOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { App as AntApp, ConfigProvider, message } from 'antd'

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
import { useStrings } from './strings'

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
  const [messageApi, messageContextHolder] = message.useMessage()
  const strings = useStrings()

  const themeMode = useUiState((state) => state.theme)
  const locale = useUiState((state) => state.locale)
  const rawActivePage = useUiState((state) => state.activePage)
  const selectedAppId = useUiState((state) => state.selectedAppId)
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
  const lastContextRef = useRef<{ page: ActivePageKey; appId: number | null }>({
    page,
    appId: selectedAppId
  })

  // Invalidate any in-flight app:get immediately when page or selectedAppId changes,
  // even if the user switches away and back to the same value later.
  useEffect(() => {
    lastContextRef.current = {
      page: resolveActivePage(useUiState.getState().activePage),
      appId: useUiState.getState().selectedAppId
    }

    const unsub = useUiState.subscribe((state) => {
      const newPage = resolveActivePage(state.activePage)
      const newAppId = state.selectedAppId
      if (newPage !== lastContextRef.current.page || newAppId !== lastContextRef.current.appId) {
        lastContextRef.current = { page: newPage, appId: newAppId }
        deployRequestIdRef.current++
      }
    })

    return unsub
  }, [])

  useEffect(() => {
    deployRequestIdRef.current++
  }, [page, selectedAppId])

  const handleDeployClick = async (): Promise<void> => {
    // Invalidate any prior deploy attempt immediately upon every new click
    const requestId = ++deployRequestIdRef.current
    // Xóa deployPreselect cũ ngay khi bắt đầu ý định mới, trước khi chờ app:get
    useUiState.getState().setDeployPreselect(null)

    const rawPage = useUiState.getState().activePage
    const currentPage = resolveActivePage(rawPage)
    const currentAppId = useUiState.getState().selectedAppId
    const currentVpsId = useUiState.getState().selectedVpsId

    if (currentPage === 'apps' && currentAppId !== null) {
      try {
        const res = await window.api?.invoke('app:get', currentAppId)
        if (requestId !== deployRequestIdRef.current) return
        const latestPage = resolveActivePage(useUiState.getState().activePage)
        const latestAppId = useUiState.getState().selectedAppId
        if (latestPage !== 'apps' || latestAppId !== currentAppId) return

        if (res?.ok) {
          const app = res.data
          const isAppValid =
            app &&
            typeof app === 'object' &&
            app.id === currentAppId &&
            typeof app.vps_id === 'number' &&
            Number.isInteger(app.vps_id) &&
            app.vps_id > 0

          if (isAppValid) {
            useUiState.getState().setDeployPreselect({ appId: currentAppId, vpsId: app.vps_id })
            setActivePage('deploy')
          } else if (app && app.id !== currentAppId) {
            messageApi.error(strings.deploy.actionErrors.mismatchedId)
          } else {
            messageApi.error(strings.deploy.actionErrors.missingVps)
          }
        } else {
          const detail =
            res && 'error' in res && res.error
              ? typeof res.error === 'string'
                ? res.error
                : res.error.message || ''
              : ''
          messageApi.error(
            detail
              ? strings.deploy.actionErrors.ipcError(detail)
              : strings.deploy.actionErrors.loadFailed
          )
        }
      } catch (err: unknown) {
        if (requestId !== deployRequestIdRef.current) return
        const latestPage = resolveActivePage(useUiState.getState().activePage)
        const latestAppId = useUiState.getState().selectedAppId
        if (latestPage !== 'apps' || latestAppId !== currentAppId) return

        const errMsg = err instanceof Error ? err.message : String(err)
        messageApi.error(strings.deploy.actionErrors.ipcError(errMsg))
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
        {messageContextHolder}
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
