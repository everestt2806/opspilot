import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Descriptions, Modal, Space, Table, Tag, Typography } from 'antd'
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined
} from '@ant-design/icons'

import type {
  App,
  MigrateEvent,
  MigrateJobStatus,
  MigrateJobView,
  MigrateStep,
  Vps
} from '@shared/ipc'
import { PageHeader } from '../components/PageHeader'
import { useStrings } from '../strings'
import { DeployTerminal } from './DeployTerminal'

export type MigrateLifecycleStatus =
  'idle' | 'running' | 'awaiting_confirmation' | 'completed' | 'failed' | 'rolled_back'

interface ActiveJobContext {
  jobId: number
  appId: number
  sourceVpsId: number
  targetVpsId: number
}

interface JobCurrentStep {
  step: MigrateStep
  phase: 'running' | 'done'
}

interface JobRuntimeState {
  jobId: number
  appId: number
  sourceVpsId: number
  targetVpsId: number
  status: MigrateLifecycleStatus
  step: number
  currentStep?: JobCurrentStep
  doneCount: number
  downtime?: number
  rows: Array<{ label: string; source: string; target: string; ok: boolean }>
  verifyOk: boolean
  failReason?: string
  stepDurations: Partial<Record<MigrateStep, number>>
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

const MAX_LOG_CHARS_PER_JOB = 100_000

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m${seconds}s`
  return `${seconds}s`
}

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
  let doneCount = 0
  let currentStep: JobCurrentStep | undefined

  const statusToStep: Partial<Record<MigrateJobStatus, MigrateStep>> = {
    preparing: 'PREPARE',
    backing_up: 'BACKUP',
    transferring: 'TRANSFER',
    restoring: 'RESTORE',
    verifying: 'VERIFY'
  }

  if (job.status in statusToStep) {
    const s = statusToStep[job.status]!
    step = MIGRATE_STEPS.indexOf(s)
    doneCount = step
    currentStep = { step: s, phase: 'running' }
  } else if (job.status === 'awaiting_confirm') {
    step = MIGRATE_STEPS.indexOf('AWAITING_CONFIRM')
    doneCount = step
    currentStep = { step: 'AWAITING_CONFIRM', phase: 'running' }
  } else if (job.status === 'completed') {
    step = MIGRATE_STEPS.length - 1
    doneCount = MIGRATE_STEPS.length
  } else if (job.failed_step) {
    const idx = MIGRATE_STEPS.indexOf(job.failed_step.toUpperCase() as MigrateStep)
    step = idx >= 0 ? idx : 0
    doneCount = step
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
      job.error_message ?? (job.failed_step ? `FAILED_STEP:${job.failed_step}` : 'FAILED_UNKNOWN')
  }

  return {
    jobId: job.id,
    appId: job.app_id,
    sourceVpsId: job.source_vps_id,
    targetVpsId: job.target_vps_id,
    status: mapped,
    step,
    currentStep,
    doneCount,
    downtime: job.downtime_ms ?? undefined,
    rows,
    verifyOk,
    failReason,
    stepDurations: {}
  }
}

export function MigratePage(): React.JSX.Element {
  const strings = useStrings()
  const stringsRef = useRef(strings)
  useEffect(() => {
    stringsRef.current = strings
  })

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
  const [currentStep, setCurrentStep] = useState<JobCurrentStep>()
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
  const [stepDurations, setStepDurations] = useState<Partial<Record<MigrateStep, number>>>({})

  // Loading & error states
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Double submit prevention & buffering
  const [isStarting, setIsStarting] = useState(false)
  const startingRef = useRef(false)

  // Separate pre-ID queue, known jobs runtime store & bounded memory logs
  const preIdEventsRef = useRef<MigrateEvent[]>([])
  const jobsStateRef = useRef<Record<number, JobRuntimeState>>({})
  const logsByJobRef = useRef<Record<number, string>>({})
  const truncatedLogsByJobRef = useRef<Record<number, boolean>>({})
  const [isLogTruncated, setIsLogTruncated] = useState(false)
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

  const currentStepText = useMemo(() => {
    if (!currentStep) return undefined
    const stepName = strings.migrate.stepLabels[currentStep.step] ?? currentStep.step
    if (currentStep.phase === 'done') {
      return strings.migrate.steps.stepDone(stepName)
    }
    return stepName
  }, [currentStep, strings.migrate])

  const terminalStepLabel = useMemo(() => {
    if (status === 'completed') {
      return strings.migrate.statuses.completed
    }
    if (status === 'failed') {
      return strings.migrate.statuses.failed
    }
    if (status === 'rolled_back') {
      return strings.migrate.statuses.rolled_back
    }
    if (status === 'awaiting_confirmation') {
      return strings.migrate.stepLabels.AWAITING_CONFIRM
    }
    if (isRunning) {
      if (step >= 0 && step < MIGRATE_STEPS.length) {
        return strings.migrate.stepLabels[MIGRATE_STEPS[step]] ?? strings.migrate.statuses.running
      }
      return strings.migrate.statuses.running
    }
    return strings.migrate.statuses.idle
  }, [isRunning, status, step, strings.migrate])

  const failReasonText = useMemo(() => {
    if (!failReason) return undefined
    if (failReason.startsWith('FAILED_STEP:')) {
      const stepKey = failReason.replace('FAILED_STEP:', '')
      const stepName = strings.migrate.stepLabels[stepKey as MigrateStep] ?? stepKey
      return strings.migrate.alerts.stepErrorNoDetail(stepName)
    }
    if (failReason === 'FAILED_UNKNOWN') {
      return strings.migrate.alerts.stepErrorNoDetail()
    }
    return failReason
  }, [failReason, strings.migrate])

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
    setStepDurations(targetState.stepDurations ?? {})
    setLogs(logsByJobRef.current[jobId] ?? '')
    setIsLogTruncated(Boolean(truncatedLogsByJobRef.current[jobId]))
    setConfirmModalOpen(false)
  }, [])

  const applyEventToJobState = useCallback((event: MigrateEvent): void => {
    // 1. Logs: bounded in-memory store per job
    if (event.type === 'log') {
      const existing = logsByJobRef.current[event.job_id] ?? ''
      const combined = existing + event.chunk
      if (combined.length > MAX_LOG_CHARS_PER_JOB) {
        logsByJobRef.current[event.job_id] = combined.slice(-MAX_LOG_CHARS_PER_JOB)
        truncatedLogsByJobRef.current[event.job_id] = true
        if (activeJobId.current === event.job_id) {
          setLogs(logsByJobRef.current[event.job_id])
          setIsLogTruncated(true)
        }
      } else {
        logsByJobRef.current[event.job_id] = combined
        if (activeJobId.current === event.job_id) {
          setLogs((prev) => prev + event.chunk)
        }
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
      failReason: undefined,
      stepDurations: {}
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
    let nextStepDurations = current.stepDurations ?? {}

    if (event.type === 'step-start') {
      nextStatus = 'running'
      nextCurrentStep = { step: event.step, phase: 'running' }
    } else if (event.type === 'step-done') {
      nextDoneCount += 1
      nextCurrentStep = { step: event.step, phase: 'done' }
      nextStepDurations = { ...nextStepDurations, [event.step]: event.duration_ms }
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
      failReason: nextFailReason,
      stepDurations: nextStepDurations
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
      setStepDurations(st.stepDurations)

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
        if (!appResult.ok) errors.push(strings.migrate.loadErrors.apps(appResult.error.message))
        else setApps(appResult.data)

        if (!vpsResult.ok) errors.push(strings.migrate.loadErrors.vps(vpsResult.error.message))
        else setVps(vpsResult.data)

        if (!migrationResult.ok) {
          errors.push(strings.migrate.loadErrors.migrate(migrationResult.error.message))
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
    [processMigrationList, strings.migrate]
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
          errors.push(stringsRef.current.migrate.loadErrors.apps(appResult.error.message))
        else setApps(appResult.data)

        if (!vpsResult.ok)
          errors.push(stringsRef.current.migrate.loadErrors.vps(vpsResult.error.message))
        else setVps(vpsResult.data)

        if (!migrationResult.ok) {
          errors.push(stringsRef.current.migrate.loadErrors.migrate(migrationResult.error.message))
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
    setIsLogTruncated(false)
    setStepDurations({})
    setDoneCount(0)
    setFailReason(undefined)
    setStatus('running')
    setCurrentStep({ step: 'PREPARE', phase: 'running' })
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
          currentStep: { step: 'PREPARE', phase: 'running' },
          doneCount: terminal?.status === 'completed' ? MIGRATE_STEPS.length : 0,
          downtime: terminal?.downtime_ms ?? undefined,
          rows: [],
          verifyOk: false,
          failReason: terminal?.error ?? undefined,
          stepDurations: {}
        }
        jobsStateRef.current[newJobId] = newJobState
        truncatedLogsByJobRef.current[newJobId] = false
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
    <section className="page-panel migrate-page-panel">
      <PageHeader title={strings.migrate.title} description={strings.migrate.description} />

      <div className="page-stack">
        {loadError && (
          <Alert
            type="error"
            showIcon
            message={strings.migrate.loadError}
            description={loadError}
            action={
              <Button
                size="small"
                type="primary"
                ghost
                onClick={() => void executeLoad(true)}
                loading={loading}
              >
                {strings.migrate.actions.retry}
              </Button>
            }
          />
        )}

        {!loadError && apps.length === 0 && (
          <Alert
            type="info"
            showIcon
            message={strings.migrate.noApps}
            description={strings.migrate.noAppsDesc}
          />
        )}

        {selectableJobs.length > 1 && (
          <Card size="small" className="migrate-active-jobs-card">
            <Space wrap align="center">
              <Typography.Text strong>
                {activeJobs.length > 0
                  ? strings.migrate.activeJobsCount(activeJobs.length)
                  : strings.migrate.jobsListTitle}
              </Typography.Text>
              <select
                className="migrate-native-select migrate-job-selector"
                aria-label={strings.migrate.selectJobAria}
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
                  const statusMapped = mapJobStatus(j.status)
                  const label =
                    strings.migrate.statuses[statusMapped] ??
                    STATUS_META[statusMapped]?.label ??
                    j.status
                  return (
                    <option key={j.id} value={j.id}>
                      Job #{j.id} · {itemApp?.name ?? strings.migrate.overview.noApp(j.app_id)} (
                      {itemSourceVps?.name ?? strings.migrate.overview.noVps(j.source_vps_id)} →{' '}
                      {itemTargetVps?.name ?? strings.migrate.overview.noVps(j.target_vps_id)}) ·{' '}
                      {label}
                    </option>
                  )
                })}
              </select>
            </Space>
          </Card>
        )}

        <Card size="small" className="migrate-setup-card">
          <Space
            wrap
            className="migrate-toolbar"
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <Space wrap>
              <select
                className="migrate-native-select migrate-source-select"
                aria-label={strings.migrate.draft.sourceLabel}
                value={draftAppId ?? ''}
                disabled={isJobActive}
                onChange={(event) => {
                  setDraftAppId(Number(event.currentTarget.value))
                  setDraftTargetVpsId(undefined)
                }}
              >
                <option value="" disabled>
                  {strings.migrate.draft.sourceLabel}
                </option>
                {apps.filter((item) => item.imported_from_vps !== 1).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ·{' '}
                    {vps.find((candidate) => candidate.id === item.vps_id)?.name ??
                      strings.migrate.overview.noVps(item.vps_id)}
                  </option>
                ))}
              </select>

              <select
                className="migrate-native-select"
                aria-label={strings.migrate.draft.targetLabel}
                value={draftTargetVpsId ?? ''}
                disabled={isJobActive || !draftSource}
                onChange={(event) => setDraftTargetVpsId(Number(event.currentTarget.value))}
              >
                <option value="" disabled>
                  {strings.migrate.draft.targetLabel}
                </option>
                {draftTargets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.host}
                  </option>
                ))}
              </select>
            </Space>

            <Space wrap>
              <Button
                type="primary"
                onClick={() => void start()}
                disabled={isJobActive || !draftSource || draftTargetVpsId === undefined}
                loading={isStarting}
              >
                {strings.migrate.draft.startBtn}
              </Button>

              <Button danger onClick={() => void abort()} disabled={!canAbort}>
                {strings.migrate.actions.abort}
              </Button>
            </Space>
          </Space>
        </Card>

        {jobContext && (
          <Card size="small" className="migrate-job-banner migrate-overview-card">
            <div className="migrate-overview-grid">
              <div className="migrate-overview-endpoints">
                <span>
                  <strong>{strings.migrate.overview.jobId}</strong> #{jobContext.jobId}
                </span>
                <Typography.Text type="secondary">|</Typography.Text>
                <span>
                  <strong>{strings.migrate.overview.sourceApp}:</strong>{' '}
                  {jobApp?.name ??
                    (jobContext.appId ? strings.migrate.overview.noApp(jobContext.appId) : '—')}
                </span>
                <Typography.Text type="secondary">|</Typography.Text>
                <span>
                  <strong>{strings.migrate.overview.sourceVps}:</strong>{' '}
                  {jobSourceVps?.name ??
                    (jobContext.sourceVpsId
                      ? strings.migrate.overview.noVps(jobContext.sourceVpsId)
                      : '—')}
                  {jobSourceVps?.host ? ` (${jobSourceVps.host})` : ''}
                </span>
                <ArrowRightOutlined style={{ color: 'var(--text-muted)', fontSize: 12 }} />
                <span>
                  <strong>{strings.migrate.overview.targetVps}:</strong>{' '}
                  {jobTargetVps?.name ??
                    (jobContext.targetVpsId
                      ? strings.migrate.overview.noVps(jobContext.targetVpsId)
                      : '—')}
                  {jobTargetVps?.host ? ` (${jobTargetVps.host})` : ''}
                </span>
              </div>
            </div>
          </Card>
        )}

        {error && <Alert type="error" showIcon message={error} />}

        {failReasonText && (
          <Alert
            type="error"
            showIcon
            message={
              status === 'failed'
                ? strings.migrate.alerts.failedMessage
                : strings.migrate.alerts.rolledBackMessage
            }
            description={failReasonText}
          />
        )}

        {status === 'completed' && (
          <Alert
            type="success"
            showIcon
            message={strings.migrate.alerts.completedTitle}
            description={strings.migrate.alerts.completedDesc}
          />
        )}

        <Card size="small" className="migrate-steps-card">
          <div
            className="deploy-steps-container"
            role="list"
            aria-label={strings.migrate.stepsAriaLabel}
          >
            {MIGRATE_STEPS.map((stepKey, idx) => {
              let stepStatus: 'done' | 'running' | 'failed' | 'pending' = 'pending'
              if (status === 'completed') {
                stepStatus = 'done'
              } else if (status === 'failed' || status === 'rolled_back') {
                if (idx < step) stepStatus = 'done'
                else if (idx === step) stepStatus = 'failed'
                else stepStatus = 'pending'
              } else if (status === 'awaiting_confirmation') {
                if (idx < 6) stepStatus = 'done'
                else if (idx === 6) stepStatus = 'running'
              } else if (status === 'running') {
                if (idx < step) stepStatus = 'done'
                else if (idx === step) stepStatus = 'running'
                else stepStatus = 'pending'
              }

              const stepLabel = strings.migrate.stepLabels[stepKey] ?? stepKey
              const isDone = stepStatus === 'done'
              const isRunning = stepStatus === 'running'
              const isFailed = stepStatus === 'failed'
              const isFirst = idx === 0
              const isLast = idx === MIGRATE_STEPS.length - 1

              const lineBeforeActive = isDone || isRunning || isFailed
              const lineAfterActive = isDone

              return (
                <div
                  key={stepKey}
                  className={`deploy-step-col deploy-step-${stepStatus}`}
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
                    {stepDurations[stepKey] !== undefined && isDone && (
                      <span className="deploy-step-time">
                        {formatDuration(stepDurations[stepKey]!)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div
            style={{
              marginTop: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8
            }}
          >
            <Typography.Text style={{ fontSize: 13 }}>
              {strings.migrate.overview.statusLabel}{' '}
              <Tag color={STATUS_META[status].color}>
                {strings.migrate.statuses[status] ?? STATUS_META[status].label}
              </Tag>
              {currentStepText && isRunning && ` (${currentStepText})`}
              {downtime !== undefined && ` · ${strings.migrate.overview.downtime(downtime)}`}
            </Typography.Text>
          </div>
        </Card>

        {rows.length > 0 && (
          <Card
            size="small"
            className="migrate-verify-card"
            title={strings.migrate.verify.title}
            extra={
              <Tag color={verifyOk ? 'success' : 'error'}>
                {verifyOk ? strings.migrate.verify.ok : strings.migrate.verify.fail}
              </Tag>
            }
          >
            <Table
              size="small"
              pagination={false}
              rowKey="label"
              dataSource={rows}
              columns={[
                {
                  title: strings.migrate.verify.columns.item,
                  dataIndex: 'label',
                  render: (label: string) => strings.migrate.verify.items?.[label] ?? label
                },
                { title: strings.migrate.verify.columns.source, dataIndex: 'source' },
                { title: strings.migrate.verify.columns.target, dataIndex: 'target' },
                {
                  title: strings.migrate.verify.columns.status,
                  dataIndex: 'ok',
                  render: (ok: boolean) => (
                    <Tag color={ok ? 'success' : 'error'}>
                      {ok ? strings.migrate.verify.ok : strings.migrate.verify.fail}
                    </Tag>
                  )
                }
              ]}
            />
          </Card>
        )}

        {status === 'awaiting_confirmation' && (
          <div className="migrate-confirm-box">
            <Alert
              type={verifyOk ? 'info' : 'warning'}
              showIcon
              message={
                verifyOk
                  ? strings.migrate.alerts.awaitingTitle
                  : strings.migrate.alerts.notPassedVerify
              }
              description={
                verifyOk
                  ? strings.migrate.alerts.awaitingDesc
                  : strings.migrate.alerts.notPassedVerifyDesc
              }
              action={
                <Button
                  type="primary"
                  onClick={() => setConfirmModalOpen(true)}
                  disabled={!verifyOk}
                >
                  {strings.migrate.actions.confirm}
                </Button>
              }
            />
          </div>
        )}

        <div className="migrate-terminal-card">
          {isLogTruncated && (
            <div className="migrate-truncated-notice" role="status">
              <Alert
                type="warning"
                showIcon
                message={strings.migrate.terminal.truncatedNotice}
                style={{ marginBottom: 8 }}
              />
            </div>
          )}

          <DeployTerminal
            jobId={jobContext?.jobId}
            title={strings.migrate.terminal.title}
            stepLabel={terminalStepLabel}
            emptyText={strings.migrate.terminal.emptyText}
            buffer={logs}
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
      </div>

      {confirmModalOpen && status === 'awaiting_confirmation' && jobContext && (
        <Modal
          open={confirmModalOpen && status === 'awaiting_confirmation'}
          onCancel={() => !isConfirming && setConfirmModalOpen(false)}
          title={strings.migrate.modal.title}
          footer={null}
          destroyOnHidden
        >
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={strings.migrate.overview.sourceApp}>
                <strong>
                  {jobApp?.name ??
                    (jobContext.appId ? strings.migrate.overview.noApp(jobContext.appId) : '—')}
                </strong>
              </Descriptions.Item>
              <Descriptions.Item label={strings.migrate.overview.sourceVps}>
                {jobSourceVps?.name ??
                  (jobContext.sourceVpsId
                    ? strings.migrate.overview.noVps(jobContext.sourceVpsId)
                    : '—')}
                {jobSourceVps?.host ? ` (${jobSourceVps.host})` : ''}
              </Descriptions.Item>
              <Descriptions.Item label={strings.migrate.overview.targetVps}>
                {jobTargetVps?.name ??
                  (jobContext.targetVpsId
                    ? strings.migrate.overview.noVps(jobContext.targetVpsId)
                    : '—')}
                {jobTargetVps?.host ? ` (${jobTargetVps.host})` : ''}
              </Descriptions.Item>
              {downtime !== undefined && (
                <Descriptions.Item label={strings.migrate.modal.recordedDowntime}>
                  {strings.migrate.overview.downtime(downtime)}
                </Descriptions.Item>
              )}
            </Descriptions>

            <div style={{ marginTop: 8 }}>
              <Typography.Paragraph strong style={{ marginBottom: 6 }}>
                {strings.migrate.modal.desc}
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                • <strong>{strings.migrate.modal.keepSourceBtn}:</strong>{' '}
                {strings.migrate.modal.keepSourceDesc.replace(/^[^:]+:\s*/, '')}
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                • <strong>{strings.migrate.modal.stopSourceBtn}:</strong>{' '}
                {strings.migrate.modal.stopSourceDesc.replace(/^[^:]+:\s*/, '')}
              </Typography.Paragraph>
            </div>

            <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 16 }} wrap>
              <Button onClick={() => setConfirmModalOpen(false)} disabled={isConfirming}>
                {strings.migrate.modal.cancelBtn}
              </Button>
              <Button
                type="primary"
                onClick={() => void handleConfirm(true)}
                disabled={isConfirming || status !== 'awaiting_confirmation' || !verifyOk}
                loading={isConfirming && confirmChoice === true}
              >
                {strings.migrate.modal.keepSourceBtn}
              </Button>
              <Button
                danger
                onClick={() => void handleConfirm(false)}
                disabled={isConfirming || status !== 'awaiting_confirmation' || !verifyOk}
                loading={isConfirming && confirmChoice === false}
              >
                {strings.migrate.modal.stopSourceBtn}
              </Button>
            </Space>
          </Space>
        </Modal>
      )}
    </section>
  )
}
