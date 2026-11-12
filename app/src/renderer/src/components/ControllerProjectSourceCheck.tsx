import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Modal, Space, Tag, Typography } from 'antd'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type {
  DesktopProjectSetup,
  DesktopProjectSourceVerification
} from '@shared/desktopProjectRegistration'
import { useUiState } from '../store/uiState'
import { CONTROLLER_SOURCE_COPY } from './controllerSourceCopy'

type Props = { binding: DesktopControllerConnection; project: DesktopProjectSetup }
export function ControllerProjectSourceCheck(props: Props): React.JSX.Element {
  // Thay authority phải remount để đóng modal và bỏ mọi response của phiên cũ.
  return <SourceCheckSession key={JSON.stringify([props.binding, props.project])} {...props} />
}
function SourceCheckSession({ binding, project }: Props): React.JSX.Element {
  const t = CONTROLLER_SOURCE_COPY[useUiState((value) => value.locale)]
  const [open, setOpen] = useState(false),
    [checking, setChecking] = useState(false),
    [result, setResult] = useState<DesktopProjectSourceVerification | null>(null),
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
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const close = (): void => {
    epoch.current++
    busy.current = false
    setOpen(false)
    setChecking(false)
    setResult(null)
    setError(null)
  }
  const check = async (): Promise<void> => {
    if (!allowed || busy.current) return
    const captured = ++epoch.current
    busy.current = true
    setChecking(true)
    setResult(null)
    setError(null)
    const current = (): boolean => alive.current && epoch.current === captured
    try {
      const response = await window.api.invoke(
        'controller:verify-project-source',
        project.request_key
      )
      if (!current()) return
      if (!response?.ok) {
        const code = response?.error.technical ?? ''
        const message = code.includes('PROJECT_SOURCE_UNSUPPORTED')
          ? t.unsupported
          : code.includes('PROJECT_SOURCE_LIMIT_EXCEEDED')
            ? t.limit
            : code.includes('PROJECT_SOURCE_REQUIRES_QUIESCENCE')
              ? t.blocked
              : /REQUEST_TIMEOUT|PROJECT_SOURCE_DEADLINE/.test(code)
                ? t.timeout
                : code.includes('PROJECT_SOURCE_FETCH_FAILED')
                  ? t.fetch
                  : /PROJECT_SOURCE_(?:CHANGED|OBSERVATION_STALE|AUTHORITY_REJECTED)|BINDING_CHANGED|PROJECT_TARGET_CHANGED/.test(
                        code
                      )
                    ? t.changed
                    : t.failure
        setError(message)
        return
      }
      const value = response.data
      if (
        value.binding_id !== binding.binding_id ||
        value.binding_revision !== binding.revision ||
        value.controller_id !== binding.controller_id ||
        value.request_key !== project.request_key ||
        value.app_id !== project.app_id ||
        value.target_vps_id !== project.target_vps_id ||
        value.target_security_revision !== project.target_security_revision ||
        value.repository_url !== project.repository_url ||
        value.production_ref !== project.production_ref ||
        value.repository_root !== project.repository_root ||
        value.framework !== project.framework ||
        value.configured_container_port !== project.container_port ||
        value.state !== 'source_verified' ||
        value.deployment_started !== false ||
        value.auto_deploy_paused !== true ||
        value.runtime_preflight !== 'required' ||
        !/^[a-f0-9]{40}$/.test(value.commit_sha) ||
        !Number.isFinite(Date.parse(value.verified_at))
      ) {
        setError(t.changed)
        return
      }
      setResult(value)
    } catch {
      if (current()) setError(t.failure)
    } finally {
      if (current()) {
        busy.current = false
        setChecking(false)
      }
    }
  }
  return (
    <>
      <Button
        size="small"
        disabled={!allowed}
        title={!allowed ? t.permission : undefined}
        onClick={() => setOpen(true)}
      >
        {t.open}
      </Button>
      <Modal
        destroyOnHidden
        className="controller-source-modal"
        title={t.title}
        open={open}
        width={720}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        onCancel={close}
        footer={
          <Space>
            <Button onClick={close}>{t.close}</Button>
            <Button
              type="primary"
              loading={checking}
              disabled={!allowed || checking}
              onClick={() => void check()}
            >
              {result || error ? t.retry : t.run}
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">{t.intro}</Typography.Paragraph>
        <Tag>{t.sourceOnly}</Tag>
        <Descriptions
          size="small"
          column={1}
          style={{ marginTop: 12 }}
          items={[
            { key: 'app', label: t.app, children: `${project.app_name} (#${project.app_id})` },
            { key: 'target', label: t.target, children: `#${project.target_vps_id}` },
            {
              key: 'repo',
              label: t.repo,
              children: (
                <Typography.Text style={{ wordBreak: 'break-all' }}>
                  {project.repository_url}
                </Typography.Text>
              )
            },
            { key: 'branch', label: t.branch, children: project.production_ref },
            { key: 'root', label: t.root, children: project.repository_root }
          ]}
        />
        {checking && <Alert type="info" showIcon message={t.pending} />}
        {error && <Alert type="error" showIcon message={error} />}
        {result && (
          <div className="controller-source-result">
            <Alert type="info" showIcon message={t.verified} />
            <Descriptions
              size="small"
              column={1}
              style={{ marginTop: 12 }}
              items={[
                {
                  key: 'sha',
                  label: t.sha,
                  children: (
                    <Typography.Text code style={{ wordBreak: 'break-all' }}>
                      {result.commit_sha}
                    </Typography.Text>
                  )
                },
                {
                  key: 'checked',
                  label: t.checked,
                  children: new Date(result.verified_at).toLocaleString()
                },
                { key: 'files', label: t.files, children: result.source_file_count },
                { key: 'bytes', label: t.bytes, children: result.source_bytes.toLocaleString() },
                {
                  key: 'ports',
                  label: t.ports,
                  children: `${result.configured_container_port} / ${result.detected_container_port}`
                }
              ]}
            />
            {result.configured_container_port !== result.detected_container_port && (
              <Alert type="warning" message={t.portHint} />
            )}
          </div>
        )}
        <Typography.Paragraph style={{ marginTop: 16 }} type="secondary">
          {t.remaining}
        </Typography.Paragraph>
      </Modal>
    </>
  )
}
