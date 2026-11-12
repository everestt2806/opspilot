import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'

import { app } from 'electron'
import { z } from 'zod'

import { AppError } from './errors'
import { logger } from './logger'
import { verifyMlRuntime, packagedMlEnvironment } from './mlRuntime'

const HEALTH_TIMEOUT_MS = 30_000
const PORTS = [8765, 8766, 8767]

const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime_s: z.number().nonnegative()
})

export interface MlServiceStatus {
  running: boolean
  version?: string
  uptime_s?: number
  reason?: string
}

type StatusListener = (status: MlServiceStatus) => void

export class MlServiceManager {
  private child: ChildProcessWithoutNullStreams | null = null
  private port: number | null = null
  private lastStatus: MlServiceStatus = { running: false, reason: 'Chưa khởi động' }

  private starting: Promise<MlServiceStatus> | null = null
  private epoch = 0

  constructor(private readonly onStatus: StatusListener) {}

  start(): Promise<MlServiceStatus> {
    if (!this.starting)
      this.starting = this.launch().finally(() => {
        this.starting = null
      })
    return this.starting
  }

  private async launch(): Promise<MlServiceStatus> {
    if (this.child && this.child.exitCode === null) {
      return this.status()
    }

    const epoch = ++this.epoch
    let serviceDirectory: string, pythonExecutable: string, environment: NodeJS.ProcessEnv
    if (app.isPackaged) {
      try {
        if (process.platform !== 'win32' || process.arch !== 'x64')
          throw Error('ML_RUNTIME_UNSUPPORTED_PLATFORM')
        const directory = join(process.resourcesPath, 'ml-runtime')
        verifyMlRuntime(directory)
        serviceDirectory = join(directory, 'service')
        pythonExecutable = join(directory, 'python.exe')
        const state = join(app.getPath('userData'), 'ml-state')
        mkdirSync(state, { recursive: true })
        environment = packagedMlEnvironment(process.env, state)
      } catch {
        throw new AppError(
          'ML_SERVICE_DOWN',
          'Bộ máy ML trong bản cài bị thiếu hoặc không hợp lệ. Hãy cài lại OpsPilot.',
          { cause: 'ML_RUNTIME_MISSING_OR_INVALID' }
        )
      }
    } else {
      serviceDirectory = join(app.getAppPath(), '..', 'ml-service')
      pythonExecutable =
        process.platform === 'win32'
          ? join(serviceDirectory, '.venv', 'Scripts', 'python.exe')
          : join(serviceDirectory, '.venv', 'bin', 'python')
      environment = { ...process.env, PYTHONUTF8: '1' }
    }
    const selectedPort = await findAvailablePort()

    if (epoch !== this.epoch) throw new AppError('ML_SERVICE_DOWN', 'Đã hủy khởi động ML service.')
    if (!selectedPort) {
      throw new AppError(
        'ML_SERVICE_DOWN',
        'ML service không thể khởi động vì các cổng 8765–8767 đều đang được sử dụng.'
      )
    }

    if (!existsSync(pythonExecutable)) {
      throw new AppError(
        'ML_SERVICE_DOWN',
        'Không tìm thấy Python 3.12 của ML service. Hãy chạy bước tạo ml-service/.venv.',
        { cause: pythonExecutable }
      )
    }

    this.port = selectedPort
    const child = spawn(
      pythonExecutable,
      app.isPackaged
        ? [
            '-I',
            '-B',
            '-X',
            'utf8',
            '-m',
            'uvicorn',
            'main:app',
            '--host',
            '127.0.0.1',
            '--port',
            String(selectedPort),
            '--workers',
            '1',
            '--loop',
            'asyncio',
            '--http',
            'h11',
            '--ws',
            'none',
            '--no-access-log'
          ]
        : ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(selectedPort)],
      {
        cwd: serviceDirectory,
        env: environment,
        windowsHide: true
      }
    )

    this.child = child
    child.stdin.end()
    child.stdout.on('data', (chunk: Buffer) => {
      logger.info('ml', chunk.toString('utf8').trim())
    })
    child.stderr.on('data', (chunk: Buffer) => {
      logger.warn('ml', chunk.toString('utf8').trim())
    })
    child.once('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      this.port = null
      this.updateStatus({
        running: false,
        reason: `ML service đã dừng (exit code ${code ?? 'null'})`
      })
    })
    child.once('error', (error) => {
      if (this.child !== child) return
      logger.error('ml', 'Không spawn được ML service', { error: error.message })
      this.updateStatus({ running: false, reason: error.message })
    })

    try {
      const status = await this.waitUntilHealthy(selectedPort, child, epoch)
      this.updateStatus(status)
      return status
    } catch (error) {
      if (this.child === child) this.stopSync()
      throw error
    }
  }

  async restart(): Promise<MlServiceStatus> {
    this.stopSync()
    if (this.starting) await this.starting.catch(() => {})
    if (this.child && this.child.exitCode === null)
      throw new AppError(
        'ML_SERVICE_DOWN',
        'Chưa dừng được ML service cũ; không khởi động thêm tiến trình.'
      )
    return this.start()
  }

  async status(): Promise<MlServiceStatus> {
    if (!this.port || !this.child || this.child.exitCode !== null) {
      return this.lastStatus
    }

    const child = this.child,
      port = this.port
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/health`, {
        signal: AbortSignal.timeout(1_500)
      })
      const payload = healthSchema.parse(await response.json())
      if (this.child !== child || this.port !== port) return this.lastStatus
      const status = { running: true, version: payload.version, uptime_s: payload.uptime_s }
      this.lastStatus = status
      return status
    } catch {
      return { running: false, reason: 'ML service không phản hồi health check' }
    }
  }

  getPort(): number | null {
    return this.port
  }

  stopSync(): void {
    this.epoch++
    const pid = this.child?.pid
    if (!pid || this.child?.exitCode !== null) {
      this.child = null
      this.port = null
      this.updateStatus({ running: false, reason: 'Đã dừng ML service.' })
      return
    }

    if (process.platform === 'win32') {
      const result = spawnSync(
        join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/pid', String(pid), '/T', '/F'],
        {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 5000
        }
      )
      if (result.status !== 0 && this.child?.exitCode === null) {
        this.updateStatus({ running: false, reason: 'Chưa dừng được tiến trình ML service.' })
        return
      }
    } else {
      this.child.kill('SIGTERM')
    }

    this.child = null
    this.port = null
    this.updateStatus({ running: false, reason: 'Đã dừng ML service.' })
  }

  private async waitUntilHealthy(
    port: number,
    child: ChildProcessWithoutNullStreams,
    epoch: number
  ): Promise<MlServiceStatus> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
      if (this.child !== child || epoch !== this.epoch || child.exitCode !== null) {
        break
      }

      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1_500)
        })
        const payload = healthSchema.parse(await response.json())
        if (this.child !== child || epoch !== this.epoch || child.exitCode !== null) break
        return { running: true, version: payload.version, uptime_s: payload.uptime_s }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    throw new AppError(
      'ML_SERVICE_DOWN',
      'ML service không sẵn sàng sau 30 giây. Hãy mở log service để xem lỗi Python.'
    )
  }

  private updateStatus(status: MlServiceStatus): void {
    this.lastStatus = status
    this.onStatus(status)
  }
}

async function findAvailablePort(): Promise<number | null> {
  for (const port of PORTS) {
    if (await isPortAvailable(port)) {
      return port
    }
  }

  return null
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}
