// Test-only process loss at immutable controller material publication.
import fs from 'node:fs'
const mode = process.env.OPSPILOT_HELPER_CONTROLLER_FAULT
const request = process.env.OPSPILOT_HELPER_CONTROLLER_FAULT_REQUEST
if (
  !['dispatch-link', 'after-dispatch', 'outcome-link', 'commit-link'].includes(mode) ||
  !/^[a-f0-9-]{36}$/.test(request ?? '')
)
  throw Error('FAULT_INPUT_INVALID')
const link = fs.linkSync,
  sync = fs.fsyncSync
fs.linkSync = (...args) => {
  const result = link(...args),
    destination = String(args[1])
  if (destination.includes(request) && destination.endsWith('.' + mode.replace('-link', '')))
    process.kill(process.pid, 'SIGKILL')
  return result
}
fs.fsyncSync = (fd) => {
  const result = sync(fd)
  if (mode === 'after-dispatch') {
    const path = fs.readlinkSync('/proc/self/fd/' + fd)
    if (
      path.endsWith('/target-helper-upgrades') &&
      fs
        .readdirSync(path)
        .some(
          (name) =>
            name.includes(request) &&
            name.endsWith('.dispatch') &&
            fs.statSync(path + '/' + name).nlink === 1
        )
    )
      process.kill(process.pid, 'SIGKILL')
  }
  return result
}
