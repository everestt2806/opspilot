import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'

import { z } from 'zod'

import { evaluateProductOutcome } from '../src/main/controlPlane/productOutcomePolicy'

const MAX_INPUT_BYTES = 64 * 1024
const envelope = z.strictObject({ context: z.unknown(), evidence: z.unknown() })

function main(): void {
  if (process.argv.length !== 3) {
    console.error('Cách dùng: node try-product-outcome-policy.js <file-json>')
    process.exitCode = 2
    return
  }
  let fd: number | undefined
  try {
    // Không để FIFO/device giữ CLI chờ vô hạn; chỉ nhận file thường.
    fd = openSync(process.argv[2], constants.O_RDONLY | constants.O_NONBLOCK)
    if (!fstatSync(fd).isFile()) throw new Error('INPUT_NOT_FILE')
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const bytes = readSync(fd, buffer, size, buffer.length - size, null)
      if (bytes === 0) break
      size += bytes
    }
    if (size > MAX_INPUT_BYTES) throw new Error('INPUT_LIMIT')
    const input = envelope.parse(JSON.parse(buffer.subarray(0, size).toString('utf8')) as unknown)
    const decision = evaluateProductOutcome(input.context, input.evidence)
    console.log(JSON.stringify(decision))
    process.exitCode = decision.action === 'reconciliation_required' ? 1 : 0
  } catch {
    // Không in đường dẫn, JSON hay nội dung exception có thể chứa secret.
    console.error('Không đọc được input JSON hợp lệ trong giới hạn 64 KiB.')
    process.exitCode = 2
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        console.error('Không đóng được file input an toàn.')
        process.exitCode = 2
      }
    }
  }
}

main()
