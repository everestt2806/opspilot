import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture } from '../../../scripts/product-environment-desktop-lab/fixture'
import { closeDatabase } from '../db'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { ProductRuntimeRepository } from '../db/productRuntimeRepository'
import { ProductEnvironmentSelection } from './productEnvironmentSelection'
import {
  stageProductSourceAndRenderWithSession,
  validatePreflightSourceAndPlan
} from './productPipelineSourceRender'
import type { GuardedSshExecutionSession } from './guardedSshSession'
import type { PreparedProductGitSnapshot } from './productSnapshotPreparation'
import { h2ContextSchema } from './productH2Proof'
import {
  ProductEnvironmentRuntime,
  renderProductPublicBuild,
  renderProductRuntimeEnv
} from './productEnvironmentRuntime'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'

let root: string, f: Awaited<ReturnType<typeof fixture>>, repository: ProductDeployRepository
let subject: ProductEnvironmentRuntime, claim: ProductClaimToken
const key = randomBytes(32)
const literal = '  Sổ đọc 日本語 "quote" \'single\' \\ $PATH ${HOME} = # end  '
const values = {
  runtime_env: { APP_TOKEN: literal, EMPTY: '', UNICODE: 'a\u0085b\u2028c\u2029d' },
  public_build_args: { NEXT_PUBLIC_TITLE: 'Sổ Đọc $HOME "quoted" \\ end' }
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-env-runtime-'))
  f = await fixture(root)
  f.remote.exec(
    "UPDATE app SET source_type='git',source_path=NULL,git_repo_url='https://github.com/example/app.git',git_ref='main',git_root='.';UPDATE product_app_control SET auto_deploy_paused=1,pause_reason='operator',pause_policy_provenance='explicit'"
  )
  const context = f.repo.context(
    {
      format: 1,
      controller_id: f.controllerId,
      app_id: 42,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: (
        f.remote.prepare('SELECT config_sha256 FROM product_source_config').get() as {
          config_sha256: string
        }
      ).config_sha256,
      expected_target_security_revision: 1
    },
    f.controllerId,
    'unix:1000'
  )
  f.repo.append({
    scope: context.scope,
    expected_latest_revision: null,
    expected_source_generation: 1,
    expected_source_config_sha256: context.source_config_sha256,
    values
  })
  const selected = new ProductEnvironmentSelection(f.remote, f.remoteCipher).select(
    {
      format: 1,
      request_key: randomUUID(),
      scope: context.scope,
      expected_source_generation: 1,
      expected_source_config_sha256: context.source_config_sha256,
      expected_latest_revision: 1,
      environment_revision: 1
    },
    f.controllerId,
    'unix:1000'
  )
  // A newer staged value must never change this claim's selected revision.
  f.repo.append({
    scope: context.scope,
    expected_latest_revision: 1,
    expected_source_generation: 2,
    expected_source_config_sha256: selected.source_config_sha256,
    values: { runtime_env: { APP_TOKEN: 'NEWER_SYNTHETIC_VALUE' }, public_build_args: {} }
  })
  const now = new Date().toISOString()
  f.remote
    .prepare(
      `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,trigger,idempotency_key,ref,target_sha,state,available_at,created_at,updated_at) VALUES('job',?,42,1,2,?,'manual_redeploy','key','main',?,'queued',?,?,?)`
    )
    .run(f.controllerId, selected.source_config_sha256, 'a'.repeat(40), now, now, now)
  repository = new ProductDeployRepository(f.remote)
  const result = repository.claimNextJob(f.controllerId)
  if (result.state !== 'claimed') throw Error('CLAIM_FIXTURE_FAILED')
  claim = result.claim
  expect(
    repository.markGitSnapshotVerified(claim, {
      repositoryUrl: 'https://github.com/example/app.git',
      repositoryRoot: '.',
      commitSha: 'a'.repeat(40),
      sourceConfigSha256: selected.source_config_sha256
    }).state
  ).toBe('snapshot_verified')
  subject = new ProductEnvironmentRuntime(f.remote, repository, f.remoteCipher, claim, () =>
    Buffer.from(key)
  )
})
afterEach(() => {
  closeDatabase()
  f.remote.close()
  rmSync(root, { recursive: true })
  vi.restoreAllMocks()
})

it('resolves only the immutable selected revision before and after dispatch and binds H2 context', () => {
  expect(subject.resolve()).toMatchObject({ reference: { revision: 1 }, values })
  const started = repository.beginGitDispatch(claim, {
    repositoryUrl: 'https://github.com/example/app.git',
    repositoryRoot: '.',
    commitSha: 'a'.repeat(40),
    sourceConfigSha256: claim.source_config_sha256
  })
  if (started.state !== 'dispatch_authorized') throw Error('DISPATCH_FIXTURE_FAILED')
  expect(subject.resolve(started.deployment_id)?.values).toEqual(values)
  expect(() => subject.resolve()).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
  const runtime = new ProductRuntimeRepository(f.remote, { secret: key })
  const context = runtime.createContext(claim, started.deployment_id, {
    state: 'build_failed_definite',
    image_tag: started.image_tag,
    target_sha: 'a'.repeat(40),
    exit_code: 1
  })
  expect(context.environment).toEqual({
    controller_id: f.controllerId,
    ownership_generation: 1,
    revision: 1
  })
  expect(JSON.stringify(context)).not.toContain(literal)
  expect(
    h2ContextSchema.safeParse({
      ...context,
      environment: { ...context.environment, ownership_generation: 2 }
    }).success
  ).toBe(false)
  expect(runtime.readSettlementAuthority({ ...context, environment: undefined })).toBe('rejected')
})
it('renders runtime only to a private file, public only to Dockerfile and hides the config manifest digest', async () => {
  const source = join(root, 'source')
  mkdirSync(source)
  mkdirSync(join(source, 'pages'))
  writeFileSync(
    join(source, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      scripts: { build: 'next build', start: 'next start' },
      dependencies: { next: '14.2.35' }
    })
  )
  writeFileSync(join(source, 'pages/index.js'), 'export default function Home(){return null}')
  const metadata = {
    repositoryUrl: 'https://github.com/example/app.git',
    repositoryRoot: '.',
    commitSha: 'a'.repeat(40),
    sourceConfigSha256: claim.source_config_sha256
  }
  const snapshot = {
    claim,
    metadata,
    rootDirectory: source,
    snapshotDirectory: source,
    cleanup: vi.fn()
  } satisfies PreparedProductGitSnapshot
  expect(() => validatePreflightSourceAndPlan(f.remote, snapshot)).toThrow(
    'PRODUCT_SOURCE_RENDER_UNSUPPORTED_PLAN'
  )
  const started = repository.beginGitDispatch(claim, metadata)
  if (started.state !== 'dispatch_authorized') throw Error('DISPATCH_FIXTURE_FAILED')
  const received: Record<string, Buffer[]> = {}
  let current = ''
  const session = {
    deploymentId: started.deployment_id,
    beginTransferScope: vi.fn(),
    completeTransferScope: vi.fn(),
    finishTransferFile: vi.fn(),
    beginTransferFile: vi.fn(async (scope: string, path: string, _size: number, mode: number) => {
      current = scope + '/' + path
      received[current] = []
      if (path === '.env') expect(mode).toBe(0o600)
    }),
    writeTransferChunk: vi.fn(async (_index: number, bytes: Buffer) => {
      received[current].push(Buffer.from(bytes))
    })
  } as unknown as GuardedSshExecutionSession
  const result = await stageProductSourceAndRenderWithSession(session, f.remote, snapshot, {
    environment: subject
  })
  const text = (path: string): string => Buffer.concat(received[path]).toString('utf8')
  expect(text('render/.env')).toContain('APP_TOKEN=' + literal)
  expect(text('render/Dockerfile')).toContain('ENV NEXT_PUBLIC_TITLE=')
  expect(text('render/Dockerfile')).not.toContain(literal)
  expect(
    Object.keys(received)
      .filter((path) => path.startsWith('source/'))
      .some((path) => text(path).includes(literal))
  ).toBe(false)
  expect(result.render_manifest_sha256).toBeNull()
  expect(JSON.stringify(result)).not.toContain(literal)
})
it.each([
  'UPDATE vps SET ssh_security_revision=2',
  "UPDATE product_controller SET status='maintenance'",
  'UPDATE product_app_control SET ownership_generation=2',
  'UPDATE product_app_control SET source_generation=1,source_config_sha256=(SELECT config_sha256 FROM product_source_config WHERE source_generation=1)',
  "UPDATE product_app_lease SET expires_at='2026-01-01T00:00:00Z'"
])('fails closed for changed authority: %s', (sql) => {
  f.remote.exec(sql)
  expect(() => subject.resolve()).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
})
it('rejects owner changes during decryption without returning values', () => {
  const decrypt = f.remoteCipher.decrypt.bind(f.remoteCipher)
  vi.spyOn(f.remoteCipher, 'decrypt').mockImplementation((input) => {
    const result = decrypt(input)
    f.remote.exec('UPDATE vps SET ssh_security_revision=2')
    return result
  })
  expect(() => subject.resolve()).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
})
it('rejects missing runtime key, corrupt ciphertext or forged selected binding without raw errors', () => {
  expect(() =>
    new ProductEnvironmentRuntime(f.remote, repository, f.remoteCipher, claim).resolve()
  ).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
  f.remote.exec(
    'DROP TRIGGER product_source_environment_immutable;UPDATE product_source_environment SET environment_revision=2'
  )
  expect(() => subject.resolve()).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
})
it('rejects decryption failure without exposing crypto error or plaintext', () => {
  const decrypt = vi.spyOn(f.remoteCipher, 'decrypt').mockImplementation(() => {
    throw Error('RAW_CRYPTO_SYNTHETIC_SECRET')
  })
  expect(() => subject.resolve()).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
  expect(decrypt).toHaveBeenCalled()
})
it('serializes Docker literal values, empty strings and Unicode separators with authenticated private nonce', () => {
  const resolved = subject.resolve()!
  const a = renderProductRuntimeEnv(resolved),
    b = renderProductRuntimeEnv(resolved)
  expect(a).not.toBe(b)
  expect(a).toContain('APP_TOKEN=' + literal + '\n')
  expect(a).toContain('EMPTY=\n')
  expect(a).toContain('UNICODE=a\u0085b\u2028c\u2029d\n')
  expect(a).not.toContain('NEXT_PUBLIC_TITLE=')
  const [first, signature, ...body] = a.split('\n')
  const derived = createHmac('sha256', key).update('opspilot-env-transfer-key-v1').digest()
  expect(signature).toBe(
    '# opspilot-environment-hmac ' +
      createHmac('sha256', derived)
        .update('opspilot-env-transfer-v1\n' + first + '\n' + body.join('\n'))
        .digest('hex')
  )
  expect(JSON.parse(first.slice('# opspilot-environment-v1 '.length)).runtime_keys).toEqual([
    'APP_TOKEN',
    'EMPTY',
    'UNICODE'
  ])
})
it('rejects malformed UTF-16 before transfer instead of silently replacing a value', () => {
  const resolved = subject.resolve()!
  resolved.values.runtime_env.APP_TOKEN = '\ud800'
  expect(() => renderProductRuntimeEnv(resolved)).toThrow('PRODUCT_ENVIRONMENT_INPUT_INVALID')
})
it('escapes public build literals and excludes runtime secrets', () => {
  const rendered = renderProductPublicBuild(values.public_build_args)
  expect(rendered).toBe('ENV NEXT_PUBLIC_TITLE="Sổ Đọc \\$HOME \\"quoted\\" \\\\ end"')
  expect(rendered).not.toContain(literal)
})
const invalidPublicValues: Record<string, string>[] = [
  { APP_TOKEN: 'secret' },
  { NEXT_PUBLIC_A: 'a', VITE_B: 'b' },
  { NEXT_PUBLIC_A: 'a\nb' },
  { NEXT_PUBLIC_A: '\ud800' },
  { NEXT_PUBLIC_A: 'a'.repeat(8193) }
]
it.each(invalidPublicValues)('rejects invalid public-only build values', (v) => {
  expect(() => renderProductPublicBuild(v)).toThrow('PRODUCT_ENVIRONMENT_INPUT_INVALID')
})
