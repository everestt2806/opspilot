import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { PublicBranchQueryError, queryPublicGitHubBranchTip } from './publicBranch'

afterEach(() => {
  spawnMock.mockReset()
  vi.restoreAllMocks()
})

describe('public GitHub branch read', () => {
  it('uses exact non-shell ls-remote args and a sanitized public-Git environment', async () => {
    const previousGitHubToken = process.env.GITHUB_TOKEN
    const previousGitConfigCount = process.env.GIT_CONFIG_COUNT
    process.env.GITHUB_TOKEN = 'TEST_SECRET_SENTINEL'
    process.env.GIT_CONFIG_COUNT = '1'
    const child = createChild()
    spawnMock.mockReturnValue(child)
    queueMicrotask(() => {
      child.stdout.write(`${'a'.repeat(40)}\trefs/heads/main\n`)
      child.emit('close', 0, null)
    })

    try {
      await expect(
        queryPublicGitHubBranchTip({
          repositoryUrl: 'https://github.com/octocat/Hello-World',
          branch: 'main'
        })
      ).resolves.toEqual({ state: 'found', sha: 'a'.repeat(40) })
      const [command, args, options] = spawnMock.mock.calls[0]
      expect(command).toBe('git')
      expect(args).toEqual([
        '-c',
        'credential.helper=',
        'ls-remote',
        '--exit-code',
        '--refs',
        'https://github.com/octocat/Hello-World.git',
        'refs/heads/main'
      ])
      expect(options.shell).toBe(false)
      expect(options.env.GIT_CONFIG_GLOBAL).toBe(process.platform === 'win32' ? 'NUL' : '/dev/null')
      expect(options.env.GIT_CONFIG_COUNT).toBeUndefined()
      expect(options.env.GITHUB_TOKEN).toBeUndefined()
    } finally {
      if (previousGitHubToken === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = previousGitHubToken
      if (previousGitConfigCount === undefined) delete process.env.GIT_CONFIG_COUNT
      else process.env.GIT_CONFIG_COUNT = previousGitConfigCount
    }
  })

  it('reports branch absence without echoing Git stderr', async () => {
    const child = createChild()
    spawnMock.mockReturnValue(child)
    queueMicrotask(() => child.emit('close', 2, null))
    await expect(
      queryPublicGitHubBranchTip({
        repositoryUrl: 'https://github.com/octocat/Hello-World',
        branch: 'gone'
      })
    ).resolves.toEqual({ state: 'missing' })
  })

  it('bounds subprocess timeout and waits for child close after termination', async () => {
    const child = createChild()
    child.kill = vi.fn((signal: NodeJS.Signals | number) => {
      queueMicrotask(() => child.emit('close', null, signal))
      return true
    })
    spawnMock.mockReturnValue(child)
    await expect(
      queryPublicGitHubBranchTip({
        repositoryUrl: 'https://github.com/octocat/Hello-World',
        branch: 'main',
        timeoutMs: 5
      })
    ).rejects.toMatchObject({ code: 'GIT_TIMEOUT' })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('terminates when output exceeds its byte limit', async () => {
    const child = createChild()
    child.kill = vi.fn((signal: NodeJS.Signals | number) => {
      queueMicrotask(() => child.emit('close', null, signal))
      return true
    })
    spawnMock.mockReturnValue(child)
    queueMicrotask(() => child.stdout.write(Buffer.alloc(16 * 1024 + 1, 65)))
    await expect(
      queryPublicGitHubBranchTip({
        repositoryUrl: 'https://github.com/octocat/Hello-World',
        branch: 'main'
      })
    ).rejects.toMatchObject({ code: 'GIT_OUTPUT_LIMIT' })
  })

  it('cancels the child when shutdown aborts an in-flight branch query', async () => {
    const child = createChild()
    child.kill = vi.fn((signal: NodeJS.Signals | number) => {
      queueMicrotask(() => child.emit('close', null, signal))
      return true
    })
    spawnMock.mockReturnValue(child)
    const controller = new AbortController()
    const pending = queryPublicGitHubBranchTip({
      repositoryUrl: 'https://github.com/octocat/Hello-World',
      branch: 'main',
      signal: controller.signal
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'GIT_CANCELLED' })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('does not include invalid repository, branch or raw spawn failure details', async () => {
    expect(() =>
      queryPublicGitHubBranchTip({ repositoryUrl: 'https://evil.example/repo', branch: 'main' })
    ).toThrow(new PublicBranchQueryError('GIT_INVALID_REPOSITORY'))
    expect(() =>
      queryPublicGitHubBranchTip({
        repositoryUrl: 'https://github.com/octocat/Hello-World',
        branch: 'bad?ref'
      })
    ).toThrow(new PublicBranchQueryError('GIT_INVALID_BRANCH'))

    const child = createChild()
    spawnMock.mockReturnValue(child)
    queueMicrotask(() => child.emit('error', new Error('PRIVATE_PATH_OR_SECRET')))
    await expect(
      queryPublicGitHubBranchTip({
        repositoryUrl: 'https://github.com/octocat/Hello-World',
        branch: 'main'
      })
    ).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE', message: 'GIT_UNAVAILABLE' })
  })
})

function createChild(): EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  kill: (signal: NodeJS.Signals | number) => boolean
} {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true
  })
}
