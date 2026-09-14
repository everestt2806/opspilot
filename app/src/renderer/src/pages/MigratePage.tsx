import { useEffect, useMemo, useRef, useState } from 'react'
import { DeploymentUnitOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Space, Steps, Table, Tag, Typography } from 'antd'

import type { App, MigrateEvent, MigrateJobView, Vps } from '@shared/ipc'

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
  const [verifyOk, setVerifyOk] = useState(false)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)
  const activeJobId = useRef<number | undefined>(undefined)

  const handleEvent = (event: MigrateEvent): void => {
    if (activeJobId.current !== undefined && event.job_id !== activeJobId.current) return
    activeJobId.current = event.job_id
    setJobId(event.job_id)
    if ('step' in event) setStep(Math.max(0, steps.indexOf(event.step)))
    if (event.type === 'step-start') setStatus(event.step)
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
        void window.api.invoke('app:list').then((result) => {
          if (result.ok) setApps(result.data)
        })
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
      <div className="page-heading">
        <Typography.Title level={2} style={{ color: 'var(--text-primary)', margin: 0 }}>
          <DeploymentUnitOutlined style={{ marginRight: 10, color: 'var(--info)' }} />
          Migrate giữa hai VPS
        </Typography.Title>
        <Typography.Text type="secondary">
          PREPARE → FREEZE → BACKUP → TRANSFER → RESTORE → VERIFY
        </Typography.Text>
      </div>

      <Card style={{ marginTop: 20 }}>
        <Space wrap>
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
      </Card>

      {error && <Alert type="error" showIcon message={error} style={{ marginTop: 20 }} />}
      <Card style={{ marginTop: 20 }}>
        <Steps current={step} items={steps.map((title) => ({ title }))} />
        <Typography.Paragraph style={{ marginTop: 20 }}>
          Trạng thái: <Tag color={status === 'completed' ? 'success' : 'processing'}>{status}</Tag>
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
          <Space style={{ marginTop: 20 }}>
            <Button type="primary" onClick={() => void confirm(true)} disabled={!verifyOk}>
              Xác nhận, giữ nguồn
            </Button>
            <Button danger onClick={() => void confirm(false)} disabled={!verifyOk}>
              Xác nhận, dọn nguồn
            </Button>
          </Space>
        )}
      </Card>
    </section>
  )
}
