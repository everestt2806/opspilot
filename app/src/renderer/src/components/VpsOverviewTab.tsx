import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Modal,
  Progress,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ReloadOutlined,
  WarningOutlined
} from '@ant-design/icons'

import type { IpcResult, Vps, VpsResources, VpsScanItem, VpsScanResult } from '@shared/ipc'

import { useUiState } from '../store/uiState'
import { useStrings } from '../strings'
import { localDateTime, relativeTime } from '../utils/format'
import { formatGb, formatMb, resourcePercents, type RowResourceState } from '../vpsResources'
import { VpsOverviewActionBar } from './VpsOverviewActionBar'
import { VpsServerHeader } from './VpsServerHeader'

interface VpsOverviewTabProps {
  vps: Vps
  resources: RowResourceState | undefined
  onRefreshResources: () => void
  onCheckConnection: () => void
  onEdit: () => void
  onDelete: () => void
  onDockerInstalled: () => void
}

type ScanPhase = 'scanning' | 'done' | 'error'

async function invokeScan(vpsId: number): Promise<IpcResult<VpsScanResult>> {
  try {
    return await window.api.invoke('vps:scan', vpsId)
  } catch (err) {
    // Kênh chưa nối (bản cũ của main) — báo lỗi trung thực thay vì unhandled rejection
    return {
      ok: false,
      error: { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) }
    }
  }
}

/** Tab Tổng quan: action bar icon + bảng Machine info + card quét môi trường VPS. */
export function VpsOverviewTab({
  vps,
  resources,
  onRefreshResources,
  onCheckConnection,
  onEdit,
  onDelete,
  onDockerInstalled
}: VpsOverviewTabProps): React.JSX.Element {
  const strings = useStrings()
  const locale = useUiState((state) => state.locale)
  const scanItemLabels: Record<VpsScanItem['key'], string> = {
    ssh: strings.vpsControl.scan.itemSsh,
    docker: strings.vpsControl.scan.itemDocker,
    compose: strings.vpsControl.scan.itemCompose,
    node: strings.vpsControl.scan.itemNode,
    git: strings.vpsControl.scan.itemGit,
    workdir: strings.vpsControl.scan.itemWorkdir
  }
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [modal, contextHolder] = Modal.useModal()

  const [scanPhase, setScanPhase] = useState<ScanPhase>('scanning')
  const [scanResult, setScanResult] = useState<VpsScanResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  const onDockerInstalledRef = useRef(onDockerInstalled)
  useEffect(() => {
    onDockerInstalledRef.current = onDockerInstalled
  }, [onDockerInstalled])

  const applyScan = useCallback(
    (result: IpcResult<VpsScanResult>): void => {
      setScanPhase(result.ok ? 'done' : 'error')
      setScanResult(result.ok ? result.data : null)
      if (result.ok) {
        setScanError(null)
        onDockerInstalledRef.current?.()
        return
      }
      const message = result.error.message
      // Trùng với tiêu đề Alert thì không lặp lại ở phần mô tả
      setScanError(
        message !== strings.vpsControl.scan.failed
          ? `${message}${result.error.technical ? ` — ${result.error.technical}` : ''}`
          : null
      )
    },
    [strings]
  )

  // Tự quét khi mở tab / đổi VPS. onDockerInstalled gọi qua ref để không phụ thuộc
  // callback tạo mới mỗi render (nếu nằm trong deps sẽ quét lặp vô hạn).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await invokeScan(vps.id)
      if (cancelled) {
        return
      }
      applyScan(result)
    })()
    return () => {
      cancelled = true
    }
  }, [vps.id, applyScan])

  function runScan(): void {
    setScanPhase('scanning')
    void (async () => {
      applyScan(await invokeScan(vps.id))
    })()
  }

  function installDocker(): void {
    modal.confirm({
      title: strings.vps.install.confirmTitle,
      content: strings.vps.install.confirmBody,
      okText: strings.vps.install.confirm,
      cancelText: strings.common.cancel,
      async onOk() {
        setInstalling(true)
        const result = await window.api.invoke('vps:install-docker', vps.id)
        setInstalling(false)
        if (!result.ok) {
          setInstallError(
            `${result.error.message}${result.error.technical ? ` — ${result.error.technical}` : ''}`
          )
          return
        }
        setInstallError(null)
        onDockerInstalled()
      }
    })
  }

  return (
    <div>
      {contextHolder}

      {/* Thanh action icon — đầu container nội dung Tổng quan, trên các card thông tin */}
      <VpsOverviewActionBar
        vpsName={vps.name}
        showInstallDocker={!vps.docker_version}
        installingDocker={installing}
        onRefreshResources={onRefreshResources}
        onCheckConnection={onCheckConnection}
        onEdit={onEdit}
        onInstallDocker={installDocker}
        onDelete={onDelete}
      />

      {/* Thông tin nhanh (IP/port/lệnh SSH) — chỉ thuộc tab Tổng quan, nằm trên Machine info */}
      <VpsServerHeader vps={vps} />

      {/* Tài nguyên hệ thống (CPU / RAM / Disk) — từ IPC vps:get-resources */}
      <Card
        title={strings.vpsControl.overview.resourcesTitle}
        size="small"
        style={{ marginTop: 12 }}
        extra={
          <Space size="middle">
            {resources?.status === 'success' && resources.fetchedAt ? (
              <Tooltip title={localDateTime(new Date(resources.fetchedAt).toISOString())}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {strings.vpsControl.overview.checkedAt(
                    relativeTime(new Date(resources.fetchedAt).toISOString(), undefined, locale)
                  )}
                </Typography.Text>
              </Tooltip>
            ) : vps.last_seen_at ? (
              <Tooltip title={localDateTime(vps.last_seen_at)}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {strings.vpsControl.overview.checkedAt(
                    relativeTime(vps.last_seen_at, undefined, locale)
                  )}
                </Typography.Text>
              </Tooltip>
            ) : null}
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={resources?.status === 'loading'}
              onClick={onRefreshResources}
            >
              {strings.common.refresh}
            </Button>
          </Space>
        }
      >
        {resources?.status === 'loading' && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Spin size="small" />
            <Typography.Text
              type="secondary"
              style={{ display: 'block', marginTop: 8, fontSize: 12 }}
            >
              {strings.vpsControl.sidebar.checking}
            </Typography.Text>
          </div>
        )}

        {resources?.status === 'error' && (
          <Alert
            type="error"
            showIcon
            message={strings.vpsControl.sidebar.resourceError}
            description={resources.message}
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={onRefreshResources}>
                {strings.common.retry}
              </Button>
            }
          />
        )}

        {resources?.status === 'success' && (
          <div className="vps-overview-resources-content">
            <ResourceGauges data={resources.data} />
            <Descriptions
              column={{ xs: 1, sm: 2, md: 4 }}
              size="small"
              bordered
              style={{ marginTop: 12 }}
            >
              <Descriptions.Item label={strings.vpsControl.sidebar.cores}>
                <span className="mono-text">{resources.data.cpu_count}</span>
              </Descriptions.Item>
              <Descriptions.Item label={strings.vpsControl.sidebar.loadAvg}>
                <span className="mono-text">{resources.data.load_avg_1m.toFixed(2)}</span>
              </Descriptions.Item>
              <Descriptions.Item label={strings.vpsControl.sidebar.ramTotal}>
                <span className="mono-text">
                  {formatMb(resources.data.ram_total_mb - resources.data.ram_free_mb)} /{' '}
                  {formatMb(resources.data.ram_total_mb)}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label={strings.vpsControl.sidebar.disk}>
                <span className="mono-text">
                  {formatGb(resources.data.disk_total_gb - resources.data.disk_free_gb)} /{' '}
                  {formatGb(resources.data.disk_total_gb)}
                </span>
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}

        {resources === undefined && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0'
            }}
          >
            <Typography.Text type="secondary">
              {strings.vpsControl.overview.resourcesEmpty}
            </Typography.Text>
            <Button size="small" icon={<ReloadOutlined />} onClick={onRefreshResources}>
              {strings.vpsControl.overview.resourcesRefresh}
            </Button>
          </div>
        )}
      </Card>

      <Card
        title={strings.vpsControl.overview.machineTitle}
        size="small"
        style={{ marginTop: 12 }}
        styles={{ body: { paddingTop: 12 } }}
      >
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label={strings.vpsControl.overview.host}>
            <Typography.Text code>{`${vps.host}:${vps.port}`}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={strings.vpsControl.overview.sshPort}>
            {vps.port}
          </Descriptions.Item>
          <Descriptions.Item label={strings.vpsControl.overview.username}>
            {vps.username}
          </Descriptions.Item>
          <Descriptions.Item label={strings.vpsControl.overview.providerRegion}>
            {[vps.provider, vps.region].filter(Boolean).join(' · ') || strings.common.notAvailable}
          </Descriptions.Item>
          <Descriptions.Item label={strings.vpsControl.overview.docker}>
            {vps.docker_version ? (
              <Typography.Text code>{vps.docker_version}</Typography.Text>
            ) : (
              <Tag color="warning">{strings.vpsControl.overview.dockerMissing}</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label={strings.vpsControl.overview.lastSeen}>
            {vps.last_seen_at ? (
              <Tooltip title={localDateTime(vps.last_seen_at)}>
                <span className="mono-text">
                  {relativeTime(vps.last_seen_at, undefined, locale)}
                </span>
              </Tooltip>
            ) : (
              <Typography.Text type="secondary">
                {strings.vpsControl.overview.neverSeen}
              </Typography.Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label={strings.vpsControl.overview.createdAt}>
            <Typography.Text type="secondary" className="mono-text">
              {localDateTime(vps.created_at)}
            </Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title={strings.vpsControl.scan.title}
        size="small"
        style={{ marginTop: 12 }}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            disabled={scanPhase === 'scanning'}
            onClick={() => runScan()}
          >
            {strings.vpsControl.scan.scanAgain}
          </Button>
        }
      >
        {scanPhase === 'scanning' && (
          <Space style={{ padding: '8px 0' }}>
            <Spin size="small" />
            <Typography.Text type="secondary">{strings.vpsControl.scan.scanning}</Typography.Text>
          </Space>
        )}
        {scanPhase === 'error' && (
          <Alert
            type="error"
            showIcon
            message={strings.vpsControl.scan.failed}
            description={scanError || undefined}
            action={
              <Button size="small" onClick={() => runScan()}>
                {strings.common.retry}
              </Button>
            }
          />
        )}
        {scanPhase === 'done' && scanResult && (
          <div className="scan-list">
            {scanResult.items.map((item) => (
              <div key={item.key} className="scan-item">
                {item.ok ? (
                  <CheckCircleFilled className="step-icon-ok" />
                ) : (
                  <CloseCircleFilled className="step-icon-fail" />
                )}
                <span className="scan-item-label">{scanItemLabels[item.key]}</span>
                {item.version && (
                  <Typography.Text code className="mono-text">
                    {item.version}
                  </Typography.Text>
                )}
                {!item.ok && (
                  <Typography.Text type="secondary" className="scan-item-missing">
                    {strings.vpsControl.scan.missing}
                  </Typography.Text>
                )}
                {!item.ok && item.detail && (
                  <Tooltip title={item.detail}>
                    <WarningOutlined className="scan-item-warn" />
                  </Tooltip>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {installError && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          message={strings.vps.install.failed}
          description={installError}
        />
      )}
    </div>
  )
}

function ResourceGauges({ data }: { data: VpsResources }): React.JSX.Element {
  const strings = useStrings()
  const { ram, cpu, disk } = resourcePercents(data)
  const gauges = [
    { label: strings.vpsControl.sidebar.cpu, percent: cpu },
    { label: strings.vpsControl.sidebar.ram, percent: ram },
    { label: strings.vpsControl.sidebar.disk, percent: disk }
  ]

  return (
    <div
      className="panel-gauge-row"
      style={{ justifyContent: 'space-around', margin: '8px 0 12px' }}
    >
      {gauges.map((gauge) => (
        <div key={gauge.label} className="panel-gauge">
          <Progress
            type="circle"
            percent={gauge.percent}
            size={76}
            strokeColor={gauge.percent > 90 ? 'var(--danger)' : 'var(--info)'}
            format={(value) => `${value}%`}
          />
          <span className="panel-gauge-label">{gauge.label}</span>
        </div>
      ))}
    </div>
  )
}
