import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Modal, Space, Tag, Typography } from 'antd'
import type {
  DesktopControllerConnection,
  DesktopControllerAppStatus
} from '@shared/desktopController'
import type { DesktopProjectSetup } from '@shared/desktopProjectRegistration'
import type { DesktopControllerCommand } from '@shared/desktopControllerCommands'
import type {
  DesktopProjectReadiness,
  DesktopFirstDeploymentPlan
} from '@shared/desktopFirstDeployment'
import { useUiState } from '../store/uiState'
import { CONTROLLER_FIRST_DEPLOY_COPY } from './controllerFirstDeployCopy'
type Props = { binding: DesktopControllerConnection; project: DesktopProjectSetup }
export function ControllerProjectFirstDeployment(props: Props): React.JSX.Element {
  return <FirstSession key={JSON.stringify([props.binding, props.project])} {...props} />
}
function FirstSession({ binding, project }: Props): React.JSX.Element {
  const t = CONTROLLER_FIRST_DEPLOY_COPY[useUiState((s) => s.locale)]
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [clock, setClock] = useState(() => Date.now()),
    [readiness, setReadiness] = useState<DesktopProjectReadiness | null>(null),
    [plan, setPlan] = useState<DesktopFirstDeploymentPlan | null>(null),
    [command, setCommand] = useState<DesktopControllerCommand | null>(null),
    [status, setStatus] = useState<DesktopControllerAppStatus | null>(null),
    [loaded, setLoaded] = useState(false)
  const alive = useRef(true),
    epoch = useRef(0),
    lock = useRef(false)
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
  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])
  const close = (): void => {
    epoch.current++
    lock.current = false
    setOpen(false)
    setBusy(false)
    setPlan(null)
    setReadiness(null)
    setCommand(null)
    setStatus(null)
    setError(false)
    setLoaded(false)
  }
  const validCommand = (value: DesktopControllerCommand): boolean =>
    value.binding_id === binding.binding_id &&
    value.binding_revision === binding.revision &&
    value.controller_id === binding.controller_id &&
    value.app_id === project.app_id &&
    value.operation === 'redeploy' &&
    value.require_first_deployment === true
  const work = async (
    action: 'load' | 'check' | 'review' | 'send' | 'refresh' | 'cancel'
  ): Promise<void> => {
    if (!allowed || lock.current) return
    const id = ++epoch.current
    lock.current = true
    setBusy(true)
    setError(false)
    const current = (): boolean => alive.current && id === epoch.current
    try {
      if (action === 'load') {
        const response = await window.api.invoke('controller:commands', binding.binding_id)
        if (!current()) return
        if (!response?.ok || !Array.isArray(response.data)) throw new Error()
        const rows = response.data
          .filter(validCommand)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
        setCommand(
          rows.find((row) => ['prepared', 'in_flight', 'outcome_unknown'].includes(row.state)) ??
            rows[0] ??
            null
        )
        setLoaded(true)
      } else if (action === 'check') {
        setPlan(null)
        setReadiness(null)
        setStatus(null)
        const response = await window.api.invoke(
          'controller:project-readiness',
          project.request_key
        )
        if (!current()) return
        if (!response?.ok) throw new Error()
        const value = response.data
        if (
          value.binding_id !== binding.binding_id ||
          value.binding_revision !== binding.revision ||
          value.request_key !== project.request_key ||
          value.report.app_id !== project.app_id ||
          value.report.controller_id !== binding.controller_id ||
          value.report.target_vps_id !== project.target_vps_id ||
          value.report.target_security_revision !== project.target_security_revision ||
          value.report.repository_url !== project.repository_url ||
          value.report.production_ref !== project.production_ref ||
          value.report.repository_root !== project.repository_root ||
          value.report.host_port !== project.host_port ||
          !Number.isFinite(Date.parse(value.report.checked_at)) ||
          Date.now() - Date.parse(value.report.checked_at) > 30_000 ||
          Date.parse(value.report.checked_at) > Date.now() + 5000 ||
          (value.state === 'ready' &&
            (!value.controller_ready ||
              value.report.state !== 'ready' ||
              !value.readiness_id ||
              !value.valid_until ||
              !/^[a-f0-9]{40}$/.test(value.report.commit_sha ?? '')))
        )
          throw new Error()
        setReadiness(value)
        setClock(Date.now())
      } else if (
        action === 'review' &&
        readiness?.readiness_id &&
        readiness.valid_until &&
        Date.parse(readiness.valid_until) > Date.now()
      ) {
        const response = await window.api.invoke('controller:prepare-first-deployment', {
          request_key: project.request_key,
          readiness_id: readiness.readiness_id
        })
        if (!current()) return
        if (
          !response?.ok ||
          !validCommand(response.data.command) ||
          response.data.command.state !== 'prepared' ||
          response.data.readiness_id !== readiness.readiness_id ||
          response.data.request_key !== project.request_key ||
          response.data.source_sha !== readiness.report.commit_sha ||
          response.data.binding_id !== binding.binding_id ||
          response.data.binding_revision !== binding.revision ||
          response.data.app_id !== project.app_id ||
          response.data.valid_until !== readiness.valid_until
        )
          throw new Error()
        setPlan(response.data)
        setCommand(response.data.command)
      } else if (
        action === 'send' &&
        plan &&
        Date.parse(plan.valid_until) > Date.now() &&
        command?.state === 'prepared'
      ) {
        const response = await window.api.invoke('controller:send-first-deployment', {
          request_key: project.request_key,
          readiness_id: plan.readiness_id,
          command_key: plan.command.request_key
        })
        if (!current()) return
        setPlan(null)
        setReadiness(null)
        if (
          !response?.ok ||
          !validCommand(response.data) ||
          response.data.request_key !== plan.command.request_key
        )
          throw new Error()
        setCommand(response.data)
      } else if (action === 'cancel' && command?.state === 'prepared') {
        const response = await window.api.invoke('controller:cancel-command', command.request_key)
        if (!current()) return
        if (
          !response?.ok ||
          !validCommand(response.data) ||
          response.data.request_key !== command.request_key ||
          response.data.state !== 'cancelled'
        )
          throw new Error()
        setCommand(response.data)
        setPlan(null)
        setReadiness(null)
        setStatus(null)
      } else if (action === 'refresh' && command) {
        const response = await window.api.invoke('controller:check-command', command.request_key)
        if (!current()) return
        if (
          !response?.ok ||
          !validCommand(response.data) ||
          response.data.request_key !== command.request_key
        )
          throw new Error()
        setCommand(response.data)
        setStatus(null)
        const app = await window.api.invoke('controller:app-status', {
          binding_id: binding.binding_id,
          app_id: project.app_id!
        })
        if (!current()) return
        if (
          !app?.ok ||
          app.data.binding_id !== binding.binding_id ||
          app.data.binding_revision !== binding.revision ||
          app.data.controller_id !== binding.controller_id ||
          app.data.app_id !== project.app_id ||
          app.data.data_freshness !== 'current' ||
          !Number.isFinite(Date.parse(app.data.checked_at)) ||
          Date.now() - Date.parse(app.data.checked_at) > 30_000 ||
          Date.parse(app.data.checked_at) > Date.now() + 5000
        )
          throw new Error()
        setStatus(app.data)
      }
    } catch {
      if (current()) {
        setError(true)
        setPlan(null)
        setReadiness(null)
        setStatus(null)
        if (action === 'send') setLoaded(false)
      }
    } finally {
      if (current()) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  const expired = !!readiness?.valid_until && Date.parse(readiness.valid_until) <= clock
  const sent = !!command && ['in_flight', 'outcome_unknown', 'accepted'].includes(command.state)
  const healthy =
    command?.state === 'accepted' &&
    command.remote_state === 'completed' &&
    !!command.target_sha &&
    !!command.job_id &&
    !!status?.current_deployment_id &&
    clock - Date.parse(status.checked_at) <= 30_000 &&
    status.latest_job_id === command.job_id &&
    status.latest_job_state === 'succeeded' &&
    status.current_deployment_state === 'running' &&
    status.current_deployment_sha === command.target_sha
  const runtimeFailed =
    command?.remote_state === 'blocked' ||
    command?.remote_state === 'uncertain' ||
    command?.state === 'rejected' ||
    (status?.latest_job_id === command?.job_id &&
      ['failed', 'rolled_back', 'superseded', 'cancelled', 'uncertain'].includes(
        status?.latest_job_state ?? ''
      ))
  return (
    <>
      <Button
        size="small"
        disabled={!allowed}
        onClick={() => {
          setOpen(true)
          void work('load')
        }}
      >
        {t.open}
      </Button>
      <Modal
        title={`${t.open} — ${project.app_name}`}
        open={open}
        onCancel={close}
        destroyOnHidden
        width={760}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        footer={
          <Space wrap>
            <Button onClick={close}>{t.close}</Button>
            {!loaded && (
              <Button loading={busy} onClick={() => void work('load')}>
                {t.refresh}
              </Button>
            )}
            {loaded && !sent && (
              <Button disabled={busy} onClick={() => void work('check')}>
                {t.check}
              </Button>
            )}
            {command?.state === 'prepared' && (
              <Button disabled={busy} onClick={() => void work('cancel')}>
                {t.cancel}
              </Button>
            )}
            {command && command.state !== 'cancelled' && (
              <Button disabled={busy} onClick={() => void work('refresh')}>
                {t.refresh}
              </Button>
            )}
            {loaded && !sent && readiness?.state === 'ready' && !plan && (
              <Button type="primary" disabled={busy || expired} onClick={() => void work('review')}>
                {t.review}
              </Button>
            )}
            {plan && (
              <Button
                type="primary"
                disabled={busy || expired}
                loading={busy}
                onClick={() => void work('send')}
              >
                {t.send}
              </Button>
            )}
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Typography.Paragraph>{t.intro}</Typography.Paragraph>
          {error && <Alert type="error" showIcon message={t.failed} />}
          {loaded && command && command.state !== 'cancelled' && (
            <>
              <Alert
                type={healthy ? 'success' : runtimeFailed ? 'error' : 'info'}
                showIcon
                message={
                  healthy
                    ? t.healthy
                    : runtimeFailed
                      ? t.runtimeFailed
                      : command.state === 'prepared'
                        ? t.prepared
                        : command.state === 'accepted'
                          ? t.accepted
                          : t.pending
                }
              />
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: 'id',
                    label: t.intent,
                    children: (
                      <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                        {command.request_key}
                      </Typography.Text>
                    )
                  },
                  {
                    key: 'commit',
                    label: t.sha,
                    children: (
                      <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                        {command.target_sha ?? '—'}
                      </Typography.Text>
                    )
                  },
                  {
                    key: 'job',
                    label: t.status,
                    children:
                      status?.latest_job_id === command.job_id ? (
                        <Space wrap>
                          <span>{status?.latest_job_state ?? '—'}</span>
                          {status && (
                            <Typography.Text type="secondary">
                              {new Date(status.checked_at).toLocaleString()}
                            </Typography.Text>
                          )}
                        </Space>
                      ) : (
                        '—'
                      )
                  }
                ]}
              />
            </>
          )}
          {readiness && !plan && (
            <>
              <Alert
                showIcon
                type={expired ? 'warning' : readiness.state === 'ready' ? 'info' : 'warning'}
                message={expired ? t.expired : readiness.state === 'ready' ? t.ready : t.blocked}
                description={t.snapshot}
              />
              <Descriptions
                size="small"
                column={1}
                items={[
                  ...readiness.report.checks.map((check) => ({
                    key: check.key,
                    label: t[check.key],
                    children: (
                      <Tag
                        color={
                          check.state === 'passed'
                            ? 'success'
                            : check.state === 'blocked'
                              ? 'warning'
                              : undefined
                        }
                      >
                        {check.state === 'passed'
                          ? t.passed
                          : check.state === 'blocked'
                            ? t.checkBlocked
                            : t.not_checked}
                      </Tag>
                    )
                  })),
                  {
                    key: 'execution',
                    label: t.execution,
                    children: (
                      <Tag color={readiness.controller_ready ? 'success' : 'warning'}>
                        {readiness.controller_ready ? t.passed : t.checkBlocked}
                      </Tag>
                    )
                  }
                ]}
              />
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: 'sha',
                    label: t.sha,
                    children: (
                      <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                        {readiness.report.commit_sha ?? '—'}
                      </Typography.Text>
                    )
                  },
                  { key: 'target', label: t.target, children: `#${project.target_vps_id}` },
                  { key: 'port', label: t.port, children: project.host_port },
                  ...(['controller_resources', 'target_resources'] as const).map((key) => ({
                    key: `resource-${key}`,
                    label: `${t[key]} — ${t.resources}`,
                    children: readiness.report[key]
                      ? `${Math.floor(readiness.report[key]!.available_ram_bytes / 1048576)} MiB / ${(readiness.report[key]!.workspace_available_bytes / 1073741824).toFixed(1)} GiB`
                      : '—'
                  }))
                ]}
              />
            </>
          )}
          {plan && (
            <Alert
              type="warning"
              showIcon
              message={t.confirm}
              description={
                <Descriptions
                  size="small"
                  column={1}
                  items={[
                    {
                      key: 'sha',
                      label: t.sha,
                      children: (
                        <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                          {plan.source_sha}
                        </Typography.Text>
                      )
                    },
                    {
                      key: 'source',
                      label: t.source,
                      children: (
                        <Typography.Text style={{ overflowWrap: 'anywhere' }}>
                          {project.repository_url} · {project.production_ref} ·{' '}
                          {project.repository_root}
                        </Typography.Text>
                      )
                    },
                    { key: 'target', label: t.target, children: `#${project.target_vps_id}` },
                    { key: 'port', label: t.port, children: project.host_port }
                  ]}
                />
              }
            />
          )}
        </Space>
      </Modal>
    </>
  )
}
