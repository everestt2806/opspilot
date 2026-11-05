import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: spawnMock }
})

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
      expect(options.cwd).toBe(options.env.GIT_CEILING_DIRECTORIES)
      expect(options.env.GIT_ALLOW_PROTOCOL).toBe('https')
      expect(options.env.GIT_PROTOCOL_FROM_USER).toBe('0')
      expect(existsSync(options.cwd)).toBe(false)
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
    expectWorkingDirectoryCleaned()
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
    expectWorkingDirectoryCleaned()
  })

  it('keeps the temporary working directory until a started child closes after a kill error', async () => {
    const child = createChild()
    Object.assign(child, { pid: 43210 })
    child.kill = vi.fn((signal: NodeJS.Signals | number) => {
      if (signal === 'SIGTERM') {
        queueMicrotask(() => child.emit('error', new Error('KILL_FAILED_SECRET_SENTINEL')))
      } else {
        queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
      }
      return true
    })
    spawnMock.mockReturnValue(child)

    await expect(
      queryPublicGitHubBranchTip({
        repositoryUrl: 'https://github.com/octocat/Hello-World',
        branch: 'main',
        timeoutMs: 1
      })
    ).rejects.toMatchObject({ code: 'GIT_TIMEOUT', message: 'GIT_TIMEOUT' })
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expectWorkingDirectoryCleaned()
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
    expectWorkingDirectoryCleaned()
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
    expectWorkingDirectoryCleaned()
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
    expectWorkingDirectoryCleaned()
  })

  it('cleans its isolated working directory when process creation throws', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('PRIVATE_PATH_OR_SECRET')
    })

    await expect(
      queryPublicGitHubBranchTip({
        repositoryUrl: 'https://github.com/octocat/Hello-World',
        branch: 'main'
      })
    ).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE', message: 'GIT_UNAVAILABLE' })
    expectWorkingDirectoryCleaned()
  })

  it('ignores a real parent-repository insteadOf rewrite to a local fixture', async () => {
    vi.doUnmock('node:child_process')
    vi.resetModules()
    const { queryPublicGitHubBranchTip: queryWithRealGit } = await import('./publicBranch')
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'opspilot-git-insteadof-'))
    const sourceRepository = join(fixtureRoot, 'local-source')
    const configuredRepository = join(fixtureRoot, 'configured-parent')
    const affectedDirectory = join(configuredRepository, 'nested', 'working')
    const requestedUrl = 'https://github.com/octocat/Hello-World.git'
    const previousDirectory = process.cwd()

    try {
      mkdirSync(affectedDirectory, { recursive: true })
      execFileSync('git', ['init', '--initial-branch=main', sourceRepository], { stdio: 'ignore' })
      execFileSync('git', ['-C', sourceRepository, 'config', 'user.name', 'P3c Fixture'])
      execFileSync('git', [
        '-C',
        sourceRepository,
        'config',
        'user.email',
        'fixture@example.invalid'
      ])
      writeFileSync(join(sourceRepository, 'fixture.txt'), 'fixture-only\n')
      execFileSync('git', ['-C', sourceRepository, 'add', 'fixture.txt'])
      execFileSync('git', ['-C', sourceRepository, 'commit', '-m', 'fixture'])
      const fixtureSha = execFileSync('git', ['-C', sourceRepository, 'rev-parse', 'HEAD'], {
        encoding: 'utf8'
      }).trim()

      execFileSync('git', ['init', configuredRepository], { stdio: 'ignore' })
      execFileSync('git', [
        '-C',
        configuredRepository,
        'config',
        '--local',
        `url.${pathToFileURL(join(sourceRepository, '.git')).href}.insteadOf`,
        requestedUrl
      ])

      const rawConfigResult = execFileSync(
        'git',
        ['ls-remote', '--exit-code', '--refs', requestedUrl, 'refs/heads/main'],
        { cwd: affectedDirectory, encoding: 'utf8' }
      )
      expect(rawConfigResult).toContain(fixtureSha)

      process.chdir(affectedDirectory)
      let result: Awaited<ReturnType<typeof queryPublicGitHubBranchTip>> | undefined
      let queryError: unknown
      try {
        result = await queryWithRealGit({
          repositoryUrl: requestedUrl,
          branch: 'main',
          timeoutMs: 15_000
        })
      } catch (error) {
        queryError = error
      }

      if (result?.state === 'found') expect(result.sha).not.toBe(fixtureSha)
      else if (result?.state !== 'missing') {
        expect(queryError).toMatchObject({ code: 'GIT_REMOTE_ERROR' })
      }
    } finally {
      process.chdir(previousDirectory)
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})

function expectWorkingDirectoryCleaned(): void {
  const [, , options] = spawnMock.mock.calls.at(-1) ?? []
  expect(options?.cwd).toBeTruthy()
  expect(existsSync(options.cwd)).toBe(false)
}

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
