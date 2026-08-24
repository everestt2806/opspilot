import React from 'react'
import {
  BuildOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  CloudUploadOutlined,
  CodeOutlined,
  DatabaseOutlined,
  HeartOutlined,
  LoadingOutlined,
  RocketOutlined,
  SafetyOutlined
} from '@ant-design/icons'
import { Space, Tag, Typography } from 'antd'

import type { PipelineStep, StepKey, StepStatus } from '../mockData'
import { strings } from '../strings'
import { fonts } from '../tokens'

interface PipelineStepperProps {
  steps: PipelineStep[]
  activeKey?: StepKey
}

const STEP_ICONS: Record<StepKey, React.JSX.Element> = {
  PRECHECK: <SafetyOutlined style={{ fontSize: 24 }} />,
  UPLOAD: <CloudUploadOutlined style={{ fontSize: 24 }} />,
  RENDER: <CodeOutlined style={{ fontSize: 24 }} />,
  BUILD: <BuildOutlined style={{ fontSize: 24 }} />,
  DEPLOY: <RocketOutlined style={{ fontSize: 24 }} />,
  HEALTHCHECK: <HeartOutlined style={{ fontSize: 24 }} />,
  RECORD: <DatabaseOutlined style={{ fontSize: 24 }} />
}

export function PipelineStepper({ steps }: PipelineStepperProps): React.JSX.Element {
  return (
    <div className="pipeline-stepper-container" style={styles.container}>
      <div style={styles.headerRow}>
        <Typography.Title level={4} style={{ color: 'var(--text-primary)', margin: 0 }}>
          {strings.pipeline.title}
        </Typography.Title>
        <Space size="middle">
          <Tag color="success">✓ {strings.pipeline.status.completed}</Tag>
          <Tag color="processing">⟳ {strings.pipeline.status.in_progress}</Tag>
          <Tag color="error">✗ {strings.pipeline.status.error}</Tag>
        </Space>
      </div>

      <div style={styles.pipelineRow}>
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1
          const meta = strings.pipeline.steps[step.key]
          const statusStyle = getStatusStyles(step.status)

          return (
            <React.Fragment key={step.key}>
              <div style={styles.stepNodeContainer}>
                {/* Main Node Card with Icon */}
                <div style={{ ...styles.stepNode, ...statusStyle.card }}>
                  {/* Top-Right Badge Status */}
                  <div style={styles.badgeAnchor}>
                    {step.status === 'completed' && (
                      <CheckCircleFilled style={{ color: 'var(--success)', fontSize: 16 }} />
                    )}
                    {step.status === 'in_progress' && (
                      <LoadingOutlined style={{ color: 'var(--info)', fontSize: 16 }} />
                    )}
                    {step.status === 'error' && (
                      <CloseCircleFilled style={{ color: 'var(--danger)', fontSize: 16 }} />
                    )}
                  </div>

                  {/* Representative Step Icon */}
                  <div style={{ color: statusStyle.iconColor }}>{STEP_ICONS[step.key]}</div>

                  {/* Duration Tag if completed */}
                  {step.durationSec !== undefined && (
                    <span style={styles.durationChip}>{step.durationSec}s</span>
                  )}
                </div>

                {/* Step Titles */}
                <Typography.Text
                  strong
                  style={{
                    color: statusStyle.textColor,
                    fontSize: 13,
                    marginTop: 8,
                    textAlign: 'center'
                  }}
                >
                  {meta?.title ?? step.key}
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{
                    fontSize: 11,
                    textAlign: 'center',
                    color: 'var(--text-muted)'
                  }}
                >
                  {meta?.desc}
                </Typography.Text>
              </div>

              {/* Connecting Pipe Connector Line */}
              {!isLast && (
                <div style={styles.pipeConnectorWrapper}>
                  <div
                    style={{
                      ...styles.pipeConnectorLine,
                      backgroundColor:
                        step.status === 'completed'
                          ? 'var(--success)'
                          : step.status === 'in_progress'
                            ? 'var(--info)'
                            : step.status === 'error'
                              ? 'var(--danger)'
                              : 'var(--border)'
                    }}
                  />
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

function getStatusStyles(status: StepStatus): {
  card: React.CSSProperties
  iconColor: string
  textColor: string
} {
  switch (status) {
    case 'completed':
      return {
        card: {
          borderColor: 'var(--success)',
          backgroundColor: 'color-mix(in srgb, var(--success) 12%, transparent)',
          boxShadow: '0 0 12px color-mix(in srgb, var(--success) 20%, transparent)'
        },
        iconColor: 'var(--success)',
        textColor: 'var(--success)'
      }
    case 'in_progress':
      return {
        card: {
          borderColor: 'var(--info)',
          backgroundColor: 'color-mix(in srgb, var(--info) 16%, transparent)',
          boxShadow: '0 0 16px color-mix(in srgb, var(--info) 35%, transparent)',
          animation: 'pulse-blue 1.8s infinite'
        },
        iconColor: 'var(--info)',
        textColor: 'var(--info)'
      }
    case 'error':
      return {
        card: {
          borderColor: 'var(--danger)',
          backgroundColor: 'color-mix(in srgb, var(--danger) 18%, transparent)',
          boxShadow: '0 0 14px color-mix(in srgb, var(--danger) 30%, transparent)'
        },
        iconColor: 'var(--danger)',
        textColor: 'var(--danger)'
      }
    case 'pending':
    default:
      return {
        card: {
          borderColor: 'var(--border)',
          backgroundColor: 'var(--bg-panel-translucent)',
          opacity: 0.6
        },
        iconColor: 'var(--text-muted)',
        textColor: 'var(--text-muted)'
      }
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: 'var(--bg-panel-translucent)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 20,
    marginBottom: 20
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24
  },
  pipelineRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
    overflowX: 'auto',
    paddingBottom: 8
  },
  stepNodeContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: 100
  },
  stepNode: {
    position: 'relative',
    width: 64,
    height: 64,
    borderRadius: 12,
    border: '2px solid transparent',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    transition: 'all 0.3s ease'
  },
  badgeAnchor: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: 'var(--bg-panel)',
    borderRadius: '50%',
    lineHeight: 1
  },
  durationChip: {
    position: 'absolute',
    top: -10,
    right: 18,
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    fontSize: 10,
    borderRadius: 10,
    padding: '1px 6px',
    fontFamily: fonts.mono
  },
  pipeConnectorWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 30,
    minWidth: 20
  },
  pipeConnectorLine: {
    height: 3,
    width: '100%',
    borderRadius: 2,
    transition: 'background-color 0.3s ease'
  }
}
