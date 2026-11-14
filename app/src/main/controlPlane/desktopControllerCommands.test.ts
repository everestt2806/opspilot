import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase, runMigrations } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { DesktopControllerVault } from './desktopControllerVault'
import { DesktopControllerCommands } from './desktopControllerCommands'
import { ControllerHttpClientError, type ControllerHttpClient } from './controllerHttpClient'
import type { DesktopControllerCommandInput } from '@shared/desktopControllerCommands'

let directory: string,
  db: Database.Database,
  vault: DesktopControllerVault,
  commands: DesktopControllerCommands,
  input: DesktopControllerCommandInput,
  call: ReturnType<typeof vi.fn<ControllerHttpClient['call']>>,
  token: string,
  cipher: AesGcmCredentialCipher
const meta = (): Record<string, unknown> => ({
  controller_id: 'remote-controller',
  request_id: randomUUID(),
  sampled_at: new Date().toISOString(),
  data_freshness: 'current'
})
const accepted = (): unknown => ({
  state: 'response_received',
  response: {
    ...meta(),
    app_id: 21,
    job_id: 'job-21',
    target_sha: 'b'.repeat(40),
    state: 'queued',
    auto_deploy_paused: true,
    retry_with_same_idempotency_key: true
  }
})
const lookup = (key: string, changes: Record<string, unknown> = {}): unknown => ({
  state: 'response_received',
  response: {
    ...meta(),
    found: true,
    status: {
      request_key: key,
      action: 'manual_redeploy',
      app_id: 21,
      ownership_generation: 4,
      source_generation: 2,
      state: 'accepted',
      job_id: 'job-21',
      reason_code: null,
      updated_at: new Date().toISOString(),
      ...changes
    }
  }
})
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-desktop-command-'))
  db = initializeDatabase(directory)
  db.prepare(
    "INSERT INTO vps(id,name,host,host_fingerprint,username,auth_type,encrypted_secret) VALUES(1,'unit','controller.test',?,'operator','key',X'0102')"
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
      hostFingerprint: 'SHA256:' + 'A'.repeat(43),
      username: 'operator',
      authType: 'key'
    },
    artifact_path: '/opt/opspilot/payload/control-plane.cjs',
    data_directory: '/var/lib/opspilot',
    node_path: '/opt/opspilot/node',
    manifest_sha256: 'a'.repeat(64),
    display_name: 'Journal test',
    requested_scopes: ['read', 'deploy:manual', 'policy:write']
  })
  token = 'opspilot_' + randomBytes(32).toString('base64url')
  vault.activate(binding, 1, {
    state: 'issued_once',
    controller_id: 'remote-controller',
    client: {
      client_id: randomUUID(),
      controller_id: 'remote-controller',
      display_name: 'Journal test',
      scopes: ['read', 'deploy:manual', 'policy:write'],
      created_at: new Date().toISOString(),
      token_expires_at: expires,
      revoked_at: null
    },
    credential: { access_token: token, token_type: 'Bearer', expires_at: expires }
  })
  input = {
    binding_id: binding,
    app_id: 21,
    expected_ownership_generation: 4,
    expected_source_generation: 2,
    operation: 'redeploy',
    target: { kind: 'current_desired' }
  }
  call = vi.fn<ControllerHttpClient['call']>(async () => accepted() as never)
  commands = new DesktopControllerCommands(db, vault, {} as never, () => ({ call }))
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})

describe('Durable Desktop Product command journal', () => {
  it('keeps the shared command contract in exact parity', () => {
    const read = (path: string): string =>
      readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
    expect(read('../../shared/desktopControllerCommands.ts')).toBe(
      read('../../../../docs/contracts/desktop-controller-commands.ts')
    )
  })
  it('upgrades a populated v024 without changing bindings or implicitly sending anything', () => {
    const before = db.prepare('SELECT * FROM desktop_controller_binding').all()
    db.exec(
      'DROP TABLE IF EXISTS desktop_controller_upgrade;DELETE FROM schema_version WHERE version=30;DROP TABLE IF EXISTS desktop_controller_installation;DELETE FROM schema_version WHERE version=29;DROP TABLE IF EXISTS desktop_target_setup;DROP TABLE IF EXISTS product_vps_registration;DELETE FROM schema_version WHERE version=28;DROP TABLE IF EXISTS desktop_project_setup;DELETE FROM schema_version WHERE version=27;DROP TABLE IF EXISTS product_project_registration;DELETE FROM schema_version WHERE version=26;DROP TABLE desktop_controller_command;DELETE FROM schema_version WHERE version=25'
    )
    runMigrations(db)
    runMigrations(db)
    expect(db.prepare('SELECT * FROM desktop_controller_binding').all()).toEqual(before)
    expect(db.prepare('SELECT MAX(version) AS n FROM schema_version').get()).toEqual({ n: 36 })
    expect(commands.list(input.binding_id)).toEqual([])
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(call).not.toHaveBeenCalled()
  })
  it('persists one main-generated UUID before networking and keeps its content immutable', () => {
    const prepared = commands.prepare(input)
    expect(prepared).toMatchObject({ state: 'prepared', app_id: 21, remote_state: null })
    expect(prepared.request_key).toMatch(/^[a-f0-9-]{36}$/)
    expect(commands.prepare(input)).toEqual(prepared)
    expect(() => commands.prepare({ ...input, expected_source_generation: 3 })).toThrow(
      'COMMAND_PENDING'
    )
    expect(() => db.prepare("UPDATE desktop_controller_command SET body_json='{}'").run()).toThrow(
      'DESKTOP_COMMAND_IMMUTABLE'
    )
    expect(call).not.toHaveBeenCalled()
    expect(
      JSON.stringify(db.prepare('SELECT * FROM desktop_controller_command').all())
    ).not.toContain(token)
    expect(prepared).not.toHaveProperty('body_json')
  })
  it('rejects caller UUID/secret/note injection and scopes not present in the authenticated vault', () => {
    for (const extra of [{ request_key: randomUUID() }, { access_token: token }, { reason: token }])
      expect(() => commands.prepare({ ...input, ...extra } as never)).toThrow('REQUEST_INVALID')
    const metadata = vault.get(input.binding_id)
    // Cipher envelope prevents changing public scopes independently.
    db.prepare(
      "UPDATE desktop_controller_binding SET client_json=json_set(client_json,'$.scopes',json('[\"read\"]'))"
    ).run()
    expect(() => commands.prepare(input)).toThrow('BINDING_UNAVAILABLE')
    expect(metadata.client?.scopes).toContain('deploy:manual')
    expect(call).not.toHaveBeenCalled()
  })
  it('commits in_flight before POST, serializes competing sends and reports only request acceptance', async () => {
    const row = commands.prepare(input)
    let release!: (value: never) => void
    call.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const first = commands.send(row.request_key)
    const otherDb = new Database(join(directory, 'opspilot.db'))
    try {
      expect(otherDb.prepare('SELECT state FROM desktop_controller_command').get()).toEqual({
        state: 'in_flight'
      })
      const second = new DesktopControllerCommands(
        otherDb,
        new DesktopControllerVault(otherDb, cipher),
        {} as never,
        () => ({ call })
      )
      expect(await second.send(row.request_key)).toMatchObject({ state: 'in_flight' })
      release(accepted() as never)
      expect(await first).toMatchObject({
        state: 'accepted',
        remote_state: 'accepted',
        job_id: 'job-21'
      })
      expect(call).toHaveBeenCalledTimes(1)
    } finally {
      otherDb.close()
    }
  })
  it('recovers lost response after a cold reopen using only the original lookup key', async () => {
    const row = commands.prepare(input)
    call.mockResolvedValueOnce({
      state: 'outcome_unknown',
      idempotency_key: row.request_key,
      may_have_been_accepted: true,
      next_step: 'query_same_request_key'
    })
    expect(await commands.send(row.request_key)).toMatchObject({ state: 'outcome_unknown' })
    closeDatabase()
    db = initializeDatabase(directory)
    vault = new DesktopControllerVault(db, cipher)
    const cold = new DesktopControllerCommands(db, vault, {} as never, () => ({ call }))
    expect(await cold.send(row.request_key)).toMatchObject({ state: 'outcome_unknown' })
    call.mockResolvedValueOnce(lookup(row.request_key) as never)
    expect(await cold.check(row.request_key)).toMatchObject({ state: 'accepted', job_id: 'job-21' })
    expect(call.mock.calls.map(([op]) => op)).toEqual(['redeploy', 'lookup'])
    expect(call.mock.calls[1][1]).toEqual({ request_key: row.request_key })
  })
  it('treats a crash before network and lookup not found as unknown and never authorizes another POST', async () => {
    const row = commands.prepare(input)
    db.exec("UPDATE desktop_controller_command SET state='in_flight'")
    call.mockResolvedValueOnce({
      state: 'response_received',
      response: { ...meta(), found: false }
    } as never)
    expect(await commands.check(row.request_key)).toMatchObject({ state: 'outcome_unknown' })
    expect(await commands.send(row.request_key)).toMatchObject({ state: 'outcome_unknown' })
    expect(() => commands.prepare(input)).toThrow('COMMAND_PENDING')
    expect(() => commands.cancel(row.request_key)).toThrow('COMMAND_PENDING')
    expect(call.mock.calls.map(([op]) => op)).toEqual(['lookup'])
  })
  it('cancels only an unsent intent and allows a separately confirmed new key', async () => {
    const row = commands.prepare(input)
    expect(commands.cancel(row.request_key).state).toBe('cancelled')
    expect((await commands.send(row.request_key)).state).toBe('cancelled')
    expect(commands.prepare(input).request_key).not.toBe(row.request_key)
    expect(call).not.toHaveBeenCalled()
  })
  it('records validated 4xx as rejected and treats transport/5xx/raw errors as unknown without leaking text', async () => {
    for (const [error, expected] of [
      [new ControllerHttpClientError('SOURCE_GENERATION_STALE', 409), 'rejected'],
      [new ControllerHttpClientError('INTERNAL_ERROR', 500), 'outcome_unknown'],
      [new Error(token), 'outcome_unknown']
    ] as const) {
      const value = { ...input, app_id: input.app_id++ }
      const row = commands.prepare(value)
      call.mockRejectedValueOnce(error)
      const result = await commands.send(row.request_key)
      expect(result.state).toBe(expected)
      expect(JSON.stringify(result)).not.toContain(token)
    }
  })
  it('blocks changed VPS/binding before send and late response after local disconnect', async () => {
    const row = commands.prepare(input)
    db.exec('UPDATE vps SET ssh_security_revision=2 WHERE id=1')
    await expect(commands.send(row.request_key)).rejects.toThrow('BINDING_UNAVAILABLE')
    expect(call).not.toHaveBeenCalled()
    db.exec('UPDATE vps SET ssh_security_revision=1 WHERE id=1')
    call.mockImplementationOnce(async () => {
      vault.disable(input.binding_id, vault.get(input.binding_id).revision)
      return accepted() as never
    })
    expect(await commands.send(row.request_key)).toMatchObject({ state: 'outcome_unknown' })
  })
  it('rejects malformed success and mismatched lookup app/action/generations/key/job', async () => {
    const row = commands.prepare(input)
    call.mockResolvedValueOnce({
      state: 'response_received',
      response: { ...meta(), app_id: 21 }
    } as never)
    expect((await commands.send(row.request_key)).state).toBe('outcome_unknown')
    for (const change of [
      { app_id: 22 },
      { request_key: randomUUID() },
      { ownership_generation: 5 },
      { source_generation: 3 },
      { action: 'pause_auto_deploy' },
      { job_id: null }
    ]) {
      call.mockResolvedValueOnce(lookup(row.request_key, change) as never)
      await expect(commands.check(row.request_key)).rejects.toThrow('PROTOCOL_INVALID')
      expect(commands.get(row.request_key).state).toBe('outcome_unknown')
    }
  })
  it('does not regress a completed lookup when the original accepted HTTP response arrives late', async () => {
    const row = commands.prepare(input)
    let release!: (value: never) => void
    call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const sent = commands.send(row.request_key)
    call.mockResolvedValueOnce(lookup(row.request_key, { state: 'completed' }) as never)
    expect((await commands.check(row.request_key)).remote_state).toBe('completed')
    release(accepted() as never)
    expect((await sent).remote_state).toBe('completed')
  })
  it('never replaces the accepted job identity with a different lookup job', async () => {
    const row = commands.prepare(input)
    expect((await commands.send(row.request_key)).job_id).toBe('job-21')
    call.mockResolvedValueOnce(lookup(row.request_key, { job_id: 'different-job' }) as never)
    await expect(commands.check(row.request_key)).rejects.toThrow('PROTOCOL_INVALID')
    expect(commands.get(row.request_key).job_id).toBe('job-21')
  })
  it('rejects a success reply for the wrong specific SHA or policy boolean', async () => {
    const first = commands.prepare({
      ...input,
      operation: 'redeploy',
      target: { kind: 'specific_sha', sha: 'c'.repeat(40) }
    })
    expect((await commands.send(first.request_key)).state).toBe('outcome_unknown')
    const second = commands.prepare({
      binding_id: input.binding_id,
      app_id: 22,
      expected_ownership_generation: 4,
      expected_source_generation: 2,
      operation: 'policy',
      action: 'resume'
    })
    call.mockResolvedValueOnce({
      state: 'response_received',
      response: {
        ...meta(),
        app_id: 22,
        result: 'updated',
        auto_deploy_paused: true,
        pause_policy_provenance: 'explicit',
        reconciliation_state: 'paused',
        updated_at: new Date().toISOString()
      }
    } as never)
    expect((await commands.send(second.request_key)).state).toBe('outcome_unknown')
  })
  it('supports policy pause/resume with exact boolean results and no operator note', async () => {
    const row = commands.prepare({
      binding_id: input.binding_id,
      app_id: input.app_id,
      expected_ownership_generation: input.expected_ownership_generation,
      expected_source_generation: input.expected_source_generation,
      operation: 'policy',
      action: 'pause'
    } as DesktopControllerCommandInput)
    call.mockResolvedValueOnce({
      state: 'response_received',
      response: {
        ...meta(),
        app_id: 21,
        result: 'updated',
        auto_deploy_paused: true,
        pause_policy_provenance: 'explicit',
        reconciliation_state: 'paused',
        updated_at: new Date().toISOString()
      }
    } as never)
    expect(await commands.send(row.request_key)).toMatchObject({
      state: 'accepted',
      remote_state: 'completed',
      auto_deploy_paused: true,
      job_id: null
    })
    expect(call.mock.calls[0][0]).toBe('policy')
  })
  it('keeps journal tombstones after removing the VPS and refuses to send backwards state transitions', () => {
    const row = commands.prepare(input)
    db.exec('DELETE FROM vps WHERE id=1')
    expect(commands.list(input.binding_id)).toHaveLength(1)
    db.exec("UPDATE desktop_controller_command SET state='in_flight'")
    expect(() => db.exec("UPDATE desktop_controller_command SET state='prepared'")).toThrow(
      'DESKTOP_COMMAND_TRANSITION_INVALID'
    )
    expect(commands.get(row.request_key).controller_id).toBe('remote-controller')
  })
})

it('persists first-deploy intent and exact SHA before sending, including cold unknown lookup', async () => {
  const value = {
    ...input,
    operation: 'redeploy' as const,
    require_first_deployment: true as const,
    target: { kind: 'specific_sha' as const, sha: 'b'.repeat(40) }
  }
  const prepared = commands.prepare(value)
  expect(prepared.require_first_deployment).toBe(true)
  expect(prepared.target_sha).toBe('b'.repeat(40))
  expect(call).not.toHaveBeenCalled()
  expect(commands.prepare(value).request_key).toBe(prepared.request_key)
  call.mockRejectedValueOnce(new ControllerHttpClientError('PROTOCOL_INVALID'))
  expect((await commands.send(prepared.request_key)).state).toBe('outcome_unknown')
  const cold = new DesktopControllerCommands(db, vault, {} as never, () => ({ call }))
  expect((await cold.send(prepared.request_key)).target_sha).toBe('b'.repeat(40))
  expect(call).toHaveBeenCalledOnce()
})
