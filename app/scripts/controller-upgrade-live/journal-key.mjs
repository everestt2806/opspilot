/* eslint-disable @typescript-eslint/explicit-function-return-type -- Operational private journal only. */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

/** User-scoped DPAPI; never creates or replaces a production profile key. */
export function journalKey(directory, create) {
  if (process.platform !== 'win32') throw Error('WINDOWS_DPAPI_JOURNAL_REQUIRED')
  const file = join(directory, 'journal-master-key.dpapi'),
    python = resolve(import.meta.dirname, '../../../ml-service/.venv/Scripts/python.exe'),
    helper = join(import.meta.dirname, 'journal-key.py')
  if (!existsSync(file)) {
    if (!create) throw Error('EXISTING_JOURNAL_KEY_REQUIRED')
    const key = randomBytes(32)
    try {
      const sealed = execFileSync(python, [helper, '--protect'], {
        input: key,
        windowsHide: true,
        maxBuffer: 8192
      })
      writeFileSync(file, sealed, { flag: 'wx', mode: 0o600 })
      return Buffer.from(key)
    } finally {
      key.fill(0)
    }
  }
  return execFileSync(python, [helper, '--unprotect'], {
    input: readFileSync(file),
    windowsHide: true,
    maxBuffer: 8192
  })
}
