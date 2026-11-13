import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Form,
  Input,
  Modal,
  Space,
  Tag,
  Typography
} from 'antd'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopProjectSetup } from '@shared/desktopProjectRegistration'
import type {
  DesktopEnvironmentContext,
  DesktopEnvironmentIntent
} from '@shared/desktopProductEnvironment'
import { useUiState } from '../store/uiState'
import { CONTROLLER_ENVIRONMENT_COPY } from './controllerEnvironmentCopy'
type Props = { binding: DesktopControllerConnection; project: DesktopProjectSetup }
type Entry = { name: string; value: string }
type Values = { runtime?: Entry[]; public?: Entry[] }
function mapEntries(entries: Entry[] = []): Record<string, string> {
  const map: Record<string, string> = {}
  for (const { name, value } of entries) {
    if (
      !/^[A-Z_][A-Z0-9_]{0,127}$/.test(name ?? '') ||
      Object.hasOwn(map, name) ||
      typeof value !== 'string' ||
      [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      value.length > 8192
    )
      throw Error()
    map[name] = value
  }
  if (entries.length > 128) throw Error()
  return map
}
export function ControllerProjectEnvironment(props: Props): React.JSX.Element {
  return <EnvironmentSession key={JSON.stringify([props.binding, props.project])} {...props} />
}
function EnvironmentSession({ binding, project }: Props): React.JSX.Element {
  const t = CONTROLLER_ENVIRONMENT_COPY[useUiState((s) => s.locale)]
  const [form] = Form.useForm<Values>()
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [consent, setConsent] = useState(false)
  const [context, setContext] = useState<DesktopEnvironmentContext | null>(null),
    [rows, setRows] = useState<DesktopEnvironmentIntent[]>([]),
    [error, setError] = useState<string | null>(null)
  const alive = useRef(true),
    epoch = useRef(0),
    busy = useRef(false)
  const allowed =
    binding.state === 'active' &&
    binding.scopes.includes('deploy:manual') &&
    binding.scopes.includes('policy:write') &&
    project.state === 'registered' &&
    project.binding_id === binding.binding_id &&
    project.binding_revision === binding.revision &&
    project.controller_id === binding.controller_id
  const pending = rows.find((r) => ['prepared', 'in_flight', 'outcome_unknown'].includes(r.state))
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const matches = (r: DesktopEnvironmentIntent): boolean =>
    r.project_request_key === project.request_key &&
    r.binding_id === binding.binding_id &&
    r.binding_revision === binding.revision &&
    r.controller_id === binding.controller_id &&
    r.app_id === project.app_id
  const close = (): void => {
    epoch.current++
    busy.current = false
    setOpen(false)
    setLoading(false)
    setError(null)
    setConsent(false)
    setContext(null)
    setRows([])
    form.resetFields()
  }
  const load = async (): Promise<void> => {
    if (!allowed || busy.current) return
    const captured = ++epoch.current
    busy.current = true
    setLoading(true)
    setError(null)
    setContext(null)
    try {
      const results = await Promise.allSettled([
        window.api.invoke('controller:environment-context', project.request_key),
        window.api.invoke('controller:environment-intents', project.request_key)
      ])
      if (!alive.current || epoch.current !== captured) return
      const a = results[0],
        b = results[1]
      if (b.status === 'fulfilled' && b.value.ok && b.value.data.every(matches))
        setRows(b.value.data)
      else {
        setRows([])
        throw Error()
      }
      if (a.status !== 'fulfilled' || !a.value.ok) throw Error()
      const c = a.value.data
      if (
        c.project_request_key !== project.request_key ||
        c.binding_id !== binding.binding_id ||
        c.binding_revision !== binding.revision ||
        c.controller_id !== binding.controller_id ||
        c.app_id !== project.app_id
      )
        throw Error()
      setContext(c)
    } catch {
      if (alive.current && epoch.current === captured) setError(t.failure)
    } finally {
      if (alive.current && epoch.current === captured) {
        busy.current = false
        setLoading(false)
      }
    }
  }
  const prepare = async (): Promise<void> => {
    if (!allowed || !context || !consent || pending || busy.current) return
    let values: Values
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const captured = ++epoch.current
    busy.current = true
    setLoading(true)
    setError(null)
    try {
      const runtime_env = mapEntries(values.runtime),
        public_build_args = mapEntries(values.public)
      if (
        Object.keys(runtime_env).some((k) => /^(?:VITE_|NEXT_PUBLIC_)/.test(k)) ||
        Object.keys(public_build_args).some(
          (k) =>
            project.framework === 'express' ||
            !k.startsWith(project.framework === 'nextjs' ? 'NEXT_PUBLIC_' : 'VITE_')
        )
      )
        throw Error('INVALID')
      const reply = window.api.invoke('controller:prepare-environment', {
        project_request_key: project.request_key,
        expected_binding_revision: binding.revision,
        expected_latest_revision: context.latest?.revision ?? null,
        runtime_env,
        public_build_args
      })
      form.resetFields()
      setConsent(false)
      const response = await reply
      if (!alive.current || epoch.current !== captured) return
      if (!response.ok || !matches(response.data)) throw Error()
      setRows((previous) => [
        response.data,
        ...previous.filter((r) => r.request_key !== response.data.request_key)
      ])
    } catch (e) {
      if (alive.current && epoch.current === captured)
        setError(e instanceof Error && e.message === 'INVALID' ? t.invalid : t.failure)
    } finally {
      if (alive.current && epoch.current === captured) {
        busy.current = false
        setLoading(false)
      }
    }
  }
  const action = async (
    channel:
      | 'controller:send-environment'
      | 'controller:check-environment'
      | 'controller:cancel-environment',
    row: DesktopEnvironmentIntent
  ): Promise<void> => {
    if (!allowed || busy.current || (!consent && channel === 'controller:send-environment')) return
    const captured = ++epoch.current
    busy.current = true
    setLoading(true)
    setError(null)
    try {
      const response = await window.api.invoke(channel, row.request_key)
      if (!alive.current || epoch.current !== captured) return
      if (!response.ok || !matches(response.data) || response.data.request_key !== row.request_key)
        throw Error()
      setRows((previous) => [
        response.data,
        ...previous.filter((r) => r.request_key !== row.request_key)
      ])
      if (response.data.result)
        setContext((previous) =>
          previous ? { ...previous, latest: response.data.result } : previous
        )
      setConsent(false)
    } catch {
      if (alive.current && epoch.current === captured) {
        setError(t.failure)
        setRows((previous) =>
          previous.map((r) =>
            r.request_key === row.request_key && channel === 'controller:send-environment'
              ? { ...r, state: 'outcome_unknown' }
              : r
          )
        )
      }
    } finally {
      if (alive.current && epoch.current === captured) {
        busy.current = false
        setLoading(false)
      }
    }
  }
  const fields = (name: 'runtime' | 'public'): React.JSX.Element => (
    <Form.List name={name}>
      {(items, { add, remove }) => (
        <Space direction="vertical" style={{ width: '100%' }}>
          {items.map(({ key, ...field }) => (
            <Space key={key} align="start" style={{ display: 'flex' }} wrap>
              <Form.Item {...field} name={[field.name, 'name']} rules={[{ required: true }]}>
                <Input
                  aria-label={`${t[name]} ${t.key} ${field.name + 1}`}
                  placeholder="APP_NAME"
                  autoComplete="off"
                  style={{ width: 220 }}
                />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'value']} initialValue="">
                {name === 'runtime' ? (
                  <Input.Password
                    aria-label={`${t.runtime} ${t.value} ${field.name + 1}`}
                    visibilityToggle={false}
                    autoComplete="new-password"
                    style={{ width: 270 }}
                  />
                ) : (
                  <Input
                    aria-label={`${t.public} ${t.value} ${field.name + 1}`}
                    autoComplete="off"
                    style={{ width: 270 }}
                  />
                )}
              </Form.Item>
              <Button disabled={loading} onClick={() => remove(field.name)}>
                {t.remove}
              </Button>
            </Space>
          ))}
          <Button
            disabled={loading || items.length >= 128}
            onClick={() => add({ name: '', value: '' })}
          >
            {t.add} — {t[name]}
          </Button>
        </Space>
      )}
    </Form.List>
  )
  return (
    <>
      <Button
        size="small"
        disabled={!allowed}
        title={!allowed ? t.permission : undefined}
        onClick={() => {
          setOpen(true)
          void load()
        }}
      >
        {t.open}
      </Button>
      <Modal
        title={`${t.title} — ${project.app_name}`}
        open={open}
        onCancel={close}
        destroyOnHidden
        width={800}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: 'calc(100vh - 210px)', overflowY: 'auto' } }}
        footer={
          <Space>
            <Button disabled={loading} onClick={() => void load()}>
              {t.refresh}
            </Button>
            <Button onClick={close}>{t.close}</Button>
          </Space>
        }
      >
        <Typography.Paragraph>{t.intro}</Typography.Paragraph>
        <Alert type="info" showIcon message={t.stagedOnly} />
        {loading && <Typography.Paragraph>{t.loading}</Typography.Paragraph>}
        {error && <Alert type="error" showIcon message={error} />}
        {context && (
          <Descriptions
            size="small"
            column={1}
            style={{ marginTop: 12 }}
            items={[
              {
                key: 'revision',
                label: t.latest,
                children: context.latest ? `#${context.latest.revision}` : t.none
              },
              {
                key: 'keys',
                label: t.keys,
                children:
                  [
                    ...(context.latest?.runtime_keys ?? []),
                    ...(context.latest?.public_build_keys ?? [])
                  ].join(', ') || '—'
              }
            ]}
          />
        )}
        <Typography.Paragraph type="secondary">{t.savedKeys}</Typography.Paragraph>
        {rows.map((row) => (
          <div key={row.request_key} style={{ margin: '12px 0' }}>
            <Tag color={row.state === 'outcome_unknown' ? 'warning' : 'default'}>
              {t[row.state]}
            </Tag>
            <Typography.Text code>{row.request_key.slice(0, 8)}</Typography.Text>
            <Typography.Paragraph style={{ overflowWrap: 'anywhere' }}>
              {[...row.runtime_keys, ...row.public_build_keys].join(', ') || '—'}
            </Typography.Paragraph>
            {row.state === 'outcome_unknown' && <Alert type="warning" message={t.unknown} />}
            {['prepared', 'in_flight', 'outcome_unknown'].includes(row.state) && (
              <Space wrap>
                <Button
                  disabled={loading || !consent}
                  onClick={() => void action('controller:send-environment', row)}
                >
                  {row.state === 'prepared' ? t.send : t.retry}
                </Button>
                <Button
                  disabled={loading}
                  onClick={() => void action('controller:check-environment', row)}
                >
                  {t.check}
                </Button>
                {row.state === 'prepared' && (
                  <Button
                    disabled={loading}
                    onClick={() => void action('controller:cancel-environment', row)}
                  >
                    {t.cancel}
                  </Button>
                )}
              </Space>
            )}
          </div>
        ))}
        {!pending && context && (
          <Form form={form} layout="vertical" preserve={false} disabled={loading}>
            <Typography.Title level={5}>{t.runtime}</Typography.Title>
            {fields('runtime')}
            {project.framework !== 'express' && (
              <>
                <Typography.Title level={5}>{t.public}</Typography.Title>
                <Alert type="warning" message={t.publicWarning} />
                {fields('public')}
              </>
            )}
            <Typography.Paragraph style={{ marginTop: 16 }}>{t.snapshot}</Typography.Paragraph>
            <Button disabled={!consent || loading} onClick={() => void prepare()}>
              {t.prepare}
            </Button>
          </Form>
        )}
        <Checkbox
          checked={consent}
          disabled={loading}
          onChange={(e) => setConsent(e.target.checked)}
          style={{ marginTop: 16 }}
        >
          {t.consent}
        </Checkbox>
      </Modal>
    </>
  )
}
