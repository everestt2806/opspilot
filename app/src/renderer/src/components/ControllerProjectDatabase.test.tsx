// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeEach, expect, it, vi } from 'vitest'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopProjectSetup } from '@shared/desktopProjectRegistration'
import type { DesktopPostgresContext, DesktopPostgresIntent } from '@shared/desktopProductPostgres'
import image from '../../../../control-plane-runtime/product-postgres-image.json'
import { ControllerProjectDatabase } from './ControllerProjectDatabase'
import { CONTROLLER_DATABASE_COPY } from './controllerDatabaseCopy'
import { useUiState } from '../store/uiState'
const invoke = vi.fn(),
  changed = vi.fn(),
  t = CONTROLLER_DATABASE_COPY.en
let binding: DesktopControllerConnection,
  project: DesktopProjectSetup,
  context: DesktopPostgresContext,
  rows: DesktopPostgresIntent[]
const databaseId = '55555555-5555-4555-8555-555555555555'
const metadata = (): NonNullable<DesktopPostgresContext['database']['prepared']> => ({
  database_id: databaseId,
  controller_id: binding.controller_id,
  app_id: 42,
  ownership_generation: 1,
  framework: 'nextjs',
  engine: 'postgresql',
  major: 16,
  image: image.image,
  database_name: 'opspilot',
  application_user: 'opspilot',
  administrator_user: 'postgres',
  provisioning: 'prepared',
  created_at: new Date().toISOString()
})
const intent = (
  state: DesktopPostgresIntent['state'] = 'prepared',
  operation: 'prepare' | 'select' = 'prepare'
): DesktopPostgresIntent => ({
  request_key: '33333333-3333-4333-8333-333333333333',
  project_request_key: project.request_key,
  binding_id: binding.binding_id,
  binding_revision: 2,
  controller_id: binding.controller_id,
  app_id: 42,
  operation,
  source_generation: 1,
  source_config_sha256: 'a'.repeat(64),
  database_id: operation === 'select' ? databaseId : null,
  state,
  result: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
})
const view = (): React.JSX.Element => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <ControllerProjectDatabase binding={binding} project={project} onSourceChanged={changed} />
  </ConfigProvider>
)
const open = async (): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByRole('dialog')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t.refresh })).toHaveProperty('disabled', false)
  )
}
const consent = (): void => {
  fireEvent.click(screen.getByRole('checkbox'))
}
beforeEach(() => {
  useUiState.setState({ locale: 'en' })
  invoke.mockReset()
  changed.mockReset()
  rows = []
  binding = {
    binding_id: '11111111-1111-4111-8111-111111111111',
    controller_id: 'controller-a',
    vps_id: 1,
    revision: 2,
    state: 'active',
    display_name: 'Controller',
    remote_client_id: '44444444-4444-4444-8444-444444444444',
    scopes: ['read', 'deploy:manual', 'policy:write'],
    credential_expires_at: '2030-01-01T00:00:00Z',
    updated_at: new Date().toISOString()
  }
  project = {
    request_key: '22222222-2222-4222-8222-222222222222',
    binding_id: binding.binding_id,
    binding_revision: 2,
    controller_id: binding.controller_id,
    target_vps_id: 77,
    target_security_revision: 1,
    framework: 'nextjs',
    app_name: 'env-ui',
    repository_url: 'https://github.com/example/app.git',
    production_ref: 'main',
    repository_root: '.',
    host_port: 30000,
    container_port: 3000,
    healthcheck_path: '/',
    state: 'registered',
    app_id: 42,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  context = {
    project_request_key: project.request_key,
    binding_id: binding.binding_id,
    binding_revision: 2,
    controller_id: binding.controller_id,
    app_id: 42,
    ownership_generation: 1,
    source_generation: 1,
    source_config_sha256: 'a'.repeat(64),
    database: { prepared: null, selected: null },
    environment: { latest: null, selected: null },
    auto_deploy_paused: true
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'controller:postgres-context')
      return { ok: true, data: structuredClone(context) }
    if (channel === 'controller:postgres-intents') return { ok: true, data: structuredClone(rows) }
    if (channel === 'controller:prepare-postgres-intent') {
      rows = [intent()]
      return { ok: true, data: rows[0] }
    }
    if (channel === 'controller:send-postgres-intent') {
      context.database.prepared = metadata()
      rows = [
        {
          ...intent('resource_prepared'),
          result: { state: 'prepared', request_key: intent().request_key, metadata: metadata() }
        }
      ]
      return { ok: true, data: rows[0] }
    }
    throw Error('Unexpected channel')
  })
})
it('requires separate review and confirmation, sends only metadata, and never claims provisioning', async () => {
  render(view())
  await open()
  expect(screen.getByText(t.none)).toBeTruthy()
  expect(screen.getByRole('button', { name: t.create })).toHaveProperty('disabled', true)
  consent()
  fireEvent.click(screen.getByRole('button', { name: t.create }))
  await screen.findByText(t.states.prepared)
  expect(invoke).toHaveBeenCalledWith('controller:prepare-postgres-intent', {
    project_request_key: project.request_key,
    expected_binding_revision: 2,
    expected_source_generation: 1,
    expected_source_config_sha256: 'a'.repeat(64),
    operation: 'prepare'
  })
  expect(screen.getByRole('button', { name: t.send })).toHaveProperty('disabled', true)
  consent()
  fireEvent.click(screen.getByRole('button', { name: t.send }))
  await screen.findByText(t.prepared)
  expect(screen.getByText(t.lifecycle)).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByRole('button', { name: t.select })).toHaveProperty('disabled', true)
  expect(changed).not.toHaveBeenCalled()
})
it('selection keeps the database identity and invalidates deployment review on receipt', async () => {
  context.database.prepared = metadata()
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'controller:postgres-context')
      return { ok: true, data: structuredClone(context) }
    if (channel === 'controller:postgres-intents') return { ok: true, data: structuredClone(rows) }
    if (channel === 'controller:prepare-postgres-intent') {
      rows = [intent('prepared', 'select')]
      return { ok: true, data: rows[0] }
    }
    if (channel === 'controller:send-postgres-intent') {
      rows = [intent('selected', 'select')]
      context.database.selected = metadata()
      context.source_generation = 2
      return { ok: true, data: rows[0] }
    }
    throw Error('Unexpected channel')
  })
  render(view())
  await open()
  consent()
  fireEvent.click(screen.getByRole('button', { name: t.select }))
  await screen.findByText(t.states.prepared)
  consent()
  fireEvent.click(screen.getByRole('button', { name: t.send }))
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
  expect(invoke).toHaveBeenCalledWith(
    'controller:prepare-postgres-intent',
    expect.objectContaining({ operation: 'select', database_id: databaseId })
  )
  expect(screen.queryByRole('button', { name: t.create })).toBeNull()
})
it.each(['in_flight', 'outcome_unknown'] as const)(
  'allows only lookup for %s; closing and reopening never sends a replacement',
  async (state) => {
    rows = [intent(state)]
    render(view())
    await open()
    expect(screen.getByText(t.unknown)).toBeTruthy()
    expect(screen.queryByRole('button', { name: t.send })).toBeNull()
    expect(screen.queryByRole('button', { name: t.cancel })).toBeNull()
    expect(screen.getByRole('button', { name: t.create })).toHaveProperty('disabled', true)
    invoke.mockImplementation(async (channel: string) =>
      channel === 'controller:check-postgres-intent'
        ? { ok: true, data: rows[0] }
        : channel === 'controller:postgres-context'
          ? { ok: true, data: context }
          : { ok: true, data: rows }
    )
    fireEvent.click(screen.getByRole('button', { name: t.check }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('controller:check-postgres-intent', rows[0].request_key)
    )
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: t.close })[1]).toHaveProperty('disabled', false)
    )
    fireEvent.click(screen.getAllByRole('button', { name: t.close })[1])
    await open()
    expect(
      invoke.mock.calls.filter(
        ([c]) =>
          c === 'controller:send-postgres-intent' || c === 'controller:prepare-postgres-intent'
      )
    ).toHaveLength(0)
  }
)
it('a lost IPC send reply becomes unknown and blocks retry until Main lookup', async () => {
  rows = [intent()]
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'controller:postgres-context') return { ok: true, data: context }
    if (channel === 'controller:postgres-intents') return { ok: true, data: rows }
    throw Error('SENSITIVE_TRANSPORT_DETAIL')
  })
  render(view())
  await open()
  consent()
  fireEvent.click(screen.getByRole('button', { name: t.send }))
  await screen.findByText(t.unknown)
  expect(screen.queryByRole('button', { name: t.send })).toBeNull()
  expect(screen.queryByText('SENSITIVE_TRANSPORT_DETAIL')).toBeNull()
})
it('shows failed context as an error while still allowing the original receipt lookup', async () => {
  rows = [intent('outcome_unknown')]
  invoke.mockImplementation(async (channel: string) =>
    channel === 'controller:postgres-context'
      ? { ok: false, error: { technical: 'RAW_REMOTE_DETAIL' } }
      : { ok: true, data: rows }
  )
  render(view())
  await open()
  await screen.findByText(t.unavailable)
  expect(screen.queryByText(t.none)).toBeNull()
  expect(screen.getByRole('button', { name: t.check })).toHaveProperty('disabled', false)
  expect(screen.queryByRole('button', { name: t.create })).toBeNull()
  expect(screen.queryByText('RAW_REMOTE_DETAIL')).toBeNull()
})
it('refuses mismatched controller/database metadata and foreign journal rows', async () => {
  context.database.prepared = { ...metadata(), controller_id: 'foreign' }
  rows = [{ ...intent(), app_id: 99 }]
  render(view())
  await open()
  await screen.findByText(t.unavailable)
  expect(screen.queryByRole('button', { name: t.send })).toBeNull()
  expect(screen.queryByRole('button', { name: t.create })).toBeNull()
})
it('ignores stale context replies after switching binding and does not query unsupported SPA', async () => {
  let complete!: (value: unknown) => void
  invoke.mockImplementation((channel: string) =>
    channel === 'controller:postgres-context'
      ? new Promise((r) => {
          complete = r
        })
      : Promise.resolve({ ok: true, data: [] })
  )
  const mounted = render(view())
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  project = { ...project, framework: 'static-spa' }
  mounted.rerender(view())
  await act(async () => complete({ ok: true, data: context }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('button', { name: t.open })).toHaveProperty('disabled', true)
  expect(invoke).toHaveBeenCalledTimes(2)
})
it('blocks changes without pause or permission, while retaining metadata review', async () => {
  context.auto_deploy_paused = false
  const mounted = render(view())
  await open()
  await screen.findByText(t.paused)
  consent()
  expect(screen.getByRole('button', { name: t.create })).toHaveProperty('disabled', true)
  mounted.unmount()
  binding = { ...binding, scopes: ['read'] }
  invoke.mockClear()
  render(view())
  expect(screen.getByRole('button', { name: t.open })).toHaveProperty('disabled', true)
  expect(invoke).not.toHaveBeenCalled()
})
it('renders all four locales without presenting prepared metadata as running health', async () => {
  for (const locale of ['en', 'vi', 'jp', 'cn'] as const) {
    useUiState.setState({ locale })
    const mounted = render(view())
    const copy = CONTROLLER_DATABASE_COPY[locale]
    fireEvent.click(screen.getByRole('button', { name: copy.open }))
    await screen.findByText(copy.lifecycle)
    expect(screen.getByText(copy.note)).toBeTruthy()
    mounted.unmount()
  }
})

it('cancels only an unsent request and reloads journal failure instead of offering a new UUID', async () => {
  rows = [intent()]
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'controller:postgres-context') return { ok: true, data: context }
    if (channel === 'controller:postgres-intents') return { ok: true, data: rows }
    if (channel === 'controller:cancel-postgres-intent') {
      rows = [intent('cancelled')]
      return { ok: true, data: rows[0] }
    }
    throw Error('Unexpected channel')
  })
  const mounted = render(view())
  await open()
  fireEvent.click(screen.getByRole('button', { name: t.cancel }))
  await screen.findByText(t.states.cancelled)
  expect(invoke).toHaveBeenCalledWith('controller:cancel-postgres-intent', intent().request_key)
  expect(invoke.mock.calls.some(([c]) => c === 'controller:send-postgres-intent')).toBe(false)
  mounted.unmount()
  invoke.mockImplementation(async (channel: string) =>
    channel === 'controller:postgres-intents'
      ? { ok: false, error: { technical: 'PRIVATE_ERROR' } }
      : { ok: true, data: context }
  )
  render(view())
  await open()
  await screen.findByText(t.failure)
  consent()
  expect(screen.queryByRole('button', { name: t.create })).toBeNull()
  expect(screen.queryByText('PRIVATE_ERROR')).toBeNull()
})
