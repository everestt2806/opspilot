import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircleOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Modal,
  Space,
  Spin,
  Steps,
  Tag,
  Typography
} from 'antd'
import type { SharedIngressAction, SharedIngressBindingDto } from '@shared/ipc'
import { useUiState } from '../store/uiState'
import { useStrings } from '../strings'

type Locale = 'en' | 'vi' | 'cn' | 'jp'
const COPY = {
  en: {
    tab: 'Domain & HTTPS',
    recorded: 'Recorded status. Reading this page does not run a live check.',
    loading: 'Loading domain status…',
    error: 'Could not load domain status.',
    empty: 'No shared domain is configured for this app.',
    emptyHint: 'Add a domain from Deploy Wizard after a successful deployment.',
    disabled: 'This domain is disabled.',
    hostname: 'Hostname',
    dns: 'DNS',
    route: 'Route',
    cert: 'Certificate',
    probe: 'HTTPS check',
    refresh: 'Reload status',
    setup: 'Set up HTTPS',
    again: 'Check HTTPS again',
    http: 'Current HTTP address',
    openHttp: 'Open HTTP',
    openHttps: 'Open HTTPS',
    reason: 'Reason and next step',
    generic: 'Resolve the recorded prerequisite before trying again.',
    uncertain:
      'The previous operation may have completed. Check VPS status before retrying a write action.',
    confirmTitle: 'Set up HTTPS?',
    confirmBody:
      'OpsPilot will prepare ingress, apply routes, and check HTTPS. The app keeps its current HTTP address if HTTPS is not ready.',
    confirm: 'Continue',
    cancel: 'Cancel',
    install: 'Install / verify Caddy',
    reconcile: 'Apply shared routes',
    check: 'External HTTPS check',
    stopped: 'Stopped here. Resolve the reason before retrying.',
    working: 'In progress',
    ready: 'Complete',
    actionError: 'Action failed. Review the recorded status before retrying.',
    statuses: {
      ready: 'Ready to configure',
      installed: 'Installed; not serving yet',
      reconciled_pending: 'Routes applied; HTTPS pending',
      active: 'HTTPS active',
      pending: 'Pending',
      degraded: 'Needs attention',
      blocked: 'Blocked',
      uncertain: 'Outcome needs checking'
    },
    values: {
      propagated: 'Propagated',
      pending: 'Pending',
      wrong_target: 'Wrong target',
      nxdomain: 'Not found',
      error: 'Check failed',
      active: 'Active',
      failed: 'Failed',
      conflict: 'Conflict',
      disabled: 'Disabled',
      not_run: 'Not checked',
      valid: 'Valid',
      expired: 'Expired',
      passed: 'Passed'
    }
  },
  vi: {
    tab: 'Tên miền & HTTPS',
    recorded: 'Trạng thái đã ghi nhận; đọc trang này không chạy kiểm tra trực tiếp.',
    loading: 'Đang tải trạng thái tên miền…',
    error: 'Không thể tải trạng thái tên miền.',
    empty: 'Ứng dụng chưa có tên miền dùng ingress chung.',
    emptyHint: 'Thêm tên miền trong Deploy Wizard sau khi triển khai thành công.',
    disabled: 'Tên miền này đã bị tắt.',
    hostname: 'Tên miền',
    dns: 'DNS',
    route: 'Định tuyến',
    cert: 'Chứng chỉ',
    probe: 'Kiểm tra HTTPS',
    refresh: 'Tải lại trạng thái',
    setup: 'Thiết lập HTTPS',
    again: 'Kiểm tra HTTPS lại',
    http: 'Địa chỉ HTTP hiện tại',
    openHttp: 'Mở HTTP',
    openHttps: 'Mở HTTPS',
    reason: 'Nguyên nhân và hướng xử lý',
    generic: 'Xử lý điều kiện đã ghi nhận trước khi thử lại.',
    uncertain:
      'Thao tác trước có thể đã hoàn tất. Hãy kiểm tra trạng thái VPS trước khi thử thao tác ghi lại.',
    confirmTitle: 'Thiết lập HTTPS?',
    confirmBody:
      'OpsPilot sẽ chuẩn bị ingress, áp dụng tuyến và kiểm tra HTTPS. Ứng dụng vẫn giữ địa chỉ HTTP hiện tại nếu HTTPS chưa sẵn sàng.',
    confirm: 'Tiếp tục',
    cancel: 'Hủy',
    install: 'Cài đặt / xác minh Caddy',
    reconcile: 'Áp dụng tuyến ingress',
    check: 'Kiểm tra HTTPS bên ngoài',
    stopped: 'Đã dừng tại đây. Xử lý nguyên nhân trước khi thử lại.',
    working: 'Đang xử lý',
    ready: 'Hoàn tất',
    actionError: 'Thao tác thất bại. Hãy xem trạng thái đã ghi nhận trước khi thử lại.',
    statuses: {
      ready: 'Sẵn sàng cấu hình',
      installed: 'Đã cài; chưa phục vụ',
      reconciled_pending: 'Đã áp dụng tuyến; HTTPS đang chờ',
      active: 'HTTPS đang hoạt động',
      pending: 'Đang chờ',
      degraded: 'Cần xử lý',
      blocked: 'Bị chặn',
      uncertain: 'Cần kiểm tra kết quả'
    },
    values: {
      propagated: 'Đã lan truyền',
      pending: 'Đang chờ',
      wrong_target: 'Sai đích',
      nxdomain: 'Không tìm thấy',
      error: 'Kiểm tra thất bại',
      active: 'Hoạt động',
      failed: 'Thất bại',
      conflict: 'Xung đột',
      disabled: 'Đã tắt',
      not_run: 'Chưa kiểm tra',
      valid: 'Hợp lệ',
      expired: 'Hết hạn',
      passed: 'Đạt'
    }
  },
  cn: {
    tab: '域名与 HTTPS',
    recorded: '已记录的状态；读取此页面不会进行实时检查。',
    loading: '正在加载域名状态…',
    error: '无法加载域名状态。',
    empty: '此应用尚未配置共享入口域名。',
    emptyHint: '成功部署后，请在部署向导中添加域名。',
    disabled: '此域名已停用。',
    hostname: '主机名',
    dns: 'DNS',
    route: '路由',
    cert: '证书',
    probe: 'HTTPS 检查',
    refresh: '刷新状态',
    setup: '设置 HTTPS',
    again: '重新检查 HTTPS',
    http: '当前 HTTP 地址',
    openHttp: '打开 HTTP',
    openHttps: '打开 HTTPS',
    reason: '原因和处理方式',
    generic: '请先解决已记录的前置条件再重试。',
    uncertain: '上一步操作可能已完成。再次执行写入操作前，请先检查 VPS 状态。',
    confirmTitle: '设置 HTTPS？',
    confirmBody:
      'OpsPilot 将准备共享入口、同步路由并检查 HTTPS。HTTPS 未就绪时，应用仍使用当前 HTTP 地址。',
    confirm: '继续',
    cancel: '取消',
    install: '安装 / 验证 Caddy',
    reconcile: '应用共享路由',
    check: '从外部检查 HTTPS',
    stopped: '已在此处停止；解决原因后再重试。',
    working: '处理中',
    ready: '完成',
    actionError: '操作失败。重试前请检查已记录状态。',
    statuses: {
      ready: '可配置',
      installed: '已安装；尚未服务',
      reconciled_pending: '路由已应用；HTTPS 等待中',
      active: 'HTTPS 已启用',
      pending: '等待中',
      degraded: '需要处理',
      blocked: '已阻止',
      uncertain: '需要确认结果'
    },
    values: {
      propagated: '已传播',
      pending: '等待中',
      wrong_target: '目标错误',
      nxdomain: '未找到',
      error: '检查失败',
      active: '启用',
      failed: '失败',
      conflict: '冲突',
      disabled: '已停用',
      not_run: '未检查',
      valid: '有效',
      expired: '已过期',
      passed: '通过'
    }
  },
  jp: {
    tab: 'ドメインと HTTPS',
    recorded: '記録済みの状態です。このページの表示ではライブ確認を行いません。',
    loading: 'ドメイン状態を読み込み中…',
    error: 'ドメイン状態を読み込めませんでした。',
    empty: 'このアプリには共有 ingress のドメインがありません。',
    emptyHint: 'デプロイ成功後、Deploy Wizard でドメインを追加してください。',
    disabled: 'このドメインは無効です。',
    hostname: 'ホスト名',
    dns: 'DNS',
    route: 'ルート',
    cert: '証明書',
    probe: 'HTTPS チェック',
    refresh: '状態を再読み込み',
    setup: 'HTTPS を設定',
    again: 'HTTPS を再確認',
    http: '現在の HTTP アドレス',
    openHttp: 'HTTP を開く',
    openHttps: 'HTTPS を開く',
    reason: '理由と対処方法',
    generic: '記録された前提条件を解決してから再試行してください。',
    uncertain:
      '前の操作は完了している可能性があります。書き込み操作を再試行する前に VPS の状態を確認してください。',
    confirmTitle: 'HTTPS を設定しますか？',
    confirmBody:
      'OpsPilot は共有 ingress を準備し、ルートを反映して HTTPS を確認します。HTTPS の準備ができない場合も、アプリは現在の HTTP アドレスを維持します。',
    confirm: '続行',
    cancel: 'キャンセル',
    install: 'Caddy をインストール / 検証',
    reconcile: '共有ルートを反映',
    check: '外部から HTTPS を確認',
    stopped: 'ここで停止しました。理由を解決してから再試行してください。',
    working: '処理中',
    ready: '完了',
    actionError: '操作に失敗しました。再試行前に記録状態を確認してください。',
    statuses: {
      ready: '設定可能',
      installed: 'インストール済み・未稼働',
      reconciled_pending: 'ルート反映済み・HTTPS 待機中',
      active: 'HTTPS 有効',
      pending: '保留中',
      degraded: '要対応',
      blocked: 'ブロック',
      uncertain: '結果確認が必要'
    },
    values: {
      propagated: '伝播済み',
      pending: '保留中',
      wrong_target: '接続先不一致',
      nxdomain: '見つかりません',
      error: '確認失敗',
      active: '有効',
      failed: '失敗',
      conflict: '競合',
      disabled: '無効',
      not_run: '未確認',
      valid: '有効',
      expired: '期限切れ',
      passed: '合格'
    }
  }
} as const

const actions: SharedIngressAction[] = ['install', 'reconcile', 'https_check']
type StepState = 'wait' | 'process' | 'finish' | 'error'

export function SharedIngressTab({
  vpsId,
  appId,
  httpUrl,
  active
}: {
  vpsId: number
  appId: number
  httpUrl: string
  active: boolean
}): React.JSX.Element {
  const locale = useUiState((state) => state.locale) as Locale
  const c = COPY[locale] ?? COPY.en
  const strings = useStrings()
  const current = useRef(0)
  const busyRef = useRef(false)
  const scope = `${vpsId}:${appId}:${active ? 'active' : 'inactive'}`
  const [loadedScope, setLoadedScope] = useState('')
  const [items, setItems] = useState<SharedIngressBindingDto[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(-1)
  const [stepStates, setStepStates] = useState<StepState[]>(['wait', 'wait', 'wait'])
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState(false)
  const [confirmBinding, setConfirmBinding] = useState<SharedIngressBindingDto | null>(null)

  const valid = (token: number): boolean => current.current === token
  const readList = useCallback(
    async (token: number): Promise<SharedIngressBindingDto[] | null> => {
      setLoading(true)
      setLoadError(false)
      try {
        const result = await window.api.invoke('domain:ingress-list', {
          vps_id: vpsId,
          app_id: appId
        })
        if (!valid(token)) return null
        if (!result.ok) throw new Error('ipc')
        setItems(result.data)
        setLoadedScope(scope)
        return result.data
      } catch {
        if (valid(token)) setLoadError(true)
        return null
      } finally {
        if (valid(token)) setLoading(false)
      }
    },
    [appId, scope, vpsId]
  )

  useEffect(() => {
    const token = ++current.current
    if (active)
      queueMicrotask(() => {
        if (valid(token)) void readList(token)
      })
    return () => {
      current.current = token + 1
    }
  }, [active, readList])

  const readStatus = async (token: number, bindingId: number): Promise<void> => {
    try {
      const result = await window.api.invoke('domain:ingress-status', {
        vps_id: vpsId,
        binding_id: bindingId
      })
      if (valid(token) && result.ok)
        setItems((old) => old.map((item) => (item.binding_id === bindingId ? result.data : item)))
    } catch {
      // Keep the last recorded list state visible; the next explicit refresh can retry the DB read.
    }
  }
  const refresh = async (token: number = current.current): Promise<void> => {
    const fresh = await readList(token)
    if (fresh)
      for (const item of fresh) {
        if (!valid(token)) return
        await readStatus(token, item.binding_id)
      }
  }
  const invokeAction = async (
    token: number,
    bindingId: number,
    action: SharedIngressAction
  ): Promise<SharedIngressBindingDto | null> => {
    const result = await window.api.invoke('domain:ingress-action', {
      vps_id: vpsId,
      binding_id: bindingId,
      action
    })
    if (!valid(token)) return null
    if (!result.ok) throw new Error('ipc')
    setItems((old) => old.map((item) => (item.binding_id === bindingId ? result.data : item)))
    return result.data
  }
  const runAction = async (binding: SharedIngressBindingDto, setup: boolean): Promise<void> => {
    if (busyRef.current || !active) return
    busyRef.current = true
    setBusy(true)
    setActionNotice(null)
    setActionError(false)
    const token = current.current
    const sequence = setup ? actions : ['https_check' as const]
    const offset = setup ? 0 : 2
    try {
      for (let i = 0; i < sequence.length; i++) {
        if (!valid(token)) return
        const action = sequence[i]
        const step = offset + i
        setProgress(step)
        setStepStates((old) => old.map((state, index) => (index === step ? 'process' : state)))
        const result = await invokeAction(token, binding.binding_id, action)
        if (!result || !valid(token)) return
        setStepStates((old) => old.map((state, index) => (index === step ? 'finish' : state)))
        const allowedIntermediate = action === 'reconcile' && result.status === 'reconciled_pending'
        const allowedInstall =
          action === 'install' && ['installed', 'ready'].includes(result.status)
        if (
          result.status === 'uncertain' ||
          result.status === 'blocked' ||
          result.status === 'degraded' ||
          (result.status === 'pending' && !allowedIntermediate) ||
          (action === 'install' && !allowedInstall) ||
          (action === 'reconcile' && !allowedIntermediate && result.status !== 'ready')
        ) {
          setStepStates((old) => old.map((state, index) => (index === step ? 'error' : state)))
          setActionError(true)
          setActionNotice(
            result.reason?.code.includes('UNCERTAIN')
              ? c.uncertain
              : result.reason
                ? `${result.reason.code}: ${c.generic}`
                : c.stopped
          )
          await refresh(token)
          return
        }
        if (action === 'https_check' && result.status !== 'active') {
          setActionError(true)
          setActionNotice(
            result.reason?.code.includes('UNCERTAIN')
              ? c.uncertain
              : result.reason
                ? `${result.reason.code}: ${c.generic}`
                : c.stopped
          )
          await refresh(token)
          return
        }
      }
      setActionNotice(c.ready)
      await refresh(token)
    } catch {
      if (valid(token)) {
        setActionError(true)
        setActionNotice(c.actionError)
        await refresh(token)
      }
    } finally {
      if (valid(token)) {
        busyRef.current = false
        setBusy(false)
        setProgress(-1)
      }
    }
  }

  const confirmSetup = (binding: SharedIngressBindingDto): void => setConfirmBinding(binding)
  const visible = loadedScope === scope
  const renderValue = (value: string): string =>
    c.values[value as keyof typeof c.values] ?? value.replaceAll('_', ' ')
  const secureActive = (binding: SharedIngressBindingDto): boolean =>
    binding.status === 'active' &&
    binding.dns_status === 'propagated' &&
    binding.route_status === 'active' &&
    binding.certificate_status === 'valid' &&
    binding.https_probe_status === 'passed'
  const httpFallback = (binding: SharedIngressBindingDto): string | null => {
    const candidate = binding.http_url ?? httpUrl
    return candidate.startsWith('http://') ? candidate : binding.http_url
  }

  if (!active) return <div className="apps-tab-content" />
  return (
    <div className="apps-tab-content" style={{ width: '100%' }}>
      <div className="apps-section-heading">
        <div>
          <h3>{c.tab}</h3>
        </div>
        <span className="apps-section-note">{c.recorded}</span>
      </div>
      {!visible && loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : null}
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={c.error}
          action={
            <Button size="small" onClick={() => void refresh()}>
              {strings.common.retry}
            </Button>
          }
        />
      )}
      {visible && !loading && !loadError && items.length === 0 && (
        <Empty
          description={
            <>
              <div>{c.empty}</div>
              <Typography.Text type="secondary">{c.emptyHint}</Typography.Text>
            </>
          }
        />
      )}
      {visible &&
        items.map((binding) => (
          <Card
            key={binding.binding_id}
            style={{ marginBottom: 16 }}
            title={
              <Space>
                <SafetyCertificateOutlined />
                {binding.hostname}
              </Space>
            }
            extra={
              <Tag
                color={
                  binding.status === 'active'
                    ? 'success'
                    : binding.status === 'degraded'
                      ? 'warning'
                      : binding.status === 'blocked'
                        ? 'error'
                        : 'default'
                }
              >
                {c.statuses[binding.status]}
              </Tag>
            }
          >
            <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} bordered>
              <Descriptions.Item label={c.hostname}>{binding.hostname}</Descriptions.Item>
              <Descriptions.Item label={c.dns}>{renderValue(binding.dns_status)}</Descriptions.Item>
              <Descriptions.Item label={c.route}>
                {renderValue(binding.route_status)}
              </Descriptions.Item>
              <Descriptions.Item label={c.cert}>
                {renderValue(binding.certificate_status)}
              </Descriptions.Item>
              <Descriptions.Item label={c.probe}>
                {renderValue(binding.https_probe_status)}
              </Descriptions.Item>
            </Descriptions>
            {(binding.route_status === 'disabled' || binding.reason) && (
              <Alert
                style={{ marginTop: 12 }}
                type={binding.route_status === 'disabled' ? 'info' : 'warning'}
                showIcon
                message={binding.route_status === 'disabled' ? c.disabled : c.reason}
                description={
                  binding.reason ? (
                    <>
                      {binding.reason.code}:{' '}
                      {binding.status === 'uncertain' ? c.uncertain : c.generic}
                    </>
                  ) : undefined
                }
              />
            )}
            {httpFallback(binding) && (
              <div style={{ marginTop: 16 }}>
                <Typography.Text type="secondary">{c.http}: </Typography.Text>
                <Button
                  type="link"
                  style={{ paddingInline: 4 }}
                  onClick={() =>
                    void window.api.invoke('system:open-external', httpFallback(binding)!)
                  }
                >
                  {httpFallback(binding)}
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    void window.api.invoke('system:open-external', httpFallback(binding)!)
                  }
                >
                  {c.openHttp}
                </Button>
              </div>
            )}
            {secureActive(binding) && (
              <Button
                type="link"
                icon={<CheckCircleOutlined />}
                onClick={() =>
                  void window.api.invoke('system:open-external', `https://${binding.hostname}`)
                }
              >
                {c.openHttps}
              </Button>
            )}
            {actionNotice && (
              <Alert
                style={{ marginTop: 12 }}
                type={actionError ? 'warning' : 'success'}
                showIcon
                message={actionNotice}
              />
            )}
            {busy && (
              <Steps
                size="small"
                style={{ marginTop: 16 }}
                current={Math.max(0, progress)}
                items={[
                  { title: c.install, status: stepStates[0] },
                  { title: c.reconcile, status: stepStates[1] },
                  { title: c.check, status: stepStates[2] }
                ]}
              />
            )}
            <Space style={{ marginTop: 16 }} wrap>
              <Button icon={<ReloadOutlined />} disabled={busy} onClick={() => void refresh()}>
                {c.refresh}
              </Button>
              {binding.status !== 'active' &&
                binding.status !== 'uncertain' &&
                binding.status !== 'blocked' &&
                binding.status !== 'degraded' &&
                binding.status !== 'pending' && (
                  <Button
                    type="primary"
                    loading={busy}
                    disabled={busy}
                    onClick={() => confirmSetup(binding)}
                  >
                    {c.setup}
                  </Button>
                )}
              {binding.status !== 'active' &&
                binding.retryable &&
                binding.status !== 'uncertain' &&
                binding.route_status !== 'disabled' && (
                  <Button
                    loading={busy}
                    disabled={busy}
                    onClick={() => void runAction(binding, false)}
                  >
                    {c.again}
                  </Button>
                )}
              {binding.status === 'active' && (
                <Button
                  loading={busy}
                  disabled={busy}
                  onClick={() => void runAction(binding, false)}
                >
                  {c.again}
                </Button>
              )}
            </Space>
          </Card>
        ))}
      <Modal
        open={confirmBinding !== null}
        title={c.confirmTitle}
        okText={c.confirm}
        cancelText={c.cancel}
        onCancel={() => setConfirmBinding(null)}
        onOk={() => {
          const target = confirmBinding
          setConfirmBinding(null)
          if (target) void runAction(target, true)
        }}
      >
        <Typography.Paragraph>{c.confirmBody}</Typography.Paragraph>
      </Modal>
    </div>
  )
}
