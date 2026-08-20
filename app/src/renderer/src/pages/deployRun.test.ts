import { describe, expect, it } from 'vitest'

import type { DeployEvent } from '@shared/ipc'

import { applyEvent, initialSteps, type RunView } from './deployRun'

const ESC = String.fromCharCode(27)

function baseRun(): RunView {
  return { deploymentId: 7, steps: initialSteps(), buffer: '' }
}

function logEvent(chunk: string, stream: 'stdout' | 'stderr' = 'stdout'): DeployEvent {
  return { type: 'log', deployment_id: 7, step: 'BUILD', chunk, stream }
}

describe('applyEvent', () => {
  it('ghep chunk vao buffer dung thu tu', () => {
    const afterFirst = applyEvent(baseRun(), logEvent('dong mot\n'))
    const afterSecond = applyEvent(afterFirst, logEvent('dong hai\r\n'))
    expect(afterSecond.buffer).toBe('dong mot\ndong hai\r\n')
  })

  it('giu nguyen ma ANSI khong loc', () => {
    const run = applyEvent(baseRun(), logEvent(`${ESC}[32mOK${ESC}[0m\n`))
    expect(run.buffer).toContain(`${ESC}[32m`)
    expect(run.buffer).toContain(`${ESC}[0m`)
  })

  it('giu ky tu \\r de xterm ve tien trinh dam bao', () => {
    const run = applyEvent(baseRun(), logEvent('Loading 50%\rLoading 60%'))
    expect(run.buffer).toBe('Loading 50%\rLoading 60%')
  })

  it('chuyen trang thai buoc: start -> done -> failed', () => {
    let run = applyEvent(baseRun(), {
      type: 'step-start',
      deployment_id: 7,
      step: 'PRECHECK',
      ts: '2026-08-19T10:00:00Z'
    })
    expect(run.steps.PRECHECK.status).toBe('running')

    run = applyEvent(run, {
      type: 'step-done',
      deployment_id: 7,
      step: 'PRECHECK',
      duration_ms: 2000
    })
    expect(run.steps.PRECHECK).toEqual({ status: 'done', durationMs: 2000 })
    expect(run.steps.UPLOAD.status).toBe('pending')

    run = applyEvent(run, {
      type: 'step-failed',
      deployment_id: 7,
      step: 'UPLOAD',
      error: { code: 'DOCKER_BUILD_FAILED', message: 'Loi upload.', technical: 'SFTP error' },
      last_log_lines: []
    })
    expect(run.steps.UPLOAD.status).toBe('failed')
    expect(run.error?.code).toBe('DOCKER_BUILD_FAILED')
  })

  it('finished dong bang trang thai cuoi va url', () => {
    const run = applyEvent(baseRun(), {
      type: 'finished',
      deployment_id: 7,
      status: 'running',
      total_duration_ms: 15000,
      app_url: 'http://203.0.113.55:30000'
    })
    expect(run.finished).toEqual({
      status: 'running',
      totalDurationMs: 15000,
      appUrl: 'http://203.0.113.55:30000'
    })
  })
})
