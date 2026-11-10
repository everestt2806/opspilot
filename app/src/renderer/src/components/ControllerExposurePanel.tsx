import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Space, Tag, Typography } from 'antd'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopExposureResult } from '@shared/desktopControllerExposure'
import { useUiState } from '../store/uiState'
import { CONTROLLER_EXPOSURE_COPY } from './controllerExposureCopy'

export function ControllerExposurePanel({
  binding,
  appId,
  currentDeploymentId,
  fresh
}: {
  binding: DesktopControllerConnection
  appId: number
  currentDeploymentId: number | null
  fresh: boolean
}): React.JSX.Element {
  const locale = useUiState((value) => value.locale),
    t = CONTROLLER_EXPOSURE_COPY[locale]
  const [value, setValue] = useState<DesktopExposureResult | null>(null),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false),
    [now, setNow] = useState(Date.now)
  const epoch = useRef(0)
  const invalidate = useCallback((): void => {
    epoch.current++
  }, [])
  const load = useCallback(
    async (check: boolean): Promise<void> => {
      const ticket = ++epoch.current
      setBusy(true)
      setFailed(false)
      setValue(null)
      try {
        const response = await window.api.invoke(
          check ? 'controller:exposure-check' : 'controller:exposure-read',
          {
            binding_id: binding.binding_id,
            app_id: appId
          }
        )
        if (ticket !== epoch.current) return
        if (
          !response?.ok ||
          response.data.binding_id !== binding.binding_id ||
          response.data.binding_revision !== binding.revision ||
          response.data.controller_id !== binding.controller_id ||
          response.data.app_id !== appId ||
          (response.data.view && response.data.view.deployment_id !== currentDeploymentId)
        ) {
          setFailed(true)
          return
        }
        setValue(response.data)
        setNow(Date.now())
      } catch {
        if (ticket === epoch.current) setFailed(true)
      } finally {
        if (ticket === epoch.current) setBusy(false)
      }
    },
    [binding.binding_id, binding.controller_id, binding.revision, appId, currentDeploymentId]
  )
  useEffect(() => {
    let alive = true
    queueMicrotask(() => {
      if (alive) void load(false)
    })
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive = false
      invalidate()
      clearInterval(timer)
    }
  }, [load, invalidate])
  const observation = value?.view?.observation,
    age = observation ? now - Date.parse(observation.checked_at) : Infinity,
    recent =
      fresh &&
      binding.state === 'active' &&
      !!value &&
      ['read', 'recorded'].includes(value.state) &&
      value.view?.freshness === 'current' &&
      Number.isFinite(age) &&
      age >= -5000 &&
      age <= 60_000 &&
      value.view.deployment_id === currentDeploymentId,
    status = recent ? value!.view!.status : 'not_checked',
    canCheck =
      fresh &&
      binding.state === 'active' &&
      binding.scopes.includes('policy:write') &&
      currentDeploymentId !== null
  const reason = value?.reason_code,
    message = failed
      ? t.failed
      : reason === 'EXPOSURE_CONTEXT_CHANGED'
        ? t.changed
        : reason === 'EXPOSURE_OBSERVATION_STALE'
          ? t.clock
          : reason === 'UNSUPPORTED'
            ? t.unsupported
            : reason === 'SCOPE_REQUIRED'
              ? t.denied
              : value?.state === 'outcome_unknown'
                ? t.unknown
                : value?.state === 'unavailable' || value?.view?.unavailable_reason
                  ? t.unavailable
                  : observation && !recent
                    ? age > 60_000
                      ? t.stale
                      : t.unavailable
                    : null
  const probeHint =
    observation?.reason === 'unsafe_target'
      ? t.unsafe
      : observation && observation.reason in t
        ? t[observation.reason as 'timeout' | 'redirect' | 'connection_error' | 'aborted']
        : null
  return (
    <section aria-label={t.title} style={{ marginBlock: 20 }}>
      <Space wrap>
        <Typography.Text strong>{t.title}</Typography.Text>
        <Tag
          color={status === 'reachable' ? 'success' : status === 'degraded' ? 'warning' : 'default'}
        >
          {t[status]}
        </Tag>
        <Button size="small" disabled={busy || !canCheck} onClick={() => void load(true)}>
          {t.check}
        </Button>
        <Button size="small" aria-label={t.read} loading={busy} onClick={() => void load(false)}>
          {t.read}
        </Button>
      </Space>
      <Typography.Paragraph type="secondary">{t.hint}</Typography.Paragraph>
      {message && <Alert type={failed ? 'error' : 'info'} showIcon message={message} />}
      {!binding.scopes.includes('policy:write') && (
        <Typography.Paragraph type="secondary">{t.denied}</Typography.Paragraph>
      )}
      {observation && (
        <Descriptions
          size="small"
          column={1}
          items={[
            { key: 'deployment', label: t.deployment, children: `#${observation.deployment_id}` },
            {
              key: 'checked',
              label: t.checked,
              children: new Date(observation.checked_at).toLocaleString()
            },
            {
              key: 'url',
              label: 'URL',
              children: (
                <Typography.Text copyable style={{ overflowWrap: 'anywhere' }}>
                  {observation.url}
                </Typography.Text>
              )
            }
          ]}
        />
      )}
      {probeHint && <Typography.Paragraph>{probeHint}</Typography.Paragraph>}
      {observation?.http_status && (
        <Typography.Text>HTTP {observation.http_status}</Typography.Text>
      )}
      <Typography.Paragraph type="secondary">{t.scope}</Typography.Paragraph>
    </section>
  )
}
