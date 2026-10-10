import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EncryptedCredential } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from '../db'
import { AppRepository } from '../db/appRepository'
import { DeploymentRepository } from '../db/deploymentRepository'
import { VpsRepository } from '../db/vpsRepository'
import type { SshManager } from '../ssh/manager'
import { DeployService } from './service'
import type { GitSnapshot, GitSnapshotInput } from '../git/snapshot'

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('DeployService.precheck', () => {
  it('khong xem cong cua app dang chay la xung dot khi redeploy', async () => {
    const { service, exec, vpsId, appId } = createHarness()

    const result = await service.precheck({
      vps_id: vpsId,
      app_id: appId,
      app_name: 'demo-api',
      source_path: 'C:\\demo-api',
      env: {}
    })

    expect(result.passed).toBe(true)
    expect(result.assigned_host_port).toBe(30_000)
    expect(result.app_url).toBe('http://203.0.113.55:30000')
    expect(exec).toHaveBeenCalledOnce()
    expect(exec.mock.calls[0][1]).not.toContain("printf 'PORT|'")
    expect(result.checks.map((check) => check.label)).not.toContain('Cổng 30000')
  })

  it('bo qua ca cong trong SQLite va cong dang listen that tren VPS', async () => {
    const { service, exec, vpsId } = createHarness()

    const result = await service.precheck({
      vps_id: vpsId,
      app_name: 'new-api',
      source_path: 'C:\\new-api',
      env: {}
    })

    expect(result.assigned_host_port).toBe(30_002)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec.mock.calls[0][1]).toBe('ss -H -ltn')
    expect(exec.mock.calls[1][1]).toContain("printf 'PORT|'")
    expect(exec.mock.calls[1][1]).toContain(':30002 ')
  })

  it.each(['retained', 'explicit override'] as const)(
    'verifies existing local app required keys without returning retained values (%s)',
    async (mode) => {
      const { service, vpsId, appId } = createHarness(undefined, {
        deployed: true,
        existingEnv: 'PORT=3000\nSESSION_SECRET=fake-existing-secret\nAPI_TOKEN=fake-existing-token\n'
      })
      const sourcePath = createEnvSource()
      const result = await service.precheck({
        vps_id: vpsId,
        app_id: appId,
        app_name: 'demo-api',
        source_path: sourcePath,
        env: mode === 'explicit override' ? { SESSION_SECRET: 'fake-new-secret' } : {}
      })

      expect(result.passed).toBe(true)
      expect(result.checks.find((check) => check.label === 'Required environment')).toMatchObject({
        ok: true,
        actual: 'Required keys are available'
      })
      expect(JSON.stringify(result)).not.toContain('fake-existing-secret')
      expect(JSON.stringify(result)).not.toContain('fake-existing-token')
      expect(JSON.stringify(result)).not.toContain('fake-new-secret')
    }
  )

  it('fails closed when the existing .env cannot be read and names only keys that need verification', async () => {
    const { service, vpsId, appId } = createHarness(undefined, {
      deployed: true,
      existingEnv: 'PORT=3000\nAPI_TOKEN=fake-existing-token\n',
      envReadFails: true
    })
    const sourcePath = createEnvSource()
    const result = await service.precheck({
      vps_id: vpsId,
      app_id: appId,
      app_name: 'demo-api',
      source_path: sourcePath,
      env: {}
    })

    expect(result.passed).toBe(false)
    const check = result.checks.find((item) => item.label === 'Required environment')
    expect(check?.ok).toBe(false)
    expect(check?.actual).toContain('SESSION_SECRET')
    expect(JSON.stringify(result)).not.toContain('fake-existing-token')
    expect(JSON.stringify(result)).not.toContain('fake-secret-read-error')
  })

  it('reports detector-required key names when an existing readable .env lacks them', async () => {
    const { service, vpsId, appId } = createHarness(undefined, {
      deployed: true,
      existingEnv: 'PORT=3000\nAPI_TOKEN=fake-existing-token\n'
    })
    const sourcePath = createEnvSource()
    const result = await service.precheck({
      vps_id: vpsId,
      app_id: appId,
      app_name: 'demo-api',
      source_path: sourcePath,
      env: {}
    })

    expect(result.passed).toBe(false)
    const check = result.checks.find((item) => item.label === 'Required environment')
    expect(check?.actual).toBe('Missing key names: SESSION_SECRET')
    expect(JSON.stringify(result)).not.toContain('fake-existing-token')
  })
})

describe('DeployService Git snapshot handoff', () => {
  it('passes the prepared root and pinned snapshot unchanged through precheck to start', async () => {
    const snapshotHolder: { value?: GitSnapshot } = {}
    const { service, vpsId } = createHarness(async () => {
      if (!snapshotHolder.value) throw new Error('Snapshot fixture is not initialized.')
      return snapshotHolder.value
    })
    const fixtureDirectory = testDirectory!
    const root = join(fixtureDirectory, 'root')
    const snapshotDirectory = join(fixtureDirectory, 'snapshot')
    mkdirSync(root)
    mkdirSync(snapshotDirectory)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        scripts: { start: 'node index.js' },
        dependencies: { express: '4.0.0' }
      })
    )
    writeFileSync(join(root, 'index.js'), "require('express')().listen(3000)\n")
    const snapshot: GitSnapshot = {
      repositoryUrl: 'https://github.com/example/repo.git',
      commitSha: 'b'.repeat(40),
      rootDirectory: root,
      snapshotDirectory,
      cleanup: vi.fn()
    }
    snapshotHolder.value = snapshot
    const prepared = await service.prepareGit('git-request', {
      source_type: 'git',
      git_repo_url: 'https://github.com/example/repo',
      git_ref: 'main',
      git_root: '.'
    })
    const input = {
      source_type: 'git' as const,
      prepared_source_handle: prepared.prepared_source_handle,
      vps_id: vpsId,
      app_name: 'git-service-api',
      env: {}
    }
    const precheck = await service.precheck(input)
    expect(precheck.passed).toBe(true)
    expect(precheck.precheck_token).toBeTruthy()

    const run = vi.spyOn(service.pipeline, 'run').mockReturnValue({ deploymentId: 77 })
    const started = service.start({ ...input, precheck_token: precheck.precheck_token! })

    expect(started).toEqual({ deployment_id: 77 })
    expect(run).toHaveBeenCalledOnce()
    const [pipelineInput, signal, lease] = run.mock.calls[0]
    expect(pipelineInput.source_path).toBe(root)
    expect(signal).toBeUndefined()
    expect(lease?.snapshot).toBe(snapshot)
    expect(lease?.commitSha).toBe(prepared.git_commit_sha)
    expect(snapshot.cleanup).not.toHaveBeenCalled()
    snapshot.cleanup()
  })

  it('validates existing Git app env from VPS and binds the precheck token to explicit overrides', async () => {
    const snapshotHolder: { value?: GitSnapshot } = {}
    const { service, vpsId, database } = createHarness(
      async () => {
        if (!snapshotHolder.value) throw new Error('Snapshot fixture is not initialized.')
        return snapshotHolder.value
      },
      {
        deployed: false,
        existingEnv: 'PORT=3000\nSESSION_SECRET=fake-existing-git-secret\nAPI_TOKEN=fake-existing-git-token\n'
      }
    )
    const root = createEnvSource()
    snapshotHolder.value = {
      repositoryUrl: 'https://github.com/example/repo.git',
      commitSha: 'd'.repeat(40),
      rootDirectory: root,
      snapshotDirectory: root,
      cleanup: vi.fn()
    }
    const prepared = await service.prepareGit('existing-git-request', {
      source_type: 'git',
      git_repo_url: 'https://github.com/example/repo',
      git_ref: 'main',
      git_root: '.'
    })
    const appRepository = new AppRepository(database)
    const gitApp = appRepository.create({
      vps_id: vpsId,
      name: 'git-service-api',
      framework: 'express',
      source_path: null,
      source_type: 'git',
      git_repo_url: prepared.git_repo_url,
      git_ref: prepared.git_ref,
      git_root: prepared.git_root,
      host_port: 30_011,
      container_port: 3_000,
      healthcheck_path: '/health',
      needs_db: 0
    })
    markAppDeployed(database, gitApp.id, gitApp.name)
    const input = {
      source_type: 'git' as const,
      prepared_source_handle: prepared.prepared_source_handle,
      vps_id: vpsId,
      app_id: gitApp.id,
      app_name: gitApp.name,
      env: { SESSION_SECRET: 'fake-explicit-git-override' }
    }

    const precheck = await service.precheck(input)
    expect(precheck.passed).toBe(true)
    expect(precheck.precheck_token).toBeTruthy()
    expect(JSON.stringify(precheck)).not.toContain('fake-existing-git-secret')
    expect(JSON.stringify(precheck)).not.toContain('fake-existing-git-token')
    expect(JSON.stringify(precheck)).not.toContain('fake-explicit-git-override')

    let startError: unknown
    try {
      service.start({
        ...input,
        env: { SESSION_SECRET: 'fake-changed-after-precheck' },
        precheck_token: precheck.precheck_token!
      })
    } catch (error) {
      startError = error
    }
    expect(startError).toMatchObject({
      userMessage: expect.stringContaining('đã đổi sau precheck')
    })
  })
})

interface HarnessOptions {
  deployed?: boolean
  existingEnv?: string
  envReadFails?: boolean
}

function createHarness(
  gitSnapshotFactory?: (input: GitSnapshotInput) => Promise<GitSnapshot>,
  options: HarnessOptions = {}
): {
  service: DeployService
  exec: ReturnType<typeof vi.fn>
  vpsId: number
  appId: number
  database: ReturnType<typeof initializeDatabase>
} {
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-deploy-service-'))
  const database = initializeDatabase(testDirectory)
  const vps = new VpsRepository(database).create({
    name: 'VM Test',
    host: '203.0.113.55',
    port: 22,
    username: 'deploy',
    auth_type: 'password',
    credential: fakeCredential('cipher')
  })
  const app = new AppRepository(database).create({
    vps_id: vps.id,
    name: 'demo-api',
    framework: 'express',
    source_path: 'C:\\demo-api',
    host_port: 30_000,
    container_port: 3_000,
    healthcheck_path: '/health',
    needs_db: 0
  })
  if (options.deployed) markAppDeployed(database, app.id, app.name)
  const exec = vi.fn(async (_vpsId: number, command: string) => {
    if (command.includes('head -c 65537') && command.includes('/.env')) {
      return options.envReadFails
        ? { code: 1, stdout: '', stderr: 'fake-secret-read-error' }
        : { code: 0, stdout: options.existingEnv ?? '', stderr: '' }
    }
    return command === 'ss -H -ltn'
      ? { code: 0, stdout: 'LISTEN 0 4096 0.0.0.0:30001 0.0.0.0:*', stderr: '' }
      : {
          code: 0,
          stdout: [
            'RAM_MB|2048',
            'DISK_GB|20',
            'PORT|FREE',
            'DOCKER|Docker version 29.7.2, build 1234'
          ].join('\n'),
          stderr: ''
        }
  })
  const ssh = { exec } as unknown as SshManager

  return {
    service: new DeployService({
      ssh,
      db: database,
      emit: () => undefined,
      gitSnapshotFactory
    }),
    exec,
    vpsId: vps.id,
    appId: app.id,
    database
  }
}

function createEnvSource(): string {
  const root = join(testDirectory!, 'source')
  mkdirSync(root)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'env-api', scripts: { start: 'node index.js' }, dependencies: { express: '4' } })
  )
  writeFileSync(join(root, 'index.js'), "require('express')().listen(process.env.PORT || 3000)\n")
  writeFileSync(join(root, '.env.example'), 'SESSION_SECRET=replace-me\n')
  return root
}

function markAppDeployed(
  database: ReturnType<typeof initializeDatabase>,
  appId: number,
  appName: string
): void {
  const deployment = new DeploymentRepository(database).createNextVersion(appId, appName, null, null)
  new AppRepository(database).setCurrentDeployment(appId, deployment.id)
}

function fakeCredential(value: string): EncryptedCredential {
  return {
    crypto_scheme: 'aes_256_gcm',
    encrypted_secret: Buffer.from(value),
    iv: Buffer.alloc(12, 1),
    auth_tag: Buffer.alloc(16, 2)
  }
}
