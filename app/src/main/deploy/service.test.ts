import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EncryptedCredential } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from '../db'
import { AppRepository } from '../db/appRepository'
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
})

function createHarness(gitSnapshotFactory?: (input: GitSnapshotInput) => Promise<GitSnapshot>): {
  service: DeployService
  exec: ReturnType<typeof vi.fn>
  vpsId: number
  appId: number
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
  const exec = vi.fn(async (_vpsId: number, command: string) =>
    command === 'ss -H -ltn'
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
  )
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
    appId: app.id
  }
}

function fakeCredential(value: string): EncryptedCredential {
  return {
    crypto_scheme: 'aes_256_gcm',
    encrypted_secret: Buffer.from(value),
    iv: Buffer.alloc(12, 1),
    auth_tag: Buffer.alloc(16, 2)
  }
}
