// Lab-only transport adapter. Production CLI has no file transport or response stubs.
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const source = realpathSync(process.env.OPSPILOT_SERVICE_GIT_FIXTURE)
if (!source.startsWith('/tmp/opspilot-r1-') || !source.endsWith('/source'))
  throw new Error('LAB_GIT_FIXTURE_REJECTED')
const url = 'https://github.com/opspilot-lab/controller-service.git'
const spawn = childProcess.spawn
childProcess.spawn = function (command, args, options) {
  if (command === 'git') {
    let rewritten = false
    args = args.map((value) => {
      if (value === url) {
        rewritten = true
        return pathToFileURL(source).href
      }
      return value === 'protocol.file.allow=never' ? 'protocol.file.allow=always' : value
    })
    if (rewritten) process.stdout.write('LAB_LOCAL_GIT_TRANSPORT\n')
    // Public polling intentionally forbids file:// in production. Relax only this isolated lab transport.
    options = {
      ...options,
      env: { ...options.env, GIT_ALLOW_PROTOCOL: 'file', GIT_PROTOCOL_FROM_USER: '1' }
    }
  }
  return spawn.call(this, command, args, options)
}
syncBuiltinESMExports()
