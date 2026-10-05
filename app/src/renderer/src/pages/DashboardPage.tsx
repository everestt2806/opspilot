import { useCallback, useEffect, useState } from 'react'
import {
  AppstoreOutlined,
  CloudServerOutlined,
  ReloadOutlined,
  RightOutlined,
  RocketOutlined
} from '@ant-design/icons'
import { Alert, Badge, Button, Card, Empty, Space, Table, Tag, Tooltip, Typography } from 'antd'

import type { ActionLogEntry, App, IpcError, Vps } from '@shared/ipc'

import { PageHeader } from '../components/PageHeader'
import { useUiState } from '../store/uiState'
import { useStrings } from '../strings'
import { useVpsStore } from '../store/vpsStore'
import { localDateTime, relativeTime } from '../utils/format'
import { isVpsCheckedNow, useTicker } from '../vpsResources'

interface DashboardPageProps {
  onOpenApps?: () => void
  onOpenVps?: () => void
  onOpenDeploy?: () => void
  onOpenActivity?: () => void
}

const ACTION_COLORS: Record<string, string> = {
  deploy: 'blue',
  rollback_auto: 'purple',
  rollback_manual: 'orange',
  scan: 'cyan',
  install_docker: 'geekblue',
  restart: 'green',
  stop: 'default',
  migrate_start: 'blue',
  migrate_confirm: 'green',
  migrate_abort: 'red',
  ssh_error: 'red'
}

const STATUS_BADGE: Record<
  NonNullable<ActionLogEntry['status']>,
  'success' | 'error' | 'default'
> = {
  success: 'success',
  failed: 'error',
  cancelled: 'default'
}

export function DashboardPage({
  onOpenApps,
  onOpenVps,
  onOpenDeploy,
  onOpenActivity
}: DashboardPageProps): React.JSX.Element {
  const strings = useStrings()
  const locale = useUiState((state) => state.locale)
  const setSelectedAppId = useUiState((state) => state.setSelectedAppId)
  const setSelectedVpsId = useUiState((state) => state.setSelectedVpsId)
  const resources = useVpsStore((state) => state.resources)
  const now = useTicker(5000)

  const [vpsList, setVpsList] = useState<Vps[]>([])
  const [apps, setApps] = useState<App[]>([])
  const [recent, setRecent] = useState<ActionLogEntry[]>([])
  const [deploy24h, setDeploy24h] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<IpcError | null>(null)

  function actionLabel(action: string): string {
    const historyActions = strings.history.actions as Record<string, string> | undefined
    if (historyActions && historyActions[action]) return historyActions[action]
    const map = strings.dashboard.actions as Record<string, string>
    return map[action] ?? action
  }

  function statusLabel(status: ActionLogEntry['status']): string {
    if (!status) return strings.history.statuses?.cancelled ?? strings.dashboard.statuses.cancelled
    return strings.history.statuses?.[status] ?? strings.dashboard.statuses[status] ?? status
  }

  const load = useCallback(async () => {
    try {
      const vpsResult = await window.api.invoke('vps:list')
      if (!vpsResult.ok) {
        setError(vpsResult.error)
        return
      }
      const appResult = await window.api.invoke('app:list')
      if (!appResult.ok) {
        setError(appResult.error)
        return
      }
      const recentResult = await window.api.invoke('history:list', { limit: 10, offset: 0 })
      if (!recentResult.ok) {
        setError(recentResult.error)
        return
      }
      const dayResult = await window.api.invoke('history:list', {
        actions: ['deploy'],
        from_ts: new Date(Date.now() - 86_400_000).toISOString(),
        limit: 200,
        offset: 0
      })
      if (!dayResult.ok) {
        setError(dayResult.error)
        return
      }
      setError(null)
      setVpsList(vpsResult.data)
      setApps(appResult.data)
      setRecent(recentResult.data)
      setDeploy24h(dayResult.data.length)
    } finally {
      setLoading(false)
    }
  }, [])

  function reload(): void {
    setLoading(true)
    void load()
  }

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <section className="page-panel">
        <Alert
          type="error"
          message={error.message}
          description={error.technical}
          action={
            <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={reload}>
              {strings.dashboard.retry}
            </Button>
          }
          showIcon
        />
      </section>
    )
  }

  if (!loading && vpsList.length === 0) {
    return (
      <section className="page-panel">
        <Empty description={strings.dashboard.emptyVps} image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Button type="primary" icon={<CloudServerOutlined />} onClick={onOpenVps}>
            {strings.dashboard.addVps}
          </Button>
        </Empty>
      </section>
    )
  }

  const vpsNameById = new Map(vpsList.map((vps) => [vps.id, vps.name]))
  const vpsById = new Map(vpsList.map((vps) => [vps.id, vps]))
  const checkedNowCount = vpsList.filter((vps) =>
    isVpsCheckedNow(vps, resources[vps.id], now)
  ).length
  const recordedApps = apps.filter((app) => app.current_deployment_id !== null).length
  const lastDeploy = recent.find((row) => row.action === 'deploy')

  function handleAppClick(app: App): void {
    setSelectedAppId(app.id)
    onOpenApps?.()
  }

  function handleVpsClick(vpsId: number): void {
    setSelectedVpsId(vpsId)
    onOpenVps?.()
  }

  const appColumns = [
    {
      title: strings.dashboard.apps.columnName,
      dataIndex: 'name',
      key: 'name',
      render: (name: string, app: App) => (
        <div>
          <Typography.Link
            strong
            onClick={(e) => {
              e.stopPropagation()
              handleAppClick(app)
            }}
          >
            {name}
          </Typography.Link>
          {app.url && (
            <div className="mono-text" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {app.url}
            </div>
          )}
        </div>
      )
    },
    {
      title: strings.apps.framework,
      dataIndex: 'framework',
      key: 'framework',
      width: 120,
      render: (framework: string) => <Tag>{framework}</Tag>
    },
    {
      title: strings.dashboard.apps.columnPort,
      dataIndex: 'host_port',
      key: 'host_port',
      width: 100,
      render: (port: number | null) => (port ? <span className="mono-text">:{port}</span> : '—')
    },
    {
      title: strings.dashboard.apps.columnVps,
      dataIndex: 'vps_id',
      key: 'vps_id',
      width: 160,
      render: (vpsId: number | null) => {
        if (vpsId === null) return '—'
        const vps = vpsById.get(vpsId)
        return vps ? (
          <Typography.Link
            onClick={(e) => {
              e.stopPropagation()
              handleVpsClick(vps.id)
            }}
          >
            {vps.name}
          </Typography.Link>
        ) : (
          strings.dashboard.recent.unknownVps
        )
      }
    },
    {
      title: strings.dashboard.apps.columnStatus,
      key: 'status',
      width: 200,
      render: (_: unknown, app: App) => (
        <Tag color={app.current_deployment_id ? 'blue' : 'default'}>
          <span
            className={`status-dot status-dot-${app.current_deployment_id ? 'info' : 'neutral'}`}
            style={{ marginRight: 6 }}
          />
          {app.current_deployment_id
            ? `${strings.dashboard.apps.statusDeployed} (#${app.current_deployment_id})`
            : strings.dashboard.apps.statusNotDeployed}
        </Tag>
      )
    },
    {
      title: '',
      key: 'action',
      width: 100,
      render: (_: unknown, app: App) => (
        <Button
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            handleAppClick(app)
          }}
        >
          {strings.dashboard.apps.openApp}
        </Button>
      )
    }
  ]

  const recentColumns = [
    {
      title: strings.dashboard.recent.columnTime,
      dataIndex: 'ts',
      key: 'ts',
      width: 140,
      render: (ts: string) => (
        <Tooltip title={localDateTime(ts)}>
          <span className="mono-text">{relativeTime(ts, undefined, locale)}</span>
        </Tooltip>
      )
    },
    {
      title: strings.dashboard.recent.columnAction,
      dataIndex: 'action',
      key: 'action',
      width: 170,
      render: (action: string) => (
        <Tag color={ACTION_COLORS[action] ?? 'default'}>{actionLabel(action)}</Tag>
      )
    },
    {
      title: strings.dashboard.recent.columnVps,
      dataIndex: 'vps_id',
      key: 'vps_id',
      width: 140,
      render: (vpsId: number | null) => {
        if (vpsId === null) return '—'
        const vps = vpsById.get(vpsId)
        return vps ? (
          <Typography.Link
            onClick={(e) => {
              e.stopPropagation()
              handleVpsClick(vps.id)
            }}
          >
            {vps.name}
          </Typography.Link>
        ) : (
          (vpsNameById.get(vpsId) ?? strings.dashboard.recent.unknownVps)
        )
      }
    },
    {
      title: strings.dashboard.recent.columnStatus,
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (status: ActionLogEntry['status']) =>
        status === null ? (
          '—'
        ) : (
          <Space size={6}>
            <Badge status={STATUS_BADGE[status]} />
            <span>{statusLabel(status)}</span>
          </Space>
        )
    },
    {
      title: strings.dashboard.recent.columnMessage,
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
      render: (message: string | null) =>
        message ? <Typography.Text ellipsis={{ tooltip: message }}>{message}</Typography.Text> : '—'
    }
  ]

  return (
    <section className="page-panel dashboard-page">
      <PageHeader
        title={strings.dashboard.title}
        description={strings.dashboard.description}
        actions={
          <Space wrap>
            {onOpenApps && (
              <Button icon={<AppstoreOutlined />} onClick={onOpenApps}>
                {strings.dashboard.viewApps}
              </Button>
            )}
            {onOpenVps && (
              <Button icon={<CloudServerOutlined />} onClick={onOpenVps}>
                {strings.dashboard.viewVps}
              </Button>
            )}
            {onOpenDeploy && (
              <Button type="primary" icon={<RocketOutlined />} onClick={onOpenDeploy}>
                {strings.dashboard.deployAction}
              </Button>
            )}
            <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
              {strings.dashboard.refresh}
            </Button>
          </Space>
        }
      />

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* App-first summary strip */}
        <div className="summary-strip" aria-label={strings.dashboard.summaryLabel}>
          <div className="summary-cell" aria-label={strings.dashboard.stats.appsRunning}>
            <span>{strings.dashboard.stats.appsRunning}</span>
            <strong>
              {recordedApps} / {apps.length}
            </strong>
          </div>
          <div className="summary-cell" aria-label={strings.dashboard.stats.deploy24h}>
            <span>{strings.dashboard.stats.deploy24h}</span>
            <strong>{deploy24h}</strong>
          </div>
          <div className="summary-cell" aria-label={strings.dashboard.stats.lastDeploy}>
            <span>{strings.dashboard.stats.lastDeploy}</span>
            <strong>{lastDeploy ? relativeTime(lastDeploy.ts, undefined, locale) : '—'}</strong>
          </div>
          <div className="summary-cell" aria-label={strings.dashboard.stats.vpsOnline}>
            <span>{strings.dashboard.stats.vpsOnline}</span>
            <strong>
              {checkedNowCount} / {vpsList.length}
            </strong>
          </div>
        </div>

        {/* Section 1: Managed Applications (App-first primary section) */}
        <Card
          title={strings.dashboard.apps.title}
          extra={
            onOpenApps && (
              <Button type="link" size="small" onClick={onOpenApps}>
                {strings.dashboard.apps.viewAll} <RightOutlined />
              </Button>
            )
          }
          styles={{ body: { padding: 0 } }}
        >
          <Table<App>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={apps}
            columns={appColumns}
            pagination={false}
            onRow={(app) => ({
              onClick: () => handleAppClick(app),
              style: { cursor: 'pointer' }
            })}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={strings.dashboard.apps.empty}
                >
                  {onOpenDeploy && (
                    <Button type="primary" icon={<RocketOutlined />} onClick={onOpenDeploy}>
                      {strings.dashboard.apps.deployApp}
                    </Button>
                  )}
                </Empty>
              )
            }}
          />
        </Card>

        {/* Section 2: Recent Activity / Audit Log */}
        <Card
          title={strings.dashboard.recent.title}
          extra={
            onOpenActivity && (
              <Button type="link" size="small" onClick={onOpenActivity}>
                {strings.dashboard.recent.viewAll} <RightOutlined />
              </Button>
            )
          }
          styles={{ body: { padding: 0 } }}
        >
          <Table<ActionLogEntry>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={recent}
            columns={recentColumns}
            pagination={false}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={strings.dashboard.recent.empty}
                >
                  {onOpenDeploy && (
                    <Button type="primary" icon={<RocketOutlined />} onClick={onOpenDeploy}>
                      {strings.dashboard.recent.deployNow}
                    </Button>
                  )}
                </Empty>
              )
            }}
          />
        </Card>
      </Space>
    </section>
  )
}
