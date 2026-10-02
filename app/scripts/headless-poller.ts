import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as readline from 'node:readline'

import Database from 'better-sqlite3'

import { createCredentialCipher } from '../src/main/crypto/masterKey'
import { loadSecret } from '../src/main/crypto/credentials'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { HeadlessPoller, type SshManagerLike } from '../src/main/monitor/headlessPoller'
import { MlApiClient } from '../src/main/monitor/mlApi'
import { SshManager } from '../src/main/ssh/manager'

interface CliArgs {
  dbPath?: string
  intervalMs?: number
  mlUrl?: string
  mockMetricsFile?: string
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--db' && i + 1 < args.length) {
      result.dbPath = args[++i]
    } else if (arg === '--interval-ms' && i + 1 < args.length) {
      result.intervalMs = Number.parseInt(args[++i], 10)
    } else if (arg === '--ml-url' && i + 1 < args.length) {
      result.mlUrl = args[++i]
    } else if (arg === '--mock-metrics-file' && i + 1 < args.length) {
      result.mockMetricsFile = args[++i]
    }
  }
  return result
}

function createMockSsh(filePath: string): SshManagerLike {
  return {
    exec: async (_vps: number, command: string) => ({
      code: 0,
      stdout: command.includes('collector') ? 'running\n' : 'app:v1|running\n',
      stderr: ''
    }),
    metricSnapshot: async () => {
      let size = 0
      let dev = 1
      let ino = 1
      try {
        const st = statSync(filePath)
        size = st.size
        dev = st.dev
        ino = st.ino
      } catch {}
      return { generation: `${dev}:${ino}`, device: dev, inode: ino, size }
    },
    fileIdentity: async () => {
      let dev = 1
      let ino = 1
      try {
        const st = statSync(filePath)
        dev = st.dev
        ino = st.ino
      } catch {}
      return { generation: `${dev}:${ino}`, device: dev, inode: ino }
    },
    fileSize: async () => {
      try {
        return statSync(filePath).size
      } catch {
        return 0
      }
    },
    readFileTail: async (_vpsId: number, _remotePath: string, fromByte: number) => {
      try {
        const buf = readFileSync(filePath)
        const content = buf.subarray(Math.max(0, fromByte - 1)).toString('utf8')
        return { content, nextOffset: fromByte + Buffer.byteLength(content, 'utf8') }
      } catch {
        return { content: '', nextOffset: fromByte }
      }
    }
  }
}

async function main(): Promise<void> {
  const cliArgs = parseArgs(process.argv.slice(2))

  const dbPath = cliArgs.dbPath ?? process.env.OPSPILOT_DB_PATH
  if (!dbPath) {
    console.log(
      JSON.stringify({
        status: 'error',
        error: 'Thiếu đường dẫn SQLite DB (--db hoặc biến môi trường OPSPILOT_DB_PATH).'
      })
    )
    process.exit(1)
  }

  const resolvedDbPath = resolve(dbPath)
  if (!existsSync(resolvedDbPath)) {
    console.log(
      JSON.stringify({
        status: 'error',
        error: `File SQLite DB không tồn tại: ${resolvedDbPath}`
      })
    )
    process.exit(1)
  }

  let database: Database.Database
  try {
    database = new Database(resolvedDbPath)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(
      JSON.stringify({
        status: 'error',
        error: `Không thể mở SQLite DB: ${msg}`
      })
    )
    process.exit(1)
  }

  let ssh: SshManager | SshManagerLike
  if (cliArgs.mockMetricsFile) {
    const resolvedMock = resolve(cliArgs.mockMetricsFile)
    ssh = createMockSsh(resolvedMock)
  } else {
    const vpsRepository = new VpsRepository(database)
    ssh = new SshManager((targetVpsId) => {
      const targetVps = vpsRepository.getById(targetVpsId)
      let secret = process.env.OPSPILOT_SSH_SECRET ?? process.env.OPSPILOT_DEPLOY_SECRET
      if (!secret) {
        const userDataPath = process.env.OPSPILOT_USER_DATA_DIR ?? dirname(resolvedDbPath)
        const cipher = createCredentialCipher(userDataPath)
        secret = loadSecret(database, cipher, targetVpsId)
      }
      if (!secret || !secret.trim()) {
        throw new Error(`SSH credential cho VPS id=${targetVpsId} bị rỗng hoặc không hợp lệ.`)
      }
      return {
        host: targetVps.host,
        port: targetVps.port,
        username: targetVps.username,
        authType: targetVps.auth_type,
        secret
      }
    })
  }

  const mlUrl = cliArgs.mlUrl ?? process.env.OPSPILOT_ML_URL
  const scorer = mlUrl ? new MlApiClient(mlUrl) : undefined

  const poller = new HeadlessPoller({
    db: database,
    ssh,
    scorer,
    intervalMs: cliArgs.intervalMs ?? 5000,
    autoCloseDb: true
  })

  // Đăng ký nhận drain qua stdin
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false
  })

  let drained = false
  const performDrain = async (): Promise<void> => {
    if (drained) return
    drained = true
    try {
      await poller.drain()
      console.log(JSON.stringify({ status: 'drained' }))
      process.exit(0)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[headless-poller] Lỗi trong quá trình drain: ${msg}`)
      process.exit(1)
    }
  }

  rl.on('line', (line) => {
    if (line.trim() === 'drain') {
      void performDrain()
    }
  })

  rl.on('close', () => {
    if (!drained && !poller.closed) {
      void performDrain()
    }
  })

  process.on('SIGTERM', () => void performDrain())
  process.on('SIGINT', () => void performDrain())

  // Bắt đầu chu trình poll
  try {
    await poller.start()
    // Thông báo cho tiến trình cha đã sẵn sàng
    console.log(JSON.stringify({ status: 'ready' }))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(
      JSON.stringify({
        status: 'error',
        error: `Không thể khởi chạy HeadlessPoller: ${msg}`
      })
    )
    process.exit(1)
  }
}

void main()
