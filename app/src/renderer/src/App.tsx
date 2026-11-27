import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AppstoreOutlined,
  BgColorsOutlined,
  CloudServerOutlined,
  CopyOutlined,
  DashboardOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { App as AntApp, ConfigProvider, Tooltip, message, notification } from 'antd'

import { AppsPage } from './pages/AppsPage'
import { AppTitleBar } from './components/AppTitleBar'
import { ContextMenuProvider } from './components/ContextMenu'
import type { ContextMenuItem } from './components/contextMenuContext'
import { DashboardPage } from './pages/DashboardPage'
import { DeployPage } from './pages/DeployPage'
import { HistoryPage } from './pages/HistoryPage'
import { MigratePage } from './pages/MigratePage'
import { SettingsPage } from './pages/SettingsPage'
import { VpsPage } from './pages/VpsPage'
import { useUiState, type LocaleMode } from './store/uiState'
import { TITLEBAR_OVERLAY, applyTheme, themeTokens } from './utils/themeTokens'
import { ANTD_LOCALES, LOCALES } from './utils/locales'
import { resolveActivePage, type ActivePageKey, type NavPageKey } from './utils/navigation'
import { useStrings } from './strings'

const SHELL_COPY: Record<
  LocaleMode,
  {
    collapseSidebar: string
    expandSidebar: string
    refreshPage: string
    toggleTheme: string
    copyText: string
    mlLabel: string
    mlOnline: string
    mlOffline: string
    sshLabel: string
    sshOnline: string
    sshIdle: string
    autoRollbackTitle: string
    autoRollbackBody: (fromVersion: number, toVersion: number, method: string) => string
  }
> = {
  vi: {
    collapseSidebar: 'Thu gọn thanh bên',
    expandSidebar: 'Mở rộng thanh bên',
    refreshPage: 'Làm mới trang',
    toggleTheme: 'Đổi giao diện Sáng / Tối',
    copyText: 'Sao chép',
    mlLabel: 'ML Engine',
    mlOnline: 'Đang chạy',
    mlOffline: 'Chưa chạy',
    sshLabel: 'SSH',
    sshOnline: 'Đã kết nối',
    sshIdle: 'Sẵn sàng',
    autoRollbackTitle: 'Tự động rollback đã kích hoạt',
    autoRollbackBody: (fromVersion, toVersion, method) =>
      `Hệ thống đã tự động khôi phục từ v${fromVersion} về v${toVersion} theo cảnh báo từ ${method}.`
  },
  en: {
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',
    refreshPage: 'Refresh view',
    toggleTheme: 'Switch Light / Dark theme',
    copyText: 'Copy',
    mlLabel: 'ML Engine',
    mlOnline: 'Running',
    mlOffline: 'Offline',
    sshLabel: 'SSH',
    sshOnline: 'Connected',
    sshIdle: 'Idle',
    autoRollbackTitle: 'Automatic rollback triggered',
    autoRollbackBody: (fromVersion, toVersion, method) =>
      `Rolled back automatically from v${fromVersion} to v${toVersion} after ${method} anomaly alerts.`
  },
  cn: {
    collapseSidebar: '收起侧边栏',
    expandSidebar: '展开侧边栏',
    refreshPage: '刷新视图',
    toggleTheme: '切换浅色 / 深色主题',
    copyText: '复制',
    mlLabel: 'ML 引擎',
    mlOnline: '运行中',
    mlOffline: '未运行',
    sshLabel: 'SSH',
    sshOnline: '已连接',
    sshIdle: '空闲',
    autoRollbackTitle: '已触发自动回滚',
    autoRollbackBody: (fromVersion, toVersion, method) =>
      `因 ${method} 持续告警，已自动从 v${fromVersion} 回滚到 v${toVersion}。`
  },
  jp: {
    collapseSidebar: 'サイドバーを折りたたむ',
    expandSidebar: 'サイドバーを展開',
    refreshPage: '表示を更新',
    toggleTheme: 'ライト / ダーク切替',
    copyText: 'コピー',
    mlLabel: 'ML エンジン',
    mlOnline: '稼働中',
    mlOffline: '停止',
    sshLabel: 'SSH',
    sshOnline: '接続中',
    sshIdle: '待機中',
    autoRollbackTitle: '自動ロールバックを実行しました',
    autoRollbackBody: (fromVersion, toVersion, method) =>
      `${method} の異常検知により v${fromVersion} から v${toVersion} へ自動復旧しました。`
  }
}

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
  const [notificationApi, notificationContextHolder] = notification.useNotification()
  const strings = useStrings()

  const themeMode = useUiState((state) => state.theme)
  const setTheme = useUiState((state) => state.setTheme)
  const locale = useUiState((state) => state.locale)
  const rawActivePage = useUiState((state) => state.activePage)
  const selectedAppId = useUiState((state) => state.selectedAppId)
  const sidebarCollapsed = useUiState((state) => state.sidebarCollapsed)
  const toggleSidebarCollapsed = useUiState((state) => state.toggleSidebarCollapsed)
  const setActivePage = useUiState((state) => state.setActivePage)

  const [mlRunning, setMlRunning] = useState<boolean | null>(null)
  const [sshActiveCount, setSshActiveCount] = useState(0)

  const t = LOCALES[locale]
  const shellCopy = SHELL_COPY[locale]
  const page = resolveActivePage(rawActivePage)

  const navItems: Array<{ key: NavPageKey; icon: React.ReactNode; label: string }> = useMemo(
    () => [
      { key: 'dashboard', icon: <DashboardOutlined />, label: t.navigation.dashboard },
      { key: 'apps', icon: <AppstoreOutlined />, label: t.navigation.apps },
      { key: 'vps', icon: <CloudServerOutlined />, label: t.navigation.vps },
      { key: 'activity', icon: <HistoryOutlined />, label: t.navigation.activity },
      { key: 'settings', icon: <SettingOutlined />, label: t.navigation.settings }
    ],
    [
      t.navigation.activity,
      t.navigation.apps,
      t.navigation.dashboard,
      t.navigation.settings,
      t.navigation.vps
    ]
  )

  useEffect(() => {
    applyTheme(themeMode)
    window.api?.invoke('window:set-titlebar-overlay', TITLEBAR_OVERLAY[themeMode]).catch(() => {})
  }, [themeMode])

  useEffect(() => {
    let cancelled = false
    window.api
      ?.invoke('system:ml-status')
      .then((res) => {
        if (!cancelled && res && typeof res === 'object' && 'ok' in res && res.ok) {
          setMlRunning(Boolean((res.data as { running?: boolean } | undefined)?.running))
        }
      })
      .catch(() => {})

    const onlineVps = new Set<number>()
    const offMl = window.api?.on('system:ml-status', (payload) => {
      if (payload && typeof payload === 'object' && 'running' in payload) {
        setMlRunning(Boolean(payload.running))
      }
    })
    const offSsh = window.api?.on('system:ssh-status', (payload) => {
      if (payload && typeof payload === 'object' && 'vps_id' in payload && 'status' in payload) {
        if (payload.status === 'online') onlineVps.add(payload.vps_id)
        else onlineVps.delete(payload.vps_id)
        setSshActiveCount(onlineVps.size)
      }
    })

    const offAutoRollback = window.api?.on('system:auto-rollback', (payload) => {
      if (payload && typeof payload === 'object' && 'from_version' in payload) {
        const copy = SHELL_COPY[useUiState.getState().locale]
        notificationApi.warning({
          message: copy.autoRollbackTitle,
          description: copy.autoRollbackBody(
            payload.from_version,
            payload.to_version,
            payload.method
          ),
          duration: 0,
          placement: 'topRight'
        })
      }
    })

    return () => {
      cancelled = true
      offMl?.()
      offSsh?.()
      offAutoRollback?.()
    }
  }, [notificationApi])

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

  const handleDeployClick = useCallback(async (): Promise<void> => {
    const requestId = ++deployRequestIdRef.current
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
  }, [messageApi, setActivePage, strings])

  const triggerRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('opspilot:refresh'))
  }, [])

  // Phím tắt desktop: Ctrl+1..5 chuyển tab, Ctrl+B thu gọn sidebar, Ctrl+N deploy, Ctrl+R làm mới
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      const isEditable =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (isEditable) return

      const key = event.key.toLowerCase()
      if (key === 'b') {
        event.preventDefault()
        toggleSidebarCollapsed()
        return
      }
      if (key === 'n') {
        event.preventDefault()
        void handleDeployClick()
        return
      }
      if (key === 'r' && !event.shiftKey) {
        event.preventDefault()
        triggerRefresh()
        return
      }
      const pageMap: Record<string, NavPageKey> = {
        '1': 'dashboard',
        '2': 'apps',
        '3': 'vps',
        '4': 'activity',
        '5': 'settings'
      }
      if (pageMap[key]) {
        event.preventDefault()
        setActivePage(pageMap[key])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleDeployClick, setActivePage, toggleSidebarCollapsed, triggerRefresh])

  const buildGlobalContextItems = useCallback(
    (selectedText: string): ContextMenuItem[] => {
      const items: ContextMenuItem[] = []
      if (selectedText) {
        items.push({
          key: 'copy',
          label: shellCopy.copyText,
          icon: <CopyOutlined />,
          shortcut: 'Ctrl+C',
          onClick: () => {
            if (navigator.clipboard) void navigator.clipboard.writeText(selectedText)
          }
        })
        items.push({ type: 'divider', key: 'div-copy' })
      }
      items.push(
        {
          key: 'deploy',
          label: t.navigation.deployAction,
          icon: <PlusOutlined />,
          shortcut: 'Ctrl+N',
          onClick: () => void handleDeployClick()
        },
        {
          key: 'refresh',
          label: shellCopy.refreshPage,
          icon: <ReloadOutlined />,
          shortcut: 'Ctrl+R',
          onClick: triggerRefresh
        },
        { type: 'divider', key: 'div-nav' },
        ...navItems.map((item, idx) => ({
          key: `nav-${item.key}`,
          label: item.label,
          icon: item.icon,
          shortcut: `Ctrl+${idx + 1}`,
          onClick: () => setActivePage(item.key)
        })),
        { type: 'divider', key: 'div-prefs' },
        {
          key: 'toggle-sidebar',
          label: sidebarCollapsed ? shellCopy.expandSidebar : shellCopy.collapseSidebar,
          icon: sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />,
          shortcut: 'Ctrl+B',
          onClick: toggleSidebarCollapsed
        },
        {
          key: 'toggle-theme',
          label: shellCopy.toggleTheme,
          icon: <BgColorsOutlined />,
          onClick: () => setTheme(themeMode === 'dark' ? 'light' : 'dark')
        }
      )
      return items
    },
    [
      handleDeployClick,
      navItems,
      setActivePage,
      setTheme,
      shellCopy,
      sidebarCollapsed,
      t.navigation.deployAction,
      themeMode,
      toggleSidebarCollapsed,
      triggerRefresh
    ]
  )

  return (
    <ConfigProvider theme={themeTokens[themeMode]} locale={ANTD_LOCALES[locale]}>
      <AntApp>
        {messageContextHolder}
        {notificationContextHolder}
        <ContextMenuProvider fallbackItems={buildGlobalContextItems}>
          <div className="app-window">
            <AppTitleBar />
            <div className="app-shell">
              <aside
                className={`app-sidebar${sidebarCollapsed ? ' app-sidebar-collapsed' : ''}`}
                aria-label="Điều hướng chính"
              >
                <div className="app-sidebar-action">
                  <Tooltip
                    title={sidebarCollapsed ? `${t.navigation.deployAction} (Ctrl+N)` : undefined}
                    placement="right"
                  >
                    <button
                      type="button"
                      className="app-sidebar-deploy-btn"
                      onClick={() => void handleDeployClick()}
                      aria-label={t.navigation.deployAction}
                    >
                      <PlusOutlined className="app-sidebar-deploy-icon" />
                      {!sidebarCollapsed && <span>{t.navigation.deployAction}</span>}
                    </button>
                  </Tooltip>
                </div>

                <nav className="app-sidebar-nav" aria-label="Khu vực điều hướng chính">
                  {navItems.map((item, idx) => (
                    <Tooltip
                      key={item.key}
                      title={sidebarCollapsed ? `${item.label} (Ctrl+${idx + 1})` : undefined}
                      placement="right"
                    >
                      <button
                        className={`app-sidebar-item${item.key === page ? ' app-sidebar-item-active' : ''}`}
                        type="button"
                        aria-label={item.label}
                        aria-current={item.key === page ? 'page' : undefined}
                        onClick={() => setActivePage(item.key)}
                      >
                        <span className="app-sidebar-item-icon">{item.icon}</span>
                        {!sidebarCollapsed && (
                          <span className="app-sidebar-item-label">{item.label}</span>
                        )}
                        {item.key === page && <span className="app-sidebar-item-pill" />}
                      </button>
                    </Tooltip>
                  ))}
                </nav>

                <div className="app-sidebar-live" aria-label="Trạng thái tiến trình nền">
                  <Tooltip
                    title={`${shellCopy.mlLabel}: ${mlRunning ? shellCopy.mlOnline : shellCopy.mlOffline}`}
                    placement="right"
                  >
                    <div className="app-sidebar-live-row">
                      <span
                        className={`status-dot ${
                          mlRunning === true
                            ? 'status-dot-success'
                            : mlRunning === false
                              ? 'status-dot-danger'
                              : 'status-dot-neutral'
                        }`}
                      />
                      {!sidebarCollapsed && (
                        <>
                          <span className="app-sidebar-live-name">{shellCopy.mlLabel}</span>
                          <span className="app-sidebar-live-val">
                            {mlRunning === true
                              ? shellCopy.mlOnline
                              : mlRunning === false
                                ? shellCopy.mlOffline
                                : '—'}
                          </span>
                        </>
                      )}
                    </div>
                  </Tooltip>
                  <Tooltip
                    title={`${shellCopy.sshLabel}: ${sshActiveCount > 0 ? `${shellCopy.sshOnline} (${sshActiveCount})` : shellCopy.sshIdle}`}
                    placement="right"
                  >
                    <div className="app-sidebar-live-row">
                      <span
                        className={`status-dot ${
                          sshActiveCount > 0 ? 'status-dot-info' : 'status-dot-neutral'
                        }`}
                      />
                      {!sidebarCollapsed && (
                        <>
                          <span className="app-sidebar-live-name">{shellCopy.sshLabel}</span>
                          <span className="app-sidebar-live-val">
                            {sshActiveCount > 0 ? `${sshActiveCount}` : shellCopy.sshIdle}
                          </span>
                        </>
                      )}
                    </div>
                  </Tooltip>
                </div>
              </aside>

              <Tooltip
                title={`${sidebarCollapsed ? shellCopy.expandSidebar : shellCopy.collapseSidebar} (Ctrl+B)`}
                placement="right"
              >
                <button
                  type="button"
                  className="app-sidebar-collapse-btn"
                  aria-label={
                    sidebarCollapsed ? shellCopy.expandSidebar : shellCopy.collapseSidebar
                  }
                  onClick={toggleSidebarCollapsed}
                >
                  {sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                </button>
              </Tooltip>

              <main className="app-main">
                <div className="content" data-page-key={page}>
                  <div key={page} className="page-transition">
                    {renderPage(page, setActivePage)}
                  </div>
                </div>
              </main>
            </div>
          </div>
        </ContextMenuProvider>
      </AntApp>
    </ConfigProvider>
  )
}

export default App
