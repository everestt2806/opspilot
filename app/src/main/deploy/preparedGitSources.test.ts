import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GitSnapshot } from '../git/snapshot'
import { PreparedGitSources } from './preparedGitSources'

let fixture: string | null = null

afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true })
  fixture = null
})

function createSource(): { root: string; snapshot: GitSnapshot } {
  fixture = mkdtempSync(join(tmpdir(), 'opspilot-prepared-git-'))
  const root = join(fixture, 'root')
  const snapshotDirectory = join(fixture, 'snapshot')
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
  writeFileSync(
    join(root, 'index.js'),
    "const express = require('express'); express().listen(3000)\n"
  )
  const snapshot: GitSnapshot = {
    repositoryUrl: 'https://github.com/example/repo.git',
    commitSha: 'a'.repeat(40),
    rootDirectory: root,
    snapshotDirectory,
    cleanup: vi.fn(() => rmSync(fixture!, { recursive: true, force: true }))
  }
  return { root, snapshot }
}

describe('PreparedGitSources', () => {
  it('keeps the exact pinned snapshot through precheck reservation and cleans it on shutdown', async () => {
    const { root, snapshot } = createSource()
    const sources = new PreparedGitSources(async () => snapshot)
    const prepared = await sources.prepare('request-1', {
      source_type: 'git',
      git_repo_url: 'https://github.com/example/repo',
      git_ref: 'main',
      git_root: '.'
    })
    const request = {
      source_type: 'git' as const,
      prepared_source_handle: prepared.prepared_source_handle,
      vps_id: 1,
      app_name: 'fixture-app',
      env: {}
    }
    const lease = sources.get(prepared.prepared_source_handle)
    expect(lease.sourcePath).toBe(root)
    expect(prepared.git_commit_sha).toBe(snapshot.commitSha)
    const token = sources.issuePrecheckToken(prepared.prepared_source_handle, request, 30_000)
    const reservation = sources.reserveStart({ ...request, precheck_token: token })
    expect(reservation.lease.snapshot).toBe(snapshot)
    expect(reservation.lease.commitSha).toBe(snapshot.commitSha)
    sources.commitStart(reservation)
    expect(() => sources.get(prepared.prepared_source_handle)).toThrow()
    expect(snapshot.cleanup).not.toHaveBeenCalled()
  })

  it('rejects changed target input and leaves the prepared snapshot available for a fresh precheck', async () => {
    const { snapshot } = createSource()
    const sources = new PreparedGitSources(async () => snapshot)
    const prepared = await sources.prepare('request-2', {
      source_type: 'git',
      git_repo_url: 'https://github.com/example/repo',
      git_ref: 'main',
      git_root: '.'
    })
    const request = {
      source_type: 'git' as const,
      prepared_source_handle: prepared.prepared_source_handle,
      vps_id: 1,
      app_name: 'fixture-app',
      env: {}
    }
    const token = sources.issuePrecheckToken(prepared.prepared_source_handle, request, 30_000)
    expect(() => sources.reserveStart({ ...request, vps_id: 2, precheck_token: token })).toThrow()
    expect(sources.get(prepared.prepared_source_handle).snapshot).toBe(snapshot)
    sources.close()
    expect(snapshot.cleanup).toHaveBeenCalledOnce()
  })
})
