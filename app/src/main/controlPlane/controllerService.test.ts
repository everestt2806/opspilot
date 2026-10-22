import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase } from '../db'
import { initializeController } from './controllerDatabase'
import { ControllerService } from './controllerService'

let directory: string | null = null
let service: ControllerService | null = null

afterEach(async () => {
  await service?.close()
  service = null
  closeDatabase()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
})

describe('independent Product controller service', () => {
  it('serves only minimal loopback health, then cancels polling and closes cleanly', async () => {
    if (process.platform !== 'linux') return
    directory = mkdtempSync(join(tmpdir(), 'opspilot-controller-service-'))
    initializeController(directory)
    service = new ControllerService({ dataDirectory: directory })
    await service.start()

    const health = await fetch('http://127.0.0.1:8768/healthz')
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ api_version: 'v1', service_state: 'ready' })
    const hiddenApi = await fetch('http://127.0.0.1:8768/v1/controllers/controller/apps')
    expect(hiddenApi.status).toBe(404)
    expect(await hiddenApi.text()).toBe('')

    service.requestStop()
    await service.waitForStop()
    await service.close()
    service = null
    const closed = await fetch('http://127.0.0.1:8768/healthz').catch(() => null)
    expect(closed).toBeNull()
  })
})
