import { useRef, useState } from 'react'
import {
  CheckCircleOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  GithubOutlined,
  RocketOutlined,
  SafetyOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { Alert, Button, Form, Input, Modal, Space, Steps, Table, Typography } from 'antd'

import type { ProjectItem } from '../mockData'
import { strings } from '../strings'
import { fonts } from '../tokens'

interface DeployWizardModalProps {
  open: boolean
  project?: ProjectItem | null
  onCancel: () => void
  onStartDeploy: (project: ProjectItem) => void
}

export function DeployWizardModal({
  open,
  project,
  onCancel,
  onStartDeploy
}: DeployWizardModalProps): React.JSX.Element {
  const [currentStep, setCurrentStep] = useState(0)

  // Source selection fields state
  const [gitUrl, setGitUrl] = useState(`https://github.com/opspilot/${project?.name ?? 'app'}.git`)
  const [localPath, setLocalPath] = useState(`/Users/dev/projects/${project?.name ?? 'app'}`)

  // File input ref to trigger OS file/folder picker
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFolderIconClick = (): void => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files
    if (files && files.length > 0) {
      // Get the relative or folder path from the selected file/folder
      const firstFile = files[0]
      const path = (firstFile as { path?: string }).path || firstFile.name
      setLocalPath(path)
    }
  }

  const handleNext = (): void => {
    if (currentStep < 3) {
      setCurrentStep((prev) => prev + 1)
    } else if (project) {
      onStartDeploy(project)
    }
  }

  const handlePrev = (): void => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }

  return (
    <Modal
      open={open}
      title={
        <Space>
          <RocketOutlined style={{ color: 'var(--info)', fontSize: 20 }} />
          <Typography.Title level={4} style={{ color: 'var(--text-primary)', margin: 0 }}>
            {strings.wizard.title} — [{project?.name ?? 'New'}]
          </Typography.Title>
        </Space>
      }
      onCancel={onCancel}
      width={760}
      style={{ top: 40 }}
      bodyStyle={{ padding: 24 }}
      footer={[
        currentStep > 0 && (
          <Button key="back" onClick={handlePrev} size="large">
            {strings.common.back}
          </Button>
        ),
        <Button key="cancel" onClick={onCancel} size="large">
          {strings.common.cancel}
        </Button>,
        <Button key="next" type="primary" onClick={handleNext} size="large">
          {currentStep === 3 ? strings.wizard.startDeploy : 'Next →'}
        </Button>
      ]}
    >
      {/* Hidden File Input for Folder Selection */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />

      {/* Sleek Dark Steps Header Bar */}
      <div style={styles.stepsContainer}>
        <Steps
          current={currentStep}
          size="small"
          items={[
            { title: strings.wizard.step1, icon: <FolderOpenOutlined /> },
            { title: strings.wizard.step2, icon: <CodeOutlined /> },
            { title: strings.wizard.step3, icon: <SettingOutlined /> },
            { title: strings.wizard.step4, icon: <SafetyOutlined /> }
          ]}
        />
      </div>

      <div style={{ minHeight: 260, padding: '16px 0' }}>
        {/* Step 1: Nguồn mã nguồn Project (Split into 2 fields with Folder picker icon) */}
        {currentStep === 0 && (
          <div>
            <Typography.Title level={5} style={{ color: 'var(--text-primary)', marginBottom: 16 }}>
              Choose the project source
            </Typography.Title>
            <Form layout="vertical">
              {/* Field 1: GitHub Repository URL */}
              <Form.Item
                label={
                  <Space>
                    <GithubOutlined style={{ color: 'var(--info)' }} />
                    <span style={{ color: 'var(--text-primary)' }}>
                      Field 1: GitHub Repository URL
                    </span>
                  </Space>
                }
              >
                <Input
                  prefix={<GithubOutlined style={{ color: 'var(--text-muted)' }} />}
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/username/repository.git"
                  size="large"
                  style={{ fontFamily: fonts.mono }}
                />
              </Form.Item>

              {/* Field 2: Thư mục / File trên máy Local với Icon Mở thư mục bên phải */}
              <Form.Item
                label={
                  <Space>
                    <FolderOpenOutlined style={{ color: 'var(--success)' }} />
                    <span style={{ color: 'var(--text-primary)' }}>
                      Field 2: Pick a local folder / file
                    </span>
                  </Space>
                }
              >
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    prefix={<FolderOpenOutlined style={{ color: 'var(--text-muted)' }} />}
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                    placeholder="No folder selected..."
                    size="large"
                    style={{ fontFamily: fonts.mono }}
                  />
                  <Button
                    type="primary"
                    size="large"
                    icon={<FolderOpenOutlined />}
                    onClick={handleFolderIconClick}
                    title="Open folder on this computer"
                  >
                    Open folder
                  </Button>
                </Space.Compact>
              </Form.Item>
            </Form>
          </div>
        )}

        {/* Step 2: Nhận diện Detector */}
        {currentStep === 1 && (
          <div>
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleOutlined />}
              message={strings.wizard.detectSuccess}
              description={`Framework: ${project?.framework ?? 'Node.js/Express'} | Dockerfile Template: Node18-Alpine-Standard`}
              style={{ marginBottom: 20 }}
            />
          </div>
        )}

        {/* Step 3: Cấu hình Environment */}
        {currentStep === 2 && (
          <div>
            <Typography.Title level={5} style={{ color: 'var(--text-primary)' }}>
              Configure environment variables (.env)
            </Typography.Title>
            <Form layout="vertical">
              <Form.Item label="PORT">
                <Input value="3000" size="large" style={{ fontFamily: fonts.mono }} />
              </Form.Item>
              <Form.Item label="NODE_ENV">
                <Input value="production" size="large" style={{ fontFamily: fonts.mono }} />
              </Form.Item>
            </Form>
          </div>
        )}

        {/* Step 4: Precheck & Deploy */}
        {currentStep === 3 && (
          <div>
            <Alert
              type="info"
              showIcon
              message={strings.wizard.precheckOk}
              style={{ marginBottom: 20 }}
            />
            <Table
              pagination={false}
              size="small"
              columns={[
                { title: 'Resource', dataIndex: 'item' },
                { title: 'Minimum required', dataIndex: 'required' },
                { title: 'Actual on VPS', dataIndex: 'actual' },
                {
                  title: 'Result',
                  dataIndex: 'pass',
                  render: () => <Typography.Text type="success">✓ Pass</Typography.Text>
                }
              ]}
              dataSource={[
                {
                  key: '1',
                  item: 'Available RAM',
                  required: '512 MB',
                  actual: '2.8 GB',
                  pass: true
                },
                { key: '2', item: 'Free disk', required: '2.0 GB', actual: '34 GB', pass: true },
                { key: '3', item: 'Port 3000', required: 'Free', actual: 'Free', pass: true }
              ]}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

const styles: Record<string, React.CSSProperties> = {
  stepsContainer: {
    backgroundColor: 'var(--bg-elevated-translucent)',
    padding: '16px 20px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    marginBottom: 20
  }
}
