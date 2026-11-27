import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Input, Modal, Space, Tag, Typography } from 'antd'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type {
  DesktopProjectSetup,
  DesktopProjectTargetState
} from '@shared/desktopProjectRegistration'
import { useUiState } from '../store/uiState'
import { CONTROLLER_TARGET_COPY } from './controllerTargetCopy'
type Props = { binding: DesktopControllerConnection; project: DesktopProjectSetup }
export function ControllerProjectTargetPreparation(props: Props): React.JSX.Element {
  return <TargetSession key={JSON.stringify([props.binding, props.project])} {...props} />
}
function TargetSession({ binding, project }: Props): React.JSX.Element {
  const t = CONTROLLER_TARGET_COPY[useUiState((value) => value.locale)]
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [state, setState] = useState<DesktopProjectTargetState | null>(null),
    [root, setRoot] = useState(''),
    [error, setError] = useState<string | null>(null)
  const alive = useRef(true),
    epoch = useRef(0),
    locked = useRef(false)
  const allowed =
    binding.state === 'active' &&
    binding.scopes.includes('deploy:manual') &&
    binding.scopes.includes('policy:write') &&
    project.state === 'registered' &&
    project.binding_id === binding.binding_id &&
    project.binding_revision === binding.revision &&
    project.controller_id === binding.controller_id
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const close = (): void => {
    epoch.current++
    locked.current = false
    setOpen(false)
    setBusy(false)
    setState(null)
    setReview(false)
    setError(null)
  }
  const request = async (enroll = false): Promise<void> => {
    if (!allowed || locked.current || (enroll && (!review || !state || state.state === 'conflict')))
      return
    const captured = ++epoch.current,
      expectedRoot = root
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const response = enroll
        ? await window.api.invoke('controller:enroll-project-target', {
            request_key: project.request_key,
            target_root: expectedRoot
          })
        : await window.api.invoke('controller:project-target-state', project.request_key)
      if (!alive.current || epoch.current !== captured) return
      if (!response?.ok) {
        const code = response?.error.technical ?? ''
        setError(/CHANGED|AUTHORITY|BINDING|QUIESCENCE/.test(code) ? t.changed : t.failed)
        setState(null)
        setReview(false)
        return
      }
      const value = response.data
      if (
        value.binding_id !== binding.binding_id ||
        value.binding_revision !== binding.revision ||
        value.controller_id !== binding.controller_id ||
        value.app_id !== project.app_id ||
        value.request_key !== project.request_key ||
        value.target_vps_id !== project.target_vps_id ||
        value.target_security_revision !== project.target_security_revision ||
        value.deployment_started !== false ||
        value.runtime_preflight !== 'required' ||
        !['not_prepared', 'prepared', 'unknown', 'enrolled', 'conflict'].includes(value.state) ||
        (value.state === 'enrolled') !== (value.proof === 'persisted_verified') ||
        (enroll && value.target_root !== expectedRoot)
      ) {
        setError(t.changed)
        setState(null)
        setReview(false)
        return
      }
      setState(value)
      setRoot(value.target_root)
      setReview(false)
    } catch {
      if (alive.current && epoch.current === captured) {
        setError(t.failed)
        setState(null)
        setReview(false)
      }
    } finally {
      if (alive.current && epoch.current === captured) {
        locked.current = false
        setBusy(false)
      }
    }
  }
  const preview = (): void => {
    if (
      !/^\/[A-Za-z0-9_./-]+$/.test(root) ||
      root.includes('..') ||
      root.length > 512 ||
      root
        .split('/')
        .slice(1)
        .some((part) => !part || part === '.' || part === '..' || part.length > 255)
    ) {
      setError(t.invalid)
      return
    }
    setError(null)
    setReview(true)
  }
  return (
    <>
      <Button
        size="small"
        disabled={!allowed}
        title={!allowed ? t.permission : undefined}
        onClick={() => {
          setOpen(true)
          void request()
        }}
      >
        {t.open}
      </Button>
      <Modal
        className="controller-target-modal"
        destroyOnHidden
        title={t.title}
        open={open}
        width={760}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        onCancel={close}
        footer={
          <Space>
            <Button onClick={close}>{t.close}</Button>
            <Button disabled={busy} onClick={() => void request()}>
              {t.refresh}
            </Button>
            {review && (
              <Button disabled={busy} onClick={() => setReview(false)}>
                {t.back}
              </Button>
            )}
            {state && state.state !== 'conflict' && (
              <Button
                type="primary"
                loading={busy}
                disabled={busy || !allowed}
                onClick={() => (review ? void request(true) : preview())}
              >
                {review
                  ? state.state === 'unknown' || state.state === 'enrolled'
                    ? t.inspect
                    : t.confirm
                  : t.review}
              </Button>
            )}
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">{t.intro}</Typography.Paragraph>
        {error && <Alert type="error" showIcon message={error} />}
        {busy && <Alert type="info" message={t.pending} />}
        {state && (
          <>
            <Tag color={state.state === 'unknown' ? 'warning' : 'default'}>{t[state.state]}</Tag>
            <Descriptions
              column={1}
              size="small"
              style={{ marginTop: 12 }}
              items={[
                {
                  key: 'host',
                  label: t.host,
                  children: (
                    <Typography.Text
                      style={{ wordBreak: 'break-all' }}
                    >{`${state.target_username}@${state.target_host}:${state.target_port} (#${state.target_vps_id})`}</Typography.Text>
                  )
                },
                {
                  key: 'pin',
                  label: t.pin,
                  children: (
                    <Typography.Text code style={{ wordBreak: 'break-all' }}>
                      {state.target_fingerprint}
                    </Typography.Text>
                  )
                },
                {
                  key: 'checked',
                  label: t.checked,
                  children: new Date(state.checked_at).toLocaleString()
                }
              ]}
            />
            <label htmlFor="product-target-root">{t.root}</label>
            <Input
              id="product-target-root"
              value={root}
              maxLength={512}
              disabled={busy || review || state.state !== 'not_prepared'}
              onChange={(event) => {
                setRoot(event.target.value)
                setReview(false)
              }}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              {t.rootHint}
            </Typography.Paragraph>
            {state.state === 'unknown' && <Alert type="warning" showIcon message={t.unknownHint} />}
            {state.state === 'enrolled' && <Alert type="info" showIcon message={t.enrolledHint} />}
            {state.state === 'conflict' && <Alert type="error" showIcon message={t.conflictHint} />}
            {review && <Alert type="warning" showIcon message={t.reviewHint} />}
          </>
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          {t.source}
        </Typography.Paragraph>
      </Modal>
    </>
  )
}
