import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopTargetSetup } from '@shared/desktopTargetRegistration'
import type { Vps } from '@shared/ipc'
import { useUiState } from '../store/uiState'
import { CONTROLLER_TARGET_REGISTRATION_COPY } from './controllerTargetRegistrationCopy'
type Props = { binding: DesktopControllerConnection }
export function ControllerTargetRegistrationPanel(props: Props): React.JSX.Element {
  return <RegistrationSession key={JSON.stringify(props.binding)} {...props} />
}
function RegistrationSession({ binding }: Props): React.JSX.Element {
  const t = CONTROLLER_TARGET_REGISTRATION_COPY[useUiState((s) => s.locale)]
  const [rows, setRows] = useState<DesktopTargetSetup[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [options, setOptions] = useState<Vps[]>([]),
    [selected, setSelected] = useState<number>(),
    [review, setReview] = useState<DesktopTargetSetup | null>(null),
    [consent, setConsent] = useState(false),
    [error, setError] = useState<string | null>(null),
    [listError, setListError] = useState(false)
  const alive = useRef(true),
    epoch = useRef(0),
    listEpoch = useRef(0),
    lock = useRef(false)
  const allowed =
    binding.state === 'active' &&
    binding.scopes.includes('deploy:manual') &&
    binding.scopes.includes('policy:write')
  const stored = (row: DesktopTargetSetup): boolean =>
    !!row &&
    row.binding_id === binding.binding_id &&
    row.controller_id === binding.controller_id &&
    Number.isSafeInteger(row.binding_revision) &&
    row.binding_revision >= 1 &&
    Number.isSafeInteger(row.local_vps_id) &&
    row.local_vps_id >= 1 &&
    typeof row.profile?.name === 'string' &&
    typeof row.profile?.host === 'string' &&
    typeof row.profile?.username === 'string' &&
    ['key', 'password'].includes(row.profile?.auth_type) &&
    /^SHA256:[A-Za-z0-9+/]{43}$/.test(row.profile?.host_fingerprint ?? '') &&
    typeof row.request_key === 'string' &&
    ['prepared', 'in_flight', 'outcome_unknown', 'registered', 'cancelled'].includes(row.state)
  const valid = (row: DesktopTargetSetup): boolean =>
    stored(row) && row.binding_revision === binding.revision
  const load = async (): Promise<void> => {
    const id = ++listEpoch.current
    try {
      const response = await window.api.invoke('controller:target-setups', binding.binding_id)
      if (!alive.current || id !== listEpoch.current) return
      if (
        !response?.ok ||
        !Array.isArray(response.data) ||
        response.data.some((row) => !stored(row))
      )
        throw new Error()
      setListError(false)
      setRows(response.data)
    } catch {
      if (alive.current && id === listEpoch.current) setListError(true)
    } finally {
      if (alive.current && id === listEpoch.current) setLoading(false)
    }
  }
  useEffect(() => {
    alive.current = true
    let active = true
    queueMicrotask(() => {
      if (active) void load()
    })
    return () => {
      active = false
      alive.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- Binding remounts the session.
  const close = (): void => {
    epoch.current++
    lock.current = false
    setOpen(false)
    setBusy(false)
    setReview(null)
    setConsent(false)
    setError(null)
    setOptions([])
    setSelected(undefined)
    void load()
  }
  const request = async (
    action: 'open' | 'prepare' | 'send' | 'cancel',
    existing?: DesktopTargetSetup
  ): Promise<void> => {
    if (!allowed || lock.current) return
    if (
      action === 'send' &&
      (!consent || !review || !['prepared', 'outcome_unknown'].includes(review.state))
    )
      return
    if (action === 'prepare' && !selected) return
    const id = ++epoch.current
    lock.current = true
    setBusy(true)
    setError(null)
    const current = (): boolean => alive.current && id === epoch.current
    let sending: DesktopTargetSetup | null = null
    try {
      if (action === 'open') {
        setOpen(true)
        setReview(null)
        setConsent(false)
        setSelected(undefined)
        setOptions([])
        if (existing) {
          if (!valid(existing)) throw new Error()
          setReview(existing)
          return
        }
        const response = await window.api.invoke('vps:list')
        if (!current()) return
        if (!response?.ok || !Array.isArray(response.data)) throw new Error()
        setOptions(response.data)
      } else if (action === 'prepare') {
        const response = await window.api.invoke('controller:prepare-target', {
          binding_id: binding.binding_id,
          local_vps_id: selected!
        })
        if (!current()) return
        if (!response?.ok) {
          setError(errorCopy(response?.error.technical))
          return
        }
        if (!valid(response.data) || response.data.local_vps_id !== selected) throw new Error()
        setReview(response.data)
        setConsent(false)
        void load()
      } else if (action === 'send' && review) {
        sending = review
        setConsent(false)
        const response = await window.api.invoke('controller:send-target', {
          request_key: review.request_key,
          confirm_transfer: true
        })
        if (!current()) return
        if (!response?.ok) {
          setError(errorCopy(response?.error.technical))
          await recoverReview(review)
          return
        }
        if (
          !valid(response.data) ||
          response.data.request_key !== review.request_key ||
          response.data.local_vps_id !== review.local_vps_id ||
          JSON.stringify(response.data.profile) !== JSON.stringify(review.profile) ||
          response.data.state !== 'registered' ||
          !response.data.remote_vps_id
        )
          throw new Error()
        setReview(response.data)
        void load()
      } else if (action === 'cancel' && review?.state === 'prepared') {
        const response = await window.api.invoke('controller:cancel-target', review.request_key)
        if (!current()) return
        if (
          !response?.ok ||
          !valid(response.data) ||
          response.data.request_key !== review.request_key ||
          response.data.state !== 'cancelled'
        )
          throw new Error()
        setReview(response.data)
        void load()
      }
    } catch {
      if (current()) {
        setError(t.failed)
        if (sending) await recoverReview(sending)
      }
    } finally {
      if (current()) {
        setBusy(false)
        lock.current = false
      }
    }
    async function recoverReview(before: DesktopTargetSetup): Promise<void> {
      if (!current()) return
      setReview({ ...before, state: 'outcome_unknown' })
      try {
        const response = await window.api.invoke('controller:target-setups', binding.binding_id)
        if (!current()) return
        if (response?.ok && Array.isArray(response.data) && response.data.every(stored)) {
          const row = response.data.find((row) => row.request_key === before.request_key)
          if (row && valid(row)) setReview(row)
          setRows(response.data)
        }
      } catch {
        /* Giữ unknown nếu không đọc lại được journal. */
      }
    }
  }
  function errorCopy(code?: string): string {
    return /CONFLICT/.test(code ?? '')
      ? t.conflict
      : /CHANGED|BINDING/.test(code ?? '')
        ? t.changed
        : /SSH_VERIFICATION/.test(code ?? '')
          ? t.ssh
          : /CREDENTIAL|SECRET_/.test(code ?? '')
            ? t.store
            : t.failed
  }
  const stateText = (state: DesktopTargetSetup['state']): string =>
    state === 'outcome_unknown' ? t.unknown : t[state]
  return (
    <section className="controller-target-registration-panel" style={{ marginTop: 24 }}>
      <Space wrap>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t.title}
        </Typography.Title>
        <Button size="small" disabled={!allowed} onClick={() => void request('open')}>
          {t.open}
        </Button>
        <Button
          size="small"
          loading={loading}
          onClick={() => {
            setLoading(true)
            setListError(false)
            void load()
          }}
        >
          {t.refresh}
        </Button>
      </Space>
      {!allowed && <Typography.Paragraph type="secondary">{t.scope}</Typography.Paragraph>}
      {listError && <Alert type="error" showIcon message={t.failed} />}
      <Table
        size="small"
        rowKey="request_key"
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: t.empty }}
        columns={[
          {
            title: t.name,
            key: 'name',
            render: (_value, row) => (
              <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                {row.profile.name}
              </Typography.Text>
            )
          },
          {
            title: t.remote,
            dataIndex: 'remote_vps_id',
            render: (value: number | null) => (value ? `#${value}` : '—')
          },
          {
            title: t.state,
            key: 'state',
            render: (_value, row) => (
              <Tag
                color={
                  row.state === 'registered'
                    ? 'processing'
                    : row.state === 'outcome_unknown'
                      ? 'warning'
                      : undefined
                }
              >
                {t.labels[row.state]}
              </Tag>
            )
          },
          {
            title: '',
            key: 'action',
            render: (_value, row) => (
              <Button
                size="small"
                disabled={!allowed || !valid(row) || busy || row.state === 'in_flight'}
                onClick={() => void request('open', row)}
              >
                {t.resume}
              </Button>
            )
          }
        ]}
      />
      <Modal
        className="controller-target-registration-modal"
        title={t.open}
        open={open}
        onCancel={close}
        destroyOnHidden
        width={760}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        footer={
          <Space wrap>
            <Button onClick={close}>{t.close}</Button>
            {!review && (
              <Button
                type="primary"
                disabled={!selected || busy}
                loading={busy}
                onClick={() => void request('prepare')}
              >
                {t.review}
              </Button>
            )}
            {review?.state === 'prepared' && (
              <Button disabled={busy} onClick={() => void request('cancel')}>
                {t.cancel}
              </Button>
            )}
            {review && ['prepared', 'outcome_unknown'].includes(review.state) && (
              <Button
                type="primary"
                disabled={!consent || busy}
                loading={busy}
                onClick={() => void request('send')}
              >
                {review.state === 'outcome_unknown' ? t.retry : t.send}
              </Button>
            )}
          </Space>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph>{t.intro}</Typography.Paragraph>
          {error && <Alert type="error" showIcon message={error} />}
          {!review && (
            <>
              <Typography.Text>{t.pick}</Typography.Text>
              <Select
                aria-label={t.pick}
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
                value={selected}
                disabled={busy}
                onChange={(value) => {
                  setSelected(value)
                  setConsent(false)
                }}
                options={options.map((vps) => ({
                  value: vps.id,
                  label: `${vps.name} (${vps.host}:${vps.port})${!vps.host_fingerprint ? ' — ' + t.missingPin : ''}`,
                  disabled: !vps.host_fingerprint
                }))}
              />
              {!busy && options.length === 0 && <Alert type="info" message={t.noVps} />}
            </>
          )}
          {review && (
            <>
              <Alert
                type={review.state === 'outcome_unknown' ? 'warning' : 'info'}
                showIcon
                message={stateText(review.state)}
              />
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: 'controller', label: t.controller, children: binding.display_name },
                  { key: 'name', label: t.name, children: review.profile.name },
                  {
                    key: 'host',
                    label: t.host,
                    children: `${review.profile.host}:${review.profile.port}`
                  },
                  { key: 'user', label: t.user, children: review.profile.username },
                  {
                    key: 'auth',
                    label: t.auth,
                    children: review.profile.auth_type === 'key' ? t.key : t.password
                  },
                  {
                    key: 'pin',
                    label: t.pin,
                    children: (
                      <Typography.Text code style={{ overflowWrap: 'anywhere' }}>
                        {review.profile.host_fingerprint}
                      </Typography.Text>
                    )
                  },
                  {
                    key: 'request',
                    label: t.request,
                    children: (
                      <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                        {review.request_key}
                      </Typography.Text>
                    )
                  },
                  {
                    key: 'remote',
                    label: t.remote,
                    children: review.remote_vps_id ? `#${review.remote_vps_id}` : '—'
                  }
                ]}
              />
              {['prepared', 'outcome_unknown'].includes(review.state) && (
                <Checkbox
                  disabled={busy}
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                >
                  {t.consent}
                </Checkbox>
              )}
            </>
          )}
        </Space>
      </Modal>
    </section>
  )
}
