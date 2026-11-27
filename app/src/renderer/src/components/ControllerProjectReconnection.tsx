import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Descriptions, Modal, Space, Tag, Typography } from 'antd'
import type { DesktopControllerConnection, DesktopControllerApp } from '@shared/desktopController'
import type {
  DesktopProjectReconnection,
  DesktopProjectReconnectionReview
} from '@shared/desktopProjectReconnection'
import type { ProductProjectReconnectionContext } from '@shared/productProjectReconnection'
import { useUiState } from '../store/uiState'
import { PROJECT_RECONNECTION_COPY } from './projectReconnectionCopy'
import { ControllerPostgresInspector } from './ControllerPostgresInspector'

type Props = { binding: DesktopControllerConnection; app: DesktopControllerApp }
export function ControllerProjectReconnection(props: Props): React.JSX.Element {
  return <Session key={JSON.stringify([props.binding, props.app])} {...props} />
}
function Session({ binding, app }: Props): React.JSX.Element {
  const t = PROJECT_RECONNECTION_COPY[useUiState((s) => s.locale)]
  const alive = useRef(true),
    epoch = useRef(0)
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<DesktopProjectReconnectionReview | null>(null),
    [history, setHistory] = useState<DesktopProjectReconnection | null>(null),
    [confirmed, setConfirmed] = useState<DesktopProjectReconnection | null>(null),
    [consent, setConsent] = useState(false),
    [expired, setExpired] = useState(false),
    [error, setError] = useState<'error' | 'changed' | null>(null),
    [historyError, setHistoryError] = useState(false)
  const allowed =
    binding.state === 'active' &&
    (['read', 'deploy:manual', 'policy:write'] as const).every((s) => binding.scopes.includes(s))
  const invalidate = useCallback((): void => {
    epoch.current++
  }, [])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      invalidate()
    }
  }, [invalidate])
  useEffect(() => {
    if (!draft) return
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(draft.expires_at) - Date.now())
    )
    return () => clearTimeout(timer)
  }, [draft])
  const matches = (r: DesktopProjectReconnection): boolean =>
    !!r &&
    r.provenance === 'explicit_reconnection_v1' &&
    r.binding_id === binding.binding_id &&
    r.binding_revision === binding.revision &&
    r.controller_id === binding.controller_id &&
    r.app_id === app.app_id &&
    r.context.app_id === app.app_id &&
    r.context.controller_id === binding.controller_id &&
    r.context.scope.app_id === app.app_id &&
    r.context.scope.controller_id === binding.controller_id &&
    r.context.scope.ownership_generation === app.ownership_generation &&
    r.snapshot_sha256 === r.context.snapshot_sha256 &&
    /^[a-f0-9]{64}$/.test(r.snapshot_sha256) &&
    /^[a-f0-9-]{36}$/.test(r.request_key) &&
    r.execution === 'fresh_review_required'
  const load = async (): Promise<void> => {
    if (!allowed) return
    const token = ++epoch.current
    setBusy(true)
    setDraft(null)
    setConfirmed(null)
    setHistory(null)
    setHistoryError(false)
    setConsent(false)
    setExpired(false)
    setError(null)
    try {
      // Latest chỉ là lịch sử; phải current() thành công mới mở quyền đọc.
      const previous = await window.api.invoke('controller:latest-project-reconnection', {
        binding_id: binding.binding_id,
        app_id: app.app_id
      })
      if (!alive.current || token !== epoch.current) return
      if (previous.ok && previous.data && matches(previous.data)) {
        setHistory(previous.data)
        const current = await window.api.invoke(
          'controller:current-project-reconnection',
          previous.data.request_key
        )
        if (!alive.current || token !== epoch.current) return
        if (
          current.ok &&
          matches(current.data) &&
          current.data.request_key === previous.data.request_key &&
          current.data.snapshot_sha256 === previous.data.snapshot_sha256
        ) {
          setConfirmed(current.data)
          return
        }
      } else if (!previous.ok || previous.data) setHistoryError(true)
      const review = await window.api.invoke('controller:review-project-reconnection', {
        binding_id: binding.binding_id,
        app_id: app.app_id
      })
      if (!alive.current || token !== epoch.current) return
      if (
        !review.ok ||
        review.data.binding_id !== binding.binding_id ||
        review.data.binding_revision !== binding.revision ||
        review.data.context.app_id !== app.app_id ||
        review.data.context.controller_id !== binding.controller_id ||
        review.data.context.scope.ownership_generation !== app.ownership_generation ||
        !Number.isFinite(Date.parse(review.data.expires_at))
      )
        throw Error()
      setDraft(review.data)
      if (review.data.matching_confirmation_key) {
        const matched = await window.api.invoke(
          'controller:current-project-reconnection',
          review.data.matching_confirmation_key
        )
        if (!alive.current || token !== epoch.current) return
        if (
          matched.ok &&
          matches(matched.data) &&
          matched.data.request_key === review.data.matching_confirmation_key &&
          matched.data.snapshot_sha256 === review.data.context.snapshot_sha256
        ) {
          setDraft(null)
          setConfirmed(matched.data)
          return
        }
      }
      setExpired(Date.parse(review.data.expires_at) <= Date.now())
    } catch {
      if (alive.current && token === epoch.current) setError('error')
    } finally {
      if (alive.current && token === epoch.current) setBusy(false)
    }
  }
  const confirm = async (): Promise<void> => {
    if (
      !allowed ||
      !draft ||
      !consent ||
      expired ||
      Date.now() >= Date.parse(draft.expires_at) ||
      busy
    )
      return
    const token = ++epoch.current
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.invoke('controller:confirm-project-reconnection', {
        plan_id: draft.plan_id,
        consent: true
      })
      if (!alive.current || token !== epoch.current) return
      if (!result.ok) {
        setConsent(false)
        setError(
          ['RECONNECTION_CHANGED', 'RECONNECTION_REVIEW_EXPIRED'].includes(
            result.error.technical ?? ''
          )
            ? 'changed'
            : 'error'
        )
        setDraft(null)
        return
      }
      if (!matches(result.data) || result.data.snapshot_sha256 !== draft.context.snapshot_sha256)
        throw Error()
      setConfirmed(result.data)
      setHistory(result.data)
      setDraft(null)
      setConsent(false)
    } catch {
      if (alive.current && token === epoch.current) {
        setError('error')
        setConsent(false)
        setDraft(null)
      }
    } finally {
      if (alive.current && token === epoch.current) setBusy(false)
    }
  }
  const close = (): void => {
    epoch.current++
    setOpen(false)
    setDraft(null)
    setConfirmed(null)
    setHistory(null)
    setConsent(false)
    setError(null)
    setHistoryError(false)
    setBusy(false)
  }
  const metadata = (c: ProductProjectReconnectionContext): React.JSX.Element => (
    <Descriptions
      bordered
      size="small"
      column={1}
      items={[
        { key: 'source', label: t.source, children: c.source.generation },
        { key: 'repo', label: t.repo, children: c.source.repository_url },
        { key: 'branch', label: t.branch, children: c.source.production_ref },
        { key: 'root', label: t.root, children: c.source.repository_root },
        {
          key: 'target',
          label: t.target,
          children: `${c.scope.target.host}:${c.scope.target.port}`
        },
        {
          key: 'port',
          label: t.port,
          children: `${c.source.configuration.host_port} → ${c.source.configuration.container_port}`
        },
        { key: 'db', label: t.database, children: c.selected_database?.database_id ?? t.none },
        { key: 'env', label: t.environment, children: c.selected_environment?.revision ?? t.none },
        { key: 'policy', label: t.policy, children: c.auto_deploy_paused ? t.paused : t.enabled }
      ]}
    />
  )
  return (
    <>
      <Button
        size="small"
        disabled={!allowed}
        title={!allowed ? t.restricted : undefined}
        onClick={() => {
          setOpen(true)
          void load()
        }}
      >
        {t.open}
      </Button>
      <Modal
        title={`${t.title} · ${app.app_name}`}
        open={open}
        onCancel={close}
        footer={null}
        width={840}
        centered
        destroyOnHidden
        styles={{
          body: { maxHeight: 'calc(100vh - 190px)', overflowY: 'auto', overflowWrap: 'anywhere' }
        }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph>{t.note}</Typography.Paragraph>
          <Alert type="info" message={t.boundary} />
          {busy && <Typography.Text role="status">{t.loading}</Typography.Text>}
          {error && <Alert type="error" message={t[error]} />}
          {historyError && <Alert type="warning" message={t.historyError} />}
          {expired && draft && <Alert type="warning" message={t.expired} />}
          {history && draft && history.snapshot_sha256 !== draft.context.snapshot_sha256 && (
            <section aria-label={t.previous}>
              <Typography.Title level={5}>{t.previous}</Typography.Title>
              {metadata(history.context)}
            </section>
          )}
          {(draft || confirmed) && (
            <section aria-label={t.current}>
              <Typography.Title level={5}>{t.current}</Typography.Title>
              {metadata(confirmed?.context ?? draft!.context)}
            </section>
          )}
          {draft && (
            <>
              <Checkbox
                checked={consent}
                disabled={busy || expired}
                onChange={(e) => setConsent(e.target.checked)}
              >
                {t.consent}
              </Checkbox>
              <Button
                type="primary"
                disabled={!consent || expired || !allowed}
                loading={busy}
                onClick={() => void confirm()}
              >
                {t.confirm}
              </Button>
            </>
          )}
          {confirmed && (
            <>
              <Tag color="success">{t.confirmed}</Tag>
              <Typography.Text>
                {t.saved}: {new Date(confirmed.confirmed_at).toLocaleString()}
              </Typography.Text>
              <ControllerPostgresInspector binding={binding} reconnection={confirmed} />
            </>
          )}
          <Typography.Text type="secondary">{t.unknownRuntime}</Typography.Text>
          <Space wrap>
            <Button disabled={busy} onClick={() => void load()}>
              {t.check}
            </Button>
            <Button onClick={close}>{t.close}</Button>
          </Space>
        </Space>
      </Modal>
    </>
  )
}
