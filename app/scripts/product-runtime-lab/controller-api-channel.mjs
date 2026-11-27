/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone Linux SSH integration lab. */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { createServer, Agent, request } from 'node:http'
import { connect } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const artifact = process.env.OPSPILOT_R1_ARTIFACT
if (!artifact) throw new Error('API_CHANNEL_LAB_ENV_REQUIRED')
const require = createRequire(artifact),
  { SshManager } = require(artifact),
  { Server, utils } = require('ssh2'),
  nonce = randomBytes(6).toString('hex'),
  directory = mkdtempSync('/tmp/opspilot-api-channel-'),
  output = resolve(import.meta.dirname, '../../.out-scripts/controller-api-channel', nonce)
mkdirSync(output, { recursive: true })
const hostPath = join(directory, 'host-key')
execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostPath], {
  stdio: 'ignore',
  timeout: 10000
})
const hostKey = readFileSync(hostPath),
  publicKey = utils.parseKey(hostKey).getPublicSSH(),
  pin = 'SHA256:' + createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, ''),
  password = randomBytes(32).toString('base64url'),
  connections = new Set(),
  managers = [],
  destinations = [],
  cases = []
let authenticated = 0,
  authenticationAttempts = 0,
  hold,
  pendingAccept
const http = createServer((req, res) => {
  assert.equal(req.url, '/channel-lab')
  res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
  res.end(JSON.stringify({ scope: 'fixed-loopback-channel', nonce }))
})
const ssh = new Server({ hostKeys: [hostKey] }, (client) => {
  connections.add(client)
  client.on('error', () => {})
  client.once('close', () => connections.delete(client))
  client.on('authentication', (ctx) => {
    authenticationAttempts++
    if (
      ctx.method === 'password' &&
      ['operator', 'replacement'].includes(ctx.username) &&
      ctx.password === password
    ) {
      authenticated++
      ctx.accept()
    } else ctx.reject()
  })
  client.on('ready', () =>
    client.on('tcpip', (accept, reject, info) => {
      destinations.push([info.destIP, info.destPort])
      if (info.destIP !== '127.0.0.1' || info.destPort !== 8768) {
        reject()
        return
      }
      if (hold) {
        pendingAccept = accept
        return
      }
      const channel = accept(),
        target = connect({ host: info.destIP, port: info.destPort })
      channel.on('error', () => target.destroy())
      target.on('error', () => channel.destroy())
      channel.once('close', () => target.destroy())
      target.once('close', () => channel.destroy())
      target.pipe(channel).pipe(target)
    })
  )
})
const waitFor = async (check) => {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('LAB_CONDITION_TIMEOUT')
    await delay(10)
  }
}
const readHttp = async (channel) => {
  const agent = new Agent({ keepAlive: false })
  agent.createConnection = () => channel
  let outgoing
  const timer = setTimeout(() => outgoing?.destroy(new Error('LAB_HTTP_TIMEOUT')), 5000)
  try {
    return await new Promise((resolveResponse, rejectResponse) => {
      outgoing = request(
        { host: '127.0.0.1', port: 8768, path: '/channel-lab', agent },
        (response) => {
          let text = ''
          response.on('data', (bytes) => {
            text += bytes.toString('utf8')
            if (text.length > 4096) outgoing.destroy(new Error('LAB_RESPONSE_LIMIT'))
          })
          response.once('end', () => {
            try {
              resolveResponse({ status: response.statusCode, value: JSON.parse(text) })
            } catch {
              rejectResponse(new Error('LAB_HTTP_INVALID_JSON'))
            }
          })
          response.once('error', rejectResponse)
        }
      )
      outgoing.once('error', rejectResponse)
      outgoing.end()
    })
  } finally {
    clearTimeout(timer)
    agent.destroy()
    channel.destroy()
  }
}
let result
try {
  await new Promise((resolveListen, rejectListen) => {
    http.once('error', rejectListen)
    http.listen(8768, '127.0.0.1', resolveListen)
  })
  await new Promise((resolveListen) => ssh.listen(0, '127.0.0.1', resolveListen))
  const expected = {
    vpsId: 1,
    host: '127.0.0.1',
    port: ssh.address().port,
    hostFingerprint: pin,
    username: 'operator',
    authType: 'password'
  }
  let profile = { ...expected, secret: password }
  const manager = new SshManager(() => ({ ...profile }))
  managers.push(manager)
  const opened = await manager.openControllerApiChannel(expected)
  assert.deepEqual(opened.identity, expected)
  assert.deepEqual(await readHttp(opened.channel), {
    status: 200,
    value: { scope: 'fixed-loopback-channel', nonce }
  })
  cases.push('actual_pinned_ssh_http_direct_tcpip')
  assert.deepEqual(destinations, [['127.0.0.1', 8768]])
  cases.push('fixed_destination_no_local_listener_or_exec')
  const authBefore = authenticationAttempts,
    acceptedBefore = authenticated
  await assert.rejects(manager.openControllerApiChannel({ ...expected, username: 'foreign' }), {
    name: 'SshHostIdentityChangedError'
  })
  assert.equal(authenticationAttempts, authBefore)
  cases.push('unexpected_principal_rejected_before_authentication')
  const wrong = { ...expected, hostFingerprint: 'SHA256:' + 'A'.repeat(43) }
  const badManager = new SshManager(() => ({ ...wrong, secret: password }))
  managers.push(badManager)
  await assert.rejects(badManager.openControllerApiChannel(wrong), { code: 'VALIDATION' })
  assert.equal(authenticationAttempts, authBefore)
  assert.equal(destinations.length, 1)
  cases.push('wrong_host_pin_rejected_before_authentication_and_forwarding')
  profile = { ...profile, username: 'replacement' }
  await assert.rejects(manager.openControllerApiChannel(expected), {
    name: 'SshHostIdentityChangedError'
  })
  const replacement = await manager.openControllerApiChannel({
    ...expected,
    username: 'replacement'
  })
  assert.equal(replacement.identity.username, 'replacement')
  assert.equal(authenticated, acceptedBefore + 1)
  assert.equal((await readHttp(replacement.channel)).status, 200)
  cases.push('pooled_principal_change_uses_new_authenticated_connection')
  hold = true
  const destinationCount = destinations.length
  const timed = manager.openControllerApiChannel(
    { ...expected, username: 'replacement' },
    { timeoutMs: 200 }
  )
  void timed.catch(() => {})
  await waitFor(() => destinations.length === destinationCount + 1)
  await assert.rejects(timed, { code: 'SSH_TIMEOUT' })
  const late = pendingAccept()
  let lateClosed = false
  late.once('close', () => {
    lateClosed = true
  })
  late.on('error', () => {})
  late.resume()
  await waitFor(() => lateClosed)
  assert.equal(destinations.length, destinationCount + 1)
  cases.push('timeout_destroys_late_channel_without_replay')
  pendingAccept = undefined
  const stop = new AbortController()
  const aborted = manager.openControllerApiChannel(
    { ...expected, username: 'replacement' },
    { signal: stop.signal }
  )
  void aborted.catch(() => {})
  await waitFor(() => pendingAccept !== undefined)
  stop.abort()
  await assert.rejects(aborted, { name: 'SshAbortedError' })
  const cancelled = pendingAccept()
  let cancelledClosed = false
  cancelled.once('close', () => {
    cancelledClosed = true
  })
  cancelled.on('error', () => {})
  cancelled.resume()
  await waitFor(() => cancelledClosed)
  cases.push('abort_destroys_late_channel')
  result = {
    status: 'PASS',
    nonce,
    scope: 'PINNED_CONTROLLER_API_SSH_CHANNEL',
    passed: cases.length,
    cases,
    artifact_sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
    public_management_listener: false,
    production_vps_used: false
  }
} catch (error) {
  result = {
    status: 'FAIL',
    nonce,
    passed: cases.length,
    cases,
    code: /^[A-Z_]{1,80}$/.test(error.code) ? error.code : error.name
  }
} finally {
  for (const manager of managers) await manager.disconnectAll()
  for (const client of connections) client.end()
  await new Promise((resolveClose) => ssh.close(resolveClose))
  http.closeAllConnections()
  await new Promise((resolveClose) => http.close(resolveClose))
  assert.match(directory, /^\/tmp\/opspilot-api-channel-[A-Za-z0-9]+$/)
  rmSync(directory, { recursive: true })
  if (result) result.cleanup = true
}
writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
