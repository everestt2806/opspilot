import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Typography
} from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  FolderOpenOutlined,
  LoadingOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined
} from '@ant-design/icons'

import type { App, DeployInput, DetectionResultDto, PrecheckResult, Vps } from '@shared/ipc'

import { PageHeader } from '../components/PageHeader'

import { useStrings } from '../strings'
import { useUiState } from '../store/uiState'
import { applyEvent, initialSteps, SEVEN_STEPS, type RunView } from './deployRun'
import { DeployTerminal } from './DeployTerminal'

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m${seconds}s`
  return `${seconds}s`
}

function toAppName(path: string): string {
  const base = path.split(/[\\/]/).filter(Boolean).pop() ?? 'app'
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+/, '')
  return cleaned.slice(0, 40) || 'app'
}

function isSecretKey(key: string): boolean {
  return /(secret|password|token|api[-_]?key|private[-_]?key)/i.test(key)
}

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

interface DeployPageProps {
  onOpenDashboard?: () => void
  onBack?: () => void
}

export function DeployPage({ onOpenDashboard, onBack }: DeployPageProps): React.JSX.Element {
  const strings = useStrings()
  const wizardSteps = [
    { title: strings.deploy.steps.source },
    { title: strings.deploy.steps.detect },
    { title: strings.deploy.steps.config },
    { title: strings.deploy.steps.review }
  ]
  const deployPreselect = useUiState((state) => state.deployPreselect)
  const clearDeployPreselect = useUiState((state) => state.clearDeployPreselect)
  const [vpsList, setVpsList] = useState<Vps[]>([])
  const [apps, setApps] = useState<App[]>([])
  const [vpsId, setVpsId] = useState<number | undefined>(undefined)
  const [appSelect, setAppSelect] = useState(-1)
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [detection, setDetection] = useState<DetectionResultDto | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [appName, setAppName] = useState('')
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [optionalKeys, setOptionalKeys] = useState<string[]>([])
  const [pendingOptional, setPendingOptional] = useState<string | undefined>(undefined)
  const [configError, setConfigError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null)
  const [prechecking, setPrechecking] = useState(false)
  const [precheckError, setPrecheckError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [run, setRun] = useState<RunView | null>(null)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [elapsedTick, setElapsedTick] = useState(0)

  const runRef = useRef<RunView | null>(null)

  const selectVps = useCallback(async (id: number, preselectedAppId?: number): Promise<void> => {
    setVpsId(id)
    setAppSelect(preselectedAppId ?? -1)
    setApps([])
    setPrecheck(null)
    setPrecheckError(null)
    setStartError(null)
    const result = await window.api.invoke('app:list', id)
    if (result.ok) {
      setApps(result.data)
      if (
        preselectedAppId !== undefined &&
        result.data.some((app) => app.id === preselectedAppId)
      ) {
        setAppSelect(preselectedAppId)
      }
    }
  }, [])

  useEffect(() => {
    runRef.current = run
  }, [run])

  useEffect(() => {
    void (async () => {
      const result = await window.api.invoke('vps:list')
      if (!result.ok) return
      setVpsList(result.data)
      const pre = deployPreselect
      if (pre?.vpsId && result.data.some((vps) => vps.id === pre.vpsId)) {
        await selectVps(pre.vpsId, pre.appId)
        clearDeployPreselect()
      } else if (result.data.length > 0) {
        void selectVps(result.data[0].id)
      }
    })()
  }, [selectVps, deployPreselect, clearDeployPreselect])

  useEffect(() => {
    return window.api.on('deploy:event', (event) => {
      const current = runRef.current
      if (!current || event.deployment_id !== current.deploymentId) return
      setRun((prev) => {
        const next = prev ? applyEvent(prev, event) : prev
        runRef.current = next
        return next
      })
    })
  }, [])

  useEffect(() => {
    if (!run || run.finished || runStartedAt === null) return
    const timer = window.setInterval(() => setElapsedTick(Date.now() - runStartedAt), 500)
    return () => window.clearInterval(timer)
  }, [run, runStartedAt])

  async function runDetect(path: string): Promise<boolean> {
    setDetecting(true)
    setDetectError(null)
    const result = await window.api.invoke('deploy:detect', path)
    setDetecting(false)
    if (!result.ok) {
      setDetection(null)
      setDetectError(result.error.message)
      return false
    }
    setDetection(result.data)
    return true
  }

  async function pickFolder(): Promise<void> {
    const result = await window.api.invoke('system:pick-folder')
    if (!result.ok || !result.data.path) return
    setSourcePath(result.data.path)
    if (appSelect === -1) {
      setAppName(toAppName(result.data.path))
    }
    setDetection(null)
    setDetectError(null)
    setPrecheck(null)
    setOptionalKeys([])
    setEnvValues({})
    void runDetect(result.data.path)
  }

  async function continueFromSource(): Promise<void> {
    if (!vpsId || !sourcePath || detecting) return
    if (!detection) {
      const ok = await runDetect(sourcePath)
      if (!ok) return
    }
    setStep(1)
  }

  const matches = detection?.matched === true ? detection : null

  function requiredMissing(): string[] {
    if (!matches) return []
    return matches.required_env.filter((key) => {
      if (matches.needs_db && key === 'DATABASE_URL') return false
      return String(envValues[key] ?? '').trim() === ''
    })
  }

  function setEnv(key: string, value: string): void {
    setEnvValues((prev) => ({ ...prev, [key]: value }))
  }

  function addOptional(): void {
    if (!pendingOptional || !matches) return
    setOptionalKeys((prev) => [...prev, pendingOptional])
    setEnv(pendingOptional, '')
    setPendingOptional(undefined)
  }

  function removeOptional(key: string): void {
    setOptionalKeys((prev) => prev.filter((item) => item !== key))
    setEnvValues((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function buildInput(): DeployInput {
    return {
      vps_id: vpsId as number,
      app_id: appSelect === -1 ? undefined : appSelect,
      app_name: appName,
      source_path: sourcePath as string,
      env: Object.fromEntries(Object.entries(envValues).filter(([, value]) => value.trim() !== ''))
    }
  }

  async function runPrecheck(): Promise<void> {
    if (!vpsId || !sourcePath) return
    setPrechecking(true)
    setPrecheckError(null)
    const result = await window.api.invoke('deploy:precheck', buildInput())
    setPrechecking(false)
    if (!result.ok) {
      setPrecheckError(result.error.message)
      return
    }
    setPrecheck(result.data)
  }

  async function continueFromConfig(): Promise<void> {
    if (!matches) return
    if (!APP_NAME_RE.test(appName)) {
      setConfigError(strings.deploy.config.appNameRule)
      return
    }
    const missing = requiredMissing()
    if (missing.length > 0) {
      setConfigError(`Missing required variables: ${missing.join(', ')}.`)
      return
    }
    setConfigError(null)
    await runPrecheck()
    setStep(3)
  }

  async function startDeploy(): Promise<void> {
    if (!precheck?.passed) return
    setStartError(null)
    const input = { ...buildInput(), host_port: precheck.assigned_host_port }
    const result = await window.api.invoke('deploy:start', input)
    if (!result.ok) {
      setStartError(result.error.message)
      return
    }
    const nextRun: RunView = {
      deploymentId: result.data.deployment_id,
      steps: initialSteps(),
      buffer: ''
    }
    runRef.current = nextRun
    setRun(nextRun)
    setRunStartedAt(Date.now())
    setElapsedTick(0)
  }

  function resetWizard(): void {
    runRef.current = null
    setRun(null)
    setRunStartedAt(null)
    setPrecheck(null)
    setPrecheckError(null)
    setStartError(null)
    setStep(0)
  }

  function openApp(url?: string): void {
    const target = url || runRef.current?.finished?.appUrl || run?.finished?.appUrl
    if (target) {
      void window.api.invoke('system:open-external', target)
    }
  }

  if (run) {
    return (
      <DeployLogView
        run={run}
        elapsed={elapsedTick}
        appName={appName}
        vpsName={vpsList.find((vps) => vps.id === vpsId)?.name ?? ''}
        defaultAppUrl={precheck?.app_url}
        onRunUpdate={(updater) =>
          setRun((prev) => {
            const next = prev ? updater(prev) : prev
            runRef.current = next
            return next
          })
        }
        onOpenApp={openApp}
        onOpenDashboard={onOpenDashboard}
        onBack={resetWizard}
      />
    )
  }

  const vpsField = (
    <div>
      <Typography.Text strong>{strings.deploy.vpsLabel}</Typography.Text>
      <select
        className="deploy-vps-select"
        value={vpsId ?? ''}
        onChange={(event) => void selectVps(Number(event.currentTarget.value))}
      >
        {vpsList.map((vps) => (
          <option key={vps.id} value={vps.id}>
            {vps.name} — {vps.host}:{vps.port}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <section className="page-panel">
      <PageHeader
        title={strings.deploy.title}
        description={strings.deploy.description}
        actions={
          onBack ? (
            <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
              {strings.common.back}
            </Button>
          ) : undefined
        }
      />

      {vpsList.length === 0 ? (
        <Empty description={strings.deploy.noVps} />
      ) : (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Steps size="small" current={step} items={wizardSteps} />

          {step === 0 && (
            <div className="deploy-step-body">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {vpsField}
                <div>
                  <Typography.Text strong>{strings.deploy.sourceLabel}</Typography.Text>
                  <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                    <Input
                      readOnly
                      value={sourcePath ?? ''}
                      placeholder={strings.deploy.sourceLabel}
                    />
                    <Button
                      icon={<FolderOpenOutlined />}
                      onClick={() => void pickFolder()}
                      disabled={detecting}
                    >
                      {sourcePath ? strings.deploy.pickAgain : strings.deploy.pickFolder}
                    </Button>
                  </Space.Compact>
                  {detecting && (
                    <Space size="small" style={{ marginTop: 12 }}>
                      <Spin size="small" />
                      <Typography.Text type="secondary">{strings.deploy.detecting}</Typography.Text>
                    </Space>
                  )}
                  {detectError && (
                    <Alert
                      style={{ marginTop: 12 }}
                      type="error"
                      showIcon
                      message={strings.deploy.detectError}
                      description={detectError}
                    />
                  )}
                </div>
              </Space>
            </div>
          )}

          {step === 1 && (
            <div className="deploy-step-body">
              {matches ? (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label={strings.deploy.detectLabels.framework}>
                      <Tag>{matches.display_name}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label={strings.deploy.detectLabels.version}>
                      {matches.detected_version ?? '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label={strings.deploy.detectLabels.build}>
                      <Typography.Text code>{matches.build_command}</Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label={strings.deploy.detectLabels.port}>
                      {matches.container_port}
                    </Descriptions.Item>
                    <Descriptions.Item label={strings.deploy.detectLabels.healthcheck}>
                      <Typography.Text code>{matches.healthcheck_path}</Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label={strings.deploy.detectLabels.template}>
                      <Typography.Text code>{matches.dockerfile_template}</Typography.Text>
                      <Button type="link" size="small" onClick={() => setTemplateOpen(true)}>
                        {strings.deploy.detectView}
                      </Button>
                    </Descriptions.Item>
                    <Descriptions.Item label={strings.deploy.detectLabels.db}>
                      {matches.needs_db
                        ? strings.deploy.detectLabels.dbYes
                        : strings.deploy.detectLabels.dbNo}
                    </Descriptions.Item>
                  </Descriptions>
                  {matches.file_tree_preview.length > 0 && (
                    <div>
                      <Typography.Text strong>{strings.deploy.detectLabels.tree}</Typography.Text>
                      <pre className="deploy-tree mono-text">
                        {matches.file_tree_preview.join('\n')}
                      </pre>
                    </div>
                  )}
                </Space>
              ) : (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <Alert
                    type="error"
                    showIcon
                    message={strings.deploy.unmatchedTitle}
                    description={strings.deploy.unmatchedHint}
                  />
                  {detection && !detection.matched && (
                    <div>
                      <Typography.Text strong>{strings.deploy.signals.title}</Typography.Text>
                      <Space direction="vertical" size={6} style={{ marginTop: 8, width: '100%' }}>
                        {detection.signals.map((signal) => (
                          <div key={signal.framework} className="deploy-signal-row">
                            {signal.passed ? (
                              <CheckCircleFilled className="step-icon-ok" />
                            ) : (
                              <CloseCircleFilled className="step-icon-fail" />
                            )}
                            <Tag>{signal.framework}</Tag>
                            <Typography.Text>{signal.description}</Typography.Text>
                            {signal.passed && signal.found && (
                              <Typography.Text type="secondary" className="mono-text">
                                {signal.found}
                              </Typography.Text>
                            )}
                          </div>
                        ))}
                      </Space>
                    </div>
                  )}
                </Space>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="deploy-step-body">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <div>
                  <Typography.Text strong>{strings.deploy.config.appLabel}</Typography.Text>
                  <Select
                    style={{ width: '100%', marginTop: 8 }}
                    value={appSelect}
                    onChange={(value) => {
                      setAppSelect(value)
                      if (value === -1) return
                      const target = apps.find((app) => app.id === value)
                      if (target) setAppName(target.name)
                    }}
                    options={[
                      { value: -1, label: strings.deploy.config.newApp },
                      ...apps.map((app) => ({
                        value: app.id,
                        label: `${app.name} — port ${app.host_port}`
                      }))
                    ]}
                  />
                </div>
                <div>
                  <Typography.Text strong>{strings.deploy.config.appNameLabel}</Typography.Text>
                  <Input
                    style={{ marginTop: 8 }}
                    className="mono-input"
                    value={appName}
                    disabled={appSelect !== -1}
                    onChange={(event) => setAppName(event.target.value)}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {strings.deploy.config.appNameRule}
                  </Typography.Text>
                </div>

                <div>
                  <Typography.Text strong>{strings.deploy.config.envTitle}</Typography.Text>
                  <div className="deploy-env-hint">
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {strings.deploy.config.envHint}
                    </Typography.Text>
                  </div>
                  <Space direction="vertical" size={8} style={{ marginTop: 8, width: '100%' }}>
                    {matches?.required_env.map((key) => (
                      <EnvRow
                        key={key}
                        name={key}
                        required
                        secret={isSecretKey(key)}
                        value={envValues[key] ?? ''}
                        hint={
                          matches.needs_db && key === 'DATABASE_URL'
                            ? strings.deploy.config.dbUrlHint
                            : undefined
                        }
                        onChange={(value) => setEnv(key, value)}
                      />
                    ))}
                    {optionalKeys.map((key) => (
                      <EnvRow
                        key={key}
                        name={key}
                        required={false}
                        secret={isSecretKey(key)}
                        value={envValues[key] ?? ''}
                        onRemove={() => removeOptional(key)}
                        onChange={(value) => setEnv(key, value)}
                      />
                    ))}
                    <Space size="small" wrap>
                      <Select
                        style={{ minWidth: 260 }}
                        value={pendingOptional}
                        placeholder={strings.deploy.config.envAddPlaceholder}
                        onChange={(value) => setPendingOptional(value)}
                        options={(matches?.optional_env ?? [])
                          .filter((key) => !optionalKeys.includes(key))
                          .map((key) => ({ value: key, label: key }))}
                      />
                      <Button onClick={addOptional}>{strings.deploy.config.envAdd}</Button>
                    </Space>
                  </Space>
                </div>

                {(matches?.manual_steps.length ?? 0) > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    message={strings.deploy.config.manualTitle}
                    description={
                      <ul className="deploy-manual-list">
                        {matches?.manual_steps.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    }
                  />
                )}

                {configError && <Alert type="error" showIcon message={configError} />}
              </Space>
            </div>
          )}

          {step === 3 && (
            <div className="deploy-step-body">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space size="small">
                  <Typography.Text strong>{strings.deploy.review.title}</Typography.Text>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={() => void runPrecheck()}
                    disabled={prechecking}
                  >
                    {strings.deploy.review.retry}
                  </Button>
                </Space>
                {prechecking && (
                  <Space size="small">
                    <Spin size="small" />
                    <Typography.Text type="secondary">
                      {strings.deploy.review.checking}
                    </Typography.Text>
                  </Space>
                )}
                {precheckError && (
                  <Alert
                    type="error"
                    showIcon
                    message={strings.deploy.review.error}
                    description={precheckError}
                  />
                )}
                {precheck && !prechecking && (
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="label"
                      dataSource={precheck.checks}
                      columns={[
                        { title: strings.deploy.review.columns.check, dataIndex: 'label' },
                        { title: strings.deploy.review.columns.required, dataIndex: 'required' },
                        { title: strings.deploy.review.columns.actual, dataIndex: 'actual' },
                        {
                          title: strings.deploy.review.columns.result,
                          key: 'ok',
                          render: (_, check) =>
                            check.ok ? (
                              <CheckCircleFilled className="step-icon-ok" />
                            ) : (
                              <CloseCircleFilled className="step-icon-fail" />
                            )
                        }
                      ]}
                    />
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label={strings.deploy.review.urlLabel}>
                        <Typography.Text code>{precheck.app_url}</Typography.Text>
                        <Typography.Text type="secondary">
                          {' '}
                          (port {precheck.assigned_host_port})
                        </Typography.Text>
                      </Descriptions.Item>
                    </Descriptions>
                    {!precheck.passed && (
                      <Alert type="info" showIcon message={strings.deploy.review.deployDisabled} />
                    )}
                  </Space>
                )}
                {startError && <Alert type="error" showIcon message={startError} />}
              </Space>
            </div>
          )}

          <Space>
            <Button onClick={() => setStep((current) => Math.max(0, current - 1))}>
              {strings.deploy.back}
            </Button>
            {step === 0 && (
              <Button
                type="primary"
                disabled={!vpsId || !sourcePath || detecting}
                onClick={() => void continueFromSource()}
              >
                {strings.deploy.next}
              </Button>
            )}
            {step === 1 && (
              <Button type="primary" disabled={!matches} onClick={() => setStep(2)}>
                {strings.deploy.next}
              </Button>
            )}
            {step === 2 && (
              <Button type="primary" onClick={() => void continueFromConfig()}>
                {strings.deploy.next}
              </Button>
            )}
            {step === 3 && (
              <Button
                type="primary"
                icon={<RocketOutlined />}
                disabled={!precheck?.passed || prechecking}
                onClick={() => void startDeploy()}
              >
                {strings.deploy.review.deploy}
              </Button>
            )}
          </Space>
        </Space>
      )}

      <Drawer
        title={strings.deploy.detectLabels.template}
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
      >
        {matches && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={strings.deploy.detectLabels.template}>
              <Typography.Text code>{matches.dockerfile_template}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={strings.deploy.detectLabels.build}>
              <Typography.Text code>{matches.build_command}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={strings.deploy.detectLabels.port}>
              {matches.container_port}
            </Descriptions.Item>
            <Descriptions.Item label={strings.deploy.detectLabels.healthcheck}>
              <Typography.Text code>{matches.healthcheck_path}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={strings.deploy.detectLabels.db}>
              {matches.needs_db
                ? strings.deploy.detectLabels.dbYes
                : strings.deploy.detectLabels.dbNo}
            </Descriptions.Item>
            {(matches.manual_steps.length ?? 0) > 0 && (
              <Descriptions.Item label={strings.deploy.config.manualTitle}>
                {matches.manual_steps.join(' · ')}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Drawer>
    </section>
  )
}

interface EnvRowProps {
  name: string
  required: boolean
  secret: boolean
  value: string
  hint?: string
  onChange: (value: string) => void
  onRemove?: () => void
}

function EnvRow({
  name,
  required,
  secret,
  value,
  hint,
  onChange,
  onRemove
}: EnvRowProps): React.JSX.Element {
  const strings = useStrings()
  return (
    <div className="deploy-env-row">
      <div className="deploy-env-key">
        <Typography.Text className="mono-text">{name}</Typography.Text>
        <Typography.Text type={required ? 'danger' : 'secondary'} style={{ fontSize: 11 }}>
          {required ? strings.deploy.config.envRequired : ''}
        </Typography.Text>
      </div>
      {secret ? (
        <Input.Password
          className="mono-input"
          aria-label={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          className="mono-input"
          aria-label={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {onRemove ? (
        <Button type="text" danger onClick={onRemove}>
          {strings.deploy.config.envRemove(name)}
        </Button>
      ) : (
        <span />
      )}
      {hint && (
        <Typography.Text type="secondary" className="deploy-env-hint" style={{ fontSize: 12 }}>
          {hint}
        </Typography.Text>
      )}
    </div>
  )
}

interface DeployLogViewProps {
  run: RunView
  elapsed: number
  appName: string
  vpsName: string
  defaultAppUrl?: string
  onRunUpdate: (updater: (prev: RunView) => RunView) => void
  onOpenApp: (url?: string) => void
  onOpenDashboard?: () => void
  onBack: () => void
}

function DeployLogView({
  run,
  elapsed,
  appName,
  vpsName,
  defaultAppUrl,
  onRunUpdate,
  onOpenApp,
  onOpenDashboard,
  onBack
}: DeployLogViewProps): React.JSX.Element {
  const strings = useStrings()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [doctorBusy, setDoctorBusy] = useState(false)
  const [doctorMessage, setDoctorMessage] = useState<string | null>(null)
  const [doctorFixId, setDoctorFixId] = useState<string | null>(null)
  const [doctorSafeToFix, setDoctorSafeToFix] = useState(false)
  const [domainName, setDomainName] = useState('')
  const [cloudflareToken, setCloudflareToken] = useState('')
  const [cloudflareZoneId, setCloudflareZoneId] = useState('')
  const [domainMode, setDomainMode] = useState<'direct_port' | 'shared_ingress' | 'named_tunnel'>(
    'direct_port'
  )
  const [domainMessage, setDomainMessage] = useState<string | null>(null)
  const [domainPlan, setDomainPlan] = useState<{
    hostname: string
    target: string
    record_type: 'A' | 'AAAA' | 'CNAME'
    record_name: string
    public_url: string
    instructions: string[]
  } | null>(null)
  const { finished } = run
  const displayElapsed = finished ? finished.totalDurationMs : elapsed
  const failedStep = run.error
    ? SEVEN_STEPS.find((step) => run.steps[step].status === 'failed')
    : undefined
  const appUrl = finished?.appUrl
  const activeStep = SEVEN_STEPS.find((step) => run.steps[step].status === 'running')
  const completedSteps = SEVEN_STEPS.filter((step) => run.steps[step].status === 'done').length
  const terminalStatus = !finished
    ? 'streaming'
    : finished.status === 'running'
      ? 'success'
      : 'failed'

  async function doCancel(): Promise<void> {
    const result = await window.api.invoke('deploy:cancel', run.deploymentId)
    if (!result.ok) {
      setCancelError(result.error.message)
      return
    }
    setCancelError(null)
    setCancelOpen(false)
  }

  async function runDoctor(): Promise<void> {
    if (!finished) return
    setDoctorBusy(true)
    setDoctorMessage(null)
    const result = await window.api.invoke('doctor:diagnose', {
      deployment_id: run.deploymentId,
      evidence: {
        logs: run.buffer,
        container_state: {
          status: finished.status === 'running' ? 'running' : 'failed'
        },
        external_probe: finished.exposureStatus === 'degraded' ? 'unreachable' : undefined
      }
    })
    setDoctorBusy(false)
    if (!result.ok) {
      setDoctorMessage(result.error.message)
      return
    }
    setDoctorFixId(result.data.fix_id)
    setDoctorSafeToFix(result.data.safe_to_auto_fix)
    const evidenceDetails =
      result.data.evidence.length > 0 ? ` — ${result.data.evidence.join('; ')}` : ''
    setDoctorMessage(`${result.data.title} (${result.data.confidence})${evidenceDetails}`)
  }

  async function fixWithDoctor(): Promise<void> {
    if (!doctorFixId || !finished) return
    setDoctorBusy(true)
    const result = await window.api.invoke('doctor:fix', {
      fix_id: doctorFixId,
      deployment_id: run.deploymentId
    })
    setDoctorBusy(false)
    if (!result.ok) {
      setDoctorMessage(result.error.message)
    } else {
      setDoctorMessage(result.data.message)
      if (result.data.status === 'verified') {
        setDoctorSafeToFix(false)
        if (result.data.exposure_status === 'reachable') {
          onRunUpdate((prev) => {
            if (!prev.finished) return prev
            return {
              ...prev,
              finished: {
                ...prev.finished,
                exposureStatus: 'reachable',
                appUrl: prev.finished.appUrl || defaultAppUrl
              }
            }
          })
        }
      }
    }
  }

  async function prepareDomain(): Promise<void> {
    if (!domainName.trim() || !appUrl) return
    if (domainMode === 'named_tunnel') {
      setDomainMessage(strings.deploy.domain.namedTunnelError)
      return
    }
    try {
      const parsed = new URL(appUrl)
      const result = await window.api.invoke('domain:plan', {
        hostname: domainName,
        target: parsed.hostname,
        app_port: Number(parsed.port || 80),
        mode: domainMode
      })
      if (!result.ok) {
        setDomainMessage(result.error.message)
        return
      }
      setDomainPlan(result.data)
      setDomainMessage(strings.deploy.domain.generatedHint)
    } catch (error) {
      setDomainMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function verifyDomain(): Promise<void> {
    if (!domainPlan) return
    const result = await window.api.invoke(
      'domain:check',
      domainPlan.record_name,
      domainPlan.target,
      domainPlan.record_type
    )
    setDomainMessage(
      result.ok
        ? strings.deploy.domain.dnsStatus(result.data.status, result.data.observed)
        : result.error.message
    )
  }

  async function upsertDomain(): Promise<void> {
    if (domainMode === 'named_tunnel') {
      setDomainMessage(strings.deploy.domain.namedTunnelError)
      return
    }
    if (!domainPlan || !cloudflareToken.trim() || !cloudflareZoneId.trim()) {
      setDomainMessage(strings.deploy.domain.cfMissing)
      return
    }
    const result = await window.api.invoke('domain:upsert', {
      deployment_id: run.deploymentId,
      hostname: domainPlan.hostname,
      mode: domainMode,
      provider: 'cloudflare',
      api_token: cloudflareToken,
      zone_id: cloudflareZoneId
    })
    if (!result.ok) {
      setDomainMessage(result.error.message)
      return
    }
    setCloudflareToken('')
    setDomainMessage(strings.deploy.domain.currentStatus(result.data.message, result.data.status))
  }

  const stepItems = SEVEN_STEPS.map((step) => {
    const state = run.steps[step]
    const icon =
      state.status === 'done' ? (
        <CheckCircleFilled className="step-icon-ok" />
      ) : state.status === 'running' ? (
        <LoadingOutlined />
      ) : state.status === 'failed' ? (
        <CloseCircleFilled className="step-icon-fail" />
      ) : undefined
    return {
      title: state.status === 'done' ? `${step} · ${formatDuration(state.durationMs)}` : step,
      icon
    }
  })

  return (
    <section className="page-panel">
      <PageHeader
        title={strings.deploy.log.title}
        description={`${appName}${vpsName ? ` — ${vpsName}` : ''}`}
        actions={
          <Space>
            {onBack && finished && (
              <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
                {strings.common.back}
              </Button>
            )}
            {!finished ? (
              <Button danger icon={<StopOutlined />} onClick={() => setCancelOpen(true)}>
                {strings.deploy.log.cancel}
              </Button>
            ) : undefined}
          </Space>
        }
      />

      <Steps size="small" items={stepItems} />

      {finished?.status === 'running' && (
        <Alert
          className="page-alert"
          type={finished.exposureStatus === 'degraded' ? 'warning' : 'success'}
          showIcon
          message={
            finished.exposureStatus === 'degraded'
              ? strings.deploy.exposure.degradedTitle
              : strings.deploy.log.success(formatDuration(finished.totalDurationMs))
          }
          description={
            <Space direction="vertical" size="small">
              {appUrl ? (
                <Typography.Text code>{appUrl}</Typography.Text>
              ) : (
                <Typography.Text type="secondary">
                  {strings.deploy.exposure.blockedHint}
                </Typography.Text>
              )}
              {doctorMessage && <Typography.Text>{doctorMessage}</Typography.Text>}
            </Space>
          }
          action={
            <Space>
              {appUrl && (
                <Button type="primary" onClick={() => onOpenApp(appUrl)}>
                  {strings.deploy.log.openApp}
                </Button>
              )}
              {onOpenDashboard && (
                <Button onClick={onOpenDashboard}>{strings.deploy.log.viewDashboard}</Button>
              )}
              {finished.exposureStatus === 'degraded' && (
                <Button loading={doctorBusy} onClick={() => void runDoctor()}>
                  {strings.deploy.doctor.diagnose}
                </Button>
              )}
              {doctorSafeToFix && doctorFixId && (
                <Button type="primary" loading={doctorBusy} onClick={() => void fixWithDoctor()}>
                  {strings.deploy.doctor.autoFix}
                </Button>
              )}
            </Space>
          }
        />
      )}
      {finished && finished.status !== 'running' && (
        <Alert
          className="page-alert"
          type={finished.status === 'rolled_back' ? 'warning' : 'error'}
          showIcon
          message={
            finished.status === 'rolled_back'
              ? strings.deploy.log.rolledBack
              : strings.deploy.log.failedStep(failedStep ?? '—')
          }
          description={
            run.error ? (
              <Space direction="vertical" size="small">
                <Typography.Text>{run.error.message}</Typography.Text>
                {run.error.technical && (
                  <Typography.Text type="secondary" className="mono-text">
                    {strings.vps.check.technicalLabel}: {run.error.technical}
                  </Typography.Text>
                )}
              </Space>
            ) : undefined
          }
          action={
            <Space>
              <Button loading={doctorBusy} onClick={() => void runDoctor()}>
                {strings.deploy.doctor.diagnose}
              </Button>
              {doctorSafeToFix && doctorFixId && (
                <Button type="primary" loading={doctorBusy} onClick={() => void fixWithDoctor()}>
                  {strings.deploy.doctor.autoFix}
                </Button>
              )}
            </Space>
          }
        />
      )}

      {finished?.status === 'running' && (
        <div className="page-panel" style={{ marginTop: 16 }}>
          <Typography.Title level={5}>{strings.deploy.domain.title}</Typography.Title>
          <Space wrap>
            <Input
              placeholder={strings.deploy.domain.placeholder}
              value={domainName}
              onChange={(event) => setDomainName(event.target.value)}
              style={{ width: 240 }}
            />
            <Select
              aria-label={strings.deploy.domain.modeLabel}
              value={domainMode}
              onChange={setDomainMode}
              options={[
                { value: 'direct_port', label: strings.deploy.domain.directPort },
                { value: 'shared_ingress', label: strings.deploy.domain.sharedIngress },
                {
                  value: 'named_tunnel',
                  label: strings.deploy.domain.namedTunnelDisabled,
                  disabled: true
                }
              ]}
              style={{ width: 280 }}
            />
            <Button
              onClick={() => void prepareDomain()}
              disabled={!domainName.trim() || !appUrl || domainMode === 'named_tunnel'}
            >
              {strings.deploy.domain.generateRecord}
            </Button>
            {domainPlan && (
              <Button onClick={() => void verifyDomain()}>
                {strings.deploy.domain.verifyPropagation}
              </Button>
            )}
          </Space>
          {domainPlan && (
            <Space wrap style={{ marginTop: 12 }}>
              <Input.Password
                aria-label={strings.deploy.domain.cfTokenLabel}
                placeholder={strings.deploy.domain.cfTokenPlaceholder}
                value={cloudflareToken}
                onChange={(event) => setCloudflareToken(event.target.value)}
                style={{ width: 300 }}
              />
              <Input
                aria-label={strings.deploy.domain.cfZoneLabel}
                placeholder={strings.deploy.domain.cfZonePlaceholder}
                value={cloudflareZoneId}
                onChange={(event) => setCloudflareZoneId(event.target.value)}
                style={{ width: 240 }}
              />
              <Button
                type="primary"
                onClick={() => void upsertDomain()}
                disabled={
                  !cloudflareToken.trim() ||
                  !cloudflareZoneId.trim() ||
                  domainMode === 'named_tunnel'
                }
              >
                {strings.deploy.domain.cfUpdate}
              </Button>
            </Space>
          )}
          {domainPlan && (
            <Descriptions column={1} size="small" style={{ marginTop: 12 }}>
              <Descriptions.Item label={strings.deploy.domain.recordLabel}>
                <Typography.Text code>
                  {domainPlan.record_type} {domainPlan.record_name} → {domainPlan.target}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label={strings.deploy.domain.targetUrlLabel}>
                <Typography.Text code>{domainPlan.public_url}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label={strings.deploy.domain.instructionsLabel}>
                {domainPlan.instructions.join(' ')}
              </Descriptions.Item>
            </Descriptions>
          )}
          {domainMessage && <Typography.Text type="secondary">{domainMessage}</Typography.Text>}
        </div>
      )}

      <DeployTerminal
        buffer={run.buffer}
        activeStep={activeStep}
        completedSteps={completedSteps}
        status={terminalStatus}
      />

      <div className="deploy-log-footer">
        <Space size="small">
          <ClockCircleOutlined />
          <Typography.Text className="mono-text">{formatDuration(displayElapsed)}</Typography.Text>
          <Tag
            color={finished ? (finished.status === 'running' ? 'success' : 'error') : 'processing'}
          >
            {finished
              ? finished.status === 'running'
                ? strings.deploy.log.success(formatDuration(finished.totalDurationMs))
                : strings.deploy.log.failedStep(failedStep ?? '—')
              : strings.deploy.log.running}
          </Tag>
        </Space>
        <Space>
          {finished && appUrl && (
            <Button type="primary" onClick={() => onOpenApp(appUrl)}>
              {strings.deploy.log.openApp}
            </Button>
          )}
          {finished && <Button onClick={onBack}>{strings.deploy.log.backToWizard}</Button>}
        </Space>
      </div>

      <Modal
        open={cancelOpen}
        title={strings.deploy.log.cancelAsk}
        okText={strings.deploy.log.cancelConfirm}
        okButtonProps={{ danger: true }}
        cancelText={strings.common.cancel}
        onOk={() => void doCancel()}
        onCancel={() => setCancelOpen(false)}
      />
      {cancelError && <Alert className="page-alert" type="error" showIcon message={cancelError} />}
    </section>
  )
}
