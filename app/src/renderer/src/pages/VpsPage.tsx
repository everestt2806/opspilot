import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Modal, Space, Table, Tag, Typography } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'

import type { Vps, VpsInput } from '@shared/ipc'

import { VpsFormModal, type VpsFormValues } from '../components/VpsFormModal'
import { VpsResourcesCell } from '../components/VpsResourcesCell'
import { strings } from '../strings'
import { useVpsStore } from '../store/vpsStore'
import { rowDisplayStatus, type RowDisplayStatus } from '../vpsResources'

const STATUS_TAG: Record<RowDisplayStatus, { color: string; label: string }> = {
  checking: { color: 'processing', label: strings.vps.status.checking },
  online: { color: 'success', label: strings.vps.status.online },
  offline: { color: 'error', label: strings.vps.status.offline },
  unknown: { color: 'default', label: strings.vps.status.unknown }
}

export function VpsPage(): React.JSX.Element {
  const items = useVpsStore((state) => state.items)
  const loading = useVpsStore((state) => state.loading)
  const loadError = useVpsStore((state) => state.loadError)
  const resources = useVpsStore((state) => state.resources)
  const load = useVpsStore((state) => state.load)
  const refreshResources = useVpsStore((state) => state.refreshResources)

  const [formOpen, setFormOpen] = useState(false)
  const [editingVps, setEditingVps] = useState<Vps | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

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
            return Promise.reject(new Error(result.error.message))
          }
          await load()
        }
      })
    },
    [load]
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
        key: 'status',
        render: (_: unknown, vps: Vps) => {
          const status = rowDisplayStatus(vps, resources[vps.id])
          return <Tag color={STATUS_TAG[status].color}>{STATUS_TAG[status].label}</Tag>
        }
      },
      {
        title: strings.vps.columns.resources,
        key: 'resources',
        render: (_: unknown, vps: Vps) => (
          <VpsResourcesCell
            vpsName={vps.name}
            state={resources[vps.id]}
            onRetry={() => void refreshResources([vps.id])}
          />
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
    [deleteVps, refreshResources, resources]
  )

  const submitForm = async (values: VpsFormValues): Promise<void> => {
    setSaving(true)
    setSaveError(null)

    const result = editingVps
      ? await window.api.invoke('vps:update', editingVps.id, toUpdatePatch(values))
      : await window.api.invoke('vps:create', values)

    setSaving(false)
    if (!result.ok) {
      setSaveError(result.error.message)
      return
    }

    setFormOpen(false)
    setEditingVps(null)
    await load()
  }

  return (
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>{strings.vps.title}</Typography.Title>
          <Typography.Text type="secondary">{strings.vps.description}</Typography.Text>
        </div>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            disabled={items.length === 0}
            onClick={() => void refreshResources()}
          >
            {strings.vps.checkResources}
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

      {(loadError || saveError) && (
        <Alert
          className="page-alert"
          type="error"
          showIcon
          message={loadError ? strings.vps.loadError : strings.common.saveError}
          description={loadError ?? saveError}
          action={
            loadError ? (
              <Button onClick={() => void load()}>{strings.common.retry}</Button>
            ) : undefined
          }
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
