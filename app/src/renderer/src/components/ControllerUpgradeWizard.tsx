import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Empty,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography
} from 'antd'
import type { IpcResult } from '@shared/ipc'
import type {
  ControllerUpgradeOverview,
  ControllerUpgradeReview,
  ControllerUpgradeBindingReview,
  ControllerUpgradeSendInput
} from '@shared/controllerUpgrade'
import { useUiState } from '../store/uiState'
import { CONTROLLER_UPGRADE_COPY } from './controllerUpgradeCopy'

async function checked<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const r = await promise
  if (!r?.ok) throw Error('UPGRADE_UNAVAILABLE')
  return r.data
}
export function ControllerUpgradeWizard({
  open,
  onClose,
  onChanged
}: {
  open: boolean
  onClose: () => void
  onChanged: () => void
}): React.JSX.Element {
  const locale = useUiState((v) => v.locale),
    t = CONTROLLER_UPGRADE_COPY[locale]
  const [data, setData] = useState<ControllerUpgradeOverview | null>(null),
    [installation, setInstallation] = useState<string>(),
    [release, setRelease] = useState<string>(),
    [review, setReview] = useState<ControllerUpgradeReview | null>(null),
    [bindingReview, setBindingReview] = useState<ControllerUpgradeBindingReview | null>(null),
    [bindingId, setBindingId] = useState<string>(),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [now, setNow] = useState(Date.now)
  const generation = useRef(0),
    lock = useRef(false)
  const invalidate = useCallback(() => {
    ++generation.current
    lock.current = false
  }, [])
  useEffect(() => {
    if (!open) return
    const id = ++generation.current
    lock.current = true
    queueMicrotask(() => {
      if (generation.current !== id) return
      setData(null)
      setReview(null)
      setBindingReview(null)
      setConsent(false)
      setError(false)
      setBusy(true)
      void checked(window.api.invoke('controller:upgrade-overview'))
        .then((value) => {
          if (generation.current === id) {
            setData(value)
            setInstallation(value.installations.find((i) => i.state === 'installed')?.request_key)
            setRelease(value.releases.find((r) => r.state === 'available')?.release_id)
            setBindingId(undefined)
          }
        })
        .catch(() => {
          if (generation.current === id) setError(true)
        })
        .finally(() => {
          if (generation.current === id) {
            lock.current = false
            setBusy(false)
          }
        })
    })
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      invalidate()
      clearInterval(timer)
    }
  }, [open, invalidate])
  const selected = data?.installations.find((i) => i.request_key === installation)
  const transaction = data
    ? [...data.upgrades]
        .reverse()
        .find((r) => r.installation_request_key === installation && r.state !== 'cancelled')
    : undefined
  const connections =
    data?.connections.filter(
      (c) => c.installation?.request_key === installation && c.state === 'active'
    ) ?? []
  const binding =
    connections.find((c) => c.binding_id === bindingId) ??
    (connections.length === 1 ? connections[0] : undefined)
  const writable = consent && !busy
  const run = async (action: (id: number) => Promise<void>): Promise<void> => {
    if (lock.current) return
    const id = generation.current
    lock.current = true
    setBusy(true)
    setError(false)
    try {
      await action(id)
      if (generation.current === id) {
        const latest = await checked(window.api.invoke('controller:upgrade-overview'))
        if (generation.current === id) {
          setData(latest)
          onChanged()
        }
      }
    } catch {
      if (generation.current === id) {
        setError(true)
        try {
          const latest = await checked(window.api.invoke('controller:upgrade-overview'))
          if (generation.current === id) setData(latest)
        } catch {
          /* Giữ lỗi chung, không hiện dữ liệu kỹ thuật. */
        }
      }
    } finally {
      if (generation.current === id) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  const send = (operation: ControllerUpgradeSendInput['operation']): void => {
    if (!transaction || !consent) return
    const key = transaction.request_key
    void run(async (id) => {
      await checked(
        window.api.invoke('controller:send-upgrade', { request_key: key, operation, consent: true })
      )
      if (id === generation.current) setBindingReview(null)
    })
  }
  const change = (): void => {
    ++generation.current
    setReview(null)
    setBindingReview(null)
    setBindingId(undefined)
    setConsent(false)
    setError(false)
  }
  return (
    <Modal
      title={t.title}
      open={open}
      onCancel={() => {
        if (!lock.current) onClose()
      }}
      closable={!busy}
      maskClosable={!busy}
      destroyOnHidden
      footer={
        <Button onClick={onClose} disabled={busy}>
          {t.close}
        </Button>
      }
      width={760}
      style={{ top: 32 }}
      styles={{ body: { maxHeight: 'calc(100vh - 190px)', overflowY: 'auto' } }}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph>{t.intro}</Typography.Paragraph>
        <Alert type="warning" showIcon message={t.warning} />
        {error && <Alert type="error" showIcon message={t.error} />}
        {busy && <Spin />}
        {data && (
          <>
            {(!data.installations.length ||
              !data.releases.some((r) => r.state === 'available')) && (
              <Empty description={t.unavailable} />
            )}
            <Typography.Text>{t.installation}</Typography.Text>
            <Select
              aria-label={t.installation}
              style={{ width: '100%' }}
              value={installation}
              disabled={busy}
              onChange={(id) => {
                change()
                setInstallation(id)
              }}
              options={data.installations
                .filter((i) => i.state !== 'cancelled')
                .map((i) => ({
                  value: i.request_key,
                  label: `${i.controller_id ?? i.request_key} · VPS #${i.vps_id}`
                }))}
            />
            <Typography.Text>{t.release}</Typography.Text>
            <Select
              aria-label={t.release}
              style={{ width: '100%' }}
              value={release}
              disabled={busy}
              onChange={(id) => {
                setReview(null)
                setRelease(id)
              }}
              options={data.releases.map((r) => ({
                value: r.release_id,
                label: r.release_id,
                disabled: r.state !== 'available'
              }))}
            />
            <Checkbox
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            >
              {t.consent}
            </Checkbox>
            <Space wrap>
              <Button
                disabled={
                  busy ||
                  !selected ||
                  !release ||
                  !!(transaction && !['active', 'rolled_back'].includes(transaction.state))
                }
                onClick={() =>
                  void run(async () => {
                    const id = generation.current
                    const result = await checked(
                      window.api.invoke('controller:review-upgrade', {
                        installation_request_key: installation!,
                        release_id: release!
                      })
                    )
                    if (id === generation.current) setReview(result)
                  })
                }
              >
                {t.review}
              </Button>
              <Button disabled={busy} onClick={() => void run(async () => {})}>
                {t.refresh}
              </Button>
              {review && (
                <Button
                  type="primary"
                  disabled={!writable || Date.parse(review.expires_at) <= now}
                  onClick={() =>
                    void run(async (id) => {
                      await checked(
                        window.api.invoke('controller:prepare-upgrade', { plan_id: review.plan_id })
                      )
                      if (id === generation.current) setReview(null)
                    })
                  }
                >
                  {t.prepare}
                </Button>
              )}
            </Space>
            {review && (
              <Descriptions
                column={1}
                size="small"
                items={[
                  { key: 'host', label: t.checked, children: review.host },
                  { key: 'release', label: t.release, children: review.release_id }
                ]}
              />
            )}
            {transaction && (
              <>
                <Space wrap>
                  <Tag
                    color={
                      transaction.is_current &&
                      transaction.state === 'active' &&
                      Math.abs(now - Date.parse(transaction.updated_at)) < 60000
                        ? 'success'
                        : transaction.state === 'outcome_unknown'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {t[transaction.state]}
                  </Tag>
                  {!transaction.is_current && transaction.state === 'active' && (
                    <Tag>{t.historical}</Tag>
                  )}
                  {transaction.last_result && (
                    <Typography.Text>
                      {t.runtime}: {t[transaction.last_result.service_state]} ·{' '}
                      {new Date(transaction.updated_at).toLocaleString()}
                    </Typography.Text>
                  )}
                </Space>
                {transaction.state === 'outcome_unknown' && (
                  <Alert type="warning" showIcon message={t.unknown} />
                )}
                <Space wrap>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async (id) => {
                        await checked(
                          window.api.invoke('controller:inspect-upgrade', transaction.request_key)
                        )
                        if (id === generation.current) setBindingReview(null)
                      })
                    }
                  >
                    {t.inspect}
                  </Button>
                  {['prepared', 'transferred', 'outcome_unknown'].includes(transaction.state) && (
                    <Button disabled={!writable} onClick={() => send('transfer')}>
                      {t.transfer}
                    </Button>
                  )}
                  {transaction.state === 'transferred' && (
                    <Button type="primary" disabled={!writable} onClick={() => send('upgrade')}>
                      {t.upgrade}
                    </Button>
                  )}
                  {transaction.state === 'outcome_unknown' && (
                    <Button disabled={!writable} onClick={() => send('recover')}>
                      {t.recover}
                    </Button>
                  )}
                  {['active', 'outcome_unknown'].includes(transaction.state) && (
                    <Button danger disabled={!writable} onClick={() => send('rollback')}>
                      {t.rollback}
                    </Button>
                  )}
                  {transaction.state === 'prepared' && (
                    <Button
                      disabled={!writable}
                      onClick={() =>
                        void run(async () => {
                          await checked(
                            window.api.invoke('controller:cancel-upgrade', transaction.request_key)
                          )
                        })
                      }
                    >
                      {t.cancel}
                    </Button>
                  )}
                </Space>
                {transaction.is_current &&
                  ['active', 'rolled_back'].includes(transaction.state) && (
                    <>
                      <Typography.Paragraph>{t.bindingNote}</Typography.Paragraph>
                      {connections.length > 0 && (
                        <Select
                          aria-label={t.binding}
                          value={binding?.binding_id}
                          disabled={busy}
                          style={{ width: '100%' }}
                          onChange={(value) => {
                            setBindingId(value)
                            setBindingReview(null)
                          }}
                          options={connections.map((c) => ({
                            value: c.binding_id,
                            label: c.display_name
                          }))}
                        />
                      )}
                      <Space wrap>
                        <Button
                          disabled={busy || !binding}
                          onClick={() =>
                            void run(async () => {
                              const id = generation.current
                              const result = await checked(
                                window.api.invoke('controller:review-upgrade-binding', {
                                  binding_id: binding!.binding_id,
                                  request_key: transaction.request_key
                                })
                              )
                              if (id === generation.current) setBindingReview(result)
                            })
                          }
                        >
                          {t.bindingReview}
                        </Button>
                        {bindingReview && (
                          <Button
                            type="primary"
                            disabled={!writable || Date.parse(bindingReview.expires_at) <= now}
                            onClick={() =>
                              void run(async (id) => {
                                await checked(
                                  window.api.invoke('controller:refresh-upgrade-binding', {
                                    plan_id: bindingReview.plan_id,
                                    consent: true
                                  })
                                )
                                if (id === generation.current) setBindingReview(null)
                              })
                            }
                          >
                            {t.bindingConfirm}
                          </Button>
                        )}
                      </Space>
                    </>
                  )}
              </>
            )}
          </>
        )}
      </Space>
    </Modal>
  )
}
