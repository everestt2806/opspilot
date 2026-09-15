/** Dọn sạch mọi artifact demo/thử nghiệm của OpsPilot trên mọi VPS trong DB.
 *  Chỉ xoá: compose project + container + volume + image app trong /opt/opspilot.
 *  Không đụng: Docker engine, base image (postgres/nginx/alpine), phần còn lại của máy.
 *
 *  Mặc định chỉ liệt kê (read-only): pnpm exec electron .out-scripts/scripts/clean-demo-vms.js
 *  Thực thi: thêm --apply
 */
import { resolve, join } from 'node:path'

import { app } from 'electron'

import { loadSecret } from '../src/main/crypto/credentials'
import { createCredentialCipher } from '../src/main/crypto/masterKey'
import { closeDatabase, initializeDatabase } from '../src/main/db'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { SshManager } from '../src/main/ssh/manager'

app.setAppUserModelId('vn.opspilot.desktop')
app.setName('OpsPilot')
const EXPECTED_USER_DATA = resolve(join(app.getPath('appData'), 'OpsPilot'))
app.setPath('userData', EXPECTED_USER_DATA)

const APPLY = process.argv.includes('--apply')

const CLEAN_COMMAND = [
  'set -u',
  // 1. compose down -v (xoá cả volume) mọi project có compose file trong /opt/opspilot
  "for d in /opt/opspilot/*/; do d=\"${d%/}\"; [ -f \"$d/docker-compose.yml\" ] || continue; echo \"down: $d\"; (cd \"$d\" && docker compose down -v --remove-orphans) || true; done",
  // 2. container sót của mọi compose project (kể cả project không còn workspace)
  'docker ps -aq --filter label=com.docker.compose.project | xargs -r docker rm -f || true',
  // 3. volume sót
  'docker volume ls -q --filter label=com.docker.compose.project | xargs -r docker volume rm -f || true',
  // 4. image app đặt tên theo project; cộng thêm vài repo cố định của demo cũ
  "for d in /opt/opspilot/*/; do p=$(basename \"$d\"); docker images -q \"$p\" | sort -u | xargs -r docker image rm -f || true; done",
  'docker images -q opspilot-demo-express | xargs -r docker image rm -f || true',
  'docker images -q opspilot-collector | xargs -r docker image rm -f || true',
  // 5. xoá toàn bộ workspace
  'rm -rf /opt/opspilot/* 2>/dev/null || true'
].join('\n')

const VERIFY_COMMAND = [
  'set -eu',
  'test -z "$(docker ps -aq --filter label=com.docker.compose.project)"',
  'test -z "$(docker volume ls -q --filter label=com.docker.compose.project)"',
  'test -z "$(ls -A /opt/opspilot 2>/dev/null)"',
  '! ss -ltn | awk \'NR > 1 {print $4}\' | grep -Eq \'(:|])300[0-9][0-9]$\''
].join(' && ')

const LIST_COMMAND = [
  "printf 'compose-projects\\n'",
  'docker compose ls || true',
  "printf 'workspace-dirs\\n'",
  'ls -A /opt/opspilot 2>/dev/null || true',
  "printf 'ports-30xxx\\n'",
  "ss -ltn | awk 'NR > 1 {print $4}' | grep -E '(:|])300[0-9][0-9]$' | sort || true"
].join('; ')

async function run(ssh: SshManager, vpsId: number, title: string, command: string, timeoutMs: number) {
  console.log(`\n--- ${title} ---`)
  const result = await ssh.exec(vpsId, command, { timeoutMs })
  if (result.stdout.trim()) console.log(result.stdout.trim())
  if (result.stderr.trim()) console.error('STDERR:', result.stderr.trim())
  return result
}

async function main(): Promise<void> {
  const userDataPath = resolve(app.getPath('userData'))
  const database = initializeDatabase(userDataPath)
  const cipher = createCredentialCipher(userDataPath)
  const vpsRepository = new VpsRepository(database)
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

  try {
    for (const target of vpsRepository.list()) {
      console.log(`\n===== ${target.name} (${target.host}) — ${APPLY ? 'APPLY' : 'INSPECT'} =====`)
      if (!APPLY) {
        await run(ssh, target.id, 'trước khi dọn', LIST_COMMAND, 30_000)
        continue
      }
      await run(ssh, target.id, 'dọn', CLEAN_COMMAND, 600_000)
      const verify = await run(ssh, target.id, 'verify', VERIFY_COMMAND, 30_000)
      if (verify.code !== 0) {
        throw new Error(`${target.name} chưa sạch hoàn toàn (exit ${verify.code}).`)
      }
      console.log(`[PASS] ${target.name}: sạch — không compose project, không workspace, port 30xxx tự do.`)
      await run(ssh, target.id, 'sau khi dọn', LIST_COMMAND, 30_000)
    }
  } finally {
    await ssh.disconnectAll()
    closeDatabase()
  }
}

void app
  .whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    app.exit(1)
  })
