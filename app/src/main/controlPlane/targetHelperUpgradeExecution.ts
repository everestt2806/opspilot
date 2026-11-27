import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type {
  ProductTargetHelperUpgradeCommand,
  ProductTargetHelperUpgradePacket,
  ProductTargetHelperUpgradePreparation
} from '../../../../docs/contracts/product-target-helper-upgrade'
import { canonicalH2Json } from './productH2Proof'
import { loadControllerRuntimeKey } from './controllerRuntimeKeys'
import { createControllerSshResolver } from './controllerSshResolver'
import { SshManager } from '../ssh/manager'
import { exchangeProductBootstrapJson } from './targetEnrollment'
import { readVerifiedControllerBundleFile } from './controllerBundle'
import { verifyTargetHelperUpgradeBundle } from './targetHelperUpgradeBundle'
import { verifyTargetHelperUpgradeOutcome } from './targetHelperUpgradeOutcome'
import {
  finalizeTargetHelperUpgrade,
  loadTargetHelperUpgradeIntent,
  publishTargetHelperUpgradeMaterial,
  readTargetHelperUpgradeMaterial,
  readTargetHelperUpgradeOutcome,
  readTargetHelperUpgradePendingState,
  readTargetHelperUpgradePreparation,
  syncTargetHelperUpgradeJournal,
  targetHelperUpgradeExpected,
  targetHelperUpgradeLookupSchema
} from './targetHelperUpgradeJournal'

const dispatchSchema = z.strictObject({ mode: z.enum(['upgrade', 'cancel']) })
const executeSchema = targetHelperUpgradeLookupSchema.extend({ confirm: z.literal(true) })
const identityOf = (
  value: z.infer<typeof targetHelperUpgradeLookupSchema>
): z.infer<typeof targetHelperUpgradeLookupSchema> => ({
  format: 1,
  controller_id: value.controller_id,
  app_id: value.app_id,
  ownership_generation: value.ownership_generation,
  request_key: value.request_key
})
/** Unix admin, original UUID/intent only. Every ambiguous retry is inspect-only. */
export async function executeTargetHelperUpgrade(
  database: Database.Database,
  directory: string,
  controllerId: string,
  administrator: string,
  command: ProductTargetHelperUpgradeCommand,
  input: unknown,
  signal?: AbortSignal
): Promise<
  ProductTargetHelperUpgradePreparation & {
    safe_error_code?:
      'TARGET_HELPER_UPGRADE_REMOTE_UNKNOWN' | 'TARGET_HELPER_UPGRADE_FINALIZATION_PENDING'
  }
> {
  const parsed = (
    command === 'inspect-target-helper-upgrade' ? targetHelperUpgradeLookupSchema : executeSchema
  ).safeParse(input)
  if (
    !parsed.success ||
    parsed.data.controller_id !== controllerId ||
    !/^unix:(0|[1-9][0-9]{0,15})$/.test(administrator)
  )
    throw Error('TARGET_HELPER_UPGRADE_INPUT_INVALID')
  if (database.inTransaction) throw Error('TARGET_HELPER_UPGRADE_TRANSACTION_ACTIVE')
  if (signal?.aborted) throw Error('TARGET_HELPER_UPGRADE_ABORTED')
  const identity = identityOf(parsed.data),
    key = loadControllerRuntimeKey(directory, identity)
  let ssh: SshManager | undefined
  let dispatched = false
  let outcomeObserved = false
  try {
    const intent = loadTargetHelperUpgradeIntent(directory, identity, administrator, key)
    const current = readTargetHelperUpgradePreparation(
      database,
      directory,
      controllerId,
      administrator,
      identity
    )
    const stored = readTargetHelperUpgradeOutcome(directory, intent, key)
    if (stored) {
      outcomeObserved = true
      dispatched = true
    }
    if (current.state === 'applied' || current.state === 'not_applied')
      return stored ? finalizeTargetHelperUpgrade(database, directory, intent, key) : current
    if (current.state !== 'pending') throw Error('TARGET_HELPER_UPGRADE_NOT_PENDING')
    if (stored) {
      outcomeObserved = true
      return finalizeTargetHelperUpgrade(database, directory, intent, key)
    }
    const { bundle, script } = verifyTargetHelperUpgradeBundle(
      intent.request.artifact,
      intent.request.manifest_sha256
    )
    const expected = targetHelperUpgradeExpected(intent)
    const assertPending = (): void => {
      if (
        database
          .transaction(() => readTargetHelperUpgradePendingState(database, intent))
          .immediate() !== 'pending'
      )
        throw Error('TARGET_HELPER_UPGRADE_AUTHORITY_CHANGED')
    }
    assertPending()
    let dispatch = readTargetHelperUpgradeMaterial(directory, intent, key, 'dispatch')
    let first = false
    if (command === 'apply-target-helper-upgrade' || command === 'cancel-target-helper-upgrade') {
      const publication = publishTargetHelperUpgradeMaterial(directory, intent, key, 'dispatch', {
        mode: command === 'cancel-target-helper-upgrade' ? 'cancel' : 'upgrade'
      })
      first = publication.created
      dispatch = publication.record
    }
    const mode = dispatch === undefined ? undefined : dispatchSchema.parse(dispatch).mode
    let operation: ProductTargetHelperUpgradePacket['operation'] = 'inspect-upgrade'
    if (command === 'cancel-target-helper-upgrade') operation = 'cancel-upgrade'
    else if (command === 'recover-target-helper-upgrade' && mode)
      operation = mode === 'cancel' ? 'cancel-upgrade' : 'recover-upgrade'
    else if (command === 'apply-target-helper-upgrade' && first && mode === 'upgrade')
      operation = 'upgrade'
    // Material exists before any channel creation. A lost reply can never cause an automatic new upgrade.
    dispatched = mode !== undefined
    if (operation !== 'inspect-upgrade') syncTargetHelperUpgradeJournal(directory, identity)
    assertPending()
    const helpers = Object.fromEntries(
      [
        'target_execution_guard.py',
        'target_guarded_ssh_helper.py',
        'target_product_runtime.py'
      ].map((name) => [
        name,
        readVerifiedControllerBundleFile(bundle, 'target-helper/' + name).toString('base64')
      ])
    )
    const packet: ProductTargetHelperUpgradePacket = {
      format: 1,
      operation,
      request_key: identity.request_key,
      review_sha256: intent.review.review_sha256,
      framework: (
        database.prepare('SELECT framework FROM app WHERE id=?').get(identity.app_id) as {
          framework: ProductTargetHelperUpgradePacket['framework']
        }
      ).framework,
      key: key.toString('base64'),
      from: { payload: expected.from, manifest: intent.request.retained_manifest },
      to: {
        payload: expected.to,
        manifest: readVerifiedControllerBundleFile(bundle, 'bundle-manifest.json').toString('utf8'),
        helpers
      }
    }
    const body = JSON.stringify(packet)
    if (Buffer.byteLength(body) > 2 * 1024 * 1024)
      throw Error('TARGET_HELPER_UPGRADE_INPUT_INVALID')
    const target = expected.from.target
    const resolver = createControllerSshResolver(database, controllerId, directory)
    ssh = new SshManager((vpsId) => {
      assertPending()
      return resolver(vpsId)
    })
    const opened = await ssh.openProductBootstrapChannel(
      target.vps_id,
      { text: script, sha256: createHash('sha256').update(script).digest('hex') },
      {
        signal,
        timeoutMs: 20_000,
        expectedIdentity: {
          vpsId: target.vps_id,
          host: target.host,
          port: target.port,
          username: target.username,
          authType: target.auth_type,
          hostFingerprint: target.host_fingerprint
        }
      }
    )
    try {
      assertPending()
      const actual = opened.identity
      if (
        actual.vpsId !== target.vps_id ||
        actual.host !== target.host ||
        actual.port !== target.port ||
        actual.username !== target.username ||
        actual.authType !== target.auth_type ||
        actual.hostFingerprint !== target.host_fingerprint
      )
        throw Error('TARGET_HELPER_UPGRADE_AUTHORITY_CHANGED')
      const response = await exchangeProductBootstrapJson(opened.channel, body, signal)
      if (!verifyTargetHelperUpgradeOutcome(expected, response, key))
        throw Error('TARGET_HELPER_UPGRADE_REMOTE_UNKNOWN')
      assertPending()
      if (!response.receipt.payload.settled || response.state === 'pending') return current
      const publication = publishTargetHelperUpgradeMaterial(
        directory,
        intent,
        key,
        'outcome',
        response
      )
      const winner = publication.record
      if (
        !verifyTargetHelperUpgradeOutcome(expected, winner, key) ||
        !winner.receipt.payload.settled ||
        winner.state !== response.state ||
        canonicalH2Json(winner.proof) !== canonicalH2Json(response.proof)
      )
        throw Error('TARGET_HELPER_UPGRADE_OUTCOME_CONFLICT')
      outcomeObserved = true
      return finalizeTargetHelperUpgrade(database, directory, intent, key)
    } finally {
      opened.channel.destroy()
    }
  } catch (error) {
    if (
      !dispatched &&
      error instanceof Error &&
      /^TARGET_HELPER_UPGRADE_[A-Z_]+$/.test(error.message)
    )
      throw error
    if (dispatched) {
      try {
        const state = readTargetHelperUpgradePreparation(
          database,
          directory,
          controllerId,
          administrator,
          identity
        )
        if (state.state === 'applied' || state.state === 'not_applied') return state
        return {
          ...state,
          safe_error_code: outcomeObserved
            ? 'TARGET_HELPER_UPGRADE_FINALIZATION_PENDING'
            : 'TARGET_HELPER_UPGRADE_REMOTE_UNKNOWN'
        }
      } catch {
        /* preserve original SQL barrier/material; no repair or adopted authority */
      }
    }
    if (
      error instanceof Error &&
      /^TARGET_HELPER_UPGRADE_(AUTHORITY_CHANGED|JOURNAL_INVALID|OUTCOME_CONFLICT)$/.test(
        error.message
      )
    )
      throw error
    throw Error('TARGET_HELPER_UPGRADE_REMOTE_UNKNOWN')
  } finally {
    key.fill(0)
    await ssh?.disconnectAll()
  }
}
