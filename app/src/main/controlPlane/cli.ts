import type Database from 'better-sqlite3'

import { ProductDeployRepository } from '../db/productDeployRepository'
import { canonicalizeGitHubUrl, validateRef } from '../git/snapshot'
import {
  getControllerDatabasePath,
  initializeController,
  openControllerDatabase
} from './controllerDatabase'
import { ControllerService } from './controllerService'
import { ControlPlaneGitPoller } from './gitPoller'
import { enrollControllerVps, initializeControllerSecrets } from './controllerEnrollment'
import { readControllerBootstrapInput } from './controllerBootstrapInput'
import { verifyControllerBundle } from './controllerBundle'

type Command = 'init' | 'run' | 'poll-once' | 'status' | 'secrets-init' | 'enroll-vps'

export async function runControlPlaneCli(argv = process.argv.slice(2)): Promise<void> {
  const [commandValue, ...args] = argv
  if (commandValue === 'verify-bundle') {
    if (args.length !== 4 || args[0] !== '--artifact' || args[2] !== '--manifest-sha256')
      throw new Error('USAGE')
    console.log(JSON.stringify(verifyControllerBundle(args[1], args[3])))
    return
  }
  if (
    !['init', 'run', 'poll-once', 'status', 'secrets-init', 'enroll-vps'].includes(commandValue)
  ) {
    throw new Error('USAGE')
  }
  const command = commandValue as Command
  const dataDirectory = parseDataDirectory(args)

  if (command === 'init') {
    const initialized = initializeController(dataDirectory)
    console.log(JSON.stringify({ state: 'initialized', controller_id: initialized.controllerId }))
    return
  }

  if (command === 'secrets-init' || command === 'enroll-vps') {
    if (process.platform !== 'linux') throw new Error('CONTROLLER_BOOTSTRAP_REQUIRES_LINUX')
    const controller = new AbortController()
    const onSignal = (): void => controller.abort()
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    let opened: ReturnType<typeof openControllerDatabase> | undefined
    try {
      const input =
        command === 'enroll-vps'
          ? await readControllerBootstrapInput(process.stdin, controller.signal)
          : undefined
      if (controller.signal.aborted) throw new Error('CONTROLLER_VPS_ENROLLMENT_ABORTED')
      opened = openControllerDatabase(dataDirectory)
      if (command === 'secrets-init') {
        initializeControllerSecrets(opened.database, opened.controllerId, opened.dataDirectory)
        console.log(
          JSON.stringify({ state: 'secrets_initialized', controller_id: opened.controllerId })
        )
      } else {
        const result = await enrollControllerVps(
          opened.database,
          opened.controllerId,
          opened.dataDirectory,
          input,
          controller.signal
        )
        console.log(JSON.stringify(result))
      }
    } finally {
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
      opened?.database.close()
    }
    return
  }

  if (command === 'status') {
    const opened = openControllerDatabase(dataDirectory)
    try {
      console.log(
        JSON.stringify(readLocalStatus(opened.database, opened.controllerId, dataDirectory))
      )
    } finally {
      opened.database.close()
    }
    return
  }

  if (command === 'poll-once') {
    const opened = openControllerDatabase(dataDirectory)
    const controller = new AbortController()
    const onSignal = (): void => controller.abort()
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    try {
      const poller = new ControlPlaneGitPoller({
        repository: new ProductDeployRepository(opened.database),
        controllerId: opened.controllerId
      })
      const result = await poller.pollOnce(controller.signal)
      console.log(JSON.stringify(result))
    } finally {
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
      controller.abort()
      opened.database.close()
    }
    return
  }

  const service = new ControllerService({ dataDirectory })
  const onSignal = (): void => {
    service.requestStop()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    await service.start()
    await service.waitForStop()
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    await service.close()
  }
}

function parseDataDirectory(args: string[]): string {
  if (args.length !== 2 || args[0] !== '--data-dir' || !args[1]) throw new Error('USAGE')
  return args[1]
}

function readLocalStatus(
  database: Database.Database,
  controllerId: string,
  dataDirectory: string
): object {
  const repository = new ProductDeployRepository(database)
  const pollTargets = repository.listGitPollTargets(controllerId)
  const invalidGitConfigCount = pollTargets.filter((target) => {
    try {
      canonicalizeGitHubUrl(target.repositoryUrl)
      validateRef(target.ref)
      return target.ref.startsWith('refs/')
    } catch {
      return true
    }
  }).length
  const desired = database
    .prepare(
      `SELECT d.app_id, d.ref, d.desired_observation_sequence AS observation_sequence,
              d.desired_sha, d.reconciliation_state AS state
       FROM product_desired_branch d
       JOIN product_app_control owner ON owner.app_id=d.app_id
         AND owner.mode='product' AND owner.controller_id=?
         AND owner.source_generation=d.source_generation
       ORDER BY d.app_id, d.ref`
    )
    .all(controllerId)
  const observations = database
    .prepare(
      `SELECT o.app_id, o.ref, o.observation_sequence, o.observed_sha, o.observed_at
       FROM product_branch_observation o
       JOIN product_app_control owner ON owner.app_id=o.app_id
         AND owner.mode='product' AND owner.controller_id=?
         AND owner.source_generation=o.source_generation
       ORDER BY o.app_id, o.ref, o.observation_sequence`
    )
    .all(controllerId)
  const jobs = database
    .prepare(
      `SELECT state, COUNT(*) AS count FROM product_deploy_job WHERE controller_id=?
       GROUP BY state ORDER BY state`
    )
    .all(controllerId)
  return {
    controller_id: controllerId,
    database_path: getControllerDatabasePath(dataDirectory),
    product_git_sources: pollTargets.length,
    invalid_product_git_sources:
      repository.countInvalidGitPollTargets(controllerId) + invalidGitConfigCount,
    observations,
    desired,
    jobs
  }
}

async function main(): Promise<void> {
  await runControlPlaneCli()
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : ''
    const safeCode = /^[A-Z][A-Z0-9_]{1,80}$/.test(message) ? message : 'CONTROLLER_INTERNAL_ERROR'
    console.error(`CONTROL_PLANE_ERROR ${safeCode}`)
    process.exitCode = 1
  })
}
