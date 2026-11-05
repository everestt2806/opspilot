import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

const [nodeBinary, artifactArg, dataDirectoryArg] = process.argv.slice(2)
if (!nodeBinary || !artifactArg || !dataDirectoryArg || process.argv.length !== 5) {
  throw new Error('USAGE')
}
if (process.platform !== 'linux') throw new Error('LINUX_ONLY')

const artifact = realpathSync(artifactArg)
const dataDirectory = realpathSync(dataDirectoryArg)
if (!isAbsolute(dataDirectory) || !dataDirectory.startsWith('/var/tmp/opspilot-p3c-lab-')) {
  throw new Error('LAB_SMOKE_REQUIRES_ISOLATED_VAR_TMP_DIRECTORY')
}
if (!existsSync(resolve(dataDirectory, '.product-controller-initialized'))) {
  throw new Error('CONTROLLER_IDENTITY_MARKER_MISSING')
}

/** @returns {Promise<void>} */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function startAndStop() {
  const child = spawn(nodeBinary, [artifact, 'run', '--data-dir', dataDirectory], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_ENV: 'test' }
  })
  let settled = false
  const exit = new Promise((resolveExit, reject) => {
    child.once('error', () => reject(new Error('CONTROLLER_SPAWN_FAILED')))
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  try {
    const deadline = Date.now() + 10_000
    let health = false
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch('http://127.0.0.1:8768/healthz', {
          signal: AbortSignal.timeout(500)
        })
        if (response.status !== 200) throw new Error('HEALTH_STATUS_INVALID')
        const body = await response.json()
        if (
          body.api_version !== 'v1' ||
          !['ready', 'degraded'].includes(body.service_state ?? '')
        ) {
          throw new Error('HEALTH_BODY_INVALID')
        }
        health = true
        break
      } catch {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
      }
    }
    if (!health) throw new Error('CONTROLLER_HEALTH_NOT_READY')
    const hiddenApi = await fetch('http://127.0.0.1:8768/v1/controllers/x/apps', {
      signal: AbortSignal.timeout(1000)
    })
    if (hiddenApi.status !== 404 || (await hiddenApi.text()) !== '') {
      throw new Error('UNEXPECTED_V1_SURFACE')
    }
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    let timer
    const result = await Promise.race([
      exit,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('CONTROLLER_SIGTERM_TIMEOUT')), 8000)
      })
    ]).finally(() => {
      if (timer) clearTimeout(timer)
    })
    settled = true
    if (result.code !== 0) {
      process.exitCode = 1
      console.error(`CONTROLLER_EXIT_CODE_${result.code ?? result.signal}`)
    }
  }

  if (!settled) throw new Error('CONTROLLER_PROCESS_NOT_SETTLED')
  if (process.exitCode === 1) throw new Error('CONTROLLER_PROCESS_EXIT_FAILED')
  await new Promise((resolveListen, rejectListen) => {
    const probe = createServer()
    probe.once('error', () => rejectListen(new Error('HEALTH_LISTENER_NOT_RELEASED')))
    probe.listen(8768, '127.0.0.1', () =>
      probe.close((error) =>
        error ? rejectListen(new Error('HEALTH_LISTENER_NOT_RELEASED')) : resolveListen()
      )
    )
  })
}

await startAndStop()
await startAndStop()
console.log(
  JSON.stringify({
    service_starts: 2,
    service_exit_codes: [0, 0],
    healthz_loopback_only: true,
    v1_surface_hidden: true,
    listener_released_after_each_stop: true
  })
)
