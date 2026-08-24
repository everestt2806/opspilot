import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Typography,
  Upload
} from 'antd'
import type { TableColumnsType, UploadProps } from 'antd'
import {
  ArrowLeftOutlined,
  ExportOutlined,
  ImportOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined
} from '@ant-design/icons'

import type { DbDatabase, DbSchemaTable, DbUser, IpcError, IpcResult } from '@shared/ipc'

import { DbSchemaDesigner } from './DbSchemaDesigner'
import { strings } from '../strings'
import {
  downloadTextFile,
  exportTableCsv,
  exportTableJson,
  parseCsvImport,
  parseJsonImport,
  type DbTable
} from '../utils/parseDataFile'
import { tablesToDdl } from '../utils/sqlDdl'

interface VpsDatabaseTabProps {
  vpsId: number
}

interface CreateUserValues {
  username: string
  password: string
}

interface CreateDatabaseValues {
  name: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const DATABASE_NAME_RULE = /^[a-z][a-z0-9_]*$/

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** Gọi kênh db:* — backend (A) chưa cài thì trả về lỗi trung thực để UI hiện
 *  trạng thái lỗi thật thay vì giả vờ thành công. */
async function callDb<T>(
  channel: string,
  ...args: unknown[]
): Promise<{ data: T | null; error: IpcError | null }> {
  try {
    const result = (await (window.api.invoke as (ch: string, ...a: unknown[]) => Promise<unknown>)(
      channel,
      ...args
    )) as IpcResult<T>
    if (result.ok) return { data: result.data ?? null, error: null }
    return { data: null, error: result.error }
  } catch (err) {
    return {
      data: null,
      error: {
        code: 'UNKNOWN',
        message: `Kênh ${channel} chưa được backend nối — ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }
}

/** Tab Database — quản lý user + database trên Postgres của VPS: 2 bảng kèm nút
 *  Create mở popup, bấm dòng database xuống trang thiết kế schema (kéo-thả,
 *  PK/FK, import file, SQL preview, lưu schema lên server). */
export function VpsDatabaseTab({ vpsId }: VpsDatabaseTabProps): React.JSX.Element {
  const [users, setUsers] = useState<DbUser[] | null>(null)
  const [usersError, setUsersError] = useState<IpcError | null>(null)

  const [databases, setDatabases] = useState<DbDatabase[] | null>(null)
  const [databasesError, setDatabasesError] = useState<IpcError | null>(null)

  /** Database đang mở — kèm vpsId để đổi máy là tự về danh sách mà không cần effect. */
  const [openDbFor, setOpenDbFor] = useState<{ vpsId: number; name: string } | null>(null)

  interface SchemaState {
    tables: DbSchemaTable[]
    fromServer: boolean
    /** Khoá định danh lần tải: `vpsId:database` — chống hiển thị schema của máy khác. */
    forKey: string
  }
  const [schemaState, setSchemaState] = useState<SchemaState | null>(null)

  const openDbName = openDbFor && openDbFor.vpsId === vpsId ? openDbFor.name : null
  const schemaKey = openDbName !== null ? `${vpsId}:${openDbName}` : null
  const tablesReady = schemaKey !== null && schemaState?.forKey === schemaKey
  const dbTables = tablesReady && schemaState !== null ? schemaState.tables : []
  const designerLocal = tablesReady && schemaState !== null ? !schemaState.fromServer : false

  const updateDbTables = (tables: DbSchemaTable[]): void => {
    if (schemaKey === null || schemaState === null) return
    setSchemaState({ tables, fromServer: schemaState.fromServer, forKey: schemaKey })
  }
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveDetail, setSaveDetail] = useState<string | null>(null)

  const [importedTables, setImportedTables] = useState<DbTable[]>([])
  const [activeImportName, setActiveImportName] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [createDbOpen, setCreateDbOpen] = useState(false)
  const [userSubmitting, setUserSubmitting] = useState(false)
  const [dbSubmitting, setDbSubmitting] = useState(false)
  const [userModalError, setUserModalError] = useState<string | null>(null)
  const [dbModalError, setDbModalError] = useState<string | null>(null)
  const [userForm] = Form.useForm<CreateUserValues>()
  const [dbForm] = Form.useForm<CreateDatabaseValues>()

  const db = strings.vpsControl.database

  const loadUsers = useCallback(async (): Promise<void> => {
    const res = await callDb<DbUser[]>('db:list-users', vpsId)
    setUsersError(res.error)
    setUsers(res.error ? null : (res.data ?? []))
  }, [vpsId])

  const loadDatabases = useCallback(async (): Promise<void> => {
    const res = await callDb<DbDatabase[]>('db:list-databases', vpsId)
    setDatabasesError(res.error)
    setDatabases(res.error ? null : (res.data ?? []))
  }, [vpsId])

  const loadSchemaFor = useCallback(
    async (dbName: string): Promise<void> => {
      const res = await callDb<DbSchemaTable[]>('db:list-tables', vpsId, dbName)
      setSchemaState(
        res.error
          ? { tables: [], fromServer: false, forKey: `${vpsId}:${dbName}` }
          : { tables: res.data ?? [], fromServer: true, forKey: `${vpsId}:${dbName}` }
      )
      setImportedTables([])
      setActiveImportName(null)
      setSaveState('idle')
    },
    [vpsId]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const usersRes = await callDb<DbUser[]>('db:list-users', vpsId)
      const dbsRes = await callDb<DbDatabase[]>('db:list-databases', vpsId)
      if (cancelled) return
      setUsersError(usersRes.error)
      setUsers(usersRes.error ? null : (usersRes.data ?? []))
      setDatabasesError(dbsRes.error)
      setDatabases(dbsRes.error ? null : (dbsRes.data ?? []))
    })()
    return () => {
      cancelled = true
    }
  }, [vpsId])

  const onCreateUser = async (values: CreateUserValues): Promise<void> => {
    setUserSubmitting(true)
    setUserModalError(null)
    const res = await callDb<DbUser>('db:create-user', vpsId, {
      username: values.username,
      password: values.password
    })
    if (res.error) {
      setUserModalError(res.error.technical ?? res.error.message)
    } else {
      setCreateUserOpen(false)
      userForm.resetFields()
      void loadUsers()
    }
    setUserSubmitting(false)
  }

  const onCreateDatabase = async (values: CreateDatabaseValues): Promise<void> => {
    setDbSubmitting(true)
    setDbModalError(null)
    const res = await callDb<DbDatabase>('db:create-database', vpsId, values.name)
    if (res.error) {
      setDbModalError(res.error.technical ?? res.error.message)
    } else {
      setCreateDbOpen(false)
      dbForm.resetFields()
      void loadDatabases()
    }
    setDbSubmitting(false)
  }

  const handleImportFile = async (file: File): Promise<void> => {
    setImportError(null)
    if (!openDbName || schemaKey === null) return
    try {
      const text = await file.text()
      const lower = file.name.toLowerCase()
      const imported = lower.endsWith('.csv')
        ? parseCsvImport(text, file.name.replace(/\.csv$/i, ''))
        : parseJsonImport(text, file.name.replace(/\.json$/i, ''))
      setImportedTables(imported)
      setActiveImportName(imported[0]?.name ?? null)
      setSchemaState({
        tables: imported.map((t) => ({
          name: t.name,
          columns: t.columns.map((c) => ({
            name: c,
            data_type: 'TEXT',
            nullable: true,
            primary_key: false,
            default_value: null
          })),
          foreign_keys: []
        })),
        fromServer: false,
        forKey: schemaKey
      })
      setSaveState('idle')
    } catch {
      setImportError(db.importFailed)
    }
  }

  const uploadProps: UploadProps = {
    showUploadList: false,
    accept: '.json,.csv',
    beforeUpload: (file) => {
      void handleImportFile(file)
      return false
    }
  }

  const activeImport =
    importedTables.find((t) => t.name === activeImportName) ?? importedTables[0] ?? null

  const exportData = (exportFn: (t: DbTable) => string, ext: string, mime: string): void => {
    if (!activeImport) return
    downloadTextFile(`${activeImport.name}.${ext}`, exportFn(activeImport), mime)
  }

  const saveSchema = async (): Promise<void> => {
    if (!openDbName) return
    setSaveState('saving')
    setSaveDetail(null)
    const ddl = tablesToDdl(dbTables)
    const res = await callDb<void>('db:save-schema', vpsId, openDbName, ddl)
    if (res.error) {
      setSaveState('error')
      setSaveDetail(res.error.technical ?? res.error.message)
    } else {
      setSaveState('saved')
    }
  }

  const userColumns: TableColumnsType<DbUser> = [
    { title: db.columns.id, dataIndex: 'oid', key: 'oid', width: 72 },
    { title: db.columns.username, dataIndex: 'username', key: 'username' }
  ]

  const databaseColumns: TableColumnsType<DbDatabase> = [
    { title: db.columns.id, dataIndex: 'oid', key: 'oid', width: 72 },
    { title: db.columns.name, dataIndex: 'name', key: 'name' },
    {
      title: db.columns.size,
      dataIndex: 'size_bytes',
      key: 'size_bytes',
      width: 110,
      render: (v: number) => formatBytes(v)
    },
    {
      title: db.columns.tables,
      dataIndex: 'table_count',
      key: 'table_count',
      width: 90,
      align: 'center'
    }
  ]

  /* ── Trang thiết kế schema cho một database ─────────────────────────────── */
  if (openDbName) {
    const ddl = tablesToDdl(dbTables)
    const importPreviewColumns =
      activeImport?.columns.map((col) => ({
        title: col,
        dataIndex: col,
        key: col,
        ellipsis: true
      })) ?? []

    return (
      <div>
        <div className="db-editor-header">
          <Button
            icon={<ArrowLeftOutlined />}
            aria-label={db.backToDatabases}
            onClick={() => setOpenDbFor(null)}
          >
            {db.backToDatabases}
          </Button>
          <Typography.Title level={5} style={{ margin: 0 }} className="mono-text">
            {openDbName}
          </Typography.Title>
          <Space wrap>
            <Upload {...uploadProps}>
              <Button icon={<ImportOutlined />}>{db.importFile}</Button>
            </Upload>
            <Button
              icon={<ExportOutlined />}
              disabled={!activeImport}
              onClick={() => exportData(exportTableJson, 'json', 'application/json')}
            >
              {db.exportJson}
            </Button>
            <Button
              icon={<ExportOutlined />}
              disabled={!activeImport}
              onClick={() => exportData(exportTableCsv, 'csv', 'text/csv')}
            >
              {db.exportCsv}
            </Button>
            <Button
              icon={<ExportOutlined />}
              disabled={dbTables.length === 0}
              onClick={() =>
                downloadTextFile(`${openDbName}.schema.sql`, tablesToDdl(dbTables), 'text/plain')
              }
            >
              {db.exportSql}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadSchemaFor(openDbName)}>
              {db.refresh}
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saveState === 'saving'}
              disabled={dbTables.length === 0}
              onClick={() => void saveSchema()}
            >
              {db.saveSchema}
            </Button>
          </Space>
        </div>

        {designerLocal && (
          <Alert type="info" showIcon message={db.designerLocal} style={{ marginBottom: 12 }} />
        )}
        {saveState === 'saved' && (
          <Alert type="success" showIcon message={db.schemaSaved} style={{ marginBottom: 12 }} />
        )}
        {saveState === 'error' && (
          <Alert
            type="error"
            showIcon
            message={db.schemaSaveFailed}
            description={saveDetail}
            action={
              <Button size="small" onClick={() => void saveSchema()}>
                {strings.common.retry}
              </Button>
            }
            style={{ marginBottom: 12 }}
          />
        )}
        {importError && (
          <Alert type="error" showIcon message={importError} style={{ marginBottom: 12 }} />
        )}

        {!tablesReady ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : (
          <DbSchemaDesigner tables={dbTables} onChange={updateDbTables} />
        )}

        <div className="db-query-panel" style={{ marginTop: 12 }}>
          <Typography.Text strong>{db.sqlPreview}</Typography.Text>
          <pre className="db-query-log mono-text">{ddl ? `${ddl}\n` : '-- ' + db.noTables}</pre>
        </div>

        {activeImport && (
          <Card
            size="small"
            style={{ marginTop: 12 }}
            title={`${db.dataTitle} — ${activeImport.name} (${db.dataCount(activeImport.rows.length)})`}
            extra={
              importedTables.length > 1 && (
                <Select
                  size="small"
                  style={{ minWidth: 140 }}
                  value={activeImport.name}
                  options={importedTables.map((t) => ({ value: t.name, label: t.name }))}
                  onChange={setActiveImportName}
                />
              )
            }
          >
            <Table
              className="db-import-preview-table"
              size="small"
              rowKey={(_, index) => `${activeImport.name}-${index}`}
              dataSource={activeImport.rows}
              columns={importPreviewColumns}
              pagination={{ pageSize: 5, size: 'small' }}
              scroll={{ x: true }}
            />
          </Card>
        )}
      </div>
    )
  }

  /* ── Trang chủ: 2 bảng Database users + Databases ──────────────────────── */
  return (
    <div className="db-admin-grid">
      <Card
        title={db.usersTitle}
        extra={
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setCreateUserOpen(true)}
          >
            {db.createUser}
          </Button>
        }
      >
        {users === null && !usersError ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin />
          </div>
        ) : usersError ? (
          <Alert
            type="error"
            showIcon
            message={db.loadUsersFailed}
            description={usersError.technical ?? usersError.message}
            action={
              <Button size="small" onClick={() => void loadUsers()}>
                {strings.common.retry}
              </Button>
            }
          />
        ) : (users ?? []).length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={db.usersEmpty} />
        ) : (
          <Table<DbUser>
            size="small"
            rowKey="oid"
            dataSource={users ?? []}
            columns={userColumns}
            pagination={false}
          />
        )}
      </Card>

      <Card
        title={db.databasesTitle}
        extra={
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setCreateDbOpen(true)}
          >
            {db.createDatabase}
          </Button>
        }
      >
        {databases === null && !databasesError ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin />
          </div>
        ) : databasesError ? (
          <Alert
            type="error"
            showIcon
            message={db.loadDatabasesFailed}
            description={databasesError.technical ?? databasesError.message}
            action={
              <Button size="small" onClick={() => void loadDatabases()}>
                {strings.common.retry}
              </Button>
            }
          />
        ) : (databases ?? []).length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={db.databasesEmpty} />
        ) : (
          <Table<DbDatabase>
            size="small"
            rowKey="oid"
            dataSource={databases ?? []}
            columns={databaseColumns}
            pagination={false}
            onRow={(row) => ({
              onClick: () => {
                setSaveState('idle')
                setOpenDbFor({ vpsId, name: row.name })
                void loadSchemaFor(row.name)
              },
              style: { cursor: 'pointer' }
            })}
          />
        )}
      </Card>

      <Modal
        open={createUserOpen}
        title={db.createUserTitle}
        okText={db.createUser}
        confirmLoading={userSubmitting}
        onOk={() => userForm.submit()}
        onCancel={() => setCreateUserOpen(false)}
      >
        <Form<CreateUserValues>
          form={userForm}
          layout="vertical"
          onFinish={(v) => void onCreateUser(v)}
        >
          <Form.Item
            label={db.username}
            name="username"
            rules={[
              { required: true, message: db.usernameRequired },
              { pattern: /^[a-z][a-z0-9_]*$/, message: db.usernameHint }
            ]}
          >
            <Input autoFocus placeholder="blog_admin" />
          </Form.Item>
          <Form.Item
            label={db.password}
            name="password"
            extra={db.passwordHint}
            rules={[{ required: true, message: db.passwordRequired }]}
          >
            <Input.Password />
          </Form.Item>
          {userModalError && (
            <Alert
              type="error"
              showIcon
              message={db.createUserFailed}
              description={userModalError}
            />
          )}
        </Form>
      </Modal>

      <Modal
        open={createDbOpen}
        title={db.createDatabaseTitle}
        okText={db.createDatabase}
        confirmLoading={dbSubmitting}
        onOk={() => dbForm.submit()}
        onCancel={() => setCreateDbOpen(false)}
      >
        <Form<CreateDatabaseValues>
          form={dbForm}
          layout="vertical"
          onFinish={(v) => void onCreateDatabase(v)}
        >
          <Form.Item
            label={db.databaseName}
            name="name"
            rules={[
              { required: true, message: db.databaseNameRequired },
              { pattern: DATABASE_NAME_RULE, message: db.databaseNameInvalid }
            ]}
          >
            <Input autoFocus placeholder="blog" />
          </Form.Item>
          {dbModalError && (
            <Alert
              type="error"
              showIcon
              message={db.createDatabaseFailed}
              description={dbModalError}
            />
          )}
        </Form>
      </Modal>
    </div>
  )
}
