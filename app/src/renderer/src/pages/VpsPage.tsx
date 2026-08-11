import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Modal, Space, Table, Tag, Typography } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'

import type { Vps, VpsInput } from '@shared/ipc'

import { VpsFormModal, type VpsFormValues } from '../components/VpsFormModal'
import { strings } from '../strings'

export function VpsPage(): React.JSX.Element {
  const [items, setItems] = useState<Vps[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingVps, setEditingVps] = useState<Vps | null>(null)
  const [saving, setSaving] = useState(false)

  const loadItems = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    const result = await window.api.invoke('vps:list')
    if (result.ok) {
      setItems(result.data)
    } else {
      setError(result.error.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true

    void window.api.invoke('vps:list').then((result) => {
      if (!active) return

      if (result.ok) {
        setItems(result.data)
      } else {
        setError(result.error.message)
      }
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [])

  const deleteVps = useCallback(
    (vps: Vps): void => {
      Modal.confirm({
        title: strings.vps.delete.title,
        content: strings.vps.delete.description(vps.name),
        okText: strings.vps.delete.confirm,
        okButtonProps: { danger: true },
        cancelText: strings.common.cancel,
        async onOk() {
          const result = await window.api.invoke('vps:delete', vps.id)
          if (!result.ok) {
            setError(result.error.message)
            return Promise.reject(new Error(result.error.message))
          }
          await loadItems()
        }
      })
    },
    [loadItems]
  )

  const columns = useMemo(
    () => [
      {
        title: strings.vps.columns.name,
        dataIndex: 'name',
        key: 'name',
        render: (name: string) => <Typography.Text strong>{name}</Typography.Text>
      },
      {
        title: strings.vps.columns.host,
        key: 'host',
        render: (_: unknown, vps: Vps) => (
          <Typography.Text code>{`${vps.host}:${vps.port}`}</Typography.Text>
        )
      },
      {
        title: strings.vps.columns.status,
        dataIndex: 'last_status',
        key: 'last_status',
        render: (status: Vps['last_status']) => (
          <Tag color={status === 'online' ? 'success' : status === 'offline' ? 'error' : 'default'}>
            {strings.vps.status[status]}
          </Tag>
        )
      },
      {
        title: strings.vps.columns.provider,
        key: 'provider',
        render: (_: unknown, vps: Vps) =>
          [vps.provider, vps.region].filter(Boolean).join(' · ') || strings.common.notAvailable
      },
      {
        title: strings.vps.columns.actions,
        key: 'actions',
        width: 128,
        render: (_: unknown, vps: Vps) => (
          <Space size="small">
            <Button
              type="text"
              aria-label={strings.vps.actions.edit(vps.name)}
              icon={<EditOutlined />}
              onClick={() => {
                setEditingVps(vps)
                setFormOpen(true)
              }}
            />
            <Button
              type="text"
              danger
              aria-label={strings.vps.actions.delete(vps.name)}
              icon={<DeleteOutlined />}
              onClick={() => deleteVps(vps)}
            />
          </Space>
        )
      }
    ],
    [deleteVps]
  )

  const submitForm = async (values: VpsFormValues): Promise<void> => {
    setSaving(true)
    setError(null)

    const result = editingVps
      ? await window.api.invoke('vps:update', editingVps.id, toUpdatePatch(values))
      : await window.api.invoke('vps:create', values)

    setSaving(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }

    setFormOpen(false)
    setEditingVps(null)
    await loadItems()
  }

  return (
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>{strings.vps.title}</Typography.Title>
          <Typography.Text type="secondary">{strings.vps.description}</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadItems()}>
            {strings.common.refresh}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingVps(null)
              setFormOpen(true)
            }}
          >
            {strings.vps.create}
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          className="page-alert"
          type="error"
          showIcon
          message={strings.vps.loadError}
          description={error}
          action={<Button onClick={() => void loadItems()}>{strings.common.retry}</Button>}
        />
      )}

      <Table<Vps>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{
          emptyText: (
            <Empty description={strings.vps.empty}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingVps(null)
                  setFormOpen(true)
                }}
              >
                {strings.vps.createFirst}
              </Button>
            </Empty>
          )
        }}
      />

      <VpsFormModal
        open={formOpen}
        initialVps={editingVps}
        saving={saving}
        onCancel={() => {
          setFormOpen(false)
          setEditingVps(null)
        }}
        onSubmit={(values) => void submitForm(values)}
      />
    </section>
  )
}

function toUpdatePatch(values: VpsFormValues): Partial<VpsInput> {
  const { secret, ...publicValues } = values
  return secret ? { ...publicValues, secret } : publicValues
}
