import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Modal,
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

import type { IpcResult, Vps, VpsScanItem, VpsScanResult } from '@shared/ipc'

import { strings } from '../strings'
import { localDateTime, relativeTime } from '../utils/format'
import { VpsOverviewActionBar } from './VpsOverviewActionBar'
import { VpsServerHeader } from './VpsServerHeader'

interface VpsOverviewTabProps {
  vps: Vps
  onRefreshResources: () => void
  onCheckConnection: () => void
  onEdit: () => void
  onDelete: () => void
  onDockerInstalled: () => void
}

type ScanPhase = 'scanning' | 'done' | 'error'

const SCAN_ITEM_LABELS: Record<VpsScanItem['key'], string> = {
  ssh: strings.vpsControl.scan.itemSsh,
  docker: strings.vpsControl.scan.itemDocker,
  compose: strings.vpsControl.scan.itemCompose,
  node: strings.vpsControl.scan.itemNode,
  git: strings.vpsControl.scan.itemGit,
  workdir: strings.vpsControl.scan.itemWorkdir
}

async function invokeScan(vpsId: number): Promise<IpcResult<VpsScanResult>> {
  try {
    return await window.api.invoke('vps:scan', vpsId)
  } catch {
    // Kênh chưa nối (bản cũ của main) — báo lỗi trung thực thay vì unhandled rejection
    return {
      ok: false,
      error: { code: 'UNKNOWN', message: strings.vpsControl.scan.failed }
    }
  }
}

/** Tab Tổng quan: action bar icon + bảng Machine info + card quét môi trường VPS. */
export function VpsOverviewTab({
  vps,
  onRefreshResources,
  onCheckConnection,
  onEdit,
  onDelete,
  onDockerInstalled
}: VpsOverviewTabProps): React.JSX.Element {
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

  function applyScan(result: IpcResult<VpsScanResult>): void {
    setScanPhase(result.ok ? 'done' : 'error')
    setScanResult(result.ok ? result.data : null)
    if (result.ok) {
      setScanError(null)
      onDockerInstalledRef.current()
      return
    }
    const message = result.error.message
    // Trùng với tiêu đề Alert thì không lặp lại ở phần mô tả
    setScanError(
      message !== strings.vpsControl.scan.failed
        ? `${message}${result.error.technical ? ` — ${result.error.technical}` : ''}`
        : null
    )
  }

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
  }, [vps.id])

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
                <span className="mono-text">{relativeTime(vps.last_seen_at)}</span>
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
                <span className="scan-item-label">{SCAN_ITEM_LABELS[item.key]}</span>
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
