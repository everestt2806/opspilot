/**
 * Đưa lát cắt demo VM01 + express-api về trạng thái đầu vào sạch.
 *
 * Mặc định chỉ kiểm tra (read-only): pnpm demo:reset
 * Thực thi sau khi đã xem kết quả: pnpm demo:reset -- --apply
 *
 * Guard bắt buộc: đúng host VM01, đúng app express-api, OpsPilot phải đang đóng.
 * Credential được giải mã trong main process và chỉ tồn tại trong RAM.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { app } from 'electron'

import { loadSecret } from '../src/main/crypto/credentials'
import { createCredentialCipher } from '../src/main/crypto/masterKey'
import { closeDatabase, initializeDatabase } from '../src/main/db'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { AppError } from '../src/main/errors'
import { shellQuote } from '../src/main/ssh/shellQuote'
import { SshManager } from '../src/main/ssh/manager'

const TARGET_HOST = '221.121.1.79'
const TARGET_APP = 'express-api'
const REMOTE_APP_DIR = `/opt/opspilot/${TARGET_APP}`
const APPLY = process.argv.includes('--apply')

// Script được Electron nạp như main entry riêng nên phải đặt identity trước app.whenReady().
app.setAppUserModelId('vn.opspilot.desktop')
app.setName('OpsPilot')
const EXPECTED_USER_DATA = resolve(join(app.getPath('appData'), 'OpsPilot'))
app.setPath('userData', EXPECTED_USER_DATA)

function timestamp(): string {
  const now = new Date()
  const part = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`
}

function assertInside(parent: string, child: string): void {
  const rel = relative(resolve(parent), resolve(child))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Đường dẫn không nằm trong vùng cho phép: ${child}`)
  }
}

function scalar(database: ReturnType<typeof initializeDatabase>, table: string): number {
  const allowed = new Set(['vps', 'app', 'deployment', 'action_log'])
  if (!allowed.has(table)) throw new Error(`Bảng không được phép đếm: ${table}`)
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number
  }
  return Number(row.count)
}

function printResult(title: string, stdout: string): void {
  console.log(`\n--- ${title} ---`)
  console.log(stdout.trim() || '(trống)')
}

async function main(): Promise<void> {
  const userDataPath = resolve(app.getPath('userData'))
  if (userDataPath !== EXPECTED_USER_DATA) {
    throw new Error(`Từ chối reset userData ngoài OpsPilot: ${userDataPath}`)
  }

  const repoRoot = resolve(__dirname, '..', '..', '..')
  const backupBase = resolve(repoRoot, 'tmp', 'demo-reset-backups')
  const backupRoot = resolve(backupBase, timestamp())
  assertInside(backupBase, backupRoot)

  const database = initializeDatabase(userDataPath)
  const cipher = createCredentialCipher(userDataPath)
  const vpsRepository = new VpsRepository(database)
  const matches = vpsRepository.list().filter((item) => item.host === TARGET_HOST)
  if (matches.length !== 1) {
    throw new Error(`Cần đúng 1 VPS host ${TARGET_HOST}, hiện có ${matches.length}.`)
  }
  const target = matches[0]
  if (!target || target.name !== 'VM01') {
    throw new Error(
      `Guard thất bại: VPS đích phải có tên VM01, hiện là ${target?.name ?? '(không có)'}.`
    )
  }

  console.log(`Chế độ: ${APPLY ? 'APPLY — backup rồi dọn' : 'INSPECT — chỉ đọc'}`)
  console.log(`Đích đã khóa: ${target.name} (${target.host}), app ${TARGET_APP}`)
  console.log(
    `Local DB: vps=${scalar(database, 'vps')}, app=${scalar(database, 'app')}, deployment=${scalar(database, 'deployment')}, history=${scalar(database, 'action_log')}`
  )

  const ssh = new SshManager((vpsId) => {
    const vps = vpsRepository.getById(vpsId)
    return {
      host: vps.host,
      port: vps.port,
      username: vps.username,
      authType: vps.auth_type,
      secret: loadSecret(database, cipher, vpsId)
    }
  })
  let localResetComplete = false

  try {
    const before = await ssh.exec(
      target.id,
      [
        "printf 'containers\\n'",
        `docker ps -a --filter label=com.docker.compose.project=${TARGET_APP} --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'`,
        "printf 'images\\n'",
        `docker images ${shellQuote(TARGET_APP)} --format '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.Size}}'`,
        "printf 'workspace\\n'",
        `find ${shellQuote(REMOTE_APP_DIR)} -mindepth 1 -maxdepth 2 -printf '%y|%p\\n' 2>/dev/null | sort || true`,
        "printf 'port-30000\\n'",
        "ss -ltn | awk 'NR > 1 {print $4}' | grep -E '(:|])30000$' || true"
      ].join('; '),
      { timeoutMs: 30_000 }
    )
    printResult('VM01 trước reset', before.stdout)

    if (!APPLY) {
      console.log('\nChưa thay đổi gì. Chạy lại với: pnpm demo:reset -- --apply')
      return
    }

    mkdirSync(backupRoot, { recursive: true })
    database.pragma('wal_checkpoint(FULL)')
    const databasePath = join(userDataPath, 'opspilot.db')
    copyFileSync(databasePath, join(backupRoot, 'opspilot.db'))
    const keyPath = join(userDataPath, 'credential-master-key.protected')
    if (existsSync(keyPath)) {
      copyFileSync(keyPath, join(backupRoot, 'credential-master-key.protected'))
    }
    for (const directory of ['Local Storage', 'Session Storage']) {
      const source = join(userDataPath, directory)
      if (existsSync(source)) cpSync(source, join(backupRoot, directory), { recursive: true })
    }

    const remoteBackup = `/home/deploy/.opspilot-demo-backups/${timestamp()}/${TARGET_APP}`
    const remoteBackupCommand = [
      'set -eu',
      `mkdir -p ${shellQuote(remoteBackup)}`,
      `docker ps -a --filter label=com.docker.compose.project=${TARGET_APP} --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' > ${shellQuote(`${remoteBackup}/containers-before.txt`)}`,
      `docker images ${shellQuote(TARGET_APP)} --format '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.Size}}' > ${shellQuote(`${remoteBackup}/images-before.txt`)}`,
      `if [ -d ${shellQuote(REMOTE_APP_DIR)} ]; then tar -C ${shellQuote(REMOTE_APP_DIR)} -czf ${shellQuote(`${remoteBackup}/app-files.tgz`)} .; fi`,
      `if docker ps --format '{{.Names}}' | grep -Fxq '${TARGET_APP}-db'; then docker exec ${TARGET_APP}-db sh -lc 'pg_dumpall -U "$POSTGRES_USER"' > ${shellQuote(`${remoteBackup}/postgres.sql`)}; fi`
    ].join('; ')
    const backup = await ssh.exec(target.id, remoteBackupCommand, { timeoutMs: 120_000 })
    if (backup.code !== 0) {
      throw new Error(`Backup VM01 thất bại: ${backup.stderr.trim() || `exit ${backup.code}`}`)
    }

    const cleanupCommand = [
      'set -eu',
      `if [ -f ${shellQuote(`${REMOTE_APP_DIR}/docker-compose.yml`)} ]; then cd ${shellQuote(REMOTE_APP_DIR)} && docker compose down -v --remove-orphans; fi`,
      `docker ps -aq --filter label=com.docker.compose.project=${TARGET_APP} | xargs -r docker rm -f`,
      `docker volume ls -q --filter label=com.docker.compose.project=${TARGET_APP} | xargs -r docker volume rm -f`,
      `docker images ${shellQuote(TARGET_APP)} -q | sort -u | xargs -r docker image rm -f`,
      `rm -rf ${shellQuote(REMOTE_APP_DIR)}`
    ].join('; ')
    const cleanup = await ssh.exec(target.id, cleanupCommand, { timeoutMs: 180_000 })
    if (cleanup.code !== 0) {
      throw new Error(`Dọn VM01 thất bại: ${cleanup.stderr.trim() || `exit ${cleanup.code}`}`)
    }

    const verify = await ssh.exec(
      target.id,
      [
        `test ! -e ${shellQuote(REMOTE_APP_DIR)}`,
        `test -z "$(docker ps -aq --filter label=com.docker.compose.project=${TARGET_APP})"`,
        `test -z "$(docker images ${shellQuote(TARGET_APP)} -q)"`,
        "! ss -ltn | awk 'NR > 1 {print $4}' | grep -Eq '(:|])30000$'"
      ].join(' && '),
      { timeoutMs: 30_000 }
    )
    if (verify.code !== 0) {
      throw new Error(`VM01 chưa sạch hoàn toàn: ${verify.stderr.trim() || `exit ${verify.code}`}`)
    }

    const resetLocal = database.transaction(() => {
      for (const table of [
        'alert',
        'score_sample',
        'metric_sample',
        'monitor_setting',
        'migration_job',
        'experiment_run',
        'action_log',
        'deployment',
        'app',
        'vps'
      ]) {
        database.prepare(`DELETE FROM ${table}`).run()
      }
    })
    resetLocal()
    database.pragma('wal_checkpoint(TRUNCATE)')
    localResetComplete = true

    writeFileSync(
      join(backupRoot, 'reset-summary.txt'),
      [
        `created_at=${new Date().toISOString()}`,
        `target=${target.name}|${target.host}`,
        `app=${TARGET_APP}`,
        `remote_backup=${remoteBackup}`,
        'result=clean'
      ].join('\n') + '\n',
      'utf8'
    )

    console.log(
      '\n[PASS] VM01: không còn compose container, volume, image, workspace app hay listener port 30000.'
    )
    console.log('[PASS] Local DB: VPS/app/deployment/history đã về 0.')
    console.log(`Backup local: ${backupRoot}`)
    console.log(`Backup VM01: ${remoteBackup}`)
  } finally {
    ssh.disconnectAll()
    closeDatabase()
    if (localResetComplete) {
      for (const directory of ['Local Storage', 'Session Storage']) {
        const targetPath = join(userDataPath, directory)
        if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true })
      }
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = join(userDataPath, `opspilot.db${suffix}`)
        if (existsSync(sidecar)) rmSync(sidecar, { force: true })
      }
    }
  }
}

void app
  .whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(
      error instanceof AppError
        ? `${error.code}: ${error.userMessage}`
        : error instanceof Error
          ? (error.stack ?? error.message)
          : String(error)
    )
    app.exit(1)
  })
