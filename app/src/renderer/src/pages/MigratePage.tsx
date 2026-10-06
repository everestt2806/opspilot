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
  const [appId, setAppId] = useState<number>()
  const [targetVpsId, setTargetVpsId] = useState<number>()
  const [jobId, setJobId] = useState<number>()
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

  // Double submit prevention & early event buffering
  const [isStarting, setIsStarting] = useState(false)
  const startingRef = useRef(false)
  const earlyEventsRef = useRef<MigrateEvent[]>([])
  const activeJobId = useRef<number | undefined>(undefined)

  // Confirmation modal states
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmChoice, setConfirmChoice] = useState<boolean | null>(null)
  const confirmingRef = useRef(false)

  const applyEvent = useCallback((event: MigrateEvent): void => {
    if (event.type === 'log') {
      setLogs((prev) => prev + event.chunk)
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
      // 1. If currently starting and waiting for job ID: buffer early event
      if (startingRef.current || activeJobId.current === undefined) {
        if (earlyEventsRef.current.length < 50) {
          earlyEventsRef.current.push(event)
        }
        return
      }

      // 2. Reject events from other jobs
      if (event.job_id !== activeJobId.current) {
        return
      }

      // 3. Apply event
      applyEvent(event)
    },
    [applyEvent]
  )

  const restoreJob = useCallback((job: MigrateJobView) => {
    activeJobId.current = job.id
    setJobId(job.id)
    setAppId(job.app_id)
    setTargetVpsId(job.target_vps_id)

    const mapped = mapJobStatus(job.status)
    setStatus(mapped)
    setDowntime(job.downtime_ms ?? undefined)

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
        }
      } catch {
        setVerifyOk(false)
      }
    }
  }, [])

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
          const latest = migrationResult.data?.[0] as MigrateJobView | undefined
          if (latest) {
            restoreJob(latest)
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
          const latest = migrationResult.data?.[0] as MigrateJobView | undefined
          if (latest) {
            restoreJob(latest)
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

  const source = apps.find((item) => item.id === appId)
  const sourceVps = vps.find((item) => item.id === source?.vps_id)
  const targetVps = vps.find((item) => item.id === targetVpsId)
  const targets = useMemo(() => vps.filter((item) => item.id !== source?.vps_id), [source, vps])
  const isRunning = status === 'running'

  const start = async (): Promise<void> => {
    if (
      startingRef.current ||
      isStarting ||
      isRunning ||
      appId === undefined ||
      targetVpsId === undefined
    ) {
      return
    }

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
        app_id: appId,
        target_vps_id: targetVpsId
      })

      if (!result.ok) {
        setError(result.error.message)
        setStatus('idle')
        earlyEventsRef.current = []
      } else {
        const newJobId = result.data.job_id
        activeJobId.current = newJobId
        setJobId(newJobId)

        // Drain buffered early events
        const buffered = [...earlyEventsRef.current]
        earlyEventsRef.current = []
        for (const ev of buffered) {
          if (ev.job_id === newJobId) {
            applyEvent(ev)
          }
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
    if (confirmingRef.current || isConfirming || jobId === undefined || !verifyOk) return
    confirmingRef.current = true
    setIsConfirming(true)
    setConfirmChoice(keepSource)
    setError(undefined)

    try {
      const result = await window.api.invoke('migrate:confirm', jobId, keepSource)
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
    if (jobId === undefined || !isRunning) return
    setError(undefined)
    try {
      const result = await window.api.invoke('migrate:abort', jobId)
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

        <Space wrap className="migrate-toolbar">
          <select
            className="migrate-native-select migrate-source-select"
            aria-label="Chọn app nguồn"
            value={appId ?? ''}
            disabled={isRunning || isStarting}
            onChange={(event) => {
              setAppId(Number(event.currentTarget.value))
              setTargetVpsId(undefined)
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
            value={targetVpsId ?? ''}
            disabled={!source || isRunning || isStarting}
            onChange={(event) => setTargetVpsId(Number(event.currentTarget.value))}
          >
            <option value="" disabled>
              Chọn VPS đích
            </option>
            {targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.host}
              </option>
            ))}
          </select>

          <Button
            type="primary"
            onClick={() => void start()}
            disabled={isRunning || isStarting || !source || targetVpsId === undefined}
            loading={isStarting}
          >
            Bắt đầu migrate
          </Button>

          <Button danger onClick={() => void abort()} disabled={jobId === undefined || !isRunning}>
            Huỷ & rollback
          </Button>
        </Space>

        {jobId !== undefined && (
          <Card size="small" className="migrate-job-banner">
            <Space wrap size="middle">
              <span>
                <strong>Job ID:</strong> #{jobId}
              </span>
              <span>
                <strong>Ứng dụng:</strong> {source?.name ?? (appId ? `App #${appId}` : '—')}
              </span>
              <span>
                <strong>VPS nguồn:</strong>{' '}
                {sourceVps?.name ?? (source?.vps_id ? `VPS #${source.vps_id}` : '—')}
                {sourceVps?.host ? ` (${sourceVps.host})` : ''}
              </span>
              <span>
                <strong>VPS đích:</strong>{' '}
                {targetVps?.name ?? (targetVpsId ? `VPS #${targetVpsId}` : '—')}
                {targetVps?.host ? ` (${targetVps.host})` : ''}
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

      {confirmModalOpen && (
        <Modal
          open={confirmModalOpen}
          onCancel={() => !isConfirming && setConfirmModalOpen(false)}
          title="Xác nhận hoàn tất di chuyển ứng dụng"
          footer={null}
          destroyOnHidden
        >
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Ứng dụng">
                <strong>{source?.name ?? (appId ? `App #${appId}` : '—')}</strong>
              </Descriptions.Item>
              <Descriptions.Item label="VPS nguồn">
                {sourceVps?.name ?? (source?.vps_id ? `VPS #${source.vps_id}` : '—')}
                {sourceVps?.host ? ` (${sourceVps.host})` : ''}
              </Descriptions.Item>
              <Descriptions.Item label="VPS đích">
                {targetVps?.name ?? (targetVpsId ? `VPS #${targetVpsId}` : '—')}
                {targetVps?.host ? ` (${targetVps.host})` : ''}
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
                disabled={isConfirming || !verifyOk}
                loading={isConfirming && confirmChoice === true}
              >
                Giữ app nguồn
              </Button>
              <Button
                danger
                onClick={() => void handleConfirm(false)}
                disabled={isConfirming || !verifyOk}
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
