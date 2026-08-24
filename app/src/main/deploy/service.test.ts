import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EncryptedCredential } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from '../db'
import { AppRepository } from '../db/appRepository'
import { VpsRepository } from '../db/vpsRepository'
import type { SshManager } from '../ssh/manager'
import { DeployService } from './service'

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

  it('van kiem tra cong du kien doi voi app moi', async () => {
    const { service, exec, vpsId } = createHarness()

    const result = await service.precheck({
      vps_id: vpsId,
      app_name: 'new-api',
      source_path: 'C:\\new-api',
      env: {}
    })

    expect(result.assigned_host_port).toBe(30_001)
    expect(exec.mock.calls[0][1]).toContain("printf 'PORT|'")
    expect(exec.mock.calls[0][1]).toContain(':30001 ')
  })
})

function createHarness(): {
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
  const exec = vi.fn(async () => ({
    code: 0,
    stdout: [
      'RAM_MB|2048',
      'DISK_GB|20',
      'PORT|FREE',
      'DOCKER|Docker version 29.7.2, build 1234'
    ].join('\n'),
    stderr: ''
  }))
  const ssh = { exec } as unknown as SshManager

  return {
    service: new DeployService({ ssh, db: database, emit: () => undefined }),
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
