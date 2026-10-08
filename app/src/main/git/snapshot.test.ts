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

import { afterEach, describe, expect, it } from 'vitest'

import {
  canonicalizeGitHubUrl,
  createGitSnapshot,
  createGitSnapshotFromLocalFixture,
  resolveSnapshotRoot
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

  it('pins a detached full SHA; later branch movement cannot change its contents', async () => {
    const remote = createFixture()
    const working = join(fixtureDirectory!, 'working')
    const beforeMove = git(working, 'rev-parse', 'HEAD')
    const snapshot = await createGitSnapshotFromLocalFixture({
      repositoryUrl: remote,
      ref: 'main',
      root: 'demo',
      tempDirectory: fixtureDirectory!
    })
    try {
      writeFileSync(join(working, 'demo', 'marker.txt'), 'second snapshot\n')
      git(working, 'add', '.')
      git(working, 'commit', '--quiet', '-m', 'fixture two')
      git(working, 'push', '--quiet', 'origin', 'main')
      expect(snapshot.commitSha).toBe(beforeMove)
      expect(snapshot.commitSha).toMatch(/^[a-f0-9]{40}$/)
      expect(readFileSync(join(snapshot.rootDirectory, 'marker.txt'), 'utf8')).toBe(
        'first snapshot\n'
      )
    } finally {
      snapshot.cleanup()
    }
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
    ).rejects.toThrow(/Git không thể lấy snapshot/i)
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
