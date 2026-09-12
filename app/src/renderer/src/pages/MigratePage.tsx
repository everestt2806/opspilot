import { useEffect, useMemo, useState } from 'react'
import { DeploymentUnitOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Select, Space, Steps, Table, Tag, Typography } from 'antd'

import type { App, MigrateEvent, Vps } from '@shared/ipc'

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

  const handleEvent = (event: MigrateEvent): void => {
    setJobId(event.job_id)
    if ('step' in event) setStep(Math.max(0, steps.indexOf(event.step)))
    if (event.type === 'step-start') setStatus(event.step)
    if (event.type === 'step-done') setStatus(`${event.step} hoàn tất`)
    if (event.type === 'verify-result') setRows(event.rows)
    if (event.type === 'awaiting-confirm') {
      setStatus('Đang chờ xác nhận')
      setDowntime(event.downtime_ms)
    }
    if (event.type === 'finished') {
      setStatus(event.status)
      setDowntime(event.downtime_ms)
    }
  }

  useEffect(() => {
    void Promise.all([window.api.invoke('app:list'), window.api.invoke('vps:list')]).then(
      ([appResult, vpsResult]) => {
        if (appResult.ok) setApps(appResult.data)
        if (vpsResult.ok) setVps(vpsResult.data)
      }
    )
    return window.api.on('migrate:event', handleEvent)
  }, [])

  const source = apps.find((item) => item.id === appId)
  const targets = useMemo(() => vps.filter((item) => item.id !== source?.vps_id), [source, vps])
  const running = jobId !== undefined && !['completed', 'rolled_back'].includes(status)

  const start = async (): Promise<void> => {
    if (appId === undefined || targetVpsId === undefined) return
    setError(undefined)
    const result = await window.api.invoke('migrate:start', {
      app_id: appId,
      target_vps_id: targetVpsId
    })
    if (!result.ok) setError(result.error.message)
    else setJobId(result.data.job_id)
  }

  const confirm = async (keepSource: boolean): Promise<void> => {
    if (jobId === undefined) return
    const result = await window.api.invoke('migrate:confirm', jobId, keepSource)
    if (!result.ok) setError(result.error.message)
    else setStatus('completed')
  }

  const abort = async (): Promise<void> => {
    if (jobId === undefined) return
    const result = await window.api.invoke('migrate:abort', jobId)
    if (!result.ok) setError(result.error.message)
    else setStatus('rolled_back')
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
          <Select
            placeholder="Chọn app nguồn"
            style={{ minWidth: 280 }}
            value={appId}
            onChange={setAppId}
            options={apps.map((item) => ({
              label: `${item.name} · VPS ${item.vps_id}`,
              value: item.id
            }))}
          />
          <Select
            placeholder="Chọn VPS đích"
            style={{ minWidth: 240 }}
            value={targetVpsId}
            onChange={setTargetVpsId}
            options={targets.map((item) => ({
              label: `${item.name} · ${item.host}`,
              value: item.id
            }))}
          />
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
        {status === 'Đang chờ xác nhận' && (
          <Space style={{ marginTop: 20 }}>
            <Button type="primary" onClick={() => void confirm(true)}>
              Xác nhận, giữ nguồn
            </Button>
            <Button danger onClick={() => void confirm(false)}>
              Xác nhận, dọn nguồn
            </Button>
          </Space>
        )}
      </Card>
    </section>
  )
}
