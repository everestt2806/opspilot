import type {
  DomainIngressState,
  SharedIngressBindingDto,
  SharedIngressOperation,
  SharedIngressServiceReasonCode,
  SharedIngressStatus,
  SharedIngressStep,
  Vps
} from '@shared/ipc'

import type { AppRepository } from '../../db/appRepository'
import type { DeploymentRepository } from '../../db/deploymentRepository'
import type { VpsRepository } from '../../db/vpsRepository'
import type { SshHostIdentity, SshManager } from '../../ssh/manager'
import type {
  DomainRepository,
  SharedIngressBindingRow,
  SharedIngressInventoryBinding,
  SharedIngressInventorySnapshot
} from '../repository'
import { AppError } from '../../errors'
import {
  installCaddyFirstRunOverSsh,
  verifyCaddyInstallationOwnershipOverSsh,
  type CaddyInstallTransactionResult
} from './caddyInstallTransaction'
import { prepareCaddyInstallPlanOverSsh } from './caddyInstallPreparation'
import type { CaddyInstallPlan, CaddyInstallPlanResult } from './caddyInstallPlan'
import {
  reconcileCaddyConfigOverSsh,
  type CaddyReconcileAdapters,
  type CaddyReconcileResult
} from './caddyReconcile'
import {
  probeAndActivateSharedIngress,
  type HttpsActivationAdapters,
  type HttpsActivationFailure,
  type HttpsActivationResult
} from './externalHttpsActivation'
import { preflightSharedIngress, type IngressPreflightResult } from './preflight'
import type { CaddyCertificateEnvironment } from './routeBuilder'

export type SharedIngressServiceOperation = SharedIngressOperation
export type SharedIngressServiceStep = SharedIngressStep
export type SharedIngressServiceStatus = SharedIngressStatus
export type SharedIngressServiceReason = SharedIngressServiceReasonCode

export interface SharedIngressServiceResult {
  operation: SharedIngressServiceOperation
  status: SharedIngressServiceStatus
  failed_step: SharedIngressServiceStep | null
  reason: { code: SharedIngressServiceReason; message: string } | null
  retryable: boolean
  /** The app's existing HTTP URL from SQLite; HTTPS operations never rewrite it. */
  http_url: string | null
  route_status: DomainIngressState['route_status'] | null
  certificate_status: DomainIngressState['certificate_status'] | null
  https_probe_status: DomainIngressState['https_probe_status'] | null
  route_count?: number
}

export interface SharedIngressServicePolicy {
  /** Internal main-process policy. It is not accepted by any service operation. */
  certificateEnvironment: CaddyCertificateEnvironment
  /** Staging allowlist is application-owned and only used in an isolated lab. */
  stagingLabHostnames: readonly string[]
}

export interface SharedIngressServiceDependencies {
  vpsRepository: VpsRepository
  appRepository: AppRepository
  deploymentRepository: DeploymentRepository
  domainRepository: DomainRepository
  ssh: SshManager
  policy: SharedIngressServicePolicy
  /** Internal test seams; never populated from IPC, renderer input, or persisted evidence. */
  testAdapters?: SharedIngressServiceTestAdapters
}

interface SharedIngressServiceTestAdapters {
  identity?: (ssh: SshManager, vpsId: number) => Promise<SshHostIdentity>
  preflight?: (ssh: SshManager, vpsId: number) => Promise<IngressPreflightResult>
  verifyOwnership?: typeof verifyCaddyInstallationOwnershipOverSsh
  preparePlan?: (ssh: SshManager, target: SshHostIdentity) => Promise<CaddyInstallPlanResult>
  install?: (ssh: SshManager, plan: CaddyInstallPlan) => Promise<CaddyInstallTransactionResult>
  reconcile?: (
    ssh: SshManager,
    repository: DomainRepository,
    target: SshHostIdentity,
    environment: CaddyCertificateEnvironment,
    adapters?: CaddyReconcileAdapters
  ) => Promise<CaddyReconcileResult>
  activate?: (
    ssh: SshManager,
    repository: DomainRepository,
    target: SshHostIdentity,
    hostname: string,
    adapters?: HttpsActivationAdapters
  ) => Promise<HttpsActivationResult>
  reconcileAdapters?: CaddyReconcileAdapters
  activationAdapters?: HttpsActivationAdapters
}

interface ServiceContext {
  target: SshHostIdentity
  snapshot: SharedIngressInventorySnapshot
  binding: SharedIngressInventoryBinding
  httpUrl: string
  state: DomainIngressState
  deploymentInvalid: boolean
}

/**
 * Backend orchestration around the already-verified P1e transactions.
 * This facade deliberately does not acquire the VPS mutex itself: install,
 * reconcile, and activation each acquire the same mutex at their own boundary.
 */
export class SharedIngressService {
  private readonly policy: Readonly<SharedIngressServicePolicy>

  constructor(private readonly dependencies: SharedIngressServiceDependencies) {
    this.policy = Object.freeze({
      certificateEnvironment: dependencies.policy.certificateEnvironment,
      stagingLabHostnames: Object.freeze([...dependencies.policy.stagingLabHostnames])
    })
  }

  /** Lists persisted state without requiring DNS, SSH identity, or runtime readiness. */
  listBindings(vpsId: number, appId: number): SharedIngressBindingDto[] {
    if (!validId(vpsId) || !validId(appId)) {
      throw new AppError('VALIDATION', 'Cần chọn VPS và app hợp lệ.')
    }
    const vps = this.dependencies.vpsRepository.getById(vpsId)
    const app = this.dependencies.appRepository.getById(appId)
    if (app.vps_id !== vps.id) {
      throw new AppError('VALIDATION', 'App không thuộc VPS đã chọn.')
    }
    return this.dependencies.domainRepository
      .listSharedIngressBindingsForApp(vpsId, appId)
      .map((row) => toBindingDto(vpsId, row))
  }

  async readStatus(vpsId: number, bindingId: number): Promise<SharedIngressServiceResult> {
    if (!validId(vpsId) || !validId(bindingId)) {
      return bareResult('read', 'INVALID_IDENTIFIER', 'read', false)
    }
    let state: DomainIngressState | undefined
    let httpUrl: string
    try {
      const vps = this.dependencies.vpsRepository.getById(vpsId)
      state = this.dependencies.domainRepository.getSharedIngressBindingById(vpsId, bindingId)
      if (!state) return bareResult('read', 'BINDING_NOT_FOUND', 'read', false)
      const app = this.dependencies.appRepository.getById(state.app_id)
      if (app.id !== state.app_id || app.vps_id !== vps.id || app.current_deployment_id === null) {
        return result(
          { httpUrl: app.url, state },
          'read',
          'blocked',
          'read',
          'APP_OR_DEPLOYMENT_INVALID',
          false
        )
      }
      const deployment = this.dependencies.deploymentRepository.getById(app.current_deployment_id)
      if (
        deployment.app_id !== app.id ||
        deployment.status !== 'running' ||
        deployment.origin !== 'opspilot'
      ) {
        return result(
          { httpUrl: app.url, state },
          'read',
          'blocked',
          'read',
          'APP_OR_DEPLOYMENT_INVALID',
          false
        )
      }
      httpUrl = app.url
    } catch {
      return bareResult('read', 'VPS_NOT_AVAILABLE', 'read', false)
    }
    const status: SharedIngressServiceStatus =
      state.route_status === 'active'
        ? 'active'
        : state.route_status === 'degraded' ||
            state.dns_status === 'conflict' ||
            state.dns_status === 'failed'
          ? 'degraded'
          : state.route_status === 'pending' ||
              state.dns_status === 'pending' ||
              state.certificate_status === 'pending'
            ? 'pending'
            : 'ready'
    return result({ httpUrl, state }, 'read', status, null, null, false)
  }

  /** Prepare verified APT evidence and install once, only after a fresh host inspection. */
  async prepareOrInstall(vpsId: number, bindingId: number): Promise<SharedIngressServiceResult> {
    const loaded = this.loadReadyContext(vpsId, bindingId, 'install')
    if (!loaded.ok) return loaded.result
    const initial = loaded.context
    const identity = await this.verifyIdentity(initial, 'install')
    if (!identity.ok) return identity.result

    let ingress: IngressPreflightResult
    try {
      ingress = await (this.dependencies.testAdapters?.preflight ?? preflightSharedIngress)(
        this.dependencies.ssh,
        vpsId
      )
    } catch {
      return result(initial, 'install', 'blocked', 'preflight', 'HOST_CONFLICT', true)
    }
    const afterPreflight = this.reloadIfCurrent(initial, 'install', 'preflight')
    if (!afterPreflight.ok) return afterPreflight.result
    const identityAfterPreflight = await this.verifyIdentity(afterPreflight.context, 'install')
    if (!identityAfterPreflight.ok) return identityAfterPreflight.result

    if (ingress.service === 'verified') {
      const ownership = await (
        this.dependencies.testAdapters?.verifyOwnership ?? verifyCaddyInstallationOwnershipOverSsh
      )(this.dependencies.ssh, initial.target)
      if (ownership.status !== 'verified') {
        return result(initial, 'install', 'blocked', 'preflight', 'HOST_CONFLICT', true)
      }
      const afterOwnership = this.reloadIfCurrent(initial, 'install', 'preflight')
      if (!afterOwnership.ok) return afterOwnership.result
      const identityAfterOwnership = await this.verifyIdentity(afterOwnership.context, 'install')
      if (!identityAfterOwnership.ok) return identityAfterOwnership.result
      const current = this.reloadIfCurrent(afterOwnership.context, 'install', 'preflight')
      if (!current.ok) return current.result

      const managedActive =
        ingress.service_state === 'active' &&
        ingress.ownership === 'opspilot_owned' &&
        ingress.ports_status === 'occupied'
      const managedInactive =
        ingress.service_state === 'inactive' &&
        ingress.ownership === 'ports_free' &&
        ingress.ports_status === 'free' &&
        ingress.listeners.length === 0
      const managedEvidence =
        ingress.install_assessment === 'safe' &&
        ingress.local_assessment === 'clear' &&
        ingress.ownership_marker === 'valid' &&
        ingress.config_exists === true &&
        ingress.config_readable === true
      if (
        ownership.active === (ingress.service_state === 'active') &&
        managedEvidence &&
        (managedActive || managedInactive)
      ) {
        return result(current.context, 'install', 'installed', null, null, false)
      }
      return result(current.context, 'install', 'blocked', 'preflight', 'HOST_CONFLICT', true)
    }

    if (!isCleanHost(ingress)) {
      return result(initial, 'install', 'blocked', 'preflight', 'HOST_CONFLICT', true)
    }

    const planResult = await (
      this.dependencies.testAdapters?.preparePlan ?? prepareCaddyInstallPlanOverSsh
    )(this.dependencies.ssh, initial.target)
    if (planResult.status !== 'ready') {
      return result(initial, 'install', 'blocked', 'prepare', 'INSTALL_PLAN_BLOCKED', true)
    }
    const afterPrepare = this.reloadIfCurrent(initial, 'install', 'prepare')
    if (!afterPrepare.ok) return afterPrepare.result
    const identityBeforeWrite = await this.verifyIdentity(afterPrepare.context, 'install')
    if (!identityBeforeWrite.ok) return identityBeforeWrite.result

    let installed: CaddyInstallTransactionResult
    try {
      installed = await (this.dependencies.testAdapters?.install ?? installCaddyFirstRunOverSsh)(
        this.dependencies.ssh,
        planResult.plan
      )
    } catch {
      return result(
        afterPrepare.context,
        'install',
        'uncertain',
        'install',
        'INSTALL_UNCERTAIN',
        false
      )
    }
    if (installed.status === 'blocked') {
      const uncertain =
        installed.code === 'INSTALL_RECONCILIATION_REQUIRED' ||
        installed.code === 'INSTALL_ROLLBACK_FAILED'
      return result(
        afterPrepare.context,
        'install',
        uncertain ? 'uncertain' : 'blocked',
        'install',
        uncertain ? 'INSTALL_UNCERTAIN' : 'INSTALL_PLAN_BLOCKED',
        !uncertain
      )
    }
    const afterInstall = this.reloadIfCurrent(afterPrepare.context, 'install', 'install')
    if (!afterInstall.ok) {
      return result(
        afterPrepare.context,
        'install',
        'installed',
        'install',
        'INVENTORY_CHANGED',
        true
      )
    }
    return result(afterInstall.context, 'install', 'installed', null, null, false)
  }

  /** Reconciles every DB-owned shared-ingress route for this VPS in one P1e transaction. */
  async reconcile(vpsId: number, bindingId: number): Promise<SharedIngressServiceResult> {
    const loaded = this.loadReadyContext(vpsId, bindingId, 'reconcile')
    if (!loaded.ok) return loaded.result
    const initial = loaded.context
    if (this.policy.certificateEnvironment === 'acme_staging') {
      const allowlist = new Set(this.policy.stagingLabHostnames.map(normalizeHostname))
      if (
        initial.snapshot.bindings.some(
          (binding) => binding.enabled && !allowlist.has(normalizeHostname(binding.hostname))
        )
      ) {
        return result(initial, 'reconcile', 'blocked', 'preflight', 'STAGING_SCOPE_BLOCKED', false)
      }
    }
    const identity = await this.verifyIdentity(initial, 'reconcile')
    if (!identity.ok) return identity.result
    const current = this.reloadIfCurrent(initial, 'reconcile', 'preflight')
    if (!current.ok) return current.result

    let reconciled: CaddyReconcileResult
    try {
      reconciled = await (this.dependencies.testAdapters?.reconcile ?? reconcileCaddyConfigOverSsh)(
        this.dependencies.ssh,
        this.dependencies.domainRepository,
        current.context.target,
        this.policy.certificateEnvironment,
        this.dependencies.testAdapters?.reconcileAdapters
      )
    } catch {
      return result(
        current.context,
        'reconcile',
        'uncertain',
        'reconcile',
        'RECONCILE_UNCERTAIN',
        false
      )
    }
    if (reconciled.status === 'blocked') {
      const uncertain = ['RECONCILE_UNCERTAIN', 'RECONCILE_ROLLBACK_FAILED'].includes(
        reconciled.code
      )
      return result(
        current.context,
        'reconcile',
        uncertain ? 'uncertain' : 'blocked',
        'reconcile',
        uncertain ? 'RECONCILE_UNCERTAIN' : 'RECONCILE_BLOCKED',
        !uncertain
      )
    }
    const afterReconcile = this.reloadIfCurrent(current.context, 'reconcile', 'reconcile')
    if (!afterReconcile.ok) {
      return result(
        current.context,
        'reconcile',
        'pending',
        'reconcile',
        'INVENTORY_CHANGED',
        true,
        reconciled.route_count
      )
    }
    return result(
      afterReconcile.context,
      'reconcile',
      'reconciled_pending',
      null,
      null,
      true,
      reconciled.route_count
    )
  }

  /** Production-only external probe followed by the existing DB compare-and-set. */
  async checkHttps(vpsId: number, bindingId: number): Promise<SharedIngressServiceResult> {
    const loaded = this.loadReadyContext(vpsId, bindingId, 'https_check')
    if (!loaded.ok) return loaded.result
    const initial = loaded.context
    if (this.policy.certificateEnvironment !== 'production') {
      return result(
        initial,
        'https_check',
        'blocked',
        'https_probe',
        'STAGING_SCOPE_BLOCKED',
        false
      )
    }
    const identity = await this.verifyIdentity(initial, 'https_check')
    if (!identity.ok) return identity.result
    const current = this.reloadIfCurrent(initial, 'https_check', 'https_probe')
    if (!current.ok) return current.result

    let activation: HttpsActivationResult
    try {
      activation = await (
        this.dependencies.testAdapters?.activate ?? probeAndActivateSharedIngress
      )(
        this.dependencies.ssh,
        this.dependencies.domainRepository,
        current.context.target,
        current.context.binding.hostname,
        this.dependencies.testAdapters?.activationAdapters
      )
    } catch {
      return result(current.context, 'https_check', 'pending', 'https_probe', 'HTTPS_PENDING', true)
    }
    const afterProbe = this.reloadIfCurrent(current.context, 'https_check', 'https_probe')
    if (activation.status === 'active') {
      if (!afterProbe.ok || afterProbe.context.state.route_status !== 'active') {
        return result(
          current.context,
          'https_check',
          'pending',
          'https_probe',
          'STALE_RESULT',
          true
        )
      }
      return result(afterProbe.context, 'https_check', 'active', null, null, false)
    }
    if (!afterProbe.ok) return afterProbe.result
    const failed = activation.status === 'degraded'
    return result(
      afterProbe.context,
      'https_check',
      failed ? 'degraded' : 'pending',
      'https_probe',
      mapActivationReason(activation.reason),
      true
    )
  }

  private loadReadyContext(
    vpsId: number,
    bindingId: number,
    operation: Exclude<SharedIngressServiceOperation, 'read'>
  ): { ok: true; context: ServiceContext } | { ok: false; result: SharedIngressServiceResult } {
    const loaded = this.loadContext(vpsId, bindingId)
    if (!loaded.ok) return { ok: false, result: loaded.result(operation) }
    const { context } = loaded
    if (!context.binding.enabled) {
      return {
        ok: false,
        result: result(context, operation, 'blocked', stepFor(operation), 'BINDING_DISABLED', false)
      }
    }
    if (
      context.binding.current_deployment_id === null ||
      context.binding.host_port === null ||
      !context.binding.healthcheck_path ||
      context.binding.healthcheck_response_type === null ||
      context.deploymentInvalid
    ) {
      return {
        ok: false,
        result: result(
          context,
          operation,
          'blocked',
          stepFor(operation),
          'APP_OR_DEPLOYMENT_INVALID',
          false
        )
      }
    }
    return { ok: true, context }
  }

  private loadContext(
    vpsId: number,
    bindingId: number
  ):
    | { ok: true; context: ServiceContext }
    | {
        ok: false
        result: (operation: SharedIngressServiceOperation) => SharedIngressServiceResult
      } {
    if (!validId(vpsId) || !validId(bindingId)) {
      return {
        ok: false,
        result: (operation) => bareResult(operation, 'INVALID_IDENTIFIER', 'read', false)
      }
    }
    let vps: Vps
    try {
      vps = this.dependencies.vpsRepository.getById(vpsId)
    } catch {
      return {
        ok: false,
        result: (operation) => bareResult(operation, 'VPS_NOT_AVAILABLE', 'read', false)
      }
    }
    let snapshot: SharedIngressInventorySnapshot
    try {
      snapshot = this.dependencies.domainRepository.getSharedIngressInventory(vpsId)
    } catch {
      return {
        ok: false,
        result: (operation) => bareResult(operation, 'INVENTORY_NOT_READY', 'preflight', true)
      }
    }
    try {
      if (
        snapshot.vps_id !== vps.id ||
        snapshot.host !== vps.host ||
        snapshot.port !== vps.port ||
        snapshot.host_fingerprint !== vps.host_fingerprint
      ) {
        return {
          ok: false,
          result: (operation) => bareResult(operation, 'VPS_NOT_AVAILABLE', 'read', false)
        }
      }
      const binding = snapshot.bindings.find((entry) => entry.id === bindingId)
      if (!binding)
        return {
          ok: false,
          result: (operation) => bareResult(operation, 'BINDING_NOT_FOUND', 'read', false)
        }
      const app = this.dependencies.appRepository.getById(binding.app_id)
      if (app.vps_id !== vpsId || app.id !== binding.app_id) {
        return {
          ok: false,
          result: (operation) => bareResult(operation, 'APP_OR_DEPLOYMENT_INVALID', 'read', false)
        }
      }
      let deploymentInvalid = false
      if (app.current_deployment_id !== null) {
        try {
          const deployment = this.dependencies.deploymentRepository.getById(
            app.current_deployment_id
          )
          deploymentInvalid =
            deployment.app_id !== app.id ||
            deployment.status !== 'running' ||
            deployment.origin !== 'opspilot' ||
            binding.current_deployment_id !== deployment.id ||
            binding.deployment_version !== deployment.version ||
            binding.image_tag !== deployment.image_tag
        } catch {
          deploymentInvalid = true
        }
      } else if (binding.enabled) {
        deploymentInvalid = true
      }
      const state = this.dependencies.domainRepository.getByHostname(binding.hostname)
      if (
        !state ||
        state.id !== binding.id ||
        state.app_id !== app.id ||
        state.mode !== 'shared_ingress'
      ) {
        return {
          ok: false,
          result: (operation) => bareResult(operation, 'BINDING_NOT_FOUND', 'read', false)
        }
      }
      const target =
        snapshot.host_fingerprint === null
          ? null
          : {
              vpsId: snapshot.vps_id,
              host: snapshot.host,
              port: snapshot.port,
              hostFingerprint: snapshot.host_fingerprint
            }
      const httpUrl = app.url
      return {
        ok: true,
        context: {
          target: target ?? {
            vpsId,
            host: snapshot.host,
            port: snapshot.port,
            hostFingerprint: ''
          },
          snapshot,
          binding,
          httpUrl,
          state,
          deploymentInvalid
        }
      }
    } catch {
      return {
        ok: false,
        result: (operation) => bareResult(operation, 'VPS_NOT_AVAILABLE', 'read', false)
      }
    }
  }

  private async verifyIdentity(
    context: ServiceContext,
    operation: Exclude<SharedIngressServiceOperation, 'read'>
  ): Promise<{ ok: true } | { ok: false; result: SharedIngressServiceResult }> {
    if (!context.target?.hostFingerprint) {
      return {
        ok: false,
        result: result(
          context,
          operation,
          'blocked',
          stepFor(operation),
          'SSH_IDENTITY_UNVERIFIED',
          false
        )
      }
    }
    try {
      const observed = await (
        this.dependencies.testAdapters?.identity ?? ((ssh, id) => ssh.getHostIdentity(id))
      )(this.dependencies.ssh, context.target.vpsId)
      if (!sameIdentity(context.target, observed)) {
        return {
          ok: false,
          result: result(
            context,
            operation,
            'blocked',
            stepFor(operation),
            'IDENTITY_CHANGED',
            true
          )
        }
      }
      return { ok: true }
    } catch {
      return {
        ok: false,
        result: result(
          context,
          operation,
          'blocked',
          stepFor(operation),
          'SSH_IDENTITY_UNVERIFIED',
          true
        )
      }
    }
  }

  private reloadIfCurrent(
    expected: ServiceContext,
    operation: SharedIngressServiceOperation,
    step: SharedIngressServiceStep
  ): { ok: true; context: ServiceContext } | { ok: false; result: SharedIngressServiceResult } {
    const latest = this.loadContext(expected.target.vpsId, expected.binding.id)
    if (!latest.ok) return { ok: false, result: latest.result(operation) }
    if (
      latest.context.snapshot.revision !== expected.snapshot.revision ||
      latest.context.binding.desired_generation !== expected.binding.desired_generation ||
      latest.context.binding.current_deployment_id !== expected.binding.current_deployment_id ||
      !sameIdentity(latest.context.target, expected.target)
    ) {
      return {
        ok: false,
        result: result(expected, operation, 'pending', step, 'INVENTORY_CHANGED', true)
      }
    }
    return latest
  }
}

function isCleanHost(ingress: IngressPreflightResult): boolean {
  return (
    ingress.install_assessment === 'safe' &&
    ingress.service === 'absent' &&
    ingress.local_assessment === 'clear' &&
    ingress.ownership === 'ports_free' &&
    ingress.ports_status === 'free' &&
    ingress.listeners.length === 0 &&
    ingress.ufw.state !== 'unknown'
  )
}

function result(
  context:
    | Pick<ServiceContext, 'httpUrl' | 'state'>
    | { httpUrl: string | null; state?: DomainIngressState },
  operation: SharedIngressServiceOperation,
  status: SharedIngressServiceStatus,
  failedStep: SharedIngressServiceStep | null,
  reasonCode: SharedIngressServiceReason | null,
  retryable: boolean,
  routeCount?: number
): SharedIngressServiceResult {
  const entry: SharedIngressServiceResult = {
    operation,
    status,
    failed_step: failedStep,
    reason: reasonCode ? { code: reasonCode, message: reasonMessage(reasonCode) } : null,
    retryable,
    http_url: context.httpUrl,
    route_status: context.state?.route_status ?? null,
    certificate_status: context.state?.certificate_status ?? null,
    https_probe_status: context.state?.https_probe_status ?? null
  }
  if (routeCount !== undefined) entry.route_count = routeCount
  return entry
}

function bareResult(
  operation: SharedIngressServiceOperation,
  reasonCode: SharedIngressServiceReason,
  step: SharedIngressServiceStep,
  retryable: boolean
): SharedIngressServiceResult {
  return result({ httpUrl: null }, operation, 'blocked', step, reasonCode, retryable)
}

function stepFor(
  operation: Exclude<SharedIngressServiceOperation, 'read'>
): SharedIngressServiceStep {
  return operation === 'install'
    ? 'preflight'
    : operation === 'reconcile'
      ? 'reconcile'
      : 'https_probe'
}

function mapActivationReason(reason: HttpsActivationFailure): SharedIngressServiceReason {
  const mapping: Record<HttpsActivationFailure, SharedIngressServiceReason> = {
    binding_not_found: 'BINDING_NOT_FOUND',
    staging_not_eligible: 'HTTPS_STAGING_NOT_ELIGIBLE',
    dns_not_propagated: 'HTTPS_DNS_NOT_PROPAGATED',
    runtime_not_verified: 'HTTPS_RUNTIME_NOT_VERIFIED',
    host_identity_changed: 'IDENTITY_CHANGED',
    remote_generation_changed: 'HTTPS_REMOTE_GENERATION_CHANGED',
    probe_failed: 'HTTPS_PROBE_FAILED',
    stale_result: 'STALE_RESULT',
    activation_write_failed: 'HTTPS_ACTIVATION_WRITE_FAILED'
  }
  return mapping[reason]
}

function reasonMessage(code: SharedIngressServiceReason): string {
  const messages: Record<SharedIngressServiceReason, string> = {
    INVALID_IDENTIFIER: 'VPS or binding identity is invalid.',
    VPS_NOT_AVAILABLE: 'The VPS is unavailable, missing, or archived.',
    BINDING_NOT_FOUND: 'The shared-ingress binding does not belong to this VPS.',
    APP_OR_DEPLOYMENT_INVALID: 'The app or current deployment is not eligible for shared ingress.',
    INVENTORY_NOT_READY:
      'The VPS route inventory is not eligible; verify DNS, app/deployment and route ownership before retrying.',
    BINDING_DISABLED: 'The selected shared-ingress binding is disabled.',
    SSH_IDENTITY_UNVERIFIED: 'The pinned SSH identity is not available for this VPS.',
    IDENTITY_CHANGED: 'The observed SSH host no longer matches the identity saved in SQLite.',
    INVENTORY_CHANGED: 'The app/deployment or route inventory changed during the operation.',
    HOST_CONFLICT: 'The host is not a verified clean host or OpsPilot-owned ingress.',
    INSTALL_PLAN_BLOCKED: 'Verified Caddy installation preparation did not complete.',
    INSTALL_UNCERTAIN:
      'Installation outcome is uncertain; inspect current ownership before retrying.',
    RECONCILE_BLOCKED: 'Ingress reconcile is blocked by a precondition or ownership conflict.',
    RECONCILE_UNCERTAIN:
      'Reconcile outcome is uncertain; inspect the current generation before retrying.',
    STAGING_SCOPE_BLOCKED: 'ACME staging is restricted to the internal lab hostname allowlist.',
    HTTPS_PENDING:
      'HTTPS activation is waiting for current DNS, runtime, certificate, or probe evidence.',
    HTTPS_DNS_NOT_PROPAGATED: 'Public DNS is not consistently verified for this VPS.',
    HTTPS_RUNTIME_NOT_VERIFIED: 'The current OpsPilot Caddy runtime could not be verified.',
    HTTPS_REMOTE_GENERATION_CHANGED: 'The remote Caddy generation changed before HTTPS activation.',
    HTTPS_STAGING_NOT_ELIGIBLE: 'Staging evidence cannot activate a production hostname.',
    HTTPS_PROBE_FAILED: 'The external HTTPS probe failed; the existing HTTP app URL is unchanged.',
    HTTPS_ACTIVATION_WRITE_FAILED:
      'HTTPS evidence could not be committed for the current binding generation.',
    STALE_RESULT: 'The HTTPS result is stale and was not accepted.',
    INTERNAL_ERROR: 'The shared-ingress operation could not be completed.'
  }
  return messages[code]
}

function validId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function sameIdentity(left: SshHostIdentity, right: SshHostIdentity): boolean {
  return (
    left.vpsId === right.vpsId &&
    left.host === right.host &&
    left.port === right.port &&
    left.hostFingerprint === right.hostFingerprint
  )
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/\.$/, '').toLowerCase()
}

function toBindingDto(vpsId: number, row: SharedIngressBindingRow): SharedIngressBindingDto {
  const status: SharedIngressServiceStatus =
    row.route_status === 'active'
      ? 'active'
      : row.route_status === 'degraded' ||
          row.route_status === 'conflict' ||
          row.route_status === 'failed' ||
          row.dns_status === 'conflict' ||
          row.dns_status === 'failed'
        ? 'degraded'
        : row.route_status === 'pending' ||
            row.dns_status === 'pending' ||
            row.certificate_status === 'pending'
          ? 'pending'
          : 'ready'
  return {
    vps_id: vpsId,
    binding_id: row.id,
    app_id: row.app_id,
    hostname: row.hostname,
    operation: 'read',
    status,
    failed_step: row.ingress_reason_code ? 'read' : null,
    reason: row.ingress_reason_code
      ? {
          code: row.ingress_reason_code,
          message: `Ingress state requires attention (${row.ingress_reason_code}).`
        }
      : null,
    retryable: status === 'pending' || status === 'degraded',
    http_url: row.http_url,
    dns_status: row.dns_status,
    route_status: row.route_status,
    certificate_status: row.certificate_status,
    https_probe_status: row.https_probe_status
  }
}
