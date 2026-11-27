import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { SshManager } from '../ssh/manager'
import { loadControllerRuntimeKey } from './controllerRuntimeKeys'
import { readVerifiedControllerBundleFile, verifyControllerBundle } from './controllerBundle'
import { exchangeProductBootstrapJson } from './targetEnrollment'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { makeTargetEnrollmentPayload } from './targetEnrollmentProof'
import { canonicalH2Json } from './productH2Proof'
import {
  PRODUCT_TARGET_ENROLLMENT_DOMAIN,
  type ProductTargetEnrollmentPayload
} from '../../../../docs/contracts/product-target-enrollment'
import {
  CONTROLLER_ENVIRONMENT_ASSET_TRANSITION,
  CONTROLLER_POSTGRES_IO_ASSET_TRANSITION,
  CONTROLLER_SPA_ASSET_TRANSITION
} from './controllerUpgradeAssets'
import { reviewProductTargetHelperUpgrade } from './targetHelperUpgradeReview'
import {
  prepareTargetHelperUpgrade,
  readTargetHelperUpgradePreparation,
  activateTargetHelperUpgradeIntent,
  loadTargetHelperUpgradeIntent,
  publishTargetHelperUpgradeMaterial,
  readTargetHelperUpgradeOutcome
} from './targetHelperUpgradeJournal'
import { readEnrolledProductTarget } from './targetEnrollment'
import { executeTargetHelperUpgrade } from './targetHelperUpgradeExecution'
import {
  PRODUCT_TARGET_HELPER_UPGRADE_OUTCOME_DOMAIN,
  type ProductTargetHelperUpgradePacket,
  type ProductTargetHelperUpgradeCommand
} from '../../../../docs/contracts/product-target-helper-upgrade'
vi.mock('./controllerSecrets', async (original) => ({
  ...(await original<typeof import('./controllerSecrets')>()),
  resolveControllerSecretDirectory: (directory: string) => directory
}))
vi.mock('./controllerRuntimeKeys', async (original) => ({
  ...(await original<typeof import('./controllerRuntimeKeys')>()),
  loadControllerRuntimeKey: vi.fn()
}))
vi.mock('./controllerBundle', () => ({
  verifyControllerBundle: vi.fn(),
  readVerifiedControllerBundleFile: vi.fn()
}))
vi.mock('./targetEnrollment', async (original) => ({
  ...(await original<typeof import('./targetEnrollment')>()),
  exchangeProductBootstrapJson: vi.fn()
}))
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const current = new Map(
  ['target_execution_guard.py', 'target_guarded_ssh_helper.py', 'target_product_runtime.py'].map(
    (name) => [
      `target-helper/${name}`,
      Buffer.from(readFileSync(join(import.meta.dirname, name), 'utf8').replace(/\r\n/g, '\n'))
    ]
  )
)
const bootstrap = Buffer.from(
  readFileSync(join(import.meta.dirname, 'target_enrollment.py'), 'utf8').replace(/\r\n/g, '\n')
)
let directory: string
let database: ReturnType<typeof initializeDatabase>
let key: Buffer
let payload: ProductTargetEnrollmentPayload
let input: {
  format: 1
  controller_id: string
  app_id: number
  ownership_generation: number
  artifact: string
  manifest_sha256: string
  retained_manifest: string
}
let loaded: Buffer[]
const destroy = vi.fn()
const disconnect = vi.fn(async () => {})
const open = vi.fn()
function proof(value = payload): unknown {
  return {
    payload: value,
    signature: createHmac('sha256', key)
      .update(PRODUCT_TARGET_ENROLLMENT_DOMAIN + '\n')
      .update(canonicalH2Json(value))
      .digest('hex')
  }
}
function install(
  framework = 'express',
  legacy: { size: number; sha256: string } = CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0].before
): void {
  database.prepare('UPDATE app SET framework=? WHERE id=1').run(framework)
  const entries = [...current].map(([path, bytes]) => ({
    path,
    size: bytes.length,
    sha256: hash(bytes)
  }))
  Object.assign(
    entries.find((file) => file.path.endsWith('/target_product_runtime.py'))!,
    legacy
  )
  input.retained_manifest = JSON.stringify({
    format: 1,
    node_major: 22,
    entrypoint: 'control-plane.cjs',
    files: entries
  })
  payload = makeTargetEnrollmentPayload(
    'test-controller',
    1,
    1,
    new TargetEnrollmentRepository(database).target('test-controller', 1, 1, true),
    hash(input.retained_manifest),
    '/var/lib/unit-targets'
  )
  database
    .prepare(
      `INSERT OR REPLACE INTO product_target_enrollment
    (controller_id,app_id,ownership_generation,target_binding_json,manifest_sha256,target_root,state,receipt_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'enrolled',?,'now','now')`
    )
    .run(
      payload.controller_id,
      1,
      1,
      canonicalH2Json(payload.target),
      payload.manifest_sha256,
      payload.target_root,
      canonicalH2Json(proof())
    )
}
function insertJob(state = 'succeeded'): void {
  database
    .prepare(
      `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
    trigger,idempotency_key,ref,target_sha,state,available_at,created_at,updated_at)
    SELECT 'job','test-controller',1,1,1,config_sha256,'manual_redeploy','unit','main',?,?,'now','now','now'
    FROM product_source_config WHERE app_id=1`
    )
    .run('a'.repeat(40), state)
}
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'opspilot-helper-review-'))
  database = initializeDatabase(directory)
  const config = hash('{}')
  database.exec(`INSERT INTO vps(id,name,host,host_fingerprint,username,auth_type,encrypted_secret)
    VALUES(1,'unit','target.test','SHA256:${'A'.repeat(43)}','deploy','key',X'00');
    INSERT INTO product_controller VALUES('test-controller','now','active');
    INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
    VALUES(1,1,'unit-app','express',30000,3000,'git','https://github.com/demo/app','main','.');
    INSERT INTO product_source_config(app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at)
    VALUES(1,1,'https://github.com/demo/app','main','.','{}','${config}','now');
    INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,auto_deploy_paused,pause_reason,pause_policy_provenance)
    VALUES(1,'product','test-controller',1,1,'${config}','now',1,'operator','explicit');`)
  key = randomBytes(32)
  loaded = []
  vi.mocked(loadControllerRuntimeKey).mockImplementation(() => {
    const copy = Buffer.from(key)
    loaded.push(copy)
    return copy
  })
  input = {
    format: 1,
    controller_id: 'test-controller',
    app_id: 1,
    ownership_generation: 1,
    artifact: '/unit/control-plane.cjs',
    manifest_sha256: 'b'.repeat(64),
    retained_manifest: ''
  }
  install()
  vi.mocked(verifyControllerBundle).mockReturnValue({
    state: 'bundle_verified',
    manifest_sha256: input.manifest_sha256
  } as never)
  vi.mocked(readVerifiedControllerBundleFile).mockImplementation((_bundle, path) =>
    path.endsWith('/target_enrollment.py')
      ? Buffer.from(bootstrap)
      : path === 'bundle-manifest.json'
        ? Buffer.from('{}')
        : Buffer.from(current.get(path)!)
  )
  open.mockResolvedValue({
    channel: { destroy },
    identity: {
      vpsId: 1,
      host: 'target.test',
      port: 22,
      username: 'deploy',
      authType: 'key',
      hostFingerprint: payload.target.host_fingerprint
    }
  })
  vi.spyOn(SshManager.prototype, 'openProductBootstrapChannel').mockImplementation(open)
  vi.spyOn(SshManager.prototype, 'disconnectAll').mockImplementation(disconnect)
  vi.mocked(exchangeProductBootstrapJson).mockImplementation(async () => ({
    state: 'enrolled',
    proof: proof()
  }))
})
afterEach(() => {
  for (const copy of loaded) expect(copy.equals(Buffer.alloc(32))).toBe(true)
  key.fill(0)
  closeDatabase()
  rmSync(directory, { recursive: true })
  vi.restoreAllMocks()
})
const review = (): ReturnType<typeof reviewProductTargetHelperUpgrade> =>
  reviewProductTargetHelperUpgrade(database, directory, 'test-controller', input)

describe('Durable helper upgrade preparation', () => {
  const administrator = 'unix:1000'
  const row = (): unknown => database.prepare('SELECT * FROM product_target_enrollment').get()
  const journalFile = (): string =>
    join(
      directory,
      'target-helper-upgrades',
      readdirSync(join(directory, 'target-helper-upgrades')).find((name) => name.endsWith('.json'))!
    )
  const request = async (): Promise<ReturnType<typeof makeRequest>> =>
    makeRequest((await review()).review_sha256)
  function makeRequest(
    reviewHash: string
  ): typeof input & { request_key: string; expected_review_sha256: string; confirm: true } {
    return {
      ...input,
      request_key: randomUUID(),
      expected_review_sha256: reviewHash,
      confirm: true
    }
  }
  const identity = (value: {
    request_key: string
  }): {
    format: 1
    controller_id: string
    app_id: number
    ownership_generation: number
    request_key: string
  } => ({
    format: 1,
    controller_id: input.controller_id,
    app_id: input.app_id,
    ownership_generation: input.ownership_generation,
    request_key: value.request_key
  })
  const prepare = (value: unknown): ReturnType<typeof prepareTargetHelperUpgrade> =>
    prepareTargetHelperUpgrade(database, directory, input.controller_id, administrator, value)
  const lookup = (value: {
    request_key: string
  }): ReturnType<typeof readTargetHelperUpgradePreparation> =>
    readTargetHelperUpgradePreparation(
      database,
      directory,
      input.controller_id,
      administrator,
      identity(value)
    )
  it('publishes signed intent, CAS blocks dispatch, cold lookup/retry leaves revision and SSH unchanged', async () => {
    const value = await request(),
      before = row() as { revision: number; manifest_sha256: string; receipt_json: string }
    const prepared = await prepare(value)
    expect(prepared).toMatchObject({
      state: 'pending',
      apply_available: false,
      request_key: value.request_key
    })
    const pending = row()
    expect(pending).toMatchObject({
      state: 'unknown',
      revision: before.revision + 1,
      manifest_sha256: before.manifest_sha256,
      receipt_json: before.receipt_json,
      last_error_code: 'TARGET_HELPER_UPGRADE_PENDING:' + value.request_key
    })
    expect(readFileSync(journalFile(), 'utf8')).not.toContain(key.toString('base64'))
    expect(JSON.stringify(prepared)).not.toContain((proof() as { signature: string }).signature)
    database.pragma('query_only=ON')
    expect(lookup(value)).toEqual(prepared)
    database.pragma('query_only=OFF')
    await expect(prepare(value)).resolves.toEqual(prepared)
    expect(row()).toEqual(pending)
    expect(open).toHaveBeenCalledTimes(2) // initial read + fresh prepare, never on cold lookup/retry
    expect(() =>
      readEnrolledProductTarget(
        database,
        directory,
        input.controller_id,
        1,
        1,
        payload.manifest_sha256
      )
    ).toThrow('NOT_READY')
  })
  it('keeps intent_only after SQL failure then cold-resumes the exact request without SSH', async () => {
    const value = await request(),
      before = row()
    database.exec(
      "CREATE TRIGGER block_prepare BEFORE UPDATE ON product_target_enrollment BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CRASH_BEFORE_SQL'); END"
    )
    await expect(prepare(value)).rejects.toThrow('SYNTHETIC_CRASH_BEFORE_SQL')
    expect(row()).toEqual(before)
    expect(lookup(value)).toMatchObject({ state: 'intent_only' })
    database.exec('DROP TRIGGER block_prepare')
    const calls = open.mock.calls.length
    expect(
      activateTargetHelperUpgradeIntent(
        database,
        directory,
        input.controller_id,
        administrator,
        identity(value)
      )
    ).toMatchObject({ state: 'pending' })
    expect(open).toHaveBeenCalledTimes(calls)
  })
  it('ordinary prepare/begin/complete/failed cannot clear or advance the pending marker', async () => {
    const value = await request()
    await prepare(value)
    const repository = new TargetEnrollmentRepository(database),
      pending = repository.get(payload)!
    const material = vi.fn()
    expect(() => repository.prepare(payload, material)).toThrow('TARGET_HELPER_UPGRADE_PENDING')
    expect(() => repository.begin(payload, true)).toThrow('TARGET_HELPER_UPGRADE_PENDING')
    expect(() => repository.begin(payload)).toThrow('TARGET_HELPER_UPGRADE_PENDING')
    expect(() => repository.complete(payload, proof(), key, true)).toThrow(
      'TARGET_HELPER_UPGRADE_PENDING'
    )
    repository.failed(pending)
    expect(repository.get(payload)).toEqual(pending)
    expect(material).not.toHaveBeenCalled()
  })
  it.each(['body', 'signature', 'truncated', 'hardlink'])(
    'rejects %s journal tamper without advancing SQL',
    async (kind) => {
      const value = await request()
      await prepare(value)
      const pending = row(),
        file = journalFile()
      if (kind === 'hardlink') linkSync(file, file + '.alias')
      else if (kind === 'truncated') writeFileSync(file, '{')
      else {
        const envelope = JSON.parse(readFileSync(file, 'utf8'))
        if (kind === 'signature') envelope.signature = '0'.repeat(64)
        else envelope.intent.request.artifact = '/another/control-plane.cjs'
        writeFileSync(file, JSON.stringify(envelope))
      }
      expect(() => lookup(value)).toThrow(/JOURNAL_(INVALID|UNSAFE)/)
      await expect(prepare(value)).rejects.toThrow(/JOURNAL_(INVALID|UNSAFE)/)
      expect(row()).toEqual(pending)
    }
  )
  it('missing intent or existing runtime key never creates replacement material', async () => {
    const value = await request()
    await prepare(value)
    const pending = row()
    unlinkSync(journalFile())
    expect(() => lookup(value)).toThrow('INTENT_NOT_FOUND')
    vi.mocked(loadControllerRuntimeKey).mockImplementation(() => {
      throw Error('CONTROLLER_RUNTIME_KEY_UNAVAILABLE')
    })
    await expect(prepare(value)).rejects.toThrow('CONTROLLER_RUNTIME_KEY_UNAVAILABLE')
    expect(row()).toEqual(pending)
  })
  it.each(['name', 'target', 'enrollment', 'marker', 'unpaused'])(
    'rejects %s drift on pending lookup',
    async (kind) => {
      const value = await request()
      await prepare(value)
      if (kind === 'name') database.exec("UPDATE app SET name='another'")
      else if (kind === 'target')
        database.exec('UPDATE vps SET ssh_security_revision=ssh_security_revision+1')
      else if (kind === 'enrollment')
        database.exec('UPDATE product_target_enrollment SET revision=revision+1')
      else if (kind === 'marker')
        database.exec(
          "UPDATE product_target_enrollment SET last_error_code='TARGET_HELPER_UPGRADE_PENDING:00000000-0000-4000-8000-000000000000'"
        )
      else
        database.exec(
          "UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL,pause_policy_provenance='explicit'"
        )
      expect(() => lookup(value)).toThrow(/AUTHORITY_CHANGED|QUIESCENCE/)
    }
  )
  it('rejects a competing UUID, changed body or administrator while preserving first intent', async () => {
    const value = await request()
    await prepare(value)
    const pending = row(),
      original = readFileSync(journalFile())
    await expect(prepare({ ...value, artifact: '/another/control-plane.cjs' })).rejects.toThrow(
      'REQUEST_CONFLICT'
    )
    await expect(prepare({ ...value, request_key: randomUUID() })).rejects.toThrow('NOT_READY')
    expect(() =>
      readTargetHelperUpgradePreparation(
        database,
        directory,
        input.controller_id,
        'unix:1001',
        identity(value)
      )
    ).toThrow('JOURNAL_INVALID')
    expect(row()).toEqual(pending)
    expect(readFileSync(journalFile())).toEqual(original)
  })
  it('requires explicit consent and exact review digest before publishing or changing SQL', async () => {
    const value = await request(),
      before = row()
    await expect(prepare({ ...value, confirm: false })).rejects.toThrow('INPUT_INVALID')
    await expect(prepare({ ...value, expected_review_sha256: 'd'.repeat(64) })).rejects.toThrow(
      'REVIEW_CHANGED'
    )
    expect(row()).toEqual(before)
    expect(() => readdirSync(join(directory, 'target-helper-upgrades'))).toThrow()
  })
  it('preserves caller transaction ownership and does no SSH or journal creation', async () => {
    const value = await request()
    open.mockClear()
    database.exec('BEGIN')
    await expect(prepare(value)).rejects.toThrow('TRANSACTION_ACTIVE')
    expect(database.inTransaction).toBe(true)
    expect(() => lookup(value)).toThrow('TRANSACTION_ACTIVE')
    database.exec('ROLLBACK')
    expect(open).not.toHaveBeenCalled()
  })
})
describe('Controller helper upgrade execution', () => {
  const administrator = 'unix:1000'
  const row = (): {
    revision: number
    state: string
    manifest_sha256: string
    receipt_json: string
    last_error_code: string | null
  } => database.prepare('SELECT * FROM product_target_enrollment').get() as never
  const begin = async (): Promise<{
    format: 1
    controller_id: string
    app_id: number
    ownership_generation: number
    request_key: string
  }> => {
    const observed = await review(),
      request_key = randomUUID()
    await prepareTargetHelperUpgrade(database, directory, input.controller_id, administrator, {
      ...input,
      request_key,
      expected_review_sha256: observed.review_sha256,
      confirm: true
    })
    return {
      format: 1,
      controller_id: input.controller_id,
      app_id: 1,
      ownership_generation: 1,
      request_key
    }
  }
  const outcome = (
    packet: ProductTargetHelperUpgradePacket,
    state: 'pending' | 'applied' | 'not_applied' = 'applied',
    settled = true
  ): unknown => {
    const enrollment =
      state === 'pending'
        ? null
        : proof(state === 'applied' ? packet.to.payload : packet.from.payload)
    const value = {
      format: 1,
      purpose: 'product-target-helper-upgrade-outcome',
      request_key: packet.request_key,
      review_sha256: packet.review_sha256,
      controller_id: packet.from.payload.controller_id,
      app_id: packet.from.payload.app_id,
      ownership_generation: packet.from.payload.ownership_generation,
      from_manifest_sha256: packet.from.payload.manifest_sha256,
      to_manifest_sha256: packet.to.payload.manifest_sha256,
      state,
      settled,
      marker_sha256: 'c'.repeat(64),
      enrollment_proof_sha256: enrollment ? hash(canonicalH2Json(enrollment)) : null
    }
    return {
      state,
      receipt: {
        payload: value,
        signature: createHmac('sha256', key)
          .update(PRODUCT_TARGET_HELPER_UPGRADE_OUTCOME_DOMAIN + '\n')
          .update(canonicalH2Json(value))
          .digest('hex')
      },
      proof: enrollment
    }
  }
  const execute = (
    identity: Awaited<ReturnType<typeof begin>>,
    command: ProductTargetHelperUpgradeCommand = 'apply-target-helper-upgrade'
  ): ReturnType<typeof executeTargetHelperUpgrade> =>
    executeTargetHelperUpgrade(
      database,
      directory,
      input.controller_id,
      administrator,
      command,
      command === 'inspect-target-helper-upgrade' ? identity : { ...identity, confirm: true }
    )
  const remote = (
    state: 'pending' | 'applied' | 'not_applied' = 'applied',
    settled = true
  ): void => {
    vi.mocked(exchangeProductBootstrapJson).mockImplementation(async (_channel, body) =>
      outcome(JSON.parse(body), state, settled)
    )
  }
  it('finalizes only after durable authenticated outcome and cold replay does no SSH or revision advance', async () => {
    const identity = await begin(),
      before = row()
    remote()
    const result = await execute(identity)
    expect(result.state).toBe('applied')
    expect(row()).toMatchObject({
      state: 'enrolled',
      manifest_sha256: 'b'.repeat(64),
      last_error_code: null,
      revision: before.revision + 1
    })
    expect(
      readEnrolledProductTarget(database, directory, input.controller_id, 1, 1, 'b'.repeat(64))
        .manifest_sha256
    ).toBe('b'.repeat(64))
    const current = row(),
      calls = open.mock.calls.length
    database.exec("UPDATE app SET name='later-name'")
    expect((await execute(identity)).state).toBe('applied')
    expect(
      readTargetHelperUpgradePreparation(
        database,
        directory,
        input.controller_id,
        administrator,
        identity
      ).state
    ).toBe('applied')
    expect(row()).toEqual(current)
    expect(open).toHaveBeenCalledTimes(calls)
  })
  it('unsettled absence preserves SQL and explicit cancel finalizes old pin', async () => {
    const identity = await begin(),
      before = row()
    remote('not_applied', false)
    expect((await execute(identity)).state).toBe('pending')
    expect(row()).toEqual(before)
    remote('not_applied', true)
    expect((await execute(identity, 'cancel-target-helper-upgrade')).state).toBe('not_applied')
    expect(row()).toMatchObject({
      state: 'enrolled',
      manifest_sha256: before.manifest_sha256,
      receipt_json: before.receipt_json,
      last_error_code: null
    })
  })
  it('lost reply never replays upgrade; explicit recovery is separate', async () => {
    const identity = await begin(),
      before = row()
    vi.mocked(exchangeProductBootstrapJson).mockRejectedValue(Error('SYNTHETIC_SECRET_STDERR'))
    expect(await execute(identity)).toMatchObject({
      state: 'pending',
      safe_error_code: 'TARGET_HELPER_UPGRADE_REMOTE_UNKNOWN'
    })
    remote('pending', false)
    expect((await execute(identity)).state).toBe('pending')
    remote()
    expect((await execute(identity, 'recover-target-helper-upgrade')).state).toBe('applied')
    const operations = vi
      .mocked(exchangeProductBootstrapJson)
      .mock.calls.slice(-3)
      .map((call) => JSON.parse(call[1]).operation)
    expect(operations).toEqual(['upgrade', 'inspect-upgrade', 'recover-upgrade'])
    expect(row().revision).toBe(before.revision + 1)
  })
  it('a cancellation dispatch winner prevents a subsequent automatic upgrade', async () => {
    const identity = await begin()
    const intent = loadTargetHelperUpgradeIntent(directory, identity, administrator, key)
    publishTargetHelperUpgradeMaterial(directory, intent, key, 'dispatch', { mode: 'cancel' })
    remote('not_applied', false)
    await execute(identity)
    expect(
      JSON.parse(vi.mocked(exchangeProductBootstrapJson).mock.calls.at(-1)![1]).operation
    ).toBe('inspect-upgrade')
    remote('not_applied', true)
    await execute(identity, 'recover-target-helper-upgrade')
    expect(
      JSON.parse(vi.mocked(exchangeProductBootstrapJson).mock.calls.at(-1)![1]).operation
    ).toBe('cancel-upgrade')
  })
  it('stores terminal proof before SQL commit and resumes finalization without replay after SQL failure', async () => {
    const identity = await begin(),
      pending = row()
    database.exec(
      "CREATE TRIGGER block_finalize BEFORE UPDATE ON product_target_enrollment WHEN NEW.state='enrolled' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SQL_FAILURE'); END"
    )
    remote()
    expect(await execute(identity)).toMatchObject({
      state: 'pending',
      safe_error_code: 'TARGET_HELPER_UPGRADE_FINALIZATION_PENDING'
    })
    expect(row()).toEqual(pending)
    const intent = loadTargetHelperUpgradeIntent(directory, identity, administrator, key)
    expect(readTargetHelperUpgradeOutcome(directory, intent, key)?.state).toBe('applied')
    database.exec('DROP TRIGGER block_finalize')
    const calls = open.mock.calls.length
    vi.mocked(exchangeProductBootstrapJson).mockRejectedValue(Error('NO_REPLAY_ALLOWED'))
    expect((await execute(identity)).state).toBe('applied')
    expect(open).toHaveBeenCalledTimes(calls)
  })
  it('reconstructs a missing post-commit archive from positive SQL state without mutation or SSH', async () => {
    const identity = await begin()
    remote()
    await execute(identity)
    const path = join(
      directory,
      'target-helper-upgrades',
      readdirSync(join(directory, 'target-helper-upgrades')).find((name) =>
        name.endsWith('.commit')
      )!
    )
    unlinkSync(path)
    const current = row(),
      calls = open.mock.calls.length
    expect((await execute(identity)).state).toBe('applied')
    expect(readFileSync(path).length).toBeGreaterThan(0)
    expect(row()).toEqual(current)
    expect(open).toHaveBeenCalledTimes(calls)
  })
  it('accepts only an authenticated interrupted auxiliary publication, never foreign hardlinks', async () => {
    const identity = await begin()
    database.exec(
      "CREATE TRIGGER block_finalize BEFORE UPDATE ON product_target_enrollment WHEN NEW.state='enrolled' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SQL_FAILURE'); END"
    )
    remote()
    await execute(identity)
    const root = join(directory, 'target-helper-upgrades'),
      path = join(
        root,
        readdirSync(root).find((name) => name.endsWith('.outcome'))!
      )
    const interrupted = path + '.stage-' + 'a'.repeat(24)
    linkSync(path, interrupted)
    database.exec('DROP TRIGGER block_finalize')
    expect((await execute(identity)).state).toBe('applied')
    unlinkSync(interrupted)
    linkSync(path, path + '.foreign')
    await expect(execute(identity)).rejects.toThrow('JOURNAL_UNSAFE')
  })
  it('never adopts source/target authority changed during SSH', async () => {
    const identity = await begin(),
      before = row()
    vi.mocked(exchangeProductBootstrapJson).mockImplementation(async (_channel, body) => {
      database.exec("UPDATE app SET name='changed-during-request'")
      return outcome(JSON.parse(body))
    })
    await expect(execute(identity)).rejects.toThrow('AUTHORITY_CHANGED')
    expect(row()).toEqual(before)
  })
  it('rejects tampered remote proof and holds the barrier', async () => {
    const identity = await begin(),
      before = row()
    vi.mocked(exchangeProductBootstrapJson).mockImplementation(async (_channel, body) => {
      const result = outcome(JSON.parse(body)) as { receipt: { signature: string } }
      result.receipt.signature = '0'.repeat(64)
      return result
    })
    expect(await execute(identity)).toMatchObject({
      state: 'pending',
      safe_error_code: 'TARGET_HELPER_UPGRADE_REMOTE_UNKNOWN'
    })
    expect(row()).toEqual(before)
  })
  it('rejects incapable destination bootstrap before preparation or SSH', async () => {
    const observed = await review(),
      before = row(),
      calls = open.mock.calls.length
    vi.mocked(readVerifiedControllerBundleFile).mockImplementation(() =>
      Buffer.from('old bootstrap')
    )
    await expect(
      prepareTargetHelperUpgrade(database, directory, input.controller_id, administrator, {
        ...input,
        request_key: randomUUID(),
        expected_review_sha256: observed.review_sha256,
        confirm: true
      })
    ).rejects.toThrow('BOOTSTRAP_REQUIRED')
    expect(row()).toEqual(before)
    expect(open).toHaveBeenCalledTimes(calls)
  })
})

describe('Retained helper upgrade read-only review', () => {
  it.each(['activation', 'experiment', 'unknown-attempt', 'unsettled-runtime'])(
    'rejects %s even when the deploy job is terminal',
    async (kind) => {
      database.exec(
        "INSERT INTO deployment(id,app_id,version,image_tag,status) VALUES(1,1,1,'unit:v1','running')"
      )
      if (kind === 'activation')
        database.exec(
          "INSERT INTO deployment_activation(app_id,deployment_id,stream_generation,start_offset,reason,state) VALUES(1,1,'unit',1,'deploy','prepared')"
        )
      else if (kind === 'experiment')
        database.exec(
          "INSERT INTO experiment_run(scenario,repeat_index,deployment_id,vps_id) VALUES('cpu_spike',1,1,1)"
        )
      else {
        insertJob('failed')
        database.exec(`INSERT INTO product_app_fence VALUES(1,1);
          INSERT INTO product_app_lease VALUES(1,'app-lease','test-controller',1,1,'job','now','now','now','now');
          INSERT INTO product_worker_lease VALUES('build','build-lease','test-controller',1,'job','now','now','now','now');
          INSERT INTO product_deploy_attempt(attempt_id,job_id,attempt_number,lease_id,fencing_token,build_slot_lease_id,build_slot_fence,state,remote_outcome,started_at)
          VALUES('attempt','job',1,'app-lease',1,'build-lease',1,'failed','${kind === 'unknown-attempt' ? 'unknown' : 'applied'}','now');`)
        if (kind === 'unsettled-runtime')
          database.exec(
            `INSERT INTO product_runtime_execution(attempt_id,deployment_id,context_json,context_sha256,created_at) VALUES('attempt',1,'{}','${'a'.repeat(64)}','now')`
          )
      }
      await expect(review()).rejects.toThrow('QUIESCENCE')
      expect(open).not.toHaveBeenCalled()
    }
  )
  it.each(['express', 'static-spa', 'nextjs'])(
    'authenticates %s bytes without SQL writes or granting apply',
    async (framework) => {
      install(framework)
      const before = database.prepare('SELECT * FROM product_target_enrollment').get()
      database.pragma('query_only=ON')
      const result = await review()
      expect(result).toMatchObject({
        purpose: 'product-target-helper-upgrade-review',
        apply_available: false,
        changes: [
          {
            path: 'target-helper/target_product_runtime.py',
            before: CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0].before,
            after: CONTROLLER_POSTGRES_IO_ASSET_TRANSITION[0].after
          }
        ]
      })
      expect(database.prepare('SELECT * FROM product_target_enrollment').get()).toEqual(before)
      expect(JSON.parse(vi.mocked(exchangeProductBootstrapJson).mock.calls[0][1])).toMatchObject({
        operation: 'inspect',
        helpers: {},
        manifest: input.retained_manifest
      })
      expect(JSON.stringify(result)).not.toContain(key.toString('base64'))
      expect(JSON.stringify(result)).not.toContain((proof() as { signature: string }).signature)
      expect(destroy).toHaveBeenCalledOnce()
      expect(disconnect).toHaveBeenCalledOnce()
    }
  )
  it('permits oldest Express helper and rejects that helper for SPA', async () => {
    install('express', CONTROLLER_SPA_ASSET_TRANSITION[0].before)
    await expect(review()).resolves.toMatchObject({ apply_available: false })
    install('static-spa', CONTROLLER_SPA_ASSET_TRANSITION[0].before)
    await expect(review()).rejects.toThrow('TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED')
    expect(open).toHaveBeenCalledOnce()
  })
  it('rejects a retained manifest with the wrong SQL pin before SSH', async () => {
    input.retained_manifest += ' '
    await expect(review()).rejects.toThrow('RETAINED_PIN_MISMATCH')
    expect(open).not.toHaveBeenCalled()
  })
  it.each(['current', 'unknown', 'guard'])(
    'rejects %s helper transition before SSH',
    async (kind) => {
      const manifest = JSON.parse(input.retained_manifest)
      const entry = manifest.files.find((file: { path: string }) =>
        file.path.endsWith(
          kind === 'guard' ? '/target_execution_guard.py' : '/target_product_runtime.py'
        )
      )
      Object.assign(
        entry,
        kind === 'current'
          ? CONTROLLER_POSTGRES_IO_ASSET_TRANSITION[0].after
          : { sha256: 'c'.repeat(64) }
      )
      input.retained_manifest = JSON.stringify(manifest)
      payload = { ...payload, manifest_sha256: hash(input.retained_manifest) }
      database
        .prepare('UPDATE product_target_enrollment SET manifest_sha256=?,receipt_json=?')
        .run(payload.manifest_sha256, canonicalH2Json(proof()))
      await expect(review()).rejects.toThrow(/(TRANSITION_REJECTED|HELPER_UPGRADE_REQUIRED)/)
      expect(open).not.toHaveBeenCalled()
    }
  )
  it.each(['unpaused', 'queued', 'worker', 'unknown-enrollment'])(
    'rejects %s authority before SSH',
    async (kind) => {
      if (kind === 'unpaused')
        database.exec(
          "UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL,pause_policy_provenance='explicit'"
        )
      else if (kind === 'queued') insertJob('queued')
      else if (kind === 'worker') {
        insertJob()
        database.exec(
          "INSERT INTO product_worker_lease VALUES('build','worker','test-controller',1,'job','now','now','now',NULL)"
        )
      } else database.exec("UPDATE product_target_enrollment SET state='unknown'")
      await expect(review()).rejects.toThrow(/(QUIESCENCE|NOT_READY)/)
      expect(open).not.toHaveBeenCalled()
    }
  )
  it('rejects persisted HMAC tamper before SSH', async () => {
    database
      .prepare('UPDATE product_target_enrollment SET receipt_json=?')
      .run(JSON.stringify({ payload, signature: '0'.repeat(64) }))
    await expect(review()).rejects.toThrow('PROOF_REJECTED')
    expect(open).not.toHaveBeenCalled()
  })
  it('rejects remote proof tamper and cleans up', async () => {
    vi.mocked(exchangeProductBootstrapJson).mockResolvedValue({
      state: 'enrolled',
      proof: { payload, signature: '0'.repeat(64) }
    })
    await expect(review()).rejects.toThrow('REMOTE_PROOF_REJECTED')
    expect(destroy).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it.each(['before-packet', 'after-proof'])('rejects authority race %s', async (when) => {
    const drift = (): void => {
      database.exec('UPDATE product_target_enrollment SET revision=revision+1')
    }
    if (when === 'before-packet') {
      const result = await open()
      open.mockImplementation(async () => {
        drift()
        return result
      })
      open.mockClear()
    } else
      vi.mocked(exchangeProductBootstrapJson).mockImplementation(async () => {
        drift()
        return { state: 'enrolled', proof: proof() }
      })
    await expect(review()).rejects.toThrow('AUTHORITY_CHANGED')
    expect(destroy).toHaveBeenCalledOnce()
    if (when === 'before-packet') expect(exchangeProductBootstrapJson).not.toHaveBeenCalled()
  })
  it('does not leak raw remote exceptions', async () => {
    vi.mocked(exchangeProductBootstrapJson).mockRejectedValue(Error('SYNTHETIC_SECRET_STDERR'))
    await expect(review()).rejects.toThrow('TARGET_HELPER_REVIEW_REMOTE_UNKNOWN')
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it('rejects invalid input, wrong controller and cancellation before bundle or SSH', async () => {
    await expect(
      reviewProductTargetHelperUpgrade(database, directory, 'other', input)
    ).rejects.toThrow('INPUT_INVALID')
    await expect(
      reviewProductTargetHelperUpgrade(database, directory, 'test-controller', {
        ...input,
        extra: true
      })
    ).rejects.toThrow('INPUT_INVALID')
    await expect(
      reviewProductTargetHelperUpgrade(
        database,
        directory,
        'test-controller',
        input,
        AbortSignal.abort()
      )
    ).rejects.toThrow('ABORTED')
    expect(verifyControllerBundle).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })
})
