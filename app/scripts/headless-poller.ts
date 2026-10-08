import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as readline from 'node:readline'

import Database from 'better-sqlite3'

import { createCredentialCipher } from '../src/main/crypto/masterKey'
import { loadSecret } from '../src/main/crypto/credentials'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { serializeCliEvent } from '../src/main/deploy/eventSerializer'
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
      } catch {
        // Bỏ qua lỗi stat file metric nếu file chưa tồn tại hoặc không thể đọc
      }
      return { generation: `${dev}:${ino}`, device: dev, inode: ino, size }
    },
    fileIdentity: async () => {
      let dev = 1
      let ino = 1
      try {
        const st = statSync(filePath)
        dev = st.dev
        ino = st.ino
      } catch {
        // Bỏ qua lỗi stat file identity nếu file chưa tồn tại hoặc không thể đọc
      }
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
      } catch (err: unknown) {
        throw new Error(
          `Không đọc được file metric giả lập: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }
}

async function main(): Promise<void> {
  const secrets: string[] = []
  if (process.env.OPSPILOT_SSH_SECRET?.trim()) {
    secrets.push(process.env.OPSPILOT_SSH_SECRET)
  }
  if (process.env.OPSPILOT_DEPLOY_SECRET?.trim()) {
    secrets.push(process.env.OPSPILOT_DEPLOY_SECRET)
  }

  function emitEvent(event: Record<string, unknown>): void {
    console.log(serializeCliEvent(event, secrets))
  }

  function emitError(message: string): never {
    emitEvent({ status: 'error', error: message })
    process.exit(1)
  }

  const cliArgs = parseArgs(process.argv.slice(2))

  const dbPath = cliArgs.dbPath ?? process.env.OPSPILOT_DB_PATH
  if (!dbPath) {
    emitError('Thiếu đường dẫn SQLite DB (--db hoặc biến môi trường OPSPILOT_DB_PATH).')
  }

  const resolvedDbPath = resolve(dbPath)
  if (!existsSync(resolvedDbPath)) {
    emitError(`File SQLite DB không tồn tại: ${resolvedDbPath}`)
  }

  let database: Database.Database
  try {
    database = new Database(resolvedDbPath)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    emitError(`Không thể mở SQLite DB: ${msg}`)
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
      if (!secrets.includes(secret)) {
        secrets.push(secret)
      }
      return {
        host: targetVps.host,
        port: targetVps.port,
        hostFingerprint: targetVps.host_fingerprint ?? null,
        username: targetVps.username,
        authType: targetVps.auth_type,
        secret
      }
    })
  }

  const mlUrl = cliArgs.mlUrl ?? process.env.OPSPILOT_ML_URL
  const scorer = mlUrl ? new MlApiClient(mlUrl) : undefined

  // Strict mode = true: lỗi đọc metric hoặc đóng DB ném lỗi ngay lập tức
  const poller = new HeadlessPoller({
    db: database,
    ssh,
    scorer,
    intervalMs: cliArgs.intervalMs ?? 5000,
    autoCloseDb: true,
    strict: true
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
      emitEvent({ status: 'drained' })
      process.exit(0)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      emitEvent({ status: 'error', error: `Lỗi trong quá trình drain: ${msg}` })
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

  // Bắt đầu chu trình poll (strict mode: nếu lỗi đọc metric thì throw ngay)
  try {
    await poller.start()
    emitEvent({ status: 'ready' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    emitError(`Không thể khởi chạy HeadlessPoller: ${msg}`)
  }
}

void main()
