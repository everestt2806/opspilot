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
    reasonDns: 'Public DNS has not been consistently confirmed for this host.',
    reasonDnsTarget: 'The recorded DNS answers do not match the expected VPS address.',
    reasonIpv6: 'An advertised IPv6 address could not be confirmed as reachable.',
    reasonFirewall: 'The recorded firewall check does not confirm the required public port.',
    reasonPort: 'A required ingress port is occupied or its owner could not be safely accepted.',
    reasonOwner: 'OpsPilot could not verify ownership of the existing ingress configuration.',
    reasonInstall: 'Caddy installation or its verification did not complete.',
    reasonCertificate: 'A valid certificate has not been confirmed for this hostname.',
    reasonProbe: 'The external HTTPS check did not confirm a healthy response.',
    reasonUpstream: 'The app health response did not meet its configured policy.',
    reasonIdentity: 'The saved VPS SSH identity could not be verified for this operation.',
    reconcileGuidance:
      'The route could not be confirmed as applied. Review the recorded status and host prerequisites, then apply the configuration again.',
    reasonTechnical: 'Recorded code',
    notConfigured: 'Not configured',
    notRequested: 'Not requested',
    unknown: 'Unknown',
    uncertain:
      'The previous operation may have completed. This screen cannot verify that the write is safe to repeat; inspect the current ingress on the VPS before trying again.',
    operationPending:
      'A previous request is still awaiting a result. Do not start another operation for this domain.',
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
      not_configured: 'Not configured',
      not_requested: 'Not requested',
      not_run: 'Not checked',
      unknown: 'Unknown',
      propagated: 'Propagated',
      pending: 'Pending',
      wrong_target: 'Wrong target',
      nxdomain: 'Not found',
      error: 'Check failed',
      active: 'Active',
      failed: 'Failed',
      conflict: 'Conflict',
      disabled: 'Disabled',
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
    reasonDns: 'DNS công khai chưa được xác nhận đồng nhất cho tên miền này.',
    reasonDnsTarget: 'Các địa chỉ DNS đã ghi nhận không khớp địa chỉ VPS dự kiến.',
    reasonIpv6: 'Chưa xác nhận được khả năng truy cập địa chỉ IPv6 đang công bố.',
    reasonFirewall: 'Kiểm tra tường lửa đã ghi nhận chưa xác nhận cổng công khai cần thiết.',
    reasonPort: 'Cổng ingress cần thiết đang bị chiếm hoặc chưa xác minh an toàn được chủ sở hữu.',
    reasonOwner: 'OpsPilot chưa xác minh được quyền sở hữu cấu hình ingress hiện có.',
    reasonInstall: 'Việc cài Caddy hoặc xác minh sau cài chưa hoàn tất.',
    reasonCertificate: 'Chưa xác nhận chứng chỉ hợp lệ cho tên miền này.',
    reasonProbe: 'Kiểm tra HTTPS từ bên ngoài chưa xác nhận phản hồi hoạt động.',
    reasonUpstream: 'Phản hồi sức khỏe của ứng dụng chưa đáp ứng chính sách đã cấu hình.',
    reasonIdentity: 'Chưa xác minh được SSH identity đã lưu của VPS cho thao tác này.',
    reconcileGuidance:
      'Chưa xác nhận được cấu hình tuyến đã được áp dụng. Hãy xem trạng thái và điều kiện máy chủ đã ghi nhận, rồi xác nhận áp dụng lại cấu hình.',
    reasonTechnical: 'Mã đã ghi nhận',
    notConfigured: 'Chưa cấu hình',
    notRequested: 'Chưa yêu cầu',
    unknown: 'Không xác định',
    uncertain:
      'Thao tác trước có thể đã hoàn tất. Màn hình này chưa thể xác minh có an toàn để ghi lại hay không; hãy kiểm tra ingress hiện tại trên VPS trước khi thử lại.',
    operationPending:
      'Yêu cầu trước vẫn đang chờ kết quả. Không bắt đầu thao tác khác cho tên miền này.',
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
      not_configured: 'Chưa cấu hình',
      not_requested: 'Chưa yêu cầu',
      not_run: 'Chưa kiểm tra',
      unknown: 'Không xác định',
      propagated: 'Đã lan truyền',
      pending: 'Đang chờ',
      wrong_target: 'Sai đích',
      nxdomain: 'Không tìm thấy',
      error: 'Kiểm tra thất bại',
      active: 'Hoạt động',
      failed: 'Thất bại',
      conflict: 'Xung đột',
      disabled: 'Đã tắt',
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
    reasonDns: '尚未确认此主机的公共 DNS 在多个解析器上一致。',
    reasonDnsTarget: '已记录的 DNS 地址与预期 VPS 地址不匹配。',
    reasonIpv6: '尚未确认已公布的 IPv6 地址可达。',
    reasonFirewall: '已记录的防火墙检查尚未确认所需公网端口可用。',
    reasonPort: '所需入口端口被占用，或无法安全确认其所有者。',
    reasonOwner: 'OpsPilot 无法验证现有入口配置的所有权。',
    reasonInstall: 'Caddy 安装或安装后验证未完成。',
    reasonCertificate: '尚未确认此主机名拥有有效证书。',
    reasonProbe: '外部 HTTPS 检查未确认响应正常。',
    reasonUpstream: '应用健康响应未满足已配置的策略。',
    reasonIdentity: '无法验证此操作所用的 VPS SSH 身份。',
    reconcileGuidance:
      '尚未确认路由配置已应用。请查看已记录的状态和主机条件，然后确认重新应用配置。',
    reasonTechnical: '已记录代码',
    notConfigured: '未配置',
    notRequested: '未请求',
    unknown: '未知',
    uncertain:
      '上一步操作可能已完成。此页面无法确认是否可以安全重试写入；请先检查 VPS 上当前的 ingress 状态。',
    operationPending: '上一个请求仍在等待结果。请勿对该域名启动另一个操作。',
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
      not_configured: '未配置',
      not_requested: '未请求',
      not_run: '未检查',
      unknown: '未知',
      propagated: '已传播',
      pending: '等待中',
      wrong_target: '目标错误',
      nxdomain: '未找到',
      error: '检查失败',
      active: '启用',
      failed: '失败',
      conflict: '冲突',
      disabled: '已停用',
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
    reasonDns: 'このホストの公開 DNS が一貫していることを確認できません。',
    reasonDnsTarget: '記録された DNS アドレスが VPS の想定アドレスと一致しません。',
    reasonIpv6: '公開されている IPv6 アドレスへの到達性を確認できません。',
    reasonFirewall: '記録されたファイアウォール確認では必要な公開ポートを確認できません。',
    reasonPort: '必要な ingress ポートが使用中か、所有者を安全に確認できません。',
    reasonOwner: '既存 ingress 設定の所有権を OpsPilot が確認できません。',
    reasonInstall: 'Caddy のインストールまたは検証が完了していません。',
    reasonCertificate: 'このホスト名の有効な証明書を確認できません。',
    reasonProbe: '外部 HTTPS チェックで正常な応答を確認できません。',
    reasonUpstream: 'アプリのヘルス応答が設定済みポリシーを満たしません。',
    reasonIdentity: 'この操作に必要な保存済み VPS SSH identity を確認できません。',
    reconcileGuidance:
      'ルート設定が適用されたことを確認できません。記録された状態とホスト条件を確認し、設定の再適用を確認してください。',
    reasonTechnical: '記録コード',
    notConfigured: '未設定',
    notRequested: '未要求',
    unknown: '不明',
    uncertain:
      '前の操作は完了している可能性があります。この画面では安全に再実行できるか確認できません。再試行前に VPS の現在の ingress を確認してください。',
    operationPending: '前の要求はまだ結果待ちです。このドメインで別の操作を開始しないでください。',
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
      not_configured: '未設定',
      not_requested: '未要求',
      not_run: '未確認',
      unknown: '不明',
      propagated: '伝播済み',
      pending: '保留中',
      wrong_target: '接続先不一致',
      nxdomain: '見つかりません',
      error: '確認失敗',
      active: '有効',
      failed: '失敗',
      conflict: '競合',
      disabled: '無効',
      valid: '有効',
      expired: '期限切れ',
      passed: '合格'
    }
  }
} as const

const actions: SharedIngressAction[] = ['install', 'reconcile', 'https_check']
type StepState = 'wait' | 'process' | 'finish' | 'error'
type ActionNotice = { bindingId: number; message: string; error: boolean }
type ConfirmAction = { binding: SharedIngressBindingDto; mode: 'setup' | 'reconcile' } | null
// An uncertain write cannot be cleared by a DB read. Persist this binding guard
// outside the component so refreshes, tab switches, and app restarts do not replay it.
const uncertainBindings = {
  has: (key: string): boolean =>
    window.localStorage.getItem(`opspilot-ingress-uncertain:${key}`) === '1',
  add: (key: string): void => window.localStorage.setItem(`opspilot-ingress-uncertain:${key}`, '1'),
  clear: (key: string): void => window.localStorage.removeItem(`opspilot-ingress-uncertain:${key}`),
  markPending: (key: string): void =>
    window.localStorage.setItem(`opspilot-ingress-pending:${key}`, '1'),
  isPending: (key: string): boolean =>
    window.localStorage.getItem(`opspilot-ingress-pending:${key}`) === '1',
  clearPending: (key: string): void =>
    window.localStorage.removeItem(`opspilot-ingress-pending:${key}`)
}

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
  const busyRef = useRef<string | null>(null)
  const scope = `${vpsId}:${appId}:${active ? 'active' : 'inactive'}`
  const [loadedScope, setLoadedScope] = useState('')
  const [items, setItems] = useState<SharedIngressBindingDto[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [busyBindingId, setBusyBindingId] = useState<number | null>(null)
  const [progress, setProgress] = useState(-1)
  const [stepStates, setStepStates] = useState<StepState[]>(['wait', 'wait', 'wait'])
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [, setGuardRevision] = useState(0)

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
    if (active) {
      queueMicrotask(() => {
        if (valid(token)) void readList(token)
      })
    } else {
      busyRef.current = null
      queueMicrotask(() => {
        if (busyRef.current !== null) return
        setBusyBindingId(null)
        setProgress(-1)
        setStepStates(['wait', 'wait', 'wait'])
        setActionNotice(null)
        setConfirmAction(null)
      })
    }
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
    if (!valid(token)) {
      const key = `${vpsId}:${bindingId}`
      if (!result.ok || result.data.status === 'uncertain') uncertainBindings.add(key)
      uncertainBindings.clearPending(key)
      // Re-render only the guard state; stale action data and notices remain ignored.
      setGuardRevision((revision) => revision + 1)
      return null
    }
    if (!result.ok) throw new Error('ipc')
    setItems((old) => old.map((item) => (item.binding_id === bindingId ? result.data : item)))
    return result.data
  }
  const runAction = async (
    binding: SharedIngressBindingDto,
    mode: 'setup' | 'reconcile' | 'https_check'
  ): Promise<void> => {
    const bindingKey = `${vpsId}:${binding.binding_id}`
    if (
      busyRef.current ||
      !active ||
      uncertainBindings.has(bindingKey) ||
      uncertainBindings.isPending(bindingKey)
    )
      return
    busyRef.current = bindingKey
    uncertainBindings.markPending(bindingKey)
    setBusyBindingId(binding.binding_id)
    setActionNotice(null)
    setProgress(-1)
    setStepStates(['wait', 'wait', 'wait'])
    const token = current.current
    const sequence = mode === 'setup' ? actions : [mode]
    const offset = mode === 'setup' ? 0 : mode === 'reconcile' ? 1 : 2
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
          const uncertain =
            result.status === 'uncertain' || result.reason?.code.includes('UNCERTAIN')
          if (uncertain) uncertainBindings.add(bindingKey)
          uncertainBindings.clearPending(bindingKey)
          setActionNotice({
            bindingId: binding.binding_id,
            error: true,
            message: uncertain ? c.uncertain : reasonGuidance(result.reason?.code, c)
          })
          await refresh(token)
          return
        }
        if (action === 'https_check' && result.status !== 'active') {
          const uncertain = result.reason?.code.includes('UNCERTAIN') ?? false
          if (uncertain) uncertainBindings.add(bindingKey)
          uncertainBindings.clearPending(bindingKey)
          setActionNotice({
            bindingId: binding.binding_id,
            error: true,
            message: uncertain ? c.uncertain : reasonGuidance(result.reason?.code, c)
          })
          await refresh(token)
          return
        }
      }
      uncertainBindings.clearPending(bindingKey)
      uncertainBindings.clear(bindingKey)
      setActionNotice({ bindingId: binding.binding_id, message: c.ready, error: false })
      await refresh(token)
    } catch {
      if (valid(token)) {
        uncertainBindings.add(bindingKey)
        uncertainBindings.clearPending(bindingKey)
        setActionNotice({ bindingId: binding.binding_id, message: c.uncertain, error: true })
        await refresh(token)
      }
    } finally {
      if (valid(token)) {
        busyRef.current = null
        setBusyBindingId(null)
        setProgress(-1)
      }
    }
  }

  const confirmSetup = (binding: SharedIngressBindingDto): void =>
    setConfirmAction({ binding, mode: 'setup' })
  const confirmReconcile = (binding: SharedIngressBindingDto): void =>
    setConfirmAction({ binding, mode: 'reconcile' })
  const isUncertain = (binding: SharedIngressBindingDto): boolean =>
    uncertainBindings.has(`${vpsId}:${binding.binding_id}`) || binding.status === 'uncertain'
  const isGuarded = (binding: SharedIngressBindingDto): boolean =>
    isUncertain(binding) || uncertainBindings.isPending(`${vpsId}:${binding.binding_id}`)
  const reasonGuidance = (code: string | undefined, copy: typeof c): string => {
    const reasonMessages: Record<string, string> = {
      DNS_NOT_PROPAGATED: copy.reasonDns,
      DNS_TARGET_MISMATCH: copy.reasonDnsTarget,
      DNS_IPV6_UNREACHABLE: copy.reasonIpv6,
      FIREWALL_80_BLOCKED: copy.reasonFirewall,
      FIREWALL_443_BLOCKED: copy.reasonFirewall,
      INGRESS_PORT_CONFLICT: copy.reasonPort,
      INGRESS_OWNER_UNKNOWN: copy.reasonOwner,
      HOST_CONFLICT: copy.reasonOwner,
      INGRESS_INSTALL_FAILED: copy.reasonInstall,
      INSTALL_PLAN_BLOCKED: copy.reasonInstall,
      INGRESS_CONFIG_INVALID: copy.reasonOwner,
      INGRESS_RELOAD_FAILED: copy.reconcileGuidance,
      INGRESS_ROLLBACK_FAILED: copy.reconcileGuidance,
      RECONCILE_BLOCKED: copy.reconcileGuidance,
      CERTIFICATE_PENDING: copy.reasonCertificate,
      CERTIFICATE_ISSUE_FAILED: copy.reasonCertificate,
      HTTPS_PROBE_FAILED: copy.reasonProbe,
      HTTPS_PENDING: copy.reasonProbe,
      HTTPS_DNS_NOT_PROPAGATED: copy.reasonDns,
      HTTPS_RUNTIME_NOT_VERIFIED: copy.reasonOwner,
      UPSTREAM_UNHEALTHY: copy.reasonUpstream,
      SSH_UNAVAILABLE: copy.reasonIdentity,
      SSH_IDENTITY_UNVERIFIED: copy.reasonIdentity,
      IDENTITY_CHANGED: copy.reasonIdentity,
      INVENTORY_CHANGED: copy.reasonOwner,
      STALE_RESULT: copy.reasonOwner
    }
    return (code && reasonMessages[code]) || copy.generic
  }
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
            {(binding.route_status === 'disabled' || binding.reason || isGuarded(binding)) && (
              <Alert
                style={{ marginTop: 12 }}
                type={binding.route_status === 'disabled' ? 'info' : 'warning'}
                showIcon
                message={binding.route_status === 'disabled' ? c.disabled : c.reason}
                description={
                  binding.route_status === 'disabled'
                    ? undefined
                    : isGuarded(binding)
                      ? uncertainBindings.isPending(`${vpsId}:${binding.binding_id}`)
                        ? c.operationPending
                        : c.uncertain
                      : binding.reason && (
                          <>
                            <div>{reasonGuidance(binding.reason.code, c)}</div>
                            <Typography.Text type="secondary">
                              {c.reasonTechnical}: {binding.reason.code}
                            </Typography.Text>
                          </>
                        )
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
            {actionNotice?.bindingId === binding.binding_id && (
              <Alert
                style={{ marginTop: 12 }}
                type={actionNotice.error ? 'warning' : 'success'}
                showIcon
                message={actionNotice.message}
              />
            )}
            {busyBindingId === binding.binding_id && (
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
              <Button
                icon={<ReloadOutlined />}
                disabled={busyBindingId !== null}
                onClick={() => void refresh()}
              >
                {c.refresh}
              </Button>
              {!isGuarded(binding) &&
                binding.status !== 'active' &&
                binding.status !== 'uncertain' &&
                binding.status !== 'blocked' &&
                binding.status !== 'degraded' &&
                binding.status !== 'pending' && (
                  <Button
                    type="primary"
                    loading={busyBindingId === binding.binding_id}
                    disabled={busyBindingId !== null}
                    onClick={() => confirmSetup(binding)}
                  >
                    {c.setup}
                  </Button>
                )}
              {!isGuarded(binding) &&
                binding.route_status !== 'disabled' &&
                (binding.status === 'pending' || binding.status === 'degraded') && (
                  <Button
                    loading={busyBindingId === binding.binding_id}
                    disabled={busyBindingId !== null}
                    onClick={() => confirmReconcile(binding)}
                  >
                    {c.reconcile}
                  </Button>
                )}
              {binding.status !== 'active' &&
                binding.retryable &&
                !isGuarded(binding) &&
                binding.route_status !== 'disabled' && (
                  <Button
                    loading={busyBindingId === binding.binding_id}
                    disabled={busyBindingId !== null}
                    onClick={() => void runAction(binding, 'https_check')}
                  >
                    {c.again}
                  </Button>
                )}
              {binding.status === 'active' && (
                <Button
                  loading={busyBindingId === binding.binding_id}
                  disabled={busyBindingId !== null || isGuarded(binding)}
                  onClick={() => void runAction(binding, 'https_check')}
                >
                  {c.again}
                </Button>
              )}
            </Space>
          </Card>
        ))}
      <Modal
        open={confirmAction !== null}
        title={confirmAction?.mode === 'reconcile' ? c.reconcile : c.confirmTitle}
        okText={c.confirm}
        cancelText={c.cancel}
        onCancel={() => setConfirmAction(null)}
        onOk={() => {
          const target = confirmAction
          setConfirmAction(null)
          if (target) void runAction(target.binding, target.mode)
        }}
      >
        <Typography.Paragraph>
          {confirmAction?.mode === 'reconcile' ? c.reconcileGuidance : c.confirmBody}
        </Typography.Paragraph>
      </Modal>
    </div>
  )
}
