import { useCallback, useEffect, useState } from 'react'
import {
  DashboardOutlined,
  CloudServerOutlined,
  ReloadOutlined,
  RocketOutlined
} from '@ant-design/icons'
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'

import type { ActionLogEntry, App, IpcError, Vps } from '@shared/ipc'

import { strings } from '../strings'
import { localDateTime, relativeTime } from '../utils/format'

interface DashboardPageProps {
  onOpenVps?: () => void
  onOpenDeploy?: () => void
}

const ACTION_COLORS: Record<string, string> = {
  deploy: 'blue',
  rollback_auto: 'purple',
  rollback_manual: 'orange'
}

const STATUS_BADGE: Record<
  NonNullable<ActionLogEntry['status']>,
  'success' | 'error' | 'default'
> = {
  success: 'success',
  failed: 'error',
  cancelled: 'default'
}

export function DashboardPage({ onOpenVps, onOpenDeploy }: DashboardPageProps): React.JSX.Element {
  const [vpsList, setVpsList] = useState<Vps[]>([])
  const [apps, setApps] = useState<App[]>([])
  const [recent, setRecent] = useState<ActionLogEntry[]>([])
  const [deploy24h, setDeploy24h] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<IpcError | null>(null)

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
  const onlineCount = vpsList.filter((vps) => vps.last_status === 'online').length
  const runningApps = apps.filter((app) => app.current_deployment_id !== null).length
  const lastDeploy = recent.find((row) => row.action === 'deploy')

  const columns = [
    {
      title: strings.dashboard.recent.columnTime,
      dataIndex: 'ts',
      key: 'ts',
      width: 130,
      render: (ts: string) => (
        <Tooltip title={localDateTime(ts)}>
          <span className="mono-text">{relativeTime(ts)}</span>
        </Tooltip>
      )
    },
    {
      title: strings.dashboard.recent.columnAction,
      dataIndex: 'action',
      key: 'action',
      width: 170,
      render: (action: string) => (
        <Tag color={ACTION_COLORS[action]}>
          {strings.dashboard.actions[action as keyof typeof strings.dashboard.actions] ?? action}
        </Tag>
      )
    },
    {
      title: strings.dashboard.recent.columnVps,
      dataIndex: 'vps_id',
      key: 'vps_id',
      width: 130,
      render: (vpsId: number | null) =>
        vpsId === null ? '—' : (vpsNameById.get(vpsId) ?? strings.dashboard.recent.unknownVps)
    },
    {
      title: strings.dashboard.recent.columnStatus,
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: ActionLogEntry['status']) =>
        status === null ? (
          '—'
        ) : (
          <Space size={6}>
            <Badge status={STATUS_BADGE[status]} />
            <span>{strings.dashboard.statuses[status]}</span>
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
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <DashboardOutlined style={{ marginRight: 8, color: 'var(--info)' }} />
            {strings.dashboard.title}
          </Typography.Title>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
          {strings.dashboard.refresh}
        </Button>
      </div>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Row gutter={16}>
          <Col span={6}>
            <Card>
              <Statistic
                title={strings.dashboard.stats.vpsOnline}
                value={onlineCount}
                suffix={`/ ${vpsList.length}`}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title={strings.dashboard.stats.appsRunning}
                value={runningApps}
                suffix={`/ ${apps.length}`}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic title={strings.dashboard.stats.deploy24h} value={deploy24h} />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title={strings.dashboard.stats.lastDeploy}
                value={lastDeploy ? relativeTime(lastDeploy.ts) : '—'}
                valueStyle={{ fontSize: 16, whiteSpace: 'nowrap' }}
              />
            </Card>
          </Col>
        </Row>

        <Card title={strings.dashboard.recent.title} styles={{ body: { padding: 0 } }}>
          <Table<ActionLogEntry>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={recent}
            columns={columns}
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
