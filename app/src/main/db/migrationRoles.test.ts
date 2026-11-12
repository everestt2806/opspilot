import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { it, expect } from 'vitest'
import { initializeDatabase, runMigrations } from './index'
import { initializeController, openControllerDatabase } from '../controlPlane/controllerDatabase'

it('Desktop adds030/031 while controller retains exact029 across cold open, with no identity rewrite', () => {
  const root = mkdtempSync(join(tmpdir(), 'opspilot-migration-role-'))
  try {
    const desktop = initializeDatabase(join(root, 'desktop'))
    expect(desktop.prepare('SELECT MAX(version) v FROM schema_version').get()).toEqual({ v: 31 })
    expect(
      desktop
        .prepare("SELECT name FROM sqlite_master WHERE name='desktop_controller_upgrade'")
        .get()
    ).toBeTruthy()
    expect(
      desktop
        .prepare("SELECT name FROM sqlite_master WHERE name='desktop_controller_authority_rebind'")
        .get()
    ).toBeTruthy()
    desktop.close()
    const directory = join(root, 'controller')
    const identity = initializeController(directory)
    const marker = readFileSync(join(directory, '.product-controller-initialized'))
    const reopened = openControllerDatabase(directory)
    try {
      expect(reopened.controllerId).toBe(identity.controllerId)
      expect(reopened.database.prepare('SELECT MAX(version) v FROM schema_version').get()).toEqual({
        v: 29
      })
      expect(
        reopened.database
          .prepare("SELECT name FROM sqlite_master WHERE name='desktop_controller_upgrade'")
          .get()
      ).toBeUndefined()
      expect(
        reopened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='desktop_controller_authority_rebind'"
          )
          .get()
      ).toBeUndefined()
      expect(readFileSync(join(directory, '.product-controller-initialized')).equals(marker)).toBe(
        true
      )
    } finally {
      reopened.database.close()
    }
  } finally {
    expect(root.startsWith(join(tmpdir(), 'opspilot-migration-role-'))).toBe(true)
    rmSync(root, { recursive: true })
  }
})
it('rejects a Desktop schema in controller role before any DDL or version changes', () => {
  const db = new Database(':memory:')
  try {
    runMigrations(db)
    const before = db.serialize()
    expect(() => runMigrations(db, Infinity, 'controller')).toThrow(
      'CONTROLLER_DATABASE_ROLE_MISMATCH'
    )
    expect(db.serialize().equals(before)).toBe(true)
  } finally {
    db.close()
  }
})
