import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeEach, expect, it, vi } from 'vitest'
import { DesktopFirstDeployments } from './desktopFirstDeployment'
import type { DesktopProjectSetups } from './desktopProjectSetup'
import type { DesktopControllerCommand } from '@shared/desktopControllerCommands'
import type { ProductProjectReadiness } from '../../../../docs/contracts/product-project-readiness'
type Context = ReturnType<DesktopProjectSetups['registeredContext']>
let context: Context,
  report: ProductProjectReadiness,
  clock: number,
  command: DesktopControllerCommand
const admin = { projectReadiness: vi.fn() },
  commands = { prepare: vi.fn(), get: vi.fn(), send: vi.fn() },
  ready = vi.fn()
const projects = { registeredContext: vi.fn() }
const service = (): DesktopFirstDeployments =>
  new DesktopFirstDeployments(projects, admin, commands, ready, () => clock)
beforeEach(() => {
  vi.resetAllMocks()
  clock = Date.now()
  const binding = randomUUID(),
    key = randomUUID(),
    resources = {
      cpu_count: 2,
      available_ram_bytes: 1024 ** 3,
      workspace_available_bytes: 10 * 1024 ** 3
    }
  context = {
    setup: {
      request_key: key,
      binding_id: binding,
      binding_revision: 2,
      controller_id: 'unit-controller',
      app_id: 7,
      target_vps_id: 9,
      target_security_revision: 3,
      app_name: 'unit-app',
      repository_url: 'https://github.com/example/demo.git',
      production_ref: 'main',
      repository_root: '.',
      host_port: 30000,
      container_port: 3000,
      healthcheck_path: '/health',
      state: 'registered',
      created_at: new Date(clock).toISOString(),
      updated_at: new Date(clock).toISOString()
    },
    registration: {
      controller_id: 'unit-controller',
      app_id: 7,
      ownership_generation: 1,
      source_generation: 1,
      source_config_sha256: 'a'.repeat(64)
    },
    body_sha256: 'b'.repeat(64)
  } as Context
  report = {
    controller_id: 'unit-controller',
    app_id: 7,
    ownership_generation: 1,
    source_generation: 1,
    source_config_sha256: 'a'.repeat(64),
    target_vps_id: 9,
    target_security_revision: 3,
    repository_url: context.setup.repository_url,
    production_ref: 'main',
    repository_root: '.',
    host_port: 30000,
    commit_sha: 'c'.repeat(40),
    state: 'ready',
    checks: [
      'first_deployment',
      'controller_resources',
      'target_enrollment',
      'source',
      'target_resources'
    ].map((key) => ({ key, state: 'passed' })) as ProductProjectReadiness['checks'],
    reasons: [],
    controller_resources: resources,
    target_resources: { ...resources, docker_ready: true, port_ready: true },
    auto_deploy_paused: true,
    deployment_started: false,
    checked_at: new Date(clock).toISOString()
  }
  command = {
    request_key: randomUUID(),
    binding_id: binding,
    binding_revision: 2,
    controller_id: 'unit-controller',
    client_id: randomUUID(),
    app_id: 7,
    operation: 'redeploy',
    require_first_deployment: true,
    state: 'prepared',
    reason_code: null,
    remote_state: null,
    job_id: null,
    target_sha: 'c'.repeat(40),
    auto_deploy_paused: null,
    created_at: new Date(clock).toISOString(),
    updated_at: new Date(clock).toISOString()
  }
  projects.registeredContext.mockImplementation(() => structuredClone(context))
  admin.projectReadiness.mockImplementation(async () => structuredClone(report))
  ready.mockResolvedValue(true)
  commands.prepare.mockImplementation(() => ({ ...command }))
  commands.get.mockImplementation(() => ({ ...command }))
  commands.send.mockImplementation(async () => ({ ...command, state: 'accepted' }))
})
it('matches shared contract imports and does not expose runtime values', () => {
  const read = (path: string): string =>
    readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  expect(read('../../shared/productProjectReadiness.ts')).toBe(
    read('../../../../docs/contracts/product-project-readiness.ts')
  )
  const shared = readFileSync(
    new URL('../../shared/desktopFirstDeployment.ts', import.meta.url),
    'utf8'
  )
    .replaceAll('\r\n', '\n')
    .replace("'./desktopControllerCommands'", "'./desktop-controller-commands'")
    .replace("'./productProjectReadiness'", "'./product-project-readiness'")
  expect(shared).toBe(
    readFileSync(
      new URL('../../../../docs/contracts/desktop-first-deployment.ts', import.meta.url),
      'utf8'
    ).replaceAll('\r\n', '\n')
  )
})
it('checks without a command, prepares exact SHA and sends only the reviewed durable UUID', async () => {
  const main = service(),
    value = await main.readiness(context.setup.request_key)
  expect(commands.prepare).not.toHaveBeenCalled()
  expect(value.state).toBe('ready')
  const input = { request_key: context.setup.request_key, readiness_id: value.readiness_id! },
    plan = main.prepare(input)
  expect(plan.source_sha).toBe(report.commit_sha)
  expect(commands.prepare).toHaveBeenCalledWith(
    expect.objectContaining({
      require_first_deployment: true,
      target: { kind: 'specific_sha', sha: report.commit_sha }
    })
  )
  await main.send({ ...input, command_key: plan.command.request_key })
  expect(commands.send).toHaveBeenCalledOnce()
})
it('expires at 60 seconds and invalidates the earlier receipt when checking again', async () => {
  const main = service(),
    value = await main.readiness(context.setup.request_key),
    input = { request_key: context.setup.request_key, readiness_id: value.readiness_id! }
  clock += 60_000
  expect(() => main.prepare(input)).toThrow('FIRST_DEPLOY_REVIEW_REQUIRED')
  expect(commands.prepare).not.toHaveBeenCalled()
  clock = Date.now()
  report.checked_at = new Date(clock).toISOString()
  const fresh = await main.readiness(context.setup.request_key)
  await main.readiness(context.setup.request_key)
  expect(() => main.prepare({ ...input, readiness_id: fresh.readiness_id! })).toThrow(
    'FIRST_DEPLOY_REVIEW_REQUIRED'
  )
})
it.each([
  'app_id',
  'target_security_revision',
  'source_config_sha256',
  'host_port',
  'repository_url'
] as const)('rejects mismatched %s', async (field) => {
  Object.assign(report, { [field]: typeof report[field] === 'number' ? 999 : 'different' })
  await expect(service().readiness(context.setup.request_key)).rejects.toThrow(
    'FIRST_DEPLOY_RESPONSE_INVALID'
  )
})
it('fails closed for resource, report or execution readiness', async () => {
  const main = service()
  ready.mockResolvedValue(false)
  expect(await main.readiness(context.setup.request_key)).toMatchObject({
    state: 'blocked',
    readiness_id: null,
    valid_until: null
  })
  ready.mockResolvedValue(true)
  report.state = 'blocked'
  report.reasons = ['target_resources_unavailable']
  report.target_resources!.docker_ready = false
  expect((await main.readiness(context.setup.request_key)).readiness_id).toBeNull()
  report.state = 'ready'
  report.reasons = []
  await expect(main.readiness(context.setup.request_key)).rejects.toThrow(
    'FIRST_DEPLOY_RESPONSE_INVALID'
  )
})
it('rejects changed setup after remote check and after review before send', async () => {
  const main = service(),
    value = await main.readiness(context.setup.request_key),
    input = { request_key: context.setup.request_key, readiness_id: value.readiness_id! }
  const plan = main.prepare(input)
  context.setup.binding_revision++
  await expect(main.send({ ...input, command_key: plan.command.request_key })).rejects.toThrow(
    'FIRST_DEPLOY_REVIEW_REQUIRED'
  )
  expect(commands.send).not.toHaveBeenCalled()
  admin.projectReadiness.mockImplementationOnce(async () => {
    context.setup.binding_revision++
    return report
  })
  await expect(main.readiness(context.setup.request_key)).rejects.toThrow(
    'FIRST_DEPLOY_REVIEW_REQUIRED'
  )
})
it('never resends an unknown command after process restart and rejects a cold prepared command', async () => {
  command.state = 'outcome_unknown'
  const input = {
    request_key: context.setup.request_key,
    readiness_id: randomUUID(),
    command_key: command.request_key
  }
  expect((await service().send(input)).state).toBe('outcome_unknown')
  expect(commands.send).not.toHaveBeenCalled()
  command.state = 'prepared'
  await expect(service().send(input)).rejects.toThrow('FIRST_DEPLOY_REVIEW_REQUIRED')
})
it('rejects expired send without network and locks concurrent readiness checks', async () => {
  const main = service(),
    value = await main.readiness(context.setup.request_key),
    input = { request_key: context.setup.request_key, readiness_id: value.readiness_id! }
  const plan = main.prepare(input)
  clock += 60_000
  await expect(main.send({ ...input, command_key: plan.command.request_key })).rejects.toThrow(
    'FIRST_DEPLOY_REVIEW_REQUIRED'
  )
  expect(commands.send).not.toHaveBeenCalled()
  clock = Date.now()
  admin.projectReadiness.mockImplementationOnce(async () => {
    await expect(main.readiness(context.setup.request_key)).rejects.toThrow('FIRST_DEPLOY_BUSY')
    return report
  })
  await main.readiness(context.setup.request_key)
})
