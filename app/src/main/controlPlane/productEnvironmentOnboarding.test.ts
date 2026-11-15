import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { fixture } from '../../../scripts/product-environment-desktop-lab/fixture'
import { closeDatabase, initializeDatabase } from '../db'
import { DesktopProjectSetups } from './desktopProjectSetup'
import { DesktopControllerVault } from './desktopControllerVault'
import { DesktopEnvironmentSelections } from './desktopEnvironmentSelections'
import { ProductEnvironmentPreflight } from './productEnvironmentPreflight'
import {
  validateProductSourceAndPlan,
  validateProductSourceForReview
} from './productPipelineSourceRender'
import { verifyProductProjectSource } from './projectSourceVerification'
import { createGitSnapshot } from '../git/snapshot'
import { verifyControllerBundle } from './controllerBundle'
import type { ProductProjectSourceVerificationInput } from '../../../../docs/contracts/product-project-source-verification'

vi.mock('../git/snapshot', async (original) => ({
  ...(await original<typeof import('../git/snapshot')>()),
  createGitSnapshot: vi.fn()
}))
vi.mock('./controllerBundle', () => ({ verifyControllerBundle: vi.fn() }))
let root: string,
  source: string,
  f: Awaited<ReturnType<typeof fixture>>,
  request: ProductProjectSourceVerificationInput
const canary = 'SYNTHETIC_ONBOARDING_VALUE_76324'
const cleanup = vi.fn()
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-env-onboarding-'))
  f = await fixture(root)
  source = join(root, 'source')
  mkdirSync(join(source, 'pages'), { recursive: true })
  writeFileSync(
    join(source, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      scripts: { build: 'next build', start: 'next start' },
      dependencies: { next: '14.2.35' }
    })
  )
  writeFileSync(
    join(source, 'pages/index.js'),
    'export default function Home(){return process.env.NEXT_PUBLIC_TITLE}'
  )
  const staged = await f.main.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: 2,
    expected_latest_revision: null,
    runtime_env: { APP_TOKEN: canary },
    public_build_args: { NEXT_PUBLIC_TITLE: 'Public title' }
  })
  await f.main.send(staged.request_key)
  const c = await f.main.context(f.projectKey)
  const selections = new DesktopEnvironmentSelections(
    f.db,
    f.cipher,
    f.vault,
    f.projects,
    f.main,
    f.admin
  )
  const selected = await selections.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: 2,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    expected_latest_revision: c.latest!.revision,
    environment_revision: c.latest!.revision
  })
  await selections.send(selected.request_key)
  const current = await f.projects.currentContext(f.projectKey)
  request = {
    format: 1,
    controller_id: f.controllerId,
    app_id: 42,
    expected_ownership_generation: 1,
    expected_source_generation: current.registration.source_generation,
    expected_source_config_sha256: current.registration.source_config_sha256,
    expected_target_security_revision: 1,
    artifact: '/fixture/controller.cjs',
    manifest_sha256: 'a'.repeat(64)
  }
  vi.mocked(verifyControllerBundle).mockReturnValue({
    collector_directory: resolve('../collector'),
    templates_directory: resolve('../templates')
  } as never)
  vi.mocked(createGitSnapshot).mockResolvedValue({
    repositoryUrl: 'https://github.com/example/app.git',
    commitSha: 'b'.repeat(40),
    rootDirectory: source,
    cleanup
  } as never)
})
afterEach(() => {
  closeDatabase()
  f.remote.close()
  rmSync(root, { recursive: true })
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
it('derives selected generation from authenticated review and keeps original registration immutable', async () => {
  expect(f.projects.registeredContext(f.projectKey).registration.source_generation).toBe(1)
  expect((await f.projects.currentContext(f.projectKey)).registration.source_generation).toBe(2)
  expect(JSON.stringify(await f.projects.currentContext(f.projectKey))).not.toContain(canary)
  const original = f.admin.environmentReview
  f.admin.environmentReview = async (...args) => {
    const result = await original(...args)
    return {
      ...result,
      scope: { ...result.scope, target: { ...result.scope.target, ssh_security_revision: 2 } }
    }
  }
  await expect(f.projects.currentContext(f.projectKey)).rejects.toThrow('PROJECT_SETUP_CONFLICT')
})
it('verifies selected source through the production preflight without a runtime capability, jobs or deployment', async () => {
  const metadata = ProductEnvironmentPreflight.review(f.remote, request, f.remoteCipher)
  expect(JSON.stringify(metadata)).not.toContain(canary)
  expect(metadata).not.toHaveProperty('values')
  expect(metadata).not.toHaveProperty('signRuntime')
  expect(() => validateProductSourceAndPlan(f.remote, 42, source)).toThrow(
    'PRODUCT_SOURCE_RENDER_UNSUPPORTED_PLAN'
  )
  expect(
    validateProductSourceForReview(
      f.remote,
      42,
      source,
      resolve('../collector'),
      resolve('../templates'),
      metadata
    ).app.id
  ).toBe(42)
  const result = await verifyProductProjectSource(f.remote, f.controllerId, request, {
    cipher: f.remoteCipher
  })
  expect(result).toMatchObject({
    state: 'source_verified',
    source_generation: 2,
    deployment_started: false
  })
  expect(JSON.stringify(result)).not.toContain(canary)
  expect(f.remote.prepare('SELECT COUNT(*) n FROM deployment').get()).toEqual({ n: 0 })
  expect(f.remote.prepare('SELECT COUNT(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
  expect(cleanup).toHaveBeenCalledOnce()
})
it('rejects missing cipher, stale source, target drift and wrong envelope key before observation', async () => {
  expect(() => ProductEnvironmentPreflight.review(f.remote, request)).toThrow(
    'PRODUCT_ENVIRONMENT_UNAVAILABLE'
  )
  expect(() =>
    ProductEnvironmentPreflight.review(
      f.remote,
      { ...request, expected_source_generation: 1 },
      f.remoteCipher
    )
  ).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
  expect(() =>
    ProductEnvironmentPreflight.review(
      f.remote,
      { ...request, expected_target_security_revision: 2 },
      f.remoteCipher
    )
  ).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
  await expect(
    verifyProductProjectSource(f.remote, f.controllerId, request, {
      cipher: new AesGcmCredentialCipher(randomBytes(32))
    })
  ).rejects.toThrow('PROJECT_SOURCE_UNSUPPORTED')
  expect(f.remote.prepare('SELECT COUNT(*) n FROM product_branch_observation').get()).toEqual({
    n: 0
  })
})
it('rejects repository drift from the immutable registration basis', async () => {
  f.remote.exec(
    "UPDATE product_source_config SET repository_url='https://github.com/example/other.git' WHERE source_generation=2"
  )
  await expect(f.projects.currentContext(f.projectKey)).rejects.toThrow(
    'PRODUCT_ENVIRONMENT_SOURCE_CHANGED'
  )
})
it('recovers selected source after cold Main SQLite reopen without rewriting registration', async () => {
  closeDatabase()
  const reopened = initializeDatabase(join(root, 'desktop')),
    projects = new DesktopProjectSetups(reopened, new DesktopControllerVault(reopened, f.cipher), {
      environmentReview: f.admin.environmentReview
    } as never)
  expect(projects.registeredContext(f.projectKey).registration.source_generation).toBe(1)
  expect((await projects.currentContext(f.projectKey)).registration.source_generation).toBe(2)
})
