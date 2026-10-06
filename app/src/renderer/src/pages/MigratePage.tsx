import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Modal,
  Space,
  Steps,
  Table,
  Tag,
  Typography
} from 'antd'

import type {
  App,
  MigrateEvent,
  MigrateJobStatus,
  MigrateJobView,
  MigrateStep,
  Vps
} from '@shared/ipc'
import { PageHeader } from '../components/PageHeader'
import { DeployTerminal } from './DeployTerminal'

export type MigrateLifecycleStatus =
  'idle' | 'running' | 'awaiting_confirmation' | 'completed' | 'failed' | 'rolled_back'

interface ActiveJobContext {
  jobId: number
  appId: number
  sourceVpsId: number
  targetVpsId: number
}

interface JobRuntimeState {
  jobId: number
  appId: number
  sourceVpsId: number
  targetVpsId: number
  status: MigrateLifecycleStatus
  step: number
  currentStep?: string
  doneCount: number
  downtime?: number
  rows: Array<{ label: string; source: string; target: string; ok: boolean }>
  verifyOk: boolean
  failReason?: string
}

const MIGRATE_STEPS: readonly MigrateStep[] = [
  'PREPARE',
  'FREEZE',
  'BACKUP',
  'TRANSFER',
  'RESTORE',
  'VERIFY',
  'AWAITING_CONFIRM'
]

const STATUS_META: Record<
  MigrateLifecycleStatus,
  {
    label: string
    color: string
    badgeStatus: 'default' | 'processing' | 'warning' | 'success' | 'error'
  }
> = {
  idle: { label: 'Chưa bắt đầu', color: 'default', badgeStatus: 'default' },
  running: { label: 'Đang chạy', color: 'processing', badgeStatus: 'processing' },
  awaiting_confirmation: { label: 'Chờ xác nhận', color: 'warning', badgeStatus: 'warning' },
  completed: { label: 'Hoàn tất', color: 'success', badgeStatus: 'success' },
  failed: { label: 'Thất bại', color: 'error', badgeStatus: 'error' },
  rolled_back: { label: 'Đã rollback', color: 'purple', badgeStatus: 'default' }
}

function mapJobStatus(jobStatus: MigrateJobStatus): MigrateLifecycleStatus {
  switch (jobStatus) {
    case 'awaiting_confirm':
      return 'awaiting_confirmation'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'rolled_back':
      return 'rolled_back'
    case 'preparing':
    case 'backing_up':
    case 'transferring':
    case 'restoring':
    case 'verifying':
      return 'running'
    default:
      return 'idle'
  }
}

function initJobStateFromView(job: MigrateJobView): JobRuntimeState {
  const mapped = mapJobStatus(job.status)
  let step = 0
  if (job.status === 'awaiting_confirm') {
    step = MIGRATE_STEPS.indexOf('AWAITING_CONFIRM')
  } else if (job.status === 'completed') {
    step = MIGRATE_STEPS.length - 1
  } else if (job.failed_step) {
    const idx = MIGRATE_STEPS.indexOf(job.failed_step.toUpperCase() as MigrateStep)
    step = idx >= 0 ? idx : 0
  }

  let verifyOk = false
  let rows: Array<{ label: string; source: string; target: string; ok: boolean }> = []
  if (job.verify_json) {
    try {
      const verify = JSON.parse(job.verify_json) as {
        ok?: boolean
        rows?: Array<{ label: string; source: string; target: string; ok: boolean }>
      }
      verifyOk = verify.ok === true
      if (Array.isArray(verify.rows)) {
        rows = verify.rows
      }
    } catch {
      verifyOk = false
      rows = []
    }
  }

  let failReason: string | undefined
  if (mapped === 'failed' || mapped === 'rolled_back') {
    failReason =
      job.error_message ?? `Lỗi ở bước ${job.failed_step ?? 'không xác định'} (không có chi tiết).`
  }

  return {
    jobId: job.id,
    appId: job.app_id,
    sourceVpsId: job.source_vps_id,
    targetVpsId: job.target_vps_id,
    status: mapped,
    step,
    currentStep: undefined,
    doneCount: mapped === 'completed' ? MIGRATE_STEPS.length : 0,
    downtime: job.downtime_ms ?? undefined,
    rows,
    verifyOk,
    failReason
  }
}

export function MigratePage(): React.JSX.Element {
  const [apps, setApps] = useState<App[]>([])
  const [vps, setVps] = useState<Vps[]>([])
  const [jobsList, setJobsList] = useState<MigrateJobView[]>([])

  // Draft picker state for preparing a new migration job
  const [draftAppId, setDraftAppId] = useState<number>()
  const [draftTargetVpsId, setDraftTargetVpsId] = useState<number>()

  // Fixed active job context (cannot be manipulated by draft picker)
  const [jobContext, setJobContext] = useState<ActiveJobContext | null>(null)
  const activeJobId = useRef<number | undefined>(undefined)

  // Progress, terminal & validation states for the currently viewed job
  const [step, setStep] = useState(-1)
  const [currentStep, setCurrentStep] = useState<string>()
  const [status, setStatus] = useState<MigrateLifecycleStatus>('idle')
  const [downtime, setDowntime] = useState<number>()
  const [rows, setRows] = useState<
    Array<{ label: string; source: string; target: string; ok: boolean }>
  >([])
  const [error, setError] = useState<string>()
  const [logs, setLogs] = useState('')
  const [doneCount, setDoneCount] = useState(0)
  const [failReason, setFailReason] = useState<string>()
  const [verifyOk, setVerifyOk] = useState(false)

  // Loading & error states
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Double submit prevention & buffering
  const [isStarting, setIsStarting] = useState(false)
  const startingRef = useRef(false)

  // Separate pre-ID queue and known jobs runtime store
  const preIdEventsRef = useRef<MigrateEvent[]>([])
  const jobsStateRef = useRef<Record<number, JobRuntimeState>>({})
  const logsByJobRef = useRef<Record<number, string>>({})
  const terminalJobStatusRef = useRef<
    Record<
      number,
      {
        status: 'completed' | 'failed' | 'rolled_back'
        downtime_ms?: number
        error?: string
      }
    >
  >({})

  // Confirmation modal states
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmChoice, setConfirmChoice] = useState<boolean | null>(null)
  const confirmingRef = useRef(false)

  const activeJobs = useMemo(() => {
    return jobsList.filter(
      (j) => j.status !== 'completed' && j.status !== 'failed' && j.status !== 'rolled_back'
    )
  }, [jobsList])

  // Selectable jobs include all known jobs (both active and finished) so users can inspect them
  const selectableJobs = useMemo(() => {
    const seen = new Set<number>()
    const result: MigrateJobView[] = []
    for (const j of jobsList) {
      if (!seen.has(j.id)) {
        seen.add(j.id)
        result.push(j)
      }
    }
    return result
  }, [jobsList])

  const isRunning = status === 'running'
  const isJobActive = isStarting || isRunning || status === 'awaiting_confirmation'
  const canAbort =
    jobContext !== null && (status === 'running' || status === 'awaiting_confirmation')

  const draftSource = apps.find((item) => item.id === draftAppId)
  const draftTargets = useMemo(
    () => vps.filter((item) => item.id !== draftSource?.vps_id),
    [draftSource, vps]
  )

  const jobApp = jobContext ? apps.find((item) => item.id === jobContext.appId) : undefined
  const jobSourceVps = jobContext
    ? vps.find((item) => item.id === jobContext.sourceVpsId)
    : undefined
  const jobTargetVps = jobContext
    ? vps.find((item) => item.id === jobContext.targetVpsId)
    : undefined

  const switchToJob = useCallback((jobId: number) => {
    const targetState = jobsStateRef.current[jobId]
    if (!targetState) return

    activeJobId.current = jobId
    const context: ActiveJobContext = {
      jobId: targetState.jobId,
      appId: targetState.appId,
      sourceVpsId: targetState.sourceVpsId,
      targetVpsId: targetState.targetVpsId
    }
    setJobContext(context)
    setDraftAppId(targetState.appId)
    setDraftTargetVpsId(targetState.targetVpsId)

    // Set screen state strictly from targetState to prevent leaking previous job's state
    setStatus(targetState.status)
    setStep(targetState.step)
    setCurrentStep(targetState.currentStep)
    setDoneCount(targetState.doneCount)
    setDowntime(targetState.downtime)
    setRows(targetState.rows)
    setVerifyOk(targetState.verifyOk)
    setFailReason(targetState.failReason)
    setLogs(logsByJobRef.current[jobId] ?? '')
    setConfirmModalOpen(false)
  }, [])

  const applyEventToJobState = useCallback((event: MigrateEvent): void => {
    // 1. Logs: directly append to string store without capping/queueing
    if (event.type === 'log') {
      logsByJobRef.current[event.job_id] = (logsByJobRef.current[event.job_id] ?? '') + event.chunk
      if (activeJobId.current === event.job_id) {
        setLogs((prev) => prev + event.chunk)
      }
      return
    }

    // Ensure state exists for this job in jobsStateRef
    const current = jobsStateRef.current[event.job_id] ?? {
      jobId: event.job_id,
      appId: 0,
      sourceVpsId: 0,
      targetVpsId: 0,
      status: 'running',
      step: 0,
      currentStep: undefined,
      doneCount: 0,
      downtime: undefined,
      rows: [],
      verifyOk: false,
      failReason: undefined
    }

    let nextStep = current.step
    if ('step' in event && event.step) {
      nextStep = Math.max(0, MIGRATE_STEPS.indexOf(event.step))
    }

    let nextStatus = current.status
    let nextCurrentStep = current.currentStep
    let nextDoneCount = current.doneCount
    let nextRows = current.rows
    let nextVerifyOk = current.verifyOk
    let nextDowntime = current.downtime
    let nextFailReason = current.failReason

    if (event.type === 'step-start') {
      nextStatus = 'running'
      nextCurrentStep = event.step
    } else if (event.type === 'step-done') {
      nextDoneCount += 1
      nextCurrentStep = `${event.step} hoàn tất`
    } else if (event.type === 'verify-result') {
      nextRows = event.rows
      nextVerifyOk = event.rows.every((row) => row.ok)
    } else if (event.type === 'awaiting-confirm') {
      nextStatus = 'awaiting_confirmation'
      nextStep = MIGRATE_STEPS.indexOf('AWAITING_CONFIRM')
      nextDowntime = event.downtime_ms
    } else if (event.type === 'finished') {
      nextDowntime = event.downtime_ms
      if (event.status === 'completed') {
        nextStatus = 'completed'
        nextFailReason = undefined
        nextStep = MIGRATE_STEPS.length - 1
        nextDoneCount = MIGRATE_STEPS.length
      } else if (event.status === 'failed') {
        nextStatus = 'failed'
        nextFailReason = event.error
      } else if (event.status === 'rolled_back') {
        nextStatus = 'rolled_back'
        nextFailReason = event.error
      }
    }

    if (terminalJobStatusRef.current[event.job_id]) {
      nextStatus = terminalJobStatusRef.current[event.job_id].status
    }

    const st: JobRuntimeState = {
      ...current,
      status: nextStatus,
      step: nextStep,
      currentStep: nextCurrentStep,
      doneCount: nextDoneCount,
      rows: nextRows,
      verifyOk: nextVerifyOk,
      downtime: nextDowntime,
      failReason: nextFailReason
    }
    jobsStateRef.current[event.job_id] = st

    // If this is the currently active job, update screen state immediately
    if (activeJobId.current === event.job_id) {
      setStatus(st.status)
      setStep(st.step)
      setCurrentStep(st.currentStep)
      setDoneCount(st.doneCount)
      setDowntime(st.downtime)
      setRows(st.rows)
      setVerifyOk(st.verifyOk)
      setFailReason(st.failReason)

      if (event.type === 'finished') {
        setConfirmModalOpen(false)
        setIsConfirming(false)
        confirmingRef.current = false
        if (event.status === 'completed') {
          void window.api.invoke('app:list').then((result) => {
            if (result.ok) setApps(result.data)
          })
        }
      }
    }
  }, [])

  const handleEvent = useCallback(
    (event: MigrateEvent): void => {
      // 1. Keep jobsList status updated and record terminal status
      if (event.type === 'finished') {
        terminalJobStatusRef.current[event.job_id] = {
          status: event.status as 'completed' | 'failed' | 'rolled_back',
          downtime_ms: event.downtime_ms,
          error: event.error
        }
        setJobsList((prev) =>
          prev.map((j) =>
            j.id === event.job_id
              ? {
                  ...j,
                  status: event.status as MigrateJobStatus,
                  downtime_ms: event.downtime_ms ?? j.downtime_ms,
                  error_message: event.error ?? j.error_message
                }
              : j
          )
        )
      } else if (event.type === 'awaiting-confirm') {
        setJobsList((prev) =>
          prev.map((j) => (j.id === event.job_id ? { ...j, status: 'awaiting_confirm' } : j))
        )
      }

      // 2. Pre-ID queue: only for events arriving when starting before job ID is returned
      const isKnownJob = event.job_id in jobsStateRef.current
      if (startingRef.current && !isKnownJob) {
        preIdEventsRef.current.push(event)
        return
      }

      // 3. For all known jobs, or if not starting: update job state directly
      applyEventToJobState(event)
    },
    [applyEventToJobState]
  )

  const processMigrationList = useCallback(
    (rawList: MigrateJobView[]) => {
      const list = rawList.map((j) => {
        const terminal = terminalJobStatusRef.current[j.id]
        if (terminal) {
          return {
            ...j,
            status: terminal.status as MigrateJobStatus,
            downtime_ms: terminal.downtime_ms ?? j.downtime_ms,
            error_message: terminal.error ?? j.error_message
          }
        }
        return j
      })
      setJobsList(list)

      // Populate jobsStateRef for each job in list
      for (const j of list) {
        const terminal = terminalJobStatusRef.current[j.id]
        const existing = jobsStateRef.current[j.id]
        if (existing) {
          jobsStateRef.current[j.id] = {
            ...existing,
            appId: j.app_id,
            sourceVpsId: j.source_vps_id,
            targetVpsId: j.target_vps_id,
            status: terminal ? terminal.status : existing.status,
            downtime: terminal?.downtime_ms ?? existing.downtime,
            failReason: terminal?.error ?? existing.failReason
          }
        } else {
          const initialState = initJobStateFromView(j)
          if (terminal) {
            initialState.status = terminal.status
            initialState.downtime = terminal.downtime_ms ?? initialState.downtime
            initialState.failReason = terminal.error ?? initialState.failReason
            if (terminal.status === 'completed') {
              initialState.doneCount = MIGRATE_STEPS.length
              initialState.step = MIGRATE_STEPS.length - 1
            }
          }
          jobsStateRef.current[j.id] = initialState
        }
      }

      // Drain any pre-fetch events received
      if (preIdEventsRef.current.length > 0) {
        const pendingEvents = [...preIdEventsRef.current]
        preIdEventsRef.current = []
        for (const ev of pendingEvents) {
          applyEventToJobState(ev)
        }
      }

      const active = list.filter(
        (j) => j.status !== 'completed' && j.status !== 'failed' && j.status !== 'rolled_back'
      )
      const currentId = activeJobId.current
      const currentStillInList = currentId !== undefined && list.some((j) => j.id === currentId)
      const targetToRestore = currentStillInList
        ? list.find((j) => j.id === currentId)
        : active.length > 0
          ? active[0]
          : list[0]
      if (targetToRestore) {
        switchToJob(targetToRestore.id)
      }
    },
    [applyEventToJobState, switchToJob]
  )

  const executeLoad = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) {
        setLoading(true)
      }
      setLoadError(null)
      try {
        const [appResult, vpsResult, migrationResult] = await Promise.all([
          window.api.invoke('app:list'),
          window.api.invoke('vps:list'),
          window.api.invoke('migrate:list')
        ])

        const errors: string[] = []
        if (!appResult.ok)
          errors.push(`Không thể tải danh sách ứng dụng: ${appResult.error.message}`)
        else setApps(appResult.data)

        if (!vpsResult.ok) errors.push(`Không thể tải danh sách VPS: ${vpsResult.error.message}`)
        else setVps(vpsResult.data)

        if (!migrationResult.ok) {
          errors.push(`Không thể tải danh sách migrate: ${migrationResult.error.message}`)
        } else {
          processMigrationList(migrationResult.data ?? [])
        }

        if (errors.length > 0) {
          setLoadError(errors.join('; '))
        }
      } catch (err: unknown) {
        setLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        if (showLoading) {
          setLoading(false)
        }
      }
    },
    [processMigrationList]
  )

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.api.invoke('app:list'),
      window.api.invoke('vps:list'),
      window.api.invoke('migrate:list')
    ])
      .then(([appResult, vpsResult, migrationResult]) => {
        if (cancelled) return
        const errors: string[] = []
        if (!appResult.ok)
          errors.push(`Không thể tải danh sách ứng dụng: ${appResult.error.message}`)
        else setApps(appResult.data)

        if (!vpsResult.ok) errors.push(`Không thể tải danh sách VPS: ${vpsResult.error.message}`)
        else setVps(vpsResult.data)

        if (!migrationResult.ok) {
          errors.push(`Không thể tải danh sách migrate: ${migrationResult.error.message}`)
        } else {
          processMigrationList(migrationResult.data ?? [])
        }

        if (errors.length > 0) {
          setLoadError(errors.join('; '))
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })

    const unsubscribe = window.api.on('migrate:event', handleEvent)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [handleEvent, processMigrationList])

  const start = async (): Promise<void> => {
    if (
      startingRef.current ||
      isStarting ||
      isJobActive ||
      draftAppId === undefined ||
      draftTargetVpsId === undefined
    ) {
      return
    }

    const selectedSource = apps.find((item) => item.id === draftAppId)
    if (!selectedSource) return

    startingRef.current = true
    setIsStarting(true)
    preIdEventsRef.current = []
    setError(undefined)
    setVerifyOk(false)
    setRows([])
    setLogs('')
    setDoneCount(0)
    setFailReason(undefined)
    setStatus('running')
    setCurrentStep('PREPARE')
    setStep(0)

    try {
      const result = await window.api.invoke('migrate:start', {
        app_id: draftAppId,
        target_vps_id: draftTargetVpsId
      })

      if (!result.ok) {
        setError(result.error.message)
        setStatus('idle')
        preIdEventsRef.current = []
      } else {
        const newJobId = result.data.job_id
        const terminal = terminalJobStatusRef.current[newJobId]
        const newJobView: MigrateJobView = {
          id: newJobId,
          app_id: draftAppId,
          source_vps_id: selectedSource.vps_id,
          target_vps_id: draftTargetVpsId,
          status: terminal ? (terminal.status as MigrateJobStatus) : 'preparing',
          failed_step: null,
          error_message: terminal?.error ?? null,
          downtime_ms: terminal?.downtime_ms ?? null,
          bytes_transferred: null,
          verify_json: null,
          source_kept: null,
          started_at: new Date().toISOString(),
          finished_at: null
        }
        setJobsList((prev) => [newJobView, ...prev.filter((j) => j.id !== newJobId)])

        const newJobState: JobRuntimeState = {
          jobId: newJobId,
          appId: draftAppId,
          sourceVpsId: selectedSource.vps_id,
          targetVpsId: draftTargetVpsId,
          status: terminal ? terminal.status : 'running',
          step: terminal?.status === 'completed' ? MIGRATE_STEPS.length - 1 : 0,
          currentStep: 'PREPARE',
          doneCount: terminal?.status === 'completed' ? MIGRATE_STEPS.length : 0,
          downtime: terminal?.downtime_ms ?? undefined,
          rows: [],
          verifyOk: false,
          failReason: terminal?.error ?? undefined
        }
        jobsStateRef.current[newJobId] = newJobState
        activeJobId.current = newJobId

        // Drain buffered pre-ID events matching newJobId
        const preEvents = preIdEventsRef.current.filter((ev) => ev.job_id === newJobId)
        preIdEventsRef.current = preIdEventsRef.current.filter((ev) => ev.job_id !== newJobId)
        for (const ev of preEvents) {
          applyEventToJobState(ev)
        }

        switchToJob(newJobId)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('idle')
      preIdEventsRef.current = []
    } finally {
      startingRef.current = false
      setIsStarting(false)
    }
  }

  const handleConfirm = async (keepSource: boolean): Promise<void> => {
    if (
      confirmingRef.current ||
      isConfirming ||
      jobContext === null ||
      status !== 'awaiting_confirmation' ||
      !verifyOk
    ) {
      return
    }
    confirmingRef.current = true
    setIsConfirming(true)
    setConfirmChoice(keepSource)
    setError(undefined)

    try {
      const result = await window.api.invoke('migrate:confirm', jobContext.jobId, keepSource)
      if (!result.ok) {
        setError(result.error.message)
      } else {
        setConfirmModalOpen(false)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      confirmingRef.current = false
      setIsConfirming(false)
      setConfirmChoice(null)
    }
  }

  const abort = async (): Promise<void> => {
    if (jobContext === null || (status !== 'running' && status !== 'awaiting_confirmation')) {
      return
    }
    setError(undefined)
    try {
      const result = await window.api.invoke('migrate:abort', jobContext.jobId)
      if (!result.ok) {
        setError(result.error.message)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="page-panel">
      <PageHeader
        title="Migrate giữa hai VPS"
        description="PREPARE → FREEZE → BACKUP → TRANSFER → RESTORE → VERIFY"
      />

      <div className="page-stack">
        {loadError && (
          <Alert
            type="error"
            showIcon
            message="Lỗi tải danh sách"
            description={loadError}
            action={
              <Button
                size="small"
                type="primary"
                ghost
                onClick={() => void executeLoad(true)}
                loading={loading}
              >
                Thử lại
              </Button>
            }
          />
        )}

        {!loadError && apps.length === 0 && (
          <Alert
            type="info"
            showIcon
            message="Chưa có ứng dụng nào"
            description="Chưa có ứng dụng nào trên các máy chủ để thực hiện di chuyển."
          />
        )}

        {selectableJobs.length > 1 && (
          <Card size="small" className="migrate-active-jobs-card">
            <Space wrap align="center">
              <Typography.Text strong>
                {activeJobs.length > 0
                  ? `Có ${activeJobs.length} tiến trình đang hoạt động:`
                  : 'Danh sách tiến trình di chuyển:'}
              </Typography.Text>
              <select
                className="migrate-native-select migrate-job-selector"
                aria-label="Chọn tiến trình cần theo dõi"
                value={jobContext?.jobId ?? ''}
                onChange={(event) => {
                  const selectedId = Number(event.target.value)
                  switchToJob(selectedId)
                }}
              >
                {selectableJobs.map((j) => {
                  const itemApp = apps.find((candidate) => candidate.id === j.app_id)
                  const itemSourceVps = vps.find((candidate) => candidate.id === j.source_vps_id)
                  const itemTargetVps = vps.find((candidate) => candidate.id === j.target_vps_id)
                  const label = STATUS_META[mapJobStatus(j.status)]?.label ?? j.status
                  return (
                    <option key={j.id} value={j.id}>
                      Job #{j.id} · {itemApp?.name ?? `App #${j.app_id}`} (
                      {itemSourceVps?.name ?? `VPS #${j.source_vps_id}`} →{' '}
                      {itemTargetVps?.name ?? `VPS #${j.target_vps_id}`}) · {label}
                    </option>
                  )
                })}
              </select>
            </Space>
          </Card>
        )}

        <Space wrap className="migrate-toolbar">
          <select
            className="migrate-native-select migrate-source-select"
            aria-label="Chọn app nguồn"
            value={draftAppId ?? ''}
            disabled={isJobActive}
            onChange={(event) => {
              setDraftAppId(Number(event.currentTarget.value))
              setDraftTargetVpsId(undefined)
            }}
          >
            <option value="" disabled>
              Chọn app nguồn
            </option>
            {apps.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ·{' '}
                {vps.find((candidate) => candidate.id === item.vps_id)?.name ??
                  `VPS ${item.vps_id}`}
              </option>
            ))}
          </select>

          <select
            className="migrate-native-select"
            aria-label="Chọn VPS đích"
            value={draftTargetVpsId ?? ''}
            disabled={isJobActive || !draftSource}
            onChange={(event) => setDraftTargetVpsId(Number(event.currentTarget.value))}
          >
            <option value="" disabled>
              Chọn VPS đích
            </option>
            {draftTargets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.host}
              </option>
            ))}
          </select>

          <Button
            type="primary"
            onClick={() => void start()}
            disabled={isJobActive || !draftSource || draftTargetVpsId === undefined}
            loading={isStarting}
          >
            Bắt đầu migrate
          </Button>

          <Button danger onClick={() => void abort()} disabled={!canAbort}>
            Huỷ & rollback
          </Button>
        </Space>

        {jobContext && (
          <Card size="small" className="migrate-job-banner">
            <Space wrap size="middle">
              <span>
                <strong>Job ID:</strong> #{jobContext.jobId}
              </span>
              <span>
                <strong>Ứng dụng:</strong>{' '}
                {jobApp?.name ?? (jobContext.appId ? `App #${jobContext.appId}` : '—')}
              </span>
              <span>
                <strong>VPS nguồn:</strong>{' '}
                {jobSourceVps?.name ??
                  (jobContext.sourceVpsId ? `VPS #${jobContext.sourceVpsId}` : '—')}
                {jobSourceVps?.host ? ` (${jobSourceVps.host})` : ''}
              </span>
              <span>
                <strong>VPS đích:</strong>{' '}
                {jobTargetVps?.name ??
                  (jobContext.targetVpsId ? `VPS #${jobContext.targetVpsId}` : '—')}
                {jobTargetVps?.host ? ` (${jobTargetVps.host})` : ''}
              </span>
            </Space>
          </Card>
        )}

        {error && <Alert type="error" showIcon message={error} />}

        {failReason && (
          <Alert
            type="error"
            showIcon
            message={
              status === 'failed'
                ? 'Migrate thất bại và nguồn chưa khôi phục được — xem lý do và gợi ý xử lý trong log bên dưới.'
                : 'Migrate thất bại và đã rollback về app nguồn — xem lý do và gợi ý xử lý trong log bên dưới.'
            }
            description={failReason}
          />
        )}

        <Card>
          <Steps
            size="small"
            current={step}
            status={
              status === 'failed'
                ? 'error'
                : status === 'completed'
                  ? 'finish'
                  : status === 'awaiting_confirmation'
                    ? 'process'
                    : undefined
            }
            items={MIGRATE_STEPS.map((title) => ({ title }))}
          />

          <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
            Trạng thái: <Tag color={STATUS_META[status].color}>{STATUS_META[status].label}</Tag>
            {currentStep && isRunning && ` (${currentStep})`}
            {downtime !== undefined && ` · Downtime: ${downtime} ms`}
          </Typography.Paragraph>

          {rows.length > 0 && (
            <Table
              style={{ marginTop: 12 }}
              pagination={false}
              rowKey="label"
              dataSource={rows}
              columns={[
                { title: 'Hạng mục', dataIndex: 'label' },
                { title: 'Nguồn', dataIndex: 'source' },
                { title: 'Đích', dataIndex: 'target' },
                {
                  title: 'Kết quả',
                  dataIndex: 'ok',
                  render: (ok: boolean) => (
                    <Tag color={ok ? 'success' : 'error'}>{ok ? 'PASS' : 'FAIL'}</Tag>
                  )
                }
              ]}
            />
          )}

          {status === 'awaiting_confirmation' && (
            <div className="migrate-confirm-box" style={{ marginTop: 16 }}>
              <Alert
                type={verifyOk ? 'info' : 'warning'}
                showIcon
                message={
                  verifyOk
                    ? 'Quá trình kiểm tra (VERIFY) đã đạt. Sẵn sàng hoàn tất di chuyển.'
                    : 'Chưa đạt kết quả kiểm tra (VERIFY) — không thể xác nhận.'
                }
                description={
                  verifyOk
                    ? 'Nhấn nút bên dưới để xem chi tiết và xác nhận lựa chọn xử lý container trên VPS nguồn.'
                    : 'Chỉ cho phép xác nhận khi kết quả kiểm tra tính toàn vẹn (VERIFY) đạt tất cả tiêu chí.'
                }
                action={
                  <Button
                    type="primary"
                    onClick={() => setConfirmModalOpen(true)}
                    disabled={!verifyOk}
                  >
                    Xác nhận di chuyển
                  </Button>
                }
              />
            </div>
          )}
        </Card>

        <DeployTerminal
          buffer={logs}
          activeStep={isRunning && step >= 0 ? MIGRATE_STEPS[step] : undefined}
          completedSteps={doneCount}
          totalSteps={MIGRATE_STEPS.length}
          status={
            isRunning
              ? 'streaming'
              : status === 'completed'
                ? 'success'
                : status === 'failed' || status === 'rolled_back'
                  ? 'failed'
                  : 'streaming'
          }
        />
      </div>

      {confirmModalOpen && status === 'awaiting_confirmation' && jobContext && (
        <Modal
          open={confirmModalOpen && status === 'awaiting_confirmation'}
          onCancel={() => !isConfirming && setConfirmModalOpen(false)}
          title="Xác nhận hoàn tất di chuyển ứng dụng"
          footer={null}
          destroyOnHidden
        >
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Ứng dụng">
                <strong>
                  {jobApp?.name ?? (jobContext.appId ? `App #${jobContext.appId}` : '—')}
                </strong>
              </Descriptions.Item>
              <Descriptions.Item label="VPS nguồn">
                {jobSourceVps?.name ??
                  (jobContext.sourceVpsId ? `VPS #${jobContext.sourceVpsId}` : '—')}
                {jobSourceVps?.host ? ` (${jobSourceVps.host})` : ''}
              </Descriptions.Item>
              <Descriptions.Item label="VPS đích">
                {jobTargetVps?.name ??
                  (jobContext.targetVpsId ? `VPS #${jobContext.targetVpsId}` : '—')}
                {jobTargetVps?.host ? ` (${jobTargetVps.host})` : ''}
              </Descriptions.Item>
              {downtime !== undefined && (
                <Descriptions.Item label="Downtime ghi nhận">{downtime} ms</Descriptions.Item>
              )}
            </Descriptions>

            <div style={{ marginTop: 8 }}>
              <Typography.Paragraph strong style={{ marginBottom: 6 }}>
                Vui lòng chọn một trong hai phương án kết thúc:
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                • <strong>Giữ app nguồn:</strong> Tiếp tục duy trì container ứng dụng chạy trên VPS
                nguồn làm bản dự phòng song song.
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                • <strong>Dừng app nguồn bằng docker compose down:</strong> Thực hiện lệnh{' '}
                <code>docker compose down</code> trên VPS nguồn để dừng ứng dụng và giải phóng tài
                nguyên.
              </Typography.Paragraph>
            </div>

            <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 16 }} wrap>
              <Button onClick={() => setConfirmModalOpen(false)} disabled={isConfirming}>
                Hủy
              </Button>
              <Button
                type="primary"
                onClick={() => void handleConfirm(true)}
                disabled={isConfirming || status !== 'awaiting_confirmation' || !verifyOk}
                loading={isConfirming && confirmChoice === true}
              >
                Giữ app nguồn
              </Button>
              <Button
                danger
                onClick={() => void handleConfirm(false)}
                disabled={isConfirming || status !== 'awaiting_confirmation' || !verifyOk}
                loading={isConfirming && confirmChoice === false}
              >
                Dừng app nguồn bằng docker compose down
              </Button>
            </Space>
          </Space>
        </Modal>
      )}
    </section>
  )
}
