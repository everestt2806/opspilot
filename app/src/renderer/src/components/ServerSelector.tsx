import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { MenuProps } from 'antd'
import {
  CheckCircleFilled,
  CloudServerOutlined,
  CopyOutlined,
  DeleteOutlined,
  FilterOutlined,
  ReloadOutlined,
  WarningOutlined
} from '@ant-design/icons'

import type { Vps } from '@shared/ipc'

import { strings } from '../strings'
import { localDateTime, relativeTime } from '../utils/format'
import { rowDisplayStatus, type RowDisplayStatus, type RowResourceState } from '../vpsResources'

export type StatusFilterKey = 'all' | RowDisplayStatus

interface ServerSelectorProps {
  items: Vps[]
  resources: Record<number, RowResourceState | undefined>
  appCounts: Record<number, number>
  loading: boolean
  search: string
  /** Id các VPS đang đánh dấu ở cột checkbox — state chung để header chính đếm số máy đang chọn */
  selectedIds: number[]
  onSelect: (vps: Vps) => void
  onSearchChange: (search: string) => void
  /** Bấm checkbox từng hàng hoặc ô chọn tất cả */
  onSelectionChange: (ids: number[]) => void
  onAddVps: () => void
  onDelete: (vps: Vps) => void
  onRetryResources: (vpsId: number) => void
}

const STATUS_TAG: Record<RowDisplayStatus, { color: string; label: string }> = {
  checking: { color: 'processing', label: strings.vps.status.checking },
  online: { color: 'success', label: strings.vps.status.online },
  offline: { color: 'error', label: strings.vps.status.offline },
  unknown: { color: 'default', label: strings.vps.status.unknown }
}

const FILTER_MENU: MenuProps['items'] = [
  { key: 'all', label: strings.vpsControl.selector.filterAll },
  { key: 'online', label: strings.vps.status.online },
  { key: 'offline', label: strings.vps.status.offline },
  { key: 'checking', label: strings.vps.status.checking },
  { key: 'unknown', label: strings.vpsControl.selector.filterUnknown }
]

/** Danh sách VPS — header bảng luôn hiện; toolbar search + filter dropdown. */
export function ServerSelector({
  items,
  resources,
  appCounts,
  loading,
  search,
  selectedIds,
  onSelect,
  onSearchChange,
  onSelectionChange,
  onAddVps,
  onDelete,
  onRetryResources
}: ServerSelectorProps): React.JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>('all')
  const [pageSize, setPageSize] = useState(10)

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((vps) => {
      if (query && !`${vps.name} ${vps.host}`.toLowerCase().includes(query)) return false
      if (statusFilter === 'all') return true
      return rowDisplayStatus(vps, resources[vps.id]) === statusFilter
    })
  }, [items, resources, search, statusFilter])

  async function copyIp(host: string, event: React.MouseEvent): Promise<void> {
    event.stopPropagation()
    if (!navigator.clipboard) return
    await navigator.clipboard.writeText(host)
  }

  const columns = [
    {
      title: strings.vps.columns.name,
      dataIndex: 'name',
      key: 'name',
      width: 170,
      ellipsis: true,
      render: (name: string) => (
        <Typography.Text strong ellipsis>
          <CloudServerOutlined style={{ color: 'var(--info)', marginRight: 8 }} />
          {name}
        </Typography.Text>
      )
    },
    {
      title: strings.vps.columns.ip,
      dataIndex: 'host',
      key: 'host',
      width: 152,
      render: (host: string) => (
        <span onClick={(event) => event.stopPropagation()} role="presentation">
          <span className="mono-text">{host}</span>
          <Tooltip title={strings.vpsControl.selector.copyIp}>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              aria-label={strings.vpsControl.selector.copyIp}
              onClick={(event) => void copyIp(host, event)}
            />
          </Tooltip>
        </span>
      )
    },
    {
      title: strings.vps.columns.status,
      key: 'status',
      width: 100,
      align: 'center' as const,
      render: (_: unknown, vps: Vps) => {
        const tag = STATUS_TAG[rowDisplayStatus(vps, resources[vps.id])]
        return <Tag color={tag.color}>{tag.label}</Tag>
      }
    },
    {
      title: strings.vps.columns.docker,
      key: 'docker',
      width: 124,
      ellipsis: true,
      render: (_: unknown, vps: Vps) =>
        vps.docker_version ? (
          <span>
            <CheckCircleFilled className="step-icon-ok" style={{ marginRight: 6 }} />
            <span className="mono-text">{vps.docker_version}</span>
          </span>
        ) : (
          <span>
            <WarningOutlined className="step-icon-fail" style={{ marginRight: 6 }} />
            {strings.vpsControl.selector.dockerMissing}
          </span>
        )
    },
    {
      title: strings.vps.columns.site,
      key: 'site',
      width: 52,
      align: 'center' as const,
      render: (_: unknown, vps: Vps) => (
        <Typography.Text type="secondary">{appCounts[vps.id] ?? 0}</Typography.Text>
      )
    },
    {
      title: strings.vps.columns.lastConnection,
      key: 'lastConnection',
      width: 148,
      render: (_: unknown, vps: Vps) => {
        const status = rowDisplayStatus(vps, resources[vps.id])
        if (status === 'offline' || status === 'checking') {
          return (
            <span onClick={(event) => event.stopPropagation()} role="presentation">
              <Tag color={status === 'offline' ? 'error' : 'processing'}>
                {STATUS_TAG[status].label}
              </Tag>
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                aria-label={strings.vps.resources.retry(vps.name)}
                onClick={() => onRetryResources(vps.id)}
              />
            </span>
          )
        }
        if (vps.last_seen_at) {
          return (
            <Tooltip title={localDateTime(vps.last_seen_at)}>
              <span className="mono-text" style={{ fontSize: 12 }}>
                {relativeTime(vps.last_seen_at)}
              </span>
            </Tooltip>
          )
        }
        return (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {strings.vpsControl.overview.neverSeen}
          </Typography.Text>
        )
      }
    },
    {
      title: strings.vps.columns.actions,
      key: 'actions',
      width: 52,
      align: 'center' as const,
      render: (_: unknown, vps: Vps) => (
        <Button
          danger
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          aria-label={strings.vps.actions.delete(vps.name)}
          onClick={(event) => {
            event.stopPropagation()
            onDelete(vps)
          }}
        />
      )
    }
  ]

  const filterActive = statusFilter !== 'all'
  const showTable = !loading && items.length > 0

  return (
    <Card
      className="panel-selector panel-selector-full server-list-card"
      title={strings.vps.listCardTitle}
      styles={{ body: { padding: '12px 16px 16px' } }}
    >
      {showTable && (
        <div className="server-list-toolbar">
          <Input
            allowClear
            className="server-list-search"
            placeholder={strings.vpsControl.selector.searchPlaceholder}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <Dropdown
            trigger={['click']}
            menu={{
              selectable: true,
              selectedKeys: [statusFilter],
              items: FILTER_MENU,
              onClick: ({ key }) => setStatusFilter(key as StatusFilterKey)
            }}
          >
            <Badge dot={filterActive} color="var(--info)">
              <Button
                icon={<FilterOutlined />}
                aria-label={strings.vpsControl.selector.filterButton}
              />
            </Badge>
          </Dropdown>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin size="small" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <Empty description={strings.vps.empty}>
          <Button type="primary" onClick={onAddVps}>
            {strings.vps.createFirst}
          </Button>
        </Empty>
      )}

      {showTable && (
        <Table<Vps>
          className="server-list-table"
          rowKey="id"
          size="small"
          dataSource={visible}
          columns={columns}
          scroll={{ x: 840 }}
          rowSelection={{
            selectedRowKeys: selectedIds,
            preserveSelectedRowKeys: true,
            onChange: (keys) => onSelectionChange(keys.map(Number))
          }}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={strings.history.empty} />
            )
          }}
          pagination={{
            pageSize,
            size: 'small',
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            showTotal: (total, range) =>
              strings.vpsControl.selector.pageTotal(range[0], range[1], total),
            onShowSizeChange: (_current, size) => setPageSize(size)
          }}
          onRow={(vps) => ({
            onClick: () => onSelect(vps),
            style: { cursor: 'pointer' }
          })}
        />
      )}
    </Card>
  )
}
