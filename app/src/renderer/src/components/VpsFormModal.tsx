import { useCallback, useEffect, useRef, useState } from 'react'
import { Divider, Form, Input, InputNumber, Modal, Radio } from 'antd'

import type { Vps, VpsConnectionCheck, VpsInput } from '@shared/ipc'

import { ConnectionCheck, CheckFailedError } from './ConnectionCheck'
import { strings } from '../strings'

export type VpsFormValues = VpsInput

interface VpsFormModalProps {
  open: boolean
  initialVps: Vps | null
  saving: boolean
  onCancel: () => void
  onSubmit: (values: VpsFormValues) => void
}

export function VpsFormModal({
  open,
  initialVps,
  saving,
  onCancel,
  onSubmit
}: VpsFormModalProps): React.JSX.Element {
  const [form] = Form.useForm<VpsFormValues>()
  const authType = Form.useWatch('auth_type', form) ?? 'password'
  // Đổi giá trị form => kết quả "Kiểm tra kết nối" cũ không còn đúng nữa => reset khối check.
  const [formVersion, setFormVersion] = useState(0)
  const revision = useRef(0)

  useEffect(() => {
    revision.current += 1
    if (!open) return

    if (initialVps) {
      form.setFieldsValue({
        name: initialVps.name,
        host: initialVps.host,
        port: initialVps.port,
        host_fingerprint: initialVps.host_fingerprint ?? '',
        username: initialVps.username,
        auth_type: initialVps.auth_type,
        secret: '',
        provider: initialVps.provider ?? undefined,
        region: initialVps.region ?? undefined
      })
    } else {
      form.resetFields()
      form.setFieldsValue({
        port: 22,
        username: 'root',
        auth_type: 'password',
        host_fingerprint: ''
      })
    }
    // Không cần bump formVersion ở đây: destroyOnHidden đã hủy ConnectionCheck khi đóng modal.
  }, [form, initialVps, open])

  const runCheck = useCallback(
    async (values: VpsInput): Promise<VpsConnectionCheck> => {
      const requestRevision = revision.current
      try {
        await form.validateFields()
      } catch {
        throw new CheckFailedError(strings.vps.validation.incomplete)
      }
      if (initialVps && !String(values.secret ?? '').trim()) {
        throw new CheckFailedError(strings.vps.check.needCredential)
      }
      const result = await window.api.invoke('vps:test-connection', {
        ...values,
        name: values.name?.trim() || values.host
      })
      if (!result.ok) {
        throw new CheckFailedError(result.error.message, result.error.technical)
      }
      if (revision.current === requestRevision && result.data.host_fingerprint) {
        form.setFieldValue('host_fingerprint', result.data.host_fingerprint)
      }
      return result.data
    },
    [form, initialVps]
  )

  return (
    <Modal
      open={open}
      centered
      width="min(640px, calc(100vw - 32px))"
      title={initialVps ? strings.vps.form.editTitle : strings.vps.form.createTitle}
      okText={strings.common.save}
      cancelText={strings.common.cancel}
      confirmLoading={saving}
      destroyOnHidden
      onCancel={onCancel}
      onOk={() => void form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        onValuesChange={(changed) => {
          revision.current += 1
          if ('host' in changed || 'port' in changed) form.setFieldValue('host_fingerprint', '')
          setFormVersion((version) => version + 1)
        }}
        onFinish={(values) => onSubmit({ ...values, name: values.name?.trim() || values.host })}
      >
        <div className="modal-form-grid">
          <Form.Item name="name" label={strings.vps.fields.name}>
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item
            name="host"
            label={strings.vps.fields.host}
            rules={[{ required: true, message: strings.vps.validation.host }]}
          >
            <Input
              autoFocus
              className="mono-input"
              maxLength={253}
              placeholder={strings.vps.form.hostPlaceholder}
            />
          </Form.Item>
          <Form.Item
            name="username"
            label={strings.vps.fields.username}
            rules={[{ required: true, message: strings.vps.validation.username }]}
          >
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item name="auth_type" label={strings.vps.fields.authType}>
            <Radio.Group
              options={[
                { label: strings.vps.authType.key, value: 'key' },
                { label: strings.vps.authType.password, value: 'password' }
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item
          name="secret"
          label={authType === 'key' ? strings.vps.fields.privateKey : strings.vps.fields.password}
          extra={initialVps ? strings.vps.form.keepCredentialHint : undefined}
          rules={[
            {
              required: initialVps === null,
              message:
                authType === 'key'
                  ? strings.vps.validation.privateKey
                  : strings.vps.validation.password
            }
          ]}
        >
          {authType === 'key' ? (
            <Input.TextArea className="mono-input" autoSize={{ minRows: 3, maxRows: 7 }} />
          ) : (
            <Input.Password />
          )}
        </Form.Item>
        <details className="vps-form-advanced">
          <summary>{strings.vps.form.advanced}</summary>
          <div className="modal-form-grid">
            <Form.Item
              name="port"
              label={strings.vps.fields.port}
              rules={[{ required: true, message: strings.vps.validation.port }]}
            >
              <InputNumber min={1} max={65535} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="host_fingerprint"
              label={strings.vps.fields.hostFingerprint}
              extra={strings.vps.form.hostFingerprintHint}
              rules={[
                {
                  pattern: /^SHA256:[A-Za-z0-9+/]{43}$/,
                  message: strings.vps.validation.hostFingerprintFormat
                }
              ]}
            >
              <Input className="mono-input" placeholder="SHA256:..." autoComplete="off" />
            </Form.Item>
            <Form.Item name="provider" label={strings.vps.fields.provider}>
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="region" label={strings.vps.fields.region}>
              <Input maxLength={100} />
            </Form.Item>
          </div>
        </details>
      </Form>

      <Divider style={{ marginBlock: 14 }} />
      <ConnectionCheck
        key={formVersion}
        getValues={() => form.getFieldsValue() as VpsInput}
        runCheck={runCheck}
        vpsId={initialVps?.id}
      />
    </Modal>
  )
}
