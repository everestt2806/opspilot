import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { checkProjectReadiness } from './projectReadiness'
import { readProjectSourceAuthority, verifyProductProjectSource } from './projectSourceVerification'
import { readEnrolledProductTarget, inspectStoredProductTarget } from './targetEnrollment'
import { measureControllerResources } from './controllerResources'
import { observeProductTarget } from './controllerTargetProbe'
vi.mock('./projectSourceVerification', async (original) => ({
  ...(await original<typeof import('./projectSourceVerification')>()),
  readProjectSourceAuthority: vi.fn(),
  verifyProductProjectSource: vi.fn()
}))
vi.mock('./controllerBundle', () => ({ verifyControllerBundle: vi.fn(() => ({})) }))
vi.mock('./targetEnrollment', () => ({
  readEnrolledProductTarget: vi.fn(),
  inspectStoredProductTarget: vi.fn()
}))
vi.mock('./controllerTargetProbe', () => ({ observeProductTarget: vi.fn() }))
vi.mock('./controllerResources', async (original) => ({
  ...(await original<typeof import('./controllerResources')>()),
  measureControllerResources: vi.fn()
}))
vi.mock('../ssh/manager', () => ({
  SshManager: class {
    async disconnectAll(): Promise<void> {
      /* Không mở kết nối trong unit fixture. */
    }
  }
}))
vi.mock('./controllerSshResolver', () => ({ createControllerSshResolver: vi.fn() }))
let db: ReturnType<typeof initializeDatabase>, directory: string
const request = {
  format: 1,
  controller_id: 'unit',
  app_id: 1,
  expected_ownership_generation: 1,
  expected_source_generation: 1,
  expected_source_config_sha256: 'a'.repeat(64),
  expected_target_security_revision: 1,
  artifact: '/unit/control-plane.cjs',
  manifest_sha256: 'b'.repeat(64)
}
const resources = {
  cpu_count: 2,
  available_ram_bytes: 1024 ** 3,
  workspace_available_bytes: 10 * 1024 ** 3,
  docker_ready: true,
  port_ready: true
}
const check = (): ReturnType<typeof checkProjectReadiness> =>
  checkProjectReadiness(db, 'unit', directory, request)
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'opspilot-ready-'))
  db = initializeDatabase(directory)
  db.exec(
    "INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(1,'unit','unit.test','unit','key',X'01'); INSERT INTO app(id,vps_id,name,framework,host_port,container_port) VALUES(1,1,'unit','express',30000,3000)"
  )
  vi.mocked(readProjectSourceAuthority).mockReturnValue({
    source: {
      repository_url: 'https://github.com/example/demo.git',
      production_ref: 'main',
      repository_root: '.',
      host_port: 30000
    },
    target: { vps_id: 1, ssh_security_revision: 1 },
    observationSequence: null
  } as never)
  vi.mocked(readEnrolledProductTarget).mockReturnValue({} as never)
  vi.mocked(verifyProductProjectSource).mockResolvedValue({ commit_sha: 'c'.repeat(40) } as never)
  vi.mocked(measureControllerResources).mockReturnValue(resources)
  vi.mocked(observeProductTarget).mockResolvedValue({ resources, manifest: Buffer.from('{}') })
  vi.mocked(inspectStoredProductTarget).mockResolvedValue({ state: 'enrolled' } as never)
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
it('checks exact source and target proof without creating jobs or deployments', async () => {
  const value = await check()
  expect(value.state).toBe('ready')
  expect(value.commit_sha).toBe('c'.repeat(40))
  expect(value.checks.every((row) => row.state === 'passed')).toBe(true)
  expect(db.prepare('SELECT count(*) AS n FROM product_deploy_job').get()).toEqual({ n: 0 })
  expect(db.prepare('SELECT count(*) AS n FROM deployment').get()).toEqual({ n: 0 })
})
it.each([
  { docker_ready: false },
  { port_ready: false },
  { available_ram_bytes: 512 * 1024 ** 2 },
  { workspace_available_bytes: 2 * 1024 ** 3 }
])('blocks insufficient or unavailable target resource %j', async (patch) => {
  vi.mocked(observeProductTarget).mockResolvedValue({
    resources: { ...resources, ...patch },
    manifest: Buffer.from('{}')
  })
  expect(await check()).toMatchObject({
    state: 'blocked',
    reasons: ['target_resources_unavailable']
  })
})
it('does not fetch source or inspect remote when enrollment is missing', async () => {
  vi.mocked(readEnrolledProductTarget).mockImplementation(() => {
    throw new Error()
  })
  expect((await check()).reasons).toContain('target_not_enrolled')
  expect(verifyProductProjectSource).not.toHaveBeenCalled()
  expect(observeProductTarget).not.toHaveBeenCalled()
})
it('does not fetch when the controller has insufficient resources', async () => {
  vi.mocked(measureControllerResources).mockReturnValue({ ...resources, available_ram_bytes: 1 })
  expect((await check()).reasons).toContain('controller_resources_unavailable')
  expect(verifyProductProjectSource).not.toHaveBeenCalled()
})
it('stops when source verification fails and never reports ready after an unknown target proof', async () => {
  vi.mocked(verifyProductProjectSource).mockRejectedValueOnce(new Error())
  expect((await check()).reasons).toContain('source_verification_failed')
  expect(observeProductTarget).not.toHaveBeenCalled()
  vi.mocked(inspectStoredProductTarget).mockResolvedValue({ state: 'unknown' } as never)
  expect((await check()).reasons).toContain('target_verification_failed')
})
it('checks authority again after network waits', async () => {
  vi.mocked(observeProductTarget).mockImplementationOnce(async () => {
    vi.mocked(readProjectSourceAuthority).mockImplementation(() => {
      throw new Error('CHANGED')
    })
    return { resources, manifest: Buffer.from('{}') }
  })
  expect((await check()).reasons).toContain('authority_changed')
  expect(inspectStoredProductTarget).not.toHaveBeenCalled()
})
it('refuses existing deployment or caller transaction before source work', async () => {
  db.exec(
    "INSERT INTO deployment(id,app_id,version,image_tag,status) VALUES(1,1,1,'unit:v1','running');UPDATE app SET current_deployment_id=1"
  )
  expect((await check()).reasons).toContain('current_deployment_exists')
  expect(verifyProductProjectSource).not.toHaveBeenCalled()
  db.exec('BEGIN')
  await expect(check()).rejects.toThrow('PROJECT_READINESS_REQUEST_INVALID')
  db.exec('ROLLBACK')
})
