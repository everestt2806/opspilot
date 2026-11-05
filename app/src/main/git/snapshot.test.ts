import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  canonicalizeGitHubUrl,
  createGitSnapshot,
  createGitSnapshotFromLocalFixture,
  resolveSnapshotRoot,
  sanitizedGitEnvironment
} from './snapshot'

let fixtureDirectory: string | null = null

function git(repository: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function createFixture(): string {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'opspilot-git-fixture-'))
  git(fixtureDirectory, 'init', '--quiet', '--bare', 'repository.git')
  const working = join(fixtureDirectory, 'working')
  mkdirSync(working)
  git(working, 'init', '--quiet', '-b', 'main')
  git(working, 'config', 'user.name', 'Fixture Test')
  git(working, 'config', 'user.email', 'fixture@example.invalid')
  mkdirSync(join(working, 'demo'))
  writeFileSync(join(working, 'demo', 'marker.txt'), 'first snapshot\n')
  git(working, 'add', '.')
  git(working, 'commit', '--quiet', '-m', 'fixture one')
  git(working, 'remote', 'add', 'origin', join(fixtureDirectory, 'repository.git'))
  git(working, 'push', '--quiet', '-u', 'origin', 'main')
  return join(fixtureDirectory, 'repository.git')
}

afterEach(() => {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
  fixtureDirectory = null
})

describe('Git snapshot', () => {
  it('accepts only canonical public GitHub HTTPS repository URLs', () => {
    expect(canonicalizeGitHubUrl('https://github.com/acme/demo')).toBe(
      'https://github.com/acme/demo.git'
    )
    expect(() => canonicalizeGitHubUrl('https://user:pass@github.com/acme/demo')).toThrow(
      /credential/i
    )
    expect(() => canonicalizeGitHubUrl('http://github.com/acme/demo')).toThrow(/HTTPS/i)
    expect(() => canonicalizeGitHubUrl('https://example.com/acme/demo')).toThrow(/GitHub/i)
  })

  it('removes inherited credential-like variables from Git child environments', () => {
    const key = 'OPSPILOT_SSH_SECRET'
    const previous = process.env[key]
    process.env[key] = 'fixture-secret-sentinel'
    try {
      const environment = sanitizedGitEnvironment()
      expect(environment[key]).toBeUndefined()
      expect(environment.GIT_TERMINAL_PROMPT).toBe('0')
    } finally {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    }
  })

  it('pins a detached full SHA; later branch movement cannot change its contents', async () => {
    const remote = createFixture()
    const working = join(fixtureDirectory!, 'working')
    const beforeMove = git(working, 'rev-parse', 'HEAD')
    writeFileSync(join(working, 'demo', 'marker.txt'), 'second snapshot\n')
    git(working, 'add', '.')
    git(working, 'commit', '--quiet', '-m', 'fixture two')
    git(working, 'push', '--quiet', 'origin', 'main')
    const snapshot = await createGitSnapshotFromLocalFixture({
      repositoryUrl: remote,
      ref: 'main',
      targetSha: beforeMove,
      root: 'demo',
      tempDirectory: fixtureDirectory!
    })
    try {
      expect(snapshot.commitSha).toBe(beforeMove)
      expect(snapshot.commitSha).toMatch(/^[a-f0-9]{40}$/)
      expect(readFileSync(join(snapshot.rootDirectory, 'marker.txt'), 'utf8')).toBe(
        'first snapshot\n'
      )
    } finally {
      snapshot.cleanup()
    }
  })

  it('refuses a requested SHA that is unavailable instead of falling back to the ref tip', async () => {
    const remote = createFixture()
    await expect(
      createGitSnapshotFromLocalFixture({
        repositoryUrl: remote,
        ref: 'main',
        targetSha: 'f'.repeat(40),
        tempDirectory: fixtureDirectory!
      })
    ).rejects.toThrow(/Git ref không tồn tại/i)
    expect(
      readdirSync(fixtureDirectory!).filter((entry) => entry.startsWith('opspilot-git-'))
    ).toEqual([])
  })

  it('isolates inherited Git config, templates, and worktree paths from the snapshot target', async () => {
    const expectedRemote = createFixture()
    const alternateRemote = join(fixtureDirectory!, 'alternate.git')
    git(fixtureDirectory!, 'init', '--quiet', '--bare', 'alternate.git')
    const alternateWorking = join(fixtureDirectory!, 'alternate-working')
    mkdirSync(alternateWorking)
    git(alternateWorking, 'init', '--quiet', '-b', 'main')
    git(alternateWorking, 'config', 'user.name', 'Fixture Test')
    git(alternateWorking, 'config', 'user.email', 'fixture@example.invalid')
    mkdirSync(join(alternateWorking, 'demo'))
    writeFileSync(join(alternateWorking, 'demo', 'marker.txt'), 'redirected repository\n')
    git(alternateWorking, 'add', '.')
    git(alternateWorking, 'commit', '--quiet', '-m', 'redirect target')
    git(alternateWorking, 'remote', 'add', 'origin', alternateRemote)
    git(alternateWorking, 'push', '--quiet', 'origin', 'main')

    const outsideGit = join(fixtureDirectory!, 'outside.git')
    git(fixtureDirectory!, 'init', '--quiet', '--bare', 'outside.git')
    const outsideGitEntries = readdirSync(outsideGit, { recursive: true }).sort()
    const outsideWorkTree = join(fixtureDirectory!, 'outside-worktree')
    mkdirSync(outsideWorkTree)
    const outsideIndex = join(fixtureDirectory!, 'outside.index')
    const maliciousTemplate = join(fixtureDirectory!, 'malicious-template')
    mkdirSync(maliciousTemplate)
    writeFileSync(join(maliciousTemplate, 'template-marker'), 'must not be copied')
    const globalConfig = join(fixtureDirectory!, 'malicious.gitconfig')
    const expectedUrl = pathToFileURL(expectedRemote).toString()
    const alternateUrl = pathToFileURL(alternateRemote).toString()
    writeFileSync(
      globalConfig,
      `[url "${alternateUrl}"]\n\tinsteadOf = ${expectedUrl}\n[init]\n\ttemplateDir = ${maliciousTemplate}\n`
    )
    const inheritedKeys = [
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_SYSTEM',
      'GIT_CONFIG_PARAMETERS',
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_TEMPLATE_DIR'
    ]
    const previous = new Map(inheritedKeys.map((key) => [key, process.env[key]]))
    Object.assign(process.env, {
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: `url.${alternateUrl}.insteadOf`,
      GIT_CONFIG_VALUE_0: expectedUrl,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_SYSTEM: globalConfig,
      GIT_CONFIG_PARAMETERS: 'inherited-malicious-config',
      GIT_DIR: outsideGit,
      GIT_WORK_TREE: outsideWorkTree,
      GIT_INDEX_FILE: outsideIndex,
      GIT_TEMPLATE_DIR: maliciousTemplate
    })
    try {
      const snapshot = await createGitSnapshotFromLocalFixture({
        repositoryUrl: expectedRemote,
        ref: 'main',
        root: 'demo',
        tempDirectory: fixtureDirectory!
      })
      try {
        expect(readFileSync(join(snapshot.rootDirectory, 'marker.txt'), 'utf8')).toBe(
          'first snapshot\n'
        )
        expect(readdirSync(outsideWorkTree)).toEqual([])
        expect(readdirSync(outsideGit, { recursive: true }).sort()).toEqual(outsideGitEntries)
        expect(existsSync(outsideIndex)).toBe(false)
        expect(existsSync(join(snapshot.snapshotDirectory, '.git', 'template-marker'))).toBe(false)
      } finally {
        snapshot.cleanup()
      }
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('never includes private-looking stderr text in Git failure messages', async () => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), 'fake-secret-stderr-'))
    const fakeSecret = 'fake-secret-stderr-canary'
    const error = createGitSnapshotFromLocalFixture({
      repositoryUrl: join(fixtureDirectory, fakeSecret, 'missing.git'),
      ref: 'main',
      tempDirectory: fixtureDirectory
    }).catch((caught: unknown) => caught)
    const caught = await error
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).not.toContain(fakeSecret)
    expect((caught as Error).message).toMatch(/Git thất bại/i)
  })

  it('rejects traversal, missing refs, cancellation and timeouts and cleans partial snapshots', async () => {
    const remote = createFixture()
    const tempDirectory = join(fixtureDirectory!, 'snapshots')
    mkdirSync(tempDirectory)
    const input = { repositoryUrl: remote, ref: 'main', tempDirectory }

    await expect(
      createGitSnapshotFromLocalFixture({ ...input, root: '../outside' })
    ).rejects.toThrow(/thoát khỏi snapshot/i)
    await expect(
      createGitSnapshotFromLocalFixture({ ...input, ref: 'missing-branch' })
    ).rejects.toThrow(/Git ref không tồn tại/i)
    const controller = new AbortController()
    controller.abort()
    await expect(
      createGitSnapshotFromLocalFixture({ ...input, signal: controller.signal })
    ).rejects.toThrow(/hủy/i)
    await expect(createGitSnapshotFromLocalFixture({ ...input, timeoutMs: 1 })).rejects.toThrow(
      /thời gian/i
    )
    await expect(createGitSnapshotFromLocalFixture({ ...input, maxBytes: 1 })).rejects.toThrow(
      /giới hạn dung lượng/i
    )
    expect(readdirSync(tempDirectory)).toEqual([])
  })

  it('cleans the isolated snapshot when the caller finishes', async () => {
    const remote = createFixture()
    const snapshot = await createGitSnapshotFromLocalFixture({ repositoryUrl: remote, ref: 'main' })
    expect(existsSync(snapshot.rootDirectory)).toBe(true)
    const directory = snapshot.snapshotDirectory
    snapshot.cleanup()
    expect(existsSync(directory)).toBe(false)
  })

  it('rejects invalid refs before spawning Git', async () => {
    await expect(
      createGitSnapshot({ repositoryUrl: 'https://github.com/acme/demo', ref: '--upload-pack=bad' })
    ).rejects.toThrow(/ref không hợp lệ/i)
  })

  it('rejects a root that traverses a symbolic link', () => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), 'opspilot-git-root-'))
    const snapshot = join(fixtureDirectory, 'snapshot')
    const outside = join(fixtureDirectory, 'outside')
    mkdirSync(snapshot)
    mkdirSync(outside)
    symlinkSync(outside, join(snapshot, 'linked'), 'junction')
    expect(() => resolveSnapshotRoot(snapshot, 'linked')).toThrow(/symbolic link/i)
  })
})
