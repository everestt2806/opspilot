import { afterEach, beforeEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ML_RUNTIME_PATHS, packagedMlEnvironment, verifyMlRuntime } from './mlRuntime'

let root: string, pin: string
const hash = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-ml-runtime-'))
  const paths = [
    'python.exe',
    'python312.dll',
    'python312.zip',
    'python312._pth',
    'service/main.py',
    'service/config.py',
    'service/features.py',
    'service/store.py',
    ...['fastapi', 'uvicorn', 'pydantic', 'sklearn', 'numpy', 'scipy', 'joblib'].map(
      (p) => `Lib/site-packages/${p}/__init__.py`
    )
  ]
  const files = paths.map((path) => {
    const data = path.endsWith('._pth') ? ML_RUNTIME_PATHS : 'fixture'
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), data)
    return { path, size: Buffer.byteLength(data), sha256: hash(data) }
  })
  const encoded = JSON.stringify({
    format: 1,
    platform: 'win32-x64',
    python_version: '3.12.10',
    interpreter: 'python.exe',
    service_directory: 'service',
    packages: { numpy: '2.5.1' },
    files
  })
  writeFileSync(join(root, 'manifest.json'), encoded)
  pin = hash(encoded)
})
afterEach(() => {
  expect(root.startsWith(join(tmpdir(), 'opspilot-ml-runtime-'))).toBe(true)
  rmSync(root, { recursive: true })
})
it('verifies exact inventory and refuses a missing trusted pin', () => {
  expect(verifyMlRuntime(root, pin).python_version).toBe('3.12.10')
  expect(() => verifyMlRuntime(root, '')).toThrow('ML_RUNTIME_MISSING_OR_INVALID')
})
it.each(['service/main.py', 'python.exe'])('refuses modified %s before execution', (file) => {
  writeFileSync(join(root, file), 'changed')
  expect(() => verifyMlRuntime(root, pin)).toThrow('ML_RUNTIME_MISSING_OR_INVALID')
})
it('refuses extra files, removed files, traversal and duplicate inventory entries', () => {
  writeFileSync(join(root, 'extra.py'), 'unexpected')
  expect(() => verifyMlRuntime(root, pin)).toThrow()
  const original = readFileSync(join(root, 'service/main.py'))
  rmSync(join(root, 'extra.py'))
  rmSync(join(root, 'service/main.py'))
  expect(() => verifyMlRuntime(root, pin)).toThrow()
  writeFileSync(join(root, 'service/main.py'), original)
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  for (const record of [{ ...manifest.files[0], path: '../outside' }, manifest.files[0]]) {
    const encoded = JSON.stringify({ ...manifest, files: [...manifest.files, record] })
    writeFileSync(join(root, 'manifest.json'), encoded)
    expect(() => verifyMlRuntime(root, hash(encoded))).toThrow()
  }
})
it('refuses a site hook even with an internally consistent manifest hash', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')),
    data = ML_RUNTIME_PATHS + 'import site\n'
  writeFileSync(join(root, 'python312._pth'), data)
  const item = manifest.files.find((v: { path: string }) => v.path === 'python312._pth')
  item.size = Buffer.byteLength(data)
  item.sha256 = hash(data)
  const encoded = JSON.stringify(manifest)
  writeFileSync(join(root, 'manifest.json'), encoded)
  expect(() => verifyMlRuntime(root, hash(encoded))).toThrow()
})
it('keeps Windows essentials and explicit state while excluding inherited Python/app credentials', () => {
  const state = resolve(root, '../ML state'),
    environment = packagedMlEnvironment(
      {
        Path: 'system',
        SystemRoot: 'windows',
        PYTHONHOME: 'other',
        PYTHONPATH: 'other',
        UVICORN_WORKERS: '9',
        OPSPILOT_SSH_SECRET: 'SYNTHETIC_ONLY',
        DATABASE_URL: 'SYNTHETIC_ONLY'
      },
      state
    )
  expect(environment).toMatchObject({
    Path: 'system',
    SystemRoot: 'windows',
    OPSPILOT_ML_STATE_DIRECTORY: state,
    OMP_NUM_THREADS: '1'
  })
  for (const key of [
    'PYTHONHOME',
    'PYTHONPATH',
    'UVICORN_WORKERS',
    'OPSPILOT_SSH_SECRET',
    'DATABASE_URL'
  ])
    expect(environment[key]).toBeUndefined()
  expect(() => packagedMlEnvironment({}, 'relative')).toThrow()
})
