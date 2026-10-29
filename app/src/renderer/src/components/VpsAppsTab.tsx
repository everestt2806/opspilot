import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Modal, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd'
import { ExportOutlined, PlusOutlined, ReloadOutlined, RocketOutlined } from '@ant-design/icons'

import type { App, Deployment, DiscoveredVpsApp, IpcError } from '@shared/ipc'

import { useStrings } from '../strings'
import { useUiState } from '../store/uiState'

interface AppRow extends App {
  currentVersion: number | null
  currentImageTag: string | null
  deployStatus: Deployment['status'] | null
  versionsError?: string | null
  isMismatch?: boolean
}

interface VpsAppsTabProps {
  vpsId: number
}

type AppRowsResult = { rows: AppRow[] } | { error: IpcError }

type RecoveryOperation = {
  vpsId: number
  generation: number
  name: string
  phase: 'writing' | 'saved-unverified' | 'verified' | 'write-error'
  created?: boolean
  message?: string
}

let vpsGenerationSequence = 0

function isRecoveryEligible(
  app: AppRow,
  candidate: DiscoveredVpsApp | undefined
): candidate is DiscoveredVpsApp {
  return Boolean(
    app.imported_from_vps !== 1 &&
    app.deployStatus === 'running' &&
    candidate?.state === 'running' &&
    candidate.recovery_status === 'legacy' &&
    candidate.recovery_reason === 'manifest_missing' &&
    candidate.image_tag === app.currentImageTag &&
    candidate.version === app.currentVersion &&
    candidate.host_port === app.host_port &&
    candidate.container_port === app.container_port
  )
}

function sameRecoverySnapshot(a: DiscoveredVpsApp, b: DiscoveredVpsApp): boolean {
  return (
    a.name === b.name &&
    a.image_tag === b.image_tag &&
    a.version === b.version &&
    a.host_port === b.host_port &&
    a.container_port === b.container_port &&
    a.state === b.state &&
    a.recovery_status === b.recovery_status &&
    a.recovery_reason === b.recovery_reason
  )
}

/** Tải danh sách app + phiên bản đang deploy — tách khỏi component để effect
 *  mount và nút Refresh dùng chung một nguồn dữ liệu. */
async function fetchAppRows(vpsId: number): Promise<AppRowsResult> {
  const listResult = await window.api.invoke('app:list', vpsId)
  if (!listResult.ok) {
    return { error: listResult.error }
  }

  const enriched = await Promise.all(
    listResult.data.map(async (app) => {
      if (app.current_deployment_id === null) {
        return {
          ...app,
          currentVersion: null,
          currentImageTag: null,
          deployStatus: null,
          versionsError: null,
          isMismatch: false
        }
      }
      const versionsResult = await window.api.invoke('app:versions', app.id)
      if (!versionsResult.ok) {
        return {
          ...app,
          currentVersion: null,
          currentImageTag: null,
          deployStatus: null,
          versionsError: versionsResult.error.message || 'Error',
          isMismatch: false
        }
      }
      const current = versionsResult.data.find((d) => d.id === app.current_deployment_id)
      if (!current) {
        return {
          ...app,
          currentVersion: null,
          currentImageTag: null,
          deployStatus: null,
          versionsError: null,
          isMismatch: true
        }
      }
      return {
        ...app,
        currentVersion: current.version,
        currentImageTag: current.image_tag,
        deployStatus: current.status,
        versionsError: null,
        isMismatch: false
      }
    })
  )

  return { rows: enriched }
}

/** Tab ứng dụng & deploy — danh sách app trên VPS + điều hướng Deploy Wizard. */
export function VpsAppsTab({ vpsId }: VpsAppsTabProps): React.JSX.Element {
  return <VpsAppsTabInstance key={vpsId} vpsId={vpsId} />
}

function VpsAppsTabInstance({ vpsId }: VpsAppsTabProps): React.JSX.Element {
  const strings = useStrings()
  const [generation] = useState(() => ++vpsGenerationSequence)
  const [rows, setRows] = useState<AppRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<IpcError | null>(null)
  const [discovered, setDiscovered] = useState<DiscoveredVpsApp[]>([])
  const [scanError, setScanError] = useState<IpcError | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [importingName, setImportingName] = useState<string | null>(null)
  const [confirmImport, setConfirmImport] = useState<DiscoveredVpsApp | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [confirmRecovery, setConfirmRecovery] = useState<{
    vpsId: number
    generation: number
    candidate: DiscoveredVpsApp
  } | null>(null)
  const [recoveryOperation, setRecoveryOperation] = useState<RecoveryOperation | null>(null)
  const activeRequest = useRef<{ vpsId: number; generation: number } | null>(null)
  useLayoutEffect(() => {
    activeRequest.current = { vpsId, generation }
    return () => {
      activeRequest.current = null
    }
  }, [generation, vpsId])
  const isCurrentRequest = useCallback((): boolean => {
    const active = activeRequest.current
    return active?.vpsId === vpsId && active.generation === generation
  }, [generation, vpsId])
  const scanVersion = useRef(0)
  const setActivePage = useUiState((state) => state.setActivePage)
  const setDeployPreselect = useUiState((state) => state.setDeployPreselect)
  const setSelectedAppId = useUiState((state) => state.setSelectedAppId)

  const importCandidate = async (candidate: DiscoveredVpsApp): Promise<void> => {
    setImportingName(candidate.name)
    setImportError(null)
    try {
      const result = await window.api.invoke('vps:import-app', vpsId, candidate.name, {
        recovery_status: candidate.recovery_status,
        image_tag: candidate.image_tag,
        version: candidate.version,
        host_port: candidate.host_port,
        container_port: candidate.container_port,
        state: candidate.state,
        framework: candidate.framework,
        source_type: candidate.source_type,
        git_remote: candidate.git_remote,
        git_ref: candidate.git_ref,
        git_root: candidate.git_root,
        healthcheck: candidate.healthcheck,
        needs_db: candidate.needs_db
      })
      if (!isCurrentRequest()) return
      if (result.ok) {
        await load()
        await scan()
      } else {
        if (isCurrentRequest()) setImportError(result.error.message)
      }
    } catch {
      if (isCurrentRequest()) setImportError(strings.vpsControl.apps.discoveredError)
    } finally {
      if (isCurrentRequest()) {
        setImportingName(null)
        setConfirmImport(null)
      }
    }
  }

  const prepareRecovery = async (candidate: DiscoveredVpsApp): Promise<void> => {
    const app = rows.find((row) => row.name === candidate.name)
    const latestCandidate = app ? getRecoveryCandidate(app) : null
    if (
      !isCurrentRequest() ||
      !latestCandidate ||
      !sameRecoverySnapshot(latestCandidate, candidate)
    ) {
      setConfirmRecovery(null)
      return
    }
    setRecoveryOperation({ vpsId, generation, name: candidate.name, phase: 'writing' })
    try {
      const result = await window.api.invoke('vps:write-recovery-manifest', vpsId, candidate.name)
      if (!isCurrentRequest()) return
      if (!result.ok) {
        setRecoveryOperation({
          vpsId,
          generation,
          name: candidate.name,
          phase: 'write-error',
          message: result.error.message
        })
        return
      }
      setConfirmRecovery(null)
      await verifyRecovery(candidate.name, result.data.created)
    } catch {
      if (isCurrentRequest()) {
        setRecoveryOperation({
          vpsId,
          generation,
          name: candidate.name,
          phase: 'write-error',
          message: strings.vpsControl.apps.recoveryPreparation.failed
        })
      }
    }
  }

  const load = useCallback(async () => {
    const result = await fetchAppRows(vpsId)
    if (!isCurrentRequest()) return
    if ('error' in result) {
      setError(result.error)
      setRows([])
    } else {
      setRows(result.rows)
      setError(null)
    }
    setLoading(false)
  }, [isCurrentRequest, vpsId])

  const scan = useCallback(async () => {
    const version = ++scanVersion.current
    await Promise.resolve()
    if (!isCurrentRequest() || version !== scanVersion.current) return { ok: false as const }
    setScanLoading(true)
    try {
      const result = await window.api.invoke('vps:discover-apps', vpsId)
      if (!isCurrentRequest() || version !== scanVersion.current) return { ok: false as const }
      if (result.ok) {
        setDiscovered(result.data)
        setScanError(null)
        return { ok: true as const, data: result.data }
      } else {
        setDiscovered([])
        setScanError(result.error)
        return { ok: false as const }
      }
    } catch {
      if (!isCurrentRequest() || version !== scanVersion.current) return { ok: false as const }
      setDiscovered([])
      setScanError({ code: 'UNKNOWN', message: '' })
      return { ok: false as const }
    } finally {
      if (isCurrentRequest() && version === scanVersion.current) setScanLoading(false)
    }
  }, [isCurrentRequest, vpsId])

  const verifyRecovery = async (name: string, created: boolean): Promise<void> => {
    const result = await scan()
    if (!isCurrentRequest()) return
    const candidate = result.ok ? result.data.find((item) => item.name === name) : undefined
    setRecoveryOperation({
      vpsId,
      generation,
      name,
      phase: candidate?.recovery_status === 'verified' ? 'verified' : 'saved-unverified',
      created
    })
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (!cancelled && isCurrentRequest()) await scan()
    })()
    return () => {
      cancelled = true
      scanVersion.current += 1
    }
  }, [isCurrentRequest, scan])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await fetchAppRows(vpsId)
      if (cancelled || !isCurrentRequest()) return
      if ('error' in result) {
        setError(result.error)
        setRows([])
      } else {
        setRows(result.rows)
        setError(null)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [generation, isCurrentRequest, vpsId])

  function goDeploy(appId?: number): void {
    setDeployPreselect({ vpsId, appId })
    setActivePage('deploy')
  }

  async function openApp(url: string): Promise<void> {
    await window.api.invoke('system:open-external', url)
  }

  const statusLabel = (app: AppRow): string => {
    if (app.current_deployment_id === null) {
      return strings.apps.statusNotDeployed
    }
    if (app.versionsError) {
      return strings.apps.versionsLoadError
    }
    if (app.isMismatch) {
      return strings.apps.recordMismatch(app.current_deployment_id)
    }
    if (app.deployStatus) {
      if (app.currentVersion !== null) {
        return strings.apps.recordedStatus(app.deployStatus, app.currentVersion)
      }
      return `${strings.apps.statusRecordedDeployed}: ${app.deployStatus}`
    }
    return strings.apps.recordMismatch(app.current_deployment_id)
  }

  const statusColor = (app: AppRow): string => {
    if (app.current_deployment_id === null) return 'default'
    if (app.versionsError) return 'error'
    if (app.isMismatch) return 'warning'
    if (!app.deployStatus) return 'default'
    if (app.deployStatus === 'running') return 'default'
    if (app.deployStatus === 'failed') return 'error'
    if (app.deployStatus === 'building' || app.deployStatus === 'deploying') return 'processing'
    return 'default'
  }

  const columns = [
    {
      title: strings.vpsControl.apps.columns.name,
      dataIndex: 'name',
      key: 'name',
      render: (name: string, app: AppRow) => (
        <Typography.Link
          strong
          onClick={() => {
            setSelectedAppId(app.id)
            setActivePage('apps')
          }}
        >
          {name}
        </Typography.Link>
      )
    },
    {
      title: strings.vpsControl.apps.columns.framework,
      dataIndex: 'framework',
      key: 'framework',
      width: 95
    },
    {
      title: strings.vpsControl.apps.columns.port,
      key: 'port',
      width: 65,
      render: (_: unknown, app: AppRow) => <span className="mono-text">{app.host_port}</span>
    },
    {
      title: strings.vpsControl.apps.columns.url,
      key: 'url',
      width: 170,
      ellipsis: true,
      render: (_: unknown, app: AppRow) => (
        <Typography.Link className="mono-text" onClick={() => void openApp(app.url)}>
          {app.url}
        </Typography.Link>
      )
    },
    {
      title: strings.vpsControl.apps.columns.version,
      key: 'version',
      width: 85,
      align: 'center' as const,
      render: (_: unknown, app: AppRow) => {
        if (app.currentVersion !== null) return `v${app.currentVersion}`
        if (app.current_deployment_id !== null) {
          if (app.isMismatch || app.versionsError) {
            return <Typography.Text type="secondary">—</Typography.Text>
          }
          return (
            <Tooltip title={`${strings.apps.deploymentIdTitle}: #${app.current_deployment_id}`}>
              <span className="mono-text" style={{ fontSize: 12 }}>
                ID: #{app.current_deployment_id}
              </span>
            </Tooltip>
          )
        }
        return <Typography.Text type="secondary">—</Typography.Text>
      }
    },
    {
      title: strings.vpsControl.apps.columns.status,
      key: 'status',
      width: 165,
      render: (_: unknown, app: AppRow) => (
        <Space size={4}>
          <Tag className="status-badge" color={statusColor(app)}>
            {statusLabel(app)}
          </Tag>
          {app.imported_from_vps === 1 && (
            <Tag>{strings.vpsControl.apps.recoveryStatus.importedFromVps}</Tag>
          )}
          {managedRecoveryStatus[app.name]?.recovery_status === 'verified' && (
            <Tag color="green">{strings.vpsControl.apps.recoveryStatus.verified}</Tag>
          )}
        </Space>
      )
    },
    {
      title: strings.vpsControl.apps.columns.actions,
      key: 'actions',
      width: 350,
      render: (_: unknown, app: AppRow) => (
        <Space size={4} wrap>
          <Button
            className="action-pill"
            size="small"
            icon={<ExportOutlined />}
            onClick={() => void openApp(app.url)}
          >
            {strings.vpsControl.apps.openApp}
          </Button>
          {app.imported_from_vps !== 1 && (
            <Button
              className="action-pill"
              size="small"
              icon={<RocketOutlined />}
              onClick={() => goDeploy(app.id)}
            >
              {strings.vpsControl.apps.redeploy}
            </Button>
          )}
          {getRecoveryCandidate(app) && (
            <Button
              className="action-pill"
              size="small"
              disabled={activeRecoveryOperation?.phase === 'writing'}
              onClick={() => {
                const candidate = getRecoveryCandidate(app)
                if (!candidate || !isCurrentRequest()) return
                setConfirmRecovery({ vpsId, generation, candidate })
              }}
            >
              {strings.vpsControl.apps.recoveryPreparation.action}
            </Button>
          )}
        </Space>
      )
    }
  ]

  const remoteOnly = discovered.filter(
    (candidate) => !rows.some((app) => app.name === candidate.name)
  )
  const managedRecoveryStatus = discovered.reduce<Record<string, DiscoveredVpsApp>>(
    (byName, candidate) => {
      if (rows.some((app) => app.name === candidate.name)) byName[candidate.name] = candidate
      return byName
    },
    {}
  )
  const getRecoveryCandidate = (app: AppRow): DiscoveredVpsApp | null => {
    if (loading || error || scanLoading || scanError) return null
    const candidate = managedRecoveryStatus[app.name]
    return isRecoveryEligible(app, candidate) ? candidate : null
  }
  const activeRecoveryOperation =
    recoveryOperation?.vpsId === vpsId && recoveryOperation.generation === generation
      ? recoveryOperation
      : null

  return (
    <div>
      <Modal
        open={confirmImport !== null}
        transitionName=""
        maskTransitionName=""
        title={strings.vpsControl.apps.importConfirmation.title}
        okText={strings.vpsControl.apps.importConfirmation.confirm}
        cancelText={strings.vpsControl.apps.importConfirmation.cancel}
        confirmLoading={importingName !== null}
        onCancel={() => setConfirmImport(null)}
        onOk={() => {
          if (confirmImport) void importCandidate(confirmImport)
        }}
      >
        {confirmImport && (
          <Space direction="vertical" size="small">
            <Typography.Text>
              <strong>{strings.vpsControl.apps.importConfirmation.name}:</strong>{' '}
              {confirmImport.name}
            </Typography.Text>
            <Typography.Text>
              <strong>{strings.vpsControl.apps.importConfirmation.imageVersion}:</strong>{' '}
              {confirmImport.image_tag} (v{confirmImport.version})
            </Typography.Text>
            <Typography.Text>
              <strong>{strings.vpsControl.apps.importConfirmation.port}:</strong>{' '}
              {confirmImport.host_port ?? '—'} → {confirmImport.container_port ?? '—'}
            </Typography.Text>
            <Typography.Text>{strings.vpsControl.apps.importConfirmation.readOnly}</Typography.Text>
          </Space>
        )}
      </Modal>
      <Modal
        open={
          confirmRecovery !== null &&
          confirmRecovery.vpsId === vpsId &&
          confirmRecovery.generation === generation
        }
        transitionName=""
        maskTransitionName=""
        title={strings.vpsControl.apps.recoveryPreparation.title}
        okText={strings.vpsControl.apps.recoveryPreparation.confirm}
        cancelText={strings.vpsControl.apps.recoveryPreparation.cancel}
        confirmLoading={activeRecoveryOperation?.phase === 'writing'}
        onCancel={() => setConfirmRecovery(null)}
        onOk={() => {
          if (confirmRecovery?.vpsId === vpsId && confirmRecovery.generation === generation) {
            void prepareRecovery(confirmRecovery.candidate)
          }
        }}
      >
        {confirmRecovery && (
          <Space direction="vertical" size="small">
            <Typography.Text>
              <strong>{strings.vpsControl.apps.recoveryPreparation.name}:</strong>{' '}
              {confirmRecovery.candidate.name}
            </Typography.Text>
            <Typography.Text>
              <strong>{strings.vpsControl.apps.recoveryPreparation.imageVersion}:</strong>{' '}
              {confirmRecovery.candidate.image_tag} (v{confirmRecovery.candidate.version})
            </Typography.Text>
            <Typography.Text>
              <strong>{strings.vpsControl.apps.recoveryPreparation.port}:</strong>{' '}
              {confirmRecovery.candidate.host_port ?? '—'} →{' '}
              {confirmRecovery.candidate.container_port ?? '—'}
            </Typography.Text>
            <Typography.Text>
              {strings.vpsControl.apps.recoveryPreparation.explanation}
            </Typography.Text>
          </Space>
        )}
      </Modal>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12
        }}
      >
        <Typography.Title level={5} style={{ margin: 0 }}>
          {strings.vpsControl.apps.title}
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void scan()} loading={scanLoading}>
            {strings.vpsControl.apps.discoveredScan}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} disabled={loading}>
            {strings.common.refresh}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => goDeploy()}>
            {strings.vpsControl.apps.deployNew}
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          type="error"
          showIcon
          message={strings.vpsControl.apps.loadFailed}
          description={error.message}
          action={
            <Button size="small" onClick={() => void load()}>
              {strings.common.retry}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      )}

      {scanError && (
        <Alert
          type="warning"
          showIcon
          message={strings.vpsControl.apps.discoveredError}
          description={scanError.message || strings.vpsControl.apps.discoveredError}
          action={
            <Button size="small" onClick={() => void scan()}>
              {strings.common.retry}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      )}

      {activeRecoveryOperation?.phase === 'verified' && (
        <Alert
          type="success"
          showIcon
          message={
            activeRecoveryOperation.created
              ? strings.vpsControl.apps.recoveryPreparation.created
              : strings.vpsControl.apps.recoveryPreparation.alreadyExists
          }
          style={{ marginBottom: 12 }}
        />
      )}
      {activeRecoveryOperation?.phase === 'saved-unverified' && (
        <Alert
          type="warning"
          showIcon
          message={strings.vpsControl.apps.recoveryPreparation.savedUnverified}
          action={
            <Button
              size="small"
              loading={scanLoading}
              onClick={() =>
                void verifyRecovery(
                  activeRecoveryOperation.name,
                  Boolean(activeRecoveryOperation.created)
                )
              }
            >
              {strings.vpsControl.apps.recoveryPreparation.retryScan}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      )}
      {activeRecoveryOperation?.phase === 'write-error' && (
        <Alert
          type="error"
          showIcon
          message={
            activeRecoveryOperation.message || strings.vpsControl.apps.recoveryPreparation.failed
          }
          action={
            <Button
              size="small"
              onClick={() => {
                const app = rows.find((row) => row.name === activeRecoveryOperation.name)
                const candidate = app ? getRecoveryCandidate(app) : null
                if (candidate) void prepareRecovery(candidate)
              }}
            >
              {strings.vpsControl.apps.recoveryPreparation.retry}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      )}

      {!loading && !error && rows.length === 0 && remoteOnly.length === 0 && !scanLoading && (
        <Empty description={strings.vpsControl.apps.empty}>
          <Typography.Paragraph type="secondary" style={{ maxWidth: 360, margin: '0 auto' }}>
            {strings.vpsControl.apps.emptyHint}
          </Typography.Paragraph>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => goDeploy()}>
            {strings.vpsControl.apps.deployNew}
          </Button>
        </Empty>
      )}

      {!loading && rows.length > 0 && (
        <>
          <Table<AppRow>
            rowKey="id"
            size="small"
            dataSource={rows}
            columns={columns}
            pagination={false}
            className="vps-apps-table"
          />
        </>
      )}

      {!loading && !error && remoteOnly.length > 0 && (
        <section style={{ marginTop: 24 }} aria-label={strings.vpsControl.apps.discoveredTitle}>
          <Typography.Title level={5}>{strings.vpsControl.apps.discoveredTitle}</Typography.Title>
          <Alert
            type="info"
            showIcon
            message={strings.vpsControl.apps.discoveredHint}
            description={strings.vpsControl.apps.recoveryHint}
            style={{ marginBottom: 12 }}
          />
          {remoteOnly.some(
            (candidate) =>
              candidate.recovery_status === 'legacy' &&
              candidate.recovery_reason === 'manifest_missing'
          ) && (
            <Alert
              type="info"
              showIcon
              message={strings.vpsControl.apps.recoveryPreparation.noLocalRecord}
              style={{ marginBottom: 12 }}
            />
          )}
          {importError && (
            <Alert
              type="error"
              showIcon
              closable
              message={importError}
              onClose={() => setImportError(null)}
              style={{ marginBottom: 12 }}
            />
          )}
          <Table<DiscoveredVpsApp>
            rowKey="name"
            size="small"
            dataSource={remoteOnly}
            pagination={false}
            columns={[
              { title: strings.vpsControl.apps.columns.name, dataIndex: 'name', key: 'name' },
              {
                title: strings.vpsControl.apps.discoveredEligibility,
                key: 'eligibility',
                render: (_: unknown, app: DiscoveredVpsApp) => (
                  <Tag color={app.recovery_status === 'verified' ? 'green' : 'default'}>
                    {app.recovery_reason === 'manifest_unreadable'
                      ? strings.vpsControl.apps.recoveryStatus.manifestUnreadable
                      : strings.vpsControl.apps.recoveryStatus[app.recovery_status]}
                  </Tag>
                )
              },
              {
                title: strings.vpsControl.apps.discoveredMetadata,
                key: 'metadata',
                render: (_: unknown, app: DiscoveredVpsApp) =>
                  [
                    app.framework,
                    app.source_type,
                    app.git_remote,
                    app.git_ref,
                    app.git_root ? `root: ${app.git_root}` : null,
                    app.container_port ? `container:${app.container_port}` : null,
                    app.healthcheck,
                    app.needs_db === null ? null : `needs_db:${app.needs_db}`
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'
              },
              {
                title: strings.vpsControl.apps.discoveredImage,
                dataIndex: 'image_tag',
                key: 'image'
              },
              {
                title: strings.vpsControl.apps.columns.port,
                dataIndex: 'host_port',
                key: 'port',
                render: (port: number | null) => port ?? '—'
              },
              {
                title: strings.vpsControl.apps.discoveredState,
                dataIndex: 'state',
                key: 'state',
                render: (state: string) => <Tag>{state}</Tag>
              },
              {
                title: strings.vpsControl.apps.columns.actions,
                key: 'actions',
                render: (_: unknown, candidate: DiscoveredVpsApp) =>
                  candidate.recovery_status === 'verified' ? (
                    <Button
                      size="small"
                      loading={importingName === candidate.name}
                      disabled={importingName !== null}
                      onClick={() => {
                        setConfirmImport(candidate)
                        setImportError(null)
                      }}
                    >
                      {strings.vpsControl.apps.importVerified}
                    </Button>
                  ) : null
              }
            ]}
          />
        </section>
      )}
    </div>
  )
}
