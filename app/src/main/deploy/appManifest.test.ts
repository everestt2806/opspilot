import { describe, expect, it, vi } from 'vitest'

import type { App } from '@shared/ipc'

import type { SshManager } from '../ssh/manager'
import { createAppManifest, writeAppManifest } from './appManifest'

const baseApp = {
  id: 7,
  name: 'demo-api',
  framework: 'express',
  source_type: 'local',
  git_repo_url: null,
  git_ref: null,
  git_root: null,
  host_port: 30001,
  container_port: 3000,
  healthcheck_path: '/health',
  needs_db: 1
} as App

describe('app recovery manifest', () => {
  it('marks local source unavailable without retaining the desktop source path', () => {
    const manifest = createAppManifest({ ...baseApp, source_path: 'C:\\private\\source' } as App)
    expect(manifest).toMatchObject({
      schema_version: 1,
      app: { name: 'demo-api' },
      source: { type: 'local', locator_available: false },
      ports: { host: 30001, container: 3000 },
      healthcheck: '/health',
      needs_db: true
    })
    expect(JSON.stringify(manifest)).not.toContain('private')
    expect(JSON.stringify(manifest)).not.toContain('source_path')
  })

  it('keeps safe Git locator fields and rejects credential-bearing remotes', () => {
    const manifest = createAppManifest({
      ...baseApp,
      source_type: 'git',
      git_repo_url: 'https://github.com/example/demo.git',
      git_ref: 'main',
      git_root: 'apps/web'
    } as App)
    expect(manifest.source).toEqual({
      type: 'git',
      locator_available: true,
      remote: 'https://github.com/example/demo.git',
      ref: 'main',
      root: 'apps/web'
    })
    expect(() =>
      createAppManifest({
        ...baseApp,
        source_type: 'git',
        git_repo_url: 'https://user:credential-marker@github.com/example/demo.git',
        git_ref: 'main',
        git_root: '.'
      } as App)
    ).toThrow('Unsafe Git locator')
  })

  it('writes a private temp file then atomically renames without exposing content in commands', async () => {
    const writeFile = vi.fn(async () => undefined)
    const exec = vi.fn<SshManager['exec']>(async () => ({
      code: 0,
      stdout: '',
      stderr: ''
    }))
    const ssh = { writeFile, exec } as unknown as SshManager
    await writeAppManifest(ssh, 1, baseApp)
    expect(writeFile).toHaveBeenCalledOnce()
    const [, tempPath, content, options] = writeFile.mock.calls[0] as unknown as [
      number,
      string,
      string,
      { mode: number; silent: boolean }
    ]
    expect(tempPath).toMatch(/\.opspilot-app\.json\.[0-9a-f-]+\.tmp$/)
    expect(options).toEqual({ mode: 0o600, silent: true })
    expect(content).not.toContain('source_path')
    expect(exec.mock.calls[0]?.[1]).toContain('mv -f --')
    expect(exec.mock.calls[0]?.[1]).not.toContain(content)
    expect(exec).toHaveBeenCalledOnce()
  })

  it('cleans the temp file on rename failure and leaves the destination untouched', async () => {
    const remote = new Map<string, string>([
      ['/opt/opspilot/demo-api/.opspilot-app.json', 'prior-valid-manifest']
    ])
    const writeFile = vi.fn(async (_id: number, path: string, content: string) => {
      remote.set(path, content)
    })
    const exec = vi.fn(
      async (
        _id: number,
        command: string
      ): Promise<{ code: number; stdout: string; stderr: string }> => {
        if (command.startsWith('mv -f --')) {
          return { code: 1, stdout: '', stderr: 'sensitive remote error' }
        }
        const tempPath = command.match(/^rm -f -- '([^']+)'$/)?.[1]
        if (tempPath) remote.delete(tempPath)
        return { code: 0, stdout: '', stderr: '' }
      }
    )
    await expect(
      writeAppManifest({ writeFile, exec } as unknown as SshManager, 1, baseApp)
    ).rejects.toThrow('Manifest rename failed')
    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec.mock.calls[1]?.[1]).toContain('rm -f --')
    expect(remote.get('/opt/opspilot/demo-api/.opspilot-app.json')).toBe('prior-valid-manifest')
    expect(remote.size).toBe(1)
  })
})
