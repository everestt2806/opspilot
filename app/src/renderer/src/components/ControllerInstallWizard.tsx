import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
  Typography
} from 'antd'
import type { IpcResult, Vps } from '@shared/ipc'
import type {
  ControllerInstallerOverview,
  ControllerInstallerReview,
  DesktopInstallation
} from '@shared/controllerInstaller'
import { useUiState } from '../store/uiState'
import { CONTROLLER_INSTALLER_COPY } from './controllerInstallerCopy'

async function checked<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (!result?.ok) {
    const code = result && !result.ok ? result.error.technical : null
    throw Error(
      typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(code)
        ? code
        : 'CONTROLLER_UNAVAILABLE'
    )
  }
  return result.data
}

export function ControllerInstallWizard({
  open,
  onClose,
  onChanged
}: {
  open: boolean
  onClose: () => void
  onChanged: () => void
}): React.JSX.Element {
  const locale = useUiState((s) => s.locale),
    t = CONTROLLER_INSTALLER_COPY[locale]
  const [overview, setOverview] = useState<ControllerInstallerOverview | null>(null),
    [servers, setServers] = useState<Vps[]>([])
  const [vpsId, setVpsId] = useState<number>(),
    [releaseId, setReleaseId] = useState<string>(),
    [name, setName] = useState('')
  const [review, setReview] = useState<ControllerInstallerReview | null>(null),
    [row, setRow] = useState<DesktopInstallation | null>(null)
  const [consent, setConsent] = useState(false),
    [allowWrite, setAllowWrite] = useState(false),
    [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null),
    [connection, setConnection] = useState<'active' | 'delivery_unknown' | null>(null)
  const [checkedRow, setCheckedRow] = useState(false)
  const epoch = useRef(0),
    operation = useRef<number | null>(null),
    visible = useRef(open)
  useLayoutEffect(() => {
    visible.current = open
    epoch.current++
    return () => {
      visible.current = false
    }
  }, [open])
  const current = (token: number): boolean => visible.current && epoch.current === token
  const localRow = (
    data: ControllerInstallerOverview,
    id: number | undefined
  ): DesktopInstallation | null =>
    [...data.installations].reverse().find((v) => v.vps_id === id && v.state !== 'cancelled') ??
    null
  const run = async (action: (token: number) => Promise<void>, label: string): Promise<void> => {
    if (operation.current !== null) return
    const token = ++epoch.current
    operation.current = token
    setBusy(label)
    setError(null)
    try {
      await action(token)
    } catch (cause) {
      if (current(token)) {
        setError(
          cause instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(cause.message)
            ? cause.message
            : 'CONTROLLER_UNAVAILABLE'
        )
        try {
          const data = await checked(window.api.invoke('controller:installer-overview'))
          if (current(token)) {
            setOverview(data)
            setRow(localRow(data, vpsId))
            setCheckedRow(false)
          }
        } catch {
          /* Keep the last receipt visible when the refresh also fails. */
        }
      }
    } finally {
      if (operation.current === token) operation.current = null
      if (current(token)) setBusy(null)
    }
  }
  const load = async (token: number, initial = false): Promise<void> => {
    const [data, vps] = await Promise.all([
      checked(window.api.invoke('controller:installer-overview')),
      checked(window.api.invoke('vps:list'))
    ])
    if (!current(token)) return
    setOverview(data)
    setServers(vps)
    const selected = initial ? vps.find((v) => !!v.host_fingerprint)?.id : vpsId
    const existing = localRow(data, selected)
    setVpsId(selected)
    setRow(existing)
    setCheckedRow(false)
    if (initial) {
      setReleaseId(
        data.releases.find((v) => v.state === 'available')?.release_id ??
          data.releases[0]?.release_id
      )
      const previous = data.connections.find(
        (v) =>
          v.state !== 'disabled' &&
          !!existing &&
          v.installation?.request_key === existing.request_key &&
          v.installation?.authority_revision === existing.authority_revision
      )
      setName(previous?.display_name ?? vps.find((v) => v.id === selected)?.name ?? '')
      setAllowWrite(!!previous?.scopes.includes('deploy:manual'))
    }
  }
  useEffect(() => {
    epoch.current++
    operation.current = null
    if (!open) return
    const token = ++epoch.current
    let alive = true
    queueMicrotask(() => {
      if (!alive) return
      setOverview(null)
      setServers([])
      setReview(null)
      setRow(null)
      setConsent(false)
      setError(null)
      setConnection(null)
      setCheckedRow(false)
      setBusy('check')
      void load(token, true)
        .catch(() => {
          if (current(token)) setError('CONTROLLER_UNAVAILABLE')
        })
        .finally(() => {
          if (current(token)) setBusy(null)
        })
    })
    return () => {
      alive = false
    }
    // Opening owns the load; language changes only replace copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const close = (): void => {
    visible.current = false
    epoch.current++
    onClose()
  }
  const select = (id: number): void => {
    epoch.current++
    setVpsId(id)
    setName(servers.find((v) => v.id === id)?.name ?? '')
    setReview(null)
    setConsent(false)
    setConnection(null)
    setError(null)
    setCheckedRow(false)
    setRow(overview ? localRow(overview, id) : null)
    setAllowWrite(false)
  }
  const preflight = (): Promise<void> =>
    run(async (token) => {
      if (!vpsId || !releaseId) return
      setReview(null)
      setConsent(false)
      setConnection(null)
      setCheckedRow(false)
      const value = await checked(
        window.api.invoke('controller:review-installation', {
          vps_id: vpsId,
          release_id: releaseId
        })
      )
      if (current(token)) {
        setReview(value)
        if (value.plan) setReleaseId(value.plan.release_id)
      }
    }, 'check')
  const inspect = async (
    value: DesktopInstallation,
    token: number
  ): Promise<DesktopInstallation> => {
    const updated = await checked(
      window.api.invoke('controller:inspect-installation', value.request_key)
    )
    if (current(token)) {
      setRow(updated)
      setCheckedRow(true)
    }
    return updated
  }
  const connect = async (value: DesktopInstallation, token: number): Promise<void> => {
    if (!current(token) || !consent || !name.trim()) return
    setBusy('connect')
    const input = {
      installation_request_key: value.request_key,
      display_name: name.trim(),
      allow_write: allowWrite
    }
    const prepared = await checked(window.api.invoke('controller:prepare-installed-binding', input))
    if (!current(token)) return
    const result = await checked(
      window.api.invoke('controller:register-installed', {
        ...input,
        binding_id: prepared.binding_id
      })
    )
    if (current(token)) {
      setConnection(result.state === 'active' ? 'active' : 'delivery_unknown')
      onChanged()
    }
  }
  const freshInstall = (): Promise<void> =>
    run(async (token) => {
      if (!review?.plan || !consent) return
      let value: DesktopInstallation
      if (review.plan.rebind_required) {
        value = await checked(
          window.api.invoke('controller:rebind-installation', {
            plan_id: review.plan.plan_id,
            request_key: review.plan.request_key,
            confirm: true
          })
        )
        if (current(token))
          setReview((previous) =>
            previous?.plan
              ? { ...previous, plan: { ...previous.plan, rebind_required: false } }
              : previous
          )
      } else
        value = await checked(
          window.api.invoke('controller:prepare-installation', { plan_id: review.plan.plan_id })
        )
      if (!current(token)) return
      setRow(value)
      if (review.next === 'inspect_existing' || value.state === 'outcome_unknown') {
        await inspect(value, token)
        return
      }
      if (value.state === 'prepared') {
        setBusy('transfer')
        value = await checked(
          window.api.invoke('controller:send-installation', {
            request_key: value.request_key,
            operation: 'transfer',
            consent: true
          })
        )
        if (!current(token)) return
        setRow(value)
      }
      if (value.state === 'transferred') {
        setBusy('install')
        value = await checked(
          window.api.invoke('controller:send-installation', {
            request_key: value.request_key,
            operation: 'install',
            consent: true
          })
        )
        if (!current(token)) return
        setRow(value)
        setCheckedRow(true)
      }
      if (value.state === 'installed' && value.last_result?.service_state === 'running')
        await connect(value, token)
    }, 'check')
  const send = (kind: 'transfer' | 'install' | 'recover'): Promise<void> =>
    run(
      async (token) => {
        if (!row || !consent) return
        const value = await checked(
          window.api.invoke('controller:send-installation', {
            request_key: row.request_key,
            operation: kind,
            consent: true
          })
        )
        if (!current(token)) return
        setRow(value)
        setCheckedRow(kind !== 'transfer')
        if (kind === 'transfer') await inspect(value, token)
      },
      kind === 'transfer' ? 'transfer' : 'install'
    )
  const selected = servers.find((v) => v.id === vpsId),
    asset = overview?.releases.find((v) => v.release_id === releaseId)
  const hostCanMutate =
    review &&
    !review.root_required &&
    !review.host.reasons.some((v) => v !== 'EXISTING_INSTALLATION')
  const rebindRequired = !!review?.plan?.rebind_required
  const canWrite = !!consent && !busy && !!name.trim() && !rebindRequired
  const service = row?.last_result?.service_state
  const step = connection ? 3 : row ? 2 : review ? 1 : 0
  const explanation =
    error === 'INSTALL_PLAN_EXPIRED'
      ? t.expired
      : error === 'IDEMPOTENCY_CONFLICT'
        ? t.conflict
        : error &&
            [
              'INSTALL_AUTHORITY_CHANGED',
              'BOOTSTRAP_AUTHORITY_CHANGED',
              'BINDING_CHANGED',
              'BINDING_UNAVAILABLE'
            ].includes(error)
          ? t.changed
          : error && ['BOOTSTRAP_OUTCOME_UNKNOWN', 'REQUEST_TIMEOUT'].includes(error)
            ? t.unknown
            : t.error
  return (
    <Modal
      title={t.title}
      open={open}
      onCancel={close}
      footer={<Button onClick={close}>{t.close}</Button>}
      width={840}
      style={{ top: 32 }}
      styles={{
        body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', overflowX: 'hidden' }
      }}
      destroyOnHidden
    >
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary">{t.intro}</Typography.Paragraph>
        <Steps size="small" current={step} items={t.steps.map((title) => ({ title }))} />
        {error && (
          <Alert
            showIcon
            type="error"
            message={explanation}
            description={
              <details>
                <summary>{t.details}</summary>
                <Typography.Text code>{error}</Typography.Text>
              </details>
            }
          />
        )}
        {error && (
          <Button
            disabled={!!busy}
            onClick={() => void run((token) => load(token, !overview), 'check')}
          >
            {t.refresh}
          </Button>
        )}
        {!overview && busy && <Spin />}
        {overview && !overview.releases.length && (
          <Alert type="warning" showIcon message={t.noPackage} />
        )}
        {overview && !!overview.releases.length && (
          <>
            {!servers.some((v) => v.host_fingerprint) && <Empty description={t.emptyVps} />}
            <Form layout="vertical">
              <Form.Item label={t.vps}>
                <Select
                  aria-label={t.vps}
                  value={vpsId}
                  onChange={select}
                  disabled={!!busy}
                  style={{ width: '100%' }}
                  options={servers.map((v) => ({
                    value: v.id,
                    label: `${v.name} (${v.host})`,
                    disabled: !v.host_fingerprint
                  }))}
                />
              </Form.Item>
              {overview.releases.length > 1 && (
                <Form.Item label={t.release}>
                  <Select
                    aria-label={t.release}
                    value={releaseId}
                    disabled={!!busy}
                    style={{ width: '100%' }}
                    onChange={(value) => {
                      epoch.current++
                      setReleaseId(value)
                      setReview(null)
                      setConsent(false)
                    }}
                    options={overview.releases.map((v) => ({
                      value: v.release_id,
                      label: v.release_id,
                      disabled: v.state !== 'available'
                    }))}
                  />
                </Form.Item>
              )}
              <Form.Item label={t.name}>
                <Input
                  aria-label={t.name}
                  value={name}
                  maxLength={128}
                  disabled={!!busy}
                  onChange={(event) => {
                    setName(event.target.value)
                    setConsent(false)
                  }}
                />
              </Form.Item>
              <Button
                onClick={() => void preflight()}
                loading={busy === 'check'}
                disabled={!!busy || !vpsId || asset?.state !== 'available'}
              >
                {t.review}
              </Button>
            </Form>
            {asset?.state !== 'available' && (
              <Alert type="warning" showIcon message={t.invalidPackage} />
            )}
            {review && (
              <>
                <Descriptions
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                  items={[
                    {
                      key: 'server',
                      label: t.server,
                      children: selected ? `${selected.name} (${selected.host})` : '—'
                    },
                    { key: 'account', label: t.account, children: selected?.username ?? '—' },
                    {
                      key: 'memory',
                      label: t.memory,
                      children: `${(review.host.facts.available_memory_bytes / 1024 ** 3).toFixed(1)} GB`
                    },
                    {
                      key: 'disk',
                      label: t.disk,
                      children: `${(review.host.facts.free_disk_bytes / 1024 ** 3).toFixed(1)} GB`
                    }
                  ]}
                />
                {review.root_required && <Alert type="warning" showIcon message={t.root} />}
                {review.next === 'blocked' && (
                  <Alert
                    type="warning"
                    showIcon
                    message={t.blocked}
                    description={review.host.reasons.map((reason) => (
                      <div key={reason}>{t.reasons[reason]}</div>
                    ))}
                  />
                )}
                {review.next === 'inspect_existing' && (
                  <Alert type="info" showIcon message={t.existing} />
                )}
                {rebindRequired && <Alert type="warning" showIcon message={t.rebind} />}
                {review.next !== 'blocked' && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Checkbox
                      checked={allowWrite}
                      disabled={!!busy}
                      onChange={(event) => {
                        setAllowWrite(event.target.checked)
                        setConsent(false)
                      }}
                    >
                      {t.write}
                    </Checkbox>
                    <Checkbox
                      checked={consent}
                      disabled={!!busy}
                      onChange={(event) => setConsent(event.target.checked)}
                    >
                      {t.consent}
                    </Checkbox>
                  </Space>
                )}
                {review.plan &&
                  review.next !== 'blocked' &&
                  (!row ||
                    row.state === 'cancelled' ||
                    rebindRequired ||
                    (row.state === 'prepared' && review.next === 'install')) && (
                    <Button
                      type="primary"
                      disabled={!consent || !!busy || !name.trim()}
                      onClick={() => void freshInstall()}
                    >
                      {rebindRequired
                        ? t.rebindAction
                        : review.next === 'inspect_existing'
                          ? t.check
                          : t.install}
                    </Button>
                  )}
              </>
            )}
          </>
        )}
        {row && (
          <>
            <Descriptions
              size="small"
              column={{ xs: 1, sm: 2 }}
              items={[
                { key: 'status', label: t.status, children: <Tag>{t.states[row.state]}</Tag> },
                {
                  key: 'service',
                  label: t.service,
                  children: service ? (
                    <Tag color={checkedRow && service === 'running' ? 'success' : 'default'}>
                      {t.services[service]}
                    </Tag>
                  ) : (
                    '—'
                  )
                },
                {
                  key: 'recorded',
                  label: t.recorded,
                  children: new Date(row.updated_at).toLocaleString(
                    { vi: 'vi-VN', en: 'en-US', cn: 'zh-CN', jp: 'ja-JP' }[locale]
                  )
                }
              ]}
            />
            {row.state === 'outcome_unknown' && (
              <Alert type="warning" showIcon message={t.unknown} />
            )}
            {row.state === 'in_flight' && <Alert type="info" showIcon message={t.inflight} />}
            {checkedRow && row.state === 'installed' && service !== 'running' && (
              <Alert type="warning" showIcon message={t.stopped} />
            )}
            <Space wrap>
              {row.state !== 'prepared' && row.state !== 'cancelled' && (
                <Button
                  disabled={!!busy || row.state === 'in_flight'}
                  onClick={() => void run((token) => inspect(row, token).then(() => {}), 'check')}
                >
                  {t.check}
                </Button>
              )}
              <Button disabled={!!busy} onClick={() => void run((token) => load(token), 'check')}>
                {t.refresh}
              </Button>
              {row.state === 'prepared' && (
                <Button
                  disabled={!!busy}
                  onClick={() =>
                    void run(async (token) => {
                      const result = await checked(
                        window.api.invoke('controller:cancel-installation', row.request_key)
                      )
                      if (current(token)) {
                        setRow(result)
                        setReview(null)
                        setConsent(false)
                      }
                    }, 'check')
                  }
                >
                  {t.cancel}
                </Button>
              )}
              {row.state === 'outcome_unknown' && checkedRow && !row.last_result && (
                <Button
                  disabled={!canWrite || !hostCanMutate || asset?.state !== 'available'}
                  onClick={() => void send('transfer')}
                >
                  {t.resume}
                </Button>
              )}
              {row.state === 'outcome_unknown' &&
                checkedRow &&
                row.last_result &&
                row.last_result.phase !== 'installed' && (
                  <Button
                    disabled={!canWrite || !hostCanMutate}
                    onClick={() => void send('recover')}
                  >
                    {t.recover}
                  </Button>
                )}
              {row.state === 'transferred' && (
                <Button disabled={!canWrite || !hostCanMutate} onClick={() => void send('install')}>
                  {t.finish}
                </Button>
              )}
              {row.state === 'installed' && checkedRow && service === 'running' && !connection && (
                <Button
                  type="primary"
                  disabled={!canWrite}
                  onClick={() => void run((token) => connect(row, token), 'connect')}
                >
                  {t.connect}
                </Button>
              )}
            </Space>
          </>
        )}
        {busy && (
          <Alert
            type="info"
            showIcon
            icon={<Spin size="small" />}
            message={
              busy === 'transfer'
                ? t.transferBusy
                : busy === 'install'
                  ? t.installBusy
                  : busy === 'connect'
                    ? t.connectBusy
                    : t.checkBusy
            }
          />
        )}
        {connection && (
          <Alert
            type={connection === 'active' ? 'success' : 'warning'}
            showIcon
            message={connection === 'active' ? t.connected : t.delivery}
          />
        )}
      </Space>
    </Modal>
  )
}
