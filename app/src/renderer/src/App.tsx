import { useEffect } from 'react'
import {
  AppstoreOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  GlobalOutlined,
  HistoryOutlined,
  RocketOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { App as AntApp, ConfigProvider, Segmented } from 'antd'

import { AppsPage } from './pages/AppsPage'
import { AppTitleBar } from './components/AppTitleBar'
import { DashboardPage } from './pages/DashboardPage'
import { DeployPage } from './pages/DeployPage'
import { HistoryPage } from './pages/HistoryPage'
import { MigratePage } from './pages/MigratePage'
import { SettingsPage } from './pages/SettingsPage'
import { VpsPage } from './pages/VpsPage'
import { strings } from './strings'
import { useUiState, type LocaleMode } from './store/uiState'
import { TITLEBAR_OVERLAY, applyTheme, themeTokens } from './utils/themeTokens'
import { ANTD_LOCALES, LOCALES } from './utils/locales'

type PageKey = 'vps' | 'apps' | 'deploy' | 'dashboard' | 'migrate' | 'history' | 'settings'

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
  const locale = useUiState((state) => state.locale)
  const setLocale = useUiState((state) => state.setLocale)
  const activePage = useUiState((state) => state.activePage)
  const setActivePage = useUiState((state) => state.setActivePage)

  const t = LOCALES[locale]

  const menuItems = [
    { key: 'vps', icon: <CloudServerOutlined />, label: t.navigation.vps },
    { key: 'apps', icon: <AppstoreOutlined />, label: t.navigation.apps },
    { key: 'deploy', icon: <RocketOutlined />, label: t.navigation.deploy },
    { key: 'dashboard', icon: <DashboardOutlined />, label: t.navigation.dashboard },
    { key: 'migrate', icon: <DeploymentUnitOutlined />, label: t.navigation.migrate },
    { key: 'history', icon: <HistoryOutlined />, label: t.navigation.history },
    { key: 'settings', icon: <SettingOutlined />, label: t.navigation.settings }
  ]

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

  const operationsItems = menuItems.filter((item) =>
    ['vps', 'apps', 'deploy', 'dashboard', 'migrate'].includes(item.key)
  )
  const managementItems = menuItems.filter((item) => ['history', 'settings'].includes(item.key))

  return (
    <ConfigProvider theme={themeTokens[themeMode]} locale={ANTD_LOCALES[locale]}>
      <AntApp>
        <div className="app-window">
          <AppTitleBar pageTitle={pageTitle} />
          <div className="app-shell">
            <aside className="app-sidebar" aria-label="Điều hướng chính">
              <div className="app-sidebar-header">
                <div className="app-sidebar-lang-selector" aria-label="Language selection">
                  <GlobalOutlined className="app-sidebar-lang-icon" aria-hidden="true" />
                  <Segmented<LocaleMode>
                    size="small"
                    value={locale}
                    onChange={setLocale}
                    options={[
                      { label: 'EN', value: 'en' },
                      { label: 'VI', value: 'vi' },
                      { label: 'CN', value: 'cn' },
                      { label: 'JP', value: 'jp' }
                    ]}
                  />
                </div>
              </div>

              <div className="app-sidebar-section-title">{t.sections.operations}</div>
              <nav className="app-sidebar-nav" aria-label="Khu vực vận hành">
                {operationsItems.map((item) => (
                  <button
                    className={`app-sidebar-item${item.key === page ? ' app-sidebar-item-active' : ''}`}
                    key={item.key}
                    type="button"
                    aria-label={item.label as string}
                    aria-current={item.key === page ? 'page' : undefined}
                    onClick={() => setActivePage(item.key as PageKey)}
                  >
                    <span className="app-sidebar-item-icon">{item.icon}</span>
                    <span className="app-sidebar-item-label">{item.label}</span>
                    {item.key === page && <span className="app-sidebar-item-pill" />}
                  </button>
                ))}
              </nav>

              <div className="app-sidebar-section-title">{t.sections.management}</div>
              <nav className="app-sidebar-nav" aria-label="Khu vực quản trị">
                {managementItems.map((item) => (
                  <button
                    className={`app-sidebar-item${item.key === page ? ' app-sidebar-item-active' : ''}`}
                    key={item.key}
                    type="button"
                    aria-label={item.label as string}
                    aria-current={item.key === page ? 'page' : undefined}
                    onClick={() => setActivePage(item.key as PageKey)}
                  >
                    <span className="app-sidebar-item-icon">{item.icon}</span>
                    <span className="app-sidebar-item-label">{item.label}</span>
                    {item.key === page && <span className="app-sidebar-item-pill" />}
                  </button>
                ))}
              </nav>

              <div className="app-sidebar-footer">
                <div className="app-sidebar-status">
                  <span className="app-activity-status" aria-hidden="true" />
                  <span>{t.status.ready}</span>
                </div>
                <span className="app-sidebar-mode mono-text">{t.status.local}</span>
              </div>
            </aside>

            <main className="app-main">
              <div className="content" data-page-key={page}>
                {renderPage(page, setActivePage)}
              </div>
              <footer className="app-statusbar">
                <span className="app-statusbar-item">
                  <span className="app-activity-status" />
                  <span>{t.status.ready}</span>
                </span>
                <span className="app-statusbar-divider">/</span>
                <span className="app-statusbar-item app-statusbar-page">{pageTitle}</span>
                <span className="app-statusbar-spacer" />
                <span className="app-statusbar-item mono-text">v0.1.0</span>
                <span className="app-statusbar-divider">/</span>
                <span className="app-statusbar-item mono-text">{t.status.engine}</span>
              </footer>
            </main>
          </div>
        </div>
      </AntApp>
    </ConfigProvider>
  )
}

export default App
