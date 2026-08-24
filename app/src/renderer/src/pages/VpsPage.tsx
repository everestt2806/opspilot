import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Modal, Space, Tooltip, Typography } from 'antd'
import {
  ArrowLeftOutlined,
  CloudServerOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons'

import type { Vps, VpsInput } from '@shared/ipc'

import { FleetSummary } from '../components/FleetSummary'
import { ServerSelector } from '../components/ServerSelector'
import { VpsDetail } from '../components/VpsDetail'
import { VpsFormModal, type VpsFormValues } from '../components/VpsFormModal'
import { strings } from '../strings'
import { useUiState } from '../store/uiState'
import { useVpsStore } from '../store/vpsStore'
import { rowDisplayStatus } from '../vpsResources'

/** VPS Control Panel — luồng 2 màn: danh sách fleet → trang chi tiết từng máy (FlashPanel). */
export function VpsPage(): React.JSX.Element {
  const items = useVpsStore((state) => state.items)
  const loading = useVpsStore((state) => state.loading)
  const loadError = useVpsStore((state) => state.loadError)
  const resources = useVpsStore((state) => state.resources)
  const load = useVpsStore((state) => state.load)
  const refreshResources = useVpsStore((state) => state.refreshResources)

  const selectedVpsId = useUiState((state) => state.selectedVpsId)
  const setSelectedVpsId = useUiState((state) => state.setSelectedVpsId)
  const activePanelTab = useUiState((state) => state.activePanelTab)
  const setActivePanelTab = useUiState((state) => state.setActivePanelTab)
  const vpsSearch = useUiState((state) => state.vpsSearch)
  const setVpsSearch = useUiState((state) => state.setVpsSearch)
  const selectedVpsIds = useUiState((state) => state.selectedVpsIds)
  const setSelectedVpsIds = useUiState((state) => state.setSelectedVpsIds)

  const [appCounts, setAppCounts] = useState<Record<number, number>>({})
  const [resourceBannerDismissed, setResourceBannerDismissed] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingVps, setEditingVps] = useState<Vps | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [modal, contextHolder] = Modal.useModal()

  const isListView = selectedVpsId === null

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    void window.api.invoke('app:list').then((result) => {
      if (cancelled || !result.ok) return
      const counts: Record<number, number> = {}
      for (const app of result.data) {
        counts[app.vps_id] = (counts[app.vps_id] ?? 0) + 1
      }
      setAppCounts(counts)
    })
    return () => {
      cancelled = true
    }
  }, [items])

  // Mở tab VPS luôn bắt đầu từ danh sách — bấm dòng mới vào trang chi tiết.
  useEffect(() => {
    setSelectedVpsId(null)
  }, [setSelectedVpsId])

  // Máy đang xem bị xoá → quay về danh sách; đồng thời gỡ dấu chọn của VPS không còn
  // tồn tại (chỉ dọn khi danh sách đã tải xong, không dọn lúc items tạm rỗng khi reload).
  useEffect(() => {
    if (
      selectedVpsId !== null &&
      (items.length === 0 || !items.some((vps) => vps.id === selectedVpsId))
    ) {
      setSelectedVpsId(null)
    }
    if (!loading && items.length > 0) {
      const validIds = selectedVpsIds.filter((id) => items.some((vps) => vps.id === id))
      if (validIds.length !== selectedVpsIds.length) {
        setSelectedVpsIds(validIds)
      }
    }
  }, [items, loading, selectedVpsId, selectedVpsIds, setSelectedVpsId, setSelectedVpsIds])

  const selectedVps = items.find((vps) => vps.id === selectedVpsId) ?? null
  const selectedResources = selectedVps ? resources[selectedVps.id] : undefined

  const openCreate = (): void => {
    setEditingVps(null)
    setFormOpen(true)
  }

  const openEdit = (vps: Vps): void => {
    setEditingVps(vps)
    setFormOpen(true)
  }

  const deleteVps = useCallback(
    (vps: Vps): void => {
      modal.confirm({
        title: strings.vps.delete.title,
        content: strings.vps.delete.description(vps.name),
        okText: strings.vps.delete.confirm,
        okButtonProps: { danger: true },
        cancelText: strings.common.cancel,
        async onOk() {
          return new Promise<void>((resolve, reject) => {
            modal.confirm({
              title: strings.vps.delete.title,
              content: strings.vps.delete.description(vps.name),
              okText: strings.vps.delete.confirm,
              okButtonProps: { danger: true },
              cancelText: strings.common.cancel,
              async onOk() {
                const result = await window.api.invoke('vps:delete', vps.id)
                if (!result.ok) {
                  reject(new Error(result.error.message))
                  return
                }
                await load()
                resolve()
              },
              onCancel: () => reject(new Error('cancelled'))
            })
          })
        }
      })
    },
    [load, modal]
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

  let online = 0
  let offline = 0
  for (const vps of items) {
    const status = rowDisplayStatus(vps, resources[vps.id])
    if (status === 'online') online += 1
    else if (status === 'offline') offline += 1
  }
  const totalApps = Object.values(appCounts).reduce((sum, count) => sum + count, 0)

  const showResourceBanner =
    !isListView &&
    selectedResources?.status === 'error' &&
    !resourceBannerDismissed &&
    selectedVps !== null

  return (
    <section className="page-panel">
      {contextHolder}

      {isListView ? (
        <>
          <div className="page-heading">
            <div>
              <Typography.Title level={2} style={{ color: 'var(--text-primary)', margin: 0 }}>
                <CloudServerOutlined style={{ marginRight: 10, color: 'var(--info)' }} />
                {strings.vps.title}
              </Typography.Title>
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
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                {strings.vps.create}
              </Button>
            </Space>
          </div>

          {loadError && (
            <Alert
              className="page-alert"
              type="error"
              showIcon
              message={strings.vps.loadError}
              description={loadError}
              action={<Button onClick={() => void load()}>{strings.common.retry}</Button>}
            />
          )}

          {saveError && (
            <Alert
              className="page-alert"
              type="error"
              showIcon
              message={strings.common.saveError}
              description={saveError}
            />
          )}

          <FleetSummary
            total={items.length}
            online={online}
            offline={offline}
            appCount={totalApps}
            loading={loading}
          />

          <ServerSelector
            items={items}
            resources={resources}
            appCounts={appCounts}
            loading={loading}
            search={vpsSearch}
            selectedIds={selectedVpsIds}
            onSelect={(vps) => {
              setSelectedVpsId(vps.id)
              setResourceBannerDismissed(false)
            }}
            onSearchChange={setVpsSearch}
            onSelectionChange={setSelectedVpsIds}
            onAddVps={openCreate}
            onDelete={deleteVps}
            onRetryResources={(vpsId) => void refreshResources([vpsId])}
          />
        </>
      ) : (
        selectedVps && (
          <>
            <div className="panel-detail-bar">
              <Tooltip title={strings.vps.backToList}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  aria-label={strings.vps.backToList}
                  onClick={() => setSelectedVpsId(null)}
                />
              </Tooltip>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {selectedVps.name}
              </Typography.Title>
            </div>

            {showResourceBanner && (
              <Alert
                className="page-alert panel-resource-alert"
                type="error"
                showIcon
                message={strings.vpsControl.resourceBanner.title}
                description={
                  selectedResources?.status === 'error' ? selectedResources.message : undefined
                }
                action={
                  <Space>
                    <Button
                      size="small"
                      onClick={() => void refreshResources([selectedVps.id])}
                    >
                      {strings.common.retry}
                    </Button>
                    <Button size="small" type="text" onClick={() => setResourceBannerDismissed(true)}>
                      {strings.vpsControl.resourceBanner.markRead}
                    </Button>
                  </Space>
                }
              />
            )}

            <VpsDetail
              vps={selectedVps}
              resources={selectedResources}
              appCount={appCounts[selectedVps.id] ?? 0}
              activeTab={activePanelTab}
              onTabChange={setActivePanelTab}
              onRefreshResources={() => void refreshResources([selectedVps.id])}
              onCheckConnection={() => openEdit(selectedVps)}
              onEdit={() => openEdit(selectedVps)}
              onDelete={() => deleteVps(selectedVps)}
              onDockerInstalled={() => void load()}
            />
          </>
        )
      )}

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
