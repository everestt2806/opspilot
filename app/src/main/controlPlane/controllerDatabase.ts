import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import Database from 'better-sqlite3'

import { initializeDatabase } from '../db'
import type { ProductControllerId } from '../../../../docs/contracts/product-auto-deploy'

const DATABASE_FILENAME = 'opspilot.db'
const IDENTITY_MARKER_FILENAME = '.product-controller-initialized'

export interface InitializedController {
  controllerId: ProductControllerId
  dataDirectory: string
}

export function initializeController(dataDirectoryInput: string): InitializedController {
  setRestrictiveUmask()
  const dataDirectory = resolveRequiredDirectory(dataDirectoryInput, true)
  const databasePath = join(dataDirectory, DATABASE_FILENAME)
  const identityMarkerPath = join(dataDirectory, IDENTITY_MARKER_FILENAME)
  if (existsSync(databasePath)) throw new Error('CONTROLLER_DATABASE_ALREADY_EXISTS')
  if (existsSync(identityMarkerPath)) throw new Error('CONTROLLER_IDENTITY_MARKER_ALREADY_EXISTS')

  const database = initializeDatabase(dataDirectory)
  try {
    const controllerId = randomUUID()
    database
      .prepare(
        'INSERT INTO product_controller (controller_id, created_at, status) VALUES (?, ?, ?)'
      )
      .run(controllerId, new Date().toISOString(), 'active')
    secureDatabaseFile(databasePath)
    writeFileSync(
      identityMarkerPath,
      `${JSON.stringify({ format: 1, controller_id: controllerId })}\n`,
      { flag: 'wx', mode: 0o600 }
    )
    secureDatabaseFile(identityMarkerPath)
    return { controllerId, dataDirectory }
  } finally {
    database.close()
  }
}

export interface OpenControllerDatabase {
  database: Database.Database
  controllerId: ProductControllerId
  dataDirectory: string
}

export function openControllerDatabase(dataDirectoryInput: string): OpenControllerDatabase {
  setRestrictiveUmask()
  const dataDirectory = resolveRequiredDirectory(dataDirectoryInput, false)
  const databasePath = join(dataDirectory, DATABASE_FILENAME)
  const markerPath = join(dataDirectory, IDENTITY_MARKER_FILENAME)
  assertOwnedRegularFile(databasePath)
  assertOwnedRegularFile(markerPath)
  let marker: { format?: unknown; controller_id?: unknown }
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8')) as typeof marker
  } catch {
    throw new Error('CONTROLLER_IDENTITY_MARKER_INVALID')
  }
  if (marker.format !== 1 || typeof marker.controller_id !== 'string') {
    throw new Error('CONTROLLER_IDENTITY_MARKER_INVALID')
  }
  const database = initializeDatabase(dataDirectory)
  try {
    secureDatabaseFile(databasePath)
    const rows = database
      .prepare('SELECT controller_id, status FROM product_controller ORDER BY controller_id')
      .all() as Array<{ controller_id: string; status: string }>
    if (rows.length !== 1) throw new Error('CONTROLLER_IDENTITY_COUNT_INVALID')
    if (rows[0].status !== 'active') throw new Error('CONTROLLER_NOT_ACTIVE')
    if (rows[0].controller_id !== marker.controller_id) {
      throw new Error('CONTROLLER_IDENTITY_MISMATCH')
    }
    return { database, controllerId: rows[0].controller_id, dataDirectory }
  } catch (error) {
    database.close()
    throw error
  }
}

export function getControllerDatabasePath(dataDirectory: string): string {
  return join(resolve(dataDirectory), DATABASE_FILENAME)
}

function resolveRequiredDirectory(input: string, create: boolean): string {
  if (!input || !input.trim()) throw new Error('DATA_DIRECTORY_REQUIRED')
  const requestedPath = resolve(input)
  if (create && !existsSync(requestedPath))
    mkdirSync(requestedPath, { recursive: true, mode: 0o700 })
  let pathInfo
  try {
    pathInfo = lstatSync(requestedPath)
  } catch {
    throw new Error('DATA_DIRECTORY_NOT_FOUND')
  }
  if (pathInfo.isSymbolicLink() || !pathInfo.isDirectory()) {
    throw new Error('DATA_DIRECTORY_INVALID')
  }
  const realPath = realpathSync(requestedPath)
  assertOwnedByCurrentUser(statSync(realPath))
  if (process.platform !== 'win32') {
    const mode = statSync(realPath).mode & 0o777
    if (create) chmodSync(realPath, 0o700)
    else if ((mode & 0o077) !== 0) throw new Error('DATA_DIRECTORY_PERMISSIONS_INVALID')
  }
  return realPath
}

function assertOwnedRegularFile(path: string): void {
  let info
  try {
    info = lstatSync(path)
  } catch {
    throw new Error('CONTROLLER_DATABASE_NOT_FOUND')
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('CONTROLLER_DATABASE_INVALID')
  assertOwnedByCurrentUser(statSync(path))
  if (process.platform !== 'win32' && (statSync(path).mode & 0o777 & 0o077) !== 0) {
    throw new Error('CONTROLLER_DATABASE_PERMISSIONS_INVALID')
  }
}

function secureDatabaseFile(path: string): void {
  if (process.platform === 'win32') return
  chmodSync(path, 0o600)
}

function assertOwnedByCurrentUser(info: { uid?: number }): void {
  if (process.platform !== 'win32' && process.getuid && info.uid !== process.getuid()) {
    throw new Error('CONTROLLER_DATA_OWNER_INVALID')
  }
}

function setRestrictiveUmask(): void {
  if (process.platform !== 'win32') process.umask(0o077)
}
