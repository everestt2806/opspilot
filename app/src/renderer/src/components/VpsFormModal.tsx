import { useEffect } from 'react'
import { Form, Input, InputNumber, Modal, Radio } from 'antd'

import type { Vps, VpsInput } from '@shared/ipc'

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
  const authType = Form.useWatch('auth_type', form) ?? 'key'

  useEffect(() => {
    if (!open) return

    if (initialVps) {
      form.setFieldsValue({
        name: initialVps.name,
        host: initialVps.host,
        port: initialVps.port,
        username: initialVps.username,
        auth_type: initialVps.auth_type,
        secret: '',
        provider: initialVps.provider ?? undefined,
        region: initialVps.region ?? undefined
      })
    } else {
      form.resetFields()
      form.setFieldsValue({ port: 22, auth_type: 'key' })
    }
  }, [form, initialVps, open])

  return (
    <Modal
      open={open}
      title={initialVps ? strings.vps.form.editTitle : strings.vps.form.createTitle}
      okText={strings.common.save}
      cancelText={strings.common.cancel}
      confirmLoading={saving}
      destroyOnHidden
      onCancel={onCancel}
      onOk={() => void form.submit()}
    >
      <Form form={form} layout="vertical" requiredMark="optional" onFinish={onSubmit}>
        <Form.Item
          name="name"
          label={strings.vps.fields.name}
          rules={[{ required: true, message: strings.vps.validation.name }]}
        >
          <Input autoFocus maxLength={64} />
        </Form.Item>
        <Form.Item
          name="host"
          label={strings.vps.fields.host}
          rules={[{ required: true, message: strings.vps.validation.host }]}
        >
          <Input
            className="mono-input"
            maxLength={253}
            placeholder={strings.vps.form.hostPlaceholder}
          />
        </Form.Item>
        <Form.Item
          name="port"
          label={strings.vps.fields.port}
          rules={[{ required: true, message: strings.vps.validation.port }]}
        >
          <InputNumber min={1} max={65535} precision={0} style={{ width: '100%' }} />
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
            <Input.TextArea className="mono-input" autoSize={{ minRows: 4, maxRows: 8 }} />
          ) : (
            <Input.Password />
          )}
        </Form.Item>
        <Form.Item name="provider" label={strings.vps.fields.provider}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="region" label={strings.vps.fields.region}>
          <Input maxLength={100} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
