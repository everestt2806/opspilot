import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fixture } from '../../../scripts/product-environment-desktop-lab/fixture'
import { closeDatabase } from '../db'
import { ProductEnvironmentCommands } from './productEnvironmentCommands'
import { ProductEnvironmentSelection } from './productEnvironmentSelection'
import {
  CONTROLLER_ENVIRONMENT_ASSET_TRANSITION,
  CONTROLLER_SPA_ASSET_TRANSITION
} from './controllerUpgradeAssets'
import { assertProductEnvironmentTargetManifest } from './productEnvironmentTarget'
import type {
  ProductEnvironmentContextInput,
  ProductEnvironmentScope,
  ProductEnvironmentSelectionInput
} from '../../../../docs/contracts/product-environment'
let root: string,
  f: Awaited<ReturnType<typeof fixture>>,
  commands: ProductEnvironmentCommands,
  context: ProductEnvironmentContextInput,
  scope: ProductEnvironmentScope
const policy = CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0]
const manifest = (asset: { size: number; sha256: string } = policy.after): Buffer =>
  Buffer.from(
    JSON.stringify({
      format: 1,
      node_major: 22,
      files: [{ path: policy.path.replace(/^payload\//, ''), ...asset }]
    })
  )
const inspect = vi.fn<(_scope: ProductEnvironmentScope, signal: AbortSignal) => Promise<Buffer>>()
const request = (): ProductEnvironmentSelectionInput => ({
  format: 1,
  request_key: randomUUID(),
  scope,
  expected_source_generation: 1,
  expected_source_config_sha256: context.expected_source_config_sha256,
  expected_latest_revision: 1,
  environment_revision: 1
})
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-env-command-'))
  f = await fixture(root)
  context = {
    format: 1,
    controller_id: f.controllerId,
    app_id: 42,
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    expected_source_config_sha256: (
      f.remote.prepare('SELECT config_sha256 h FROM product_source_config').get() as { h: string }
    ).h,
    expected_target_security_revision: 1
  }
  scope = f.repo.context(context, f.controllerId, 'unix:1000').scope
  f.repo.append({
    scope,
    expected_latest_revision: null,
    expected_source_generation: 1,
    expected_source_config_sha256: context.expected_source_config_sha256,
    values: { runtime_env: { APP_TOKEN: 'SYNTHETIC_COMMAND_ONLY' }, public_build_args: {} }
  })
  inspect.mockReset().mockResolvedValue(manifest())
  commands = new ProductEnvironmentCommands(
    f.remote,
    f.remoteCipher,
    '/private-unused-fixture',
    f.controllerId,
    'unix:1000',
    { inspectTarget: inspect }
  )
})
afterEach(() => {
  closeDatabase()
  f.remote.close()
  rmSync(root, { recursive: true })
})
it('rejects legacy, missing, duplicate and drifted helper capabilities', () => {
  expect(() => assertProductEnvironmentTargetManifest(manifest())).not.toThrow()
  for (const asset of [
    policy.before,
    CONTROLLER_SPA_ASSET_TRANSITION[0].before,
    { ...policy.after, size: 1 },
    { ...policy.after, sha256: 'a'.repeat(64) }
  ])
    expect(() => assertProductEnvironmentTargetManifest(manifest(asset))).toThrow(
      'HELPER_UPGRADE_REQUIRED'
    )
  for (const value of [
    {},
    { format: 1, node_major: 22, files: [] },
    {
      format: 1,
      node_major: 22,
      files: [
        ...JSON.parse(manifest().toString()).files,
        ...JSON.parse(manifest().toString()).files
      ]
    }
  ])
    expect(() =>
      assertProductEnvironmentTargetManifest(Buffer.from(JSON.stringify(value)))
    ).toThrow('HELPER_UPGRADE_REQUIRED')
})
it('rejects a legacy target before source selection and preserves vault, jobs and pause', async () => {
  inspect.mockResolvedValue(manifest(policy.before))
  const before = f.remote.prepare('SELECT * FROM product_app_control').get()
  await expect(commands.select(request())).rejects.toThrow('HELPER_UPGRADE_REQUIRED')
  expect(f.remote.prepare('SELECT * FROM product_app_control').get()).toEqual(before)
  expect(f.remote.prepare('SELECT count(*) n FROM product_source_config').get()).toEqual({ n: 1 })
  expect(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get()).toEqual({
    n: 0
  })
  expect(f.remote.prepare('SELECT count(*) n FROM product_environment_revision').get()).toEqual({
    n: 1
  })
  expect(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
})
it('checks capability for new selection, but cold lookup and exact positive replay never contact the target', async () => {
  const input = request(),
    result = await commands.select(input)
  expect(result.state).toBe('selected')
  expect(inspect).toHaveBeenCalledTimes(1)
  inspect.mockRejectedValue(Error('SYNTHETIC_REMOTE_RAW_SECRET_MUST_NOT_ESCAPE'))
  expect(commands.lookup(input).result?.source_generation).toBe(2)
  expect((await commands.select(input)).state).toBe('already_selected')
  expect(inspect).toHaveBeenCalledTimes(1)
  expect(() => commands.lookup({ ...input, environment_revision: 2 })).toThrow(
    'IDEMPOTENCY_CONFLICT'
  )
})
it('rechecks target security and source state after the network await', async () => {
  inspect.mockImplementation(async () => {
    f.remote.exec(
      "UPDATE vps SET host='changed.test',ssh_security_revision=ssh_security_revision+1"
    )
    return manifest()
  })
  await expect(commands.select(request())).rejects.toThrow()
  expect(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get()).toEqual({
    n: 0
  })
})
it('does not leak transport errors or enter selection on abort', async () => {
  inspect.mockRejectedValue(Error('SYNTHETIC_REMOTE_RAW_SECRET_MUST_NOT_ESCAPE'))
  await expect(commands.review(context)).rejects.toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
  const abort = new AbortController()
  abort.abort()
  await expect(commands.review(context, abort.signal)).rejects.toThrow(
    'PRODUCT_ENVIRONMENT_UNAVAILABLE'
  )
  expect(inspect).toHaveBeenCalledTimes(1)
  expect(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get()).toEqual({
    n: 0
  })
})
it('rejects a stale selection when another request commits during the capability probe', async () => {
  const input = request()
  inspect.mockImplementation(async () => {
    new ProductEnvironmentSelection(f.remote, f.remoteCipher).select(
      { ...input, request_key: randomUUID() },
      f.controllerId,
      'unix:1000'
    )
    return manifest()
  })
  await expect(commands.select(input)).rejects.toThrow('SOURCE_CHANGED')
  expect(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get()).toEqual({
    n: 1
  })
})
