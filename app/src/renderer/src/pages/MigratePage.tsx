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

  // Progress, terminal & validation states
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
  const earlyEventsRef = useRef<MigrateEvent[]>([])
  const logsByJobRef = useRef<Record<number, string>>({})

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

  const applyEvent = useCallback((event: MigrateEvent): void => {
    if (event.type === 'log') {
      setLogs((prev) => prev + event.chunk)
      logsByJobRef.current[event.job_id] = (logsByJobRef.current[event.job_id] ?? '') + event.chunk
      return
    }
    if ('step' in event && event.step) {
      setStep(Math.max(0, MIGRATE_STEPS.indexOf(event.step)))
    }
    if (event.type === 'step-start') {
      setStatus('running')
      setCurrentStep(event.step)
    }
    if (event.type === 'step-done') {
      setDoneCount((count) => count + 1)
      setCurrentStep(`${event.step} hoàn tất`)
    }
    if (event.type === 'verify-result') {
      setRows(event.rows)
      setVerifyOk(event.rows.every((row) => row.ok))
    }
    if (event.type === 'awaiting-confirm') {
      setStatus('awaiting_confirmation')
      setStep(MIGRATE_STEPS.indexOf('AWAITING_CONFIRM'))
      setDowntime(event.downtime_ms)
    }
    if (event.type === 'finished') {
      setDowntime(event.downtime_ms)
      // Close & lock modal immediately upon receiving terminal event
      setConfirmModalOpen(false)
      setIsConfirming(false)
      confirmingRef.current = false

      if (event.status === 'completed') {
        setStatus('completed')
        setFailReason(undefined)
        void window.api.invoke('app:list').then((result) => {
          if (result.ok) setApps(result.data)
        })
      } else if (event.status === 'failed') {
        setStatus('failed')
        if (event.error) setFailReason(event.error)
      } else if (event.status === 'rolled_back') {
        setStatus('rolled_back')
        if (event.error) setFailReason(event.error)
      }
    }
  }, [])

  const handleEvent = useCallback(
    (event: MigrateEvent): void => {
      // Keep jobsList status updated
      if (event.type === 'finished') {
        setJobsList((prev) =>
          prev.map((j) =>
            j.id === event.job_id ? { ...j, status: event.status as MigrateJobStatus } : j
          )
        )
      } else if (event.type === 'awaiting-confirm') {
        setJobsList((prev) =>
          prev.map((j) => (j.id === event.job_id ? { ...j, status: 'awaiting_confirm' } : j))
        )
      }

      // 1. If currently starting or no job has been selected yet: buffer event
      if (startingRef.current || activeJobId.current === undefined) {
        if (earlyEventsRef.current.length < 100) {
          earlyEventsRef.current.push(event)
        }
        return
      }

      // 2. Reject events from other jobs (buffer them in case user switches)
      if (event.job_id !== activeJobId.current) {
        if (earlyEventsRef.current.length < 100) {
          earlyEventsRef.current.push(event)
        }
        return
      }

      // 3. Apply event to the currently active job
      applyEvent(event)
    },
    [applyEvent]
  )

  const restoreJob = useCallback(
    (job: MigrateJobView) => {
      activeJobId.current = job.id
      const context: ActiveJobContext = {
        jobId: job.id,
        appId: job.app_id,
        sourceVpsId: job.source_vps_id,
        targetVpsId: job.target_vps_id
      }
      setJobContext(context)
      setDraftAppId(job.app_id)
      setDraftTargetVpsId(job.target_vps_id)

      const mapped = mapJobStatus(job.status)
      setStatus(mapped)
      setDowntime(job.downtime_ms ?? undefined)
      setConfirmModalOpen(false)

      if (mapped === 'failed' || mapped === 'rolled_back') {
        setFailReason(
          job.error_message ??
            `Lỗi ở bước ${job.failed_step ?? 'không xác định'} (không có chi tiết).`
        )
      } else {
        setFailReason(undefined)
      }

      if (job.status === 'awaiting_confirm') {
        setStep(MIGRATE_STEPS.indexOf('AWAITING_CONFIRM'))
      } else if (job.status === 'completed') {
        setStep(MIGRATE_STEPS.length - 1)
      } else if (job.failed_step) {
        const idx = MIGRATE_STEPS.indexOf(job.failed_step.toUpperCase() as MigrateStep)
        setStep(idx >= 0 ? idx : 0)
      } else {
        setStep(0)
      }

      if (job.verify_json) {
        try {
          const verify = JSON.parse(job.verify_json) as {
            ok?: boolean
            rows?: Array<{ label: string; source: string; target: string; ok: boolean }>
          }
          setVerifyOk(verify.ok === true)
          if (Array.isArray(verify.rows)) {
            setRows(verify.rows)
          } else {
            setRows([])
          }
        } catch {
          setVerifyOk(false)
          setRows([])
        }
      } else {
        setVerifyOk(false)
        setRows([])
      }

      // Restore logs from per-job buffer
      setLogs(logsByJobRef.current[job.id] ?? '')

      // Drain early events for this job
      const matching = earlyEventsRef.current.filter((ev) => ev.job_id === job.id)
      earlyEventsRef.current = earlyEventsRef.current.filter((ev) => ev.job_id !== job.id)
      for (const ev of matching) {
        applyEvent(ev)
      }
    },
    [applyEvent]
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
          const list = migrationResult.data ?? []
          setJobsList(list)
          const active = list.filter(
            (j) => j.status !== 'completed' && j.status !== 'failed' && j.status !== 'rolled_back'
          )
          const targetToRestore = active.length > 0 ? active[0] : list[0]
          if (targetToRestore) {
            restoreJob(targetToRestore)
          }
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
    [restoreJob]
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
          const list = migrationResult.data ?? []
          setJobsList(list)
          const active = list.filter(
            (j) => j.status !== 'completed' && j.status !== 'failed' && j.status !== 'rolled_back'
          )
          const targetToRestore = active.length > 0 ? active[0] : list[0]
          if (targetToRestore) {
            restoreJob(targetToRestore)
          }
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
  }, [restoreJob, handleEvent])

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
    earlyEventsRef.current = []
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
        earlyEventsRef.current = []
      } else {
        const newJobId = result.data.job_id
        activeJobId.current = newJobId
        const context: ActiveJobContext = {
          jobId: newJobId,
          appId: draftAppId,
          sourceVpsId: selectedSource.vps_id,
          targetVpsId: draftTargetVpsId
        }
        setJobContext(context)

        const newJobView: MigrateJobView = {
          id: newJobId,
          app_id: draftAppId,
          source_vps_id: selectedSource.vps_id,
          target_vps_id: draftTargetVpsId,
          status: 'preparing',
          failed_step: null,
          error_message: null,
          downtime_ms: null,
          bytes_transferred: null,
          verify_json: null,
          source_kept: null,
          started_at: new Date().toISOString(),
          finished_at: null
        }
        setJobsList((prev) => [newJobView, ...prev.filter((j) => j.id !== newJobId)])

        // Drain buffered early events
        const matching = earlyEventsRef.current.filter((ev) => ev.job_id === newJobId)
        earlyEventsRef.current = earlyEventsRef.current.filter((ev) => ev.job_id !== newJobId)
        for (const ev of matching) {
          applyEvent(ev)
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('idle')
      earlyEventsRef.current = []
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

        {activeJobs.length > 1 && (
          <Card size="small" className="migrate-active-jobs-card">
            <Space wrap align="center">
              <Typography.Text strong>
                Có {activeJobs.length} tiến trình đang hoạt động:
              </Typography.Text>
              <select
                className="migrate-native-select migrate-job-selector"
                aria-label="Chọn tiến trình cần theo dõi"
                value={jobContext?.jobId ?? ''}
                onChange={(event) => {
                  const selectedId = Number(event.currentTarget.value)
                  const targetJob = jobsList.find((j) => j.id === selectedId)
                  if (targetJob) {
                    restoreJob(targetJob)
                  }
                }}
              >
                {activeJobs.map((j) => {
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
