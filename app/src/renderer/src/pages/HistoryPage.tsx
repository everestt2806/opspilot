import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import { AppstoreOutlined, CloudServerOutlined, ReloadOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'

import type { ActionLogEntry, IpcError, Vps } from '@shared/ipc'

import { PageHeader } from '../components/PageHeader'
import { useUiState } from '../store/uiState'
import { useStrings } from '../strings'
import { localDateTime, relativeTime } from '../utils/format'

const PAGE_SIZE = 20

type HistoryFilter = {
  actions?: string[]
  vps_id?: number
  from_ts?: string
  to_ts?: string
  limit: number
  offset: number
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

function parseDetail(detailJson: string | null): Array<[string, string]> {
  if (!detailJson) return []
  try {
    const parsed: unknown = JSON.parse(detailJson)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : JSON.stringify(value)
      ])
    }
  } catch {
    return []
  }
  return []
}

interface HistoryPageProps {
  onOpenVps?: () => void
  onOpenApps?: () => void
  onOpenDeploy?: () => void
}

export function HistoryPage({ onOpenVps, onOpenApps }: HistoryPageProps): React.JSX.Element {
  const strings = useStrings()
  const locale = useUiState((state) => state.locale)
  const setSelectedVpsId = useUiState((state) => state.setSelectedVpsId)
  const setSelectedAppId = useUiState((state) => state.setSelectedAppId)

  const [rows, setRows] = useState<ActionLogEntry[]>([])
  const [vpsList, setVpsList] = useState<Vps[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<IpcError | null>(null)
  const [actions, setActions] = useState<string[]>([])
  const [vpsId, setVpsId] = useState<number | undefined>(undefined)
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [selected, setSelected] = useState<ActionLogEntry | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const reqIdRef = useRef(0)

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

  const actionOptions: Array<{ value: string; label: string }> = [
    { value: 'deploy', label: strings.history.actions.deploy },
    { value: 'rollback_auto', label: strings.history.actions.rollback_auto },
    { value: 'rollback_manual', label: strings.history.actions.rollback_manual },
    { value: 'scan', label: strings.history.actions.scan },
    { value: 'install_docker', label: strings.history.actions.install_docker },
    { value: 'restart', label: strings.history.actions.restart },
    { value: 'stop', label: strings.history.actions.stop },
    { value: 'migrate_start', label: strings.history.actions.migrate_start },
    { value: 'migrate_confirm', label: strings.history.actions.migrate_confirm },
    { value: 'migrate_abort', label: strings.history.actions.migrate_abort },
    { value: 'ssh_error', label: strings.history.actions.ssh_error }
  ]

  const load = useCallback(
    async (
      targetPage: number,
      currentActions: string[],
      currentVpsId: number | undefined,
      currentRange: [Dayjs, Dayjs] | null
    ) => {
      const reqId = ++reqIdRef.current
      try {
        const filter: HistoryFilter = {
          actions: currentActions.length > 0 ? currentActions : undefined,
          vps_id: currentVpsId,
          from_ts: currentRange ? currentRange[0].startOf('day').toDate().toISOString() : undefined,
          to_ts: currentRange ? currentRange[1].endOf('day').toDate().toISOString() : undefined,
          limit: PAGE_SIZE,
          offset: (targetPage - 1) * PAGE_SIZE
        }
        const result = await window.api.invoke('history:list', filter)
        if (reqId !== reqIdRef.current) return
        if (!result.ok) {
          setError(result.error)
          return
        }
        const data = Array.isArray(result.data) ? result.data : []
        setError(null)
        setRows(data)
        const isFull = data.length === PAGE_SIZE
        setHasMore(isFull)
        setTotal(isFull ? targetPage * PAGE_SIZE + 1 : (targetPage - 1) * PAGE_SIZE + data.length)
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void (async () => {
      const result = await window.api.invoke('vps:list')
      if (result.ok) setVpsList(result.data)
    })()
  }, [])

  useEffect(() => {
    void load(page, actions, vpsId, range)
  }, [page, actions, vpsId, range, load])

  function reload(): void {
    setLoading(true)
    void load(page, actions, vpsId, range)
  }

  function handleActionsChange(value: string[]): void {
    setLoading(true)
    setActions(value)
    setPage(1)
  }

  function handleVpsChange(value: number | undefined): void {
    setLoading(true)
    setVpsId(value)
    setPage(1)
  }

  function handleRangeChange(dates: [Dayjs | null, Dayjs | null] | null): void {
    setLoading(true)
    if (dates && dates[0] && dates[1]) {
      setRange([dates[0], dates[1]])
    } else {
      setRange(null)
    }
    setPage(1)
  }

  function handlePageChange(newPage: number): void {
    setLoading(true)
    setPage(newPage)
  }

  const vpsNameById = new Map(vpsList.map((vps) => [vps.id, vps.name]))
  const vpsById = new Map(vpsList.map((vps) => [vps.id, vps]))

  const columns = [
    {
      title: strings.history.columns.time,
      dataIndex: 'ts',
      key: 'ts',
      width: 150,
      align: 'center' as const,
      render: (ts: string) => (
        <Tooltip title={localDateTime(ts)}>
          <span className="mono-text">{relativeTime(ts, undefined, locale)}</span>
        </Tooltip>
      )
    },
    {
      title: strings.history.columns.action,
      dataIndex: 'action',
      key: 'action',
      width: 170,
      align: 'center' as const,
      render: (action: string) => (
        <Tag color={ACTION_COLORS[action] ?? 'default'}>{actionLabel(action)}</Tag>
      )
    },
    {
      title: strings.history.columns.vps,
      dataIndex: 'vps_id',
      key: 'vps_id',
      width: 150,
      align: 'center' as const,
      render: (id: number | null) => {
        if (id === null) return '—'
        const vps = vpsById.get(id)
        return vps ? (
          <Typography.Link
            onClick={(e) => {
              e.stopPropagation()
              setSelectedVpsId(vps.id)
              onOpenVps?.()
            }}
          >
            {vps.name}
          </Typography.Link>
        ) : (
          (vpsNameById.get(id) ?? strings.dashboard.recent.unknownVps)
        )
      }
    },
    {
      title: strings.history.columns.status,
      dataIndex: 'status',
      key: 'status',
      width: 130,
      align: 'center' as const,
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
      title: strings.history.columns.message,
      dataIndex: 'message',
      key: 'message',
      align: 'center' as const,
      ellipsis: true,
      render: (message: string | null) =>
        message ? <Typography.Text ellipsis={{ tooltip: message }}>{message}</Typography.Text> : '—'
    }
  ]

  const detailItems = selected
    ? parseDetail(selected.detail_json).map(([key, value]) => {
        return {
          key,
          label: <span className="mono-text">{key}</span>,
          children: <Typography.Text code>{value}</Typography.Text>
        }
      })
    : []

  return (
    <section className="page-panel history-page">
      <PageHeader
        title={strings.history.title}
        description={strings.history.description}
        actions={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
            {strings.common.refresh}
          </Button>
        }
      />

      <Space wrap size={8} style={{ marginBottom: 12 }}>
        <Select
          mode="multiple"
          allowClear
          placeholder={strings.history.filters.actionAll}
          aria-label={strings.history.filters.action}
          style={{ minWidth: 200 }}
          value={actions}
          onChange={handleActionsChange}
          options={actionOptions}
        />
        <Select
          allowClear
          placeholder={strings.history.filters.vpsAll}
          aria-label={strings.history.filters.vps}
          style={{ minWidth: 160 }}
          value={vpsId}
          onChange={handleVpsChange}
          options={vpsList.map((vps) => ({ value: vps.id, label: `${vps.name} — ${vps.host}` }))}
        />
        <DatePicker.RangePicker
          aria-label={strings.history.filters.timeRange}
          placeholder={[strings.history.filters.startDate, strings.history.filters.endDate]}
          style={{ minWidth: 240 }}
          value={range}
          onChange={handleRangeChange}
        />
      </Space>

      {error && (
        <Alert
          className="page-alert"
          type="error"
          showIcon
          message={strings.history.loadFailed}
          description={error.message}
          action={
            <Button size="small" type="primary" loading={loading} onClick={reload}>
              {strings.history.retry}
            </Button>
          }
        />
      )}

      <Table<ActionLogEntry>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        columns={columns}
        onRow={(record) => ({
          onClick: () => setSelected(record),
          style: { cursor: 'pointer' }
        })}
        pagination={
          rows.length === 0 && !loading
            ? false
            : {
                current: page,
                pageSize: PAGE_SIZE,
                total: total,
                showSizeChanger: false,
                hideOnSinglePage: false,
                onChange: handlePageChange,
                showTotal: (_totalCount, [from, to]) =>
                  hasMore
                    ? strings.history.pagination.pageMore(from, to)
                    : strings.history.pagination.pageTotal(
                        from,
                        to,
                        (page - 1) * PAGE_SIZE + rows.length
                      ),
                locale: {
                  prev_page: strings.history.pagination.prev,
                  next_page: strings.history.pagination.next
                }
              }
        }
        locale={{
          emptyText: (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={strings.history.empty} />
          )
        }}
      />

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={strings.history.detail.title}
        width={480}
        extra={
          selected && (
            <Space size={8}>
              {selected.vps_id !== null && onOpenVps && (
                <Button
                  size="small"
                  icon={<CloudServerOutlined />}
                  onClick={() => {
                    if (selected.vps_id !== null) {
                      setSelectedVpsId(selected.vps_id)
                      onOpenVps()
                      setSelected(null)
                    }
                  }}
                >
                  {strings.dashboard.viewVps}
                </Button>
              )}
              {selected.app_id !== null && selected.app_id !== undefined && onOpenApps && (
                <Button
                  size="small"
                  icon={<AppstoreOutlined />}
                  onClick={() => {
                    if (selected.app_id) {
                      setSelectedAppId(selected.app_id)
                      onOpenApps()
                      setSelected(null)
                    }
                  }}
                >
                  {strings.dashboard.apps.openApp}
                </Button>
              )}
            </Space>
          )
        }
      >
        {selected && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={strings.history.detail.time}>
              {localDateTime(selected.ts)}
            </Descriptions.Item>
            <Descriptions.Item label={strings.history.detail.vps}>
              {selected.vps_id === null
                ? '—'
                : (vpsNameById.get(selected.vps_id) ?? strings.dashboard.recent.unknownVps)}
            </Descriptions.Item>
            <Descriptions.Item label={strings.history.detail.action}>
              {actionLabel(selected.action)}
            </Descriptions.Item>
            <Descriptions.Item label={strings.history.detail.status}>
              {selected.status === null ? '—' : statusLabel(selected.status)}
            </Descriptions.Item>
          </Descriptions>
        )}
        {selected?.message && (
          <Typography.Paragraph style={{ marginTop: 16 }}>
            {strings.history.detail.message}: {selected.message}
          </Typography.Paragraph>
        )}
        <Typography.Title level={5} style={{ marginTop: 24 }}>
          {strings.history.detail.fields}
        </Typography.Title>
        {detailItems.length === 0 ? (
          <Typography.Text type="secondary">{strings.history.detail.emptyFields}</Typography.Text>
        ) : (
          <Descriptions column={1} size="small" bordered items={detailItems} />
        )}
      </Drawer>
    </section>
  )
}
