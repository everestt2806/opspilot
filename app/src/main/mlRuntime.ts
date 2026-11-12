import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { MlRuntimeManifest } from '../../../docs/contracts/ml-runtime-artifact'

declare const __OPSPILOT_ML_RUNTIME_SHA256__: string
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const manifestSchema = z.strictObject({
  format: z.literal(1),
  platform: z.literal('win32-x64'),
  python_version: z.string().regex(/^3\.12\.\d+$/),
  interpreter: z.literal('python.exe'),
  service_directory: z.literal('service'),
  packages: z.record(z.string().regex(/^[a-z0-9-]+$/), z.string().min(1).max(64)),
  files: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(512),
        size: z
          .number()
          .int()
          .min(0)
          .max(128 * 1024 * 1024),
        sha256: sha
      })
    )
    .min(1)
    .max(20000)
}) satisfies z.ZodType<MlRuntimeManifest>
export const ML_RUNTIME_PATHS = 'python312.zip\nDLLs\nLib/site-packages\nservice\n'
const REQUIRED = [
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

function reject(): never {
  throw Error('ML_RUNTIME_MISSING_OR_INVALID')
}
function bounded(file: string, cap: number): Buffer {
  const before = lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size > cap) reject()
  const bytes = readFileSync(file),
    after = lstatSync(file)
  if (
    bytes.length !== before.size ||
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs ||
    after.isSymbolicLink()
  )
    reject()
  return bytes
}
export function builtinMlRuntimePin(): string {
  return typeof __OPSPILOT_ML_RUNTIME_SHA256__ === 'undefined' ? '' : __OPSPILOT_ML_RUNTIME_SHA256__
}
/** Passive verifier, shared by packaged Main and beforePack; never executes Python. */
export function verifyMlRuntime(directory: string, pin = builtinMlRuntimePin()): MlRuntimeManifest {
  try {
    if (!isAbsolute(directory) || !sha.safeParse(pin).success) reject()
    const root = resolve(directory),
      info = lstatSync(root)
    if (!info.isDirectory() || info.isSymbolicLink()) reject()
    const encoded = bounded(join(root, 'manifest.json'), 8 * 1024 * 1024)
    if (createHash('sha256').update(encoded).digest('hex') !== pin) reject()
    const manifest = manifestSchema.parse(JSON.parse(encoded.toString('utf8'))),
      files = new Map<string, { size: number; sha256: string }>()
    let total = 0
    for (const file of manifest.files) {
      if (
        !/^[A-Za-z0-9_@+./-]+$/.test(file.path) ||
        file.path
          .split('/')
          .some(
            (p) => !p || ['.', '..', '.venv', 'state', '__pycache__', 'tests', 'test'].includes(p)
          ) ||
        files.has(file.path) ||
        file.path === 'manifest.json'
      )
        reject()
      files.set(file.path, file)
      total += file.size
      if (total > 512 * 1024 * 1024) reject()
    }
    if (REQUIRED.some((p) => !files.has(p))) reject()
    const directories = new Set<string>()
    for (const path of files.keys()) {
      const parts = path.split('/')
      for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
    }
    const seen = new Set<string>()
    const walk = (parent: string): void => {
      for (const name of readdirSync(parent)) {
        const file = join(parent, name),
          stat = lstatSync(file)
        if (stat.isSymbolicLink()) reject()
        if (stat.isDirectory()) {
          if (!directories.has(relative(root, file).split('\\').join('/'))) reject()
          walk(file)
          continue
        }
        const path = relative(root, file).split('\\').join('/')
        if (path === 'manifest.json') continue
        const expected = files.get(path)
        if (!expected || !stat.isFile() || stat.size !== expected.size) reject()
        const bytes = bounded(file, expected.size)
        if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) reject()
        seen.add(path)
      }
    }
    walk(root)
    if (
      seen.size !== files.size ||
      bounded(join(root, 'python312._pth'), 256).toString('utf8') !== ML_RUNTIME_PATHS
    )
      reject()
    return manifest
  } catch {
    return reject()
  }
}
export function verifyPackagedMlResources(resources: string): void {
  verifyMlRuntime(join(resources, 'ml-runtime'))
}

/** Minimal environment: no inherited SSH/app secrets or global Python configuration. */
export function packagedMlEnvironment(
  source: NodeJS.ProcessEnv,
  stateDirectory: string
): NodeJS.ProcessEnv {
  if (!isAbsolute(stateDirectory)) reject()
  const allowed = new Set([
    'systemroot',
    'windir',
    'temp',
    'tmp',
    'path',
    'comspec',
    'pathext',
    'number_of_processors',
    'processor_architecture',
    'appdata',
    'localappdata',
    'userprofile'
  ])
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source))
    if (allowed.has(key.toLowerCase())) environment[key] = value
  return {
    ...environment,
    OPSPILOT_ML_STATE_DIRECTORY: stateDirectory,
    OMP_NUM_THREADS: '1',
    OPENBLAS_NUM_THREADS: '1',
    MKL_NUM_THREADS: '1',
    NUMEXPR_NUM_THREADS: '1'
  }
}
