import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Empty,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography
} from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  SafetyOutlined
} from '@ant-design/icons'
import type {
  Alert as MonitorAlert,
  DetectionMethod,
  MetricSample,
  MonitorSetting,
  ScoreSet
} from '@shared/ipc'

import { useUiState, type LocaleMode } from '../store/uiState'
import { localDateTime } from '../utils/format'

interface AppMonitorTabProps {
  appId: number
  deploymentId: number | null
  importedFromVps: boolean
}

const COPY: Record<
  LocaleMode,
  {
    importedNotice: string
    loadError: string
    refresh: string
    trainNow: string
    training: string
    trainSuccess: (count: number) => string
    latestMetricsTitle: string
    noSamples: string
    noDeployment: string
    policyTitle: string
    autoRollback: string
    autoRollbackHelp: string
    autoRollbackConfirmTitle: string
    autoRollbackConfirmBody: string
    autoRollbackConfirmOk: string
    trustedMethod: string
    rollbackConsecutive: string
    cooldownMinutes: string
    mlThreshold: string
    ruleConsecutive: string
    savePolicy: string
    policySaved: string
    alertsTitle: string
    noAlerts: string
    truePositive: string
    falsePositive: string
    methods: Record<DetectionMethod, string>
    actedLabels: Record<MonitorAlert['acted'], string>
    cols: {
      time: string
      method: string
      score: string
      status: string
      acted: string
      label: string
    }
  }
> = {
  vi: {
    importedNotice: 'Chưa hỗ trợ giám sát hoặc tự động rollback cho app vừa nhập từ VPS.',
    loadError: 'Không tải được dữ liệu giám sát.',
    refresh: 'Làm mới',
    trainNow: 'Train ML ngay',
    training: 'Đang train…',
    trainSuccess: (n) => `Đã train mô hình ML với ${n} mẫu.`,
    latestMetricsTitle: 'Metric & điểm bất thường mới nhất',
    noSamples: 'Chưa có mẫu metric nào cho phiên bản hiện tại.',
    noDeployment: 'App chưa có deployment đang chạy để giám sát.',
    policyTitle: 'Chính sách cảnh báo & Tự động rollback',
    autoRollback: 'Tự động rollback',
    autoRollbackHelp:
      'Mặc định tắt. Khi bật, app tự khôi phục về phiên bản chạy tốt trước đó nếu phương pháp tin cậy cảnh báo liên tiếp.',
    autoRollbackConfirmTitle: 'Xác nhận bật tự động rollback',
    autoRollbackConfirmBody:
      'Khi bật, OpsPilot sẽ tự động rollback container về phiên bản ổn định trước đó nếu phương pháp tin cậy phát hiện bất thường liên tiếp. Quá trình này có thể ngắt kết nối tạm thời khi chuyển container.',
    autoRollbackConfirmOk: 'Bật tự động rollback',
    trustedMethod: 'Phương pháp tin cậy',
    rollbackConsecutive: 'Số mẫu cảnh báo liên tiếp',
    cooldownMinutes: 'Thời gian chờ cooldown (phút)',
    mlThreshold: 'Ngưỡng điểm ML (0–1)',
    ruleConsecutive: 'Số mẫu ngưỡng rule liên tiếp',
    savePolicy: 'Lưu cấu hình',
    policySaved: 'Đã lưu cấu hình giám sát.',
    alertsTitle: 'Cảnh báo gần đây',
    noAlerts: 'Chưa có cảnh báo nào được ghi nhận.',
    truePositive: 'Đúng (TP)',
    falsePositive: 'Nhiễu (FP)',
    methods: {
      ensemble: 'Ensemble (≥2/3 ML)',
      zscore_ewma: 'Z-Score / EWMA',
      iforest: 'Isolation Forest',
      ocsvm: 'One-Class SVM',
      rule: 'Rule ngưỡng cố định'
    },
    actedLabels: {
      none: 'Chỉ cảnh báo',
      rollback_auto: 'Đã tự động rollback',
      rollback_suppressed_cooldown: 'Bỏ qua do cooldown'
    },
    cols: {
      time: 'Thời điểm (VPS)',
      method: 'Phương pháp',
      score: 'Peak score',
      status: 'Trạng thái',
      acted: 'Hành động',
      label: 'Gán nhãn'
    }
  },
  en: {
    importedNotice: 'Monitoring and auto-rollback are unavailable for VPS-imported apps.',
    loadError: 'Could not load monitoring data.',
    refresh: 'Refresh',
    trainNow: 'Train ML now',
    training: 'Training…',
    trainSuccess: (n) => `Trained ML models with ${n} samples.`,
    latestMetricsTitle: 'Latest metrics & anomaly scores',
    noSamples: 'No metric samples collected yet for this deployment.',
    noDeployment: 'No running deployment selected to monitor.',
    policyTitle: 'Anomaly & Auto-Rollback Policy',
    autoRollback: 'Auto-rollback',
    autoRollbackHelp:
      'Disabled by default. Automatically rolls back to the previous running version after consecutive trusted alerts.',
    autoRollbackConfirmTitle: 'Enable automatic rollback?',
    autoRollbackConfirmBody:
      'When enabled, OpsPilot will automatically roll back to the previous running version after consecutive anomaly alerts from the trusted method. Switching containers may briefly interrupt active traffic.',
    autoRollbackConfirmOk: 'Enable auto-rollback',
    trustedMethod: 'Trusted method',
    rollbackConsecutive: 'Consecutive samples to rollback',
    cooldownMinutes: 'Cooldown window (minutes)',
    mlThreshold: 'ML score threshold (0–1)',
    ruleConsecutive: 'Rule consecutive samples',
    savePolicy: 'Save policy',
    policySaved: 'Monitoring settings saved.',
    alertsTitle: 'Recent alerts',
    noAlerts: 'No anomaly alerts recorded.',
    truePositive: 'True positive',
    falsePositive: 'False positive',
    methods: {
      ensemble: 'Ensemble (≥2/3 ML)',
      zscore_ewma: 'Z-Score / EWMA',
      iforest: 'Isolation Forest',
      ocsvm: 'One-Class SVM',
      rule: 'Static rule threshold'
    },
    actedLabels: {
      none: 'Alert only',
      rollback_auto: 'Auto-rolled back',
      rollback_suppressed_cooldown: 'Suppressed (cooldown)'
    },
    cols: {
      time: 'Time (VPS)',
      method: 'Method',
      score: 'Peak score',
      status: 'State',
      acted: 'Action',
      label: 'Label'
    }
  },
  cn: {
    importedNotice: '从 VPS 导入的应用暂不支持监控和自动回滚。',
    loadError: '无法加载监控数据。',
    refresh: '刷新',
    trainNow: '立即训练 ML',
    training: '正在训练…',
    trainSuccess: (n) => `已使用 ${n} 条样本完成 ML 模型训练。`,
    latestMetricsTitle: '最新指标与异常评分',
    noSamples: '当前版本尚无采集到的指标样本。',
    noDeployment: '该应用暂无运行中的部署版本可供监控。',
    policyTitle: '告警与自动回滚策略',
    autoRollback: '自动回滚',
    autoRollbackHelp: '默认关闭。当可信方法连续触发异常告警时，自动回滚至上一稳定版本。',
    autoRollbackConfirmTitle: '确认启用自动回滚',
    autoRollbackConfirmBody:
      '启用后，若可信检测方法连续告警，OpsPilot 将自动回滚容器至上一运行版本，切换期间可能出现短暂中断。',
    autoRollbackConfirmOk: '启用自动回滚',
    trustedMethod: '可信检测方法',
    rollbackConsecutive: '触发回滚的连续样本数',
    cooldownMinutes: '冷却时间（分钟）',
    mlThreshold: 'ML 异常阈值 (0–1)',
    ruleConsecutive: '规则连续样本数',
    savePolicy: '保存策略',
    policySaved: '已保存监控配置。',
    alertsTitle: '近期告警',
    noAlerts: '暂无异常告警记录。',
    truePositive: '真实异常',
    falsePositive: '误报',
    methods: {
      ensemble: 'Ensemble (≥2/3 ML)',
      zscore_ewma: 'Z-Score / EWMA',
      iforest: 'Isolation Forest',
      ocsvm: 'One-Class SVM',
      rule: '静态规则阈值'
    },
    actedLabels: {
      none: '仅告警',
      rollback_auto: '已自动回滚',
      rollback_suppressed_cooldown: '冷却期跳过'
    },
    cols: {
      time: '时间 (VPS)',
      method: '检测方法',
      score: '峰值评分',
      status: '状态',
      acted: '动作',
      label: '标注'
    }
  },
  jp: {
    importedNotice: 'VPS からインポートしたアプリは監視・自動ロールバック対象外です。',
    loadError: '監視データを読み込めませんでした。',
    refresh: '更新',
    trainNow: '今すぐ ML 学習',
    training: '学習中…',
    trainSuccess: (n) => `${n} 件のサンプルで ML モデルを学習しました。`,
    latestMetricsTitle: '最新メトリクス・異常スコア',
    noSamples: '現在のデプロイにまだサンプルがありません。',
    noDeployment: '監視対象の稼働中デプロイがありません。',
    policyTitle: '異常検知・自動ロールバック設定',
    autoRollback: '自動ロールバック',
    autoRollbackHelp: '初期設定はオフ。信頼手法の連続検知時に前バージョンへ自動復旧します。',
    autoRollbackConfirmTitle: '自動ロールバックを有効にしますか？',
    autoRollbackConfirmBody:
      '有効化すると、信頼手法が連続で異常を検知した際に前バージョンへ自動的に戻します。切り替え時に一時的な接続断が発生する場合があります。',
    autoRollbackConfirmOk: '有効化する',
    trustedMethod: '信頼する検知手法',
    rollbackConsecutive: '連続異常サンプル数',
    cooldownMinutes: 'クールダウン (分)',
    mlThreshold: 'ML しきい値 (0–1)',
    ruleConsecutive: 'ルール連続サンプル数',
    savePolicy: '設定を保存',
    policySaved: '監視設定を保存しました。',
    alertsTitle: '最近のアラート',
    noAlerts: 'アラートはまだありません。',
    truePositive: '正常検知 (TP)',
    falsePositive: '誤検知 (FP)',
    methods: {
      ensemble: 'Ensemble (≥2/3 ML)',
      zscore_ewma: 'Z-Score / EWMA',
      iforest: 'Isolation Forest',
      ocsvm: 'One-Class SVM',
      rule: '静的ルール'
    },
    actedLabels: {
      none: '通知のみ',
      rollback_auto: '自動ロールバック済',
      rollback_suppressed_cooldown: 'クールダウン抑止'
    },
    cols: {
      time: '時刻 (VPS)',
      method: '手法',
      score: 'ピークスコア',
      status: '状態',
      acted: '実行結果',
      label: 'ラベル'
    }
  }
}

export function AppMonitorTab({
  appId,
  deploymentId,
  importedFromVps
}: AppMonitorTabProps): React.JSX.Element {
  const { message } = AntApp.useApp()
  const locale = useUiState((s) => s.locale)
  const copy = COPY[locale]

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [setting, setSetting] = useState<MonitorSetting | null>(null)
  const [saving, setSaving] = useState(false)
  const [training, setTraining] = useState(false)
  const [confirmEnableOpen, setConfirmEnableOpen] = useState(false)
  const [samples, setSamples] = useState<MetricSample[]>([])
  const [scores, setScores] = useState<Array<{ ts_vps: string } & ScoreSet>>([])
  const [alerts, setAlerts] = useState<MonitorAlert[]>([])

  const reqRef = useRef(0)

  const fetchMonitorData = useCallback(async (): Promise<void> => {
    if (importedFromVps) {
      setLoading(false)
      return
    }
    const reqId = ++reqRef.current
    try {
      const settingRes = await window.api.invoke('monitor:get-setting', appId)
      if (reqRef.current !== reqId) return
      if (!settingRes.ok) {
        setError(settingRes.error.message || copy.loadError)
        setLoading(false)
        return
      }
      setError(null)
      setSetting(settingRes.data)

      if (deploymentId !== null) {
        const fromTs = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const [samplesRes, scoresRes, alertsRes] = await Promise.all([
          window.api.invoke('monitor:samples', deploymentId, fromTs),
          window.api.invoke('monitor:scores', deploymentId, fromTs),
          window.api.invoke('monitor:alerts', deploymentId, 50)
        ])
        if (reqRef.current !== reqId) return
        if (samplesRes.ok) setSamples(samplesRes.data)
        if (scoresRes.ok) setScores(scoresRes.data)
        if (alertsRes.ok) setAlerts(alertsRes.data)
      } else {
        setSamples([])
        setScores([])
        setAlerts([])
      }
    } catch (err) {
      if (reqRef.current === reqId) {
        setError(err instanceof Error ? err.message : copy.loadError)
      }
    } finally {
      if (reqRef.current === reqId) setLoading(false)
    }
  }, [appId, copy.loadError, deploymentId, importedFromVps])

  const loadAll = useCallback(async (): Promise<void> => {
    if (!importedFromVps) {
      setLoading(true)
      setError(null)
    }
    await fetchMonitorData()
  }, [fetchMonitorData, importedFromVps])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (!cancelled) await fetchMonitorData()
    })()
    return () => {
      cancelled = true
    }
  }, [fetchMonitorData])

  useEffect(() => {
    if (importedFromVps || deploymentId === null) return
    return window.api.on('monitor:tick', (payload) => {
      if (payload.deployment_id !== deploymentId) return
      if (payload.samples.length > 0) {
        setSamples((prev) => [...prev.slice(-199), ...payload.samples])
      }
      if (payload.scores.length > 0) {
        setScores((prev) => [...prev.slice(-199), ...payload.scores])
      }
      if (payload.new_alerts.length > 0) {
        setAlerts((prev) => [...payload.new_alerts, ...prev].slice(0, 50))
      }
    })
  }, [deploymentId, importedFromVps])

  if (importedFromVps) {
    return (
      <div className="apps-tab-content">
        <Alert type="info" showIcon message={copy.importedNotice} />
      </div>
    )
  }

  if (loading && !setting) {
    return (
      <div className="apps-tab-content" style={{ padding: 24, textAlign: 'center' }}>
        <Spin />
      </div>
    )
  }

  if (error) {
    return (
      <div className="apps-tab-content">
        <Alert
          type="error"
          showIcon
          message={copy.loadError}
          description={error}
          action={
            <Button size="small" onClick={() => void loadAll()}>
              {copy.refresh}
            </Button>
          }
        />
      </div>
    )
  }

  const latestSample = samples[samples.length - 1] ?? null
  const latestScore = scores[scores.length - 1] ?? null

  const saveSettings = async (patch: Partial<MonitorSetting>): Promise<void> => {
    setSaving(true)
    const res = await window.api.invoke('monitor:set-setting', appId, patch)
    setSaving(false)
    if (res.ok) {
      setSetting(res.data)
      void message.success(copy.policySaved)
    } else {
      void message.error(res.error.message)
    }
  }

  const handleToggleAutoRollback = (checked: boolean): void => {
    if (!setting) return
    if (!checked) {
      void saveSettings({ auto_rollback: 0 })
      return
    }
    setConfirmEnableOpen(true)
  }

  const handleTrainNow = async (): Promise<void> => {
    if (deploymentId === null) return
    setTraining(true)
    const res = await window.api.invoke('monitor:train-now', deploymentId)
    setTraining(false)
    if (res.ok) {
      void message.success(copy.trainSuccess(res.data.train_sample_count))
    } else {
      void message.error(res.error.message)
    }
  }

  const handleLabelAlert = async (
    alertId: number,
    label: 'true_positive' | 'false_positive'
  ): Promise<void> => {
    const res = await window.api.invoke('monitor:label-alert', alertId, label)
    if (res.ok) {
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, label } : a)))
    } else {
      void message.error(res.error.message)
    }
  }

  return (
    <div className="apps-tab-content">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card
          size="small"
          title={
            <Space size={8}>
              <SafetyOutlined />
              <span>{copy.policyTitle}</span>
            </Space>
          }
          extra={
            <Space>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void loadAll()}
              >
                {copy.refresh}
              </Button>
              {deploymentId !== null && (
                <Button
                  size="small"
                  type="primary"
                  icon={<ExperimentOutlined />}
                  loading={training}
                  onClick={() => void handleTrainNow()}
                >
                  {training ? copy.training : copy.trainNow}
                </Button>
              )}
            </Space>
          }
        >
          {setting && (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap'
                }}
              >
                <div>
                  <Typography.Text strong>{copy.autoRollback}</Typography.Text>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {copy.autoRollbackHelp}
                    </Typography.Text>
                  </div>
                </div>
                <Switch
                  checked={setting.auto_rollback === 1}
                  loading={saving}
                  aria-label={copy.autoRollback}
                  onChange={handleToggleAutoRollback}
                />
              </div>

              <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
                <Descriptions.Item label={copy.trustedMethod}>
                  <Select
                    size="small"
                    style={{ width: '100%', minWidth: 180 }}
                    value={setting.trusted_method}
                    onChange={(v) => setSetting({ ...setting, trusted_method: v })}
                    options={(
                      ['ensemble', 'zscore_ewma', 'iforest', 'ocsvm', 'rule'] as DetectionMethod[]
                    ).map((m) => ({ value: m, label: copy.methods[m] }))}
                  />
                </Descriptions.Item>
                <Descriptions.Item label={copy.rollbackConsecutive}>
                  <InputNumber
                    size="small"
                    min={1}
                    max={20}
                    value={setting.rollback_consecutive}
                    onChange={(v) =>
                      setSetting({ ...setting, rollback_consecutive: Math.max(1, Number(v ?? 3)) })
                    }
                  />
                </Descriptions.Item>
                <Descriptions.Item label={copy.cooldownMinutes}>
                  <InputNumber
                    size="small"
                    min={0}
                    max={1440}
                    value={setting.cooldown_minutes}
                    onChange={(v) =>
                      setSetting({ ...setting, cooldown_minutes: Math.max(0, Number(v ?? 10)) })
                    }
                  />
                </Descriptions.Item>
                <Descriptions.Item label={copy.mlThreshold}>
                  <InputNumber
                    size="small"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={setting.ml_score_threshold}
                    onChange={(v) =>
                      setSetting({
                        ...setting,
                        ml_score_threshold: Number(v ?? 0.7)
                      })
                    }
                  />
                </Descriptions.Item>
              </Descriptions>

              <div>
                <Button
                  type="primary"
                  size="small"
                  loading={saving}
                  onClick={() =>
                    void saveSettings({
                      trusted_method: setting.trusted_method,
                      rollback_consecutive: setting.rollback_consecutive,
                      cooldown_minutes: setting.cooldown_minutes,
                      ml_score_threshold: setting.ml_score_threshold
                    })
                  }
                >
                  {copy.savePolicy}
                </Button>
              </div>
            </Space>
          )}
        </Card>

        <Card size="small" title={copy.latestMetricsTitle}>
          {deploymentId === null ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.noDeployment} />
          ) : !latestSample ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.noSamples} />
          ) : (
            <Descriptions column={{ xs: 1, sm: 3 }} size="small" bordered>
              <Descriptions.Item label="CPU">
                <span className="mono-text">
                  {latestSample.cpu_pct !== null ? `${latestSample.cpu_pct.toFixed(1)}%` : '—'}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Memory">
                <span className="mono-text">
                  {latestSample.mem_mb !== null ? `${latestSample.mem_mb.toFixed(1)} MB` : '—'}
                  {latestSample.mem_pct !== null ? ` (${latestSample.mem_pct.toFixed(1)}%)` : ''}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Latency / 5xx">
                <span className="mono-text">
                  {latestSample.latency_ms !== null
                    ? `${latestSample.latency_ms.toFixed(0)} ms`
                    : '—'}{' '}
                  ·{' '}
                  {latestSample.http_error_rate !== null
                    ? `${(latestSample.http_error_rate * 100).toFixed(1)}%`
                    : '—'}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Ensemble">
                <span className="mono-text">
                  {latestScore?.ensemble !== null && latestScore?.ensemble !== undefined
                    ? latestScore.ensemble.toFixed(3)
                    : '—'}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Z-Score / IF / OCSVM">
                <span className="mono-text">
                  {[latestScore?.zscore_ewma, latestScore?.iforest, latestScore?.ocsvm]
                    .map((v) => (v !== null && v !== undefined ? v.toFixed(2) : '—'))
                    .join(' / ')}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Rule">
                <Tag color={latestScore?.rule === 1 ? 'error' : 'success'}>
                  {latestScore?.rule === 1 ? 'Triggered' : 'Normal'}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          )}
        </Card>

        <Card size="small" title={copy.alertsTitle}>
          {alerts.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.noAlerts} />
          ) : (
            <Table<MonitorAlert>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={alerts}
              columns={[
                {
                  title: copy.cols.time,
                  dataIndex: 'ts_vps',
                  render: (ts: string) => (
                    <span className="mono-text" style={{ fontSize: 12 }}>
                      {localDateTime(ts)}
                    </span>
                  )
                },
                {
                  title: copy.cols.method,
                  dataIndex: 'method',
                  render: (m: DetectionMethod) => <Tag>{copy.methods[m]}</Tag>
                },
                {
                  title: copy.cols.score,
                  dataIndex: 'peak_score',
                  render: (s: number) => <span className="mono-text">{s.toFixed(3)}</span>
                },
                {
                  title: copy.cols.acted,
                  dataIndex: 'acted',
                  render: (acted: MonitorAlert['acted']) => (
                    <Tag
                      color={
                        acted === 'rollback_auto'
                          ? 'purple'
                          : acted === 'rollback_suppressed_cooldown'
                            ? 'warning'
                            : 'default'
                      }
                    >
                      {copy.actedLabels[acted]}
                    </Tag>
                  )
                },
                {
                  title: copy.cols.label,
                  key: 'label',
                  render: (_, alert) => (
                    <Space size="small">
                      <Button
                        size="small"
                        type={alert.label === 'true_positive' ? 'primary' : 'default'}
                        icon={<CheckOutlined />}
                        onClick={() => void handleLabelAlert(alert.id, 'true_positive')}
                      >
                        {copy.truePositive}
                      </Button>
                      <Button
                        size="small"
                        danger={alert.label === 'false_positive'}
                        type={alert.label === 'false_positive' ? 'primary' : 'default'}
                        icon={<CloseOutlined />}
                        onClick={() => void handleLabelAlert(alert.id, 'false_positive')}
                      >
                        {copy.falsePositive}
                      </Button>
                    </Space>
                  )
                }
              ]}
            />
          )}
        </Card>
      </Space>
      <Modal
        open={confirmEnableOpen}
        centered
        width="min(500px, calc(100vw - 32px))"
        destroyOnHidden
        title={copy.autoRollbackConfirmTitle}
        okText={copy.autoRollbackConfirmOk}
        confirmLoading={saving}
        onCancel={() => setConfirmEnableOpen(false)}
        onOk={async () => {
          await saveSettings({ auto_rollback: 1 })
          setConfirmEnableOpen(false)
        }}
      >
        <Typography.Text>{copy.autoRollbackConfirmBody}</Typography.Text>
      </Modal>
    </div>
  )
}
