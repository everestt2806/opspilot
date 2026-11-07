import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import type {
  DesktopControllerConnection,
  DesktopControllerSnapshot,
  DesktopControllerAppStatus
} from '@shared/desktopController'
import type {
  DesktopControllerCommand,
  DesktopControllerCommandInput
} from '@shared/desktopControllerCommands'
import { useUiState } from '../store/uiState'
import { CONTROLLER_COMMAND_COPY } from './controllerCommandCopy'

export function ControllerCommandPanel({
  binding,
  snapshot,
  fresh
}: {
  binding: DesktopControllerConnection
  snapshot: DesktopControllerSnapshot
  fresh: boolean
}): React.JSX.Element {
  const locale = useUiState((value) => value.locale),
    t = CONTROLLER_COMMAND_COPY[locale],
    { modal } = App.useApp()
  const [appId, setAppId] = useState<number | null>(null),
    [rows, setRows] = useState<DesktopControllerCommand[]>([]),
    [error, setError] = useState<string | null>(null),
    [historyError, setHistoryError] = useState(false),
    [historyLoading, setHistoryLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [statusLoading, setStatusLoading] = useState(false),
    [status, setStatus] = useState<DesktopControllerAppStatus | null>(null),
    [now, setNow] = useState(() => Date.now())
  const alive = useRef(true),
    listEpoch = useRef(0),
    statusEpoch = useRef(0),
    selected = useRef<number | null>(null),
    latest = useRef({ binding, snapshot, fresh })
  useEffect(() => {
    latest.current = { binding, snapshot, fresh }
  }, [binding, snapshot, fresh])
  const load = useCallback(async (): Promise<void> => {
    const epoch = ++listEpoch.current
    setHistoryLoading(true)
    try {
      const response = await window.api.invoke('controller:commands', binding.binding_id)
      if (!alive.current || epoch !== listEpoch.current) return
      if (
        !response?.ok ||
        !Array.isArray(response.data) ||
        response.data.some(
          (row) =>
            row.binding_id !== binding.binding_id || row.controller_id !== binding.controller_id
        )
      ) {
        setHistoryError(true)
        setRows([])
        return
      }
      setHistoryError(false)
      setRows(response.data)
    } catch {
      if (alive.current && epoch === listEpoch.current) {
        setHistoryError(true)
        setRows([])
      }
    } finally {
      if (alive.current && epoch === listEpoch.current) setHistoryLoading(false)
    }
  }, [binding.binding_id, binding.controller_id])
  const invalidateReads = useCallback((): void => {
    listEpoch.current++
    statusEpoch.current++
  }, [])
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
      invalidateReads()
    }
  }, [load, invalidateReads])
  const readStatus = async (id: number): Promise<void> => {
    const epoch = ++statusEpoch.current
    setStatusLoading(true)
    setStatus(null)
    try {
      const response = await window.api.invoke('controller:app-status', {
        binding_id: binding.binding_id,
        app_id: id
      })
      if (!alive.current || epoch !== statusEpoch.current || selected.current !== id) return
      if (
        !response?.ok ||
        response.data.binding_id !== binding.binding_id ||
        response.data.controller_id !== binding.controller_id ||
        response.data.binding_revision !== binding.revision ||
        response.data.app_id !== id
      ) {
        setError(t.failed)
        return
      }
      setStatus(response.data)
      setNow(Date.now())
    } catch {
      if (alive.current && epoch === statusEpoch.current) setError(t.failed)
    } finally {
      if (alive.current && epoch === statusEpoch.current) setStatusLoading(false)
    }
  }
  const app = snapshot.items.find((value) => value.app_id === appId),
    pending = rows.some(
      (row) =>
        row.app_id === appId && ['prepared', 'in_flight', 'outcome_unknown'].includes(row.state)
    )
  const permitted = (operation: 'redeploy' | 'pause' | 'resume'): boolean =>
    binding.scopes.includes(operation === 'redeploy' ? 'deploy:manual' : 'policy:write') &&
    fresh &&
    snapshot.capabilities[operation] === 'available' &&
    !!app &&
    !pending &&
    !historyError &&
    !historyLoading &&
    !statusLoading &&
    status?.app_id === app?.app_id &&
    status?.ownership_generation === app?.ownership_generation &&
    status?.source_generation === app?.source_generation &&
    status?.data_freshness === 'current' &&
    Math.abs(now - Date.parse(status.checked_at)) <= 30000 &&
    !busy &&
    (operation !== 'redeploy' || !!app.desired_sha)
  const confirm = (operation: 'redeploy' | 'pause' | 'resume'): void => {
    if (!app || !permitted(operation)) return
    const captured = app
    const current = (): boolean => {
      const value = latest.current,
        currentApp = value.snapshot.items.find((item) => item.app_id === captured.app_id)
      return (
        alive.current &&
        selected.current === captured.app_id &&
        value.binding.binding_id === binding.binding_id &&
        value.binding.revision === binding.revision &&
        value.fresh &&
        Math.abs(Date.now() - Date.parse(value.snapshot.checked_at)) <= 30000 &&
        value.snapshot.capabilities[operation] === 'available' &&
        !!currentApp &&
        currentApp.ownership_generation === captured.ownership_generation &&
        currentApp.source_generation === captured.source_generation &&
        (operation !== 'redeploy' || currentApp.desired_sha === captured.desired_sha)
      )
    }
    modal.confirm({
      title:
        operation === 'redeploy'
          ? t.confirmDeploy
          : operation === 'pause'
            ? t.confirmPause
            : t.confirmResume,
      content: (
        <Space direction="vertical">
          <Typography.Text strong>{captured.app_name}</Typography.Text>
          {operation === 'redeploy' && (
            <Typography.Text code>{captured.desired_sha}</Typography.Text>
          )}
        </Space>
      ),
      okText: t.ok,
      cancelText: t.back,
      onOk: async () => {
        if (!current()) {
          setError(t.changed)
          return
        }
        setBusy(true)
        setError(null)
        try {
          const common = {
            binding_id: binding.binding_id,
            app_id: captured.app_id,
            expected_ownership_generation: captured.ownership_generation,
            expected_source_generation: captured.source_generation
          }
          const input: DesktopControllerCommandInput =
            operation === 'redeploy'
              ? {
                  ...common,
                  operation,
                  target: { kind: 'specific_sha', sha: captured.desired_sha! }
                }
              : { ...common, operation: 'policy', action: operation }
          const prepared = await window.api.invoke('controller:prepare-command', input)
          if (!alive.current) return
          if (!prepared?.ok) {
            setError(t.failed)
            await load()
            return
          }
          const row = prepared.data
          if (
            !current() ||
            row.state !== 'prepared' ||
            row.binding_id !== binding.binding_id ||
            row.binding_revision !== binding.revision ||
            row.controller_id !== binding.controller_id ||
            row.app_id !== captured.app_id ||
            row.operation !== input.operation
          ) {
            setError(t.changed)
            await load()
            return
          }
          const sent = await window.api.invoke('controller:send-command', row.request_key)
          if (!alive.current) return
          if (!sent?.ok) setError(t.failed)
          await load()
          if (selected.current === captured.app_id) await readStatus(captured.app_id)
        } catch {
          if (alive.current) {
            setError(t.failed)
            await load()
          }
        } finally {
          if (alive.current) setBusy(false)
        }
      }
    })
  }
  const checkOrCancel = async (row: DesktopControllerCommand, cancel = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = cancel
        ? await window.api.invoke('controller:cancel-command', row.request_key)
        : await window.api.invoke('controller:check-command', row.request_key)
      if (!alive.current) return
      if (!result?.ok) setError(t.failed)
      await load()
      if (selected.current !== null) await readStatus(selected.current)
    } catch {
      if (alive.current) setError(t.failed)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const label = (value: string | null): string =>
    value === null
      ? '—'
      : value === 'failed'
        ? t.failedState
        : value in t
          ? t[value as keyof typeof t]
          : value
  const statusFresh =
    status?.data_freshness === 'current' && Math.abs(now - Date.parse(status.checked_at)) <= 30000
  return (
    <Card
      className="controller-command-panel"
      size="small"
      title={t.title}
      style={{ marginTop: 20 }}
    >
      {error && <Alert type="error" showIcon message={error} />}
      {!binding.scopes.includes('deploy:manual') && !binding.scopes.includes('policy:write') && (
        <Alert type="info" message={t.readOnly} />
      )}
      {!fresh && <Alert type="warning" message={t.stale} />}
      <Space wrap style={{ marginBlock: 12 }}>
        <Select
          aria-label={t.choose}
          placeholder={t.choose}
          value={appId}
          style={{ width: 240 }}
          disabled={busy}
          options={Array.from(
            new Map([
              ...rows.map(
                (row) => [row.app_id, { value: row.app_id, label: `#${row.app_id}` }] as const
              ),
              ...snapshot.items.map(
                (item) => [item.app_id, { value: item.app_id, label: item.app_name }] as const
              )
            ]).values()
          )}
          onChange={(id: number) => {
            selected.current = id
            statusEpoch.current++
            setAppId(id)
            setError(null)
            void readStatus(id)
          }}
        />
        <Button
          type="primary"
          disabled={!permitted('redeploy')}
          onClick={() => confirm('redeploy')}
        >
          {t.deploy}
        </Button>
        <Button disabled={!permitted('pause')} onClick={() => confirm('pause')}>
          {t.pause}
        </Button>
        <Button disabled={!permitted('resume')} onClick={() => confirm('resume')}>
          {t.resume}
        </Button>
      </Space>
      {app && (
        <Typography.Paragraph type="secondary">
          {app.production_ref} ·{' '}
          <Typography.Text code>{app.desired_sha?.slice(0, 12) ?? '—'}</Typography.Text>
          {!app.desired_sha && ` · ${t.noCommit}`}
        </Typography.Paragraph>
      )}
      {app && !Object.values(snapshot.capabilities).some((value) => value === 'available') && (
        <Typography.Paragraph>{t.blocked}</Typography.Paragraph>
      )}
      {appId !== null && (
        <section aria-label={t.status}>
          <Space>
            <Typography.Text strong>{t.status}</Typography.Text>
            <Button
              size="small"
              loading={statusLoading}
              disabled={busy}
              onClick={() => void readStatus(appId)}
            >
              {t.refresh}
            </Button>
          </Space>
          {!status && !statusLoading && <Typography.Paragraph>{t.noStatus}</Typography.Paragraph>}
          {status && (
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: 'deployment',
                  label: t.deployment,
                  children: (
                    <>
                      {status.current_deployment_id ? `#${status.current_deployment_id}` : '—'} ·{' '}
                      {label(status.current_deployment_state)}
                    </>
                  )
                },
                {
                  key: 'job',
                  label: t.job,
                  children: (
                    <>
                      {status.latest_job_id ?? '—'} ·{' '}
                      <Tag
                        color={
                          statusFresh && status.latest_job_state === 'succeeded'
                            ? 'success'
                            : status.latest_job_state === 'failed'
                              ? 'error'
                              : 'default'
                        }
                      >
                        {label(status.latest_job_state)}
                      </Tag>
                    </>
                  )
                },
                {
                  key: 'checked',
                  label: t.checked,
                  children: (
                    <>
                      {new Date(status.checked_at).toLocaleString()}
                      {!statusFresh && ` · ${t.stale}`}
                    </>
                  )
                }
              ]}
            />
          )}
        </section>
      )}
      <Space style={{ marginTop: 16 }}>
        <Typography.Text strong>{t.journal}</Typography.Text>
        <Button size="small" disabled={busy} onClick={() => void load()}>
          {t.refresh}
        </Button>
      </Space>
      {historyError && <Alert type="error" message={t.historyError} />}
      {rows.some((row) => ['in_flight', 'outcome_unknown'].includes(row.state)) && (
        <Alert type="warning" showIcon message={t.unknownHint} />
      )}
      {rows.some((row) => row.state === 'accepted') && (
        <Alert type="info" message={t.acceptedHint} />
      )}
      {rows.some((row) => row.state === 'prepared') && (
        <Typography.Paragraph>{t.preparedHint}</Typography.Paragraph>
      )}
      <Table
        size="small"
        rowKey="request_key"
        dataSource={rows}
        pagination={{ pageSize: 5, hideOnSinglePage: true }}
        scroll={{ x: 580 }}
        locale={{ emptyText: historyError ? t.historyError : <Empty description={t.empty} /> }}
        columns={[
          {
            title: 'ID',
            dataIndex: 'request_key',
            render: (key: string, row) => (
              <>
                <Typography.Text code title={key}>
                  {key.slice(0, 8)}
                </Typography.Text>
                <br />#{row.app_id} · {row.operation === 'redeploy' ? t.deploy : t.policy}
              </>
            )
          },
          {
            title: t.requestState,
            dataIndex: 'state',
            render: (state: DesktopControllerCommand['state'], row) => (
              <>
                <Tag
                  color={
                    state === 'outcome_unknown'
                      ? 'warning'
                      : state === 'rejected'
                        ? 'error'
                        : 'default'
                  }
                >
                  {t[state]}
                </Tag>
                {row.job_id && <Typography.Text code>{row.job_id}</Typography.Text>}
              </>
            )
          },
          {
            title: t.updated,
            dataIndex: 'updated_at',
            render: (value: string) => new Date(value).toLocaleString()
          },
          {
            title: '',
            key: 'actions',
            render: (_value, row) =>
              row.state === 'prepared' ? (
                <Button size="small" disabled={busy} onClick={() => void checkOrCancel(row, true)}>
                  {t.cancel}
                </Button>
              ) : ['in_flight', 'outcome_unknown', 'accepted'].includes(row.state) ? (
                <Button size="small" disabled={busy} onClick={() => void checkOrCancel(row)}>
                  {t.refresh}
                </Button>
              ) : null
          }
        ]}
      />
    </Card>
  )
}
