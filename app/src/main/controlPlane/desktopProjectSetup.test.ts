import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase, runMigrations } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { DesktopControllerVault } from './desktopControllerVault'
import { DesktopProjectSetups } from './desktopProjectSetup'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import type { DesktopProjectSetupInput } from '@shared/desktopProjectRegistration'
import type {
  ProductProjectRegistrationInput,
  ProductProjectRegistrationResult
} from '../../../../docs/contracts/product-project-registration'
let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  cipher: AesGcmCredentialCipher,
  vault: DesktopControllerVault,
  setups: DesktopProjectSetups,
  input: DesktopProjectSetupInput,
  token: string,
  targetRevision: number,
  lost: boolean,
  targets: ReturnType<typeof vi.fn<DesktopControllerEnrollment['projectTargets']>>,
  register: ReturnType<typeof vi.fn<DesktopControllerEnrollment['registerProject']>>,
  verify: ReturnType<typeof vi.fn<DesktopControllerEnrollment['verifyProjectSource']>>,
  targetRead: ReturnType<typeof vi.fn<DesktopControllerEnrollment['projectTargetState']>>,
  targetEnroll: ReturnType<typeof vi.fn<DesktopControllerEnrollment['enrollProjectTarget']>>,
  remote: Map<string, ProductProjectRegistrationResult>
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-project-setup-'))
  db = initializeDatabase(directory)
  db.prepare(
    "INSERT INTO vps(id,name,host,username,auth_type,host_fingerprint,encrypted_secret) VALUES(1,'controller','controller.test','operator','key',?,X'0102')"
  ).run('SHA256:' + 'A'.repeat(43))
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  vault = new DesktopControllerVault(db, cipher)
  const binding = randomUUID(),
    expires = new Date(Date.now() + 86400000).toISOString()
  vault.prepare({
    binding_id: binding,
    controller_id: 'remote-controller',
    vps_id: 1,
    ssh_security_revision: 1,
    principal: {
      vpsId: 1,
      host: 'controller.test',
      port: 22,
      username: 'operator',
      authType: 'key',
      hostFingerprint: 'SHA256:' + 'A'.repeat(43)
    },
    artifact_path: '/opt/opspilot/control-plane.cjs',
    data_directory: '/var/lib/opspilot',
    node_path: '/opt/opspilot/node',
    manifest_sha256: 'a'.repeat(64),
    display_name: 'setup',
    requested_scopes: ['read', 'deploy:manual', 'policy:write']
  })
  token = 'opspilot_' + randomBytes(32).toString('base64url')
  vault.activate(binding, 1, {
    state: 'issued_once',
    controller_id: 'remote-controller',
    client: {
      client_id: randomUUID(),
      controller_id: 'remote-controller',
      display_name: 'setup',
      scopes: ['read', 'deploy:manual', 'policy:write'],
      created_at: new Date().toISOString(),
      revoked_at: null,
      token_expires_at: expires
    },
    credential: { access_token: token, token_type: 'Bearer', expires_at: expires }
  })
  targetRevision = 3
  lost = false
  remote = new Map()
  targets = vi.fn<DesktopControllerEnrollment['projectTargets']>(async () => ({
    controller_id: 'remote-controller',
    items: [
      {
        id: 77,
        name: 'Remote target',
        host: 'target.test',
        port: 22,
        username: 'operator',
        host_fingerprint: 'SHA256:' + 'B'.repeat(43),
        ssh_security_revision: targetRevision
      }
    ],
    next_after_id: null,
    has_more: false
  }))
  register = vi.fn<DesktopControllerEnrollment['registerProject']>(
    async (_bindingId: string, body: ProductProjectRegistrationInput) => {
      let result = remote.get(body.request_key)
      if (!result) {
        result = {
          state: 'registered',
          controller_id: body.controller_id,
          request_key: body.request_key,
          app_id: 42,
          target_vps_id: body.target_vps_id,
          host_port: body.host_port ?? 30000,
          ownership_generation: 1,
          source_generation: 1,
          source_config_sha256: 'b'.repeat(64),
          auto_deploy_paused: true,
          source_verification: 'required',
          target_enrollment: 'required',
          runtime_preflight: 'required'
        }
        remote.set(body.request_key, result)
      }
      if (lost) {
        lost = false
        throw new Error(token)
      }
      return { ...result, state: remote.size ? 'already_registered' : 'registered' }
    }
  )
  setups = new DesktopProjectSetups(db, vault, {
    projectTargetState: (targetRead = vi.fn<DesktopControllerEnrollment['projectTargetState']>(
      async (_binding, request) => ({
        controller_id: request.controller_id,
        app_id: request.app_id,
        ownership_generation: request.expected_ownership_generation,
        source_generation: request.expected_source_generation,
        source_config_sha256: request.expected_source_config_sha256,
        target_vps_id: 77,
        target_security_revision: 3,
        target_host: 'target.test',
        target_port: 22,
        target_username: 'root',
        target_fingerprint: 'SHA256:' + 'B'.repeat(43),
        target_root: '/var/lib/opspilot-product',
        state: 'not_prepared',
        proof: 'not_available',
        deployment_started: false,
        runtime_preflight: 'required',
        checked_at: new Date().toISOString()
      })
    )),
    enrollProjectTarget: (targetEnroll = vi.fn<DesktopControllerEnrollment['enrollProjectTarget']>(
      async (binding, request) => ({
        ...(await targetRead(binding, request)),
        state: 'unknown',
        target_root: request.target_root
      })
    )),
    projectTargets: targets,
    registerProject: register,
    verifyProjectSource: (verify = vi.fn<DesktopControllerEnrollment['verifyProjectSource']>(
      async (_binding, request) => ({
        state: 'source_verified',
        controller_id: request.controller_id,
        app_id: request.app_id,
        ownership_generation: request.expected_ownership_generation,
        source_generation: request.expected_source_generation,
        source_config_sha256: request.expected_source_config_sha256,
        target_vps_id: 77,
        target_security_revision: 3,
        repository_url: 'https://github.com/example/api.git',
        production_ref: 'main',
        repository_root: '.',
        commit_sha: 'c'.repeat(40),
        observation_sequence: 1,
        framework: 'express',
        configured_container_port: 3000,
        detected_container_port: 3000,
        source_file_count: 12,
        source_bytes: 64000,
        auto_deploy_paused: true,
        deployment_started: false,
        runtime_preflight: 'required',
        verified_at: new Date().toISOString()
      })
    ))
  } as never)
  input = {
    binding_id: binding,
    target_vps_id: 77,
    app_name: 'new-api',
    framework: 'express',
    repository_url: 'https://github.com/example/api',
    production_ref: 'main',
    repository_root: '.',
    host_port: null,
    container_port: 3000,
    healthcheck_path: '/health'
  }
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
describe('Desktop durable Product project setup', () => {
  it('derives target review and preparation from registered journal, preserving unknown without creating deployment intent', async () => {
    const row = await setups.prepare(input)
    await expect(setups.targetState(row.request_key)).rejects.toThrow('PROJECT_SETUP_CONFLICT')
    expect(targetRead).not.toHaveBeenCalled()
    await setups.send(row.request_key)
    const state = await setups.targetState(row.request_key)
    expect(state).toMatchObject({
      state: 'not_prepared',
      request_key: row.request_key,
      binding_revision: 2,
      target_vps_id: 77
    })
    expect(
      await setups.enrollTarget({ request_key: row.request_key, target_root: '/private/approved' })
    ).toMatchObject({ state: 'unknown', proof: 'not_available', target_root: '/private/approved' })
    expect(targetEnroll).toHaveBeenCalledWith(
      input.binding_id,
      expect.objectContaining({
        app_id: 42,
        expected_source_config_sha256: 'b'.repeat(64),
        target_root: '/private/approved'
      })
    )
    expect(db.prepare('SELECT count(*) AS n FROM product_deploy_job').get()).toEqual({ n: 0 })
  })
  it('rejects invalid target input and forged proof or identity metadata', async () => {
    const row = await setups.prepare(input)
    await setups.send(row.request_key)
    await expect(
      setups.enrollTarget({ request_key: row.request_key, target_root: '/bad/../path' })
    ).rejects.toThrow('PROJECT_REQUEST_INVALID')
    await expect(
      setups.enrollTarget({
        request_key: row.request_key,
        target_root: '/safe',
        script: 'no'
      } as never)
    ).rejects.toThrow('PROJECT_REQUEST_INVALID')
    expect(targetEnroll).not.toHaveBeenCalled()
    const original = targetRead.getMockImplementation()!
    targetRead.mockImplementationOnce(async (...args) => ({
      ...(await original(...args)),
      state: 'enrolled',
      proof: 'not_available'
    }))
    await expect(setups.targetState(row.request_key)).rejects.toThrow('PROJECT_RESPONSE_INVALID')
    targetRead.mockImplementationOnce(async (...args) => ({
      ...(await original(...args)),
      app_id: 999
    }))
    await expect(setups.targetState(row.request_key)).rejects.toThrow('PROJECT_RESPONSE_INVALID')
  })
  it('does not accept a target preparation reply after local connection disable', async () => {
    const row = await setups.prepare(input)
    await setups.send(row.request_key)
    const original = targetEnroll.getMockImplementation()!
    targetEnroll.mockImplementationOnce(async (...args) => {
      const result = await original(...args)
      vault.disable(input.binding_id, 2)
      return result
    })
    await expect(
      setups.enrollTarget({ request_key: row.request_key, target_root: '/private/approved' })
    ).rejects.toThrow('BINDING_UNAVAILABLE')
  })
  it('derives source authority from registered setup and returns only bound verification metadata without another registration', async () => {
    const prepared = await setups.prepare(input)
    await expect(setups.verifySource(prepared.request_key)).rejects.toThrow(
      'PROJECT_SETUP_CONFLICT'
    )
    expect(verify).not.toHaveBeenCalled()
    await setups.send(prepared.request_key)
    const result = await setups.verifySource(prepared.request_key)
    expect(verify).toHaveBeenCalledWith(input.binding_id, {
      format: 1,
      controller_id: 'remote-controller',
      app_id: 42,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: 'b'.repeat(64),
      expected_target_security_revision: 3
    })
    expect(result).toMatchObject({
      binding_id: input.binding_id,
      binding_revision: 2,
      request_key: prepared.request_key,
      commit_sha: 'c'.repeat(40),
      deployment_started: false
    })
    expect(register).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain(token)
    expect(db.prepare('SELECT count(*) AS n FROM product_deploy_job').get()).toEqual({ n: 0 })
  })
  it.each([
    { controller_id: 'foreign' },
    { app_id: 999 },
    { target_vps_id: 1 },
    { target_security_revision: 4 },
    { source_generation: 2 },
    { ownership_generation: 2 },
    { source_config_sha256: 'e'.repeat(64) },
    { repository_url: 'https://github.com/other/api.git' },
    { production_ref: 'other' },
    { repository_root: 'other' },
    { configured_container_port: 4444 },
    { deployment_started: true },
    { auto_deploy_paused: false },
    { verified_at: '2020-01-01T00:00:00Z' },
    { raw_secret: 'never-export' }
  ])('rejects mismatched or untrusted source reply: %j', async (changed) => {
    const prepared = await setups.prepare(input)
    await setups.send(prepared.request_key)
    const original = verify.getMockImplementation()!
    verify.mockImplementationOnce(
      async (...args) => ({ ...(await original(...args)), ...changed }) as never
    )
    await expect(setups.verifySource(prepared.request_key)).rejects.toThrow(
      'PROJECT_RESPONSE_INVALID'
    )
  })
  it('ignores late source result after local binding disable and prevents overlapping verification', async () => {
    const prepared = await setups.prepare(input)
    await setups.send(prepared.request_key)
    const original = verify.getMockImplementation()!
    let finish!: () => void
    verify.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return original(...args)
    })
    const first = setups.verifySource(prepared.request_key)
    await expect(setups.verifySource(prepared.request_key)).rejects.toThrow('PROJECT_SETUP_BUSY')
    vault.disable(input.binding_id, 2)
    const rejected = expect(first).rejects.toThrow()
    finish()
    await rejected
    expect(verify).toHaveBeenCalledOnce()
  })
  it('keeps exact shared metadata contract and upgrades v026 without creating remote apps', () => {
    const read = (p: string): string =>
      readFileSync(new URL(p, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
    expect(read('../../shared/desktopProjectRegistration.ts')).toBe(
      read('../../../../docs/contracts/desktop-project-registration.ts')
    )
    const before = db.prepare('SELECT * FROM desktop_controller_binding').all()
    db.exec(
      'DROP TABLE IF EXISTS desktop_target_setup;DROP TABLE IF EXISTS product_vps_registration;DELETE FROM schema_version WHERE version=28;DROP TABLE desktop_project_setup;DELETE FROM schema_version WHERE version=27'
    )
    runMigrations(db)
    runMigrations(db)
    expect(db.prepare('SELECT * FROM desktop_controller_binding').all()).toEqual(before)
    expect(setups.list(input.binding_id)).toEqual([])
    expect(register).not.toHaveBeenCalled()
  })
  it('uses remote target ID and revision, persists main UUID before register and returns same unsent setup', async () => {
    const targetPage = await setups.targets(input.binding_id)
    expect(targetPage.items[0].id).toBe(77)
    const first = await setups.prepare(input),
      second = await setups.prepare(input)
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      state: 'prepared',
      target_vps_id: 77,
      target_security_revision: 3,
      repository_url: 'https://github.com/example/api.git'
    })
    expect(first.request_key).toMatch(/^[a-f0-9-]{36}$/)
    expect(register).not.toHaveBeenCalled()
    expect(first).not.toHaveProperty('body_json')
    expect(JSON.stringify(db.prepare('SELECT * FROM desktop_project_setup').all())).not.toContain(
      token
    )
  })
  it('fails missing remote targets and rejects caller request key, revision, secret or endpoint fields', async () => {
    for (const extra of [
      { request_key: randomUUID() },
      { expected_target_security_revision: 99 },
      { secret: token },
      { host: 'wrong.test' }
    ])
      await expect(setups.prepare({ ...input, ...extra } as never)).rejects.toThrow(
        'PROJECT_REQUEST_INVALID'
      )
    await expect(setups.prepare({ ...input, target_vps_id: 1 })).rejects.toThrow(
      'PROJECT_TARGET_CHANGED'
    )
    expect(register).not.toHaveBeenCalled()
  })
  it('retries after cold SQLite reopen with one original UUID and one remote app', async () => {
    const row = await setups.prepare(input)
    lost = true
    await expect(setups.send(row.request_key)).rejects.toThrow(token)
    expect(setups.list(input.binding_id)[0].state).toBe('outcome_unknown')
    closeDatabase()
    db = initializeDatabase(directory)
    vault = new DesktopControllerVault(db, cipher)
    setups = new DesktopProjectSetups(db, vault, {
      projectTargets: targets,
      registerProject: register
    } as never)
    expect(await setups.send(row.request_key)).toMatchObject({ state: 'registered', app_id: 42 })
    expect(remote.size).toBe(1)
    expect(register.mock.calls.map((call) => call[1].request_key)).toEqual([
      row.request_key,
      row.request_key
    ])
    expect(await setups.send(row.request_key)).toMatchObject({ state: 'registered' })
    expect(register).toHaveBeenCalledTimes(2)
  })
  it('serializes same-process sends and does not cancel a request after dispatch starts', async () => {
    const row = await setups.prepare(input)
    let complete!: (value: ProductProjectRegistrationResult) => void
    register.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const sent = setups.send(row.request_key)
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    await expect(setups.send(row.request_key)).rejects.toThrow('PROJECT_SETUP_BUSY')
    expect(() => setups.cancel(row.request_key)).toThrow('PROJECT_SETUP_CONFLICT')
    complete({
      state: 'registered',
      controller_id: 'remote-controller',
      request_key: row.request_key,
      app_id: 42,
      target_vps_id: 77,
      host_port: 30000,
      ownership_generation: 1,
      source_generation: 1,
      source_config_sha256: 'b'.repeat(64),
      auto_deploy_paused: true,
      target_enrollment: 'required',
      runtime_preflight: 'required',
      source_verification: 'required'
    })
    expect((await sent).state).toBe('registered')
  })
  it('allows cancel only before send and retains a separate new UUID when user starts again', async () => {
    const row = await setups.prepare(input)
    expect(setups.cancel(row.request_key).state).toBe('cancelled')
    expect((await setups.send(row.request_key)).state).toBe('cancelled')
    expect(register).not.toHaveBeenCalled()
    expect((await setups.prepare(input)).request_key).not.toBe(row.request_key)
  })
  it('rejects changes to body/name binding and remote target revision before remote mutation', async () => {
    const row = await setups.prepare(input)
    await expect(setups.prepare({ ...input, production_ref: 'develop' })).rejects.toThrow(
      'PROJECT_SETUP_CONFLICT'
    )
    targetRevision = 4
    await expect(setups.send(row.request_key)).rejects.toThrow('PROJECT_TARGET_CHANGED')
    expect(register).not.toHaveBeenCalled()
    expect(setups.list(input.binding_id)[0].state).toBe('outcome_unknown')
  })
  it('does not accept a late success after disconnect and preserves setup tombstones after VPS removal', async () => {
    const row = await setups.prepare(input),
      original = register.getMockImplementation()!
    register.mockImplementationOnce(async (...args) => {
      const result = await original(...args)
      vault.disable(input.binding_id, vault.get(input.binding_id).revision)
      return result
    })
    await expect(setups.send(row.request_key)).rejects.toThrow('BINDING_UNAVAILABLE')
    expect(setups.list(input.binding_id)[0].state).toBe('outcome_unknown')
    db.exec('DELETE FROM vps WHERE id=1')
    expect(setups.list(input.binding_id)).toHaveLength(1)
  })
  it('requires write consent and rejects stale controller principal before listing targets', async () => {
    const original = vault.get(input.binding_id)
    db.prepare(
      "UPDATE desktop_controller_binding SET client_json=json_set(client_json,'$.scopes',json('[\"read\"]'))"
    ).run()
    await expect(setups.targets(input.binding_id)).rejects.toThrow('BINDING_UNAVAILABLE')
    expect(targets).not.toHaveBeenCalled()
    expect(original.client?.scopes).toContain('deploy:manual')
  })
  it('validates returned request/controller/target IDs before saving registered status', async () => {
    const row = await setups.prepare(input),
      original = register.getMockImplementation()!
    register.mockImplementationOnce(async (...args) => ({
      ...(await original(...args)),
      request_key: randomUUID()
    }))
    await expect(setups.send(row.request_key)).rejects.toThrow('PROJECT_RESPONSE_INVALID')
    expect(setups.list(input.binding_id)[0]).toMatchObject({
      state: 'outcome_unknown',
      app_id: null
    })
  })
  it('prevents changing the stored intent and detects corrupt metadata without echoing raw content', async () => {
    await setups.prepare(input)
    expect(() => db.exec("UPDATE desktop_project_setup SET body_json='{}'")).toThrow(
      'DESKTOP_SETUP_IMMUTABLE'
    )
    db.exec('DROP TRIGGER desktop_setup_immutable')
    db.prepare('UPDATE desktop_project_setup SET body_json=?').run(token)
    expect(() => setups.list(input.binding_id)).toThrow('PROJECT_SETUP_UNAVAILABLE')
  })
})
