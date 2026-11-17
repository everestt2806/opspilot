import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography
} from 'antd'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopProjectSetup } from '@shared/desktopProjectRegistration'
import type { DesktopPostgresContext } from '@shared/desktopProductPostgres'
import type { DesktopProjectReconnection } from '@shared/desktopProjectReconnection'
import type { ProductPostgresMetadata } from '@shared/productPostgres'
import type {
  ProductPostgresInspectionOperation,
  ProductPostgresTable
} from '@shared/productPostgresInspection'
import { useUiState } from '../store/uiState'
import { POSTGRES_INSPECTOR_COPY } from './postgresInspectorCopy'

type Props = { binding: DesktopControllerConnection } & (
  | { project: DesktopProjectSetup; reconnection?: never }
  | { reconnection: DesktopProjectReconnection; project?: never }
)
type InspectorContext = {
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  database: { selected: ProductPostgresMetadata | null }
}
type Failure = 'unavailable' | 'changed' | 'notReady' | 'limit' | 'timeout'
const cellText = (value: unknown): string =>
  value === undefined
    ? '—'
    : value === null
      ? 'NULL'
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
const sameRead = (
  a: ProductPostgresInspectionOperation,
  b: ProductPostgresInspectionOperation
): boolean =>
  !!a &&
  a.operation === b.operation &&
  (b.operation !== 'rows' ||
    (a.operation === 'rows' && a.schema === b.schema && a.table === b.table && a.limit === b.limit))

export function ControllerPostgresInspector(props: Props): React.JSX.Element {
  return (
    <InspectorSession
      key={JSON.stringify([props.binding, props.project, props.reconnection])}
      {...props}
    />
  )
}
function InspectorSession({ binding, project, reconnection }: Props): React.JSX.Element {
  const t = POSTGRES_INSPECTOR_COPY[useUiState((s) => s.locale)]
  const alive = useRef(true),
    epoch = useRef(0)
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [context, setContext] = useState<InspectorContext | null>(null),
    [contextError, setContextError] = useState(false),
    [error, setError] = useState<Failure | null>(null),
    [tables, setTables] = useState<ProductPostgresTable[] | null>(null),
    [selected, setSelected] = useState<ProductPostgresTable | null>(null),
    [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null),
    [limit, setLimit] = useState(25),
    [snapshot, setSnapshot] = useState<string | null>(null),
    [receivedAt, setReceivedAt] = useState<number | null>(null),
    [stale, setStale] = useState(false)
  // View model cục bộ; không tạo DesktopProjectSetup giả cho app nhận lại.
  const identity = reconnection
    ? {
        key: reconnection.request_key,
        appId: reconnection.app_id,
        appName: reconnection.context.app_name,
        targetRevision: reconnection.context.scope.target.ssh_security_revision
      }
    : {
        key: project.request_key,
        appId: project.app_id,
        appName: project.app_name,
        targetRevision: project.target_security_revision
      }
  const sourceAllowed = reconnection
    ? reconnection.provenance === 'explicit_reconnection_v1' &&
      reconnection.binding_id === binding.binding_id &&
      reconnection.binding_revision === binding.revision &&
      reconnection.controller_id === binding.controller_id &&
      reconnection.context.source.configuration.framework !== 'static-spa'
    : project.state === 'registered' &&
      project.framework !== 'static-spa' &&
      project.binding_id === binding.binding_id &&
      project.binding_revision === binding.revision &&
      project.controller_id === binding.controller_id
  const allowed =
    binding.state === 'active' &&
    sourceAllowed &&
    (['read', 'deploy:manual', 'policy:write'] as const).every((scope) =>
      binding.scopes.includes(scope)
    )
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (receivedAt === null) return
    const timer = setTimeout(() => setStale(true), Math.max(0, receivedAt + 60000 - Date.now()))
    return () => clearTimeout(timer)
  }, [receivedAt])
  const clear = (): void => {
    setTables(null)
    setSelected(null)
    setRows(null)
    setSnapshot(null)
    setReceivedAt(null)
    setStale(false)
  }
  const matches = (c: DesktopPostgresContext): boolean =>
    !!c &&
    c.project_request_key === identity.key &&
    c.binding_id === binding.binding_id &&
    c.binding_revision === binding.revision &&
    c.controller_id === binding.controller_id &&
    c.app_id === identity.appId &&
    Number.isSafeInteger(c.ownership_generation) &&
    c.ownership_generation > 0 &&
    Number.isSafeInteger(c.source_generation) &&
    c.source_generation > 0 &&
    /^[a-f0-9]{64}$/.test(c.source_config_sha256) &&
    !!c.database &&
    (!c.database.selected ||
      (c.database.selected.database_id === c.database.prepared?.database_id &&
        c.database.selected.controller_id === c.controller_id &&
        c.database.selected.app_id === c.app_id &&
        c.database.selected.ownership_generation === c.ownership_generation))
  const loadContext = async (): Promise<void> => {
    if (!allowed) return
    const token = ++epoch.current
    clear()
    setError(null)
    setContext(null)
    setContextError(false)
    setLoading(true)
    try {
      if (reconnection) {
        const result = await window.api.invoke(
          'controller:current-project-reconnection',
          identity.key
        )
        if (!alive.current || token !== epoch.current) return
        if (!result.ok) throw Error()
        const r = result.data
        if (
          !r ||
          r.request_key !== identity.key ||
          r.provenance !== 'explicit_reconnection_v1' ||
          r.binding_id !== binding.binding_id ||
          r.binding_revision !== binding.revision ||
          r.controller_id !== binding.controller_id ||
          r.app_id !== identity.appId ||
          r.snapshot_sha256 !== reconnection.snapshot_sha256 ||
          r.context.snapshot_sha256 !== r.snapshot_sha256 ||
          r.context.scope.app_id !== identity.appId ||
          r.context.scope.controller_id !== binding.controller_id ||
          r.context.scope.target.ssh_security_revision !== identity.targetRevision ||
          (r.context.selected_database &&
            (r.context.selected_database.app_id !== identity.appId ||
              r.context.selected_database.controller_id !== binding.controller_id ||
              r.context.selected_database.ownership_generation !==
                r.context.scope.ownership_generation))
        )
          throw Error()
        setContext({
          ownership_generation: r.context.scope.ownership_generation,
          source_generation: r.context.source.generation,
          source_config_sha256: r.context.source.config_sha256,
          database: { selected: r.context.selected_database }
        })
      } else {
        const result = await window.api.invoke('controller:postgres-context', identity.key)
        if (!alive.current || token !== epoch.current) return
        if (!result.ok || !matches(result.data)) throw Error()
        setContext(result.data)
      }
    } catch {
      if (alive.current && token === epoch.current) setContextError(true)
    } finally {
      if (alive.current && token === epoch.current) setLoading(false)
    }
  }
  const read = async (
    operation: ProductPostgresInspectionOperation,
    table?: ProductPostgresTable
  ): Promise<void> => {
    if (!allowed || !context?.database.selected || contextError) return
    const token = ++epoch.current
    setLoading(true)
    setError(null)
    setRows(null)
    setSnapshot(null)
    setReceivedAt(null)
    setStale(false)
    if (operation.operation === 'tables') {
      setTables(null)
      setSelected(null)
    } else setSelected(table ?? null)
    try {
      const result = reconnection
        ? await window.api.invoke('controller:inspect-reconnected-postgres', {
            reconnection_request_key: identity.key,
            expected_binding_revision: binding.revision,
            expected_snapshot_sha256: reconnection.snapshot_sha256,
            database_id: context.database.selected.database_id,
            read: operation
          })
        : await window.api.invoke('controller:inspect-postgres', {
            project_request_key: identity.key,
            expected_binding_revision: binding.revision,
            expected_source_generation: context.source_generation,
            expected_source_config_sha256: context.source_config_sha256,
            database_id: context.database.selected.database_id,
            read: operation
          })
      if (!alive.current || token !== epoch.current) return
      if (!result.ok) {
        const code = result.error.technical ?? ''
        const kind: Failure = [
          'POSTGRES_CHANGED',
          'RECONNECTION_CHANGED',
          'POSTGRES_INSPECTION_AUTHORITY_CHANGED',
          'BINDING_CHANGED',
          'BINDING_UNAVAILABLE'
        ].includes(code)
          ? 'changed'
          : code === 'POSTGRES_INSPECTION_NOT_READY'
            ? 'notReady'
            : code === 'POSTGRES_INSPECTION_RESULT_LIMIT'
              ? 'limit'
              : ['POSTGRES_INSPECTION_TIMEOUT', 'REQUEST_TIMEOUT'].includes(code)
                ? 'timeout'
                : 'unavailable'
        clear()
        setError(kind)
        if (kind === 'changed' || code === 'RECONNECTION_UNAVAILABLE') setContext(null)
        return
      }
      const value = result.data
      if (
        !value ||
        (reconnection
          ? !('reconnection_request_key' in value) ||
            value.reconnection_request_key !== identity.key ||
            value.snapshot_sha256 !== reconnection.snapshot_sha256
          : !('project_request_key' in value) || value.project_request_key !== identity.key) ||
        value.binding_id !== binding.binding_id ||
        value.binding_revision !== binding.revision ||
        value.context.controller_id !== binding.controller_id ||
        value.context.app_id !== identity.appId ||
        value.context.ownership_generation !== context.ownership_generation ||
        value.context.source_generation !== context.source_generation ||
        value.context.source_config_sha256 !== context.source_config_sha256 ||
        value.context.target_security_revision !== identity.targetRevision ||
        value.context.database.database_id !== context.database.selected.database_id ||
        value.instance.database_id !== context.database.selected.database_id ||
        value.instance.state !== 'ready' ||
        value.instance.public_port !== null ||
        !sameRead(value.read, operation) ||
        !Number.isFinite(Date.parse(value.checked_at))
      ) {
        clear()
        setContext(null)
        setError('changed')
        return
      }
      if (!Array.isArray(value.data)) throw Error()
      if (operation.operation === 'tables') {
        const data = value.data as ProductPostgresTable[]
        if (
          data.length > 200 ||
          data.some(
            (item) =>
              !item ||
              typeof item.schema !== 'string' ||
              typeof item.name !== 'string' ||
              !Array.isArray(item.columns) ||
              item.columns.length > 128 ||
              item.columns.some(
                (c) =>
                  !c ||
                  typeof c.name !== 'string' ||
                  typeof c.data_type !== 'string' ||
                  typeof c.nullable !== 'boolean'
              )
          )
        )
          throw Error()
        setTables(data)
      } else if (operation.operation === 'rows') {
        if (
          value.data.length > operation.limit ||
          value.data.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
        )
          throw Error()
        setRows(value.data as Array<Record<string, unknown>>)
      }
      setSnapshot(value.checked_at)
      setReceivedAt(Date.now())
    } catch {
      if (alive.current && token === epoch.current) {
        clear()
        setError('unavailable')
      }
    } finally {
      if (alive.current && token === epoch.current) setLoading(false)
    }
  }
  const close = (): void => {
    ++epoch.current
    clear()
    setContext(null)
    setOpen(false)
    setLoading(false)
    setContextError(false)
    setError(null)
  }
  return (
    <>
      <Button
        size="small"
        disabled={!allowed}
        title={!allowed ? t.unsupported : undefined}
        onClick={() => {
          setOpen(true)
          void loadContext()
        }}
      >
        {t.open}
      </Button>
      <Modal
        title={`${t.title} · ${identity.appName}`}
        open={open}
        onCancel={close}
        footer={null}
        width={960}
        centered
        destroyOnHidden
        styles={{ body: { maxHeight: 'calc(100vh - 190px)', overflowY: 'auto', minWidth: 0 } }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%', minWidth: 0 }}>
          <Typography.Paragraph type="secondary">{t.note}</Typography.Paragraph>
          {loading && <Typography.Text role="status">{t.loading}</Typography.Text>}
          {!allowed && <Alert type="info" message={t.unsupported} />}
          {contextError && <Alert type="error" message={t.error} />}
          {error && <Alert type="warning" message={t[error]} />}
          {context && !context.database.selected && <Alert type="info" message={t.selection} />}
          {context?.database.selected && (
            <>
              <Descriptions size="small" column={2} bordered>
                <Descriptions.Item label={t.database}>
                  <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                    {context.database.selected.database_id}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label={t.source}>{context.source_generation}</Descriptions.Item>
              </Descriptions>
              <Space wrap>
                <Button loading={loading} onClick={() => void read({ operation: 'tables' })}>
                  {t.load}
                </Button>
                <Typography.Text>{t.count}</Typography.Text>
                <Select
                  aria-label={t.count}
                  value={limit}
                  options={[10, 25, 50, 100].map((value) => ({ value, label: String(value) }))}
                  style={{ width: 90 }}
                  onChange={(value) => {
                    ++epoch.current
                    setLimit(value)
                    setRows(null)
                    setSnapshot(null)
                    setReceivedAt(null)
                    setStale(false)
                    setLoading(false)
                  }}
                />
              </Space>
            </>
          )}
          {snapshot && (
            <Space wrap>
              <Tag color="success">{t.verified}</Tag>
              <Typography.Text type="secondary">
                {t.checked}: {new Date(snapshot).toLocaleString()}
              </Typography.Text>
            </Space>
          )}
          {stale && <Alert type="warning" message={t.stale} />}
          {tables && tables.length === 0 && <Alert type="info" message={t.empty} />}
          {tables && tables.length > 0 && (
            <>
              <Typography.Text strong>{t.tables}</Typography.Text>
              <Space wrap>
                {tables.map((table) => (
                  <Button
                    key={JSON.stringify([table.schema, table.name])}
                    type={
                      selected?.schema === table.schema && selected.name === table.name
                        ? 'primary'
                        : 'default'
                    }
                    style={{
                      maxWidth: '100%',
                      height: 'auto',
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere'
                    }}
                    onClick={() =>
                      void read(
                        { operation: 'rows', schema: table.schema, table: table.name, limit },
                        table
                      )
                    }
                  >
                    {table.schema}.{table.name}
                  </Button>
                ))}
              </Space>
              {!selected && <Typography.Text type="secondary">{t.choose}</Typography.Text>}
            </>
          )}
          {selected && (
            <Tabs
              key={JSON.stringify([selected.schema, selected.name])}
              items={[
                {
                  key: 'rows',
                  label: t.rows,
                  children: (
                    <>
                      <Typography.Paragraph type="secondary">{t.first}</Typography.Paragraph>
                      {rows && (
                        <Table
                          size="small"
                          dataSource={rows.map((values, index) => ({
                            sampleKey: String(index),
                            values
                          }))}
                          rowKey="sampleKey"
                          pagination={false}
                          scroll={{ x: 'max-content', y: 250 }}
                          locale={{ emptyText: t.noRows }}
                          columns={selected.columns.map((column) => ({
                            title: column.name,
                            key: column.name,
                            width: 180,
                            render: (_value, row) => {
                              const text = cellText(row.values[column.name])
                              return (
                                <span title={text}>
                                  {text.length > 160 ? text.slice(0, 160) + '…' : text}
                                </span>
                              )
                            }
                          }))}
                        />
                      )}
                    </>
                  )
                },
                {
                  key: 'columns',
                  label: t.structure,
                  children: (
                    <Table
                      size="small"
                      dataSource={selected.columns}
                      rowKey="name"
                      pagination={{ pageSize: 10, showSizeChanger: false }}
                      scroll={{ x: 'max-content' }}
                      columns={[
                        { title: t.column, dataIndex: 'name', key: 'name' },
                        { title: t.type, dataIndex: 'data_type', key: 'type' },
                        {
                          title: t.nullable,
                          key: 'nullable',
                          render: (_value, column) => (column.nullable ? t.yes : t.no)
                        }
                      ]}
                    />
                  )
                }
              ]}
            />
          )}
          <Space wrap>
            <Button onClick={() => void loadContext()}>{t.refresh}</Button>
            <Button onClick={close}>{t.close}</Button>
          </Space>
        </Space>
      </Modal>
    </>
  )
}
