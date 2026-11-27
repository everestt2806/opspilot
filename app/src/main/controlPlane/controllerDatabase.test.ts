import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeController, openControllerDatabase } from './controllerDatabase'
import Database from 'better-sqlite3'
import { randomBytes, randomUUID } from 'node:crypto'
import { closeDatabase, initializeDatabase, runMigrations } from '../db'

let directory: string | null = null

afterEach(() => {
  closeDatabase()
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
      opened.database.prepare('SELECT max(version) version FROM schema_version').get()
    ).toEqual({ version: 37 })
    expect(
      opened.database.prepare('SELECT COUNT(*) AS count FROM product_app_control').get()
    ).toEqual({ count: 0 })
    expect(
      opened.database.prepare('SELECT COUNT(*) AS count FROM product_source_config').get()
    ).toEqual({ count: 0 })
    opened.database.close()
  })

  it('refuses implicit035 upgrade without changing schema, data/key bytes or creating application files', () => {
    directory = mkdtempSync(join(tmpdir(), 'opspilot-controller-old-schema-'))
    const path = join(directory, 'opspilot.db'),
      old = new Database(path),
      controllerId = randomUUID()
    try {
      old.pragma('journal_mode=WAL')
      runMigrations(old, 35, 'controller')
      old
        .prepare("INSERT INTO product_controller VALUES(?,'2026-11-16T00:00:00.000Z','active')")
        .run(controllerId)
    } finally {
      old.close()
    }
    chmodSync(path, 0o600)
    writeFileSync(
      join(directory, '.product-controller-initialized'),
      JSON.stringify({ format: 1, controller_id: controllerId }),
      { mode: 0o600 }
    )
    writeFileSync(join(directory, '.controller-runtime-key'), randomBytes(32), { mode: 0o600 })
    const names = readdirSync(directory).sort(),
      original = Object.fromEntries(
        names.map((name) => [name, readFileSync(join(directory!, name))])
      )
    expect(() => openControllerDatabase(directory!)).toThrow('CONTROLLER_SCHEMA_UPGRADE_REQUIRED')
    expect(() => initializeDatabase(directory!, 'controller')).toThrow(
      'CONTROLLER_SCHEMA_UPGRADE_REQUIRED'
    )
    expect(
      readdirSync(directory)
        .filter((name) => !['opspilot.db-wal', 'opspilot.db-shm'].includes(name))
        .sort()
    ).toEqual(names)
    for (const name of names) expect(readFileSync(join(directory, name))).toEqual(original[name])
  })

  it('keeps managed DB tables out of Desktop and rejects opening controller37 as Desktop before WAL changes', () => {
    directory = mkdtempSync(join(tmpdir(), 'opspilot-controller-roles-'))
    initializeController(directory)
    const path = join(directory, 'opspilot.db'),
      before = readFileSync(path)
    expect(() => initializeDatabase(directory!, 'desktop')).toThrow(
      'DESKTOP_DATABASE_ROLE_MISMATCH'
    )
    expect(readFileSync(path)).toEqual(before)
    const desktop = initializeDatabase(join(directory, 'desktop'), 'desktop')
    expect(desktop.prepare('SELECT max(version) version FROM schema_version').get()).toEqual({
      version: 39
    })
    expect(
      desktop.prepare("SELECT name FROM sqlite_master WHERE name='product_managed_postgres'").get()
    ).toBeUndefined()
    desktop.close()
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
