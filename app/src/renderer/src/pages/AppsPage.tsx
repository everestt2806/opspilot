import { useState } from 'react'
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  RollbackOutlined
} from '@ant-design/icons'
import {
  App as AntApp,
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Input,
  Modal,
  Row,
  Space,
  Tabs,
  Tag,
  Timeline,
  Typography
} from 'antd'

import { mockProjects, type ProjectItem } from '../mockData'
import { strings } from '../strings'
import { fonts } from '../tokens'

interface VersionHistoryItem {
  id: string
  version: string
  deployedAt: string
  buildDuration: string
  status: 'active' | 'success' | 'failed'
  deployedBy: string
  commitHash: string
}

const mockVersions: VersionHistoryItem[] = [
  {
    id: 'ver-5',
    version: 'v2.1.0',
    deployedAt: '10 minutes ago (16:30:15)',
    buildDuration: '2m 41s',
    status: 'active',
    deployedBy: 'DevOps Engine',
    commitHash: 'a1b2c3d'
  },
  {
    id: 'ver-4',
    version: 'v2.0.4',
    deployedAt: '1 day ago (09:12:00)',
    buildDuration: '2m 15s',
    status: 'success',
    deployedBy: 'Kim (B UI)',
    commitHash: 'f4e3d2c'
  },
  {
    id: 'ver-3',
    version: 'v2.0.3',
    deployedAt: '3 days ago (14:20:10)',
    buildDuration: '3m 05s',
    status: 'failed',
    deployedBy: 'Son (A Core)',
    commitHash: '9x8y7z6'
  },
  {
    id: 'ver-2',
    version: 'v2.0.0',
    deployedAt: '5 days ago',
    buildDuration: '1m 58s',
    status: 'success',
    deployedBy: 'Initial Deploy',
    commitHash: '1a2b3c4'
  }
]

export function AppsPage(): React.JSX.Element {
  const { modal } = AntApp.useApp()
  const [apps] = useState<ProjectItem[]>(mockProjects)
  const [selectedApp, setSelectedApp] = useState<ProjectItem>(mockProjects[0])
  const [activeTab, setActiveTab] = useState<string>('overview')

  // Rollback Modal State
  const [rollbackTarget, setRollbackTarget] = useState<VersionHistoryItem | null>(null)
  const [confirmInput, setConfirmInput] = useState('')

  const handleOpenRollback = (ver: VersionHistoryItem): void => {
    setRollbackTarget(ver)
    setConfirmInput('')
  }

  const isRollbackAllowed =
    selectedApp.status === 'offline' || confirmInput.trim() === selectedApp.name

  return (
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <Typography.Title level={2} style={{ color: 'var(--text-primary)', margin: 0 }}>
            <AppstoreOutlined style={{ marginRight: 10, color: 'var(--info)' }} />
            Application & Version Management (UC-03 / UC-04)
          </Typography.Title>
          <Typography.Text type="secondary">
            Overview details, deploy version history and safe 2-step rollback.
          </Typography.Text>
        </div>
      </div>

      <Row gutter={[20, 20]}>
        {/* Left 30%: App Selection List */}
        <Col span={7}>
          <Card
            title="Application List"
            style={styles.card}
            styles={{
              header: { background: 'transparent' },
              body: { background: 'transparent', padding: 12 }
            }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {apps.map((app) => (
                <div
                  key={app.id}
                  onClick={() => setSelectedApp(app)}
                  style={{
                    ...styles.appItem,
                    borderColor: app.id === selectedApp.id ? 'var(--info)' : 'var(--border)',
                    backgroundColor:
                      app.id === selectedApp.id ? 'var(--bg-elevated)' : 'transparent'
                  }}
                >
                  <div style={styles.appItemHeader}>
                    <Typography.Text strong style={{ color: 'var(--text-primary)' }}>
                      {app.name}
                    </Typography.Text>
                    <Tag color={app.status === 'online' ? 'success' : 'default'}>
                      ● {app.status.toUpperCase()}
                    </Tag>
                  </div>
                  <div style={styles.appItemSub}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {app.framework}
                    </Typography.Text>
                    <Typography.Text
                      code
                      style={{ fontFamily: fonts.mono, fontSize: 11, color: 'var(--success)' }}
                    >
                      {app.currentVersion}
                    </Typography.Text>
                  </div>
                </div>
              ))}
            </Space>
          </Card>
        </Col>

        {/* Right 70%: Selected App Detail & Version History Timeline */}
        <Col span={17}>
          <Card
            title={
              <Space>
                <Typography.Text strong style={{ fontSize: 18, color: 'var(--text-primary)' }}>
                  {selectedApp.name}
                </Typography.Text>
                <Tag color="blue">{selectedApp.framework}</Tag>
                <Tag color="success">Current version: {selectedApp.currentVersion}</Tag>
              </Space>
            }
            extra={
              <Button icon={<ReloadOutlined />} size="small">
                {strings.common.refresh}
              </Button>
            }
            style={styles.card}
            styles={{
              header: { background: 'transparent' },
              body: { background: 'transparent' }
            }}
          >
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'overview',
                  label: (
                    <Space>
                      <InfoCircleOutlined />
                      <span>Overview</span>
                    </Space>
                  ),
                  children: (
                    <div style={{ padding: '10px 0' }}>
                      <Descriptions
                        bordered
                        column={2}
                        size="small"
                        items={[
                          { label: 'Application name', children: selectedApp.name },
                          { label: 'Framework', children: selectedApp.framework },
                          {
                            label: 'VPS Host status',
                            children: (
                              <Space>
                                <CloudServerOutlined style={{ color: 'var(--info)' }} />
                                <Typography.Text code style={{ fontFamily: fonts.mono }}>
                                  {selectedApp.vpsHost}:3000
                                </Typography.Text>
                              </Space>
                            )
                          },
                          {
                            label: 'Container Live Status',
                            children: <Badge status="success" text="● Running (Healthy)" />
                          },
                          {
                            label: 'Running version',
                            children: (
                              <Tag color="success" style={{ fontFamily: fonts.mono }}>
                                {selectedApp.currentVersion}
                              </Tag>
                            )
                          },
                          { label: 'Last deploy', children: selectedApp.lastDeployedAt }
                        ]}
                      />
                    </div>
                  )
                },
                {
                  key: 'versions',
                  label: (
                    <Space>
                      <HistoryOutlined />
                      <span>Version History (Timeline)</span>
                    </Space>
                  ),
                  children: (
                    <div style={{ padding: '20px 10px' }}>
                      <Timeline
                        items={mockVersions.map((ver) => ({
                          color:
                            ver.status === 'active'
                              ? 'var(--success)'
                              : ver.status === 'failed'
                                ? 'var(--danger)'
                                : 'var(--info)',
                          dot:
                            ver.status === 'active' ? (
                              <CheckCircleOutlined
                                style={{ fontSize: 16, color: 'var(--success)' }}
                              />
                            ) : undefined,
                          children: (
                            <div style={styles.timelineContent}>
                              <div style={styles.timelineHeader}>
                                <Space>
                                  <Typography.Text
                                    code
                                    style={{
                                      fontFamily: fonts.mono,
                                      fontSize: 15,
                                      fontWeight: 700
                                    }}
                                  >
                                    {ver.version}
                                  </Typography.Text>
                                  {ver.status === 'active' && (
                                    <Tag color="success">● RUNNING (ACTIVE)</Tag>
                                  )}
                                  {ver.status === 'failed' && <Tag color="error">✗ FAILED</Tag>}
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                    Commit:{' '}
                                    <code style={{ fontFamily: fonts.mono }}>{ver.commitHash}</code>
                                  </Typography.Text>
                                </Space>

                                {ver.status !== 'active' && (
                                  <Button
                                    size="small"
                                    type="primary"
                                    danger
                                    icon={<RollbackOutlined />}
                                    onClick={() => handleOpenRollback(ver)}
                                  >
                                    Rollback to this version
                                  </Button>
                                )}
                              </div>

                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                <ClockCircleOutlined style={{ marginRight: 4 }} />
                                Deployed at: {ver.deployedAt} | Build duration: {ver.buildDuration}{' '}
                                | By: {ver.deployedBy}
                              </Typography.Text>
                            </div>
                          )
                        }))}
                      />
                    </div>
                  )
                }
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* Modal Confirm Rollback 2 Lớp (Yêu cầu gõ tên App để mở khóa) */}
      <Modal
        open={Boolean(rollbackTarget)}
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: 'var(--danger)', fontSize: 22 }} />
            <Typography.Title level={4} style={{ color: 'var(--danger)', margin: 0 }}>
              Confirm Safe Rollback
            </Typography.Title>
          </Space>
        }
        onCancel={() => setRollbackTarget(null)}
        footer={[
          <Button key="cancel" onClick={() => setRollbackTarget(null)}>
            Cancel
          </Button>,
          <Button
            key="confirm"
            type="primary"
            danger
            disabled={!isRollbackAllowed}
            onClick={() => {
              modal.success({
                title: 'Rollback ordered',
                content: `Rolling back the app ${selectedApp.name} to version ${rollbackTarget?.version}...`
              })
              setRollbackTarget(null)
            }}
          >
            Confirm Rollback
          </Button>
        ]}
      >
        <Alert
          type="warning"
          showIcon
          message={`This action will replace the running version ${selectedApp.currentVersion} with the older version ${rollbackTarget?.version}.`}
          style={{ marginBottom: 16 }}
        />

        {selectedApp.status === 'online' ? (
          <div>
            <Typography.Paragraph>
              Because the app <strong>{selectedApp.name}</strong> is running normally, type its
              exact name below to confirm and avoid mistakes:
            </Typography.Paragraph>
            <Input
              placeholder={selectedApp.name}
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              size="large"
              style={{
                fontFamily: fonts.mono,
                borderColor: isRollbackAllowed ? 'var(--success)' : 'var(--border)'
              }}
            />
          </div>
        ) : (
          <Typography.Paragraph type="secondary">
            The app is in an error state (Offline), so you can confirm the rollback immediately.
          </Typography.Paragraph>
        )}
      </Modal>
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: 'var(--bg-panel)',
    borderColor: 'var(--border)',
    borderRadius: 8
  },
  appItem: {
    padding: 12,
    borderRadius: 8,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  appItemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  appItemSub: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  timelineContent: {
    backgroundColor: 'var(--bg-elevated)',
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    marginBottom: 12
  },
  timelineHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  }
}
