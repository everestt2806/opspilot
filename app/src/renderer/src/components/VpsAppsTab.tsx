import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Empty, Space, Spin, Table, Tag, Typography } from 'antd'
import { ExportOutlined, PlusOutlined, ReloadOutlined, RocketOutlined } from '@ant-design/icons'

import type { App, Deployment, IpcError } from '@shared/ipc'

import { useStrings } from '../strings'
import { useUiState } from '../store/uiState'

interface AppRow extends App {
  currentVersion: number | null
  deployStatus: Deployment['status'] | null
  versionsError?: string | null
  isMismatch?: boolean
}

interface VpsAppsTabProps {
  vpsId: number
}

type AppRowsResult = { rows: AppRow[] } | { error: IpcError }

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
          deployStatus: null,
          versionsError: null,
          isMismatch: true
        }
      }
      return {
        ...app,
        currentVersion: current.version,
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
  const strings = useStrings()
  const [rows, setRows] = useState<AppRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<IpcError | null>(null)
  const setActivePage = useUiState((state) => state.setActivePage)
  const setDeployPreselect = useUiState((state) => state.setDeployPreselect)
  const setSelectedAppId = useUiState((state) => state.setSelectedAppId)

  const load = useCallback(async () => {
    const result = await fetchAppRows(vpsId)
    if ('error' in result) {
      setError(result.error)
      setRows([])
    } else {
      setRows(result.rows)
      setError(null)
    }
    setLoading(false)
  }, [vpsId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await fetchAppRows(vpsId)
      if (cancelled) return
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
  }, [vpsId])

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
      width: 110
    },
    {
      title: strings.vpsControl.apps.columns.port,
      key: 'port',
      width: 80,
      render: (_: unknown, app: AppRow) => <span className="mono-text">{app.host_port}</span>
    },
    {
      title: strings.vpsControl.apps.columns.url,
      key: 'url',
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
      width: 90,
      align: 'center' as const,
      render: (_: unknown, app: AppRow) => {
        if (app.currentVersion !== null) return `v${app.currentVersion}`
        if (app.current_deployment_id !== null) return `#${app.current_deployment_id}`
        return '—'
      }
    },
    {
      title: strings.vpsControl.apps.columns.status,
      key: 'status',
      width: 170,
      render: (_: unknown, app: AppRow) => (
        <Tag className="status-badge" color={statusColor(app)}>
          {statusLabel(app)}
        </Tag>
      )
    },
    {
      title: strings.vpsControl.apps.columns.actions,
      key: 'actions',
      width: 180,
      render: (_: unknown, app: AppRow) => (
        <Space size="small">
          <Button
            className="action-pill"
            size="small"
            icon={<ExportOutlined />}
            onClick={() => void openApp(app.url)}
          >
            {strings.vpsControl.apps.openApp}
          </Button>
          <Button
            className="action-pill"
            size="small"
            icon={<RocketOutlined />}
            onClick={() => goDeploy(app.id)}
          >
            {strings.vpsControl.apps.redeploy}
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div>
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

      {loading && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
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
        <Table<AppRow>
          rowKey="id"
          size="small"
          dataSource={rows}
          columns={columns}
          pagination={false}
        />
      )}
    </div>
  )
}
