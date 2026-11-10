import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { DesktopExposureInput, DesktopExposureResult } from '@shared/desktopControllerExposure'
import type { ProductExposureObservationInput } from '../../../../docs/contracts/product-exposure'
import type { ProductExposureView } from '../../../../docs/contracts/product-exposure'
import type { ProductControllerApiMeta } from '../../../../docs/contracts/product-controller-api'
import type { SshManager } from '../ssh/manager'
import { ControllerHttpClient, ControllerHttpClientError } from './controllerHttpClient'
import { DesktopControllerVault, DesktopControllerVaultError } from './desktopControllerVault'
import { canonicalH2Json, hashH2 } from './productH2Proof'
import { probeDesktopExposure } from './desktopExposureProbe'

const inputSchema = z.strictObject({
  binding_id: z.uuid(),
  app_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})
/** No local Product history, caller URL or background retry. */
export class DesktopExposure {
  constructor(
    private readonly vault: Pick<DesktopControllerVault, 'resolve' | 'get'>,
    private readonly ssh: Pick<SshManager, 'openControllerApiChannel'>,
    private readonly clientFactory?: (bindingId: string) => Pick<ControllerHttpClient, 'call'>,
    private readonly probe: typeof probeDesktopExposure = probeDesktopExposure
  ) {}

  async run(input: DesktopExposureInput, check: boolean): Promise<DesktopExposureResult> {
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) throw new DesktopControllerVaultError('REQUEST_INVALID')
    const { binding_id, app_id } = parsed.data,
      before = this.vault.resolve(binding_id),
      metadata = this.vault.get(binding_id)
    const assertBinding = (): void => {
      if (canonicalH2Json(before) !== canonicalH2Json(this.vault.resolve(binding_id)))
        throw new DesktopControllerVaultError('BINDING_CHANGED')
    }
    const result = (
      state: DesktopExposureResult['state'],
      view: DesktopExposureResult['view'],
      reason_code: string | null = null
    ): DesktopExposureResult => {
      assertBinding()
      return {
        binding_id,
        app_id,
        binding_revision: before.revision,
        controller_id: before.controllerId,
        state,
        view,
        reason_code,
        checked_at: new Date().toISOString()
      }
    }
    if (check && !metadata.client?.scopes.includes('policy:write'))
      return result('unavailable', null, 'SCOPE_REQUIRED')
    const client =
      this.clientFactory?.(binding_id) ??
      new ControllerHttpClient(this.ssh, () => this.vault.resolve(binding_id))
    const read = async (): Promise<ProductExposureView & ProductControllerApiMeta> => {
      const response = await client.call('exposure', { app_id })
      assertBinding()
      if (
        response.state !== 'response_received' ||
        response.response.controller_id !== before.controllerId ||
        response.response.app_id !== app_id
      )
        throw new ControllerHttpClientError('PROTOCOL_INVALID')
      return response.response
    }
    try {
      const current = await read()
      if (
        current.data_freshness !== 'current' ||
        Math.abs(Date.now() - Date.parse(current.sampled_at)) > 30_000
      )
        return result('unavailable', current, 'CONTEXT_STALE')
      if (!check) return result('read', current)
      if (
        !current.context ||
        current.data_freshness !== 'current' ||
        Math.abs(Date.now() - Date.parse(current.sampled_at)) > 30_000
      )
        return result('unavailable', current, current.unavailable_reason ?? 'CONTEXT_STALE')
      const context = current.context,
        observed = await this.probe(context.url)
      assertBinding() // User may remove/rebind VPS while the network probe is pending.
      const body: ProductExposureObservationInput = {
        deployment_id: context.deployment_id,
        authority_sha256: context.authority_sha256,
        previous_observation_id: context.previous_observation_id,
        observer: 'desktop_external',
        ...observed
      }
      const key = randomUUID(),
        bodyHash = hashH2(body)
      const matches = (view: DesktopExposureResult['view']): boolean => {
        const o = view?.observation
        return (
          !!o &&
          o.observation_id === key &&
          o.body_sha256 === bodyHash &&
          o.client_id === metadata.remote_client_id &&
          o.authority_sha256 === context.authority_sha256 &&
          o.deployment_id === context.deployment_id &&
          o.app_id === app_id &&
          o.url === context.url
        )
      }
      const saved = await client.call('observeExposure', { app_id, request_key: key, body })
      assertBinding()
      if (saved.state === 'response_received') {
        if (
          saved.response.controller_id !== before.controllerId ||
          saved.response.app_id !== app_id ||
          !matches(saved.response)
        )
          throw new ControllerHttpClientError('PROTOCOL_INVALID')
        return result('recorded', saved.response)
      }
      // A lost write response is not proof of failure. One read only; never resend POST.
      try {
        const latest = await read()
        if (matches(latest)) return result('recorded', latest)
      } catch {
        assertBinding()
      }
      return result('outcome_unknown', null, 'OBSERVATION_OUTCOME_UNKNOWN')
    } catch (error) {
      if (error instanceof ControllerHttpClientError && error.code === 'UNSUPPORTED')
        return result('unavailable', null, 'UNSUPPORTED')
      if (
        error instanceof ControllerHttpClientError &&
        ['EXPOSURE_CONTEXT_CHANGED', 'EXPOSURE_OBSERVATION_STALE', 'CAPABILITY_BLOCKED'].includes(
          error.code
        )
      )
        return result('unavailable', null, error.code)
      throw error
    }
  }
}
