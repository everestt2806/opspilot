import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import type {
  DesktopControllerConnection,
  DesktopControllerRegisterInput,
  DesktopControllerSnapshot
} from '@shared/desktopController'
import type { IpcError, Vps } from '@shared/ipc'
import { useUiState } from '../store/uiState'
import { CONTROLLER_COPY, CONTROLLER_FEEDBACK } from './controllerCopy'
import { ControllerCommandPanel } from './ControllerCommandPanel'
import { ControllerProjectPanel } from './ControllerProjectPanel'
import { ControllerInstallWizard } from './ControllerInstallWizard'
import { CONTROLLER_INSTALLER_COPY } from './controllerInstallerCopy'
import { ControllerTargetRegistrationPanel } from './ControllerTargetRegistrationPanel'
import { CONTROLLER_COMMAND_COPY } from './controllerCommandCopy'

function errorCode(error: IpcError | undefined): string {
  return error?.technical && /^[A-Z_]{1,80}$/.test(error.technical)
    ? error.technical
    : 'CONTROLLER_UNAVAILABLE'
}
export function ControllerPanel(): React.JSX.Element {
  const locale = useUiState((state) => state.locale),
    t = CONTROLLER_COPY[locale],
    { modal } = App.useApp()
  const [rows, setRows] = useState<DesktopControllerConnection[]>([]),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [open, setOpen] = useState(false),
    [installerOpen, setInstallerOpen] = useState(false),
    [vps, setVps] = useState<Vps[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [snapshot, setSnapshot] = useState<DesktopControllerSnapshot | null>(null),
    [snapshotLoading, setSnapshotLoading] = useState(false),
    [snapshotError, setSnapshotError] = useState<string | null>(null),
    [now, setNow] = useState(() => Date.now())
  const [form] = Form.useForm<DesktopControllerRegisterInput>()
  const alive = useRef(true),
    listEpoch = useRef(0),
    snapshotEpoch = useRef(0),
    selectedRef = useRef<string | null>(null),
    registrationId = useRef<string>('')
  const closeSnapshot = useCallback((): void => {
    snapshotEpoch.current++
    selectedRef.current = null
    setSelected(null)
    setSnapshot(null)
    setSnapshotError(null)
    setSnapshotLoading(false)
  }, [])
  const load = useCallback(async (): Promise<void> => {
    const epoch = ++listEpoch.current
    setLoading(true)
    setError(null)
    try {
      const response = await window.api.invoke('controller:list')
      if (!alive.current || epoch !== listEpoch.current) return
      if (!response?.ok) {
        setError(errorCode(response?.error))
        return
      }
      setRows(response.data)
      const current = response.data.find((row) => row.binding_id === selectedRef.current)
      if (selectedRef.current && (!current || current.state !== 'active')) closeSnapshot()
    } catch {
      if (alive.current && epoch === listEpoch.current) setError('CONTROLLER_UNAVAILABLE')
    } finally {
      if (alive.current && epoch === listEpoch.current) setLoading(false)
    }
  }, [closeSnapshot])
  useEffect(() => {
    alive.current = true
    let mounted = true
    queueMicrotask(() => {
      if (mounted) void load()
    })
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive.current = false
      mounted = false
      clearInterval(timer)
    }
  }, [load])
  const readApps = async (bindingId: string, more = false): Promise<void> => {
    const epoch = ++snapshotEpoch.current
    selectedRef.current = bindingId
    setSelected(bindingId)
    setSnapshotLoading(true)
    setSnapshotError(null)
    const before = more ? snapshot : null
    if (!more) setSnapshot(null)
    try {
      const response = await window.api.invoke('controller:apps', {
        binding_id: bindingId,
        ...(before?.next_cursor ? { cursor: before.next_cursor } : {})
      })
      if (!alive.current || epoch !== snapshotEpoch.current || selectedRef.current !== bindingId)
        return
      if (!response?.ok) {
        setSnapshotError(errorCode(response?.error))
        setSnapshot(null)
        return
      }
      if (
        response.data.binding_id !== bindingId ||
        (before &&
          (before.binding_revision !== response.data.binding_revision ||
            before.controller_id !== response.data.controller_id))
      ) {
        setSnapshot(null)
        setSnapshotError('BINDING_CHANGED')
        return
      }
      const combined = before ? [...before.items, ...response.data.items] : response.data.items
      setSnapshot({
        ...response.data,
        items: [...new Map(combined.map((app) => [app.app_id, app])).values()]
      })
      setNow(Date.now())
    } catch {
      if (alive.current && epoch === snapshotEpoch.current) {
        setSnapshotError('CONTROLLER_UNAVAILABLE')
        setSnapshot(null)
      }
    } finally {
      if (alive.current && epoch === snapshotEpoch.current) setSnapshotLoading(false)
    }
  }
  const action = async (
    kind: 'retry' | 'revoke' | 'disconnect',
    row: DesktopControllerConnection
  ): Promise<void> => {
    setBusy(row.binding_id)
    setError(null)
    if (selectedRef.current === row.binding_id) closeSnapshot()
    try {
      const response =
        kind === 'retry'
          ? await window.api.invoke('controller:retry-enrollment', row.binding_id)
          : kind === 'revoke'
            ? await window.api.invoke('controller:revoke', row.binding_id)
            : await window.api.invoke('controller:disconnect', row.binding_id)
      if (!alive.current) return
      await load()
      if (!response?.ok) setError(errorCode(response?.error))
    } catch {
      if (alive.current) setError('CONTROLLER_UNAVAILABLE')
    } finally {
      if (alive.current) setBusy(null)
    }
  }
  const add = async (): Promise<void> => {
    setError(null)
    try {
      const response = await window.api.invoke('vps:list')
      if (!alive.current) return
      if (!response?.ok) {
        setError(errorCode(response?.error))
        return
      }
      setVps(response.data)
      form.resetFields()
      registrationId.current = crypto.randomUUID()
      setOpen(true)
    } catch {
      if (alive.current) setError('CONTROLLER_UNAVAILABLE')
    }
  }
  const register = async (input: DesktopControllerRegisterInput): Promise<void> => {
    setBusy('register')
    setError(null)
    try {
      const response = await window.api.invoke('controller:register', {
        ...input,
        binding_id: registrationId.current
      })
      if (!alive.current) return
      setOpen(false)
      await load()
      if (!response?.ok) setError(errorCode(response?.error))
    } catch {
      if (alive.current) {
        setOpen(false)
        await load()
        setError('CONTROLLER_UNAVAILABLE')
      }
    } finally {
      if (alive.current) setBusy(null)
    }
  }
  const feedback = CONTROLLER_FEEDBACK[locale]
  const explainError = (code: string): React.JSX.Element => {
    const message = [
      'BINDING_UNAVAILABLE',
      'BINDING_CHANGED',
      'CONTROLLER_IDENTITY_MISMATCH'
    ].includes(code)
      ? feedback.binding
      : ['CLIENT_REVOKED', 'CREDENTIAL_REVOKED', 'CREDENTIAL_EXPIRED', 'AUTH_REQUIRED'].includes(
            code
          )
        ? feedback.auth
        : ['CONTROLLER_BUNDLE_VERIFICATION_FAILED', 'CONTROLLER_NODE_UNSUPPORTED'].includes(code)
          ? feedback.bundle
          : code === 'REQUEST_INVALID'
            ? feedback.invalid
            : feedback.network
    return (
      <>
        <Typography.Paragraph>{message}</Typography.Paragraph>
        <details>
          <summary>{feedback.details}</summary>
          <Typography.Text code>{code}</Typography.Text>
        </details>
      </>
    )
  }
  const fresh = snapshot
    ? snapshot.data_freshness === 'current' &&
      Math.abs(now - Date.parse(snapshot.checked_at)) <= 30000
      ? 'current'
      : snapshot.data_freshness === 'unknown'
        ? 'unknown'
        : 'stale'
    : 'unknown'
  return (
    <Card
      title={t.title}
      className="controller-panel"
      extra={
        <Space wrap>
          <Button onClick={() => void load()} loading={loading} disabled={busy !== null}>
            {t.refresh}
          </Button>
          <Button type="primary" onClick={() => setInstallerOpen(true)} disabled={busy !== null}>
            {CONTROLLER_INSTALLER_COPY[locale].title}
          </Button>
          <Button onClick={() => void add()} disabled={busy !== null}>
            {t.add}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">{t.intro}</Typography.Paragraph>
      {error && (
        <Alert type="error" showIcon message={t.failed} description={explainError(error)} />
      )}
      <Table<DesktopControllerConnection>
        size="small"
        rowKey="binding_id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: error ? t.loadError : t.empty }}
        scroll={{ x: 640 }}
        columns={[
          {
            title: t.name,
            dataIndex: 'display_name',
            render: (name: string, row) => (
              <>
                <Typography.Text strong>{name}</Typography.Text>
                <br />
                <Typography.Text type="secondary">{row.controller_id}</Typography.Text>
              </>
            )
          },
          {
            title: t.service,
            dataIndex: 'state',
            render: (state: DesktopControllerConnection['state']) => <Tag>{t[state]}</Tag>
          },
          {
            title: t.expires,
            dataIndex: 'credential_expires_at',
            render: (stamp: string | null) => (stamp ? new Date(stamp).toLocaleString() : '—')
          },
          {
            title: '',
            key: 'actions',
            render: (_value, row) => (
              <Space wrap>
                {row.state === 'active' && (
                  <Button
                    size="small"
                    onClick={() => void readApps(row.binding_id)}
                    disabled={busy !== null}
                  >
                    {t.view}
                  </Button>
                )}
                {['pending', 'delivery_unknown'].includes(row.state) && (
                  <Button
                    size="small"
                    onClick={() => void action('retry', row)}
                    loading={busy === row.binding_id}
                    disabled={busy !== null}
                  >
                    {t.retry}
                  </Button>
                )}
                {row.state !== 'disabled' && row.remote_client_id && (
                  <Button
                    size="small"
                    danger
                    disabled={busy !== null}
                    onClick={() =>
                      modal.confirm({
                        title: t.revokeConfirm,
                        content: CONTROLLER_COMMAND_COPY[locale].disconnectWarning,
                        okText: t.ok,
                        cancelText: t.cancel,
                        onOk: () => action('revoke', row)
                      })
                    }
                  >
                    {t.revoke}
                  </Button>
                )}
                {row.state !== 'disabled' && (
                  <Button
                    size="small"
                    disabled={busy !== null}
                    onClick={() =>
                      modal.confirm({
                        title: t.disconnectConfirm,
                        content: CONTROLLER_COMMAND_COPY[locale].disconnectWarning,
                        okText: t.ok,
                        cancelText: t.cancel,
                        onOk: () => action('disconnect', row)
                      })
                    }
                  >
                    {t.disconnect}
                  </Button>
                )}
              </Space>
            )
          }
        ]}
      />
      {rows.some((row) => row.state === 'delivery_unknown') && (
        <Alert type="warning" showIcon message={t.delivery_unknown} description={t.deliveryHelp} />
      )}
      {selected && (
        <section style={{ marginTop: 24 }} aria-label={t.apps}>
          <Space wrap>
            <Typography.Title level={4}>{t.apps}</Typography.Title>
            <Button onClick={() => void readApps(selected)} disabled={snapshotLoading}>
              {t.refresh}
            </Button>
            <Button onClick={closeSnapshot}>{t.back}</Button>
          </Space>
          {snapshotError && (
            <Alert
              type="error"
              showIcon
              message={t.loadError}
              description={explainError(snapshotError)}
            />
          )}
          {snapshotLoading && <Typography.Paragraph role="status">{t.busy}</Typography.Paragraph>}
          {snapshot && (
            <>
              <Descriptions
                size="small"
                column={2}
                items={[
                  {
                    key: 'status',
                    label: t.service,
                    children: (
                      <Tag
                        color={
                          fresh === 'current' && snapshot.service_state === 'ready'
                            ? 'success'
                            : 'default'
                        }
                      >
                        {t[snapshot.service_state]}
                      </Tag>
                    )
                  },
                  {
                    key: 'checked',
                    label: t.checked,
                    children: new Date(snapshot.checked_at).toLocaleString()
                  }
                ]}
              />
              {fresh !== 'current' && (
                <Alert type="warning" message={fresh === 'stale' ? t.stale : t.unknown} />
              )}
              <Table
                rowKey="app_id"
                size="small"
                dataSource={snapshot.items}
                pagination={false}
                locale={{ emptyText: <Empty description={t.noApps} /> }}
                scroll={{ x: 620 }}
                columns={[
                  { title: t.appName, dataIndex: 'app_name' },
                  { title: t.branch, dataIndex: 'production_ref' },
                  {
                    title: t.commit,
                    dataIndex: 'desired_sha',
                    render: (sha: string | null) => (
                      <Typography.Text code>{sha?.slice(0, 12) ?? '—'}</Typography.Text>
                    )
                  },
                  {
                    title: t.policy,
                    dataIndex: 'auto_deploy_paused',
                    render: (paused: boolean) => (paused ? t.paused : t.enabled)
                  },
                  {
                    title: t.reconciliation,
                    dataIndex: 'reconciliation_state',
                    render: (
                      value:
                        | 'pending'
                        | 'queued'
                        | 'in_progress'
                        | 'satisfied'
                        | 'paused'
                        | 'failed'
                        | 'uncertain'
                        | null
                    ) => (value ? feedback[value] : '—')
                  }
                ]}
              />
              {snapshot.has_more && (
                <Button onClick={() => void readApps(selected, true)} loading={snapshotLoading}>
                  {t.more}
                </Button>
              )}
            </>
          )}
          {rows.find((row) => row.binding_id === selected)?.state === 'active' &&
            (() => {
              const binding = rows.find((row) => row.binding_id === selected)!
              return (
                <>
                  <ControllerTargetRegistrationPanel
                    key={`target:${binding.binding_id}:${binding.revision}`}
                    binding={binding}
                  />
                  <ControllerProjectPanel
                    key={`project:${binding.binding_id}:${binding.revision}`}
                    binding={binding}
                  />
                  <ControllerCommandPanel
                    key={`${binding.binding_id}:${binding.revision}`}
                    binding={binding}
                    fresh={fresh === 'current'}
                    snapshot={
                      snapshot ?? {
                        binding_id: binding.binding_id,
                        binding_revision: binding.revision,
                        controller_id: binding.controller_id,
                        service_state: 'maintenance',
                        data_freshness: 'unknown',
                        checked_at: binding.updated_at,
                        capabilities: { redeploy: 'blocked', pause: 'blocked', resume: 'blocked' },
                        items: [],
                        next_cursor: null,
                        has_more: false
                      }
                    }
                  />
                </>
              )
            })()}
        </section>
      )}
      <ControllerInstallWizard
        open={installerOpen}
        onClose={() => setInstallerOpen(false)}
        onChanged={() => void load()}
      />
      <Modal
        title={t.add}
        open={open}
        onCancel={() => {
          if (busy !== 'register') setOpen(false)
        }}
        footer={null}
        destroyOnHidden
        style={{ top: 32 }}
        styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } }}
        maskClosable={busy !== 'register'}
        closable={busy !== 'register'}
      >
        <Alert type="info" message={t.pinHint} showIcon />
        <Form
          form={form}
          layout="vertical"
          onFinish={(input) => void register(input)}
          disabled={busy === 'register'}
          style={{ marginTop: 16 }}
        >
          <Form.Item name="vps_id" label={t.vps} rules={[{ required: true, message: t.required }]}>
            <Select
              options={vps.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.host}`,
                disabled: !item.host_fingerprint
              }))}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">{t.fingerprint}</Typography.Paragraph>
          {(
            [
              'display_name',
              'controller_id',
              'artifact_path',
              'data_directory',
              'node_path',
              'manifest_sha256'
            ] as const
          ).map((field) => (
            <Form.Item
              key={field}
              name={field}
              label={
                t[
                  (
                    {
                      display_name: 'name',
                      controller_id: 'controllerId',
                      artifact_path: 'artifact',
                      data_directory: 'data',
                      node_path: 'node',
                      manifest_sha256: 'pin'
                    } as const
                  )[field]
                ]
              }
              rules={[
                { required: true, whitespace: true, message: t.required },
                ...(field === 'manifest_sha256'
                  ? [{ pattern: /^[a-f0-9]{64}$/, message: 'SHA256: 64 hex' }]
                  : [])
              ]}
            >
              <Input autoComplete="off" maxLength={field === 'manifest_sha256' ? 64 : 512} />
            </Form.Item>
          ))}
          <Form.Item name="allow_write" valuePropName="checked">
            <Checkbox>{CONTROLLER_COMMAND_COPY[locale].writeOptIn}</Checkbox>
          </Form.Item>
          <Typography.Paragraph type="secondary">
            {CONTROLLER_COMMAND_COPY[locale].writeHint}
          </Typography.Paragraph>
          <Space>
            <Button type="primary" htmlType="submit" loading={busy === 'register'}>
              {t.register}
            </Button>
            <Button onClick={() => setOpen(false)} disabled={busy === 'register'}>
              {t.cancel}
            </Button>
          </Space>
        </Form>
      </Modal>
    </Card>
  )
}
