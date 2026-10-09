// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App, DeployEvent, DeployInput, DetectionResultDto, Vps } from '@shared/ipc'

import { DeployPage } from './DeployPage'
import { getConfigSignature, isSecretKey } from './deployRun'
import { getStrings, strings } from '../strings'
import { useUiState } from '../store/uiState'

const { termInstances, terminalOptions } = vi.hoisted(() => {
  const termInstances: Array<{
    write: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }> = []
  const terminalOptions: Array<Record<string, unknown>> = []
  return { termInstances, terminalOptions }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn()
    loadAddon = vi.fn()
    open = vi.fn((container: HTMLElement) => {
      const viewport = document.createElement('div')
      viewport.className = 'xterm-viewport'
      container.appendChild(viewport)
    })
    dispose = vi.fn()
    scrollToBottom = vi.fn()
    getSelection = (): string => ''
    constructor(options: Record<string, unknown>) {
      terminalOptions.push(options)
      termInstances.push(this)
    }
  }
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  }
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext = vi.fn()
  }
}))

function writtenLog(): string {
  return termInstances
    .flatMap((term) => term.write.mock.calls.map((call) => String(call[0])))
    .join('')
}

const VPS_A: Vps = {
  id: 1,
  name: 'VM01',
  host: '203.0.113.55',
  port: 22,
  host_fingerprint: null,
  username: 'root',
  auth_type: 'password',
  provider: 'WiService',
  region: 'Hanoi',
  docker_version: '29.4.3',
  last_status: 'unknown',
  last_seen_at: null,
  created_at: '2026-08-19T00:00:00Z'
}

const VPS_B: Vps = {
  ...VPS_A,
  id: 2,
  name: 'VM02',
  host: '203.0.113.56'
}

const APP_1: App = {
  id: 10,
  vps_id: 1,
  name: 'preselected-api',
  framework: 'express',
  host_port: 30000,
  container_port: 3000,
  healthcheck_path: '/health',
  needs_db: 0,
  current_deployment_id: 1,
  url: 'http://203.0.113.55:30000'
}

const APP_2: App = {
  id: 20,
  vps_id: 2,
  name: 'app-on-vps-2',
  framework: 'express',
  host_port: 30001,
  container_port: 3000,
  healthcheck_path: '/health',
  needs_db: 0,
  current_deployment_id: 2,
  url: 'http://203.0.113.56:30001'
}

const SOURCE_PATH = 'D:\\src\\express-api'

const MATCHED: DetectionResultDto = {
  matched: true,
  framework: 'express',
  display_name: 'Express.js',
  build_command: 'npm ci --omit=dev',
  container_port: 3000,
  healthcheck_path: '/health',
  dockerfile_template: 'express.Dockerfile',
  required_env: ['PORT', 'SECRET_KEY', 'DATABASE_URL'],
  optional_env: ['DB_HOST'],
  needs_db: true,
  manual_steps: [],
  detected_version: '4.19.2',
  file_tree_preview: ['package.json', 'server.js']
}

const UNMATCHED: DetectionResultDto = {
  matched: false,
  hint: 'Khong thay package.json.',
  signals: [
    { framework: 'express', description: 'package.json co dependency express', passed: false },
    { framework: 'nextjs', description: 'package.json co dependency next', passed: false }
  ]
}

const PRECHECK_PASS = {
  passed: true,
  checks: [
    { label: 'RAM trống', required: '> 512 MB', actual: '2048 MB', ok: true },
    { label: 'Disk trống', required: '> 2 GB', actual: '15 GB', ok: true },
    { label: 'Cổng chưa dùng', required: 'cổng trống', actual: '30000 trống', ok: true }
  ],
  assigned_host_port: 30000,
  app_url: 'http://203.0.113.55:30000'
}

type InvokeHandler = (...args: unknown[]) => Promise<unknown>

function mockApi(handlers: Record<string, InvokeHandler>): {
  emit: (event: DeployEvent) => void
  invoke: ReturnType<typeof vi.fn>
} {
  const eventHandlers: Record<string, (payload: DeployEvent) => void> = {}
  const invoke = vi.fn((channel: string, ...args: unknown[]) => {
    const handler = handlers[channel]
    if (!handler) return Promise.reject(new Error(`No handler registered for '${channel}'`))
    return handler(...args)
  })
  vi.stubGlobal('api', {
    invoke,
    on: (channel: string, callback: (payload: DeployEvent) => void) => {
      if (channel === 'deploy:event') eventHandlers[channel] = callback
      return () => {}
    }
  })
  return {
    emit: (event) => {
      act(() => {
        const handler = eventHandlers['deploy:event']
        if (!handler) {
          throw new Error('deploy:event listener is not registered yet!')
        }
        handler(event)
      })
    },
    invoke
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useUiState.setState({ locale: 'en' })
  termInstances.length = 0
  terminalOptions.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const handersHappy: Record<string, InvokeHandler> = {
  'vps:list': async () => ({ ok: true, data: [VPS_A] }),
  'app:list': async () => ({ ok: true, data: [] }),
  'system:pick-folder': async () => ({ ok: true, data: { path: SOURCE_PATH } }),
  'deploy:detect': async () => ({ ok: true, data: MATCHED }),
  'deploy:precheck': async () => ({ ok: true, data: PRECHECK_PASS }),
  'deploy:start': async () => ({ ok: true, data: { deployment_id: 7 } }),
  'deploy:cancel': async () => ({ ok: true, data: undefined }),
  'system:open-external': async () => ({ ok: true, data: undefined })
}

/** Đi wizard tới bước 3: chọn folder -> detect -> điền env -> precheck. */
async function reachStep3(invoke: ReturnType<typeof vi.fn>): Promise<void> {
  fireEvent.click(await screen.findByText('Choose folder'))
  await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('deploy:detect', SOURCE_PATH))
  fireEvent.click(screen.getByText('Next'))
  await screen.findByText('Express.js')
  fireEvent.click(screen.getByText('Next'))
  await screen.findByLabelText('PORT')
  fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '3000' } })
  fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'sekret' } })
  fireEvent.click(screen.getByText('Next'))
  await screen.findByText('RAM trống')
}

describe('DeployPage source description locales', () => {
  it.each(['en', 'vi', 'cn', 'jp'] as const)(
    '%s keeps the Deploy description accurate for local and Git sources',
    async (locale) => {
      useUiState.setState({ locale })
      mockApi(handersHappy)
      const localized = getStrings(locale)
      render(<DeployPage />)

      await screen.findByText(localized.deploy.description)
      expect(screen.getByText(localized.deploy.description)).toBeTruthy()
      fireEvent.click(screen.getByText(localized.deploy.git.modeGit))
      expect(screen.getByText(localized.deploy.description)).toBeTruthy()
      fireEvent.click(screen.getByText(localized.deploy.git.modeLocal))
      expect(screen.getByText(localized.deploy.description)).toBeTruthy()
    }
  )
})

describe('DeployPage — wizard va log', () => {
  it('Git wizard prepares a pinned handle and uses the same handle/token for precheck and start', async () => {
    const prepared = {
      prepared_source_handle: 'opaque-test-handle',
      git_repo_url: 'https://github.com/example/public-demo.git',
      git_ref: 'main',
      git_root: 'apps/web',
      git_commit_sha: 'a'.repeat(40),
      detection: MATCHED
    }
    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:prepare-git': async () => ({ ok: true, data: prepared }),
      'deploy:precheck': async () => ({
        ok: true,
        data: { ...PRECHECK_PASS, precheck_token: 'opaque-precheck-token' }
      })
    })
    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    fireEvent.change(screen.getByPlaceholderText('my-app'), { target: { value: 'git-demo' } })
    fireEvent.click(screen.getByText(strings.deploy.git.modeGit))
    fireEvent.change(screen.getByLabelText(strings.deploy.git.repository), {
      target: { value: prepared.git_repo_url }
    })
    fireEvent.change(screen.getByLabelText(strings.deploy.git.ref), { target: { value: 'main' } })
    fireEvent.change(screen.getByLabelText(strings.deploy.git.root), {
      target: { value: 'apps/web' }
    })
    fireEvent.click(screen.getByText(strings.deploy.git.prepare))
    expect(await screen.findByText(prepared.git_commit_sha)).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith('deploy:prepare-git', expect.any(String), {
      source_type: 'git',
      git_repo_url: prepared.git_repo_url,
      git_ref: 'main',
      git_root: 'apps/web'
    })
    fireEvent.click(screen.getByText(strings.deploy.next))
    await screen.findByText('Express.js')
    fireEvent.click(screen.getByText(strings.deploy.next))
    fireEvent.change(await screen.findByLabelText('PORT'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'fake-test-secret' } })
    fireEvent.click(screen.getByText(strings.deploy.next))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('deploy:precheck', expect.anything()))
    expect(invoke).toHaveBeenCalledWith(
      'deploy:precheck',
      expect.objectContaining({
        source_type: 'git',
        prepared_source_handle: 'opaque-test-handle',
        app_name: 'git-demo'
      })
    )
    fireEvent.click(screen.getByText(strings.deploy.review.deploy))
    await screen.findByText('Deploy log')
    expect(invoke).toHaveBeenCalledWith(
      'deploy:start',
      expect.objectContaining({
        source_type: 'git',
        prepared_source_handle: 'opaque-test-handle',
        precheck_token: 'opaque-precheck-token'
      })
    )
    expect(
      invoke.mock.calls.some(
        ([channel, input]) => channel === 'deploy:start' && 'source_path' in (input as object)
      )
    ).toBe(false)
  })

  it('releases a Git snapshot that finishes preparing after the user switches back to local', async () => {
    let resolvePrepare: ((value: unknown) => void) | undefined
    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:prepare-git': async () =>
        new Promise((resolve) => {
          resolvePrepare = resolve
        })
    })
    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    fireEvent.click(screen.getByText(strings.deploy.git.modeGit))
    fireEvent.change(screen.getByLabelText(strings.deploy.git.repository), {
      target: { value: 'https://github.com/example/repo.git' }
    })
    fireEvent.click(screen.getByText(strings.deploy.git.prepare))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'deploy:prepare-git',
        expect.any(String),
        expect.any(Object)
      )
    )
    fireEvent.click(screen.getByText(strings.deploy.git.modeLocal))
    await act(async () =>
      resolvePrepare?.({
        ok: true,
        data: {
          prepared_source_handle: 'late-handle',
          git_repo_url: 'https://github.com/example/repo.git',
          git_ref: 'main',
          git_root: '.',
          git_commit_sha: 'c'.repeat(40),
          detection: MATCHED
        }
      })
    )
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('deploy:release-git-prepare', 'late-handle')
    )
    expect(screen.queryByText('c'.repeat(40))).toBeNull()
  })

  it('releases the previous snapshot before clearing it when re-prepare fails', async () => {
    const prepared = {
      prepared_source_handle: 'first-snapshot-handle',
      git_repo_url: 'https://github.com/example/repo.git',
      git_ref: 'main',
      git_root: '.',
      git_commit_sha: 'e'.repeat(40),
      detection: MATCHED
    }
    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:prepare-git': vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: prepared })
        .mockResolvedValueOnce({ ok: false, error: { message: 'Prepare failed' } })
    })
    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    fireEvent.click(screen.getByText(strings.deploy.git.modeGit))
    fireEvent.change(screen.getByLabelText(strings.deploy.git.repository), {
      target: { value: prepared.git_repo_url }
    })

    fireEvent.click(screen.getByText(strings.deploy.git.prepare))
    expect(await screen.findByText(prepared.git_commit_sha)).toBeTruthy()
    fireEvent.click(screen.getByText(strings.deploy.git.prepare))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('deploy:release-git-prepare', 'first-snapshot-handle')
    )
    await waitFor(() =>
      expect(
        invoke.mock.calls.filter(([channel]) => channel === 'deploy:prepare-git')
      ).toHaveLength(2)
    )
    expect(screen.queryByText(prepared.git_commit_sha)).toBeNull()
    expect(
      invoke.mock.calls.filter(
        ([channel, handle]) =>
          channel === 'deploy:release-git-prepare' && handle === 'first-snapshot-handle'
      )
    ).toHaveLength(1)
  })

  it.each(['repository', 'ref', 'root', 'app'] as const)(
    'cancels a pending prepare and releases its late handle when %s changes',
    async (changedField) => {
      let resolvePrepare: ((value: unknown) => void) | undefined
      const { invoke } = mockApi({
        ...handersHappy,
        'app:list': async () => ({ ok: true, data: [APP_1] }),
        'deploy:prepare-git': async () =>
          new Promise((resolve) => {
            resolvePrepare = resolve
          })
      })
      render(<DeployPage />)
      await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
      fireEvent.click(screen.getByText(strings.deploy.git.modeGit))
      fireEvent.change(screen.getByLabelText(strings.deploy.git.repository), {
        target: { value: 'https://github.com/example/repo.git' }
      })
      fireEvent.click(screen.getByText(strings.deploy.git.prepare))
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          'deploy:prepare-git',
          expect.any(String),
          expect.any(Object)
        )
      )
      const requestId = invoke.mock.calls.find(([channel]) => channel === 'deploy:prepare-git')?.[1]

      if (changedField === 'repository') {
        fireEvent.change(screen.getByLabelText(strings.deploy.git.repository), {
          target: { value: 'https://github.com/example/other.git' }
        })
      } else if (changedField === 'ref') {
        fireEvent.change(screen.getByLabelText(strings.deploy.git.ref), {
          target: { value: 'next' }
        })
      } else if (changedField === 'root') {
        fireEvent.change(screen.getByLabelText(strings.deploy.git.root), {
          target: { value: 'packages/app' }
        })
      } else {
        fireEvent.click(screen.getByText(strings.deploy.targetApp.existing))
        fireEvent.change(screen.getByLabelText(strings.deploy.targetApp.selectApp), {
          target: { value: String(APP_1.id) }
        })
      }

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('deploy:cancel-git-prepare', requestId)
      )
      await act(async () =>
        resolvePrepare?.({
          ok: true,
          data: {
            prepared_source_handle: `late-handle-${changedField}`,
            git_repo_url: 'https://github.com/example/repo.git',
            git_ref: 'main',
            git_root: '.',
            git_commit_sha: 'd'.repeat(40),
            detection: MATCHED
          }
        })
      )
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          'deploy:release-git-prepare',
          `late-handle-${changedField}`
        )
      )
      expect(screen.queryByText('d'.repeat(40))).toBeNull()
    }
  )

  it('hien thi va cho chon tat ca VPS trong danh sach trien khai', async () => {
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] })
    })

    render(<DeployPage />)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    const target = screen.getByRole('combobox')
    expect(screen.getByRole('option', { name: 'VM01 — 203.0.113.55:22' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'VM02 — 203.0.113.56:22' })).toBeTruthy()
    fireEvent.change(target, { target: { value: '2' } })

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 2))
  })

  it('happy path: chon VPS tu dong, detect, dien env, precheck, deploy, log live, mo URL', async () => {
    const { emit, invoke } = mockApi(handersHappy)

    render(<DeployPage />)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    expect(screen.getByText('VM01 — 203.0.113.55:22')).toBeTruthy()

    await reachStep3(invoke)

    expect(invoke).toHaveBeenCalledWith('deploy:precheck', {
      vps_id: 1,
      app_id: undefined,
      app_name: 'express-api',
      source_path: SOURCE_PATH,
      env: { PORT: '3000', SECRET_KEY: 'sekret' }
    })
    expect(screen.getByText('http://203.0.113.55:30000')).toBeTruthy()

    fireEvent.click(screen.getByText(strings.deploy.review.deploy))

    expect(await screen.findByText('Deploy log')).toBeTruthy()
    expect(screen.getByText('Live output')).toBeTruthy()
    expect(terminalOptions[0]?.convertEol).toBe(true)
    expect(invoke).toHaveBeenCalledWith('deploy:start', {
      vps_id: 1,
      app_id: undefined,
      host_port: 30000,
      app_name: 'express-api',
      source_path: SOURCE_PATH,
      env: { PORT: '3000', SECRET_KEY: 'sekret' }
    })

    emit({ type: 'step-start', deployment_id: 7, step: 'PRECHECK', ts: '2026-08-19T10:00:00Z' })
    emit({
      type: 'log',
      deployment_id: 7,
      step: 'PRECHECK',
      chunk: 'Kiem tra RAM...\n',
      stream: 'stdout'
    })
    emit({ type: 'step-done', deployment_id: 7, step: 'PRECHECK', duration_ms: 2000 })
    emit({ type: 'step-start', deployment_id: 9, step: 'UPLOAD', ts: '2026-08-19T10:00:02Z' })
    emit({ type: 'step-done', deployment_id: 7, step: 'UPLOAD', duration_ms: 8000 })
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 15000,
      app_url: 'http://203.0.113.55:30000'
    })

    await waitFor(() => expect(writtenLog()).toContain('Kiem tra RAM...'))
    expect((await screen.findAllByText('Deploy succeeded in 15s')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByText('Open app')[0])
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('system:open-external', 'http://203.0.113.55:30000')
    )
  })

  it('deploy that bai: banner bao dung buoc + khong co nut Mo app, quay lai wizard giu source', async () => {
    const { emit, invoke } = mockApi(handersHappy)

    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(screen.getByText(strings.deploy.review.deploy))
    await screen.findByText('Deploy log')

    emit({ type: 'step-start', deployment_id: 7, step: 'BUILD', ts: '2026-08-19T10:00:00Z' })
    emit({
      type: 'log',
      deployment_id: 7,
      step: 'BUILD',
      chunk: 'ERROR: npm install that bai\n',
      stream: 'stderr'
    })
    emit({
      type: 'step-failed',
      deployment_id: 7,
      step: 'BUILD',
      error: {
        code: 'DOCKER_BUILD_FAILED',
        message: 'Build that bai. Kiem tra build command.',
        technical: 'exit 1'
      },
      last_log_lines: ['ERROR: npm install that bai']
    })
    emit({ type: 'finished', deployment_id: 7, status: 'failed', total_duration_ms: 30000 })

    expect(
      (await screen.findAllByText(strings.deploy.log.failedStep(strings.deploy.log.steps.BUILD)))
        .length
    ).toBeGreaterThan(0)
    expect(screen.getByText('Build that bai. Kiem tra build command.')).toBeTruthy()
    await waitFor(() => expect(writtenLog()).toContain('ERROR: npm install that bai'))
    expect(screen.queryByText('Open app')).toBeNull()

    fireEvent.click(screen.getByText('Back to wizard'))
    expect(await screen.findByText('Choose again')).toBeTruthy()
    expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy()
  })

  it('huy giua chung: confirm roi goi deploy:cancel voi dung deployment id', async () => {
    const { invoke } = mockApi(handersHappy)

    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(screen.getByText(strings.deploy.review.deploy))
    await screen.findByText('Deploy log')

    fireEvent.click(screen.getByText('Cancel deploy'))
    expect((await screen.findAllByText(/Stop the deploy midway/)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Stop'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('deploy:cancel', 7))
  })

  it('detect khong khop: buoc Nhan dien hien card do kem cac dau hieu, khong di tiep duoc', async () => {
    mockApi({ ...handersHappy, 'deploy:detect': async () => ({ ok: true, data: UNMATCHED }) })

    render(<DeployPage />)
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())
    fireEvent.click(screen.getByText('Next'))

    expect(await screen.findByText('Framework not recognized')).toBeTruthy()
    expect(screen.getByText('package.json co dependency express')).toBeTruthy()
    expect(() => screen.getByText('Express.js')).toThrow()
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('precheck khong dat: hang do + nut Deploy disabled + giai thich', async () => {
    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:precheck': async () => ({
        ok: true,
        data: {
          passed: false,
          checks: [
            { label: 'RAM trống', required: '> 512 MB', actual: '100 MB', ok: false },
            { label: 'Disk trống', required: '> 2 GB', actual: '15 GB', ok: true },
            { label: 'Cổng chưa dùng', required: 'cổng trống', actual: '30000 trống', ok: true }
          ],
          assigned_host_port: 30000,
          app_url: 'http://203.0.113.55:30000'
        }
      })
    })

    render(<DeployPage />)
    await reachStep3(invoke)

    expect(screen.getByText('100 MB')).toBeTruthy()
    expect(
      screen.getByText('Precheck is not green — fix it on the VPS, then click Check again.')
    ).toBeTruthy()
    expect(
      (screen.getByText(strings.deploy.review.deploy).closest('button') as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it('exposure bi degraded: Doctor chan doan, hien Safe auto-fix, fix xong cap nhat reachable va hien nut Mo app', async () => {
    const { emit, invoke } = mockApi({
      ...handersHappy,
      'doctor:diagnose': async () => ({
        ok: true,
        data: {
          fix_id: 'fix_ufw_port',
          safe_to_auto_fix: true,
          title: 'Mở cổng UFW 30000',
          confidence: 'high',
          evidence: ['Cổng 30000 bị UFW chặn'],
          suggested_action: 'Mở cổng 30000 trên UFW'
        }
      }),
      'doctor:fix': async () => ({
        ok: true,
        data: {
          action_id: 1,
          fix_id: 'fix_ufw_port',
          status: 'verified',
          exposure_status: 'reachable',
          message: 'Đã mở cổng 30000 trên UFW và kiểm tra thành công.'
        }
      })
    })

    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(screen.getByText(strings.deploy.review.deploy))
    await screen.findByText('Deploy log')

    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 12000,
      exposure_status: 'degraded'
    })

    expect(await screen.findByText(strings.deploy.exposure.degradedTitle)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.blockedHint)).toBeTruthy()
    expect(screen.getByText(strings.deploy.doctor.diagnose)).toBeTruthy()
    expect(screen.queryByText(strings.deploy.doctor.autoFix)).toBeNull()

    // Chạy Doctor diagnose
    fireEvent.click(screen.getByText(strings.deploy.doctor.diagnose))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('doctor:diagnose', {
        deployment_id: 7,
        evidence: {
          logs: '',
          container_state: { status: 'running' },
          external_probe: 'unreachable'
        }
      })
    )

    // Bằng chứng chẩn đoán và nút Safe auto-fix xuất hiện
    expect(await screen.findByText(/Mở cổng UFW 30000/)).toBeTruthy()
    const autoFixBtn = screen.getByText(strings.deploy.doctor.autoFix)
    expect(autoFixBtn).toBeTruthy()

    // Chạy Safe auto-fix
    fireEvent.click(autoFixBtn)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('doctor:fix', {
        fix_id: 'fix_ufw_port',
        deployment_id: 7
      })
    )

    // Reactive update: trạng thái chuyển sang reachable, banner thành công và nút Open app xuất hiện
    await waitFor(
      () => {
        expect(screen.queryByText(strings.deploy.exposure.degradedTitle)).toBeNull()
        expect(screen.getAllByText(strings.deploy.log.openApp).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/Deploy succeeded/).length).toBeGreaterThan(0)
        expect(screen.getByText('http://203.0.113.55:30000')).toBeTruthy()
      },
      { timeout: 10000 }
    )
  })

  it('named_tunnel bi vo hieu hoa khi chua co CNAME target hop le', async () => {
    const { emit, invoke } = mockApi(handersHappy)

    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(screen.getByText(strings.deploy.review.deploy))

    // Bảo đảm deploy:start đã được gọi và trạng thái deploy (Deploy log, Live output) đã sẵn sàng
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('deploy:start', expect.anything()))
    expect(await screen.findByText('Deploy log')).toBeTruthy()
    expect(await screen.findByText('Live output')).toBeTruthy()

    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 10000,
      app_url: 'http://203.0.113.55:30000'
    })

    // Chờ kết quả UI Domain xuất hiện với thời gian phù hợp
    expect(
      await screen.findByText(strings.deploy.domain.title, {}, { timeout: 10000 })
    ).toBeTruthy()
    const select = screen.getByRole('combobox', { name: 'Domain mode' })
    expect(select).toBeTruthy()

    fireEvent.mouseDown(select)
    const disabledOption = await screen.findByText(
      strings.deploy.domain.namedTunnelDisabled,
      {},
      { timeout: 10000 }
    )
    expect(disabledOption.closest('.ant-select-item-option-disabled')).toBeTruthy()
  })

  it('đổi ngôn ngữ theo bốn ngôn ngữ và cập nhật nội dung DeployPage', async () => {
    mockApi(handersHappy)
    useUiState.setState({ locale: 'vi' })

    const { rerender } = render(<DeployPage />)

    // 1. Tiếng Việt
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Triển khai ứng dụng' })
    ).toBeTruthy()
    expect(screen.getByText('Chọn thư mục')).toBeTruthy()
    expect(screen.getByText('Thư mục mã nguồn')).toBeTruthy()
    expect(
      screen.getByText('Chữ thường a-z, chữ số và dấu gạch ngang — phải bắt đầu bằng chữ cái.')
    ).toBeTruthy()

    // 2. English
    act(() => {
      useUiState.setState({ locale: 'en' })
    })
    rerender(<DeployPage />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Deploy an application' })
    ).toBeTruthy()
    expect(screen.getByText('Choose folder')).toBeTruthy()
    expect(screen.getByText('Source folder')).toBeTruthy()
    expect(
      screen.getByText('Lowercase a-z, digits and dashes — must start with a letter.')
    ).toBeTruthy()

    // 3. 简体中文
    act(() => {
      useUiState.setState({ locale: 'cn' })
    })
    rerender(<DeployPage />)
    expect(await screen.findByRole('heading', { level: 1, name: '部署应用程序' })).toBeTruthy()
    expect(screen.getByText('选择文件夹')).toBeTruthy()
    expect(screen.getByText('源码文件夹')).toBeTruthy()
    expect(screen.getByText('仅限小写字母 a-z、数字和连字符，且必须以字母开头。')).toBeTruthy()

    // 4. 日本語
    act(() => {
      useUiState.setState({ locale: 'jp' })
    })
    rerender(<DeployPage />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'アプリケーションデプロイ' })
    ).toBeTruthy()
    expect(screen.getByText('フォルダを選択')).toBeTruthy()
    expect(screen.getByText('ソースフォルダ')).toBeTruthy()
    expect(
      screen.getByText('英小文字 a-z、数字、ハイフン（先頭は英文字である必要があります）。')
    ).toBeTruthy()
  })

  it('preselect voi app ton tai: giu nguyen VPS va app sau khi load, dien dung appName, truyen dung app_id len precheck', async () => {
    useUiState.setState({ deployPreselect: { vpsId: 1, appId: 10 } })
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'app:list': async (id) => (id === 1 ? { ok: true, data: [APP_1] } : { ok: true, data: [] })
    })

    render(<DeployPage />)

    // Chờ tải xong và kiểm tra VPS + app được giữ nguyên
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    expect(screen.getByRole('option', { name: 'VM01 — 203.0.113.55:22' })).toBeTruthy()

    // Radio Ứng dụng hiện có được chọn
    const existingRadio = screen.getByRole('radio', { name: strings.deploy.targetApp.existing })
    expect((existingRadio as HTMLInputElement).checked).toBe(true)

    // Combobox app hiển thị tên APP_1
    expect(screen.getByRole('option', { name: /preselected-api — port 30000/ })).toBeTruthy()

    // Chọn thư mục mã nguồn: appName không bị ghi đè thành tên thư mục
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())

    // Đi tiếp tới review/precheck
    fireEvent.click(screen.getByText('Next'))
    await screen.findByText('Express.js')
    fireEvent.click(screen.getByText('Next'))
    await screen.findByLabelText('PORT')
    fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'sekret' } })
    fireEvent.click(screen.getByText('Next'))
    await screen.findByText('RAM trống')

    // Precheck nhận đúng app_id: 10 và app_name: 'preselected-api'
    expect(invoke).toHaveBeenCalledWith('deploy:precheck', {
      vps_id: 1,
      app_id: 10,
      app_name: 'preselected-api',
      source_path: SOURCE_PATH,
      env: { PORT: '3000', SECRET_KEY: 'sekret' }
    })
  })

  it('preselect voi app khong ton tai tren VPS: hien thi loi co nut chuyen sang app moi, khong am tham doi sang app/VPS khac', async () => {
    useUiState.setState({ deployPreselect: { vpsId: 1, appId: 999 } })
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'app:list': async () => ({ ok: true, data: [APP_1] })
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Banner lỗi xuất hiện giải thích app không thuộc VPS
    expect(await screen.findByText(strings.deploy.preselectAppNotFound)).toBeTruthy()
    expect(screen.getByText('App ID: 999')).toBeTruthy()

    // Nút Next bị vô hiệu hoá
    const nextBtn = screen.getByRole('button', { name: strings.deploy.next }) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Bấm nút khôi phục: "Chuyển sang ứng dụng mới"
    const switchBtn = screen.getByText(strings.deploy.switchToNewApp)
    fireEvent.click(switchBtn)

    // Lỗi biến mất và chuyển sang chế độ ứng dụng mới
    expect(screen.queryByText(strings.deploy.preselectAppNotFound)).toBeNull()
    const newRadio = screen.getByRole('radio', { name: strings.deploy.targetApp.new })
    expect((newRadio as HTMLInputElement).checked).toBe(true)
  })

  it('preselect voi VPS khong ton tai: hien thi loi co nut chon VPS co san, khong am tham doi VPS', async () => {
    useUiState.setState({ deployPreselect: { vpsId: 888, appId: 10 } })
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] })
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('vps:list'))

    // Banner lỗi xuất hiện
    expect(await screen.findByText(strings.deploy.preselectVpsNotFound)).toBeTruthy()
    expect(screen.getByText('VPS ID: 888')).toBeTruthy()

    // Không âm thầm gọi app:list với VPS khác
    expect(invoke).not.toHaveBeenCalledWith('app:list', 1)

    // Nút Next bị vô hiệu hoá
    const nextBtn = screen.getByRole('button', { name: strings.deploy.next }) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Bấm nút khôi phục: "Chọn máy chủ có sẵn"
    const chooseBtn = screen.getByText(strings.deploy.chooseAvailableVps)
    fireEvent.click(chooseBtn)

    // Lỗi biến mất và chọn VPS 1
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))
    expect(screen.queryByText(strings.deploy.preselectVpsNotFound)).toBeNull()
  })

  it('app:list gap loi: hien thi thong bao kem nut thu lai', async () => {
    let callCount = 0
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'app:list': async () => {
        callCount++
        if (callCount === 1) {
          return { ok: false, error: { message: 'SSH connection refused' } }
        }
        return { ok: true, data: [APP_1] }
      }
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Chuyển sang radio Ứng dụng hiện có để xem app:list
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.existing }))

    // Hiển thị lỗi appLoadError
    expect(await screen.findByText(strings.deploy.appLoadError)).toBeTruthy()
    expect(screen.getByText('SSH connection refused')).toBeTruthy()

    // Bấm nút thử lại
    fireEvent.click(screen.getByRole('button', { name: strings.common.retry }))

    // Gọi lại app:list lần 2 thành công, hiển thị APP_1
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3)) // 1 vps:list + 2 app:list
    expect(await screen.findByRole('option', { name: /preselected-api — port 30000/ })).toBeTruthy()
    expect(screen.queryByText(strings.deploy.appLoadError)).toBeNull()
  })

  it('doi VPS nhanh: phan hoi cu cua app:list khong ghi de danh sach app cua VPS moi', async () => {
    let resolveVps1: (val: unknown) => void = () => {}
    const vps1Promise = new Promise((res) => {
      resolveVps1 = res
    })

    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'app:list': async (id) => {
        if (id === 1) {
          await vps1Promise
          return { ok: true, data: [APP_1] }
        }
        return { ok: true, data: [APP_2] }
      }
    })

    render(<DeployPage />)

    // Khởi tạo app:list(1) nhưng bị hoãn
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Người dùng nhanh tay đổi sang VPS 2
    const vpsSelect = screen.getByRole('combobox')
    fireEvent.change(vpsSelect, { target: { value: '2' } })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 2))

    // Bật chế độ existing để kiểm tra danh sách app
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.existing }))

    // VPS 2 đã trả về APP_2
    expect(await screen.findByRole('option', { name: /app-on-vps-2 — port 30001/ })).toBeTruthy()

    // Bây giờ phản hồi cũ của VPS 1 mới hoàn thành
    act(() => {
      resolveVps1(undefined)
    })

    // Danh sách vẫn giữ APP_2, không bị APP_1 ghi đè
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /app-on-vps-2 — port 30001/ })).toBeTruthy()
    })
    expect(screen.queryByRole('option', { name: /preselected-api/ })).toBeNull()
  })

  it('phan biet loi vps:list voi danh sach VPS rong', async () => {
    // 1. Khi vps:list bị lỗi: hiển thị Alert kèm nút Thử lại, không hiển thị Empty
    const { invoke: invokeError } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: false, error: { message: 'Database connection failed' } })
    })

    const { unmount } = render(<DeployPage />)
    await waitFor(() => expect(invokeError).toHaveBeenCalledWith('vps:list'))

    expect(await screen.findByText(strings.deploy.vpsLoadError)).toBeTruthy()
    expect(screen.getByText('Database connection failed')).toBeTruthy()
    expect(screen.queryByText(strings.deploy.noVps)).toBeNull()
    unmount()

    // 2. Khi vps:list thành công nhưng rỗng: hiển thị Empty, không hiển thị Alert lỗi
    const { invoke: invokeEmpty } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [] })
    })

    render(<DeployPage />)
    await waitFor(() => expect(invokeEmpty).toHaveBeenCalledWith('vps:list'))

    expect(await screen.findByText(strings.deploy.noVps)).toBeTruthy()
    expect(screen.queryByText(strings.deploy.vpsLoadError)).toBeNull()
  })

  it('doi VPS khi app:list dang cho: vo hieu hoa Tiep tuc va bo app_id cu ngay', async () => {
    let resolveVps2Apps: (val: unknown) => void = () => {}
    const vps2AppsPromise = new Promise((res) => {
      resolveVps2Apps = res
    })

    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'app:list': async (id) => {
        if (id === 1) return { ok: true, data: [APP_1] }
        await vps2AppsPromise
        return { ok: true, data: [APP_2] }
      }
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Chọn thư mục nguồn
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())

    // Chuyển sang Ứng dụng hiện có và chọn APP_1
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.existing }))
    const appSelect = await screen.findByRole('combobox', {
      name: strings.deploy.targetApp.selectApp
    })
    fireEvent.change(appSelect, { target: { value: '10' } })

    // Lúc này nút Tiếp tục đã enabled
    const nextBtn = screen.getByRole('button', { name: strings.deploy.next }) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(false)

    // Đổi sang VPS 2 (app:list đang chờ)
    const vpsSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(vpsSelect, { target: { value: '2' } })

    // Ngay trong lúc app:list đang chờ:
    // 1. Nút Tiếp tục bị vô hiệu hoá
    expect(nextBtn.disabled).toBe(true)
    // 2. Hiển thị trạng thái đang tải app
    expect(screen.getByText(strings.deploy.appLoading)).toBeTruthy()

    // Cho app:list VPS 2 resolve
    act(() => {
      resolveVps2Apps(undefined)
    })
    await waitFor(() => expect(screen.queryByText(strings.deploy.appLoading)).toBeNull())

    // Sau khi tải xong, app đầu tiên KHÔNG tự chọn: giá trị appSelect vẫn là -1
    const updatedAppSelect = screen.getByRole('combobox', {
      name: strings.deploy.targetApp.selectApp
    }) as HTMLSelectElement
    expect(updatedAppSelect.value).toBe('-1')
    expect(nextBtn.disabled).toBe(true)
  })

  it('chon app sau khi tai o che do ung dung hien co va chay precheck voi dung cap VPS/app', async () => {
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'app:list': async (id) => {
        if (id === 1) return { ok: true, data: [APP_1] }
        return { ok: true, data: [APP_2] }
      }
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Chọn thư mục nguồn
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())

    // Đổi sang VPS 2
    const vpsSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(vpsSelect, { target: { value: '2' } })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 2))

    // Chọn radio Ứng dụng hiện có
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.existing }))

    // Tiếp tục vẫn disabled vì chưa chọn app
    const nextBtn = screen.getByRole('button', { name: strings.deploy.next }) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Chọn APP_2 từ combobox
    const appSelect = screen.getByRole('combobox', {
      name: strings.deploy.targetApp.selectApp
    })
    fireEvent.change(appSelect, { target: { value: '20' } })

    // Giờ Tiếp tục đã enabled
    expect(nextBtn.disabled).toBe(false)
    fireEvent.click(nextBtn)

    // Đi qua Step 1 (Detect)
    await screen.findByText('Express.js')
    fireEvent.click(screen.getByText('Next'))

    // Step 2 (Config)
    await screen.findByLabelText('PORT')
    fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'sekret' } })
    fireEvent.click(screen.getByText('Next'))

    // Step 3 (Review & Precheck)
    await screen.findByText('RAM trống')
    expect(invoke).toHaveBeenCalledWith('deploy:precheck', {
      vps_id: 2,
      app_id: 20,
      app_name: 'app-on-vps-2',
      source_path: SOURCE_PATH,
      env: { PORT: '3000', SECRET_KEY: 'sekret' }
    })
  })

  it('retry vps:list giu nguyen preselect cho den khi ap dung thanh cong', async () => {
    useUiState.setState({ deployPreselect: { vpsId: 2, appId: 20 } })
    let callCount = 0
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => {
        callCount++
        if (callCount === 1) {
          return { ok: false, error: { message: 'Network timeout' } }
        }
        return { ok: true, data: [VPS_A, VPS_B] }
      },
      'app:list': async (id) => (id === 2 ? { ok: true, data: [APP_2] } : { ok: true, data: [] })
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('vps:list'))

    // Lần 1 lỗi: hiển thị alert kèm nút Thử lại
    expect(await screen.findByText(strings.deploy.vpsLoadError)).toBeTruthy()
    expect(screen.getByText('Network timeout')).toBeTruthy()

    // Bấm nút Thử lại
    const retryBtn = screen.getByRole('button', { name: strings.common.retry })
    fireEvent.click(retryBtn)

    // Lần 2 thành công: preselect vẫn giữ nguyên VPS 2 và APP 2!
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 2))
    expect(await screen.findByRole('option', { name: 'VM02 — 203.0.113.56:22' })).toBeTruthy()
    expect(screen.getByRole('option', { name: /app-on-vps-2 — port 30001/ })).toBeTruthy()

    // Sau khi áp dụng thành công, preselect trong store đã được xóa
    expect(useUiState.getState().deployPreselect).toBeNull()
  })

  it('hien thi trang thai dang tai ban dau thay cho thong bao chua co VPS thoang qua', async () => {
    let resolveVpsList: (val: unknown) => void = () => {}
    const vpsListPromise = new Promise((res) => {
      resolveVpsList = res
    })

    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => {
        await vpsListPromise
        return { ok: true, data: [] }
      }
    })

    render(<DeployPage />)
    expect(invoke).toHaveBeenCalledWith('vps:list')

    // Trong lúc đang tải: hiển thị spinner loading, KHÔNG hiển thị thông báo chưa có VPS
    expect(screen.getByText(strings.deploy.vpsLoading)).toBeTruthy()
    expect(screen.queryByText(strings.deploy.noVps)).toBeNull()

    // Cho vps:list hoàn thành với danh sách rỗng
    act(() => {
      resolveVpsList(undefined)
    })

    // Bây giờ mới hiển thị thông báo chưa có VPS
    expect(await screen.findByText(strings.deploy.noVps)).toBeTruthy()
    expect(screen.queryByText(strings.deploy.vpsLoading)).toBeNull()
  })

  it('nhap ten tuy chinh -> chon/doi thu muc -> doi VPS -> deploy:precheck xac nhan app_name van dung', async () => {
    let currentFolder = 'D:\\src\\express-api'
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A, VPS_B] }),
      'app:list': async () => ({ ok: true, data: [] }),
      'system:pick-folder': async () => ({ ok: true, data: { path: currentFolder } })
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // 1. Nhập tên tùy chỉnh ở bước Nguồn
    const nameInput = screen.getByPlaceholderText('my-app') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'custom-app-service' } })
    expect(nameInput.value).toBe('custom-app-service')

    // 2. Chọn thư mục lần 1
    fireEvent.click(screen.getByText(strings.deploy.pickFolder))
    await waitFor(() => expect(screen.getByDisplayValue('D:\\src\\express-api')).toBeTruthy())
    // Tên tùy chỉnh vẫn giữ nguyên, không bị ghi đè bởi express-api
    expect(nameInput.value).toBe('custom-app-service')

    // 3. Đổi thư mục lần 2
    currentFolder = 'D:\\projects\\another-tool'
    fireEvent.click(screen.getByText(strings.deploy.pickAgain))
    await waitFor(() => expect(screen.getByDisplayValue('D:\\projects\\another-tool')).toBeTruthy())
    // Tên tùy chỉnh vẫn giữ nguyên, không bị ghi đè bởi another-tool
    expect(nameInput.value).toBe('custom-app-service')

    // 4. Đổi VPS sang VPS 2
    const vpsSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(vpsSelect, { target: { value: '2' } })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 2))
    // Tên tùy chỉnh vẫn giữ nguyên sau khi đổi VPS
    expect(nameInput.value).toBe('custom-app-service')

    // 5. Đi tiếp wizard tới Step 3 (Review / Precheck)
    const nextBtn = screen.getByRole('button', { name: strings.deploy.next })
    fireEvent.click(nextBtn)

    // Step 1: Detect
    await screen.findByText('Express.js')
    fireEvent.click(screen.getByText('Next'))

    // Step 2: Config - kiểm tra input tên ứng dụng vẫn là tên tùy chỉnh
    await screen.findByLabelText('PORT')
    expect(screen.getByDisplayValue('custom-app-service')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'sekret' } })
    fireEvent.click(screen.getByText('Next'))

    // Step 3: Review & Precheck
    await screen.findByText('RAM trống')
    expect(invoke).toHaveBeenCalledWith('deploy:precheck', {
      vps_id: 2,
      app_id: undefined,
      app_name: 'custom-app-service',
      source_path: 'D:\\projects\\another-tool',
      env: { PORT: '3000', SECRET_KEY: 'sekret' }
    })
  })

  it('doi giua hai che do ung dung moi va hien co khong mang ten app hien co sang app moi', async () => {
    const currentFolder = 'D:\\src\\express-api'
    const { invoke } = mockApi({
      ...handersHappy,
      'vps:list': async () => ({ ok: true, data: [VPS_A] }),
      'app:list': async () => ({ ok: true, data: [APP_1] }),
      'system:pick-folder': async () => ({ ok: true, data: { path: currentFolder } })
    })

    render(<DeployPage />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:list', 1))

    // Tình huống A: Người dùng nhập tên tùy chỉnh
    const nameInput = screen.getByPlaceholderText('my-app') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'my-custom-tool' } })
    expect(nameInput.value).toBe('my-custom-tool')

    // Chuyển sang chế độ "Ứng dụng hiện có"
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.existing }))

    // Chọn APP_1 ('preselected-api')
    const appSelect = screen.getByRole('combobox', {
      name: strings.deploy.targetApp.selectApp
    })
    fireEvent.change(appSelect, { target: { value: '10' } })

    // Chuyển lại về chế độ "Ứng dụng mới"
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.new }))

    // Input tên ứng dụng mới vẫn là 'my-custom-tool', KHÔNG bị đổi thành 'preselected-api'
    const restoredInput = screen.getByPlaceholderText('my-app') as HTMLInputElement
    expect(restoredInput.value).toBe('my-custom-tool')

    // Tình huống B: Khi chưa nhập tên mà chỉ chọn thư mục
    fireEvent.change(restoredInput, { target: { value: '' } })
    fireEvent.click(screen.getByText(strings.deploy.pickFolder))
    await waitFor(() => expect(screen.getByDisplayValue('D:\\src\\express-api')).toBeTruthy())
    expect(restoredInput.value).toBe('express-api')

    // Chuyển sang "Ứng dụng hiện có" và chọn APP_1
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.existing }))
    fireEvent.change(screen.getByRole('combobox', { name: strings.deploy.targetApp.selectApp }), {
      target: { value: '10' }
    })

    // Chuyển lại về "Ứng dụng mới"
    fireEvent.click(screen.getByRole('radio', { name: strings.deploy.targetApp.new }))
    const currentInput = screen.getByPlaceholderText('my-app') as HTMLInputElement
    // Không bị mang tên 'preselected-api' sang app mới
    expect(currentInput.value).toBe('express-api')
  })

  it('pass cu -> sua cau hinh -> precheck loi: vo hieu hoa pass cu, khong cho deploy:start', async () => {
    let precheckShouldFail = false
    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:precheck': async () => {
        if (precheckShouldFail) {
          return { ok: false, error: { message: 'RAM khong du tren VPS' } }
        }
        return { ok: true, data: PRECHECK_PASS }
      }
    })

    render(<DeployPage />)
    await reachStep3(invoke)

    // Bước Review lần 1: precheck đạt
    expect(await screen.findByText('RAM trống')).toBeTruthy()
    const deployBtn = screen.getByRole('button', {
      name: new RegExp(strings.deploy.review.deploy, 'i')
    }) as HTMLButtonElement
    expect(deployBtn.disabled).toBe(false)

    // Quay lại Bước 2 (Config) và sửa cấu hình (đổi PORT)
    fireEvent.click(screen.getByText(strings.deploy.back))
    await screen.findByLabelText('PORT')
    fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '4000' } })

    // Đặt precheck lần 2 lỗi
    precheckShouldFail = true

    // Đi tiếp tới Bước 3
    fireEvent.click(screen.getByText(strings.deploy.next))

    // Kết quả pass cũ bị xóa, hiển thị lỗi mới
    expect(await screen.findByText('RAM khong du tren VPS')).toBeTruthy()
    expect(screen.queryByText('RAM trống')).toBeNull()

    // Nút Deploy bị vô hiệu hóa
    const updatedDeployBtn = screen.getByRole('button', {
      name: new RegExp(strings.deploy.review.deploy, 'i')
    }) as HTMLButtonElement
    expect(updatedDeployBtn.disabled).toBe(true)
    fireEvent.click(updatedDeployBtn)
    expect(invoke).not.toHaveBeenCalledWith('deploy:start', expect.anything())
  })

  it('phan hoi precheck ve sai thu tu: khong ghi de cau hinh moi va khong giu pass cu', async () => {
    let resolveFirstPrecheck: (val: unknown) => void = () => {}
    const firstPrecheckPromise = new Promise((res) => {
      resolveFirstPrecheck = res
    })
    let precheckCallCount = 0

    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:precheck': async () => {
        precheckCallCount++
        if (precheckCallCount === 1) {
          await firstPrecheckPromise
          return { ok: true, data: { ...PRECHECK_PASS, assigned_host_port: 30000 } }
        }
        return { ok: false, error: { message: 'Port 8080 is already in use' } }
      }
    })

    render(<DeployPage />)

    // Đi tới bước 2
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())
    fireEvent.click(screen.getByText('Next'))
    await screen.findByText('Express.js')
    fireEvent.click(screen.getByText('Next'))
    await screen.findByLabelText('PORT')
    fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'sekret' } })

    // Bấm Next sang bước 3 (Kích hoạt precheck 1 - đang pending)
    fireEvent.click(screen.getByText('Next'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('deploy:precheck', expect.anything()))

    // Quay lại ngay bước 2 và đổi PORT sang 8080
    fireEvent.click(screen.getByText(strings.deploy.back))
    await screen.findByLabelText('PORT')
    fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '8080' } })

    // Bấm Next sang bước 3 (Kích hoạt precheck 2 - resolve ngay lập tức với lỗi)
    fireEvent.click(screen.getByText('Next'))
    expect(await screen.findByText('Port 8080 is already in use')).toBeTruthy()
    const deployBtn = screen.getByRole('button', {
      name: new RegExp(strings.deploy.review.deploy, 'i')
    }) as HTMLButtonElement
    expect(deployBtn.disabled).toBe(true)

    // Bây giờ cho precheck 1 hoàn thành (về muộn / sai thứ tự)
    await act(async () => {
      resolveFirstPrecheck(undefined)
    })

    // Precheck 1 về muộn không được ghi đè, Deploy vẫn disabled
    expect(screen.getByText('Port 8080 is already in use')).toBeTruthy()
    const deployBtnAfter = screen.getByRole('button', {
      name: new RegExp(strings.deploy.review.deploy, 'i')
    }) as HTMLButtonElement
    expect(deployBtnAfter.disabled).toBe(true)
    fireEvent.click(deployBtnAfter)
    expect(invoke).not.toHaveBeenCalledWith('deploy:start', expect.anything())
  })

  it('lan kiem tra moi dat thi deploy:start nhan dung input va assigned_host_port moi nhat', async () => {
    let precheckCallCount = 0
    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:precheck': async () => {
        precheckCallCount++
        if (precheckCallCount === 1) {
          return {
            ok: true,
            data: {
              ...PRECHECK_PASS,
              assigned_host_port: 30000,
              app_url: 'http://203.0.113.55:30000'
            }
          }
        }
        return {
          ok: true,
          data: {
            ...PRECHECK_PASS,
            assigned_host_port: 30008,
            app_url: 'http://203.0.113.55:30008'
          }
        }
      }
    })

    render(<DeployPage />)
    await reachStep3(invoke)

    // Precheck 1 có port 30000
    expect(await screen.findByText(/port 30000/)).toBeTruthy()

    // Quay lại sửa SECRET_KEY
    fireEvent.click(screen.getByText(strings.deploy.back))
    await screen.findByLabelText('SECRET_KEY')
    fireEvent.change(screen.getByLabelText('SECRET_KEY'), { target: { value: 'super-new-secret' } })

    // Đi tiếp sang Bước 3, precheck lần 2 chạy
    fireEvent.click(screen.getByText(strings.deploy.next))
    expect(await screen.findByText(/port 30008/)).toBeTruthy()

    // Bấm Triển khai
    const deployBtn = screen.getByRole('button', {
      name: new RegExp(strings.deploy.review.deploy, 'i')
    }) as HTMLButtonElement
    expect(deployBtn.disabled).toBe(false)
    fireEvent.click(deployBtn)

    // deploy:start phải nhận đúng assigned_host_port 30008 và SECRET_KEY mới
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('deploy:start', {
        vps_id: 1,
        app_id: undefined,
        app_name: 'express-api',
        source_path: SOURCE_PATH,
        host_port: 30008,
        env: { PORT: '3000', SECRET_KEY: 'super-new-secret' }
      })
    )
  })

  it('man Review chi hien thi ten bien moi truong va trang thai da cau hinh, khong lo gia tri', async () => {
    const { invoke } = mockApi(handersHappy)

    render(<DeployPage />)
    await reachStep3(invoke)

    // Hiển thị tóm tắt VPS, target app, source path
    expect(await screen.findByText(strings.deploy.review.summaryTitle)).toBeTruthy()
    expect(screen.getByText(/VM01/)).toBeTruthy()
    expect(screen.getByText('express-api')).toBeTruthy()
    expect(screen.getByText(SOURCE_PATH)).toBeTruthy()

    // Hiển thị env: chỉ hiển thị tên biến và trạng thái đã cấu hình, không hiển thị giá trị của bất kỳ biến nào
    expect(screen.getByText('PORT')).toBeTruthy()
    expect(screen.getByText('SECRET_KEY')).toBeTruthy()
    expect(screen.getAllByText(`(${strings.deploy.review.envConfigured})`).length).toBe(2)
    expect(screen.queryByText('3000')).toBeNull()
    expect(screen.queryByText('sekret')).toBeNull()
    expect(screen.queryByText('••••••••')).toBeNull()
  })

  it('URL chua mat khau gia: khong xuat hien trong DOM Review, tooltip hay copy; precheck va deploy:start van nhan dung IPC', async () => {
    const fakePassword = 'SuperSecretFakePassword123!'
    const fakeDbUrl = `postgres://app_user:${fakePassword}@internal-db.example.com:5432/app_prod?sslmode=require`
    const fakeRedisUrl = `redis://:${fakePassword}@redis.internal:6379/1`
    const fakeMongoUri = `mongodb://admin:${fakePassword}@mongo.internal:27017/analytics`
    const fakeDsn = `https://key:${fakePassword}@sentry.internal/42`
    const fakeConnStr = `Server=tcp:sql.internal,1433;Database=orders;User Id=app;Password=${fakePassword};`

    const detectionWithUrls: DetectionResultDto = {
      ...MATCHED,
      required_env: [
        'PORT',
        'DATABASE_URL',
        'REDIS_URL',
        'MONGODB_URI',
        'SENTRY_DSN',
        'DB_CONNECTION_STRING'
      ]
    }

    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:detect': async () => ({ ok: true, data: detectionWithUrls })
    })

    render(<DeployPage />)

    // Step 0: Chọn thư mục -> detect
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())
    fireEvent.click(screen.getByText('Next'))

    // Step 1: Detect
    await screen.findByText('Express.js')
    fireEvent.click(screen.getByText('Next'))

    // Step 2: Cấu hình — kiểm tra các ô nhập nhạy cảm đều có type="password"
    await screen.findByLabelText('PORT')
    const portInput = screen.getByLabelText('PORT') as HTMLInputElement
    expect(portInput.type).toBe('text')

    const dbInput = screen.getByLabelText('DATABASE_URL') as HTMLInputElement
    expect(dbInput.type).toBe('password')

    const redisInput = screen.getByLabelText('REDIS_URL') as HTMLInputElement
    expect(redisInput.type).toBe('password')

    const mongoInput = screen.getByLabelText('MONGODB_URI') as HTMLInputElement
    expect(mongoInput.type).toBe('password')

    const dsnInput = screen.getByLabelText('SENTRY_DSN') as HTMLInputElement
    expect(dsnInput.type).toBe('password')

    const connStrInput = screen.getByLabelText('DB_CONNECTION_STRING') as HTMLInputElement
    expect(connStrInput.type).toBe('password')

    // Nhập giá trị nhạy cảm chứa mật khẩu giả
    fireEvent.change(portInput, { target: { value: '8080' } })
    fireEvent.change(dbInput, { target: { value: fakeDbUrl } })
    fireEvent.change(redisInput, { target: { value: fakeRedisUrl } })
    fireEvent.change(mongoInput, { target: { value: fakeMongoUri } })
    fireEvent.change(dsnInput, { target: { value: fakeDsn } })
    fireEvent.change(connStrInput, { target: { value: fakeConnStr } })

    // Bấm Next sang Step 3 Review & Precheck
    fireEvent.click(screen.getByText('Next'))
    await screen.findByText('RAM trống')

    // 1. DOM Review: mật khẩu giả và full URLs KHÔNG xuất hiện trong DOM
    const bodyText = document.body.textContent ?? ''
    expect(bodyText).not.toContain(fakePassword)
    expect(bodyText).not.toContain('postgres://app_user')
    expect(bodyText).not.toContain('redis://')
    expect(bodyText).not.toContain('mongodb://')
    expect(bodyText).not.toContain('sentry.internal')
    expect(bodyText).not.toContain('sql.internal')
    expect(bodyText).not.toContain('8080')

    // Kiểm tra không xuất hiện trong bất kỳ attribute nào (title, tooltip, aria, etc.)
    const allElements = Array.from(document.body.querySelectorAll('*'))
    for (const el of allElements) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.value).not.toContain(fakePassword)
        expect(attr.value).not.toContain('postgres://app_user')
        expect(attr.value).not.toContain('redis://')
        expect(attr.value).not.toContain('mongodb://')
        expect(attr.value).not.toContain('sentry.internal')
        expect(attr.value).not.toContain('sql.internal')
      }
    }

    // Tên biến và trạng thái đã cấu hình hiển thị đầy đủ
    expect(screen.getByText('PORT')).toBeTruthy()
    expect(screen.getByText('DATABASE_URL')).toBeTruthy()
    expect(screen.getByText('REDIS_URL')).toBeTruthy()
    expect(screen.getByText('MONGODB_URI')).toBeTruthy()
    expect(screen.getByText('SENTRY_DSN')).toBeTruthy()
    expect(screen.getByText('DB_CONNECTION_STRING')).toBeTruthy()
    expect(screen.getAllByText(`(${strings.deploy.review.envConfigured})`).length).toBe(6)

    // 2. deploy:precheck nhận đầy đủ và đúng giá trị qua IPC
    expect(invoke).toHaveBeenCalledWith('deploy:precheck', {
      vps_id: 1,
      app_id: undefined,
      app_name: 'express-api',
      source_path: SOURCE_PATH,
      env: {
        PORT: '8080',
        DATABASE_URL: fakeDbUrl,
        REDIS_URL: fakeRedisUrl,
        MONGODB_URI: fakeMongoUri,
        SENTRY_DSN: fakeDsn,
        DB_CONNECTION_STRING: fakeConnStr
      }
    })

    // 3. deploy:start nhận đúng giá trị qua IPC khi bấm Triển khai
    const deployBtn = screen.getByRole('button', {
      name: new RegExp(strings.deploy.review.deploy, 'i')
    })
    fireEvent.click(deployBtn)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('deploy:start', {
        vps_id: 1,
        app_id: undefined,
        app_name: 'express-api',
        source_path: SOURCE_PATH,
        host_port: 30000,
        env: {
          PORT: '8080',
          DATABASE_URL: fakeDbUrl,
          REDIS_URL: fakeRedisUrl,
          MONGODB_URI: fakeMongoUri,
          SENTRY_DSN: fakeDsn,
          DB_CONNECTION_STRING: fakeConnStr
        }
      })
    )
  })

  it('isSecretKey nhan dien dung cac khoa nhay cam gom DATABASE_URL, REDIS_URL, URI, DSN, CONNECTION_STRING', () => {
    // Các khóa nhạy cảm phải trả về true
    expect(isSecretKey('DATABASE_URL')).toBe(true)
    expect(isSecretKey('database_url')).toBe(true)
    expect(isSecretKey('REDIS_URL')).toBe(true)
    expect(isSecretKey('DB_URL')).toBe(true)
    expect(isSecretKey('POSTGRES_URL')).toBe(true)
    expect(isSecretKey('MYSQL_URL')).toBe(true)
    expect(isSecretKey('MONGO_URL')).toBe(true)
    expect(isSecretKey('MONGODB_URI')).toBe(true)
    expect(isSecretKey('DATABASE_URI')).toBe(true)
    expect(isSecretKey('URI')).toBe(true)
    expect(isSecretKey('SENTRY_DSN')).toBe(true)
    expect(isSecretKey('DSN')).toBe(true)
    expect(isSecretKey('AZURE_STORAGE_CONNECTION_STRING')).toBe(true)
    expect(isSecretKey('DB_CONNECTION_STRING')).toBe(true)
    expect(isSecretKey('CONNECTION_STRING')).toBe(true)
    expect(isSecretKey('SECRET_KEY')).toBe(true)
    expect(isSecretKey('API_KEY')).toBe(true)
    expect(isSecretKey('PASSWORD')).toBe(true)
    expect(isSecretKey('AUTH_TOKEN')).toBe(true)

    // Các biến không nhạy cảm
    expect(isSecretKey('PORT')).toBe(false)
    expect(isSecretKey('NODE_ENV')).toBe(false)
    expect(isSecretKey('APP_URL')).toBe(false)
    expect(isSecretKey('HOST')).toBe(false)
  })

  it('getConfigSignature bieu dien khong nhap nhang, khong trung chu ky khi gia tri chua ; hoac =', () => {
    const base: DeployInput = {
      vps_id: 1,
      app_name: 'test-app',
      source_path: 'D:\\src',
      env: {}
    }

    // Tình huống 1: Một biến chứa chuỗi giả lập phân tách "KEY2=bar"
    const sig1 = getConfigSignature({
      ...base,
      env: { KEY1: 'val;KEY2=bar' }
    })
    const sig2 = getConfigSignature({
      ...base,
      env: { KEY1: 'val', KEY2: 'bar' }
    })
    expect(sig1).not.toBe(sig2)

    // Tình huống 2: Key hoặc giá trị chứa dấu =
    const sig3 = getConfigSignature({
      ...base,
      env: { 'A=B': 'C' }
    })
    const sig4 = getConfigSignature({
      ...base,
      env: { A: 'B=C' }
    })
    expect(sig3).not.toBe(sig4)

    // Tình huống 3: Giá trị chứa dấu ; và nhiều dấu =
    const sig5 = getConfigSignature({
      ...base,
      env: { DATABASE_URL: 'postgres://user:p;w=d@host:5432/db?ssl=true;timeout=10' }
    })
    const sig6 = getConfigSignature({
      ...base,
      env: { DATABASE_URL: 'postgres://user:p;w=d@host:5432/db?ssl=true;timeout=20' }
    })
    expect(sig5).not.toBe(sig6)
  })

  it('thong bao thieu bien bat buoc ban dia hoa cho 4 ngon ngu', async () => {
    mockApi(handersHappy)

    // Đi tới bước 2 Config
    const { rerender } = render(<DeployPage />)
    fireEvent.click(await screen.findByText('Choose folder'))
    await waitFor(() => expect(screen.getByDisplayValue(SOURCE_PATH)).toBeTruthy())
    fireEvent.click(screen.getByText('Next'))
    await screen.findByText('Express.js')
    fireEvent.click(screen.getByText('Next'))

    // Chỉ điền PORT, để trống SECRET_KEY
    await screen.findByLabelText('PORT')
    fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '3000' } })

    // 1. English
    fireEvent.click(screen.getByText('Next'))
    expect(await screen.findByText('Missing required variables: SECRET_KEY.')).toBeTruthy()

    // 2. Tiếng Việt
    act(() => {
      useUiState.setState({ locale: 'vi' })
    })
    rerender(<DeployPage />)
    fireEvent.click(screen.getByText('Tiếp tục'))
    expect(await screen.findByText('Thiếu các biến môi trường bắt buộc: SECRET_KEY.')).toBeTruthy()

    // 3. 简体中文
    act(() => {
      useUiState.setState({ locale: 'cn' })
    })
    rerender(<DeployPage />)
    fireEvent.click(screen.getByText('下一步'))
    expect(await screen.findByText('缺少必需的环境变量: SECRET_KEY。')).toBeTruthy()

    // 4. 日本語
    act(() => {
      useUiState.setState({ locale: 'jp' })
    })
    rerender(<DeployPage />)
    fireEvent.click(screen.getByText('次へ'))
    expect(await screen.findByText('必須の環境変数が不足しています: SECRET_KEY。')).toBeTruthy()

    act(() => {
      useUiState.setState({ locale: 'en' })
    })
  })

  it('khoa dong bo nut Bat dau trien khai ngay khi click, rapid double-click chi goi deploy:start mot lan', async () => {
    let deployStartCallCount = 0
    let resolveDeployStart: (val: unknown) => void = () => {}
    const deployStartPromise = new Promise((resolve) => {
      resolveDeployStart = resolve
    })

    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:start': async () => {
        deployStartCallCount++
        return deployStartPromise
      }
    })

    render(<DeployPage />)
    await reachStep3(invoke)

    const deployBtn = screen.getByRole('button', {
      name: new RegExp(strings.deploy.review.deploy, 'i')
    })
    expect(deployBtn).toBeTruthy()

    // Bấm nhanh liên tiếp 2 lần
    fireEvent.click(deployBtn)
    fireEvent.click(deployBtn)

    // Chỉ có 1 cuộc gọi deploy:start được gửi đi
    expect(deployStartCallCount).toBe(1)
    expect(invoke).toHaveBeenCalledWith('deploy:start', expect.anything())

    // Nút hiển thị trạng thái đang gửi và bị disable
    await waitFor(() => {
      expect(screen.getByText(strings.deploy.review.starting)).toBeTruthy()
    })

    // Giải quyết promise thành công
    await act(async () => {
      resolveDeployStart({ ok: true, data: { deployment_id: 101 } })
    })

    // Chuyển sang màn hình Deploy log
    expect(await screen.findByText('Deploy log')).toBeTruthy()
  })

  it('deploy:start that bai: mo khoa lai nut va hien thi thong bao loi', async () => {
    let deployStartCalls = 0
    const { invoke } = mockApi({
      ...handersHappy,
      'deploy:start': async () => {
        deployStartCalls++
        if (deployStartCalls === 1) {
          return {
            ok: false,
            error: {
              code: 'SSH_TIMEOUT',
              message: 'Lỗi kết nối SSH timeout khi bắt đầu triển khai'
            }
          }
        }
        return { ok: true, data: { deployment_id: 102 } }
      }
    })

    render(<DeployPage />)
    await reachStep3(invoke)

    const deployBtn = screen.getByRole('button', {
      name: new RegExp(strings.deploy.review.deploy, 'i')
    })
    fireEvent.click(deployBtn)

    // Hiển thị lỗi
    expect(await screen.findByText('Lỗi kết nối SSH timeout khi bắt đầu triển khai')).toBeTruthy()

    // Nút được mở khóa lại và có thể bấm tiếp
    await waitFor(() => {
      const retryBtn = screen.getByRole('button', {
        name: new RegExp(strings.deploy.review.deploy, 'i')
      })
      expect((retryBtn as HTMLButtonElement).disabled).toBe(false)
    })

    // Thử lại lần 2 thành công
    const retryBtn = screen.getByRole('button', {
      name: new RegExp(strings.deploy.review.deploy, 'i')
    })
    fireEvent.click(retryBtn)

    expect(await screen.findByText('Deploy log')).toBeTruthy()
    expect(deployStartCalls).toBe(2)
  })

  it('hien thi cac buoc deploy bang nhan de hieu o 4 ngon ngu tren man tien do', async () => {
    const { invoke } = mockApi(handersHappy)
    const { rerender } = render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(strings.deploy.review.deploy, 'i') })
    )
    await screen.findByText('Deploy log')

    // 1. English
    act(() => {
      useUiState.setState({ locale: 'en' })
    })
    rerender(<DeployPage />)
    expect(screen.getByText('Precheck')).toBeTruthy()
    expect(screen.getByText('Upload source')).toBeTruthy()
    expect(screen.getByText('Render templates')).toBeTruthy()
    expect(screen.getByText('Build image')).toBeTruthy()
    expect(screen.getByText('Start container')).toBeTruthy()
    expect(screen.getByText('Healthcheck')).toBeTruthy()
    expect(screen.getByText('Record status')).toBeTruthy()

    // 2. Tiếng Việt
    act(() => {
      useUiState.setState({ locale: 'vi' })
    })
    rerender(<DeployPage />)
    expect(screen.getByText('Kiểm tra trước')).toBeTruthy()
    expect(screen.getByText('Tải mã nguồn')).toBeTruthy()
    expect(screen.getByText('Dựng cấu hình')).toBeTruthy()
    expect(screen.getByText('Đóng gói ảnh')).toBeTruthy()
    expect(screen.getByText('Chạy container')).toBeTruthy()
    expect(screen.getByText('Kiểm tra dịch vụ')).toBeTruthy()
    expect(screen.getByText('Lưu trạng thái')).toBeTruthy()

    // 3. 简体中文
    act(() => {
      useUiState.setState({ locale: 'cn' })
    })
    rerender(<DeployPage />)
    expect(screen.getByText('预检检查')).toBeTruthy()
    expect(screen.getByText('上传源码')).toBeTruthy()
    expect(screen.getByText('生成配置')).toBeTruthy()
    expect(screen.getByText('构建镜像')).toBeTruthy()
    expect(screen.getByText('启动容器')).toBeTruthy()
    expect(screen.getByText('健康检查')).toBeTruthy()
    expect(screen.getByText('记录状态')).toBeTruthy()

    // 4. 日本語
    act(() => {
      useUiState.setState({ locale: 'jp' })
    })
    rerender(<DeployPage />)
    expect(screen.getByText('事前チェック')).toBeTruthy()
    expect(screen.getByText('ソースコード転送')).toBeTruthy()
    expect(screen.getByText('設定生成')).toBeTruthy()
    expect(screen.getByText('イメージ構築')).toBeTruthy()
    expect(screen.getByText('コンテナ起動')).toBeTruthy()
    expect(screen.getByText('ヘルスチェック')).toBeTruthy()
    expect(screen.getByText('状態記録')).toBeTruthy()

    // Trả locale về 'en' cho các test khác
    act(() => {
      useUiState.setState({ locale: 'en' })
    })
  })

  it('tach ro runtime da chay khoi truy cap ngoai theo reachable, degraded, tunnel_only, not_checked', async () => {
    const { emit, invoke } = mockApi(handersHappy)
    render(<DeployPage />)
    await reachStep3(invoke)
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(strings.deploy.review.deploy, 'i') })
    )
    await screen.findByText('Deploy log')

    // Trường hợp 1: reachable
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 10000,
      app_url: 'http://203.0.113.55:30000',
      exposure_status: 'reachable'
    })

    expect(await screen.findByText(strings.deploy.exposure.reachableTitle)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.runtimeTag)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.reachableTag)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.reachableDesc)).toBeTruthy()
    expect(screen.getAllByText(strings.deploy.log.openApp).length).toBeGreaterThan(0)

    // Trường hợp 2: degraded — không có nút Mở app
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 10000,
      app_url: 'http://203.0.113.55:30000',
      exposure_status: 'degraded'
    })
    expect(await screen.findByText(strings.deploy.exposure.degradedTitle)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.runtimeTag)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.degradedTag)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.blockedHint)).toBeTruthy()
    expect(screen.queryByText(strings.deploy.log.openApp)).toBeNull()
    expect(screen.getByText(strings.deploy.doctor.diagnose)).toBeTruthy()

    // Trường hợp 3: tunnel_only
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 10000,
      app_url: 'https://tunnel.internal.domain',
      exposure_status: 'tunnel_only'
    })
    expect(await screen.findByText(strings.deploy.exposure.tunnelOnlyTitle)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.runtimeTag)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.tunnelOnlyTag)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.tunnelOnlyDesc)).toBeTruthy()
    expect(screen.getAllByText(strings.deploy.log.openApp).length).toBeGreaterThan(0)

    // Trường hợp 4: not_checked — không hiện nút Mở app vì chưa xác nhận truy cập
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 10000,
      app_url: 'http://203.0.113.55:30000',
      exposure_status: 'not_checked'
    })
    expect(await screen.findByText(strings.deploy.exposure.notCheckedTitle)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.runtimeTag)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.notCheckedTag)).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.notCheckedDesc)).toBeTruthy()
    expect(screen.queryByText(strings.deploy.log.openApp)).toBeNull()

    // Trường hợp 5: reachable nhưng app_url rỗng — không hiện nút Mở app
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 10000,
      app_url: '',
      exposure_status: 'reachable'
    })
    await waitFor(() => {
      expect(screen.queryByText(strings.deploy.log.openApp)).toBeNull()
    })
  })

  it('luu tam deploy:event khi cho ID va chi ap dung event dung deployment (ke ca finished den som), bo qua event deployment khac', async () => {
    let resolveDeployStart: (val: unknown) => void = () => {}
    const deployStartPromise = new Promise((resolve) => {
      resolveDeployStart = resolve
    })

    const { emit, invoke } = mockApi({
      ...handersHappy,
      'deploy:start': async () => deployStartPromise
    })

    render(<DeployPage />)
    await reachStep3(invoke)

    // Bấm bắt đầu triển khai, deploy:start đang chờ xử lý
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(strings.deploy.review.deploy, 'i') })
    )

    // Các event đến trong lúc chờ deploy:start trả ID:
    // 1. Log và step của deployment 7 (deployment đúng)
    emit({
      type: 'log',
      deployment_id: 7,
      step: 'PRECHECK',
      chunk: 'early precheck log for 7\n',
      stream: 'stdout'
    })
    emit({
      type: 'step-start',
      deployment_id: 7,
      step: 'PRECHECK',
      ts: '2026-08-19T10:00:00Z'
    })
    emit({
      type: 'step-done',
      deployment_id: 7,
      step: 'PRECHECK',
      duration_ms: 1200
    })

    // 2. Event của deployment khác (999) đến xen kẽ
    emit({
      type: 'log',
      deployment_id: 999,
      step: 'UPLOAD',
      chunk: 'foreign deployment log\n',
      stream: 'stdout'
    })
    emit({
      type: 'step-start',
      deployment_id: 999,
      step: 'UPLOAD',
      ts: '2026-08-19T10:00:01Z'
    })

    // 3. Finished đến sớm cho deployment 7
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 5000,
      app_url: 'http://203.0.113.55:30000',
      exposure_status: 'reachable'
    })

    // deploy:start trả ID 7
    await act(async () => {
      resolveDeployStart({ ok: true, data: { deployment_id: 7 } })
    })

    // Màn hình tiến độ xuất hiện và đã nhận đủ event của deployment 7
    expect(await screen.findByText('Deploy log')).toBeTruthy()
    expect(screen.getByText('1s')).toBeTruthy()
    expect(screen.getByText(strings.deploy.exposure.reachableTitle)).toBeTruthy()
    expect(screen.getAllByText(strings.deploy.log.openApp).length).toBeGreaterThan(0)

    // Log terminal chứa nội dung deployment 7, không chứa log deployment 999
    const logs = writtenLog()
    expect(logs).toContain('early precheck log for 7')
    expect(logs).not.toContain('foreign deployment log')
  })

  it('xoa bo dem event khi deploy:start loi, thu lai hoac reset wizard', async () => {
    let deployStartCount = 0
    let resolveDeployStart: (val: unknown) => void = () => {}

    const { emit, invoke } = mockApi({
      ...handersHappy,
      'deploy:start': async () => {
        deployStartCount++
        if (deployStartCount === 1) {
          return new Promise((resolve) => {
            resolveDeployStart = resolve
          })
        }
        return { ok: true, data: { deployment_id: 88 } }
      }
    })

    render(<DeployPage />)
    await reachStep3(invoke)

    // Bấm triển khai lần 1
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(strings.deploy.review.deploy, 'i') })
    )

    // Gửi log trong lúc chờ lần 1
    emit({
      type: 'log',
      deployment_id: 77,
      step: 'PRECHECK',
      chunk: 'discarded old log attempt 1\n',
      stream: 'stdout'
    })

    // Lần 1 thất bại
    await act(async () => {
      resolveDeployStart({
        ok: false,
        error: { code: 'START_FAILED', message: 'Khai báo deploy thất bại' }
      })
    })

    expect(await screen.findByText('Khai báo deploy thất bại')).toBeTruthy()

    // Bấm thử lại (lần 2)
    const retryBtn = screen.getByRole('button', {
      name: new RegExp(strings.deploy.review.deploy, 'i')
    })
    fireEvent.click(retryBtn)

    // Gửi log cho deployment 88
    emit({
      type: 'log',
      deployment_id: 88,
      step: 'PRECHECK',
      chunk: 'new log attempt 2\n',
      stream: 'stdout'
    })
    emit({
      type: 'finished',
      deployment_id: 88,
      status: 'running',
      total_duration_ms: 2000,
      app_url: 'http://203.0.113.55:30000',
      exposure_status: 'reachable'
    })

    expect(await screen.findByText('Deploy log')).toBeTruthy()
    const logs = writtenLog()
    expect(logs).toContain('new log attempt 2')
    expect(logs).not.toContain('discarded old log attempt 1')

    // Reset wizard
    const backBtn = await screen.findByRole('button', {
      name: new RegExp(strings.deploy.log.backToWizard, 'i')
    })
    fireEvent.click(backBtn)

    // Trở lại step 0
    await waitFor(() => {
      expect(screen.getByText(strings.deploy.steps.source)).toBeTruthy()
    })
  })

  it('ban dia hoa nhan buoc trong failedStep tren man tien do va footer', async () => {
    const { emit, invoke } = mockApi(handersHappy)
    const { rerender } = render(<DeployPage />)
    await reachStep3(invoke)

    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(strings.deploy.review.deploy, 'i') })
    )
    await screen.findByText('Deploy log')

    // Chuyển sang tiếng Việt
    act(() => {
      useUiState.setState({ locale: 'vi' })
    })
    rerender(<DeployPage />)
    await screen.findByText('Nhật ký triển khai')

    // Giả lập bước HEALTHCHECK thất bại
    emit({
      type: 'step-start',
      deployment_id: 7,
      step: 'HEALTHCHECK',
      ts: '2026-08-19T10:00:00Z'
    })
    emit({
      type: 'step-failed',
      deployment_id: 7,
      step: 'HEALTHCHECK',
      error: { code: 'HEALTHCHECK_FAILED', message: 'Container khong phan hoi tren cong 3000' },
      last_log_lines: []
    })
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'failed',
      total_duration_ms: 8000
    })

    // Thông báo lỗi phải hiển thị nhãn tiếng Việt "Kiểm tra dịch vụ", không phải "HEALTHCHECK"
    expect(await screen.findAllByText('Thất bại ở bước Kiểm tra dịch vụ')).toBeTruthy()

    act(() => {
      useUiState.setState({ locale: 'en' })
    })
  })

  it('tu choi mo app voi URL khong phai HTTP(S) hoac chua duoc xac nhan', async () => {
    const { emit, invoke } = mockApi(handersHappy)
    render(<DeployPage />)
    await reachStep3(invoke)

    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(strings.deploy.review.deploy, 'i') })
    )
    await screen.findByText('Deploy log')

    // Case 1: tunnel_only nhưng URL không hợp lệ (javascript:)
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 5000,
      app_url: 'javascript:alert(1)',
      exposure_status: 'tunnel_only'
    })
    await waitFor(() => {
      expect(screen.queryByText(strings.deploy.log.openApp)).toBeNull()
    })

    // Case 2: reachable nhưng URL ftp://
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 5000,
      app_url: 'ftp://ftp.example.com',
      exposure_status: 'reachable'
    })
    await waitFor(() => {
      expect(screen.queryByText(strings.deploy.log.openApp)).toBeNull()
    })

    // Case 3: degraded với URL hợp lệ -> không hiện nút
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 5000,
      app_url: 'https://valid.example.com',
      exposure_status: 'degraded'
    })
    await waitFor(() => {
      expect(screen.queryByText(strings.deploy.log.openApp)).toBeNull()
    })

    // Case 4: not_checked với URL hợp lệ -> không hiện nút
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 5000,
      app_url: 'https://valid.example.com',
      exposure_status: 'not_checked'
    })
    await waitFor(() => {
      expect(screen.queryByText(strings.deploy.log.openApp)).toBeNull()
    })

    // Case 5: tunnel_only với URL HTTPS hợp lệ -> hiện nút
    emit({
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 5000,
      app_url: 'https://secure.tunnel.domain.com',
      exposure_status: 'tunnel_only'
    })
    expect(await screen.findAllByText(strings.deploy.log.openApp)).toBeTruthy()
  })
})
