import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography
} from 'antd'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type {
  DesktopProjectSetup,
  DesktopProjectSetupInput,
  DesktopProjectTargets
} from '@shared/desktopProjectRegistration'
import { useUiState } from '../store/uiState'
import { CONTROLLER_PROJECT_COPY } from './controllerProjectCopy'
import { ControllerProjectSourceCheck } from './ControllerProjectSourceCheck'
import { ControllerProjectTargetPreparation } from './ControllerProjectTargetPreparation'
import { ControllerProjectFirstDeployment } from './ControllerProjectFirstDeployment'
type Target = DesktopProjectTargets['items'][number]
type Values = Omit<DesktopProjectSetupInput, 'binding_id'>
const canonicalRepo = (value: string): string => {
  const url = new URL(value),
    path = url.pathname.replace(/\/$/, '').replace(/\.git$/i, '')
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)
  )
    throw new Error('INVALID_REPO')
  return 'https://github.com' + path + '.git'
}
export function ControllerProjectPanel({
  binding
}: {
  binding: DesktopControllerConnection
}): React.JSX.Element {
  const locale = useUiState((value) => value.locale),
    t = CONTROLLER_PROJECT_COPY[locale],
    { modal } = App.useApp()
  const [rows, setRows] = useState<DesktopProjectSetup[]>([]),
    [sourceRevision, setSourceRevision] = useState(0),
    [listError, setListError] = useState(false),
    [listLoading, setListLoading] = useState(false),
    [open, setOpen] = useState(false),
    [targets, setTargets] = useState<Target[]>([]),
    [next, setNext] = useState<number | null>(null),
    [targetError, setTargetError] = useState(false),
    [targetLoading, setTargetLoading] = useState(false),
    [review, setReview] = useState<{ input: Values; target: Target } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const [form] = Form.useForm<Values>(),
    alive = useRef(true),
    listEpoch = useRef(0),
    targetEpoch = useRef(0),
    latest = useRef(binding)
  const framework = Form.useWatch('framework', form)
  useEffect(() => {
    latest.current = binding
  }, [binding])
  const consent =
    binding.scopes.includes('deploy:manual') && binding.scopes.includes('policy:write')
  const current = (): boolean =>
    alive.current &&
    latest.current.binding_id === binding.binding_id &&
    latest.current.revision === binding.revision &&
    latest.current.scopes.includes('deploy:manual') &&
    latest.current.scopes.includes('policy:write')
  const load = useCallback(async (): Promise<void> => {
    setSourceRevision((value) => value + 1)
    const epoch = ++listEpoch.current
    setListLoading(true)
    try {
      const response = await window.api.invoke('controller:projects', binding.binding_id)
      if (!alive.current || epoch !== listEpoch.current) return
      if (
        !response?.ok ||
        !Array.isArray(response.data) ||
        response.data.some(
          (row) =>
            row.binding_id !== binding.binding_id || row.controller_id !== binding.controller_id
        )
      ) {
        setListError(true)
        setRows([])
        return
      }
      setListError(false)
      setRows(response.data)
    } catch {
      if (alive.current && epoch === listEpoch.current) {
        setListError(true)
        setRows([])
      }
    } finally {
      if (alive.current && epoch === listEpoch.current) setListLoading(false)
    }
  }, [binding.binding_id, binding.controller_id])
  const invalidate = useCallback((): void => {
    listEpoch.current++
    targetEpoch.current++
  }, [])
  useEffect(() => {
    alive.current = true
    let mounted = true
    queueMicrotask(() => {
      if (mounted) void load()
    })
    return () => {
      alive.current = false
      mounted = false
      invalidate()
    }
  }, [load, invalidate])
  const loadTargets = async (after: number | null = null): Promise<void> => {
    const epoch = ++targetEpoch.current
    setTargetLoading(true)
    setTargetError(false)
    if (after === null) {
      setTargets([])
      setNext(null)
    }
    try {
      const response = await window.api.invoke('controller:project-targets', {
        binding_id: binding.binding_id,
        after_id: after
      })
      if (!current() || epoch !== targetEpoch.current) return
      if (
        !response?.ok ||
        response.data.binding_id !== binding.binding_id ||
        response.data.controller_id !== binding.controller_id ||
        response.data.binding_revision !== binding.revision ||
        (response.data.has_more &&
          (response.data.next_after_id === null || response.data.next_after_id <= (after ?? 0)))
      ) {
        setTargetError(true)
        return
      }
      setTargets((old) =>
        Array.from(
          new Map(
            [...(after === null ? [] : old), ...response.data.items].map((item) => [item.id, item])
          ).values()
        )
      )
      setNext(response.data.has_more ? response.data.next_after_id : null)
    } catch {
      if (alive.current && epoch === targetEpoch.current) setTargetError(true)
    } finally {
      if (alive.current && epoch === targetEpoch.current) setTargetLoading(false)
    }
  }
  const begin = (): void => {
    if (!consent || busy) return
    setError(null)
    setReview(null)
    form.resetFields()
    setOpen(true)
    void loadTargets()
  }
  const preview = async (): Promise<void> => {
    try {
      const value = await form.validateFields(),
        target = targets.find((item) => item.id === value.target_vps_id)
      if (!target || !current() || targetError || targetLoading) return
      const input = {
        ...value,
        repository_url: canonicalRepo(value.repository_url),
        host_port: value.host_port ?? null
      }
      setReview({ input, target })
    } catch {
      /* Field errors are shown by Form. */
    }
  }
  const submit = async (): Promise<void> => {
    if (!review || !current()) return
    const captured = review
    setBusy(true)
    setError(null)
    try {
      const prepared = await window.api.invoke('controller:prepare-project', {
        ...captured.input,
        binding_id: binding.binding_id
      })
      if (!alive.current) return
      if (!prepared?.ok) {
        setError(t.failed)
        await load()
        return
      }
      const row = prepared.data
      if (
        !current() ||
        row.binding_id !== binding.binding_id ||
        row.binding_revision !== binding.revision ||
        row.controller_id !== binding.controller_id ||
        row.target_vps_id !== captured.target.id ||
        row.target_security_revision !== captured.target.ssh_security_revision ||
        row.app_name !== captured.input.app_name ||
        row.framework !== captured.input.framework ||
        row.repository_url !== captured.input.repository_url ||
        row.production_ref !== captured.input.production_ref ||
        row.repository_root !== captured.input.repository_root ||
        row.container_port !== captured.input.container_port ||
        row.healthcheck_path !== captured.input.healthcheck_path ||
        (captured.input.host_port !== null && row.host_port !== captured.input.host_port)
      ) {
        setError(t.changed)
        await load()
        return
      }
      if (row.state === 'prepared') {
        const response = await window.api.invoke('controller:send-project', row.request_key)
        if (!alive.current) return
        if (!response?.ok) setError(t.failed)
      }
      setOpen(false)
      setReview(null)
      targetEpoch.current++
      await load()
    } catch {
      if (alive.current) {
        setError(t.failed)
        setOpen(false)
        setReview(null)
        await load()
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const retry = async (row: DesktopProjectSetup, cancel = false): Promise<void> => {
    if (!current()) return
    setBusy(true)
    setError(null)
    try {
      const response = cancel
        ? await window.api.invoke('controller:cancel-project', row.request_key)
        : await window.api.invoke('controller:send-project', row.request_key)
      if (!alive.current) return
      if (!response?.ok) setError(t.failed)
      await load()
    } catch {
      if (alive.current) setError(t.failed)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const reviewItems = (
    value: Values,
    targetLabel: string
  ): Array<{ key: string; label: string; children: React.ReactNode }> => [
    { key: 'target', label: t.target, children: targetLabel },
    { key: 'name', label: t.name, children: value.app_name },
    {
      key: 'framework',
      label: t.framework,
      children:
        value.framework === 'static-spa'
          ? 'Vite SPA'
          : value.framework === 'nextjs'
            ? 'Next.js'
            : 'Express'
    },
    { key: 'repo', label: t.repo, children: value.repository_url },
    { key: 'branch', label: t.branch, children: value.production_ref },
    { key: 'root', label: t.root, children: value.repository_root },
    {
      key: 'ports',
      label: t.containerPort,
      children: `${value.host_port ?? 'auto'} → ${value.container_port}`
    },
    { key: 'health', label: t.health, children: value.healthcheck_path }
  ]
  return (
    <Card
      className="controller-project-panel"
      size="small"
      style={{ marginTop: 20 }}
      title={t.title}
      extra={
        <Space>
          <Button size="small" loading={listLoading} disabled={busy} onClick={() => void load()}>
            {t.refresh}
          </Button>
          <Button type="primary" disabled={!consent || busy} onClick={begin}>
            {t.create}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">{t.intro}</Typography.Paragraph>
      {!consent && <Alert type="info" message={t.readOnly} />}
      {error && <Alert type="error" showIcon message={error} />}
      {listError && <Alert type="error" message={t.historyError} />}
      {rows.some((row) => ['in_flight', 'outcome_unknown'].includes(row.state)) && (
        <Alert type="warning" showIcon message={t.unknownHint} />
      )}
      {rows.some((row) => row.state === 'registered') && (
        <Alert type="info" showIcon message={t.registeredHint} />
      )}
      <Table
        size="small"
        rowKey="request_key"
        loading={listLoading}
        dataSource={rows}
        pagination={{ pageSize: 5, hideOnSinglePage: true }}
        scroll={{ x: 600 }}
        locale={{ emptyText: listError ? t.historyError : t.empty }}
        columns={[
          {
            title: t.name,
            dataIndex: 'app_name',
            render: (name: string, row) => (
              <>
                <Typography.Text strong>{name}</Typography.Text>
                <br />
                <Typography.Text code title={row.request_key}>
                  {row.request_key.slice(0, 8)}
                </Typography.Text>{' '}
                · {t.targetId} #{row.target_vps_id}
              </>
            )
          },
          {
            title: t.state,
            dataIndex: 'state',
            render: (state: DesktopProjectSetup['state'], row) => (
              <>
                <Tag color={state === 'outcome_unknown' ? 'warning' : 'default'}>{t[state]}</Tag>
                {row.app_id !== null && (
                  <Typography.Text>
                    {t.appId} #{row.app_id}
                  </Typography.Text>
                )}
              </>
            )
          },
          {
            title: t.updated,
            dataIndex: 'updated_at',
            render: (stamp: string) => new Date(stamp).toLocaleString()
          },
          {
            title: '',
            key: 'actions',
            render: (_value, row) => (
              <Space wrap>
                {row.state === 'registered' && (
                  <ControllerProjectSourceCheck
                    key={`source-${sourceRevision}`}
                    binding={binding}
                    project={row}
                  />
                )}
                {row.state === 'registered' && (
                  <ControllerProjectTargetPreparation
                    key={`target-${sourceRevision}`}
                    binding={binding}
                    project={row}
                  />
                )}
                {row.state === 'registered' && (
                  <ControllerProjectFirstDeployment
                    key={`first-${sourceRevision}`}
                    binding={binding}
                    project={row}
                  />
                )}
                {['prepared', 'in_flight', 'outcome_unknown'].includes(row.state) && (
                  <Button
                    size="small"
                    disabled={busy || !consent}
                    onClick={() =>
                      modal.confirm({
                        title: t.retryTitle,
                        content: (
                          <Descriptions
                            size="small"
                            column={1}
                            items={reviewItems(row, `#${row.target_vps_id}`)}
                          />
                        ),
                        okText: t.retry,
                        cancelText: t.back,
                        onOk: () => retry(row)
                      })
                    }
                  >
                    {t.retry}
                  </Button>
                )}
                {row.state === 'prepared' && (
                  <Button
                    size="small"
                    disabled={busy || !consent}
                    onClick={() => void retry(row, true)}
                  >
                    {t.cancel}
                  </Button>
                )}
              </Space>
            )
          }
        ]}
      />
      <Modal
        title={review ? t.reviewTitle : t.create}
        open={open}
        onCancel={() => {
          if (!busy) {
            targetEpoch.current++
            setOpen(false)
            setReview(null)
          }
        }}
        footer={null}
        destroyOnHidden
        maskClosable={!busy}
        closable={!busy}
        keyboard={!busy}
        style={{ top: 32 }}
        styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } }}
      >
        <Steps
          size="small"
          current={review ? 1 : 0}
          items={[{ title: t.review }, { title: t.confirm }]}
          style={{ marginBottom: 16 }}
        />
        {error && <Alert type="error" message={error} />}
        <Form
          form={form}
          layout="vertical"
          disabled={busy}
          initialValues={{
            framework: 'express',
            production_ref: 'main',
            repository_root: '.',
            host_port: null,
            container_port: 3000,
            healthcheck_path: '/health'
          }}
          style={{ display: review ? 'none' : 'block' }}
        >
          <Alert type="info" message={t.limits} />
          <Form.Item
            name="framework"
            label={t.framework}
            rules={[{ required: true, message: t.required }]}
          >
            <Select
              options={[
                { value: 'express', label: 'Express' },
                { value: 'static-spa', label: 'Vite SPA' },
                { value: 'nextjs', label: 'Next.js' }
              ]}
              onChange={(framework: Values['framework']) =>
                form.setFieldsValue({
                  container_port: framework === 'static-spa' ? 80 : 3000,
                  healthcheck_path: framework === 'express' ? '/health' : '/'
                })
              }
            />
          </Form.Item>
          {targetError && <Alert type="error" message={t.targetError} />}
          {!targetLoading && !targetError && targets.length === 0 && (
            <Alert type="warning" message={t.targetEmpty} />
          )}
          <Form.Item
            name="target_vps_id"
            label={t.target}
            rules={[{ required: true, message: t.required }]}
            style={{ marginTop: 16 }}
          >
            <Select
              loading={targetLoading}
              options={targets.map((target) => ({
                value: target.id,
                label: `${target.name} · ${target.host} (#${target.id})`
              }))}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">{t.targetHint}</Typography.Paragraph>
          <Space style={{ marginBottom: 16 }}>
            <Button onClick={() => void loadTargets()} disabled={targetLoading}>
              {t.refresh}
            </Button>
            {next !== null && (
              <Button onClick={() => void loadTargets(next)} disabled={targetLoading}>
                {t.more}
              </Button>
            )}
          </Space>
          <Form.Item
            name="app_name"
            label={t.name}
            rules={[
              { required: true, message: t.required },
              { pattern: /^[a-z0-9][a-z0-9-]{1,30}$/, message: t.slug }
            ]}
          >
            <Input maxLength={31} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="repository_url"
            label={t.repo}
            rules={[
              { required: true, message: t.required },
              {
                validator: async (_rule, value: string) => {
                  try {
                    canonicalRepo(value)
                  } catch {
                    throw new Error(t.repoInvalid)
                  }
                }
              }
            ]}
          >
            <Input
              maxLength={2048}
              autoComplete="off"
              placeholder="https://github.com/owner/repository"
            />
          </Form.Item>
          <Form.Item
            name="production_ref"
            label={t.branch}
            rules={[{ required: true, whitespace: true, message: t.required }]}
          >
            <Input maxLength={255} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="repository_root"
            label={t.root}
            rules={[{ required: true, whitespace: true, message: t.required }]}
          >
            <Input maxLength={512} autoComplete="off" />
          </Form.Item>
          <Form.Item name="host_port" label={t.hostPort}>
            <InputNumber min={30000} max={30999} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="container_port"
            label={t.containerPort}
            rules={[{ required: true, message: t.required }]}
          >
            <InputNumber
              disabled={framework === 'static-spa' || busy}
              min={1}
              max={65535}
              precision={0}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            name="healthcheck_path"
            label={t.health}
            rules={[{ required: true, whitespace: true, message: t.required }]}
          >
            <Input maxLength={512} autoComplete="off" />
          </Form.Item>
          <Button
            type="primary"
            disabled={targetLoading || targetError || targets.length === 0}
            onClick={() => void preview()}
          >
            {t.review}
          </Button>
        </Form>
        {review && (
          <>
            <Alert type="info" showIcon message={t.confirmHint} />
            <Descriptions
              size="small"
              column={1}
              style={{ marginBlock: 16, overflowWrap: 'anywhere' }}
              items={reviewItems(
                review.input,
                `${review.target.name} · ${review.target.host} (#${review.target.id})`
              )}
            />
            <Space>
              <Button type="primary" loading={busy} onClick={() => void submit()}>
                {t.confirm}
              </Button>
              <Button disabled={busy} onClick={() => setReview(null)}>
                {t.back}
              </Button>
            </Space>
          </>
        )}
      </Modal>
    </Card>
  )
}
