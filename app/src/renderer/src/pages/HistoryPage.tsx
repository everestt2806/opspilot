import { useCallback, useEffect, useState } from 'react'
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
import type { Dayjs } from 'dayjs'
import { HistoryOutlined } from '@ant-design/icons'

import type { ActionLogEntry, IpcError, Vps } from '@shared/ipc'

import { strings } from '../strings'
import { localDateTime, relativeTime } from '../utils/format'

const PAGE_SIZE = 20
const QUERY_LIMIT = 200

type HistoryFilter = {
  actions?: string[]
  vps_id?: number
  from_ts?: string
  to_ts?: string
  limit: number
  offset: number
}

const ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'deploy', label: strings.dashboard.actions.deploy },
  { value: 'rollback_auto', label: strings.dashboard.actions.rollback_auto },
  { value: 'rollback_manual', label: strings.dashboard.actions.rollback_manual }
]

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

export function HistoryPage(): React.JSX.Element {
  const [rows, setRows] = useState<ActionLogEntry[]>([])
  const [vpsList, setVpsList] = useState<Vps[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<IpcError | null>(null)
  const [actions, setActions] = useState<string[]>([])
  const [vpsId, setVpsId] = useState<number | undefined>(undefined)
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [selected, setSelected] = useState<ActionLogEntry | null>(null)

  const load = useCallback(async () => {
    try {
      const filter: HistoryFilter = {
        actions: actions.length > 0 ? actions : undefined,
        vps_id: vpsId,
        from_ts: range ? range[0].startOf('day').toDate().toISOString() : undefined,
        to_ts: range ? range[1].endOf('day').toDate().toISOString() : undefined,
        limit: QUERY_LIMIT,
        offset: 0
      }
      const result = await window.api.invoke('history:list', filter)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      setRows(result.data)
    } finally {
      setLoading(false)
    }
  }, [actions, vpsId, range])

  useEffect(() => {
    void (async () => {
      const result = await window.api.invoke('vps:list')
      if (result.ok) setVpsList(result.data)
    })()
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function reload(): void {
    setLoading(true)
    void load()
  }

  function handleRangeChange(dates: [Dayjs | null, Dayjs | null] | null): void {
    if (dates && dates[0] && dates[1]) {
      setRange([dates[0], dates[1]])
    } else {
      setRange(null)
    }
  }

  const vpsNameById = new Map(vpsList.map((vps) => [vps.id, vps.name]))

  const columns = [
    {
      title: strings.history.columns.time,
      dataIndex: 'ts',
      key: 'ts',
      width: 150,
      align: 'center' as const,
      render: (ts: string) => (
        <Tooltip title={localDateTime(ts)}>
          <span className="mono-text">{relativeTime(ts)}</span>
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
        <Tag color={ACTION_COLORS[action]}>
          {strings.dashboard.actions[action as keyof typeof strings.dashboard.actions] ?? action}
        </Tag>
      )
    },
    {
      title: strings.history.columns.vps,
      dataIndex: 'vps_id',
      key: 'vps_id',
      width: 150,
      align: 'center' as const,
      render: (id: number | null) =>
        id === null ? '—' : (vpsNameById.get(id) ?? strings.dashboard.recent.unknownVps)
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
            <span>{strings.dashboard.statuses[status]}</span>
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
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <Typography.Title level={2} style={{ color: 'var(--text-primary)', margin: 0 }}>
            <HistoryOutlined style={{ marginRight: 10, color: 'var(--info)' }} />
            {strings.history.title}
          </Typography.Title>
          <Typography.Text type="secondary">{strings.history.description}</Typography.Text>
        </div>
      </div>

      <Space wrap size={8} style={{ marginBottom: 12 }}>
        <Select
          mode="multiple"
          allowClear
          placeholder={strings.history.filters.actionAll}
          aria-label={strings.history.filters.action}
          style={{ minWidth: 200 }}
          value={actions}
          onChange={setActions}
          options={ACTION_OPTIONS}
        />
        <Select
          allowClear
          placeholder={strings.history.filters.vpsAll}
          aria-label={strings.history.filters.vps}
          style={{ minWidth: 160 }}
          value={vpsId}
          onChange={(value) => setVpsId(value)}
          options={vpsList.map((vps) => ({ value: vps.id, label: `${vps.name} — ${vps.host}` }))}
        />
        <DatePicker.RangePicker
          aria-label={strings.history.filters.timeRange}
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
        pagination={{
          pageSize: PAGE_SIZE,
          showSizeChanger: false,
          hideOnSinglePage: true
        }}
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
            <Descriptions.Item label={strings.history.detail.status}>
              {selected.status === null ? '—' : strings.dashboard.statuses[selected.status]}
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
