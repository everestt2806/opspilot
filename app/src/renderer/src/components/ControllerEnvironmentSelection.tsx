import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Descriptions, Space, Tag, Typography } from 'antd'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopProjectSetup } from '@shared/desktopProjectRegistration'
import type {
  DesktopEnvironmentContext,
  DesktopEnvironmentSelectionIntent
} from '@shared/desktopProductEnvironment'
import { useUiState } from '../store/uiState'
const copy = {
  en: {
    title: 'Configuration for the next deployment',
    selected: 'Selected revision',
    none: 'No configuration selected',
    note: 'The selected revision will be used when you deploy again. The running application stays unchanged.',
    choose: 'Prepare selection of latest revision',
    consent:
      'I confirm this configuration will be used for the next deployment. This does not deploy or enable automatic deployment.',
    send: 'Confirm selection',
    retry: 'Retry same selection',
    check: 'Check result',
    cancel: 'Cancel request',
    unknown: 'The result is unknown. Check it or retry the same request.',
    paused: 'Pause automatic deployment before selecting a configuration.',
    failure: 'Could not verify configuration selection. Refresh or check the original request.',
    prepared: 'Prepared',
    in_flight: 'Sending',
    outcome_unknown: 'Result unknown',
    not_applied: 'Not applied — configuration changed',
    selectedState: 'Selected',
    cancelled: 'Cancelled'
  },
  vi: {
    title: 'Cấu hình cho lần triển khai tiếp',
    selected: 'Revision đã chọn',
    none: 'Chưa chọn cấu hình',
    note: 'Revision đã chọn sẽ được dùng khi bạn triển khai lại. Ứng dụng đang chạy giữ nguyên.',
    choose: 'Chuẩn bị chọn revision mới nhất',
    consent:
      'Tôi xác nhận dùng cấu hình này cho lần triển khai tiếp. Thao tác này không triển khai hoặc bật tự động triển khai.',
    send: 'Xác nhận chọn',
    retry: 'Gửi lại đúng yêu cầu',
    check: 'Kiểm tra kết quả',
    cancel: 'Hủy yêu cầu',
    unknown: 'Chưa rõ kết quả. Kiểm tra hoặc gửi lại đúng yêu cầu này.',
    paused: 'Tạm dừng tự động triển khai trước khi chọn cấu hình.',
    failure: 'Không xác minh được việc chọn cấu hình. Làm mới hoặc kiểm tra yêu cầu gốc.',
    prepared: 'Đã chuẩn bị',
    in_flight: 'Đang gửi',
    outcome_unknown: 'Chưa rõ kết quả',
    not_applied: 'Chưa áp dụng — cấu hình đã thay đổi',
    selectedState: 'Đã chọn',
    cancelled: 'Đã hủy'
  },
  jp: {
    title: '次回デプロイの設定',
    selected: '選択済みリビジョン',
    none: '設定未選択',
    note: '選択したリビジョンは次回のデプロイに使用されます。現在のアプリは変更されません。',
    choose: '最新リビジョンの選択を準備',
    consent:
      '次回デプロイにこの設定を使用します。この操作はデプロイや自動デプロイの有効化を行いません。',
    send: '選択を確定',
    retry: '同じ要求を再送',
    check: '結果を確認',
    cancel: '要求を取消',
    unknown: '結果が不明です。同じ要求を確認または再送してください。',
    paused: '設定を選択する前に自動デプロイを一時停止してください。',
    failure: '設定の選択を確認できません。更新するか元の要求を確認してください。',
    prepared: '準備済み',
    in_flight: '送信中',
    outcome_unknown: '結果不明',
    not_applied: '未適用 — 設定が変更されました',
    selectedState: '選択済み',
    cancelled: '取消済み'
  },
  cn: {
    title: '下次部署的配置',
    selected: '已选版本',
    none: '尚未选择配置',
    note: '重新部署时将使用已选版本。当前运行的应用保持不变。',
    choose: '准备选择最新版本',
    consent: '确认下次部署使用此配置。本操作不会部署或启用自动部署。',
    send: '确认选择',
    retry: '重试同一请求',
    check: '检查结果',
    cancel: '取消请求',
    unknown: '结果未知，请检查或重试同一请求。',
    paused: '选择配置前请暂停自动部署。',
    failure: '无法验证配置选择，请刷新或检查原请求。',
    prepared: '已准备',
    in_flight: '发送中',
    outcome_unknown: '结果未知',
    not_applied: '未应用 — 配置已更改',
    selectedState: '已选择',
    cancelled: '已取消'
  }
}
export const ENVIRONMENT_SELECTION_COPY = copy
type Props = {
  binding: DesktopControllerConnection
  project: DesktopProjectSetup
  context: DesktopEnvironmentContext
  stagingPending: boolean
  onChanged: () => Promise<void>
  onPendingChange?: (pending: boolean) => void
}
export function ControllerEnvironmentSelection({
  binding,
  project,
  context,
  stagingPending,
  onChanged,
  onPendingChange
}: Props): React.JSX.Element {
  const t = copy[useUiState((s) => s.locale)],
    alive = useRef(true),
    busy = useRef(false)
  const [rows, setRows] = useState<DesktopEnvironmentSelectionIntent[]>([]),
    [loading, setLoading] = useState(false),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(false),
    [loaded, setLoaded] = useState(false)
  const matches = (row: DesktopEnvironmentSelectionIntent): boolean =>
    row.project_request_key === project.request_key &&
    row.binding_id === binding.binding_id &&
    row.binding_revision === binding.revision &&
    row.controller_id === binding.controller_id &&
    row.app_id === project.app_id &&
    row.ownership_generation === context.ownership_generation
  useEffect(() => {
    alive.current = true
    void window.api
      .invoke('controller:environment-selections', project.request_key)
      .then((result) => {
        if (!alive.current) return
        if (!result.ok || !Array.isArray(result.data) || !result.data.every(matches)) {
          setError(true)
          return
        }
        setRows(result.data)
        setLoaded(true)
      })
      .catch(() => {
        if (alive.current) setError(true)
      })
    return () => {
      alive.current = false
    }
    // Session is keyed by source/binding in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const pending = rows.some((row) =>
    ['prepared', 'in_flight', 'outcome_unknown'].includes(row.state)
  )
  useEffect(() => {
    onPendingChange?.(pending)
    return () => onPendingChange?.(false)
  }, [pending, onPendingChange])
  const prepare = async (): Promise<void> => {
    if (
      busy.current ||
      !consent ||
      !context.latest ||
      stagingPending ||
      pending ||
      !context.auto_deploy_paused
    )
      return
    busy.current = true
    setLoading(true)
    setError(false)
    try {
      const result = await window.api.invoke('controller:prepare-environment-selection', {
        project_request_key: project.request_key,
        expected_binding_revision: binding.revision,
        expected_source_generation: context.source_generation,
        expected_source_config_sha256: context.source_config_sha256,
        expected_latest_revision: context.latest.revision,
        environment_revision: context.latest.revision
      })
      if (!alive.current) return
      if (!result.ok || !matches(result.data)) throw Error()
      setRows((previous) => [
        result.data,
        ...previous.filter((row) => row.request_key !== result.data.request_key)
      ])
      setConsent(false)
    } catch {
      if (alive.current) setError(true)
    } finally {
      if (alive.current) {
        busy.current = false
        setLoading(false)
      }
    }
  }
  const action = async (
    row: DesktopEnvironmentSelectionIntent,
    channel:
      | 'controller:send-environment-selection'
      | 'controller:check-environment-selection'
      | 'controller:cancel-environment-selection'
  ): Promise<void> => {
    if (busy.current || (channel === 'controller:send-environment-selection' && !consent)) return
    busy.current = true
    setLoading(true)
    setError(false)
    try {
      const result = await window.api.invoke(channel, row.request_key)
      if (!alive.current) return
      if (!result.ok || !matches(result.data) || result.data.request_key !== row.request_key)
        throw Error()
      setRows((previous) => [
        result.data,
        ...previous.filter((item) => item.request_key !== row.request_key)
      ])
      setConsent(false)
      if (result.data.state === 'selected' || result.data.state === 'not_applied') await onChanged()
    } catch {
      if (alive.current) {
        setError(true)
        if (channel === 'controller:send-environment-selection')
          setRows((previous) =>
            previous.map((item) =>
              item.request_key === row.request_key ? { ...item, state: 'outcome_unknown' } : item
            )
          )
      }
    } finally {
      if (alive.current) {
        busy.current = false
        setLoading(false)
      }
    }
  }
  return (
    <section style={{ marginTop: 16 }} aria-label={t.title}>
      <Typography.Title level={5}>{t.title}</Typography.Title>
      <Descriptions
        size="small"
        column={1}
        items={[
          {
            key: 'selected',
            label: t.selected,
            children: context.selected ? '#' + context.selected.revision : t.none
          }
        ]}
      />
      <Typography.Paragraph type="secondary">{t.note}</Typography.Paragraph>
      {!context.auto_deploy_paused && <Alert type="warning" message={t.paused} />}
      {error && <Alert type="error" showIcon message={t.failure} />}
      {rows.map((row) => (
        <div key={row.request_key} style={{ margin: '12px 0' }}>
          <Tag color={row.state === 'outcome_unknown' ? 'warning' : 'default'}>
            {row.state === 'selected' ? t.selectedState : t[row.state]}
          </Tag>
          <Typography.Text>
            #{row.environment_revision} · {row.request_key.slice(0, 8)}
          </Typography.Text>
          {row.state === 'outcome_unknown' && <Alert type="warning" message={t.unknown} />}
          {['prepared', 'in_flight', 'outcome_unknown'].includes(row.state) && (
            <Space wrap>
              <Button
                disabled={loading || !consent}
                onClick={() => void action(row, 'controller:send-environment-selection')}
              >
                {row.state === 'prepared' ? t.send : t.retry}
              </Button>
              <Button
                disabled={loading}
                onClick={() => void action(row, 'controller:check-environment-selection')}
              >
                {t.check}
              </Button>
              {row.state === 'prepared' && (
                <Button
                  disabled={loading}
                  onClick={() => void action(row, 'controller:cancel-environment-selection')}
                >
                  {t.cancel}
                </Button>
              )}
            </Space>
          )}
        </div>
      ))}
      {!pending && context.latest && context.latest.revision !== context.selected?.revision && (
        <Button
          disabled={loading || !loaded || !consent || stagingPending || !context.auto_deploy_paused}
          onClick={() => void prepare()}
        >
          {t.choose} #{context.latest.revision}
        </Button>
      )}
      <Checkbox
        style={{ display: 'block', marginTop: 12 }}
        disabled={loading}
        checked={consent}
        onChange={(event) => setConsent(event.target.checked)}
      >
        {t.consent}
      </Checkbox>
    </section>
  )
}
