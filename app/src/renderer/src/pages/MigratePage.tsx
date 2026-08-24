import { useState } from 'react'
import { ArrowRightOutlined, CheckCircleOutlined, DeploymentUnitOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Progress, Row, Space, Steps, Table, Tag, Typography } from 'antd'

import { fonts } from '../tokens'

export function MigratePage(): React.JSX.Element {
  const [currentStep, setCurrentStep] = useState(0)

  const handleNext = (): void => {
    if (currentStep < 4) {
      setCurrentStep((prev) => prev + 1)
    }
  }

  const handlePrev = (): void => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }

  return (
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <Typography.Title level={2} style={{ color: 'var(--text-primary)', margin: 0 }}>
            <DeploymentUnitOutlined style={{ marginRight: 10, color: 'var(--info)' }} />
            Migrate Wizard — Move an app between 2 VPS (UC-05)
          </Typography.Title>
          <Typography.Text type="secondary">
            A 5-step wizard to safely move the application, database and static data between VPS
            servers.
          </Typography.Text>
        </div>
      </div>

      {/* Stepper 5 bước */}
      <Card
        style={styles.card}
        styles={{ body: { background: 'transparent', padding: '16px 20px' } }}
      >
        <Steps
          current={currentStep}
          items={[
            { title: '1. Pick Source & Target' },
            { title: '2. Precheck Target VPS' },
            { title: '3. Run Migration' },
            { title: '4. Verify & Compare' },
            { title: '5. Confirm Source Cleanup' }
          ]}
        />
      </Card>

      <Card
        style={{ ...styles.card, marginTop: 20 }}
        styles={{ body: { background: 'transparent', padding: 24, minHeight: 340 } }}
      >
        {/* Step 1: Chọn Nguồn & Đích */}
        {currentStep === 0 && (
          <div>
            <Typography.Title level={4} style={{ color: 'var(--text-primary)', marginBottom: 20 }}>
              Step 1: Pick source and target VPS
            </Typography.Title>
            <Row gutter={24} align="middle">
              <Col span={10}>
                <Card title="SOURCE VPS" style={{ borderColor: 'var(--border)' }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Typography.Text strong>VPS-prod-01</Typography.Text>
                    <Typography.Text code style={{ fontFamily: fonts.mono }}>
                      203.0.113.10:22
                    </Typography.Text>
                    <Tag color="success">● App: e-commerce-backend (v2.1.0)</Tag>
                  </Space>
                </Card>
              </Col>
              <Col span={4} style={{ textAlign: 'center' }}>
                <ArrowRightOutlined style={{ fontSize: 32, color: 'var(--info)' }} />
              </Col>
              <Col span={10}>
                <Card title="TARGET VPS" style={{ borderColor: 'var(--info)' }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Typography.Text strong>VPS-backup-02</Typography.Text>
                    <Typography.Text code style={{ fontFamily: fonts.mono }}>
                      203.0.113.20:22
                    </Typography.Text>
                    <Tag color="blue">Ready for Migration</Tag>
                  </Space>
                </Card>
              </Col>
            </Row>
          </div>
        )}

        {/* Step 2: Precheck */}
        {currentStep === 1 && (
          <div>
            <Typography.Title level={4} style={{ color: 'var(--text-primary)', marginBottom: 16 }}>
              Step 2: Check target VPS readiness
            </Typography.Title>
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleOutlined />}
              message="Target VPS passed all precheck conditions (RAM 4GB, Disk 50GB, Docker 27.1 installed)."
              style={{ marginBottom: 20 }}
            />
          </div>
        )}

        {/* Step 3: Thực thi Migration */}
        {currentStep === 2 && (
          <div>
            <Typography.Title level={4} style={{ color: 'var(--text-primary)', marginBottom: 16 }}>
              Step 3: Running migration (Downtime: 00:42)
            </Typography.Title>
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              <div>
                <Typography.Text strong style={{ color: 'var(--text-primary)' }}>
                  1. BACKUP — Back up source VPS data
                </Typography.Text>
                <Progress percent={100} status="success" />
              </div>
              <div>
                <Typography.Text strong style={{ color: 'var(--text-primary)' }}>
                  2. TRANSFER — Transfer data over SSH/SCP
                </Typography.Text>
                <Progress percent={78} status="active" />
              </div>
              <div>
                <Typography.Text strong style={{ color: 'var(--text-primary)' }}>
                  3. RESTORE — Restore DB & start containers on target VPS
                </Typography.Text>
                <Progress percent={10} status="normal" />
              </div>
            </Space>
          </div>
        )}

        {/* Step 4: Verify Đối chiếu */}
        {currentStep === 3 && (
          <div>
            <Typography.Title level={4} style={{ color: 'var(--text-primary)', marginBottom: 16 }}>
              Step 4: Integrity comparison table (Verify FR-C4)
            </Typography.Title>
            <Table
              pagination={false}
              size="small"
              columns={[
                { title: 'Data item', dataIndex: 'item' },
                { title: 'Source VPS', dataIndex: 'source' },
                { title: 'Target VPS', dataIndex: 'target' },
                {
                  title: 'Checksum / Status',
                  dataIndex: 'match',
                  render: () => <Tag color="success">✓ MATCHED (100%)</Tag>
                }
              ]}
              dataSource={[
                {
                  key: '1',
                  item: 'File Static Uploads',
                  source: '4,210 files (1.2 GB)',
                  target: '4,210 files (1.2 GB)',
                  match: true
                },
                {
                  key: '2',
                  item: 'SQLite Database Tables',
                  source: '14 tables (48,200 rows)',
                  target: '14 tables (48,200 rows)',
                  match: true
                },
                {
                  key: '3',
                  item: 'Docker Image Hash',
                  source: 'sha256:e3b0c442',
                  target: 'sha256:e3b0c442',
                  match: true
                }
              ]}
            />
          </div>
        )}

        {/* Step 5: Xác nhận dọn nguồn */}
        {currentStep === 4 && (
          <div>
            <Typography.Title level={4} style={{ color: 'var(--text-primary)', marginBottom: 16 }}>
              Step 5: Migration complete
            </Typography.Title>
            <Alert
              type="success"
              showIcon
              message="The app was moved successfully! Total downtime: 1 minute 15 seconds."
              style={{ marginBottom: 24 }}
            />
            <Space size="large">
              <Button type="primary" size="large">
                Finish & keep source data
              </Button>
              <Button danger size="large">
                Finish & clean up source VPS
              </Button>
            </Space>
          </div>
        )}

        {/* Wizard Navigation Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 30 }}>
          <Button disabled={currentStep === 0} onClick={handlePrev}>
            Back
          </Button>
          <Button type="primary" disabled={currentStep === 4} onClick={handleNext}>
            Next step →
          </Button>
        </div>
      </Card>
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: 'var(--bg-panel)',
    borderColor: 'var(--border)',
    borderRadius: 8
  }
}
