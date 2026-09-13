import { useState } from 'react'
import {
  App as AntApp,
  Alert,
  Button,
  Form,
  InputNumber,
  Select,
  Space,
  Switch,
  Segmented,
  Typography
} from 'antd'
import { SettingOutlined, WarningOutlined } from '@ant-design/icons'

import { fonts } from '../tokens'
import { useUiState } from '../store/uiState'
import type { ThemeMode } from '../utils/themeTokens'

export function SettingsPage(): React.JSX.Element {
  const { modal, message } = AntApp.useApp()
  const [autoRollback, setAutoRollback] = useState(true)
  const [trustedMethod, setTrustedMethod] = useState('iforest')
  const [cpuThreshold, setCpuThreshold] = useState(85)
  const [ramThreshold, setRamThreshold] = useState(90)
  const themeMode = useUiState((state) => state.theme)
  const setTheme = useUiState((state) => state.setTheme)

  const handleToggleAutoRollback = (checked: boolean): void => {
    if (checked) {
      modal.confirm({
        title: 'Enable Auto-Rollback?',
        icon: <WarningOutlined style={{ color: 'var(--warning)' }} />,
        content:
          'When enabled, the app will automatically roll back to the previous version as soon as a trusted ML method detects an anomaly above the threshold. Make sure you understand the operating procedure.',
        okText: 'Enable',
        cancelText: 'Cancel',
        onOk() {
          setAutoRollback(true)
          message.success('Auto-Rollback enabled.')
        }
      })
    } else {
      setAutoRollback(false)
      message.info('Auto-Rollback disabled.')
    }
  }

  const handleSave = (): void => {
    message.success('Monitoring settings saved successfully!')
  }

  return (
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <Typography.Title level={2} style={{ color: 'var(--text-primary)', margin: 0 }}>
            <SettingOutlined style={{ marginRight: 10, color: 'var(--info)' }} />
            Cài đặt giám sát
          </Typography.Title>
          <Typography.Text type="secondary">
            Ngưỡng rule, phương pháp tin cậy và tự động rollback.
          </Typography.Text>
        </div>
      </div>

      <div className="settings-section">
        <div>
          <Typography.Text strong>Giao diện</Typography.Text>
          <Typography.Paragraph type="secondary">
            Chọn giao diện cho phiên làm việc này.
          </Typography.Paragraph>
        </div>
        <Segmented<ThemeMode>
          value={themeMode}
          onChange={setTheme}
          options={[
            { value: 'dark', label: 'Tối' },
            { value: 'light', label: 'Sáng' }
          ]}
        />
      </div>

      <div className="settings-form-panel">
        <Form layout="vertical" style={{ maxWidth: 600 }}>
          <Form.Item label="Rule Baseline Threshold - CPU (%)">
            <InputNumber
              min={1}
              max={100}
              value={cpuThreshold}
              onChange={(val) => setCpuThreshold(val ?? 85)}
              style={{ width: '100%', fontFamily: fonts.mono }}
            />
          </Form.Item>

          <Form.Item label="Rule Baseline Threshold - RAM (%)">
            <InputNumber
              min={1}
              max={100}
              value={ramThreshold}
              onChange={(val) => setRamThreshold(val ?? 90)}
              style={{ width: '100%', fontFamily: fonts.mono }}
            />
          </Form.Item>

          <Form.Item label="Trusted ML Method (Trusted Method for Auto-Rollback)">
            <Select
              value={trustedMethod}
              onChange={setTrustedMethod}
              options={[
                { value: 'iforest', label: 'Isolation Forest (Purple - Recommended)' },
                { value: 'ensemble', label: 'Ensemble Method (Green)' },
                { value: 'zscore_ewma', label: 'Z-Score EWMA (Blue)' },
                { value: 'ocsvm', label: 'One-Class SVM (Pink)' }
              ]}
            />
          </Form.Item>

          <Form.Item label="Enable Auto-Rollback (Auto-Rollback Trigger)">
            <Space size="middle">
              <Switch checked={autoRollback} onChange={handleToggleAutoRollback} />
              <Typography.Text type="secondary">
                {autoRollback ? 'ON (Active)' : 'OFF (Disabled)'}
              </Typography.Text>
            </Space>
          </Form.Item>

          {autoRollback && (
            <Alert
              type="warning"
              showIcon
              message="Auto-Rollback is active with trusted method: Isolation Forest."
              style={{ marginBottom: 24 }}
            />
          )}

          <Form.Item style={{ marginTop: 20 }}>
            <Button type="primary" size="large" onClick={handleSave}>
              Save Settings
            </Button>
          </Form.Item>
        </Form>
      </div>
    </section>
  )
}
