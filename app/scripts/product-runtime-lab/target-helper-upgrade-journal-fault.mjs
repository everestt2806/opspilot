// Test-only process-loss injection, never imported by the production entrypoint.
import fs from 'node:fs'
const fault = process.env.OPSPILOT_HELPER_JOURNAL_FAULT
const fsync = fs.fsyncSync
if (!['after-intent', 'after-link'].includes(fault)) throw Error('JOURNAL_FAULT_INVALID')
if (fault === 'after-link') {
  const link = fs.linkSync
  fs.linkSync = (...args) => {
    const result = link(...args)
    if (String(args[1]).includes('/target-helper-upgrades/')) process.kill(process.pid, 'SIGKILL')
    return result
  }
} else {
  fs.fsyncSync = (fd) => {
    const result = fsync(fd)
    const path = fs.readlinkSync('/proc/self/fd/' + fd)
    if (
      path.endsWith('/target-helper-upgrades') &&
      fs
        .readdirSync(path)
        .some((name) => name.endsWith('.json') && fs.statSync(path + '/' + name).nlink === 1)
    )
      process.kill(process.pid, 'SIGKILL')
    return result
  }
}
