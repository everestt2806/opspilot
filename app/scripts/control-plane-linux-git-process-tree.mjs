/* eslint @typescript-eslint/explicit-function-return-type: off */

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [nodeBinary, controllerArtifactArg, dataDirectoryArg, modulesDirectoryArg] =
  process.argv.slice(2)
if (!nodeBinary || !controllerArtifactArg || !dataDirectoryArg || !modulesDirectoryArg) {
  throw new Error('USAGE')
}
if (process.platform !== 'linux') throw new Error('LINUX_ONLY')

const controllerArtifact = resolve(controllerArtifactArg)
const dataDirectory = resolve(dataDirectoryArg)
const modulesDirectory = resolve(modulesDirectoryArg)
const repositoryRoot = resolve(import.meta.dirname, '..')
const publicBranchSource = resolve(
  process.env.PUBLIC_BRANCH_SOURCE ?? join(repositoryRoot, 'src/main/git/publicBranch.ts')
)
const expectVulnerable = process.env.EXPECT_VULNERABLE === '1'
const requireFromRuntime = createRequire(resolve(modulesDirectory, '../package.json'))
const esbuild = requireFromRuntime('esbuild')
const harnessRoot = mkdtempSync(join(tmpdir(), 'opspilot-p3c-process-tree-'))
const publicBranchBundle = join(harnessRoot, 'public-branch.cjs')
const previousEnvironment = new Map()
const observedProcesses = new Map()
const proxySockets = new Set()
let proxyRequestBytes = Buffer.alloc(0)
let currentQueryAbortController
let activeProxy
let publicBranchApi

for (const key of [
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy'
]) {
  previousEnvironment.set(key, process.env[key])
}

function readProc(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const endOfCommand = stat.lastIndexOf(') ')
    if (endOfCommand < 0) return null
    const fields = stat
      .slice(endOfCommand + 2)
      .trim()
      .split(/\s+/)
    const command = stat.slice(stat.indexOf('(') + 1, endOfCommand)
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
    return {
      pid,
      command,
      cmdline,
      ppid: Number(fields[1]),
      pgid: Number(fields[2]),
      state: fields[0],
      startTime: fields[19]
    }
  } catch {
    return null
  }
}

function allProcesses() {
  return readdirSync('/proc')
    .filter((entry) => /^\d+$/.test(entry))
    .map((entry) => readProc(Number(entry)))
    .filter(Boolean)
}

function findQueryProcess(branch) {
  return allProcesses().find(
    (entry) =>
      entry.cmdline.some((arg) => arg.includes(`refs/heads/${branch}`)) &&
      entry.cmdline.some((arg) => arg.includes('https://github.com/octocat/Hello-World.git'))
  )
}

function findTreeSnapshot(rootPid) {
  const processes = allProcesses()
  const selected = new Map()
  const queue = [rootPid]
  while (queue.length > 0) {
    const parentPid = queue.shift()
    const children = processes.filter((entry) => entry.ppid === parentPid)
    for (const child of children) {
      selected.set(child.pid, child)
      queue.push(child.pid)
    }
  }
  const root = readProc(rootPid)
  if (root) selected.set(root.pid, root)
  for (const entry of selected.values()) observedProcesses.set(entry.pid, entry)
  return { root, processes, selected: [...selected.values()] }
}

async function waitFor(predicate, timeoutMs, errorCode) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10))
  }
  throw new Error(errorCode)
}

async function startHangingProxy() {
  proxyRequestBytes = Buffer.alloc(0)
  let resolveConnect
  const connected = new Promise((resolvePromise) => (resolveConnect = resolvePromise))
  const server = createServer((socket) => {
    proxySockets.add(socket)
    socket.on('close', () => proxySockets.delete(socket))
    socket.on('data', (chunk) => {
      proxyRequestBytes = Buffer.concat([proxyRequestBytes, chunk]).subarray(0, 16 * 1024)
      const requestLine = chunk.toString('latin1').split('\r\n', 1)[0]
      if (requestLine.startsWith('CONNECT ')) resolveConnect(requestLine)
      // Deliberately keep the CONNECT socket open without acknowledging it.
    })
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', () => rejectListen(new Error('PROXY_LISTEN_FAILED')))
    server.listen(0, '127.0.0.1', resolveListen)
  })
  activeProxy = server
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('PROXY_ADDRESS_INVALID')
  const proxyUrl = `http://127.0.0.1:${address.port}`
  process.env.HTTPS_PROXY = proxyUrl
  process.env.https_proxy = proxyUrl
  process.env.ALL_PROXY = proxyUrl
  process.env.all_proxy = proxyUrl
  delete process.env.NO_PROXY
  delete process.env.no_proxy
  return { connected, proxyUrl }
}

function withWatchdog(promise, timeoutMs, errorCode) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

function rememberQueryTree(branch) {
  const root = findQueryProcess(branch)
  if (!root) return null
  const snapshot = findTreeSnapshot(root.pid)
  try {
    snapshot.cwd = readlinkSync(`/proc/${root.pid}/cwd`)
  } catch {
    snapshot.cwd = null
  }
  return snapshot
}

function processGroupMembers(groupId) {
  return allProcesses().filter((entry) => entry.pgid === groupId && entry.state !== 'Z')
}

function killObservedProcesses() {
  const queryRoots = [...observedProcesses.values()].filter((entry) =>
    entry.cmdline.includes('ls-remote')
  )
  for (const root of queryRoots) {
    if (root.pgid === root.pid && root.pgid !== readProc(process.pid)?.pgid) {
      try {
        process.kill(-root.pgid, 'SIGKILL')
      } catch {
        // The exact observed group may already have exited.
      }
    }
  }
  const processes = [...observedProcesses.values()].sort(
    (left, right) => depth(right.pid) - depth(left.pid)
  )
  for (const expected of processes) {
    const current = readProc(expected.pid)
    if (!current || current.startTime !== expected.startTime) continue
    try {
      process.kill(expected.pid, 'SIGKILL')
    } catch {
      // The exact observed process may already have exited.
    }
  }
}

function depth(pid) {
  let current = readProc(pid)
  let result = 0
  while (current?.ppid && current.ppid !== 1 && result < 64) {
    current = readProc(current.ppid)
    result += 1
  }
  return result
}

async function settleQueryWithin(queryPromise, timeoutMs) {
  const settled = queryPromise.then(
    (value) => ({ value }),
    (error) => ({ error })
  )
  const outcome = await withWatchdog(settled, timeoutMs, 'QUERY_SETTLE_WATCHDOG_EXPIRED')
  return outcome
}

async function waitForGroupExit(groupId, timeoutMs) {
  await waitFor(
    () => processGroupMembers(groupId).length === 0,
    timeoutMs,
    'QUERY_PROCESS_GROUP_REMAINS'
  )
}

async function assertPublicQueryStops(mode) {
  const { connected } = await startHangingProxy()
  const branch = `p3c-${mode}-${process.pid}-${Date.now()}`
  currentQueryAbortController = new AbortController()
  const { queryPublicGitHubBranchTip, PublicBranchQueryError } = publicBranchApi
  const queryStartedAt = Date.now()
  const queryPromise = queryPublicGitHubBranchTip({
    repositoryUrl: 'https://github.com/octocat/Hello-World.git',
    branch,
    timeoutMs: mode === 'timeout' ? 200 : 15_000,
    signal: currentQueryAbortController.signal
  })
  let snapshot
  let groupId
  let didHang = false
  let baselineResult
  try {
    snapshot = await waitFor(() => rememberQueryTree(branch), 1500, 'GIT_PROCESS_NOT_VISIBLE')
    groupId = snapshot.root?.pgid
    const connectLine = await withWatchdog(connected, 3000, 'PROXY_CONNECT_WATCHDOG_EXPIRED')
    if (connectLine !== 'CONNECT github.com:443 HTTP/1.1')
      throw new Error('PROXY_CONNECT_TARGET_INVALID')
    if (/\r\n(?:Proxy-)?Authorization\s*:/i.test(proxyRequestBytes.toString('latin1'))) {
      throw new Error('PROXY_CREDENTIAL_HEADER_PRESENT')
    }

    snapshot = rememberQueryTree(branch) ?? snapshot
    groupId = snapshot.root?.pgid
    if (!groupId) throw new Error('GIT_PROCESS_GROUP_MISSING')
    if (!expectVulnerable && groupId !== snapshot.root.pid)
      throw new Error('GIT_NOT_IN_PRIVATE_PROCESS_GROUP')
    if (!expectVulnerable && groupId === readProc(process.pid)?.pgid)
      throw new Error('GIT_PROCESS_GROUP_NOT_ISOLATED')
    const helper = snapshot.selected.find((entry) =>
      /git-remote-(?:http|https)/.test(entry.command)
    )
    if (!helper) throw new Error('REAL_GIT_HTTPS_HELPER_NOT_OBSERVED')
    if (!snapshot.cwd?.includes('opspilot-public-git-'))
      throw new Error('GIT_TEMP_CWD_NOT_OBSERVED')

    let terminationStartedAt = queryStartedAt
    if (mode === 'cancel') {
      terminationStartedAt = Date.now()
      currentQueryAbortController.abort()
    }
    let outcome
    try {
      outcome = await settleQueryWithin(queryPromise, expectVulnerable ? 1200 : 4000)
    } catch (error) {
      if (
        expectVulnerable &&
        error instanceof Error &&
        error.message === 'QUERY_SETTLE_WATCHDOG_EXPIRED'
      ) {
        didHang = true
      } else {
        throw new Error(
          `QUERY_DID_NOT_SETTLE:${error instanceof Error ? error.message : 'UNKNOWN'}`
        )
      }
    }
    if (expectVulnerable) {
      baselineResult = { mode, vulnerable_baseline_hung: didHang, helper_seen: true }
    } else {
      const elapsedMs = Date.now() - terminationStartedAt
      const expectedCode = mode === 'timeout' ? 'GIT_TIMEOUT' : 'GIT_CANCELLED'
      if (
        !(outcome.error instanceof PublicBranchQueryError) ||
        outcome.error.code !== expectedCode
      ) {
        throw new Error('QUERY_TERMINATION_CODE_MISMATCH')
      }
      if (elapsedMs > 4000) throw new Error('QUERY_TERMINATION_TOO_SLOW')
      await waitForGroupExit(groupId, 1500)
      if (existsSync(snapshot.cwd)) throw new Error('GIT_TEMP_CWD_NOT_CLEANED')
      return {
        mode,
        elapsed_ms: elapsedMs,
        helper_seen: true,
        group_empty: true,
        cwd_cleaned: true
      }
    }
  } finally {
    currentQueryAbortController?.abort()
    try {
      await settleQueryWithin(queryPromise, 1500)
    } catch {
      // The query may intentionally exceed the baseline watchdog until cleanup below.
    }
    if (expectVulnerable || !groupId) killObservedProcesses()
    else if (processGroupMembers(groupId).length > 0) killObservedProcesses()
    if (groupId && !expectVulnerable) {
      try {
        await waitForGroupExit(groupId, 1500)
      } catch {
        killObservedProcesses()
      }
    }
    for (const socket of proxySockets) socket.destroy()
    if (activeProxy) {
      await new Promise((resolveClose) => activeProxy.close(resolveClose))
      activeProxy = null
    }
    try {
      await settleQueryWithin(queryPromise, 1500)
    } catch {
      // The query may already have been settled by the process cleanup.
    }
    if (groupId && !expectVulnerable && processGroupMembers(groupId).length > 0) {
      killObservedProcesses()
      try {
        await waitForGroupExit(groupId, 1500)
      } catch {
        // The observed process group may have exited during cleanup.
      }
    }
    currentQueryAbortController = undefined
  }
  if (expectVulnerable) {
    if (!didHang) throw new Error('VULNERABLE_BASELINE_DID_NOT_REPRODUCE_HANG')
    if (snapshot?.cwd && existsSync(snapshot.cwd)) throw new Error('BASELINE_TEMP_CWD_NOT_CLEANED')
    const remaining = [...observedProcesses.values()].some((expected) => {
      const current = readProc(expected.pid)
      return current && current.startTime === expected.startTime && current.state !== 'Z'
    })
    if (remaining) throw new Error('BASELINE_QUERY_PROCESS_REMAINS')
    return baselineResult
  }
}

async function assertControllerShutdown() {
  const { connected } = await startHangingProxy()
  const controller = spawn(nodeBinary, [controllerArtifact, 'run', '--data-dir', dataDirectory], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' }
  })
  controller.stderr?.resume()
  let snapshot
  let groupId
  try {
    await withWatchdog(connected, 5000, 'CONTROLLER_PROXY_WATCHDOG_EXPIRED')
    if (/\r\n(?:Proxy-)?Authorization\s*:/i.test(proxyRequestBytes.toString('latin1'))) {
      throw new Error('CONTROLLER_PROXY_CREDENTIAL_HEADER_PRESENT')
    }
    const target = 'https://github.com/octocat/Hello-World.git'
    snapshot = await waitFor(
      () => {
        const root = allProcesses().find(
          (entry) => entry.cmdline.includes('ls-remote') && entry.cmdline.includes(target)
        )
        return root ? findTreeSnapshot(root.pid) : null
      },
      1500,
      'CONTROLLER_GIT_PROCESS_NOT_VISIBLE'
    )
    groupId = snapshot.root?.pgid
    if (!groupId || groupId !== snapshot.root.pid)
      throw new Error('CONTROLLER_GIT_GROUP_NOT_ISOLATED')
    const helper = snapshot.selected.find((entry) =>
      /git-remote-(?:http|https)/.test(entry.command)
    )
    if (!helper) throw new Error('CONTROLLER_REAL_GIT_HELPER_NOT_OBSERVED')

    const exitPromise = new Promise((resolveExit, rejectExit) => {
      controller.once('error', () => rejectExit(new Error('CONTROLLER_SPAWN_FAILED')))
      controller.once('exit', (code, signal) => resolveExit({ code, signal }))
    })
    controller.kill('SIGTERM')
    const result = await withWatchdog(exitPromise, 5000, 'CONTROLLER_SHUTDOWN_WATCHDOG_EXPIRED')
    if (result.code !== 0) throw new Error(`CONTROLLER_EXIT_${result.code ?? result.signal}`)
    await waitForGroupExit(groupId, 1500)
    await assertHealthListenerReleased()

    const status = spawn(nodeBinary, [controllerArtifact, 'status', '--data-dir', dataDirectory], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    })
    status.stderr?.resume()
    const statusResult = await waitForChildExit(status, 5000)
    if (statusResult.code !== 0) throw new Error('CONTROLLER_DB_REOPEN_FAILED')
    return {
      sigterm_exit_code: result.code,
      listener_released: true,
      database_reopened: true,
      group_empty: true
    }
  } finally {
    if (controller.exitCode === null && controller.signalCode === null) {
      try {
        controller.kill('SIGKILL')
      } catch {
        // The controller may have exited while SIGKILL was sent.
      }
      try {
        await waitForChildExit(controller, 2000)
      } catch {
        // Do not mask the controller shutdown result with a repeated wait error.
      }
    }
    if (groupId && processGroupMembers(groupId).length > 0) killObservedProcesses()
    for (const socket of proxySockets) socket.destroy()
    if (activeProxy) {
      await new Promise((resolveClose) => activeProxy.close(resolveClose))
      activeProxy = null
    }
  }
}

function waitForChildExit(child, timeoutMs) {
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once('error', () => rejectExit(new Error('CHILD_SPAWN_FAILED')))
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  return withWatchdog(exited, timeoutMs, 'CHILD_EXIT_WATCHDOG_EXPIRED').catch(async (error) => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL')
      } catch {
        // The child may have exited while the watchdog fired.
      }
      await withWatchdog(exited, 2000, 'CHILD_CLEANUP_WATCHDOG_EXPIRED').catch(() => undefined)
    }
    throw error
  })
}

async function assertHealthListenerReleased() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', () => rejectListen(new Error('HEALTH_LISTENER_STILL_BOUND')))
    server.listen(8768, '127.0.0.1', resolveListen)
  })
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) =>
      error ? rejectClose(new Error('HEALTH_LISTENER_CLOSE_FAILED')) : resolveClose()
    )
  )
}

async function main() {
  await esbuild.build({
    entryPoints: [publicBranchSource],
    outfile: publicBranchBundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    sourcemap: false
  })
  publicBranchApi = requireFromRuntime(publicBranchBundle)

  const timeout = await assertPublicQueryStops('timeout')
  if (expectVulnerable) {
    console.log(
      JSON.stringify({ linux_real_git_proxy_tree: { timeout }, expected_vulnerable_baseline: true })
    )
    return
  }
  const cancellation = await assertPublicQueryStops('cancel')
  const controllerShutdown = await assertControllerShutdown()
  console.log(
    JSON.stringify({
      linux_real_git_proxy_tree: { timeout, cancellation, controller_shutdown: controllerShutdown },
      tls_verification_disabled: false,
      credentials_sent: false
    })
  )
}

try {
  await main()
} finally {
  currentQueryAbortController?.abort()
  if (activeProxy) {
    for (const socket of proxySockets) socket.destroy()
    await new Promise((resolveClose) => activeProxy.close(resolveClose))
  }
  const currentGroup = readProc(process.pid)?.pgid
  const rootGroups = [...observedProcesses.values()]
    .filter((entry) => entry.pid === entry.pgid && entry.pgid !== currentGroup)
    .map((entry) => entry.pgid)
  for (const groupId of new Set(rootGroups)) {
    if (processGroupMembers(groupId).length > 0) {
      try {
        process.kill(-groupId, 'SIGKILL')
      } catch {
        // The exact observed group may already have exited.
      }
    }
  }
  for (const key of previousEnvironment.keys()) {
    const previous = previousEnvironment.get(key)
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
  rmSync(harnessRoot, { recursive: true, force: true })
}
