import { spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { productOutcomeFixture } from './__fixtures__/productOutcome'

const cli = resolve('.out-scripts/h2-policy/app/scripts/try-product-outcome-policy.js')
let scratch: string
let inputIndex = 0

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'opspilot-h2-policy-cli-'))
  const compile = spawnSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.h2-policy.json'],
    { encoding: 'utf8', timeout: 20_000, windowsHide: true }
  )
  expect(compile.error).toBeUndefined()
  expect(compile.status, compile.stdout + compile.stderr).toBe(0)
}, 25_000)

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
})

function run(payload: string): SpawnSyncReturns<string> {
  const input = join(scratch, `input-${inputIndex++}.json`)
  writeFileSync(input, payload)
  return spawnSync(process.execPath, [cli, input], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true
  })
}

describe('H2 CLI — chạy thật và không tác động runtime', () => {
  it('trả JSON success chỉ gồm decision đã kiểm tra', () => {
    const result = run(JSON.stringify(productOutcomeFixture()))
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      action: 'candidate_healthy',
      proposed_job_state: 'succeeded',
      exposure_status: 'reachable'
    })
    expect(result.stderr).toBe('')
  })

  it('restore recommendation không làm thao tác Docker/SSH', () => {
    const fixture = productOutcomeFixture()
    fixture.evidence.phase = 'health'
    fixture.evidence.outcome = 'failed'
    fixture.evidence.runtime!.health.state = 'unhealthy'
    fixture.evidence.runtime!.health.http_status = 500
    const result = run(JSON.stringify(fixture))
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ action: 'restore_previous', deployment_id: 1 })
  })

  it('uncertainty trả exit 1 với mã ổn định', () => {
    const fixture = productOutcomeFixture()
    fixture.evidence.outcome = 'unknown'
    const result = run(JSON.stringify(fixture))
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({
      action: 'reconciliation_required',
      code: 'REMOTE_OUTCOME_UNKNOWN'
    })
  })

  it('schema sai có secret trả exit 1, không echo input', () => {
    const fixture = productOutcomeFixture()
    const result = run(
      JSON.stringify({ ...fixture, evidence: { ...fixture.evidence, password: 'SECRET_EVIDENCE' } })
    )
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ code: 'EVIDENCE_INVALID' })
    expect(result.stdout + result.stderr).not.toContain('SECRET_EVIDENCE')
  })

  it.each(['', '{broken SECRET_JSON', 'null', '[]', '{"password":"SECRET_JSON"}'])(
    'JSON/envelope sai trả exit 2 và không lộ dữ liệu: %#',
    (input) => {
      const result = run(input)
      expect(result.status).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toContain('SECRET_JSON')
    }
  )

  it('envelope không cho field thừa chứa secret', () => {
    const result = run(JSON.stringify({ ...productOutcomeFixture(), log: 'SECRET_ENVELOPE' }))
    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).not.toContain('SECRET_ENVELOPE')
  })

  it('file đúng boundary 64 KiB vẫn xử lý được', () => {
    const input = JSON.stringify(productOutcomeFixture())
    const result = run(input + ' '.repeat(64 * 1024 - Buffer.byteLength(input)))
    expect(result.status).toBe(0)
  })

  it.each([' '.repeat(64 * 1024 + 1), 'é'.repeat(32 * 1024 + 1)])(
    'file vượt byte budget bị chặn trước parse: %#',
    (input) => {
      const result = run(input)
      expect(result.status).toBe(2)
      expect(result.stdout).toBe('')
    }
  )

  it('file không tồn tại không lộ đường dẫn hoặc exception', () => {
    const result = spawnSync(process.execPath, [cli, join(scratch, 'SECRET_PATH.json')], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true
    })
    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).not.toContain('SECRET_PATH')
    expect(result.stderr).not.toContain('ENOENT')
  })

  it('thiếu hoặc thừa tham số trả usage exit 2', () => {
    for (const args of [[], ['unused', 'unused']]) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true
      })
      expect(result.status).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Cách dùng')
    }
  })

  it('từ chối directory và device thay cho input file', () => {
    for (const input of [scratch, process.platform === 'win32' ? 'NUL' : '/dev/null']) {
      const result = spawnSync(process.execPath, [cli, input], {
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(2)
      expect(result.stdout).toBe('')
    }
  })
})
