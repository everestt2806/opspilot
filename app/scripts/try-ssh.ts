/**
 * Thử nghiệm SSH manager độc lập (M1) — `pnpm try:ssh`.
 * Đọc cấu hình từ biến môi trường, không hardcode:
 *   OPSPILOT_SSH_HOST / PORT / USER / AUTH_TYPE (key|password) / SECRET
 * Đích mặc định: container SSH khoi dong local (port 2222).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AppError } from '../src/main/errors'
import { preDiagnose } from '../src/main/ssh/diagnose'
import { SshManager, type SshConnectionInfo } from '../src/main/ssh/manager'

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

function buildConfig(): SshConnectionInfo {
  return {
    host: env('OPSPILOT_SSH_HOST', '127.0.0.1'),
    port: Number.parseInt(env('OPSPILOT_SSH_PORT', '2222'), 10),
    username: env('OPSPILOT_SSH_USER', 'deploy'),
    authType: env('OPSPILOT_SSH_AUTH_TYPE', 'password') === 'key' ? 'key' : 'password',
    secret: env('OPSPILOT_SSH_SECRET', '')
  }
}

const RESULT: Record<string, 'PASS' | 'FAIL' | 'SKIP' | 'WARN'> = {}

function record(step: string, status: 'PASS' | 'FAIL' | 'SKIP' | 'WARN', detail = ''): void {
  RESULT[step] = status
  console.log(`[${status}] ${step}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  const ssh = new SshManager(() => buildConfig())
  const root = `${env('OPSPILOT_SSH_TEST_DIR', '/opt/opspilot').replace(/\/$/, '')}/try-ssh`

  // 0. chẩn đoán lỗi kết nối (TK-A10) — in nguyên nhân + cách sửa khi không vào được máy.
  const diagnosis = await preDiagnose(buildConfig())
  if (diagnosis) {
    record(
      '0 chan doan',
      'WARN',
      `${diagnosis.code} — ${diagnosis.title} // ${diagnosis.cause} // GOI Y: ${diagnosis.fixes.join(' | ')}`
    )
    // Không tới được máy thì các bước dưới chỉ lặp lại cùng một lỗi với retry dài — bỏ qua.
    for (const step of [
      '1 exec docker --version',
      '2 exec timeout',
      '3 uploadDir + exclude node_modules',
      '4 writeFile/readFile/fileSize',
      '5 readFileTail tăng byte',
      '6 sai credential'
    ]) {
      record(step, 'SKIP', 'khong toi duoc may chu — xem chan doan buoc 0')
    }
    return
  }
  record('0 chan doan', 'PASS', 'TCP OK, chuyen sang SSH')

  // 1. exec lệnh cơ bản
  try {
    const result = await ssh.exec(1, 'docker --version')
    if (result.code === 0) {
      record('1 exec docker --version', 'PASS', result.stdout.trim())
    } else {
      record(
        '1 exec docker --version',
        'WARN',
        `exit ${result.code}: ${result.stderr.trim() || 'docker chua cai tren dich'}`
      )
    }
  } catch (error) {
    record('1 exec docker --version', 'FAIL', String(error))
  }

  // 2. timeout phải ném SSH_TIMEOUT
  try {
    await ssh.exec(1, 'sleep 5', { timeoutMs: 2_000 })
    record('2 exec timeout', 'FAIL', 'khong nem ra loi')
  } catch (error) {
    if (error instanceof AppError && error.code === 'SSH_TIMEOUT') {
      record('2 exec timeout', 'PASS', error.code)
    } else {
      record('2 exec timeout', 'FAIL', String(error))
    }
  }

  // 3. uploadDir loại trừ node_modules
  const fixture = mkdtempSync(join(tmpdir(), 'opspilot-fixture-'))
  mkdirSync(join(fixture, 'node_modules'), { recursive: true })
  writeFileSync(join(fixture, 'app.js'), 'console.log("hello")\n', 'utf8')
  writeFileSync(join(fixture, 'node_modules', 'big.bin'), 'x'.repeat(4096), 'utf8')
  try {
    await ssh.uploadDir(1, fixture, root)
    const listing = await ssh.exec(1, `find ${root} -type f | sort`)
    const remoteFiles = listing.stdout.trim().split('\n').filter(Boolean)
    if (
      listing.code === 0 &&
      remoteFiles.some((f) => f.endsWith('app.js')) &&
      !remoteFiles.some((f) => f.includes('node_modules'))
    ) {
      record('3 uploadDir + exclude node_modules', 'PASS', remoteFiles.join(', '))
    } else {
      record('3 uploadDir + exclude node_modules', 'FAIL', remoteFiles.join(', '))
    }
  } catch (error) {
    record('3 uploadDir + exclude node_modules', 'FAIL', String(error))
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }

  // 4. writeFile -> readFile khớp nội dung
  const remoteFile = `${root}/hello.txt`
  try {
    const content = 'dòng tiếng Việt có dấu: ồ ạ ê\nsecond line\n'
    await ssh.writeFile(1, remoteFile, content)
    const read = await ssh.readFile(1, remoteFile)
    const size = await ssh.fileSize(1, remoteFile)
    if (read === content && size === Buffer.byteLength(content)) {
      record('4 writeFile/readFile/fileSize', 'PASS', `${size} bytes`)
    } else {
      record('4 writeFile/readFile/fileSize', 'FAIL', 'noi dung khong khop')
    }
  } catch (error) {
    record('4 writeFile/readFile/fileSize', 'FAIL', String(error))
  }

  // 5. readFileTail: lần 2 chỉ trả phần mới
  const tailFile = `${root}/tail.log`
  try {
    await ssh.exec(1, `printf 'aaaa\\nbbbb\\n' > ${tailFile}`)
    const first = await ssh.readFileTail(1, tailFile, 1)
    await ssh.exec(1, `printf 'cccc\\n' >> ${tailFile}`)
    const second = await ssh.readFileTail(1, tailFile, first.nextByte)
    if (first.content === 'aaaa\nbbbb\n' && second.content === 'cccc\n') {
      record('5 readFileTail tăng byte', 'PASS', `offset ${first.nextByte} -> ${second.nextByte}`)
    } else {
      record(
        '5 readFileTail tăng byte',
        'FAIL',
        JSON.stringify({ first: first.content, second: second.content })
      )
    }
  } catch (error) {
    record('5 readFileTail tăng byte', 'FAIL', String(error))
  }

  await ssh.disconnectAll()

  // 6. sai credential phải ra SSH_AUTH_FAILED (không retry vô hạn).
  // Dùng key dummy đúng định dạng PEM — chuỗi tuỳ ý sẽ bị báo lỗi parse chứ không đi
  // vào đường auth của server, làm bước này trượt oan.
  const WRONG_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACAv9lJZTwmPL7T9t5S17p3rupjfPSmbh18yvPbkkapU5QAAAJjRhC4v0YQu
LwAAAAtzc2gtZWQyNTUxOQAAACAv9lJZTwmPL7T9t5S17p3rupjfPSmbh18yvPbkkapU5Q
AAAEAWtuSKO4NoeQYF9Wf+GQLIZbaQcJ+zn6KaY6OCRrKqgi/2UllPCY8vtP23lLXuneu6
mN89KZuHXzK89uSRqlTlAAAAD2R1bW15LXdyb25nLWtleQECAwQFBg==
-----END OPENSSH PRIVATE KEY-----`
  const wrongSecret = buildConfig().authType === 'key' ? WRONG_KEY : 'sai-mat-khau-xyz'
  const bad = new SshManager(() => ({ ...buildConfig(), secret: wrongSecret }))
  try {
    await bad.connect(2)
    record('6 sai credential', 'FAIL', 'vẫn kết nối được')
  } catch (error) {
    if (error instanceof AppError && error.code === 'SSH_AUTH_FAILED') {
      record('6 sai credential', 'PASS', error.code)
    } else {
      record('6 sai credential', 'FAIL', String(error))
    }
  }
}

main()
  .catch((error) => {
    console.error('\nTRY-SSH CHẠY THẤT BẠI:', error)
    process.exitCode = 1
  })
  .finally(() => {
    const failed = Object.values(RESULT).filter((status) => status === 'FAIL')
    const warned = Object.values(RESULT).filter((status) => status === 'WARN')
    const skipped = Object.values(RESULT).filter((status) => status === 'SKIP')
    const total = Object.keys(RESULT).length
    console.log(
      `\nKết quả: ${total - failed.length}/${total} bước không lỗi` +
        (warned.length > 0 ? ` · ${warned.length} cảnh báo` : '') +
        (skipped.length > 0 ? ` · ${skipped.length} bỏ qua` : '')
    )
    if (failed.length > 0) {
      process.exitCode = 1
    }
  })
