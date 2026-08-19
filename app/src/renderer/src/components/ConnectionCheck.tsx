import { useState } from 'react'
import { Alert, Button, Modal, Space, Spin, Typography } from 'antd'
import { ApiOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons'

import type { VpsConnectionCheck, VpsInput } from '@shared/ipc'

import { strings } from '../strings'
import { DiagnosisPanel } from './DiagnosisPanel'

/** Lỗi check do renderer tự phát hiện (form chưa đủ, credential chưa nhập) hoặc do
 *  main trả `IpcError` — kèm message thô để hiện trong "Chi tiết kỹ thuật". */
export class CheckFailedError extends Error {
  readonly technical?: string

  constructor(message: string, technical?: string) {
    super(message)
    this.name = 'CheckFailedError'
    this.technical = technical
  }
}

type CheckPhase =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'done'; result: VpsConnectionCheck }
  | { phase: 'failed'; message: string; technical: string | undefined }

interface ConnectionCheckProps {
  getValues: () => VpsInput
  runCheck: (values: VpsInput) => Promise<VpsConnectionCheck>
  /** ID VPS đã lưu trong DB — cần cho "Cài Docker ngay" (install-docker dùng credential đã
   *  mã hoá). Không có (modal đang thêm VPS mới) thì chỉ hướng dẫn lưu VPS trước. */
  vpsId?: number
}

/** Khối "Kiểm tra kết nối" trong modal VPS — 4 state: idle / checking / done / failed.
 *  Logic gọi IPC nằm ở parent (`runCheck`), component này thuần hiển thị để test được
 *  từng state bằng fixture. */
export function ConnectionCheck({
  getValues,
  runCheck,
  vpsId
}: ConnectionCheckProps): React.JSX.Element {
  const [state, setState] = useState<CheckPhase>({ phase: 'idle' })

  async function check(): Promise<void> {
    setState({ phase: 'checking' })
    try {
      const result = await runCheck(getValues())
      setState({ phase: 'done', result })
    } catch (error) {
      if (error instanceof CheckFailedError) {
        setState({ phase: 'failed', message: error.message, technical: error.technical })
        return
      }
      setState({ phase: 'failed', message: strings.vps.check.failUnknown, technical: undefined })
    }
  }

  function retry(): void {
    void check()
  }

  if (state.phase === 'checking') {
    return (
      <Space size="small">
        <Spin size="small" />
        <Typography.Text type="secondary">{strings.vps.check.checking}</Typography.Text>
      </Space>
    )
  }

  if (state.phase === 'done') {
    return (
      <Space direction="vertical" size="small" className="diagnosis-body">
        <CheckResult result={state.result} onRetry={retry} vpsId={vpsId} />
      </Space>
    )
  }

  if (state.phase === 'failed') {
    return (
      <Alert
        type="error"
        showIcon
        message={state.message}
        description={
          state.technical ? (
            <Typography.Text type="secondary" className="mono-text">
              {strings.vps.check.technicalLabel}: {state.technical}
            </Typography.Text>
          ) : undefined
        }
        action={
          <Button size="small" onClick={retry}>
            {strings.vps.check.retry}
          </Button>
        }
      />
    )
  }

  return (
    <Space direction="vertical" size="small">
      <Button icon={<ApiOutlined />} onClick={() => void check()}>
        {strings.vps.check.button}
      </Button>
      <Typography.Text type="secondary">{strings.vps.check.idleHint}</Typography.Text>
    </Space>
  )
}

function CheckResult({
  result,
  onRetry,
  vpsId
}: {
  result: VpsConnectionCheck
  onRetry: () => void
  vpsId?: number
}): React.JSX.Element {
  if (result.ssh_ok) {
    return (
      <Alert
        type="success"
        showIcon
        message={strings.vps.check.success}
        description={
          <Space direction="vertical" size="small" className="diagnosis-body">
            <Typography.Text type="secondary">{strings.vps.check.successHint}</Typography.Text>
            <CheckSteps steps={result.steps} />
            {!result.docker_installed && <DockerMissing vpsId={vpsId} />}
            {result.docker_installed && !result.workdir_writable && (
              <Alert type="warning" showIcon message={strings.vps.check.workdirFail} />
            )}
          </Space>
        }
        action={
          <Button size="small" onClick={onRetry}>
            {strings.vps.check.retry}
          </Button>
        }
      />
    )
  }

  return (
    <Space direction="vertical" size="small" className="diagnosis-body">
      <CheckSteps steps={result.steps} />
      {result.diagnosis ? (
        <DiagnosisPanel diagnosis={result.diagnosis} onRetry={onRetry} />
      ) : (
        <Alert
          type="error"
          showIcon
          message={strings.vps.check.failUnknown}
          action={
            <Button size="small" onClick={onRetry}>
              {strings.vps.check.retry}
            </Button>
          }
        />
      )}
    </Space>
  )
}

function DockerMissing({ vpsId }: { vpsId?: number }): React.JSX.Element {
  const [modal, contextHolder] = Modal.useModal()
  const [installing, setInstalling] = useState(false)
  const [installedVersion, setInstalledVersion] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

  function installDocker(): void {
    if (!vpsId) return
    modal.confirm({
      title: strings.vps.install.confirmTitle,
      content: strings.vps.install.confirmBody,
      okText: strings.vps.install.confirm,
      cancelText: strings.common.cancel,
      async onOk() {
        setInstalling(true)
        const result = await window.api.invoke('vps:install-docker', vpsId)
        setInstalling(false)
        if (!result.ok) {
          setInstallError(
            `${result.error.message}${result.error.technical ? ` — ${result.error.technical}` : ''}`
          )
          return
        }
        setInstalledVersion(result.data.docker_version)
      }
    })
  }

  return (
    <>
      {contextHolder}
      <Alert
        type="warning"
        showIcon
        message={strings.vps.check.dockerMissing}
        description={
          <Space direction="vertical" size="small">
            <Typography.Text type="secondary">
              {strings.vps.check.dockerMissingHint}
            </Typography.Text>
            {!vpsId && (
              <Typography.Text type="secondary">
                {strings.vps.install.needSaveFirst}
              </Typography.Text>
            )}
            {installing && (
              <Space size="small">
                <Spin size="small" />
                <Typography.Text type="secondary">{strings.vps.install.installing}</Typography.Text>
              </Space>
            )}
            {installedVersion && (
              <Alert type="success" showIcon message={strings.vps.install.done(installedVersion)} />
            )}
            {installError && (
              <Alert
                type="error"
                showIcon
                message={strings.vps.install.failed}
                description={
                  <Typography.Text type="secondary" className="mono-text">
                    {installError}
                  </Typography.Text>
                }
              />
            )}
          </Space>
        }
        action={
          vpsId ? (
            <Button size="small" type="primary" loading={installing} onClick={installDocker}>
              {strings.vps.install.button}
            </Button>
          ) : undefined
        }
      />
    </>
  )
}

function CheckSteps({ steps }: { steps: VpsConnectionCheck['steps'] }): React.JSX.Element {
  return (
    <Space direction="vertical" size={4} className="check-steps">
      {steps.map((step) => (
        <div key={step.label} className="check-step">
          {step.ok ? (
            <CheckCircleFilled className="step-icon-ok" />
          ) : (
            <CloseCircleFilled className="step-icon-fail" />
          )}
          <Typography.Text className="mono-text">{step.label}</Typography.Text>
          {step.detail && (
            <Typography.Text type="secondary" className="mono-text">
              — {step.detail}
            </Typography.Text>
          )}
        </div>
      ))}
    </Space>
  )
}
