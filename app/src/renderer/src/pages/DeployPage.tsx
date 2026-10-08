import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Radio,
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

import type {
  App,
  DeployEvent,
  DetectionResultDto,
  DeploySourceInput,
  DeployStartInput,
  GitSourceInput,
  PreparedGitSource,
  PrecheckResult,
  Vps
} from '@shared/ipc'

import { PageHeader } from '../components/PageHeader'

import { useStrings } from '../strings'
import { type DeployPreselect, useUiState } from '../store/uiState'
import {
  applyEvent,
  getConfigSignature,
  initialSteps,
  isSecretKey,
  isValidHttpUrl,
  SEVEN_STEPS,
  type RunView
} from './deployRun'
import { DeployTerminal } from './DeployTerminal'

const MAX_BUFFERED_EVENTS = 200

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
  const [vpsLoading, setVpsLoading] = useState(true)
  const [vpsLoadError, setVpsLoadError] = useState<string | null>(null)
  const [preselectVpsError, setPreselectVpsError] = useState<string | null>(null)

  const [apps, setApps] = useState<App[]>([])
  const [appsLoading, setAppsLoading] = useState(false)
  const [appLoadError, setAppLoadError] = useState<string | null>(null)
  const [preselectAppError, setPreselectAppError] = useState<string | null>(null)

  const [vpsId, setVpsId] = useState<number | undefined>(undefined)
  const [appSelect, setAppSelect] = useState(-1)
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new')
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [sourceMode, setSourceMode] = useState<'local' | 'git'>('local')
  const [gitRepoUrl, setGitRepoUrl] = useState('')
  const [gitRef, setGitRef] = useState('main')
  const [gitRoot, setGitRoot] = useState('.')
  const [preparedGit, setPreparedGit] = useState<PreparedGitSource | null>(null)
  const [preparingGit, setPreparingGit] = useState(false)
  const prepareRequestRef = useRef<string | null>(null)
  const sourceRequestRef = useRef(0)
  const preparedGitRef = useRef<PreparedGitSource | null>(null)

  useEffect(
    () => () => {
      const requestId = prepareRequestRef.current
      if (requestId && window.api) void window.api.invoke('deploy:cancel-git-prepare', requestId)
      const handle = preparedGitRef.current?.prepared_source_handle
      if (handle && window.api) void window.api.invoke('deploy:release-git-prepare', handle)
    },
    []
  )
  const [detection, setDetection] = useState<DetectionResultDto | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [newAppName, setNewAppName] = useState('')
  const [userEditedNewAppName, setUserEditedNewAppName] = useState(false)
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [optionalKeys, setOptionalKeys] = useState<string[]>([])
  const [pendingOptional, setPendingOptional] = useState<string | undefined>(undefined)
  const [configError, setConfigError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null)
  const [precheckSignature, setPrecheckSignature] = useState<string | null>(null)
  const [prechecking, setPrechecking] = useState(false)
  const [precheckError, setPrecheckError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [run, setRun] = useState<RunView | null>(null)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [elapsedTick, setElapsedTick] = useState(0)

  const startPendingRef = useRef(false)
  const pendingEventsRef = useRef<DeployEvent[]>([])
  const runRef = useRef<RunView | null>(null)
  const appListReqIdRef = useRef(0)
  const precheckReqIdRef = useRef(0)
  const initialLoadedRef = useRef(false)
  const activePreselectRef = useRef<DeployPreselect | null>(deployPreselect)
  const targetModeRef = useRef(targetMode)

  const invalidatePrecheck = useCallback((): void => {
    precheckReqIdRef.current++
    setPrecheck(null)
    setPrecheckSignature(null)
    setPrecheckError(null)
  }, [])

  useEffect(() => {
    targetModeRef.current = targetMode
  }, [targetMode])

  const selectedExistingApp =
    targetMode === 'existing' && appSelect > 0 ? apps.find((app) => app.id === appSelect) : null
  const appName = targetMode === 'existing' ? (selectedExistingApp?.name ?? '') : newAppName

  const clearPreselectSession = useCallback((): void => {
    activePreselectRef.current = null
    clearDeployPreselect()
  }, [clearDeployPreselect])

  const selectVps = useCallback(
    async (id: number, preselectedAppId?: number, isPreselect = false): Promise<void> => {
      const reqId = ++appListReqIdRef.current
      setVpsId(id)
      setAppsLoading(true)
      setAppLoadError(null)
      setPreselectAppError(null)
      invalidatePrecheck()
      setStartError(null)

      // Bỏ app_id cũ ngay lập tức khi đổi VPS
      setAppSelect(-1)

      const result = await window.api.invoke('app:list', id)
      if (appListReqIdRef.current !== reqId) return
      setAppsLoading(false)

      if (!result.ok) {
        setAppLoadError(result.error.message)
        setApps([])
        return
      }

      const fetchedApps = result.data
      setApps(fetchedApps)

      if (preselectedAppId !== undefined && isPreselect) {
        const found = fetchedApps.find((app) => app.id === preselectedAppId)
        if (found) {
          setAppSelect(found.id)
          setTargetMode('existing')
          if (found.source_type === 'git') {
            setSourceMode('git')
            setGitRepoUrl(found.git_repo_url ?? '')
            setGitRef(found.git_ref ?? 'main')
            setGitRoot(found.git_root ?? '.')
          }
          activePreselectRef.current = null
          clearDeployPreselect()
        } else {
          setAppSelect(preselectedAppId)
          setTargetMode('existing')
          setPreselectAppError(strings.deploy.preselectAppNotFound)
        }
      } else if (isPreselect) {
        activePreselectRef.current = null
        clearDeployPreselect()
      } else {
        // Khi đổi VPS: giữ nguyên tên đã nhập của ứng dụng mới, không ghi đè;
        // yêu cầu chọn rõ ứng dụng trên VPS mới nếu ở chế độ existing
        setAppSelect(-1)
      }
    },
    [clearDeployPreselect, invalidatePrecheck, strings]
  )

  const loadVpsList = useCallback(async (): Promise<void> => {
    setVpsLoading(true)
    setVpsLoadError(null)
    setPreselectVpsError(null)

    const result = await window.api.invoke('vps:list')
    setVpsLoading(false)

    if (!result.ok) {
      setVpsLoadError(result.error.message)
      // Giữ nguyên activePreselectRef.current qua lỗi và nút Thử lại!
      return
    }

    const fetchedVps = result.data
    setVpsList(fetchedVps)

    const pre = activePreselectRef.current
    if (pre?.vpsId) {
      const vpsMatch = fetchedVps.find((v) => v.id === pre.vpsId)
      if (vpsMatch) {
        await selectVps(pre.vpsId, pre.appId, true)
      } else {
        setVpsId(pre.vpsId)
        if (pre.appId !== undefined) {
          setAppSelect(pre.appId)
          setTargetMode('existing')
        }
        setPreselectVpsError(strings.deploy.preselectVpsNotFound)
      }
    } else if (fetchedVps.length > 0) {
      await selectVps(fetchedVps[0].id)
    }
  }, [selectVps, strings])

  useEffect(() => {
    runRef.current = run
  }, [run])

  useEffect(() => {
    if (deployPreselect) {
      activePreselectRef.current = deployPreselect
    }
    if (!deployPreselect && initialLoadedRef.current) {
      return
    }
    initialLoadedRef.current = true
    void loadVpsList()
  }, [deployPreselect, loadVpsList])

  useEffect(() => {
    return window.api.on('deploy:event', (event) => {
      const current = runRef.current
      if (current) {
        if (event.deployment_id !== current.deploymentId) return
        setRun((prev) => {
          const next = prev ? applyEvent(prev, event) : prev
          runRef.current = next
          return next
        })
        return
      }

      if (startPendingRef.current) {
        if (pendingEventsRef.current.length >= MAX_BUFFERED_EVENTS) {
          pendingEventsRef.current.shift()
        }
        pendingEventsRef.current.push(event)
      }
    })
  }, [])

  useEffect(() => {
    if (!run || run.finished || runStartedAt === null) return
    const timer = window.setInterval(() => setElapsedTick(Date.now() - runStartedAt), 500)
    return () => window.clearInterval(timer)
  }, [run, runStartedAt])

  async function runDetect(path: string): Promise<boolean> {
    const requestId = ++sourceRequestRef.current
    setDetecting(true)
    setDetectError(null)
    const result = await window.api.invoke('deploy:detect', path)
    if (sourceRequestRef.current !== requestId) return false
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
    cancelPendingGitPrepare()
    invalidatePrecheck()
    sourceRequestRef.current++
    if (preparedGit)
      void window.api.invoke('deploy:release-git-prepare', preparedGit.prepared_source_handle)
    setPreparedGit(null)
    preparedGitRef.current = null
    setSourceMode('local')
    setSourcePath(result.data.path)
    // Chỉ gợi ý tên ứng dụng mới từ thư mục khi người dùng chưa tự nhập tên
    if (targetMode === 'new' && !userEditedNewAppName) {
      setNewAppName(toAppName(result.data.path))
    }
    setDetection(null)
    setDetectError(null)
    setOptionalKeys([])
    setEnvValues({})
    void runDetect(result.data.path)
  }

  async function prepareGitSource(): Promise<void> {
    cancelPendingGitPrepare()
    const previousHandle = preparedGitRef.current?.prepared_source_handle
    if (previousHandle) {
      void window.api.invoke('deploy:release-git-prepare', previousHandle)
      preparedGitRef.current = null
      setPreparedGit(null)
    }
    const requestId = crypto.randomUUID()
    prepareRequestRef.current = requestId
    setPreparingGit(true)
    setDetectError(null)
    invalidatePrecheck()
    const input: GitSourceInput = {
      source_type: 'git',
      git_repo_url: gitRepoUrl.trim(),
      git_ref: gitRef.trim(),
      git_root: gitRoot.trim() || '.'
    }
    const result = await window.api.invoke('deploy:prepare-git', requestId, input)
    if (prepareRequestRef.current !== requestId) {
      if (result.ok)
        void window.api.invoke('deploy:release-git-prepare', result.data.prepared_source_handle)
      return
    }
    setPreparingGit(false)
    if (!result.ok) {
      setPreparedGit(null)
      preparedGitRef.current = null
      setDetection(null)
      setDetectError(result.error.message)
      return
    }
    setPreparedGit(result.data)
    preparedGitRef.current = result.data
    setDetection(result.data.detection)
  }

  function changeSourceMode(mode: 'local' | 'git'): void {
    if (mode === sourceMode) return
    sourceRequestRef.current++
    cancelPendingGitPrepare()
    if (preparedGit)
      void window.api.invoke('deploy:release-git-prepare', preparedGit.prepared_source_handle)
    setPreparedGit(null)
    preparedGitRef.current = null
    setPreparingGit(false)
    setSourceMode(mode)
    setDetection(null)
    setDetectError(null)
    invalidatePrecheck()
  }

  function discardPreparedGit(): void {
    cancelPendingGitPrepare()
    if (preparedGit)
      void window.api.invoke('deploy:release-git-prepare', preparedGit.prepared_source_handle)
    setPreparedGit(null)
    preparedGitRef.current = null
    invalidatePrecheck()
  }

  function cancelPendingGitPrepare(): void {
    const requestId = prepareRequestRef.current
    prepareRequestRef.current = null
    if (requestId) void window.api.invoke('deploy:cancel-git-prepare', requestId)
    setPreparingGit(false)
  }

  async function continueFromSource(): Promise<void> {
    if (
      vpsLoading ||
      appsLoading ||
      !vpsId ||
      detecting ||
      (sourceMode === 'local' ? !sourcePath : !preparedGit)
    )
      return
    if (targetMode === 'existing') {
      if (appSelect === -1 || !apps.some((app) => app.id === appSelect)) return
    } else if (targetMode === 'new') {
      if (!newAppName.trim() || !APP_NAME_RE.test(newAppName.trim())) return
    }
    if (!detection) {
      const ok =
        sourceMode === 'git'
          ? Boolean(preparedGit?.detection.matched)
          : await runDetect(sourcePath!)
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
    invalidatePrecheck()
    setEnvValues((prev) => ({ ...prev, [key]: value }))
  }

  function addOptional(): void {
    if (!pendingOptional || !matches) return
    invalidatePrecheck()
    setOptionalKeys((prev) => [...prev, pendingOptional])
    setEnv(pendingOptional, '')
    setPendingOptional(undefined)
  }

  function removeOptional(key: string): void {
    invalidatePrecheck()
    setOptionalKeys((prev) => prev.filter((item) => item !== key))
    setEnvValues((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const buildInput = useCallback((): DeploySourceInput => {
    const validApp =
      targetMode === 'existing' && appSelect > 0 ? apps.find((app) => app.id === appSelect) : null

    return {
      vps_id: vpsId as number,
      app_id: validApp ? validApp.id : undefined,
      app_name: validApp ? validApp.name : newAppName.trim(),
      ...(sourceMode === 'git'
        ? {
            source_type: 'git' as const,
            prepared_source_handle: preparedGit?.prepared_source_handle ?? ''
          }
        : { source_path: sourcePath as string }),
      env: Object.fromEntries(Object.entries(envValues).filter(([, value]) => value.trim() !== ''))
    }
  }, [
    appSelect,
    apps,
    envValues,
    newAppName,
    sourcePath,
    sourceMode,
    preparedGit,
    targetMode,
    vpsId
  ])

  const currentConfigSignature = useMemo(() => {
    if (!vpsId || (sourceMode === 'local' ? !sourcePath : !preparedGit)) return ''
    return getConfigSignature(buildInput())
  }, [buildInput, preparedGit, sourceMode, sourcePath, vpsId])

  const isPrecheckValid =
    Boolean(precheck) && Boolean(precheckSignature) && precheckSignature === currentConfigSignature

  const runPrecheck = useCallback(async (): Promise<void> => {
    if (
      !vpsId ||
      (sourceMode === 'local' ? !sourcePath : !preparedGit) ||
      vpsLoading ||
      appsLoading
    )
      return
    if (targetMode === 'existing') {
      const validApp = apps.find((app) => app.id === appSelect)
      if (!validApp) return
    }
    const currentInput = buildInput()
    const targetSignature = getConfigSignature(currentInput)
    const reqId = ++precheckReqIdRef.current

    setPrechecking(true)
    setPrecheck(null)
    setPrecheckSignature(null)
    setPrecheckError(null)

    try {
      const result = await window.api.invoke('deploy:precheck', currentInput)
      if (precheckReqIdRef.current !== reqId) return
      if (getConfigSignature(buildInput()) !== targetSignature) return

      setPrechecking(false)
      if (!result.ok) {
        setPrecheck(null)
        setPrecheckSignature(null)
        setPrecheckError(result.error.message)
        return
      }
      setPrecheck(result.data)
      setPrecheckSignature(targetSignature)
    } catch (err: unknown) {
      if (precheckReqIdRef.current !== reqId) return
      setPrechecking(false)
      setPrecheck(null)
      setPrecheckSignature(null)
      setPrecheckError(err instanceof Error ? err.message : String(err))
    }
  }, [
    apps,
    appsLoading,
    buildInput,
    preparedGit,
    sourceMode,
    sourcePath,
    targetMode,
    appSelect,
    vpsId,
    vpsLoading
  ])

  async function continueFromConfig(): Promise<void> {
    if (!matches) return
    if (!APP_NAME_RE.test(appName)) {
      setConfigError(strings.deploy.config.appNameRule)
      return
    }
    const missing = requiredMissing()
    if (missing.length > 0) {
      setConfigError(strings.deploy.config.missingRequired(missing))
      return
    }
    setConfigError(null)
    setStep(3)
    await runPrecheck()
  }

  async function startDeploy(): Promise<void> {
    if (startPendingRef.current) return
    const currentInput = buildInput()
    const currentSignature = getConfigSignature(currentInput)
    if (!precheck?.passed || precheckSignature !== currentSignature || prechecking) return

    pendingEventsRef.current = []
    startPendingRef.current = true
    setStarting(true)
    setStartError(null)
    const input = { ...currentInput, host_port: precheck.assigned_host_port }

    try {
      const startInput: DeployStartInput =
        sourceMode === 'git' && preparedGit && precheck.precheck_token
          ? {
              ...input,
              source_type: 'git',
              prepared_source_handle: preparedGit.prepared_source_handle,
              precheck_token: precheck.precheck_token
            }
          : (input as DeployStartInput)
      const result = await window.api.invoke('deploy:start', startInput)
      if (!result.ok) {
        startPendingRef.current = false
        setStarting(false)
        pendingEventsRef.current = []
        setStartError(result.error.message)
        return
      }

      const deploymentId = result.data.deployment_id
      let nextRun: RunView = {
        deploymentId,
        steps: initialSteps(),
        buffer: ''
      }

      // Sau khi nhận ID, chỉ áp dụng event đúng deployment, kể cả finished đến sớm
      const earlyEvents = pendingEventsRef.current.filter(
        (evt) => evt.deployment_id === deploymentId
      )
      pendingEventsRef.current = []

      for (const evt of earlyEvents) {
        nextRun = applyEvent(nextRun, evt)
      }

      runRef.current = nextRun
      setRun(nextRun)
      setRunStartedAt(Date.now())
      setElapsedTick(0)
    } catch (err: unknown) {
      startPendingRef.current = false
      setStarting(false)
      pendingEventsRef.current = []
      setStartError(err instanceof Error ? err.message : String(err))
    }
  }

  function resetWizard(): void {
    cancelPendingGitPrepare()
    if (preparedGit)
      void window.api.invoke('deploy:release-git-prepare', preparedGit.prepared_source_handle)
    setPreparedGit(null)
    preparedGitRef.current = null
    setPreparingGit(false)
    startPendingRef.current = false
    setStarting(false)
    pendingEventsRef.current = []
    runRef.current = null
    setRun(null)
    setRunStartedAt(null)
    invalidatePrecheck()
    setStartError(null)
    setStep(0)
  }

  function openApp(url?: string): void {
    const target = url || runRef.current?.finished?.appUrl || run?.finished?.appUrl
    if (target && isValidHttpUrl(target)) {
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
      <Space size="small">
        <Typography.Text strong>{strings.deploy.vpsLabel}</Typography.Text>
        {vpsLoading && <Spin size="small" />}
      </Space>
      <select
        className="deploy-vps-select"
        value={vpsId ?? ''}
        onChange={(event) => {
          const nextVpsId = Number(event.currentTarget.value)
          clearPreselectSession()
          setPreselectVpsError(null)
          setPreselectAppError(null)
          void selectVps(nextVpsId)
        }}
      >
        {vpsList.map((vps) => (
          <option key={vps.id} value={vps.id}>
            {vps.name} — {vps.host}:{vps.port}
          </option>
        ))}
      </select>
      {preselectVpsError && (
        <Alert
          style={{ marginTop: 8 }}
          type="error"
          showIcon
          message={strings.deploy.preselectVpsNotFound}
          description={vpsId ? `VPS ID: ${vpsId}` : undefined}
          action={
            <Space>
              <Button size="small" onClick={() => void loadVpsList()}>
                {strings.common.retry}
              </Button>
              {vpsList.length > 0 && (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    clearPreselectSession()
                    setPreselectVpsError(null)
                    void selectVps(vpsList[0].id)
                  }}
                >
                  {strings.deploy.chooseAvailableVps}
                </Button>
              )}
            </Space>
          }
        />
      )}
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

      {vpsLoading && vpsList.length === 0 ? (
        <div
          className="deploy-initial-loading"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '64px 0'
          }}
        >
          <Spin size="large" />
          <Typography.Text type="secondary" style={{ marginTop: 16 }}>
            {strings.deploy.vpsLoading}
          </Typography.Text>
        </div>
      ) : vpsLoadError ? (
        <Alert
          type="error"
          showIcon
          message={strings.deploy.vpsLoadError}
          description={vpsLoadError}
          action={
            <Button size="small" onClick={() => void loadVpsList()}>
              {strings.common.retry}
            </Button>
          }
        />
      ) : vpsList.length === 0 ? (
        <Empty description={strings.deploy.noVps} />
      ) : (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Steps size="small" current={step} items={wizardSteps} />

          {step === 0 && (
            <div className="deploy-step-body">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {vpsField}

                <div>
                  <Radio.Group
                    value={sourceMode}
                    onChange={(event) => changeSourceMode(event.target.value as 'local' | 'git')}
                    optionType="button"
                    buttonStyle="solid"
                  >
                    <Radio.Button value="local">{strings.deploy.git.modeLocal}</Radio.Button>
                    <Radio.Button value="git">{strings.deploy.git.modeGit}</Radio.Button>
                  </Radio.Group>
                  {sourceMode === 'git' ? (
                    <Space
                      direction="vertical"
                      size="small"
                      style={{ width: '100%', marginTop: 12 }}
                    >
                      <Typography.Text type="secondary">
                        {strings.deploy.git.instructions}
                      </Typography.Text>
                      <Input
                        aria-label={strings.deploy.git.repository}
                        placeholder="https://github.com/owner/repository.git"
                        value={gitRepoUrl}
                        onChange={(event) => {
                          discardPreparedGit()
                          setGitRepoUrl(event.target.value)
                        }}
                      />
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          aria-label={strings.deploy.git.ref}
                          placeholder={strings.deploy.git.ref}
                          value={gitRef}
                          onChange={(event) => {
                            discardPreparedGit()
                            setGitRef(event.target.value)
                          }}
                        />
                        <Input
                          aria-label={strings.deploy.git.root}
                          placeholder="."
                          value={gitRoot}
                          onChange={(event) => {
                            discardPreparedGit()
                            setGitRoot(event.target.value)
                          }}
                        />
                        <Button
                          type="primary"
                          loading={preparingGit}
                          onClick={() => void prepareGitSource()}
                          disabled={!gitRepoUrl.trim() || !gitRef.trim()}
                        >
                          {preparingGit ? strings.deploy.git.preparing : strings.deploy.git.prepare}
                        </Button>
                      </Space.Compact>
                      {preparedGit && (
                        <Alert
                          type="success"
                          showIcon
                          message={strings.deploy.git.ready}
                          description={
                            <Space direction="vertical">
                              <span>
                                {preparedGit.git_repo_url} · {preparedGit.git_ref} ·{' '}
                                {preparedGit.git_root}
                              </span>
                              <span>
                                {strings.deploy.git.sha}:{' '}
                                <Typography.Text code copyable>
                                  {preparedGit.git_commit_sha}
                                </Typography.Text>
                              </span>
                            </Space>
                          }
                        />
                      )}
                    </Space>
                  ) : null}
                </div>

                <div>
                  <Typography.Text strong>{strings.deploy.targetApp.title}</Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <Radio.Group
                      value={targetMode}
                      onChange={(e) => {
                        const newMode = e.target.value as 'new' | 'existing'
                        clearPreselectSession()
                        invalidatePrecheck()
                        setTargetMode(newMode)
                        setPreselectAppError(null)
                        if (newMode === 'new') {
                          setAppSelect(-1)
                          if (!userEditedNewAppName && !newAppName.trim() && sourcePath) {
                            setNewAppName(toAppName(sourcePath))
                          }
                        } else {
                          setAppSelect(-1)
                        }
                      }}
                    >
                      <Radio.Button value="new">{strings.deploy.targetApp.new}</Radio.Button>
                      <Radio.Button value="existing">
                        {strings.deploy.targetApp.existing}
                      </Radio.Button>
                    </Radio.Group>
                  </div>

                  {targetMode === 'existing' && (
                    <div style={{ marginTop: 12 }}>
                      {appsLoading && (
                        <Space size="small">
                          <Spin size="small" />
                          <Typography.Text type="secondary">
                            {strings.deploy.appLoading}
                          </Typography.Text>
                        </Space>
                      )}
                      {appLoadError && (
                        <Alert
                          type="error"
                          showIcon
                          message={strings.deploy.appLoadError}
                          description={appLoadError}
                          action={
                            <Button
                              size="small"
                              onClick={() => {
                                if (vpsId)
                                  void selectVps(
                                    vpsId,
                                    appSelect === -1 ? undefined : appSelect,
                                    Boolean(activePreselectRef.current)
                                  )
                              }}
                            >
                              {strings.common.retry}
                            </Button>
                          }
                        />
                      )}
                      {preselectAppError && (
                        <Alert
                          type="error"
                          showIcon
                          message={strings.deploy.preselectAppNotFound}
                          description={appSelect > 0 ? `App ID: ${appSelect}` : undefined}
                          action={
                            <Space>
                              <Button
                                size="small"
                                onClick={() => {
                                  if (vpsId) void selectVps(vpsId, appSelect, true)
                                }}
                              >
                                {strings.common.retry}
                              </Button>
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => {
                                  clearPreselectSession()
                                  invalidatePrecheck()
                                  setPreselectAppError(null)
                                  setTargetMode('new')
                                  setAppSelect(-1)
                                  if (!userEditedNewAppName && !newAppName.trim() && sourcePath) {
                                    setNewAppName(toAppName(sourcePath))
                                  }
                                }}
                              >
                                {strings.deploy.switchToNewApp}
                              </Button>
                            </Space>
                          }
                        />
                      )}
                      {!appsLoading && !appLoadError && !preselectAppError && apps.length === 0 && (
                        <Alert type="info" showIcon message={strings.deploy.targetApp.noApps} />
                      )}
                      {!appsLoading && !appLoadError && !preselectAppError && apps.length > 0 && (
                        <select
                          className="deploy-vps-select deploy-app-select"
                          aria-label={strings.deploy.targetApp.selectApp}
                          value={appSelect}
                          onChange={(e) => {
                            const selectedId = Number(e.currentTarget.value)
                            invalidatePrecheck()
                            discardPreparedGit()
                            if (selectedId > 0) {
                              clearPreselectSession()
                              setAppSelect(selectedId)
                              const app = apps.find((candidate) => candidate.id === selectedId)
                              if (app?.source_type === 'git' && app.git_repo_url) {
                                setGitRepoUrl(app.git_repo_url)
                                setGitRef(app.git_ref ?? 'main')
                                setGitRoot(app.git_root ?? '.')
                                changeSourceMode('git')
                              }
                            } else {
                              setAppSelect(-1)
                            }
                          }}
                        >
                          <option value="-1" disabled>
                            {strings.deploy.targetApp.selectAppPlaceholder}
                          </option>
                          {apps.map((app) => (
                            <option key={app.id} value={app.id}>
                              {app.name} — port {app.host_port}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {targetMode === 'new' && (
                    <div style={{ marginTop: 12 }}>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
                      >
                        {strings.deploy.targetApp.appName}
                      </Typography.Text>
                      <Input
                        className="mono-input"
                        placeholder="my-app"
                        value={newAppName}
                        onChange={(e) => {
                          invalidatePrecheck()
                          setNewAppName(e.target.value)
                          setUserEditedNewAppName(e.target.value.trim().length > 0)
                        }}
                      />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {strings.deploy.targetApp.appNameRule}
                      </Typography.Text>
                    </div>
                  )}
                </div>

                {sourceMode === 'local' && (
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
                        <Typography.Text type="secondary">
                          {strings.deploy.detecting}
                        </Typography.Text>
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
                )}
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
                    value={targetMode === 'existing' ? appSelect : -1}
                    onChange={(value) => {
                      clearPreselectSession()
                      invalidatePrecheck()
                      if (value === -1) {
                        setTargetMode('new')
                        setAppSelect(-1)
                        if (!userEditedNewAppName && !newAppName.trim() && sourcePath) {
                          setNewAppName(toAppName(sourcePath))
                        }
                        return
                      }
                      setTargetMode('existing')
                      setAppSelect(value)
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
                    disabled={targetMode === 'existing'}
                    onChange={(event) => {
                      invalidatePrecheck()
                      setNewAppName(event.target.value)
                      setUserEditedNewAppName(event.target.value.trim().length > 0)
                    }}
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
                <Card size="small" className="deploy-review-summary-card">
                  <Descriptions
                    title={strings.deploy.review.summaryTitle}
                    column={2}
                    size="small"
                    bordered
                  >
                    <Descriptions.Item label={strings.deploy.review.targetVps}>
                      <Typography.Text strong>
                        {vpsList.find((v) => v.id === vpsId)?.name ??
                          (vpsId ? `VPS #${vpsId}` : '—')}
                      </Typography.Text>
                      {vpsList.find((v) => v.id === vpsId) && (
                        <Typography.Text type="secondary">
                          {' '}
                          ({vpsList.find((v) => v.id === vpsId)?.host}:
                          {vpsList.find((v) => v.id === vpsId)?.port})
                        </Typography.Text>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label={strings.deploy.review.targetApp}>
                      <Space size="small">
                        <Tag color={targetMode === 'existing' ? 'blue' : 'green'}>
                          {targetMode === 'existing'
                            ? strings.deploy.targetApp.existing
                            : strings.deploy.targetApp.new}
                        </Tag>
                        <Typography.Text code strong>
                          {appName || '—'}
                        </Typography.Text>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label={strings.deploy.review.sourcePath} span={2}>
                      <Typography.Text code>
                        {sourceMode === 'git'
                          ? `${preparedGit?.git_repo_url ?? gitRepoUrl} · ${preparedGit?.git_ref ?? gitRef} · ${preparedGit?.git_root ?? gitRoot}`
                          : sourcePath || '—'}
                      </Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label={strings.deploy.review.envList} span={2}>
                      {Object.keys(envValues).filter((k) => envValues[k].trim() !== '').length ===
                      0 ? (
                        <Typography.Text type="secondary">
                          {strings.deploy.review.noEnv}
                        </Typography.Text>
                      ) : (
                        <Space wrap size={[8, 4]}>
                          {Object.entries(envValues)
                            .filter(([, v]) => v.trim() !== '')
                            .map(([key]) => (
                              <Tag key={key} className="deploy-env-tag">
                                <Typography.Text strong>{key}</Typography.Text>{' '}
                                <Typography.Text type="secondary">
                                  ({strings.deploy.review.envConfigured})
                                </Typography.Text>
                              </Tag>
                            ))}
                        </Space>
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 4
                  }}
                >
                  <Space size="small">
                    <Typography.Text strong>{strings.deploy.review.title}</Typography.Text>
                    {prechecking && <Spin size="small" />}
                  </Space>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={() => void runPrecheck()}
                    disabled={prechecking}
                  >
                    {strings.deploy.review.retry}
                  </Button>
                </div>

                {prechecking && (
                  <Alert
                    type="info"
                    showIcon
                    icon={<Spin size="small" />}
                    message={strings.deploy.review.checking}
                  />
                )}

                {precheckError && (
                  <Alert
                    type="error"
                    showIcon
                    message={strings.deploy.review.error}
                    description={
                      <div>
                        <div>{precheckError}</div>
                        <Button
                          size="small"
                          type="primary"
                          danger
                          style={{ marginTop: 8 }}
                          onClick={() => void runPrecheck()}
                        >
                          {strings.deploy.review.retry}
                        </Button>
                      </div>
                    }
                  />
                )}

                {precheck && !prechecking && isPrecheckValid && (
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
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label={strings.deploy.review.urlLabel}>
                        <Typography.Text code copyable>
                          {precheck.app_url}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {' '}
                          (port {precheck.assigned_host_port})
                        </Typography.Text>
                      </Descriptions.Item>
                    </Descriptions>
                    {!precheck.passed && (
                      <Alert
                        type="warning"
                        showIcon
                        message={strings.deploy.review.deployDisabled}
                      />
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
                disabled={
                  vpsLoading ||
                  appsLoading ||
                  !vpsId ||
                  (sourceMode === 'local' ? !sourcePath : !preparedGit) ||
                  detecting ||
                  Boolean(vpsLoadError) ||
                  Boolean(preselectVpsError) ||
                  Boolean(preselectAppError) ||
                  (targetMode === 'existing' &&
                    (appSelect === -1 ||
                      Boolean(appLoadError) ||
                      !apps.some((a) => a.id === appSelect))) ||
                  (targetMode === 'new' && (!appName.trim() || !APP_NAME_RE.test(appName)))
                }
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
                icon={starting ? <LoadingOutlined /> : <RocketOutlined />}
                loading={starting}
                disabled={!precheck?.passed || !isPrecheckValid || prechecking || starting}
                onClick={() => void startDeploy()}
              >
                {starting ? strings.deploy.review.starting : strings.deploy.review.deploy}
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

  const exposureStatus: 'reachable' | 'degraded' | 'tunnel_only' | 'not_checked' =
    finished?.exposureStatus ?? (appUrl ? 'reachable' : 'not_checked')

  const isAccessConfirmed = exposureStatus === 'reachable' || exposureStatus === 'tunnel_only'
  const canOpenApp = Boolean(
    finished && finished.status === 'running' && isAccessConfirmed && isValidHttpUrl(appUrl)
  )
  const failedStepLabel = failedStep ? (strings.deploy.log.steps?.[failedStep] ?? failedStep) : '—'

  let exposureAlertType: 'success' | 'warning' | 'info' = 'success'
  let exposureTitle = strings.deploy.exposure.reachableTitle
  let exposureDescription = strings.deploy.exposure.reachableDesc
  let exposureTagColor: 'success' | 'warning' | 'cyan' | 'default' = 'success'
  let exposureTagLabel = strings.deploy.exposure.reachableTag

  if (exposureStatus === 'degraded') {
    exposureAlertType = 'warning'
    exposureTitle = strings.deploy.exposure.degradedTitle
    exposureDescription = strings.deploy.exposure.blockedHint
    exposureTagColor = 'warning'
    exposureTagLabel = strings.deploy.exposure.degradedTag
  } else if (exposureStatus === 'tunnel_only') {
    exposureAlertType = 'info'
    exposureTitle = strings.deploy.exposure.tunnelOnlyTitle
    exposureDescription = strings.deploy.exposure.tunnelOnlyDesc
    exposureTagColor = 'cyan'
    exposureTagLabel = strings.deploy.exposure.tunnelOnlyTag
  } else if (exposureStatus === 'not_checked') {
    exposureAlertType = 'info'
    exposureTitle = strings.deploy.exposure.notCheckedTitle
    exposureDescription = strings.deploy.exposure.notCheckedDesc
    exposureTagColor = 'default'
    exposureTagLabel = strings.deploy.exposure.notCheckedTag
  }

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

      <div className="deploy-steps-container" role="list" aria-label={strings.deploy.log.title}>
        {SEVEN_STEPS.map((step, idx) => {
          const state = run.steps[step]
          const stepLabel = strings.deploy.log.steps?.[step] ?? step
          const isDone = state.status === 'done'
          const isRunning = state.status === 'running'
          const isFailed = state.status === 'failed'
          const isFirst = idx === 0
          const isLast = idx === SEVEN_STEPS.length - 1

          const lineBeforeActive = isDone || isRunning || isFailed
          const lineAfterActive = isDone

          return (
            <div
              key={step}
              className={`deploy-step-col deploy-step-${state.status}`}
              role="listitem"
            >
              <div className="deploy-step-track">
                {!isFirst && (
                  <div
                    className={`deploy-step-line deploy-step-line-prev ${
                      lineBeforeActive ? 'deploy-step-line-active' : ''
                    }`}
                  />
                )}
                <div className="deploy-step-marker">
                  {isDone ? (
                    <CheckCircleFilled className="deploy-step-icon deploy-step-icon-done" />
                  ) : isRunning ? (
                    <LoadingOutlined className="deploy-step-icon deploy-step-icon-running" />
                  ) : isFailed ? (
                    <CloseCircleFilled className="deploy-step-icon deploy-step-icon-failed" />
                  ) : (
                    <span className="deploy-step-badge">{idx + 1}</span>
                  )}
                </div>
                {!isLast && (
                  <div
                    className={`deploy-step-line deploy-step-line-next ${
                      lineAfterActive ? 'deploy-step-line-active' : ''
                    }`}
                  />
                )}
              </div>
              <div className="deploy-step-meta">
                <span className="deploy-step-label">{stepLabel}</span>
                {isDone && state.durationMs !== undefined && (
                  <span className="deploy-step-time">{formatDuration(state.durationMs)}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {finished?.status === 'running' && (
        <Alert
          className="page-alert"
          type={exposureAlertType}
          showIcon
          message={exposureTitle}
          description={
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Space wrap>
                <Tag color="success">{strings.deploy.exposure.runtimeTag}</Tag>
                <Tag color={exposureTagColor}>{exposureTagLabel}</Tag>
                <Tag>{strings.deploy.log.success(formatDuration(finished.totalDurationMs))}</Tag>
              </Space>
              <Typography.Text type="secondary">{exposureDescription}</Typography.Text>
              {canOpenApp && (
                <Typography.Text code copyable>
                  {appUrl}
                </Typography.Text>
              )}
              {doctorMessage && <Typography.Text>{doctorMessage}</Typography.Text>}
            </Space>
          }
          action={
            <Space>
              {canOpenApp && (
                <Button type="primary" onClick={() => onOpenApp(appUrl)}>
                  {strings.deploy.log.openApp}
                </Button>
              )}
              {onOpenDashboard && (
                <Button onClick={onOpenDashboard}>{strings.deploy.log.viewDashboard}</Button>
              )}
              {exposureStatus === 'degraded' && (
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
              : strings.deploy.log.failedStep(failedStepLabel)
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
                : strings.deploy.log.failedStep(failedStepLabel)
              : strings.deploy.log.running}
          </Tag>
        </Space>
        <Space>
          {canOpenApp && (
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
