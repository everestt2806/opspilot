/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript không hỗ trợ kiểu trả về TypeScript. */
/**
 * OpsPilot Docker Lab Runner (Task L0)
 *
 * Verifies Docker Engine & Compose readiness, builds & runs an isolated
 * Express fixture, polls /health, validates responses, and cleans up strictly
 * owned resources without touching pre-existing user containers/images.
 */

import { execFile } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIXTURE_DIR = path.join(__dirname, 'fixture')

/** Find an available TCP port on loopback 127.0.0.1 */
export async function getAvailablePort(startPort = 31000) {
  for (let port = startPort; port < startPort + 500; port++) {
    const isFree = await new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, '127.0.0.1')
    })
    if (isFree) return port
  }
  throw new Error(`No available loopback port found starting from ${startPort}`)
}

/** Execute a command with finite timeout and captured stdout/stderr */
export async function runCmd(cmd, args, options = {}) {
  const timeout = options.timeoutMs ?? 60_000
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: options.cwd || process.cwd(),
        timeout,
        env: { ...process.env, ...options.env },
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({
          stdout: stdout ? stdout.toString() : '',
          stderr: stderr ? stderr.toString() : '',
          exitCode
        })
      }
    )
  })
}

/** Check Docker daemon and Compose environment (L0-O1) */
export async function checkEnvironment(customEnv) {
  const infoRes = await runCmd('docker', ['info', '--format', '{{json .}}'], {
    timeoutMs: 15_000,
    env: customEnv
  })

  if (infoRes.exitCode !== 0) {
    return {
      ok: false,
      engine: 'unknown',
      serverVersion: 'unknown',
      composeVersion: 'unknown',
      error: `docker info failed with exit code ${infoRes.exitCode}: ${infoRes.stderr || infoRes.stdout}`
    }
  }

  let serverVersion = 'unknown'
  let osType = 'unknown'
  try {
    const parsed = JSON.parse(infoRes.stdout)
    serverVersion = parsed.ServerVersion || 'unknown'
    osType = parsed.OSType || 'unknown'
  } catch {
    if (infoRes.stdout.includes('Server Version:')) {
      const match = infoRes.stdout.match(/Server Version:\s*([^\r\n]+)/)
      if (match) serverVersion = match[1].trim()
    }
    if (infoRes.stdout.includes('OSType:')) {
      const match = infoRes.stdout.match(/OSType:\s*([^\r\n]+)/)
      if (match) osType = match[1].trim()
    }
  }

  const composeRes = await runCmd('docker', ['compose', 'version'], {
    timeoutMs: 15_000,
    env: customEnv
  })

  if (composeRes.exitCode !== 0) {
    return {
      ok: false,
      engine: osType,
      serverVersion,
      composeVersion: 'unknown',
      error: `docker compose version failed: ${composeRes.stderr || composeRes.stdout}`
    }
  }

  const composeVersion = composeRes.stdout.trim()
  const isLinux = osType.toLowerCase() === 'linux'

  return {
    ok: isLinux,
    engine: osType,
    serverVersion,
    composeVersion,
    rawInfo: infoRes.stdout.slice(0, 500)
  }
}

/** Get list of existing container and image IDs before running test (Fail-Closed on error) */
export async function getExistingInventory(customEnv) {
  const cRes = await runCmd('docker', ['ps', '-a', '--format', '{{.ID}} {{.Names}}'], {
    env: customEnv
  })
  if (cRes.exitCode !== 0) {
    throw new Error(
      `getExistingInventory failed for containers (exit ${cRes.exitCode}): ${cRes.stderr || cRes.stdout}`
    )
  }
  const iRes = await runCmd('docker', ['images', '--format', '{{.ID}} {{.Repository}}:{{.Tag}}'], {
    env: customEnv
  })
  if (iRes.exitCode !== 0) {
    throw new Error(
      `getExistingInventory failed for images (exit ${iRes.exitCode}): ${iRes.stderr || iRes.stdout}`
    )
  }

  return {
    containers: cRes.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    images: iRes.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  }
}

/** Đọc tối đa 64 KiB trong cùng ngân sách abort của request. */
async function readBoundedBody(response, signal) {
  if (!response.body) throw new Error('Health response has no body')
  const reader = response.body.getReader()
  let total = 0
  const chunks = []
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      total += value.byteLength
      if (total > 64 * 1024) throw new Error('Health response exceeds 64 KiB')
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, total).toString('utf8')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Execute a single lab run with specific parameters */
export async function executeLabRun(options = {}) {
  const command = options.runCommand ?? runCmd
  const startTime = Date.now()
  const runId = options.runId || `l0_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/.test(runId)) throw new Error('Invalid lab run ID')
  const imageName = `opspilot-lab-express:${runId}`
  const containerName = `opspilot-lab-container-${runId}`
  const dockerfile = options.dockerfile || 'Dockerfile'
  const simulateFailHealth = options.simulateFailHealth || false
  const port = options.port || (await getAvailablePort(31000))
  const ownerToken = crypto.randomBytes(24).toString('hex')
  const scratch = mkdtempSync(path.join(tmpdir(), 'opspilot-l0-'))
  const iidFile = path.join(scratch, 'image.id')
  const cidFile = path.join(scratch, 'container.id')

  const result = {
    runId,
    success: false,
    step: 'INITIALIZE',
    failedAtStep: null,
    port,
    imageName,
    containerName,
    timestamps: {
      start: new Date(startTime).toISOString()
    },
    durationMs: 0,
    cleanupReport: {
      containersRemoved: [],
      imagesRemoved: [],
      leakedResources: [],
      errors: [],
      unverified: false
    }
  }

  let createdContainerId = ''
  let createdImageId = ''
  let buildAttempted = false
  let runAttempted = false

  try {
    // Step 0: Preflight Collision Check
    const preCheckC = await command('docker', [
      'ps',
      '-a',
      '--filter',
      `name=^/${containerName}$`,
      '--format',
      '{{.ID}}'
    ])
    if (preCheckC.exitCode !== 0) throw new Error('Container preflight inventory unavailable')
    if (preCheckC.stdout.trim()) {
      throw new Error(
        `Preflight collision: container with name "${containerName}" already exists (${preCheckC.stdout.trim()})`
      )
    }

    const preCheckI = await command('docker', [
      'images',
      '--filter',
      `reference=${imageName}`,
      '--format',
      '{{.ID}}'
    ])
    if (preCheckI.exitCode !== 0) throw new Error('Image preflight inventory unavailable')
    if (preCheckI.stdout.trim()) {
      throw new Error(
        `Preflight collision: image with reference "${imageName}" already exists (${preCheckI.stdout.trim()})`
      )
    }

    // Step 1: Build image
    result.step = 'BUILD'
    buildAttempted = true
    const buildRes = await command(
      'docker',
      [
        'build',
        '-t',
        imageName,
        '--iidfile',
        iidFile,
        '-f',
        path.join(FIXTURE_DIR, dockerfile),
        '--label',
        `opspilot.lab.run_id=${runId}`,
        '--label',
        'opspilot.lab.fixture=express',
        '--label',
        `opspilot.lab.owner=${ownerToken}`,
        FIXTURE_DIR
      ],
      { timeoutMs: 120_000 }
    )

    if (buildRes.exitCode !== 0) {
      throw new Error(
        `Docker build failed (exit ${buildRes.exitCode}): ${buildRes.stderr || buildRes.stdout}`
      )
    }
    result.timestamps.buildFinished = new Date().toISOString()

    // Inspect image ID
    createdImageId = readFileSync(iidFile, 'utf8').trim()
    if (!/^sha256:[a-f0-9]{64}$/.test(createdImageId)) throw new Error('Invalid build image ID')
    result.imageId = createdImageId

    // Step 2: Run container
    result.step = 'RUN'
    const runArgs = [
      'run',
      '-d',
      '--name',
      containerName,
      '--cidfile',
      cidFile,
      '-p',
      `127.0.0.1:${port}:3000`,
      '-e',
      `LAB_RUN_ID=${runId}`,
      '-e',
      `PORT=3000`,
      '-e',
      `SIMULATE_FAIL_HEALTH=${simulateFailHealth ? '1' : '0'}`,
      '-e',
      `HEALTH_DELAY_MS=${options.healthDelayMs ?? 0}`,
      '--label',
      `opspilot.lab.run_id=${runId}`,
      '--label',
      'opspilot.lab.fixture=express',
      '--label',
      `opspilot.lab.owner=${ownerToken}`,
      createdImageId
    ]

    runAttempted = true
    const runRes = await command('docker', runArgs, { timeoutMs: 30_000 })
    if (runRes.exitCode !== 0) {
      throw new Error(
        `Docker run failed (exit ${runRes.exitCode}): ${runRes.stderr || runRes.stdout}`
      )
    }
    createdContainerId = readFileSync(cidFile, 'utf8').trim()
    if (!/^[a-f0-9]{64}$/.test(createdContainerId)) throw new Error('Invalid created container ID')
    result.containerId = createdContainerId
    result.timestamps.containerStarted = new Date().toISOString()

    // Step 3: Health check (polling loopback with deadline-bounded fetch & body)
    result.step = 'HEALTH_CHECK'
    const healthUrl = `http://127.0.0.1:${port}/health`
    const healthTimeoutMs = options.healthTimeoutMs ?? 15_000
    const pollIntervalMs = options.pollIntervalMs ?? 250
    const startHealthPoll = Date.now()
    let healthPass = false

    while (Date.now() - startHealthPoll < healthTimeoutMs) {
      const elapsed = Date.now() - startHealthPoll
      const remainingBudget = healthTimeoutMs - elapsed
      if (remainingBudget <= 0) break

      const reqTimeout = Math.min(remainingBudget, 3_000)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), reqTimeout)

      try {
        const resp = await fetch(healthUrl, { method: 'GET', signal: controller.signal })

        // Recheck deadline after receiving headers
        if (Date.now() - startHealthPoll >= healthTimeoutMs) {
          throw new Error(
            `Health response arrived after overall budget of ${healthTimeoutMs}ms exceeded`
          )
        }

        result.httpStatus = resp.status
        const bodyText = await readBoundedBody(resp, controller.signal)
        if (Date.now() - startHealthPoll >= healthTimeoutMs) {
          throw new Error(
            `Health response body reading exceeded overall budget of ${healthTimeoutMs}ms`
          )
        }

        let body
        try {
          body = JSON.parse(bodyText)
        } catch {
          throw new Error('Health response is not valid JSON')
        }
        result.responseBody = body

        if (resp.status === 200) {
          if (body && body.run_id === runId && body.status === 'ok') {
            healthPass = true
            result.timestamps.healthChecked = new Date().toISOString()
            break
          } else {
            throw new Error(`Response run_id mismatch: expected ${runId}, got ${body?.run_id}`)
          }
        } else {
          if (simulateFailHealth && resp.status === 500) {
            throw new Error(`Controlled health failure triggered: status 500 received`)
          }
        }
      } catch (fetchErr) {
        if (
          simulateFailHealth &&
          String(fetchErr).includes('Controlled health failure triggered')
        ) {
          throw fetchErr
        }
        if (
          String(fetchErr).includes('overall budget') ||
          String(fetchErr).includes('exceeds 64 KiB')
        ) {
          throw fetchErr
        }
        const sleepTime = Math.min(
          pollIntervalMs,
          Math.max(0, healthTimeoutMs - (Date.now() - startHealthPoll))
        )
        if (sleepTime > 0) {
          await new Promise((r) => setTimeout(r, sleepTime))
        }
      } finally {
        clearTimeout(timer)
        controller.abort()
      }
    }

    if (!healthPass) {
      throw new Error(
        `Health check timed out after ${healthTimeoutMs}ms at ${healthUrl} (last status: ${result.httpStatus})`
      )
    }

    result.step = 'COMPLETED'
    result.success = true
  } catch (err) {
    result.failedAtStep = result.step
    result.error = err instanceof Error ? err.message : String(err)
  } finally {
    // Chỉ xóa ID được Docker ghi nhận và nonce của lượt chạy; không fallback tên.
    // Image chỉ untag không force, tránh xóa các alias hoặc image đang được dùng.
    const cleanup = async (kind, idFile, expectedId, reference) => {
      let capturedId
      try {
        capturedId = readFileSync(idFile, 'utf8').trim()
      } catch {
        return
      }
      const pattern = kind === 'container' ? /^[a-f0-9]{64}$/ : /^sha256:[a-f0-9]{64}$/
      if (!pattern.test(capturedId) || (expectedId && capturedId !== expectedId)) {
        result.cleanupReport.unverified = true
        result.cleanupReport.errors.push(`Unverified ${kind} ID; cleanup refused`)
        return
      }
      try {
        const inspected = await command('docker', [kind, 'inspect', reference || capturedId])
        if (inspected.exitCode !== 0) throw new Error('ownership inspection unavailable')
        const records = JSON.parse(inspected.stdout)
        const owned =
          Array.isArray(records) &&
          records.length === 1 &&
          records[0].Id === capturedId &&
          records[0].Config?.Labels?.['opspilot.lab.owner'] === ownerToken &&
          records[0].Config?.Labels?.['opspilot.lab.run_id'] === runId
        if (!owned) throw new Error('ownership mismatch')
        const args = kind === 'container' ? ['rm', '-f', capturedId] : ['rmi', reference]
        const removed = await command('docker', args, { timeoutMs: 20_000 })
        if (removed.exitCode !== 0) throw new Error('resource removal failed')
        result.cleanupReport[kind === 'container' ? 'containersRemoved' : 'imagesRemoved'].push(
          kind === 'container' ? capturedId : reference
        )
      } catch (error) {
        result.cleanupReport.unverified = true
        result.cleanupReport.errors.push(`${kind} cleanup refused: ${error.message}`)
      }
    }
    if (runAttempted) await cleanup('container', cidFile, createdContainerId)
    if (buildAttempted) await cleanup('image', iidFile, createdImageId, imageName)

    // 3. Post-cleanup verification: confirm no residual container or image with this runId
    const checkC = await command('docker', [
      'ps',
      '-a',
      '--filter',
      `label=opspilot.lab.run_id=${runId}`,
      '--format',
      '{{.ID}}'
    ])
    if (checkC.exitCode !== 0) {
      result.cleanupReport.unverified = true
      result.cleanupReport.errors.push(
        `Failed to verify container cleanup (exit ${checkC.exitCode}): ${checkC.stderr}`
      )
      result.cleanupReport.leakedResources.push(`Unverified container for run ${runId}`)
    } else if (checkC.stdout.trim()) {
      result.cleanupReport.leakedResources.push(`Container leaked: ${checkC.stdout.trim()}`)
    }

    const checkI = await command('docker', [
      'images',
      '--filter',
      `label=opspilot.lab.run_id=${runId}`,
      '--format',
      '{{.ID}}'
    ])
    if (checkI.exitCode !== 0) {
      result.cleanupReport.unverified = true
      result.cleanupReport.errors.push(
        `Failed to verify image cleanup (exit ${checkI.exitCode}): ${checkI.stderr}`
      )
      result.cleanupReport.leakedResources.push(`Unverified image for run ${runId}`)
    } else if (checkI.stdout.trim()) {
      result.cleanupReport.leakedResources.push(`Image leaked: ${checkI.stdout.trim()}`)
    }

    // Fail-Closed: any cleanup error, unverified status, or leaked resource fails the run
    if (
      result.cleanupReport.unverified ||
      result.cleanupReport.leakedResources.length > 0 ||
      result.cleanupReport.errors.length > 0
    ) {
      result.success = false
      if (!result.error) {
        result.error = `Cleanup unverified or failed: ${result.cleanupReport.errors.join('; ') || result.cleanupReport.leakedResources.join(', ')}`
      }
    }

    result.step = result.success ? 'COMPLETED' : 'FAILED_CLEANED'
    result.timestamps.cleanupFinished = new Date().toISOString()
    result.durationMs = Date.now() - startTime
    rmSync(scratch, { recursive: true, force: true })
  }

  return result
}

/** Run the full L0 verification suite */
export async function runFullSuite() {
  console.log('===============================================================')
  console.log('   OPSPILOT DOCKER LAB READINESS VERIFICATION SUITE (L0-R)      ')
  console.log('===============================================================\n')

  let failedCases = 0

  // Case 1: Environment check (L0-O1)
  console.log('--- [CASE 1: Environment Report (L0-O1)] ---')
  const env = await checkEnvironment()
  console.log(`  Engine OS:       ${env.engine}`)
  console.log(`  Server Version:  ${env.serverVersion}`)
  console.log(`  Compose Version: ${env.composeVersion}`)
  if (!env.ok) {
    console.error(`  FAIL: Environment check failed. ${env.error || 'Engine is not Linux'}`)
    console.error(
      '  Docker daemon is not running or unreachable. Real Docker verification gates are BLOCKED.'
    )
    console.error(
      '  Hướng gỡ chặn: Khởi động Docker Desktop trên máy host để mở pipe dockerDesktopLinuxEngine.\n'
    )
    return 1
  } else {
    console.log(
      '  PASS: Docker daemon is responsive with Linux engine, and Docker Compose is available.\n'
    )
  }

  // Record initial user inventory to guarantee non-interference (L0-O4)
  const initialInventory = await getExistingInventory()
  console.log(
    `[Inventory baseline] Found ${initialInventory.containers.length} existing containers and ${initialInventory.images.length} images.`
  )

  // Case 2: Happy Path (L0-O2, L0-O3, L0-O4)
  console.log('--- [CASE 2: Happy Path - Build, Run, Health 200, Verify Body, Cleanup] ---')
  const happyResult = await executeLabRun({})
  console.log(`  Run ID:           ${happyResult.runId}`)
  console.log(`  Loopback Port:    ${happyResult.port}`)
  console.log(
    `  Image ID:         ${happyResult.imageId ? happyResult.imageId.slice(0, 19) + '...' : 'none'}`
  )
  console.log(
    `  Container ID:     ${happyResult.containerId ? happyResult.containerId.slice(0, 12) : 'none'}`
  )
  console.log(`  HTTP Status:      ${happyResult.httpStatus}`)
  console.log(`  Response:         ${JSON.stringify(happyResult.responseBody)}`)
  console.log(`  Duration:         ${happyResult.durationMs}ms`)
  console.log(
    `  Cleanup report:   containers=${happyResult.cleanupReport.containersRemoved.length}, images=${happyResult.cleanupReport.imagesRemoved.length}, leaked=${happyResult.cleanupReport.leakedResources.length}`
  )

  if (
    happyResult.success &&
    happyResult.cleanupReport.leakedResources.length === 0 &&
    !happyResult.cleanupReport.unverified
  ) {
    console.log('  PASS: Happy path passed with verified response and clean teardown.\n')
  } else {
    console.error(
      `  FAIL: Happy path failed at step ${happyResult.failedAtStep}: ${happyResult.error}`
    )
    failedCases++
  }

  // Case 3: Controlled Build Failure (L0-O4, L0-O5)
  console.log('--- [CASE 3: Controlled Build Failure & Teardown] ---')
  const failBuildResult = await executeLabRun({ dockerfile: 'Dockerfile.fail' })
  console.log(`  Run ID:           ${failBuildResult.runId}`)
  console.log(`  Step failed:      ${failBuildResult.failedAtStep}`)
  console.log(
    `  Error reported:   ${failBuildResult.error ? failBuildResult.error.split('\n')[0] : 'none'}`
  )
  console.log(`  Containers rm:    ${failBuildResult.cleanupReport.containersRemoved.length}`)
  console.log(
    `  Cleanup check:    leaked=${failBuildResult.cleanupReport.leakedResources.length}, unverified=${failBuildResult.cleanupReport.unverified}`
  )

  if (
    !failBuildResult.success &&
    failBuildResult.failedAtStep === 'BUILD' &&
    failBuildResult.cleanupReport.leakedResources.length === 0 &&
    failBuildResult.cleanupReport.containersRemoved.length === 0
  ) {
    console.log(
      '  PASS: Controlled build failure reported non-zero exit code, avoided deleting unowned container, and left no leaks.\n'
    )
  } else {
    console.error('  FAIL: Expected build failure with clean state without unowned deletions.')
    failedCases++
  }

  // Case 4: Controlled Health Failure (L0-O4, L0-O5)
  console.log('--- [CASE 4: Controlled Health Failure & Teardown] ---')
  const failHealthResult = await executeLabRun({ simulateFailHealth: true })
  console.log(`  Run ID:           ${failHealthResult.runId}`)
  console.log(`  Step failed:      ${failHealthResult.failedAtStep}`)
  console.log(`  HTTP Status:      ${failHealthResult.httpStatus}`)
  console.log(`  Error reported:   ${failHealthResult.error}`)
  console.log(`  Cleanup check:    leaked=${failHealthResult.cleanupReport.leakedResources.length}`)

  if (
    !failHealthResult.success &&
    failHealthResult.failedAtStep === 'HEALTH_CHECK' &&
    failHealthResult.cleanupReport.leakedResources.length === 0
  ) {
    console.log(
      '  PASS: Controlled health failure caught properly, and container/image were safely removed.\n'
    )
  } else {
    console.error('  FAIL: Expected health failure with clean state, but got unexpected outcome.')
    failedCases++
  }

  // Case 5: Two Consecutive Runs (Port & Resource Isolation)
  console.log('--- [CASE 5: Two Consecutive Runs (Port & Resource Isolation)] ---')
  const port1 = await getAvailablePort(31001)
  const run1 = await executeLabRun({ port: port1 })
  console.log(`  Run 1: ID=${run1.runId}, Port=${run1.port}, Success=${run1.success}`)

  const port2 = await getAvailablePort(port1 + 1)
  const run2 = await executeLabRun({ port: port2 })
  console.log(`  Run 2: ID=${run2.runId}, Port=${run2.port}, Success=${run2.success}`)

  const consecutivePass =
    run1.success &&
    run2.success &&
    run1.runId !== run2.runId &&
    run1.port !== run2.port &&
    run1.cleanupReport.leakedResources.length === 0 &&
    run2.cleanupReport.leakedResources.length === 0

  if (consecutivePass) {
    console.log(
      '  PASS: Two consecutive runs executed cleanly with unique run IDs, different ports, and zero leakage.\n'
    )
  } else {
    console.error('  FAIL: Consecutive runs failed or had collisions.')
    failedCases++
  }

  // Case 6: User Existing Resources Protection Check
  console.log('--- [CASE 6: Existing User Resources Unaltered Check] ---')
  const finalInventory = await getExistingInventory()
  let missingContainers = 0
  for (const c of initialInventory.containers) {
    if (!finalInventory.containers.includes(c)) missingContainers++
  }
  let missingImages = 0
  for (const i of initialInventory.images) {
    if (!finalInventory.images.includes(i)) missingImages++
  }

  console.log(
    `  Initial containers: ${initialInventory.containers.length}, Final containers: ${finalInventory.containers.length}`
  )
  console.log(
    `  Initial images:     ${initialInventory.images.length}, Final images:     ${finalInventory.images.length}`
  )
  if (missingContainers === 0 && missingImages === 0) {
    console.log(
      '  PASS: All pre-existing user containers and images are 100% intact and untouched.\n'
    )
  } else {
    console.error(
      `  FAIL: Detected alteration of user resources! Missing containers: ${missingContainers}, missing images: ${missingImages}`
    )
    failedCases++
  }

  // Case 7: Daemon Down / Unreachable Error Handling
  console.log('--- [CASE 7: Daemon Down / Unreachable Error Handling] ---')
  const fakeEnv = { DOCKER_HOST: 'npipe:////./pipe/nonexistent_docker_engine_probe_test' }
  const daemonDownCheck = await checkEnvironment(fakeEnv)
  console.log(`  Engine check ok:   ${daemonDownCheck.ok}`)
  console.log(
    `  Reported error:    ${daemonDownCheck.error ? daemonDownCheck.error.split('\n')[0] : 'none'}`
  )
  if (!daemonDownCheck.ok && daemonDownCheck.error) {
    console.log(
      '  PASS: Daemon-down condition is immediately detected and halted with a clear diagnostic message.\n'
    )
  } else {
    console.error('  FAIL: Expected daemon-down check to fail gracefully.')
    failedCases++
  }

  // Case 8: Ownership Safety — Build Failure Does Not Issue Forced Deletes on Uncreated Container
  console.log('--- [CASE 8: L0-R01 Ownership: No Forced Delete on Failed Build] ---')
  const failOwnershipCheck = await executeLabRun({
    runId: `uncreated_${Date.now()}`,
    dockerfile: 'Dockerfile.fail'
  })
  if (
    failOwnershipCheck.cleanupReport.containersRemoved.length === 0 &&
    !failOwnershipCheck.cleanupReport.unverified
  ) {
    console.log(
      '  PASS: Build failure did not trigger container removal for a container that was never created.\n'
    )
  } else {
    console.error(
      '  FAIL: Build failure issued container deletion for unowned/uncreated container.'
    )
    failedCases++
  }

  // Case 9: L0-R01 Fail-Closed Inventory on Failure
  console.log(
    '--- [CASE 9: L0-R01 Fail-Closed: Inventory Error Throws Instead of Returning Empty] ---'
  )
  let inventoryThrew = false
  try {
    await getExistingInventory(fakeEnv)
  } catch (err) {
    inventoryThrew = true
    console.log(`  Caught expected inventory error: ${err.message.split('\n')[0]}`)
  }
  if (inventoryThrew) {
    console.log('  PASS: getExistingInventory fails closed with error when docker command fails.\n')
  } else {
    console.error('  FAIL: getExistingInventory returned empty array instead of failing closed.')
    failedCases++
  }

  // Case 10: L0-R02 Health Timeout Budget Enforcement
  console.log('--- [CASE 10: L0-R02 Health Budget Deadline Rejection] ---')
  const shortTimeoutRun = await executeLabRun({
    healthTimeoutMs: 1000,
    pollIntervalMs: 200,
    healthDelayMs: 2000
  })
  if (!shortTimeoutRun.success && shortTimeoutRun.failedAtStep === 'HEALTH_CHECK') {
    console.log(
      `  PASS: Health check halted accurately when budget expired: ${shortTimeoutRun.error}\n`
    )
  } else {
    console.error('  FAIL: Health check did not enforce finite budget.')
    failedCases++
  }

  console.log('===============================================================')
  if (failedCases === 0) {
    console.log('   ALL L0 DOCKER LAB VERIFICATION GATES PASSED (10 / 10)       ')
    console.log('===============================================================')
    return 0
  } else {
    console.error(`   L0 SUITE FINISHED WITH ${failedCases} FAILED GATE(S)        `)
    console.log('===============================================================')
    return 1
  }
}

// Standalone execution entry
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const arg = process.argv[2] || '--suite'
  if (arg === '--suite') {
    runFullSuite().then((code) => process.exit(code))
  } else if (arg === '--env') {
    checkEnvironment().then((res) => {
      console.log(JSON.stringify(res, null, 2))
      process.exit(res.ok ? 0 : 1)
    })
  } else if (arg === '--happy') {
    executeLabRun({}).then((res) => {
      console.log(JSON.stringify(res, null, 2))
      process.exit(res.success ? 0 : 1)
    })
  } else {
    console.log(`Unknown option: ${arg}. Running full suite...`)
    runFullSuite().then((code) => process.exit(code))
  }
}
