import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  MedicineBoxOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  RollbackOutlined,
  SearchOutlined
} from '@ant-design/icons'
import {
  App as AntApp,
  Alert,
  Button,
  Descriptions,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'antd'

import type { App, Deployment, Vps } from '@shared/ipc'
import { PageHeader } from '../components/PageHeader'
import { useUiState } from '../store/uiState'
import { useVpsStore } from '../store/vpsStore'
import { useStrings } from '../strings'
import { localDateTime, relativeTime } from '../utils/format'
import { evaluateVpsStatus } from '../vpsResources'

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m${seconds}s`
  return `${seconds}s`
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleString()
  } catch {
    return isoString
  }
}

function getRuntimeTagColor(state?: string): 'success' | 'error' | 'warning' | 'default' {
  if (!state) return 'default'
  const norm = state.toLowerCase().trim()
  if (norm === 'running') return 'success'
  if (norm === 'exited' || norm === 'dead') return 'error'
  if (norm === 'restarting' || norm === 'paused') return 'warning'
  return 'default'
}

export function AppsPage(): React.JSX.Element {
  const { modal } = AntApp.useApp()
  const strings = useStrings()

  const selectedAppId = useUiState((state) => state.selectedAppId)
  const setSelectedAppId = useUiState((state) => state.setSelectedAppId)
  const setDeployPreselect = useUiState((state) => state.setDeployPreselect)
  const setActivePage = useUiState((state) => state.setActivePage)
  const setSelectedVpsId = useUiState((state) => state.setSelectedVpsId)

  const [apps, setApps] = useState<App[]>([])
  const [vpsList, setVpsList] = useState<Vps[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedAppId, setLoadedAppId] = useState<number | null>(null)
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [deploymentsLoading, setDeploymentsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [search, setSearch] = useState('')
  const [vpsFilter, setVpsFilter] = useState('all')

  const [doctorBusy, setDoctorBusy] = useState(false)
  const [doctorMessage, setDoctorMessage] = useState<string | null>(null)
  const [doctorFixId, setDoctorFixId] = useState<string | null>(null)
  const [doctorSafeToFix, setDoctorSafeToFix] = useState(false)

  const [rollbackTarget, setRollbackTarget] = useState<Deployment | null>(null)
  const [confirmInput, setConfirmInput] = useState('')
  const [rollbackBusy, setRollbackBusy] = useState(false)
  const [appsError, setAppsError] = useState<string | null>(null)
  const [versionsError, setVersionsError] = useState<string | null>(null)

  const vpsResources = useVpsStore((state) => state.resources)
  const [liveInspectState, setLiveInspectState] = useState<{
    status: 'idle' | 'checking' | 'success' | 'unverified'
    state?: string
    image?: string
    error?: string
    checkedAt?: number
  }>({ status: 'idle' })

  const activeAppIdRef = useRef<number | null>(null)
  const doctorReqIdRef = useRef(0)
  const rollbackReqIdRef = useRef(0)

  const selectApp = (id: number | null): void => {
    if (id === selectedAppId) return
    activeAppIdRef.current = id
    doctorReqIdRef.current++
    rollbackReqIdRef.current++
    setSelectedAppId(id)
    setLoadedAppId(null)
    setDeployments([])
    setDeploymentsLoading(id !== null)
    setVersionsError(null)
    // Xóa trạng thái Doctor/rollback/inspect cũ
    setDoctorBusy(false)
    setDoctorMessage(null)
    setDoctorFixId(null)
    setDoctorSafeToFix(false)
    setRollbackTarget(null)
    setConfirmInput('')
    setRollbackBusy(false)
    setLiveInspectState({ status: 'idle' })
  }

  const inspectLive = useCallback(async (): Promise<void> => {
    if (selectedAppId === null) return
    const targetAppId = selectedAppId
    setLiveInspectState({ status: 'checking' })
    try {
      const res = await window.api.invoke('app:runtime-inspect', targetAppId)
      if (activeAppIdRef.current !== targetAppId) return
      const checkedAt = Date.now()
      if (res.ok) {
        setLiveInspectState({
          status: 'success',
          state: res.data.state,
          image: res.data.image,
          checkedAt
        })
      } else {
        setLiveInspectState({
          status: 'unverified',
          error: res.error.message,
          checkedAt
        })
      }
    } catch (err: unknown) {
      if (activeAppIdRef.current !== targetAppId) return
      setLiveInspectState({
        status: 'unverified',
        error: err instanceof Error ? err.message : String(err),
        checkedAt: Date.now()
      })
    }
  }, [selectedAppId])

  const reloadVersions = useCallback(
    async (appId: number): Promise<void> => {
      if (activeAppIdRef.current !== appId) return
      setDeploymentsLoading(true)
      setVersionsError(null)
      try {
        const res = await window.api.invoke('app:versions', appId)
        if (activeAppIdRef.current !== appId) return
        if (res.ok) {
          const matching = res.data.filter((dep: Deployment) => dep.app_id === appId)
          setDeployments(matching)
          setVersionsError(null)
        } else {
          setDeployments([])
          setVersionsError(res.error?.message || strings.apps.versionsLoadError)
        }
        setLoadedAppId(appId)
      } finally {
        if (activeAppIdRef.current === appId) {
          setDeploymentsLoading(false)
        }
      }
    },
    [strings]
  )

  const refreshData = useCallback(
    async (appId?: number): Promise<void> => {
      const targetId = appId ?? activeAppIdRef.current
      setLoading(true)
      setAppsError(null)
      const [appRes, vpsRes] = await Promise.all([
        window.api.invoke('app:list'),
        window.api.invoke('vps:list')
      ])
      if (vpsRes.ok) setVpsList(vpsRes.data)
      if (appRes.ok) {
        setApps(appRes.data)
        setAppsError(null)
      } else {
        setApps([])
        setAppsError(appRes.error?.message || strings.apps.loadError)
      }
      if (targetId !== null) {
        const res = await window.api.invoke('app:versions', targetId)
        if (activeAppIdRef.current === targetId) {
          if (res.ok) {
            setDeployments(res.data.filter((d: Deployment) => d.app_id === targetId))
            setVersionsError(null)
          } else {
            setDeployments([])
            setVersionsError(res.error?.message || strings.apps.versionsLoadError)
          }
          setLoadedAppId(targetId)
        }
      }
      setLoading(false)
    },
    [strings]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [appRes, vpsRes] = await Promise.all([
        window.api.invoke('app:list'),
        window.api.invoke('vps:list')
      ])
      if (cancelled) return
      if (vpsRes.ok) setVpsList(vpsRes.data)
      if (appRes.ok) {
        setApps(appRes.data)
        setAppsError(null)
        if (selectedAppId !== null && !appRes.data.some((a) => a.id === selectedAppId)) {
          setSelectedAppId(null)
          activeAppIdRef.current = null
        }
      } else {
        setApps([])
        setAppsError(appRes.error?.message || strings.apps.loadError)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedAppId, setSelectedAppId, strings])

  useEffect(() => {
    if (selectedAppId === null) {
      activeAppIdRef.current = null
      return
    }
    let cancelled = false
    const reqAppId = selectedAppId
    activeAppIdRef.current = reqAppId

    void (async () => {
      setVersionsError(null)
      setDeploymentsLoading(true)
      try {
        const res = await window.api.invoke('app:versions', reqAppId)
        // Bỏ qua response app:versions đến muộn nếu đã chuyển sang app khác hoặc effect bị huỷ
        if (cancelled || activeAppIdRef.current !== reqAppId) {
          return
        }
        if (res.ok) {
          const matching = res.data.filter((dep: Deployment) => dep.app_id === reqAppId)
          setDeployments(matching)
          setVersionsError(null)
        } else {
          setDeployments([])
          setVersionsError(res.error?.message || strings.apps.versionsLoadError)
        }
        setLoadedAppId(reqAppId)
      } finally {
        if (!cancelled && activeAppIdRef.current === reqAppId) {
          setDeploymentsLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedAppId, strings])

  const isVersionsReady =
    !deploymentsLoading &&
    loadedAppId !== null &&
    selectedAppId !== null &&
    loadedAppId === selectedAppId
  const isVersionsLoading = !isVersionsReady

  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? null
  const selectedVps = vpsList.find((vps) => vps.id === selectedApp?.vps_id) ?? null

  // Gắn danh sách deployment với đúng app đang chọn, BỎ fallback dùng deployment của app trước
  const currentAppDeployments =
    selectedApp && isVersionsReady ? deployments.filter((dep) => dep.app_id === selectedApp.id) : []

  const activeDeployment =
    selectedApp && isVersionsReady && selectedApp.current_deployment_id !== null
      ? (currentAppDeployments.find((dep) => dep.id === selectedApp.current_deployment_id) ?? null)
      : null

  const hasCurrentDeploymentMismatch =
    selectedApp !== null &&
    isVersionsReady &&
    !versionsError &&
    selectedApp.current_deployment_id !== null &&
    activeDeployment === null

  const isVpsStale =
    selectedVps !== null
      ? evaluateVpsStatus(selectedVps, vpsResources[selectedVps.id]).key === 'stale'
      : false

  const isRunning = isVersionsReady && activeDeployment?.status === 'running'
  const isRollbackAllowed =
    selectedApp !== null &&
    isVersionsReady &&
    !rollbackBusy &&
    rollbackTarget !== null &&
    rollbackTarget.app_id === selectedApp.id &&
    (!isRunning || confirmInput.trim() === selectedApp.name)

  const filteredApps = apps.filter((app) => {
    const query = search.trim().toLowerCase()
    const vps = vpsList.find((v) => v.id === app.vps_id)
    const host = vps?.host ?? ''
    const vpsName = vps?.name ?? ''
    const matchesSearch =
      !query ||
      `${app.name} ${app.framework} ${host} ${vpsName} ${app.host_port}`
        .toLowerCase()
        .includes(query)
    const matchesVps = vpsFilter === 'all' || String(app.vps_id) === vpsFilter
    return matchesSearch && matchesVps
  })

  function openRollback(dep: Deployment): void {
    if (isVersionsLoading || !selectedApp || dep.app_id !== selectedApp.id) return
    setRollbackTarget(dep)
    setConfirmInput('')
  }

  async function executeRollback(): Promise<void> {
    if (
      !selectedApp ||
      !rollbackTarget ||
      isVersionsLoading ||
      rollbackTarget.app_id !== selectedApp.id
    )
      return
    const targetAppId = selectedApp.id
    const reqId = ++rollbackReqIdRef.current
    setRollbackBusy(true)
    const result = await window.api.invoke('app:rollback', selectedApp.id, rollbackTarget.id)
    if (activeAppIdRef.current !== targetAppId || rollbackReqIdRef.current !== reqId) {
      return
    }
    setRollbackBusy(false)
    setRollbackTarget(null)
    if (result.ok) {
      modal.success({
        title: strings.apps.rollbackSuccess,
        content: `Deployment #${result.data.deployment_id}`
      })
      await refreshData(targetAppId)
    } else {
      modal.error({
        title: strings.apps.rollbackFailed,
        content: result.error.message
      })
    }
  }

  async function runDoctor(): Promise<void> {
    if (
      !activeDeployment ||
      isVersionsLoading ||
      !selectedApp ||
      activeDeployment.app_id !== selectedApp.id
    )
      return
    const targetAppId = selectedApp.id
    const reqId = ++doctorReqIdRef.current
    setDoctorBusy(true)
    setDoctorMessage(null)
    const result = await window.api.invoke('doctor:diagnose', {
      deployment_id: activeDeployment.id,
      evidence: {
        external_probe: activeDeployment.exposure_status === 'degraded' ? 'unreachable' : undefined,
        container_state: {
          status: activeDeployment.status === 'running' ? 'running' : 'failed'
        }
      }
    })
    // Bỏ qua kết quả Doctor đến muộn sau khi đổi app: không để fix ID hoặc thông báo của A xuất hiện trên B
    if (activeAppIdRef.current !== targetAppId || doctorReqIdRef.current !== reqId) {
      return
    }
    setDoctorBusy(false)
    if (!result.ok) {
      setDoctorMessage(result.error.message)
      return
    }
    setDoctorFixId(result.data.fix_id)
    setDoctorSafeToFix(result.data.safe_to_auto_fix)
    const evidenceDetails =
      result.data.evidence.length > 0 ? ` — ${result.data.evidence.join('; ')}` : ''
    setDoctorMessage(`${result.data.title} (${result.data.confidence})${evidenceDetails}`)
  }

  async function fixWithDoctor(): Promise<void> {
    if (
      !doctorFixId ||
      !activeDeployment ||
      !selectedApp ||
      isVersionsLoading ||
      activeDeployment.app_id !== selectedApp.id
    )
      return
    const targetAppId = selectedApp.id
    const reqId = ++doctorReqIdRef.current
    setDoctorBusy(true)
    const result = await window.api.invoke('doctor:fix', {
      fix_id: doctorFixId,
      deployment_id: activeDeployment.id
    })
    // Bỏ qua kết quả Doctor fix đến muộn sau khi đổi app
    if (activeAppIdRef.current !== targetAppId || doctorReqIdRef.current !== reqId) {
      return
    }
    setDoctorBusy(false)
    if (!result.ok) {
      setDoctorMessage(result.error.message)
    } else {
      setDoctorMessage(result.data.message)
      if (result.data.status === 'verified') {
        setDoctorSafeToFix(false)
        await refreshData(targetAppId)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW 1: TOÀN CHIỀU RỘNG DANH SÁCH ỨNG DỤNG (LIST VIEW)
  // ─────────────────────────────────────────────────────────────────────────────
  if (!selectedApp) {
    return (
      <section className="page-panel apps-page">
        <PageHeader
          title={strings.apps.title}
          description={strings.apps.description}
          actions={
            <Space>
              <span className="desktop-pagebar-count">
                <span className="status-dot status-dot-info" aria-hidden="true" />
                {strings.apps.count(apps.length)}
              </span>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void refreshData()}
                disabled={loading}
              >
                {strings.common.refresh}
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setDeployPreselect(null)
                  setActivePage('deploy')
                }}
              >
                {strings.apps.deployAction}
              </Button>
            </Space>
          }
        />

        <div
          className="apps-list-toolbar"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 16,
            flexWrap: 'wrap'
          }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}
          >
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder={strings.apps.searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ maxWidth: 300 }}
            />
            <Select
              value={vpsFilter}
              onChange={setVpsFilter}
              style={{ minWidth: 220 }}
              options={[
                { value: 'all', label: `${strings.apps.allVps} (${vpsList.length})` },
                ...vpsList.map((v) => ({
                  value: String(v.id),
                  label: `${v.name} (${v.host})`
                }))
              ]}
            />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {strings.apps.countDisplay(filteredApps.length, apps.length)}
          </Typography.Text>
        </div>

        {appsError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={strings.apps.loadError}
            description={appsError}
            action={
              <Button size="small" danger onClick={() => void refreshData()}>
                {strings.common.retry}
              </Button>
            }
          />
        )}

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin size="default" />
          </div>
        ) : (
          <Table<App>
            rowKey="id"
            size="middle"
            dataSource={filteredApps}
            pagination={false}
            locale={{ emptyText: strings.apps.empty }}
            onRow={(app) => ({
              onClick: () => selectApp(app.id),
              style: { cursor: 'pointer' }
            })}
            columns={[
              {
                title: strings.apps.appName,
                dataIndex: 'name',
                key: 'name',
                render: (name: string, app: App) => (
                  <div>
                    <Typography.Link
                      strong
                      onClick={(e) => {
                        e.stopPropagation()
                        selectApp(app.id)
                      }}
                    >
                      {name}
                    </Typography.Link>
                    <div
                      className="mono-text"
                      style={{ fontSize: 11, color: 'var(--text-secondary)' }}
                    >
                      {app.url}
                    </div>
                  </div>
                )
              },
              {
                title: strings.apps.framework,
                dataIndex: 'framework',
                key: 'framework',
                width: 130,
                render: (framework: string) => <Tag>{framework}</Tag>
              },
              {
                title: strings.apps.recordedTitle,
                key: 'status',
                width: 170,
                render: (_: unknown, app: App) => (
                  <Tag color={app.current_deployment_id ? 'blue' : 'default'}>
                    <span
                      className={`status-dot status-dot-${app.current_deployment_id ? 'info' : 'neutral'}`}
                      style={{ marginRight: 6 }}
                    />
                    {app.current_deployment_id
                      ? strings.apps.statusRecordedDeployed
                      : strings.apps.statusNotDeployed}
                  </Tag>
                )
              },
              {
                title: strings.apps.deploymentIdTitle,
                key: 'deployment_id',
                width: 130,
                render: (_: unknown, app: App) => (
                  <span className="mono-text">
                    {app.current_deployment_id ? `#${app.current_deployment_id}` : '—'}
                  </span>
                )
              },
              {
                title: strings.apps.vpsHost,
                key: 'vps',
                width: 200,
                render: (_: unknown, app: App) => {
                  const vps = vpsList.find((v) => v.id === app.vps_id)
                  return vps ? (
                    <Space size={6}>
                      <CloudServerOutlined style={{ color: 'var(--accent)' }} />
                      <span className="mono-text">
                        {vps.name} ({vps.host})
                      </span>
                    </Space>
                  ) : (
                    '—'
                  )
                }
              },
              {
                title: strings.apps.port,
                key: 'port',
                width: 100,
                render: (_: unknown, app: App) => (
                  <span className="mono-text">:{app.host_port}</span>
                )
              },
              {
                title: strings.vpsControl.apps.columns.actions,
                key: 'actions',
                width: 170,
                align: 'right',
                render: (_: unknown, app: App) => (
                  <Space size="small" onClick={(e) => e.stopPropagation()}>
                    <Button size="small" onClick={() => selectApp(app.id)}>
                      {strings.apps.viewDetail}
                    </Button>
                    <Button
                      size="small"
                      icon={<RocketOutlined />}
                      onClick={() => {
                        setDeployPreselect({ vpsId: app.vps_id, appId: app.id })
                        setActivePage('deploy')
                      }}
                    >
                      {strings.apps.deployAction}
                    </Button>
                  </Space>
                )
              }
            ]}
          />
        )}
      </section>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW 2: TOÀN CHIỀU RỘNG TRANG CHI TIẾT ỨNG DỤNG (DETAIL VIEW)
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <section className="page-panel apps-page">
      <div
        className="panel-detail-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <Space size="middle" align="center">
          <Tooltip title={strings.apps.backToList}>
            <Button
              type="text"
              data-testid="app-detail-back-btn"
              icon={<ArrowLeftOutlined />}
              aria-label={strings.apps.backToList}
              onClick={() => selectApp(null)}
            />
          </Tooltip>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {selectedApp.name}
              </Typography.Title>
              <span
                className={`apps-status apps-status-${activeDeployment ? 'info' : versionsError ? 'error' : 'neutral'}`}
              >
                <span
                  className={`status-dot status-dot-${activeDeployment ? 'info' : versionsError ? 'error' : 'neutral'}`}
                />
                {isVersionsLoading
                  ? strings.apps.loadingVersions
                  : versionsError
                    ? strings.apps.versionsLoadError
                    : activeDeployment
                      ? strings.apps.recordedStatus(
                          activeDeployment.status,
                          activeDeployment.version
                        )
                      : selectedApp.current_deployment_id === null
                        ? strings.apps.statusNotDeployed
                        : strings.apps.currentDeploymentNotFound}
              </span>
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <span>{selectedApp.framework}</span>
              <span style={{ margin: '0 8px' }}>·</span>
              <span className="mono-text">{selectedApp.url}</span>
              {selectedVps && (
                <>
                  <span style={{ margin: '0 8px' }}>·</span>
                  <span>
                    {selectedVps.name} ({selectedVps.host})
                  </span>
                </>
              )}
            </Typography.Text>
          </div>
        </Space>
        <Space>
          {selectedVps && (
            <Button
              onClick={() => {
                setSelectedVpsId(selectedVps.id)
                setActivePage('vps')
              }}
            >
              {strings.apps.viewVps}
            </Button>
          )}
          <Button
            type="primary"
            icon={<RocketOutlined />}
            onClick={() => {
              setDeployPreselect({ vpsId: selectedApp.vps_id, appId: selectedApp.id })
              setActivePage('deploy')
            }}
          >
            {strings.apps.deployNewVersion}
          </Button>
        </Space>
      </div>

      <div className="apps-kpi-grid">
        <div className="apps-kpi">
          <span className="apps-kpi-label">{strings.apps.recordedTitle}</span>
          <strong className="apps-kpi-value">
            {isVersionsLoading ? (
              <Spin size="small" />
            ) : versionsError ? (
              <span style={{ color: 'var(--error)' }}>{strings.apps.versionsLoadError}</span>
            ) : activeDeployment ? (
              <>
                <span
                  className={`status-dot status-dot-${activeDeployment.status === 'running' ? 'info' : 'neutral'}`}
                />
                {activeDeployment.status} (v{activeDeployment.version})
              </>
            ) : selectedApp.current_deployment_id === null ? (
              strings.apps.statusNotDeployed
            ) : (
              strings.apps.currentDeploymentNotFound
            )}
          </strong>
        </div>
        <div className="apps-kpi">
          <span className="apps-kpi-label">{strings.apps.lastDeploy}</span>
          <strong className="apps-kpi-value">
            {isVersionsLoading ? (
              <Spin size="small" />
            ) : activeDeployment?.started_at ? (
              formatTime(activeDeployment.started_at)
            ) : (
              '—'
            )}
          </strong>
        </div>
        <div className="apps-kpi">
          <span className="apps-kpi-label">{strings.apps.vpsHost}</span>
          <strong className="apps-kpi-value mono-text">
            {selectedVps ? `${selectedVps.name} (${selectedVps.host})` : '—'}
          </strong>
        </div>
        <div className="apps-kpi">
          <span className="apps-kpi-label">{strings.apps.exposurePublishResult}</span>
          <strong className="apps-kpi-value">
            {isVersionsLoading ? (
              <Spin size="small" />
            ) : (
              <Tag
                color={
                  activeDeployment?.exposure_status === 'reachable'
                    ? 'success'
                    : activeDeployment?.exposure_status === 'degraded'
                      ? 'warning'
                      : activeDeployment?.exposure_status === 'tunnel_only'
                        ? 'blue'
                        : 'default'
                }
              >
                {activeDeployment
                  ? strings.apps.exposureStatus[activeDeployment.exposure_status]
                  : strings.apps.exposureStatus.not_checked}
              </Tag>
            )}
          </strong>
        </div>
      </div>

      {versionsError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={strings.apps.versionsLoadError}
          description={versionsError}
          action={
            <Button size="small" danger onClick={() => void reloadVersions(selectedApp.id)}>
              {strings.common.retry}
            </Button>
          }
        />
      )}

      {hasCurrentDeploymentMismatch && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={strings.apps.currentDeploymentNotFound}
          description={strings.apps.currentDeploymentMismatchDesc(
            selectedApp.current_deployment_id!
          )}
        />
      )}

      {isVpsStale && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={strings.apps.vpsStaleNotice}
        />
      )}

      {!isVersionsLoading && activeDeployment?.exposure_status === 'degraded' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={strings.apps.exposureDegradedAlert}
          description={
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              {activeDeployment.exposure_evidence_json && (
                <Typography.Text type="secondary" className="mono-text" style={{ fontSize: 12 }}>
                  {activeDeployment.exposure_evidence_json}
                </Typography.Text>
              )}
              {doctorMessage && <Typography.Text>{doctorMessage}</Typography.Text>}
            </Space>
          }
          action={
            <Space>
              <Button
                loading={doctorBusy}
                disabled={isVersionsLoading}
                icon={<ReloadOutlined />}
                onClick={() => void runDoctor()}
              >
                {strings.apps.doctorDiagnose}
              </Button>
              {doctorSafeToFix && doctorFixId && (
                <Button
                  type="primary"
                  loading={doctorBusy}
                  disabled={isVersionsLoading}
                  onClick={() => void fixWithDoctor()}
                >
                  {strings.apps.doctorAutoFix}
                </Button>
              )}
            </Space>
          }
        />
      )}

      <Tabs
        className="apps-tabs"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'overview',
            label: (
              <Space size={6}>
                <InfoCircleOutlined />
                <span>{strings.apps.tabs.overview}</span>
              </Space>
            ),
            children: (
              <div className="apps-tab-content">
                <div className="apps-section-heading">
                  <div>
                    <h3>{strings.apps.runtimeInfo}</h3>
                  </div>
                  <span className="apps-section-note">{strings.apps.runtimeSync}</span>
                </div>
                <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
                  <Descriptions.Item label={strings.apps.appName}>
                    {selectedApp.name}
                  </Descriptions.Item>
                  <Descriptions.Item label={strings.apps.framework}>
                    <span className="mono-text">{selectedApp.framework}</span>
                  </Descriptions.Item>
                  <Descriptions.Item label={strings.apps.vps}>
                    <Space size={6}>
                      <CloudServerOutlined className="text-info" />
                      <span className="mono-text">
                        {selectedVps ? `${selectedVps.name} (${selectedVps.host})` : '—'}
                      </span>
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label={strings.apps.url}>
                    <Button
                      type="link"
                      style={{ padding: 0 }}
                      onClick={() =>
                        void window.api.invoke('system:open-external', selectedApp.url)
                      }
                    >
                      {selectedApp.url}
                    </Button>
                  </Descriptions.Item>
                  <Descriptions.Item label={strings.apps.port}>
                    <span className="mono-text">
                      {strings.apps.portBinding(selectedApp.host_port, selectedApp.container_port)}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label={strings.apps.healthcheck}>
                    <span className="mono-text">{selectedApp.healthcheck_path}</span>
                  </Descriptions.Item>
                  <Descriptions.Item label={strings.apps.db}>
                    {selectedApp.needs_db ? strings.apps.dbYes : strings.apps.dbNo}
                  </Descriptions.Item>
                  <Descriptions.Item label={strings.apps.runtime}>
                    <Space size="small" wrap align="center">
                      {liveInspectState.status === 'idle' && (
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          onClick={() => void inspectLive()}
                        >
                          {strings.apps.inspectLive}
                        </Button>
                      )}
                      {liveInspectState.status === 'checking' && (
                        <Tag color="processing">
                          <Spin size="small" style={{ marginRight: 6 }} />
                          {strings.vps.status.checking}
                        </Tag>
                      )}
                      {liveInspectState.status === 'success' && (
                        <>
                          <Tag color={getRuntimeTagColor(liveInspectState.state)}>
                            {strings.apps.liveState(liveInspectState.state ?? 'running')}
                          </Tag>
                          {liveInspectState.checkedAt && (
                            <Tooltip
                              title={localDateTime(
                                new Date(liveInspectState.checkedAt).toISOString()
                              )}
                            >
                              <span
                                className="mono-text"
                                style={{ fontSize: 12, color: 'var(--text-secondary)' }}
                              >
                                {relativeTime(new Date(liveInspectState.checkedAt).toISOString())}
                              </span>
                            </Tooltip>
                          )}
                          <Button
                            size="small"
                            type="text"
                            icon={<ReloadOutlined />}
                            aria-label={strings.apps.recheckLive}
                            onClick={() => void inspectLive()}
                          >
                            {strings.apps.recheckLive}
                          </Button>
                        </>
                      )}
                      {liveInspectState.status === 'unverified' && (
                        <>
                          <Tag color="default">{strings.apps.liveUnverified}</Tag>
                          {liveInspectState.checkedAt && (
                            <Tooltip
                              title={localDateTime(
                                new Date(liveInspectState.checkedAt).toISOString()
                              )}
                            >
                              <span
                                className="mono-text"
                                style={{ fontSize: 12, color: 'var(--text-secondary)' }}
                              >
                                {relativeTime(new Date(liveInspectState.checkedAt).toISOString())}
                              </span>
                            </Tooltip>
                          )}
                          <Button
                            size="small"
                            type="text"
                            icon={<ReloadOutlined />}
                            aria-label={strings.apps.recheckLive}
                            onClick={() => void inspectLive()}
                          >
                            {strings.apps.recheckLive}
                          </Button>
                        </>
                      )}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label={strings.apps.exposurePublishResult}>
                    {isVersionsLoading ? (
                      <Spin size="small" />
                    ) : (
                      <Tag
                        color={
                          activeDeployment?.exposure_status === 'reachable'
                            ? 'success'
                            : activeDeployment?.exposure_status === 'degraded'
                              ? 'warning'
                              : 'default'
                        }
                      >
                        {activeDeployment
                          ? strings.apps.exposureStatus[activeDeployment.exposure_status]
                          : strings.apps.exposureStatus.not_checked}
                      </Tag>
                    )}
                  </Descriptions.Item>
                </Descriptions>
              </div>
            )
          },
          {
            key: 'history',
            label: (
              <Space size={6}>
                <HistoryOutlined />
                <span>{strings.apps.tabs.history}</span>
              </Space>
            ),
            children: (
              <div className="apps-tab-content">
                <div className="apps-section-heading">
                  <div>
                    <h3>{strings.apps.versionHistory}</h3>
                  </div>
                  <span className="apps-section-note">
                    {strings.apps.versionCount(currentAppDeployments.length)}
                  </span>
                </div>
                {isVersionsLoading ? (
                  <div style={{ padding: 24, textAlign: 'center' }}>
                    <Space size="middle" direction="vertical" align="center">
                      <Spin size="small" />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {strings.apps.loadingVersions}
                      </Typography.Text>
                    </Space>
                  </div>
                ) : versionsError ? (
                  <div style={{ padding: 16 }}>
                    <Alert
                      type="error"
                      showIcon
                      message={strings.apps.versionsLoadError}
                      description={versionsError}
                      action={
                        <Button
                          size="small"
                          danger
                          onClick={() => void reloadVersions(selectedApp.id)}
                        >
                          {strings.common.retry}
                        </Button>
                      }
                    />
                  </div>
                ) : currentAppDeployments.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center' }}>
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={strings.apps.noDeploymentsYet}
                    />
                  </div>
                ) : (
                  <ol className="apps-version-list">
                    {currentAppDeployments.map((dep) => {
                      const isCurrent = dep.id === selectedApp.current_deployment_id
                      return (
                        <li
                          className={`apps-version-item apps-version-item-${isCurrent ? 'success' : 'neutral'}`}
                          key={dep.id}
                        >
                          <span className="apps-version-marker" aria-hidden="true">
                            {isCurrent ? <CheckCircleOutlined /> : <span />}
                          </span>
                          <div className="apps-version-body">
                            <div className="apps-version-header">
                              <div className="apps-version-title">
                                <strong className="mono-text">v{dep.version}</strong>
                                {isCurrent && <Tag color="blue">{strings.apps.activeVersion}</Tag>}
                                <Tag
                                  color={
                                    dep.status === 'running'
                                      ? 'success'
                                      : dep.status === 'failed'
                                        ? 'error'
                                        : 'default'
                                  }
                                >
                                  {dep.status}
                                </Tag>
                                <Tag
                                  color={
                                    dep.exposure_status === 'reachable'
                                      ? 'success'
                                      : dep.exposure_status === 'degraded'
                                        ? 'warning'
                                        : 'default'
                                  }
                                >
                                  {strings.apps.exposureStatus[dep.exposure_status]}
                                </Tag>
                              </div>
                              {!isCurrent &&
                                dep.status !== 'building' &&
                                dep.status !== 'deploying' && (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    disabled={isVersionsLoading || rollbackBusy}
                                    icon={<RollbackOutlined />}
                                    onClick={() => openRollback(dep)}
                                  >
                                    {strings.apps.rollback}
                                  </Button>
                                )}
                            </div>
                            <div className="apps-version-meta">
                              <span>
                                <ClockCircleOutlined /> {formatTime(dep.started_at)}
                              </span>
                              {dep.total_duration_ms !== null && (
                                <span>
                                  {strings.apps.buildDuration(
                                    formatDuration(dep.total_duration_ms)
                                  )}
                                </span>
                              )}
                              {dep.image_tag && <span>{strings.apps.imageTag(dep.image_tag)}</span>}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </div>
            )
          },
          {
            key: 'doctor',
            label: (
              <Space size={6}>
                <MedicineBoxOutlined />
                <span>{strings.apps.tabs.doctor}</span>
              </Space>
            ),
            children: (
              <div className="apps-tab-content">
                {versionsError && (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={strings.apps.versionsLoadError}
                    description={versionsError}
                    action={
                      <Button
                        size="small"
                        danger
                        onClick={() => void reloadVersions(selectedApp.id)}
                      >
                        {strings.common.retry}
                      </Button>
                    }
                  />
                )}
                <div className="apps-section-heading">
                  <div>
                    <h3>{strings.apps.doctorExposureTitle}</h3>
                  </div>
                  <span className="apps-section-note">{strings.apps.doctorDesc}</span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    gap: 16,
                    marginBottom: 16
                  }}
                >
                  <div
                    className="card"
                    style={{
                      padding: 16,
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: 'var(--bg-panel)'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 12
                      }}
                    >
                      <Typography.Text strong>{strings.apps.exposureTitle}</Typography.Text>
                      <Tag
                        color={
                          activeDeployment?.exposure_status === 'reachable'
                            ? 'success'
                            : activeDeployment?.exposure_status === 'degraded'
                              ? 'warning'
                              : 'default'
                        }
                      >
                        {activeDeployment
                          ? strings.apps.exposureStatus[activeDeployment.exposure_status]
                          : strings.apps.exposureStatus.not_checked}
                      </Tag>
                    </div>
                    {activeDeployment?.exposure_evidence_json ? (
                      <Typography.Paragraph
                        type="secondary"
                        className="mono-text"
                        style={{ fontSize: 12 }}
                      >
                        {activeDeployment.exposure_evidence_json}
                      </Typography.Paragraph>
                    ) : (
                      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                        {strings.apps.runtimeSync}
                      </Typography.Paragraph>
                    )}
                    <Space style={{ marginTop: 8 }}>
                      <Button
                        loading={doctorBusy}
                        disabled={isVersionsLoading || !activeDeployment}
                        icon={<ReloadOutlined />}
                        onClick={() => void runDoctor()}
                      >
                        {strings.apps.doctorDiagnose}
                      </Button>
                      {doctorSafeToFix && doctorFixId && (
                        <Button
                          type="primary"
                          loading={doctorBusy}
                          disabled={isVersionsLoading}
                          onClick={() => void fixWithDoctor()}
                        >
                          {strings.apps.doctorAutoFix}
                        </Button>
                      )}
                    </Space>
                  </div>

                  <div
                    className="card"
                    style={{
                      padding: 16,
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: 'var(--bg-panel)'
                    }}
                  >
                    <div style={{ marginBottom: 12 }}>
                      <Typography.Text strong>
                        {strings.apps.doctorDiagnosticEvidence}
                      </Typography.Text>
                    </div>
                    {doctorMessage ? (
                      <Alert
                        type={doctorSafeToFix ? 'warning' : 'info'}
                        showIcon
                        message={doctorMessage}
                        description={doctorSafeToFix ? strings.apps.doctorAutoFix : undefined}
                      />
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {strings.apps.doctorNotRunYet}
                      </Typography.Text>
                    )}
                  </div>
                </div>
              </div>
            )
          }
        ]}
      />

      {rollbackTarget !== null && (
        <Modal
          open
          destroyOnHidden
          title={
            <Space size={8}>
              <ExclamationCircleOutlined className="text-danger" />
              <span>{strings.apps.rollbackTitle}</span>
            </Space>
          }
          onCancel={() => setRollbackTarget(null)}
          footer={[
            <Button key="cancel" onClick={() => setRollbackTarget(null)}>
              {strings.common.cancel}
            </Button>,
            <Button
              key="confirm"
              type="primary"
              danger
              loading={rollbackBusy}
              disabled={!isRollbackAllowed}
              onClick={() => void executeRollback()}
            >
              {strings.apps.rollbackConfirm}
            </Button>
          ]}
        >
          <Alert
            type="warning"
            showIcon
            message={strings.apps.rollbackWarning(
              activeDeployment ? `v${activeDeployment.version}` : '—',
              `v${rollbackTarget.version}`
            )}
            description={strings.apps.rollbackHint}
            style={{ marginBottom: 16 }}
          />
          {isRunning ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text>{strings.apps.rollbackInputPrompt}</Typography.Text>
              <Input
                autoFocus
                placeholder={selectedApp?.name}
                value={confirmInput}
                onChange={(event) => setConfirmInput(event.target.value)}
                className="mono-input"
              />
            </Space>
          ) : (
            <Typography.Text type="secondary">{strings.apps.offlineConfirmHint}</Typography.Text>
          )}
        </Modal>
      )}
    </section>
  )
}
