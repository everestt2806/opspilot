import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  CodeOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
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
  Space,
  Spin,
  Tabs,
  Tag,
  Typography
} from 'antd'

import type { App, Deployment, Vps } from '@shared/ipc'
import { PageHeader } from '../components/PageHeader'
import { useVpsStore } from '../store/vpsStore'
import { useStrings } from '../strings'
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

export function AppsPage(): React.JSX.Element {
  const { modal } = AntApp.useApp()
  const strings = useStrings()

  const [apps, setApps] = useState<App[]>([])
  const [vpsList, setVpsList] = useState<Vps[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null)
  const [loadedAppId, setLoadedAppId] = useState<number | null>(null)
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [deploymentsLoading, setDeploymentsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [search, setSearch] = useState('')

  const [doctorBusy, setDoctorBusy] = useState(false)
  const [doctorMessage, setDoctorMessage] = useState<string | null>(null)
  const [doctorFixId, setDoctorFixId] = useState<string | null>(null)
  const [doctorSafeToFix, setDoctorSafeToFix] = useState(false)

  const [rollbackTarget, setRollbackTarget] = useState<Deployment | null>(null)
  const [confirmInput, setConfirmInput] = useState('')
  const [rollbackBusy, setRollbackBusy] = useState(false)

  const vpsResources = useVpsStore((state) => state.resources)
  const [liveInspectState, setLiveInspectState] = useState<{
    status: 'idle' | 'checking' | 'success' | 'unverified'
    state?: string
    image?: string
    error?: string
  }>({ status: 'idle' })

  const activeAppIdRef = useRef<number | null>(null)
  const doctorReqIdRef = useRef(0)
  const rollbackReqIdRef = useRef(0)

  const selectApp = (id: number): void => {
    if (id === selectedAppId) return
    activeAppIdRef.current = id
    doctorReqIdRef.current++
    rollbackReqIdRef.current++
    setSelectedAppId(id)
    setLoadedAppId(null)
    setDeployments([])
    setDeploymentsLoading(true)
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

  const inspectLive = async (): Promise<void> => {
    if (!selectedApp) return
    const targetAppId = selectedApp.id
    setLiveInspectState({ status: 'checking' })
    try {
      const res = await window.api.invoke('app:runtime-inspect', targetAppId)
      if (activeAppIdRef.current !== targetAppId) return
      if (res.ok) {
        setLiveInspectState({ status: 'success', state: res.data.state, image: res.data.image })
      } else {
        setLiveInspectState({ status: 'unverified', error: res.error.message })
      }
    } catch (err: unknown) {
      if (activeAppIdRef.current !== targetAppId) return
      setLiveInspectState({
        status: 'unverified',
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const refreshData = useCallback(async (appId?: number): Promise<void> => {
    const targetId = appId ?? activeAppIdRef.current
    const [appRes, vpsRes] = await Promise.all([
      window.api.invoke('app:list'),
      window.api.invoke('vps:list')
    ])
    if (vpsRes.ok) setVpsList(vpsRes.data)
    if (appRes.ok) setApps(appRes.data)
    if (targetId !== null) {
      const res = await window.api.invoke('app:versions', targetId)
      if (activeAppIdRef.current === targetId && res.ok) {
        setDeployments(res.data.filter((d: Deployment) => d.app_id === targetId))
        setLoadedAppId(targetId)
      }
    }
  }, [])

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
        if (appRes.data.length > 0) {
          const firstAppId = appRes.data[0].id
          setSelectedAppId((prev) => {
            const next = prev !== null && appRes.data.some((a) => a.id === prev) ? prev : firstAppId
            activeAppIdRef.current = next
            setDeploymentsLoading(true)
            return next
          })
        } else {
          setSelectedAppId(null)
          activeAppIdRef.current = null
        }
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedAppId === null) return
    let cancelled = false
    const reqAppId = selectedAppId
    activeAppIdRef.current = reqAppId

    void (async () => {
      try {
        const res = await window.api.invoke('app:versions', reqAppId)
        // Bỏ qua response app:versions đến muộn nếu đã chuyển sang app khác hoặc effect bị huỷ
        if (cancelled || activeAppIdRef.current !== reqAppId) {
          return
        }
        if (res.ok) {
          const matching = res.data.filter((dep: Deployment) => dep.app_id === reqAppId)
          setDeployments(matching)
        } else {
          setDeployments([])
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
  }, [selectedAppId])

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
    const host = vpsList.find((v) => v.id === app.vps_id)?.host ?? ''
    return !query || `${app.name} ${app.framework} ${host}`.toLowerCase().includes(query)
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

  return (
    <section className="page-panel apps-page">
      <PageHeader
        title={strings.apps.title}
        description={strings.apps.description}
        actions={
          <span className="desktop-pagebar-count">
            <span className="status-dot status-dot-info" aria-hidden="true" />
            {strings.apps.count(apps.length)}
          </span>
        }
      />

      <div className="apps-workspace">
        <aside className="apps-sidebar" aria-label={strings.apps.title}>
          <div className="apps-pane-toolbar">
            <div className="apps-pane-title">
              <strong>{strings.apps.title}</strong>
            </div>
            <span className="apps-pane-counter mono-text">{filteredApps.length}</span>
          </div>
          <label className="apps-search-field">
            <span className="sr-only">{strings.apps.searchPlaceholder}</span>
            <Input
              allowClear
              variant="borderless"
              prefix={<SearchOutlined />}
              placeholder={strings.apps.searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Spin size="small" />
            </div>
          ) : (
            <div className="apps-list" role="listbox" aria-label={strings.apps.title}>
              {filteredApps.map((app) => {
                const isSelected = app.id === selectedApp?.id
                const vps = vpsList.find((v) => v.id === app.vps_id)
                return (
                  <button
                    className={`apps-list-item${isSelected ? ' apps-list-item-selected' : ''}`}
                    key={app.id}
                    type="button"
                    onClick={() => selectApp(app.id)}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span className="apps-list-item-icon" aria-hidden="true">
                      <CodeOutlined />
                    </span>
                    <span className="apps-list-item-copy">
                      <span className="apps-list-item-name">{app.name}</span>
                      <span className="apps-list-item-meta">
                        {app.framework} {vps ? `· ${vps.host}` : ''}
                      </span>
                      <span className="apps-list-item-status">
                        <span
                          className={`status-dot status-dot-${app.current_deployment_id ? 'info' : 'neutral'}`}
                          aria-hidden="true"
                        />
                        {app.current_deployment_id
                          ? strings.apps.statusRecordedDeployed
                          : strings.apps.statusNotDeployed}
                      </span>
                    </span>
                    <span className="apps-list-item-version mono-text">port {app.host_port}</span>
                  </button>
                )
              })}
              {filteredApps.length === 0 && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={apps.length === 0 ? strings.apps.empty : strings.apps.emptySearch}
                />
              )}
            </div>
          )}
          <div className="apps-sidebar-footer">
            <span className="status-dot status-dot-success" aria-hidden="true" />
            <span>{strings.apps.connectedLocal}</span>
          </div>
        </aside>

        {selectedApp ? (
          <main className="apps-detail" aria-label={strings.apps.detailAria(selectedApp.name)}>
            <header className="apps-detail-header">
              <div className="apps-detail-heading">
                <span className="apps-detail-avatar" aria-hidden="true">
                  <CodeOutlined />
                </span>
                <div className="apps-detail-title-copy">
                  <div className="apps-detail-name-row">
                    <h2 className="apps-detail-name">{selectedApp.name}</h2>
                    <span
                      className={`apps-status apps-status-${activeDeployment ? 'info' : 'neutral'}`}
                    >
                      <span
                        className={`status-dot status-dot-${activeDeployment ? 'info' : 'neutral'}`}
                      />
                      {activeDeployment
                        ? strings.apps.recordedStatus(
                            activeDeployment.status,
                            activeDeployment.version
                          )
                        : selectedApp.current_deployment_id === null
                          ? strings.apps.statusNotDeployed
                          : strings.apps.currentDeploymentNotFound}
                    </span>
                  </div>
                  <span className="apps-detail-subtitle">
                    <span>{selectedApp.framework}</span>
                    <span aria-hidden="true">·</span>
                    <span className="mono-text">{selectedApp.url}</span>
                  </span>
                </div>
              </div>
              <div className="apps-detail-header-meta">
                <span className="apps-detail-header-label">{strings.apps.version}</span>
                <strong className="mono-text">
                  {isVersionsLoading ? (
                    <Spin size="small" />
                  ) : activeDeployment ? (
                    `v${activeDeployment.version}`
                  ) : (
                    '—'
                  )}
                </strong>
              </div>
            </header>

            <div className="apps-kpi-grid">
              <div className="apps-kpi">
                <span className="apps-kpi-label">{strings.apps.recordedTitle}</span>
                <strong className="apps-kpi-value">
                  {isVersionsLoading ? (
                    <Spin size="small" />
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
                      <Typography.Text
                        type="secondary"
                        className="mono-text"
                        style={{ fontSize: 12 }}
                      >
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
                            {strings.apps.portBinding(
                              selectedApp.host_port,
                              selectedApp.container_port
                            )}
                          </span>
                        </Descriptions.Item>
                        <Descriptions.Item label={strings.apps.healthcheck}>
                          <span className="mono-text">{selectedApp.healthcheck_path}</span>
                        </Descriptions.Item>
                        <Descriptions.Item label={strings.apps.db}>
                          {selectedApp.needs_db ? strings.apps.dbYes : strings.apps.dbNo}
                        </Descriptions.Item>
                        <Descriptions.Item label={strings.apps.runtime}>
                          <Space size="small">
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
                              <Tag color="success">
                                {strings.apps.liveState(liveInspectState.state ?? 'running')}
                              </Tag>
                            )}
                            {liveInspectState.status === 'unverified' && (
                              <Space size="small">
                                <Tag color="default">{strings.apps.liveUnverified}</Tag>
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<ReloadOutlined />}
                                  onClick={() => void inspectLive()}
                                >
                                  {strings.common.retry}
                                </Button>
                              </Space>
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
                  key: 'versions',
                  label: (
                    <Space size={6}>
                      <HistoryOutlined />
                      <span>{strings.apps.tabs.versions}</span>
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
                                    {dep.image_tag && (
                                      <span>{strings.apps.imageTag(dep.image_tag)}</span>
                                    )}
                                  </div>
                                </div>
                              </li>
                            )
                          })}
                          {currentAppDeployments.length === 0 && (
                            <Empty
                              image={Empty.PRESENTED_IMAGE_SIMPLE}
                              description={strings.apps.emptyDeployments}
                            />
                          )}
                        </ol>
                      )}
                    </div>
                  )
                }
              ]}
            />
          </main>
        ) : (
          <div className="apps-detail apps-detail-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={apps.length === 0 ? strings.apps.emptyHint : strings.apps.selectAppHint}
            />
          </div>
        )}
      </div>

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
