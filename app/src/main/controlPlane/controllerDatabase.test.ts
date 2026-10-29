import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeController, openControllerDatabase } from './controllerDatabase'

let directory: string | null = null

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
})

describe('Product controller database bootstrap', () => {
  it('initializes identity only once and reopens the same identity without enrolling apps', () => {
    directory = mkdtempSync(join(tmpdir(), 'opspilot-controller-db-'))
    const initialized = initializeController(directory)
    expect(() => initializeController(directory!)).toThrow('CONTROLLER_DATABASE_ALREADY_EXISTS')

    const opened = openControllerDatabase(directory)
    expect(opened.controllerId).toBe(initialized.controllerId)
    expect(
      opened.database.prepare('SELECT COUNT(*) AS count FROM product_app_control').get()
    ).toEqual({ count: 0 })
    expect(
      opened.database.prepare('SELECT COUNT(*) AS count FROM product_source_config').get()
    ).toEqual({ count: 0 })
    opened.database.close()
  })

  it('fails closed when the initialized identity marker does not match the database', () => {
    directory = mkdtempSync(join(tmpdir(), 'opspilot-controller-marker-'))
    initializeController(directory)
    writeFileSync(
      join(directory, '.product-controller-initialized'),
      '{"format":1,"controller_id":"wrong"}'
    )
    expect(() => openControllerDatabase(directory!)).toThrow('CONTROLLER_IDENTITY_MISMATCH')
  })
})
