import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Space, Typography } from 'antd'
import type { VpsRuntimePreparation } from '@shared/ipc'
import { useUiState } from '../store/uiState'

import { VPS_PREPARATION_COPY } from './vpsPreparationCopy'

export function VpsPreparationPanel({
  vpsId,
  onPrepared
}: {
  vpsId: number
  onPrepared: () => void
}): React.JSX.Element {
  const locale = useUiState((s) => s.locale),
    t = VPS_PREPARATION_COPY[locale]
  const [state, setState] = useState<{
    vpsId: number
    phase: 'busy' | 'ready' | 'error'
    result?: VpsRuntimePreparation
    error?: string
  } | null>(null)
  const epoch = useRef(0),
    pending = useRef<number | null>(null)
  useEffect(() => {
    const scope = epoch
    epoch.current++
    pending.current = null
    return () => {
      scope.current++
    }
  }, [vpsId])
  const current = state?.vpsId === vpsId ? state : null
  const prepare = async (): Promise<void> => {
    if (pending.current !== null) return
    const token = ++epoch.current
    pending.current = token
    setState({ vpsId, phase: 'busy' })
    try {
      const response = await window.api.invoke('vps:prepare-runtime', {
        vps_id: vpsId,
        consent: true
      })
      if (epoch.current !== token) return
      if (response.ok) {
        setState({ vpsId, phase: 'ready', result: response.data })
        onPrepared()
      } else setState({ vpsId, phase: 'error', error: response.error.message || t.failed })
    } catch {
      if (epoch.current === token) setState({ vpsId, phase: 'error', error: t.failed })
    } finally {
      if (pending.current === token) pending.current = null
    }
  }
  return (
    <Card size="small" title={t.title} style={{ marginTop: 12 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary">{t.note}</Typography.Text>
        {current?.phase === 'ready' && (
          <Alert
            type="success"
            showIcon
            message={t.ready}
            description={`Docker ${current.result?.docker_version} · Compose ${current.result?.compose_version}`}
          />
        )}
        {current?.phase === 'error' && <Alert type="error" showIcon message={current.error} />}
        <Button
          type={current?.phase === 'ready' ? 'default' : 'primary'}
          loading={current?.phase === 'busy'}
          onClick={() => void prepare()}
        >
          {current?.phase === 'busy' ? t.busy : current?.phase === 'error' ? t.retry : t.action}
        </Button>
      </Space>
    </Card>
  )
}
