// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { DesktopControllerConnection } from '@shared/desktopController'
import type { DesktopProjectSetup } from '@shared/desktopProjectRegistration'
import type { DesktopPostgresContext } from '@shared/desktopProductPostgres'
import type { DesktopPostgresInspectionResult } from '@shared/desktopPostgresInspection'
import type {
  ProductPostgresInspectionOperation,
  ProductPostgresTable
} from '@shared/productPostgresInspection'
import { ControllerPostgresInspector } from './ControllerPostgresInspector'
import { POSTGRES_INSPECTOR_COPY } from './postgresInspectorCopy'
import { useUiState } from '../store/uiState'
import image from '../../../../control-plane-runtime/product-postgres-image.json'

const invoke = vi.fn(),
  t = POSTGRES_INSPECTOR_COPY.en
let binding: DesktopControllerConnection,
  project: DesktopProjectSetup,
  context: DesktopPostgresContext
const databaseId = '55555555-5555-4555-8555-555555555555'
const table = (name: string): ProductPostgresTable => ({
  schema: 'public',
  name,
  columns: [
    { name: 'id', data_type: 'integer', nullable: false },
    { name: 'marker', data_type: 'text', nullable: true }
  ]
})
function result(
  read: ProductPostgresInspectionOperation,
  data?: DesktopPostgresInspectionResult['data']
): DesktopPostgresInspectionResult {
  return {
    project_request_key: project.request_key,
    binding_id: binding.binding_id,
    binding_revision: binding.revision,
    context: {
      state: 'configuration_verified',
      controller_id: binding.controller_id!,
      app_id: project.app_id!,
      ownership_generation: 1,
      source_generation: context.source_generation,
      source_config_sha256: context.source_config_sha256,
      target_security_revision: project.target_security_revision,
      database: context.database.selected!,
      runtime_status: 'not_checked'
    },
    read,
    instance: {
      database_id: databaseId,
      container_id: 'a'.repeat(64),
      image_id: 'sha256:' + 'b'.repeat(64),
      volume: `opspilot-pg-${databaseId}-data`,
      volume_created_at: '2026-11-17T00:00:00Z',
      system_identifier: '1234567',
      state: 'ready',
      public_port: null
    },
    checked_at: new Date().toISOString(),
    data:
      data ??
      (read.operation === 'tables'
        ? [table('notes'), table('users')]
        : read.operation === 'rows'
          ? [{ id: 1, marker: read.table + '-value' }]
          : null)
  }
}
const view = (): React.JSX.Element => (
  <ConfigProvider theme={{ token: { motion: false } }}>
    <ControllerPostgresInspector binding={binding} project={project} />
  </ConfigProvider>
)
async function open(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: t.open }))
  await screen.findByRole('dialog')
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
}
async function load(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: t.load }))
  await screen.findByRole('button', { name: 'public.notes' })
}
beforeEach(() => {
  useUiState.setState({ locale: 'en' })
  invoke.mockReset()
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
    controller_id: binding.controller_id!,
    target_vps_id: 77,
    target_security_revision: 1,
    framework: 'nextjs',
    app_name: 'my-app',
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
  const metadata = {
    database_id: databaseId,
    controller_id: binding.controller_id!,
    app_id: 42,
    ownership_generation: 1,
    framework: 'nextjs' as const,
    engine: 'postgresql' as const,
    major: 16 as const,
    image: image.image,
    database_name: 'opspilot' as const,
    application_user: 'opspilot' as const,
    administrator_user: 'postgres' as const,
    provisioning: 'prepared' as const,
    created_at: new Date().toISOString()
  }
  context = {
    project_request_key: project.request_key,
    binding_id: binding.binding_id,
    binding_revision: 2,
    controller_id: binding.controller_id!,
    app_id: 42,
    ownership_generation: 1,
    source_generation: 2,
    source_config_sha256: 'a'.repeat(64),
    database: { prepared: metadata, selected: metadata },
    environment: { latest: null, selected: null },
    auto_deploy_paused: false
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { invoke } })
  invoke.mockImplementation(async (channel, input) =>
    channel === 'controller:postgres-context'
      ? { ok: true, data: structuredClone(context) }
      : { ok: true, data: result(input.read) }
  )
})
afterEach(() => {
  vi.useRealTimers()
})

it('reads only on demand using exact selected scope and works without pausing auto deployment', async () => {
  render(view())
  await open()
  expect(invoke.mock.calls.filter(([c]) => c === 'controller:inspect-postgres')).toHaveLength(0)
  await load()
  expect(invoke).toHaveBeenLastCalledWith('controller:inspect-postgres', {
    project_request_key: project.request_key,
    expected_binding_revision: 2,
    expected_source_generation: 2,
    expected_source_config_sha256: 'a'.repeat(64),
    database_id: databaseId,
    read: { operation: 'tables' }
  })
  expect(screen.getByText(t.verified)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'public.notes' }))
  await screen.findByText('notes-value')
  fireEvent.click(screen.getByRole('tab', { name: t.structure }))
  await screen.findByText('integer')
  expect(
    invoke.mock.calls.every(([c]) =>
      ['controller:postgres-context', 'controller:inspect-postgres'].includes(c)
    )
  ).toBe(true)
})
it('does not query or claim runtime health when no database is selected', async () => {
  context.database.selected = null
  render(view())
  await open()
  expect(screen.getByText(t.selection)).toBeTruthy()
  expect(screen.queryByRole('button', { name: t.load })).toBeNull()
  expect(screen.queryByText(t.verified)).toBeNull()
})
it.each(['permissions', 'framework'] as const)(
  'disables unsupported %s with an explanation before IPC',
  (kind) => {
    if (kind === 'permissions') binding.scopes = ['read']
    else project.framework = 'static-spa'
    render(view())
    const button = screen.getByRole('button', { name: t.open })
    expect(button).toHaveProperty('disabled', true)
    expect(button.getAttribute('title')).toBe(t.unsupported)
    expect(invoke).not.toHaveBeenCalled()
  }
)
it('distinguishes an empty table list from a failed read and never shows remote error text', async () => {
  render(view())
  await open()
  invoke.mockResolvedValueOnce({
    ok: false,
    error: { technical: 'PRIVATE_REMOTE_PASSWORD', message: 'PRIVATE_REMOTE_PASSWORD' }
  })
  fireEvent.click(screen.getByRole('button', { name: t.load }))
  await screen.findByText(t.unavailable)
  expect(screen.queryByText(t.empty)).toBeNull()
  expect(document.body.textContent).not.toContain('PRIVATE_REMOTE_PASSWORD')
  invoke.mockResolvedValueOnce({ ok: true, data: result({ operation: 'tables' }, []) })
  fireEvent.click(screen.getByRole('button', { name: t.load }))
  await screen.findByText(t.empty)
})
it('requires configuration refresh after stale-source errors', async () => {
  render(view())
  await open()
  await load()
  invoke.mockResolvedValueOnce({ ok: false, error: { technical: 'POSTGRES_CHANGED' } })
  fireEvent.click(screen.getByRole('button', { name: 'public.notes' }))
  await screen.findByText(t.changed)
  expect(screen.queryByRole('button', { name: t.load })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: t.refresh }))
  await screen.findByRole('button', { name: t.load })
})
it('discards a foreign database response and clears previously shown rows', async () => {
  render(view())
  await open()
  await load()
  const bad = result({ operation: 'rows', schema: 'public', table: 'notes', limit: 25 })
  bad.instance.database_id = '66666666-6666-4666-8666-666666666666'
  invoke.mockResolvedValueOnce({ ok: true, data: bad })
  fireEvent.click(screen.getByRole('button', { name: 'public.notes' }))
  await screen.findByText(t.changed)
  expect(screen.queryByText('notes-value')).toBeNull()
})
it('ignores a late sample when a different table has already completed', async () => {
  render(view())
  await open()
  await load()
  const old = result({ operation: 'rows', schema: 'public', table: 'notes', limit: 25 })
  let finish!: (value: unknown) => void
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  fireEvent.click(screen.getByRole('button', { name: 'public.notes' }))
  fireEvent.click(screen.getByRole('button', { name: 'public.users' }))
  await screen.findByText('users-value')
  await act(async () => finish({ ok: true, data: old }))
  expect(screen.queryByText('notes-value')).toBeNull()
})
it('drops an in-flight response on project change', async () => {
  const rendered = render(view())
  await open()
  await load()
  const old = result({ operation: 'rows', schema: 'public', table: 'notes', limit: 25 })
  let finish!: (value: unknown) => void
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  fireEvent.click(screen.getByRole('button', { name: 'public.notes' }))
  project = {
    ...project,
    request_key: '77777777-7777-4777-8777-777777777777',
    app_id: 43,
    app_name: 'other-app'
  }
  rendered.rerender(view())
  await act(async () => finish({ ok: true, data: old }))
  expect(screen.queryByText('notes-value')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('removes samples when closed and does not reload them automatically', async () => {
  render(view())
  await open()
  await load()
  fireEvent.click(screen.getByRole('button', { name: 'public.notes' }))
  await screen.findByText('notes-value')
  fireEvent.click(screen.getByText(t.close).closest('button')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await open()
  expect(screen.queryByText('notes-value')).toBeNull()
  expect(screen.queryByRole('button', { name: 'public.notes' })).toBeNull()
})
it('renders values as text and uses a selected bounded row limit', async () => {
  render(view())
  await open()
  await load()
  fireEvent.mouseDown(screen.getByRole('combobox', { name: t.count }))
  fireEvent.click(await screen.findByText('100'))
  const read = { operation: 'rows' as const, schema: 'public', table: 'notes', limit: 100 }
  invoke.mockResolvedValueOnce({
    ok: true,
    data: result(read, [{ id: 1, marker: '<img src=x onerror=alert(1)>' }])
  })
  fireEvent.click(screen.getByRole('button', { name: 'public.notes' }))
  await screen.findByText('<img src=x onerror=alert(1)>')
  expect(document.querySelector('img[src=x]')).toBeNull()
  expect(invoke.mock.calls.at(-1)?.[1].read.limit).toBe(100)
})
it('marks snapshots stale after60seconds without polling data', async () => {
  render(view())
  await open()
  vi.useFakeTimers()
  try {
    await act(async () => fireEvent.click(screen.getByRole('button', { name: t.load })))
    expect(screen.getByText(t.verified)).toBeTruthy()
    const count = invoke.mock.calls.length
    act(() => vi.advanceTimersByTime(60001))
    expect(screen.getByText(t.stale)).toBeTruthy()
    expect(invoke.mock.calls).toHaveLength(count)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})
it.each(['vi', 'en', 'jp', 'cn'] as const)(
  'shows localized explorer copy for %s',
  async (locale) => {
    useUiState.setState({ locale })
    render(view())
    const copy = POSTGRES_INSPECTOR_COPY[locale]
    fireEvent.click(screen.getByRole('button', { name: copy.open }))
    await screen.findByRole('dialog')
    expect(screen.getByText(copy.note)).toBeTruthy()
    await screen.findByRole('button', { name: copy.load })
  }
)
