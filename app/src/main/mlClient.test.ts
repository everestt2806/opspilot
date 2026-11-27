import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
const mock = vi.hoisted(() => ({
  packaged: true,
  spawn: vi.fn(),
  kill: vi.fn(),
  verify: vi.fn(),
  mkdir: vi.fn()
}))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mock.packaged
    },
    getAppPath: () => resolve('fixture/app'),
    getPath: () => resolve('fixture/user data')
  }
}))
vi.mock('node:fs', () => ({ existsSync: () => true, mkdirSync: mock.mkdir }))
vi.mock('node:child_process', () => ({ spawn: mock.spawn, spawnSync: mock.kill }))
vi.mock('./mlRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mlRuntime')>()),
  verifyMlRuntime: mock.verify
}))
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('node:net', () => ({
  createServer: () => {
    const server = Object.assign(new EventEmitter(), {
      listen: (): void => {
        queueMicrotask(() => server.emit('listening'))
      },
      close: (done: () => void): void => done()
    })
    return server
  }
}))
import { MlServiceManager } from './mlClient'
type Fake = EventEmitter & {
  pid: number
  exitCode: number | null
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
}
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const originalResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
let children: Fake[]
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  vi.clearAllMocks()
  mock.packaged = true
  children = []
  Object.defineProperty(process, 'resourcesPath', {
    value: resolve('fixture/resources'),
    configurable: true
  })
  mock.verify.mockImplementation(() => ({}))
  mock.kill.mockReturnValue({ status: 0 })
  mock.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      pid: 9000 + children.length,
      exitCode: null as number | null,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn()
    })
    children.push(child)
    return child
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ status: 'ok', version: '0.1.0', uptime_s: 1 }) }))
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(process, 'platform', originalPlatform)
  if (originalResources) Object.defineProperty(process, 'resourcesPath', originalResources)
  else delete (process as unknown as Record<string, unknown>).resourcesPath
})
it('launches verified packaged Python with isolated flags, loopback and writable private state', async () => {
  const manager = new MlServiceManager(vi.fn())
  await expect(manager.start()).resolves.toMatchObject({ running: true })
  const [executable, args, options] = mock.spawn.mock.calls[0]
  expect(executable.replaceAll('\\', '/')).toBe(
    resolve('fixture/resources/ml-runtime/python.exe').replaceAll('\\', '/')
  )
  expect(args).toEqual(
    expect.arrayContaining([
      '-I',
      '-B',
      'utf8',
      '127.0.0.1',
      '--workers',
      '1',
      'asyncio',
      'h11',
      'none'
    ])
  )
  expect(options.env.OPSPILOT_ML_STATE_DIRECTORY.replaceAll('\\', '/')).toBe(
    resolve('fixture/user data/ml-state').replaceAll('\\', '/')
  )
  expect(options.env.PYTHONHOME).toBeUndefined()
  manager.stopSync()
  expect(mock.kill.mock.calls[0][0]).toMatch(/System32[\\/]taskkill\.exe$/)
})
it('does not fall back to dev/global Python or create state after artifact verification fails', async () => {
  mock.verify.mockImplementation(() => {
    throw Error('INVALID')
  })
  await expect(new MlServiceManager(vi.fn()).start()).rejects.toMatchObject({
    code: 'ML_SERVICE_DOWN'
  })
  expect(mock.spawn).not.toHaveBeenCalled()
  expect(mock.mkdir).not.toHaveBeenCalled()
})
it('retains the developer venv launch path', async () => {
  mock.packaged = false
  const manager = new MlServiceManager(vi.fn())
  await manager.start()
  expect(mock.verify).not.toHaveBeenCalled()
  expect(mock.spawn.mock.calls[0][0].replaceAll('\\', '/')).toContain('/ml-service/.venv/')
  manager.stopSync()
})
it('deduplicates concurrent starts and ignores an old exit event after restart', async () => {
  const manager = new MlServiceManager(vi.fn()),
    a = manager.start(),
    b = manager.start()
  expect(a).toBe(b)
  await a
  expect(children).toHaveLength(1)
  await manager.restart()
  expect(children).toHaveLength(2)
  children[0].emit('exit', 0)
  expect(manager.getPort()).not.toBeNull()
  expect((await manager.status()).running).toBe(true)
  manager.stopSync()
})
it('cancels a pending start before spawning and rejects a restart when the old process could not stop', async () => {
  const manager = new MlServiceManager(vi.fn()),
    starting = manager.start()
  manager.stopSync()
  await expect(starting).rejects.toMatchObject({ code: 'ML_SERVICE_DOWN' })
  expect(mock.spawn).not.toHaveBeenCalled()
  await manager.start()
  mock.kill.mockReturnValue({ status: 1 })
  await expect(manager.restart()).rejects.toMatchObject({ code: 'ML_SERVICE_DOWN' })
  expect(children).toHaveLength(1)
  mock.kill.mockReturnValue({ status: 0 })
  manager.stopSync()
})
it('does not restore a stale healthy status after a stop during the HTTP request', async () => {
  const manager = new MlServiceManager(vi.fn())
  await manager.start()
  let reply!: (value: unknown) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((done) => {
          reply = done
        })
    )
  )
  const pending = manager.status()
  manager.stopSync()
  reply({ json: async () => ({ status: 'ok', version: '0.1.0', uptime_s: 9 }) })
  expect((await pending).running).toBe(false)
})
