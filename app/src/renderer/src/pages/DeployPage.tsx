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
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  FolderOpenOutlined,
  LoadingOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined
} from '@ant-design/icons'

import type {
  App,
  DeployEvent,
  DeployInput,
  DeployStep,
  DetectionResultDto,
  IpcError,
  PrecheckResult,
  Vps
} from '@shared/ipc'

import { strings } from '../strings'

const WIZARD_STEPS = [
  { title: strings.deploy.steps.source },
  { title: strings.deploy.steps.detect },
  { title: strings.deploy.steps.config },
  { title: strings.deploy.steps.review }
]

const SEVEN_STEPS: DeployStep[] = [
  'PRECHECK',
  'UPLOAD',
  'RENDER',
  'BUILD',
  'DEPLOY',
  'HEALTHCHECK',
  'RECORD'
]

/** Dải màu ANSI trong log lệnh — lọc cho hiển thị đơn sắc (xterm thay ở TK-A14). */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g

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

interface StepUi {
  status: 'pending' | 'running' | 'done' | 'failed'
  durationMs: number
}

type FinalStatus = 'running' | 'failed' | 'rolled_back'

interface RunView {
  deploymentId: number
  steps: Record<DeployStep, StepUi>
  lines: Array<{ text: string; stream: 'stdout' | 'stderr' }>
  error?: IpcError
  finished?: { status: FinalStatus; totalDurationMs: number; appUrl?: string }
}

function initialSteps(): Record<DeployStep, StepUi> {
  return Object.fromEntries(
    SEVEN_STEPS.map((step) => [step, { status: 'pending', durationMs: 0 }])
  ) as Record<DeployStep, StepUi>
}

function applyEvent(prev: RunView, event: DeployEvent): RunView {
  const steps = { ...prev.steps }
  let lines = prev.lines
  switch (event.type) {
    case 'step-start':
      steps[event.step] = { status: 'running', durationMs: 0 }
      break
    case 'log': {
      const text = event.chunk.replace(ANSI_RE, '').replace(/\r/g, '')
      const parts = text.split('\n').filter((part) => part.length > 0)
      if (parts.length > 0) {
        lines = [...prev.lines, ...parts.map((part) => ({ text: part, stream: event.stream }))]
      }
      break
    }
    case 'step-done':
      steps[event.step] = { status: 'done', durationMs: event.duration_ms }
      break
    case 'step-failed':
      return {
        ...prev,
        steps: { ...steps, [event.step]: { status: 'failed', durationMs: 0 } },
        error: event.error
      }
    case 'finished':
      return {
        ...prev,
        steps,
        finished: {
          status: event.status,
          totalDurationMs: event.total_duration_ms,
          appUrl: event.app_url
        }
      }
  }
  return { ...prev, steps, lines }
}

export function DeployPage(): React.JSX.Element {
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
  const [scrolledUp, setScrolledUp] = useState(false)

  const runRef = useRef<RunView | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const selectVps = useCallback(async (id: number): Promise<void> => {
    setVpsId(id)
    setAppSelect(-1)
    setApps([])
    setPrecheck(null)
    setPrecheckError(null)
    setStartError(null)
    const result = await window.api.invoke('app:list', id)
    if (result.ok) {
      setApps(result.data)
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
      if (result.data.length > 0) {
        void selectVps(result.data[0].id)
      }
    })()
  }, [selectVps])

  useEffect(() => {
    return window.api.on('deploy:event', (event) => {
      const current = runRef.current
      if (!current || event.deployment_id !== current.deploymentId) return
      setRun((prev) => (prev ? applyEvent(prev, event) : prev))
    })
  }, [])

  useEffect(() => {
    if (!run || run.finished || runStartedAt === null) return
    const timer = window.setInterval(() => setElapsedTick(Date.now() - runStartedAt), 500)
    return () => window.clearInterval(timer)
  }, [run, runStartedAt])

  useEffect(() => {
    const el = logRef.current
    if (el && !scrolledUp) {
      el.scrollTop = el.scrollHeight
    }
  }, [run?.lines, scrolledUp])

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
      setConfigError(`Còn thiếu biến bắt buộc: ${missing.join(', ')}.`)
      return
    }
    setConfigError(null)
    await runPrecheck()
    setStep(3)
  }

  async function startDeploy(): Promise<void> {
    if (!precheck?.passed) return
    setStartError(null)
    const input = buildInput()
    const result = await window.api.invoke('deploy:start', input)
    if (!result.ok) {
      setStartError(result.error.message)
      return
    }
    setRun({
      deploymentId: result.data.deployment_id,
      steps: initialSteps(),
      lines: []
    })
    setRunStartedAt(Date.now())
    setElapsedTick(0)
    setScrolledUp(false)
  }

  function resetWizard(): void {
    setRun(null)
    setRunStartedAt(null)
    setPrecheck(null)
    setPrecheckError(null)
    setStartError(null)
    setStep(0)
    setScrolledUp(false)
  }

  function openApp(): void {
    if (run?.finished?.appUrl) {
      void window.api.invoke('system:open-external', run.finished.appUrl)
    }
  }

  function handleLogScroll(): void {
    const el = logRef.current
    if (el) setScrolledUp(el.scrollTop + el.clientHeight < el.scrollHeight - 40)
  }

  function handleScrollDown(): void {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
    setScrolledUp(false)
  }

  if (run) {
    return (
      <DeployLogView
        run={run}
        elapsed={elapsedTick}
        scrolledUp={scrolledUp}
        logRef={logRef}
        onScroll={handleLogScroll}
        onScrollDown={handleScrollDown}
        appName={appName}
        vpsName={vpsList.find((vps) => vps.id === vpsId)?.name ?? ''}
        onOpenApp={openApp}
        onBack={resetWizard}
      />
    )
  }

  const vpsField = (
    <div>
      <Typography.Text strong>{strings.deploy.vpsLabel}</Typography.Text>
      <Select
        style={{ width: '100%', marginTop: 8 }}
        value={vpsId}
        onChange={(id) => void selectVps(id)}
        options={vpsList.map((vps) => ({
          value: vps.id,
          label: `${vps.name} — ${vps.host}:${vps.port}`
        }))}
      />
    </div>
  )

  return (
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>{strings.deploy.title}</Typography.Title>
          <Typography.Text type="secondary">{strings.deploy.description}</Typography.Text>
        </div>
      </div>

      {vpsList.length === 0 ? (
        <Empty description={strings.deploy.noVps} />
      ) : (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Steps size="small" current={step} items={WIZARD_STEPS} />

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
                        label: `${app.name} — cổng ${app.host_port}`
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
                        { title: 'Kiểm tra', dataIndex: 'label' },
                        { title: 'Yêu cầu', dataIndex: 'required' },
                        { title: 'Thực tế', dataIndex: 'actual' },
                        {
                          title: 'Kết quả',
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
                          (cổng {precheck.assigned_host_port})
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
  scrolledUp: boolean
  logRef: React.RefObject<HTMLDivElement | null>
  appName: string
  vpsName: string
  onScroll: () => void
  onScrollDown: () => void
  onOpenApp: () => void
  onBack: () => void
}

function DeployLogView({
  run,
  elapsed,
  scrolledUp,
  logRef,
  appName,
  vpsName,
  onScroll,
  onScrollDown,
  onOpenApp,
  onBack
}: DeployLogViewProps): React.JSX.Element {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const { finished } = run
  const displayElapsed = finished ? finished.totalDurationMs : elapsed
  const failedStep = run.error
    ? SEVEN_STEPS.find((step) => run.steps[step].status === 'failed')
    : undefined
  const appUrl = finished?.appUrl

  async function doCancel(): Promise<void> {
    const result = await window.api.invoke('deploy:cancel', run.deploymentId)
    if (!result.ok) {
      setCancelError(result.error.message)
      return
    }
    setCancelError(null)
    setCancelOpen(false)
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
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>{strings.deploy.log.title}</Typography.Title>
          <Typography.Text type="secondary">
            {appName}
            {vpsName ? ` — ${vpsName}` : ''}
          </Typography.Text>
        </div>
        {!finished && (
          <Button danger icon={<StopOutlined />} onClick={() => setCancelOpen(true)}>
            {strings.deploy.log.cancel}
          </Button>
        )}
      </div>

      <Steps size="small" items={stepItems} />

      {finished?.status === 'running' && (
        <Alert
          className="page-alert"
          type="success"
          showIcon
          message={strings.deploy.log.success(formatDuration(finished.totalDurationMs))}
          description={appUrl ? <Typography.Text code>{appUrl}</Typography.Text> : undefined}
          action={
            appUrl ? (
              <Button type="primary" onClick={onOpenApp}>
                {strings.deploy.log.openApp}
              </Button>
            ) : undefined
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
        />
      )}

      <div className="deploy-log-terminal mono-text" ref={logRef} onScroll={onScroll}>
        {run.lines.length === 0 ? (
          <Typography.Text type="secondary">{strings.deploy.log.empty}</Typography.Text>
        ) : (
          run.lines.map((line, index) => (
            <div
              key={index}
              className={line.stream === 'stderr' ? 'deploy-log-line log-err' : 'deploy-log-line'}
            >
              {line.text}
            </div>
          ))
        )}
      </div>

      {scrolledUp && !finished && (
        <Button size="small" className="deploy-log-scrolldown" onClick={onScrollDown}>
          {strings.deploy.log.scrollDown}
        </Button>
      )}

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
            <Button type="primary" onClick={onOpenApp}>
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
