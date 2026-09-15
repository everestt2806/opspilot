import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Space, Steps, Table, Tag, Typography } from 'antd'

import type { App, MigrateEvent, MigrateJobView, Vps } from '@shared/ipc'
import { PageHeader } from '../components/PageHeader'
import { DeployTerminal } from './DeployTerminal'

const steps = ['PREPARE', 'FREEZE', 'BACKUP', 'TRANSFER', 'RESTORE', 'VERIFY', 'AWAITING_CONFIRM']

export function MigratePage(): React.JSX.Element {
  const [apps, setApps] = useState<App[]>([])
  const [vps, setVps] = useState<Vps[]>([])
  const [appId, setAppId] = useState<number>()
  const [targetVpsId, setTargetVpsId] = useState<number>()
  const [jobId, setJobId] = useState<number>()
  const [step, setStep] = useState(-1)
  const [status, setStatus] = useState('Chưa bắt đầu')
  const [downtime, setDowntime] = useState<number>()
  const [rows, setRows] = useState<
    Array<{ label: string; source: string; target: string; ok: boolean }>
  >([])
  const [error, setError] = useState<string>()
  const [logs, setLogs] = useState('')
  const [doneCount, setDoneCount] = useState(0)
  const [failReason, setFailReason] = useState<string>()
  const [verifyOk, setVerifyOk] = useState(false)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)
  const activeJobId = useRef<number | undefined>(undefined)

  const handleEvent = (event: MigrateEvent): void => {
    if (activeJobId.current !== undefined && event.job_id !== activeJobId.current) return
    activeJobId.current = event.job_id
    setJobId(event.job_id)
    if (event.type === 'log') {
      setLogs((prev) => prev + event.chunk)
      return
    }
    if ('step' in event) setStep(Math.max(0, steps.indexOf(event.step)))
    if (event.type === 'step-start') setStatus(event.step)
    if (event.type === 'step-done') setDoneCount((count) => count + 1)
    if (event.type === 'step-done') setStatus(`${event.step} hoàn tất`)
    if (event.type === 'verify-result') {
      setRows(event.rows)
      setVerifyOk(event.rows.every((row) => row.ok))
    }
    if (event.type === 'awaiting-confirm') {
      setStatus('Đang chờ xác nhận')
      setDowntime(event.downtime_ms)
      setAwaitingConfirm(true)
    }
    if (event.type === 'finished') {
      setStatus(event.status)
      setDowntime(event.downtime_ms)
      setAwaitingConfirm(false)
      if (event.status === 'completed') {
        setFailReason(undefined)
        void window.api.invoke('app:list').then((result) => {
          if (result.ok) setApps(result.data)
        })
      } else if (event.error) {
        setFailReason(event.error)
      }
    }
  }

  useEffect(() => {
    void Promise.all([
      window.api.invoke('app:list'),
      window.api.invoke('vps:list'),
      window.api.invoke('migrate:list')
    ]).then(([appResult, vpsResult, migrationResult]) => {
      if (appResult.ok) setApps(appResult.data)
      if (vpsResult.ok) setVps(vpsResult.data)
      if (migrationResult.ok) {
        const latest = migrationResult.data[0] as MigrateJobView | undefined
        if (latest) {
          activeJobId.current = latest.id
          setJobId(latest.id)
          setStatus(latest.status === 'awaiting_confirm' ? 'Đang chờ xác nhận' : latest.status)
          setDowntime(latest.downtime_ms ?? undefined)
          setAwaitingConfirm(latest.status === 'awaiting_confirm')
          if (latest.status === 'failed' || latest.status === 'rolled_back') {
            setFailReason(
              latest.error_message ??
                `Lỗi ở bước ${latest.failed_step ?? 'không xác định'} (không có chi tiết).`
            )
          }
          if (latest.verify_json) {
            try {
              const verify = JSON.parse(latest.verify_json) as {
                checksums?: unknown[]
                ok?: boolean
              }
              setVerifyOk(verify.ok === true)
            } catch {
              setVerifyOk(false)
            }
          }
        }
      }
    })
    return window.api.on('migrate:event', handleEvent)
  }, [])

  const source = apps.find((item) => item.id === appId)
  const targets = useMemo(() => vps.filter((item) => item.id !== source?.vps_id), [source, vps])
  const running = jobId !== undefined && !['completed', 'rolled_back'].includes(status)

  const start = async (): Promise<void> => {
    if (appId === undefined || targetVpsId === undefined) return
    setError(undefined)
    setAwaitingConfirm(false)
    setVerifyOk(false)
    setRows([])
    setLogs('')
    setDoneCount(0)
    setFailReason(undefined)
    const result = await window.api.invoke('migrate:start', {
      app_id: appId,
      target_vps_id: targetVpsId
    })
    if (!result.ok) setError(result.error.message)
    else {
      activeJobId.current = result.data.job_id
      setJobId(result.data.job_id)
    }
  }

  const confirm = async (keepSource: boolean): Promise<void> => {
    if (jobId === undefined) return
    const result = await window.api.invoke('migrate:confirm', jobId, keepSource)
    if (!result.ok) setError(result.error.message)
    // The finished event is authoritative; confirmation only acknowledges the request.
  }

  const abort = async (): Promise<void> => {
    if (jobId === undefined) return
    const result = await window.api.invoke('migrate:abort', jobId)
    if (!result.ok) setError(result.error.message)
    else {
      // The terminal event or a subsequent persisted reload owns the status.
    }
  }

  return (
    <section className="page-panel">
      <PageHeader
        title="Migrate giữa hai VPS"
        description="PREPARE → FREEZE → BACKUP → TRANSFER → RESTORE → VERIFY"
      />

      <div className="page-stack">
        <Space wrap className="migrate-toolbar">
          <select
            className="migrate-native-select migrate-source-select"
            aria-label="Chọn app nguồn"
            value={appId ?? ''}
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
            disabled={!source}
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
            disabled={running || !source || targetVpsId === undefined}
          >
            Bắt đầu migrate
          </Button>
          <Button danger onClick={() => void abort()} disabled={jobId === undefined || !running}>
            Huỷ & rollback
          </Button>
        </Space>

        {error && <Alert type="error" showIcon message={error} />}
        {failReason && (
          <Alert
            type="error"
            showIcon
            message={`Migrate thất bại và ${
              status === 'failed' ? 'nguồn chưa khôi phục được' : 'đã rollback về app nguồn'
            } — xem lý do và gợi ý xử lý trong log bên dưới.`}
            description={failReason}
          />
        )}
        <Card>
          <Steps size="small" current={step} items={steps.map((title) => ({ title }))} />
          <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
            Trạng thái:{' '}
            <Tag color={status === 'completed' ? 'success' : 'processing'}>{status}</Tag>
            {downtime !== undefined && ` Downtime: ${downtime} ms`}
          </Typography.Paragraph>
          {rows.length > 0 && (
            <Table
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
          {awaitingConfirm && status === 'Đang chờ xác nhận' && (
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" onClick={() => void confirm(true)} disabled={!verifyOk}>
                Xác nhận, giữ nguồn
              </Button>
              <Button danger onClick={() => void confirm(false)} disabled={!verifyOk}>
                Xác nhận, dọn nguồn
              </Button>
            </Space>
          )}
        </Card>
        <DeployTerminal
          buffer={logs}
          activeStep={running && step >= 0 ? steps[step] : undefined}
          completedSteps={doneCount}
          totalSteps={steps.length}
          status={
            running
              ? 'streaming'
              : status === 'completed'
                ? 'success'
                : doneCount > 0
                  ? 'failed'
                  : 'streaming'
          }
        />
      </div>
    </section>
  )
}
