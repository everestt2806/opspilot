import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'

import type { ActionLogEntry, IpcError } from '@shared/ipc'

import { strings } from '../strings'
import { localDateTime, relativeTime } from '../utils/format'
import { parseDetailJson } from '../utils/parseDetail'

const PAGE_SIZE = 20

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

function actionLabel(action: string): string {
  const map = strings.dashboard.actions as Record<string, string>
  return map[action] ?? action
}

function statusLabel(status: ActionLogEntry['status']): string {
  if (!status) return strings.dashboard.statuses.cancelled
  return strings.dashboard.statuses[status] ?? status
}

interface VpsActivityTabProps {
  vpsId: number
}

/** Tab hoạt động — 20 bản ghi mới nhất của VPS đang chọn. */
export function VpsActivityTab({ vpsId }: VpsActivityTabProps): React.JSX.Element {
  const [rows, setRows] = useState<ActionLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<IpcError | null>(null)
  const [selected, setSelected] = useState<ActionLogEntry | null>(null)

  const load = useCallback(async () => {
    const result = await window.api.invoke('history:list', {
      vps_id: vpsId,
      limit: PAGE_SIZE,
      offset: 0
    })

    setError(result.ok ? null : result.error)
    setRows(result.ok ? result.data : [])
    setSelected(null)
    setLoading(false)
  }, [vpsId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.api.invoke('history:list', {
        vps_id: vpsId,
        limit: PAGE_SIZE,
        offset: 0
      })
      if (cancelled) return
      setError(result.ok ? null : result.error)
      setRows(result.ok ? result.data : [])
      setSelected(null)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [vpsId])

  const columns = [
    {
      title: strings.history.columns.time,
      dataIndex: 'ts',
      key: 'ts',
      width: 140,
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
      width: 130,
      render: (action: string) => (
        <Tag color={ACTION_COLORS[action] ?? 'default'}>{actionLabel(action)}</Tag>
      )
    },
    {
      title: strings.history.columns.status,
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: ActionLogEntry['status']) =>
        status ? (
          <Badge status={STATUS_BADGE[status]} text={statusLabel(status)} />
        ) : (
          '—'
        )
    },
    {
      title: strings.history.columns.message,
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
      render: (message: string | null) => message ?? '—'
    }
  ]

  const detailFields = parseDetailJson(selected?.detail_json ?? null)

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
          {strings.vpsControl.activity.title}
        </Typography.Title>
        <Button onClick={() => void load()} disabled={loading}>
          {strings.common.refresh}
        </Button>
      </div>

      {error && (
        <Alert
          type="error"
          showIcon
          message={strings.vpsControl.activity.loadFailed}
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
        <Empty description={strings.vpsControl.activity.empty}>
          <Typography.Paragraph type="secondary" style={{ maxWidth: 360, margin: '0 auto' }}>
            {strings.vpsControl.activity.emptyHint}
          </Typography.Paragraph>
        </Empty>
      )}

      {!loading && rows.length > 0 && (
        <Table<ActionLogEntry>
          rowKey="id"
          size="small"
          dataSource={rows}
          columns={columns}
          pagination={false}
          onRow={(row) => ({
            onClick: () => setSelected(row),
            style: { cursor: 'pointer' }
          })}
        />
      )}

      <Drawer
        title={strings.history.detail.title}
        open={selected !== null}
        onClose={() => setSelected(null)}
        width={420}
      >
        {selected && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={strings.history.detail.time}>
                {localDateTime(selected.ts)}
              </Descriptions.Item>
              <Descriptions.Item label={strings.history.detail.status}>
                {selected.status ? (
                  <Badge
                    status={STATUS_BADGE[selected.status]}
                    text={statusLabel(selected.status)}
                  />
                ) : (
                  '—'
                )}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Paragraph style={{ marginTop: 12 }}>
              {strings.history.detail.message}: {selected.message ?? '—'}
            </Typography.Paragraph>
            <Typography.Text strong>{strings.history.detail.fields}</Typography.Text>
            {detailFields.length === 0 ? (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                {strings.history.detail.emptyFields}
              </Typography.Text>
            ) : (
              <Descriptions column={1} size="small" bordered style={{ marginTop: 8 }}>
                {detailFields.map(([key, value]) => (
                  <Descriptions.Item key={key} label={key}>
                    <span className="mono-text">{value}</span>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            )}
          </>
        )}
      </Drawer>
    </div>
  )
}
