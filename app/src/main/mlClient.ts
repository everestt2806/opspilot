import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'

import { app } from 'electron'
import { z } from 'zod'

import { AppError } from './errors'
import { logger } from './logger'

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

  constructor(private readonly onStatus: StatusListener) {}

  async start(): Promise<MlServiceStatus> {
    if (this.child && this.child.exitCode === null) {
      return this.status()
    }

    const serviceDirectory = this.resolveServiceDirectory()
    const pythonExecutable = this.resolvePythonExecutable(serviceDirectory)
    const selectedPort = await findAvailablePort()

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
    this.child = spawn(
      pythonExecutable,
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(selectedPort)],
      {
        cwd: serviceDirectory,
        env: { ...process.env, PYTHONUTF8: '1' },
        windowsHide: true
      }
    )

    this.child.stdout.on('data', (chunk: Buffer) => {
      logger.info('ml', chunk.toString('utf8').trim())
    })
    this.child.stderr.on('data', (chunk: Buffer) => {
      logger.warn('ml', chunk.toString('utf8').trim())
    })
    this.child.once('exit', (code) => {
      this.child = null
      this.port = null
      this.updateStatus({
        running: false,
        reason: `ML service đã dừng (exit code ${code ?? 'null'})`
      })
    })
    this.child.once('error', (error) => {
      logger.error('ml', 'Không spawn được ML service', { error: error.message })
      this.updateStatus({ running: false, reason: error.message })
    })

    try {
      const status = await this.waitUntilHealthy(selectedPort)
      this.updateStatus(status)
      return status
    } catch (error) {
      this.stopSync()
      throw error
    }
  }

  async restart(): Promise<MlServiceStatus> {
    this.stopSync()
    return this.start()
  }

  async status(): Promise<MlServiceStatus> {
    if (!this.port || !this.child || this.child.exitCode !== null) {
      return this.lastStatus
    }

    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/health`, {
        signal: AbortSignal.timeout(1_500)
      })
      const payload = healthSchema.parse(await response.json())
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
    const pid = this.child?.pid
    if (!pid || this.child?.exitCode !== null) {
      this.child = null
      this.port = null
      return
    }

    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } else {
      this.child.kill('SIGTERM')
    }

    this.child = null
    this.port = null
  }

  private resolveServiceDirectory(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'ml-service')
    }

    return join(app.getAppPath(), '..', 'ml-service')
  }

  private resolvePythonExecutable(serviceDirectory: string): string {
    return process.platform === 'win32'
      ? join(serviceDirectory, '.venv', 'Scripts', 'python.exe')
      : join(serviceDirectory, '.venv', 'bin', 'python')
  }

  private async waitUntilHealthy(port: number): Promise<MlServiceStatus> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
      if (this.child?.exitCode !== null) {
        break
      }

      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1_500)
        })
        const payload = healthSchema.parse(await response.json())
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
