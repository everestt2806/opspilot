import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Descriptions, Modal, Space, Tag, Typography } from 'antd'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopProjectSetup } from '@shared/desktopProjectRegistration'
import type { DesktopPostgresContext, DesktopPostgresIntent } from '@shared/desktopProductPostgres'
import { useUiState } from '../store/uiState'
import { CONTROLLER_DATABASE_COPY } from './controllerDatabaseCopy'
import { ControllerPostgresInspector } from './ControllerPostgresInspector'

type Props = {
  binding: DesktopControllerConnection
  project: DesktopProjectSetup
  onSourceChanged?: () => void
}
const pending = (row: DesktopPostgresIntent): boolean =>
  ['prepared', 'in_flight', 'outcome_unknown'].includes(row.state)

export function ControllerProjectDatabase(props: Props): React.JSX.Element {
  return <DatabaseSession key={JSON.stringify([props.binding, props.project])} {...props} />
}

function DatabaseSession({ binding, project, onSourceChanged }: Props): React.JSX.Element {
  const t = CONTROLLER_DATABASE_COPY[useUiState((s) => s.locale)],
    alive = useRef(true),
    epoch = useRef(0),
    busy = useRef(false)
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(false),
    [contextError, setContextError] = useState(false),
    [context, setContext] = useState<DesktopPostgresContext | null>(null),
    [rows, setRows] = useState<DesktopPostgresIntent[]>([]),
    [loaded, setLoaded] = useState(false)
  const allowed =
    binding.state === 'active' &&
    binding.scopes.includes('deploy:manual') &&
    binding.scopes.includes('policy:write') &&
    project.state === 'registered' &&
    project.framework !== 'static-spa' &&
    project.binding_id === binding.binding_id &&
    project.binding_revision === binding.revision &&
    project.controller_id === binding.controller_id
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const matches = (value: DesktopPostgresContext | DesktopPostgresIntent): boolean =>
    !!value &&
    value.project_request_key === project.request_key &&
    value.binding_id === binding.binding_id &&
    value.binding_revision === binding.revision &&
    value.controller_id === binding.controller_id &&
    value.app_id === project.app_id
  const validContext = (value: DesktopPostgresContext): boolean =>
    matches(value) &&
    Number.isSafeInteger(value.source_generation) &&
    value.source_generation > 0 &&
    /^[a-f0-9]{64}$/.test(value.source_config_sha256) &&
    Number.isSafeInteger(value.ownership_generation) &&
    value.ownership_generation > 0 &&
    typeof value.auto_deploy_paused === 'boolean' &&
    !!value.database &&
    [value.database.prepared, value.database.selected].every(
      (metadata) =>
        metadata === null ||
        (!!metadata &&
          metadata.controller_id === binding.controller_id &&
          metadata.app_id === project.app_id &&
          metadata.ownership_generation === value.ownership_generation &&
          metadata.provisioning === 'prepared' &&
          metadata.engine === 'postgresql')
    ) &&
    (!value.database.selected ||
      value.database.selected.database_id === value.database.prepared?.database_id)
  const load = async (): Promise<void> => {
    if (!allowed || busy.current) return
    busy.current = true
    const token = ++epoch.current
    setLoading(true)
    setConsent(false)
    setError(false)
    setContextError(false)
    try {
      const [metadata, intents] = await Promise.allSettled([
        window.api.invoke('controller:postgres-context', project.request_key),
        window.api.invoke('controller:postgres-intents', project.request_key)
      ])
      if (!alive.current || token !== epoch.current) return
      if (metadata.status === 'fulfilled' && metadata.value.ok && validContext(metadata.value.data))
        setContext(metadata.value.data)
      else {
        setContext(null)
        setContextError(true)
      }
      if (
        intents.status === 'fulfilled' &&
        intents.value.ok &&
        Array.isArray(intents.value.data) &&
        intents.value.data.every(matches)
      ) {
        setRows(intents.value.data)
        setLoaded(true)
      } else {
        setLoaded(false)
        setError(true)
      }
    } finally {
      if (alive.current && token === epoch.current) {
        busy.current = false
        setLoading(false)
      }
    }
  }
  const replace = (value: DesktopPostgresIntent): void =>
    setRows((previous) => [value, ...previous.filter((r) => r.request_key !== value.request_key)])
  const hasPending = rows.some(pending)
  const prepare = async (operation: 'prepare' | 'select'): Promise<void> => {
    if (
      !allowed ||
      busy.current ||
      !loaded ||
      !context ||
      !consent ||
      hasPending ||
      contextError ||
      error ||
      !context.auto_deploy_paused
    )
      return
    const database = context.database.prepared
    if ((operation === 'select' && !database) || (operation === 'prepare' && database)) return
    busy.current = true
    const token = epoch.current
    setLoading(true)
    setError(false)
    try {
      const basis = {
        project_request_key: project.request_key,
        expected_binding_revision: binding.revision,
        expected_source_generation: context.source_generation,
        expected_source_config_sha256: context.source_config_sha256
      }
      const result = await window.api.invoke(
        'controller:prepare-postgres-intent',
        operation === 'select'
          ? { ...basis, operation, database_id: database!.database_id }
          : { ...basis, operation }
      )
      if (!alive.current || token !== epoch.current) return
      if (
        !result.ok ||
        !matches(result.data) ||
        result.data.operation !== operation ||
        result.data.source_generation !== context.source_generation ||
        result.data.source_config_sha256 !== context.source_config_sha256 ||
        (operation === 'select' && result.data.database_id !== database?.database_id)
      )
        throw Error()
      replace(result.data)
      setConsent(false)
    } catch {
      if (alive.current && token === epoch.current) setError(true)
    } finally {
      if (alive.current && token === epoch.current) {
        busy.current = false
        setLoading(false)
      }
    }
  }
  const action = async (
    row: DesktopPostgresIntent,
    operation: 'send' | 'check' | 'cancel'
  ): Promise<void> => {
    if (
      !allowed ||
      busy.current ||
      !loaded ||
      !pending(row) ||
      (operation === 'send' && (row.state !== 'prepared' || !consent || error || contextError)) ||
      (operation === 'cancel' && row.state !== 'prepared')
    )
      return
    busy.current = true
    const token = epoch.current
    setLoading(true)
    setError(false)
    let refresh = false
    try {
      const channel =
        operation === 'send'
          ? 'controller:send-postgres-intent'
          : operation === 'check'
            ? 'controller:check-postgres-intent'
            : 'controller:cancel-postgres-intent'
      const result = await window.api.invoke(channel, row.request_key)
      if (!alive.current || token !== epoch.current) return
      if (
        !result.ok ||
        !matches(result.data) ||
        result.data.request_key !== row.request_key ||
        result.data.operation !== row.operation ||
        result.data.source_generation !== row.source_generation ||
        result.data.source_config_sha256 !== row.source_config_sha256
      )
        throw Error()
      replace(result.data)
      setConsent(false)
      refresh = !pending(result.data)
      if (result.data.state === 'selected' || result.data.state === 'not_applied')
        onSourceChanged?.()
    } catch {
      if (alive.current && token === epoch.current) {
        setError(true)
        // An IPC error cannot establish whether dispatch occurred. Only the Main
        // journal/receipt check can authorize a later send or a new request.
        if (operation === 'send') replace({ ...row, state: 'outcome_unknown' })
      }
    } finally {
      if (alive.current && token === epoch.current) {
        busy.current = false
        setLoading(false)
      }
    }
    if (refresh && alive.current && token === epoch.current) await load()
  }
  const close = (): void => {
    ++epoch.current
    busy.current = false
    setOpen(false)
    setConsent(false)
    setContext(null)
    setRows([])
    setLoaded(false)
    setLoading(false)
    setError(false)
  }
  return (
    <>
      <Button
        size="small"
        disabled={!allowed}
        onClick={() => {
          setOpen(true)
          void load()
        }}
      >
        {t.open}
      </Button>
      <Modal
        title={`${t.title} · ${project.app_name}`}
        open={open}
        onCancel={close}
        footer={null}
        width={720}
        centered
        styles={{ body: { maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' } }}
        destroyOnHidden
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph>{t.note}</Typography.Paragraph>
          <Alert type="info" showIcon message={t.lifecycle} />
          {contextError && <Alert type="warning" showIcon message={t.unavailable} />}
          {error && <Alert type="error" showIcon message={t.failure} />}
          {context && (
            <>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label={t.source}>{context.source_generation}</Descriptions.Item>
                <Descriptions.Item label="PostgreSQL 16">
                  {context.database.prepared ? t.prepared : t.none}
                </Descriptions.Item>
                <Descriptions.Item label={t.database}>
                  <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                    {context.database.prepared?.database_id ?? '—'}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label={t.selected}>
                  {context.database.selected ? t.selected : t.unselected}
                </Descriptions.Item>
              </Descriptions>
              {!context.auto_deploy_paused && <Alert type="warning" showIcon message={t.paused} />}
            </>
          )}
          {rows.some((r) => r.state === 'outcome_unknown' || r.state === 'in_flight') && (
            <Alert type="warning" showIcon message={t.unknown} />
          )}
          <Checkbox
            checked={consent}
            disabled={loading || !context || contextError || error}
            onChange={(e) => setConsent(e.target.checked)}
          >
            {t.consent}
          </Checkbox>
          {context && loaded && (
            <Space wrap>
              {!context.database.prepared && (
                <Button
                  disabled={
                    loading || !consent || hasPending || error || !context.auto_deploy_paused
                  }
                  onClick={() => void prepare('prepare')}
                >
                  {t.create}
                </Button>
              )}
              {context.database.prepared && (
                <Button
                  disabled={
                    loading || !consent || hasPending || error || !context.auto_deploy_paused
                  }
                  onClick={() => void prepare('select')}
                >
                  {t.select}
                </Button>
              )}
            </Space>
          )}
          {rows.length > 0 && <Typography.Text strong>{t.history}</Typography.Text>}
          {rows.map((row) => (
            <Space
              key={row.request_key}
              direction="vertical"
              style={{ width: '100%', paddingBlock: 6 }}
            >
              <Space wrap>
                <Typography.Text>
                  {row.operation === 'prepare' ? t.prepare : t.choose}
                </Typography.Text>
                <Tag>{t.states[row.state]}</Tag>
              </Space>
              <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>
                {row.request_key}
              </Typography.Text>
              {pending(row) && (
                <Space wrap>
                  {row.state === 'prepared' && (
                    <Button
                      disabled={loading || !consent || error || contextError}
                      onClick={() => void action(row, 'send')}
                    >
                      {t.send}
                    </Button>
                  )}
                  <Button disabled={loading} onClick={() => void action(row, 'check')}>
                    {t.check}
                  </Button>
                  {row.state === 'prepared' && (
                    <Button disabled={loading} onClick={() => void action(row, 'cancel')}>
                      {t.cancel}
                    </Button>
                  )}
                </Space>
              )}
            </Space>
          ))}
          <Space wrap>
            <Button disabled={loading} onClick={() => void load()}>
              {t.refresh}
            </Button>
            <Button onClick={close}>{t.close}</Button>
          </Space>
        </Space>
      </Modal>
      <ControllerPostgresInspector binding={binding} project={project} />
    </>
  )
}
