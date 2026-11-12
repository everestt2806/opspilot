import { DesktopTargetSetups, DesktopTargetSetupError } from './desktopTargetSetup'
import { DesktopExposure } from './desktopExposure'
import type { DesktopExposureInput, DesktopExposureResult } from '@shared/desktopControllerExposure'
import type {
  DesktopTargetPrepareInput,
  DesktopTargetSendInput,
  DesktopTargetSetup
} from '@shared/desktopTargetRegistration'
import { DesktopFirstDeployments, DesktopFirstDeploymentError } from './desktopFirstDeployment'
import type {
  DesktopFirstDeploymentInput,
  DesktopFirstDeploymentPlan,
  DesktopFirstDeploymentSendInput,
  DesktopProjectReadiness
} from '@shared/desktopFirstDeployment'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { ControllerInstallerResources } from './controllerInstallerCatalog'
import type {
  ControllerInstallerOverview,
  ControllerInstallerReview,
  ControllerInstallerSendInput,
  ControllerInstalledPrepareInput
} from '@shared/controllerInstaller'
import type {
  DesktopControllerRegisterInput,
  DesktopControllerConnection,
  DesktopControllerSnapshot,
  DesktopControllerPageInput,
  DesktopControllerAppStatus
} from '@shared/desktopController'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type { SshManager } from '../ssh/manager'
import { AppError } from '../errors'
import { DesktopControllerVault, DesktopControllerVaultError } from './desktopControllerVault'
import {
  DesktopControllerEnrollment,
  DesktopControllerEnrollmentError
} from './desktopControllerEnrollment'
import { ControllerHttpClient, ControllerHttpClientError } from './controllerHttpClient'
import {
  DesktopControllerCommands,
  DesktopControllerCommandError
} from './desktopControllerCommands'
import type {
  DesktopControllerCommand,
  DesktopControllerCommandInput
} from '@shared/desktopControllerCommands'
import type {
  DesktopProjectSetupInput,
  DesktopProjectSetup,
  DesktopProjectTargets,
  DesktopProjectSourceVerification,
  DesktopProjectTargetInput,
  DesktopProjectTargetState
} from '@shared/desktopProjectRegistration'
import { DesktopProjectSetups, DesktopProjectSetupError } from './desktopProjectSetup'
import { ProjectRegistrationError } from './projectRegistration'
import {
  DesktopControllerInstallations,
  DesktopInstallationError
} from './desktopControllerInstallation'
import { ControllerBootstrapError } from './controllerSshBootstrap'
import { DesktopControllerUpgrades, DesktopUpgradeError } from './desktopControllerUpgrade'
import type { DesktopUpgradeOptions } from './desktopControllerUpgrade'
import type { DesktopInstallationOptions } from './desktopControllerInstallation'
import type { ProductDesktopControllerBindingIntent } from '../../../../docs/contracts/product-controller-api'
import { canonicalH2Json } from './productH2Proof'
import type {
  ControllerUpgradeOverview,
  ControllerUpgradeReviewInput,
  ControllerUpgradeSendInput,
  ControllerUpgradeBindingReview,
  ControllerUpgradeReview
} from '@shared/controllerUpgrade'
import type {
  DesktopControllerRelease,
  DesktopInstallation,
  DesktopInstallationPlan,
  DesktopInstallationOperation
} from '../../../../docs/contracts/desktop-controller-installation'

const registerSchema = z.strictObject({
  binding_id: z.uuid(),
  controller_id: z.string().min(1).max(128),
  vps_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  artifact_path: z.string().max(512),
  data_directory: z.string().max(512),
  node_path: z.string().max(512),
  manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  display_name: z.string().min(1).max(128),
  allow_write: z.boolean().optional()
})
const installedRegisterSchema = z.strictObject({
  installation_request_key: z.uuidv4(),
  binding_id: z.uuidv4(),
  display_name: z.string().min(1).max(128),
  allow_write: z.boolean().optional()
})
const pageSchema = z.strictObject({
  binding_id: z.uuid(),
  cursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional()
})
export class DesktopControllerService {
  private readonly vault: DesktopControllerVault
  private readonly enrollment: DesktopControllerEnrollment
  private readonly commands: DesktopControllerCommands
  private readonly projects: DesktopProjectSetups
  private readonly targets: DesktopTargetSetups
  private readonly firstDeployments: DesktopFirstDeployments
  private readonly installations: DesktopControllerInstallations
  private readonly upgrades: DesktopControllerUpgrades
  private readonly runtimeReviews = new Map<
    string,
    {
      expires: number
      bindingId: string
      revision: number
      before: ProductDesktopControllerBindingIntent
      next: ProductDesktopControllerBindingIntent
      upgradeKey: string
    }
  >()
  constructor(
    private readonly db: Database.Database,
    cipher: AesGcmCredentialCipher,
    private readonly ssh: SshManager,
    private readonly clientFactory?: (bindingId: string) => Pick<ControllerHttpClient, 'call'>,
    installationCatalog: readonly DesktopControllerRelease[] = [],
    private readonly installerResources?: ControllerInstallerResources,
    /** Trusted CLI/lab composition only; never a JSON/IPC field. */
    options: {
      installation?: DesktopInstallationOptions
      upgrade?: DesktopUpgradeOptions
      bootstrapScript?: { text: string; sha256: string }
    } = {}
  ) {
    this.installations = new DesktopControllerInstallations(
      db,
      ssh,
      installationCatalog,
      options.installation
    )
    const upgradeIds = new Set(
      installerResources
        ?.list()
        .filter((v) => v.upgrade_supported)
        .map((v) => v.release_id)
    )
    this.upgrades = new DesktopControllerUpgrades(
      db,
      this.installations,
      ssh,
      installerResources
        ? installationCatalog.filter((v) => upgradeIds.has(v.release_id))
        : installationCatalog,
      options.upgrade
    )
    this.vault = new DesktopControllerVault(db, cipher)
    this.enrollment = new DesktopControllerEnrollment(this.vault, ssh, {
      bootstrapScript: options.bootstrapScript
    })
    this.commands = new DesktopControllerCommands(db, this.vault, ssh, clientFactory)
    this.projects = new DesktopProjectSetups(db, this.vault, this.enrollment)
    this.targets = new DesktopTargetSetups(db, cipher, this.vault, this.enrollment)
    this.firstDeployments = new DesktopFirstDeployments(
      this.projects,
      this.enrollment,
      this.commands,
      async (bindingId) => {
        const snapshot = await this.apps({ binding_id: bindingId })
        return (
          snapshot.service_state === 'ready' &&
          snapshot.data_freshness === 'current' &&
          snapshot.capabilities.redeploy === 'available'
        )
      }
    )
  }
  async planInstallation(vpsId: number, releaseId: string): Promise<DesktopInstallationPlan> {
    return this.safe(() => this.installations.plan(vpsId, releaseId))
  }
  async upgradeOverview(): Promise<ControllerUpgradeOverview> {
    return this.safe(() => ({
      releases: this.installerResources?.list().filter((v) => v.upgrade_supported) ?? [],
      installations: this.installations.list(),
      upgrades: this.upgrades.all(),
      connections: this.vault.list().map((v) => this.connection(v.binding_id))
    }))
  }
  async reviewUpgrade(input: ControllerUpgradeReviewInput): Promise<ControllerUpgradeReview> {
    return this.safe(() => {
      const v = z
        .strictObject({
          installation_request_key: z.uuidv4(),
          release_id: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/)
        })
        .parse(input)
      return this.upgrades.plan(v.installation_request_key, v.release_id)
    })
  }
  async prepareUpgrade(input: {
    plan_id: string
  }): Promise<import('../../../../docs/contracts/desktop-controller-upgrade').DesktopUpgrade> {
    return this.safe(() =>
      this.upgrades.prepare(z.strictObject({ plan_id: z.uuidv4() }).parse(input).plan_id)
    )
  }
  async sendUpgrade(
    input: ControllerUpgradeSendInput
  ): Promise<import('../../../../docs/contracts/desktop-controller-upgrade').DesktopUpgrade> {
    return this.safe(() => {
      const v = z
        .strictObject({
          request_key: z.uuidv4(),
          operation: z.enum(['transfer', 'upgrade', 'recover', 'rollback']),
          consent: z.literal(true)
        })
        .parse(input)
      return this.upgrades.send(v.request_key, v.operation, v.consent)
    })
  }
  async inspectUpgrade(
    key: string
  ): Promise<import('../../../../docs/contracts/desktop-controller-upgrade').DesktopUpgrade> {
    return this.safe(() => this.upgrades.inspect(z.uuidv4().parse(key)))
  }
  async cancelUpgrade(
    key: string
  ): Promise<import('../../../../docs/contracts/desktop-controller-upgrade').DesktopUpgrade> {
    return this.safe(() => this.upgrades.cancel(z.uuidv4().parse(key)))
  }
  async reviewUpgradeBinding(input: {
    binding_id: string
    request_key: string
  }): Promise<ControllerUpgradeBindingReview> {
    return this.safe(async () => {
      const v = z.strictObject({ binding_id: z.uuidv4(), request_key: z.uuidv4() }).parse(input)
      const before = this.vault.storedIntent(v.binding_id),
        metadata = this.vault.get(v.binding_id)
      if (metadata.state !== 'active') throw new DesktopUpgradeError('UPGRADE_CONFLICT')
      await this.upgrades.inspect(v.request_key)
      if (
        this.vault.get(v.binding_id).revision !== metadata.revision ||
        canonicalH2Json(this.vault.storedIntent(v.binding_id)) !== canonicalH2Json(before)
      )
        throw new DesktopUpgradeError('UPGRADE_AUTHORITY_CHANGED')
      const next = this.upgrades.bindingIntent(v.request_key, before)
      for (const [id, p] of this.runtimeReviews)
        if (p.expires < Date.now()) this.runtimeReviews.delete(id)
      if (this.runtimeReviews.size >= 32) throw new DesktopUpgradeError('UPGRADE_BUSY')
      const id = randomUUID(),
        expires = Date.now() + 60000
      this.runtimeReviews.set(id, {
        expires,
        bindingId: v.binding_id,
        revision: metadata.revision,
        before,
        next,
        upgradeKey: v.request_key
      })
      return {
        plan_id: id,
        expires_at: new Date(expires).toISOString(),
        binding_id: v.binding_id,
        upgrade_request_key: v.request_key,
        binding_revision: metadata.revision,
        controller_id: next.controller_id,
        release_id: this.upgrades.all().find((r) => r.request_key === v.request_key)!.release_id
      }
    })
  }
  async refreshUpgradeBinding(input: {
    plan_id: string
    consent: true
  }): Promise<DesktopControllerConnection> {
    return this.safe(() => {
      const v = z.strictObject({ plan_id: z.uuidv4(), consent: z.literal(true) }).parse(input),
        plan = this.runtimeReviews.get(v.plan_id)
      if (!plan || plan.expires < Date.now()) throw new DesktopUpgradeError('UPGRADE_PLAN_EXPIRED')
      if (
        this.vault.get(plan.bindingId).revision !== plan.revision ||
        canonicalH2Json(this.vault.storedIntent(plan.bindingId)) !== canonicalH2Json(plan.before) ||
        canonicalH2Json(this.upgrades.bindingIntent(plan.upgradeKey, plan.before)) !==
          canonicalH2Json(plan.next)
      )
        throw new DesktopUpgradeError('UPGRADE_AUTHORITY_CHANGED')
      this.vault.refreshRuntime(plan.bindingId, plan.revision, plan.next)
      this.runtimeReviews.delete(v.plan_id)
      return this.connection(plan.bindingId)
    })
  }
  async installerOverview(): Promise<ControllerInstallerOverview> {
    return this.safe(() => ({
      releases: this.installerResources?.list() ?? [],
      installations: this.installations.list(),
      connections: this.vault.list().map((v) => this.connection(v.binding_id))
    }))
  }
  async reviewInstaller(input: {
    vps_id: number
    release_id: string
  }): Promise<ControllerInstallerReview> {
    return this.safe(() => {
      const value = z
        .strictObject({
          vps_id: z.number().int().positive(),
          release_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/)
        })
        .parse(input)
      if (!this.installerResources) throw new DesktopInstallationError('INSTALL_CATALOG_UNKNOWN')
      this.installerResources.verify(value.release_id)
      return this.installations.preflight(value.vps_id, value.release_id)
    })
  }
  async prepareInstaller(input: { plan_id: string }): Promise<DesktopInstallation> {
    return this.safe(() =>
      this.installations.prepare(z.strictObject({ plan_id: z.uuidv4() }).parse(input).plan_id)
    )
  }
  async sendInstaller(input: ControllerInstallerSendInput): Promise<DesktopInstallation> {
    return this.safe(() => {
      const value = z
        .strictObject({
          request_key: z.uuidv4(),
          operation: z.enum(['transfer', 'install', 'recover']),
          consent: z.literal(true)
        })
        .parse(input)
      this.originalInstallationOnly(value.request_key)
      return this.installations.send(value.request_key, value.operation, value.consent)
    })
  }
  async rebindInstaller(input: {
    plan_id: string
    request_key: string
    confirm: true
  }): Promise<DesktopInstallation> {
    return this.safe(() => {
      const value = z
        .strictObject({ plan_id: z.uuidv4(), request_key: z.uuidv4(), confirm: z.literal(true) })
        .parse(input)
      this.originalInstallationOnly(value.request_key)
      return this.installations.rebind(value.plan_id, value.request_key, value.confirm)
    })
  }
  async prepareInstalledRegistration(
    input: ControllerInstalledPrepareInput
  ): Promise<DesktopControllerConnection> {
    return this.safe(() => {
      const value = installedRegisterSchema.omit({ binding_id: true }).parse(input)
      this.originalInstallationOnly(value.installation_request_key)
      const intent = this.installations.bindingIntent(
        value.installation_request_key,
        randomUUID(),
        value.display_name,
        value.allow_write
      )
      const prepared = this.vault.prepare(intent, { reuseInstalled: true })
      return this.connection(prepared.binding_id)
    })
  }
  async prepareInstallation(planId: string): Promise<DesktopInstallation> {
    return this.safe(() => this.installations.prepare(planId))
  }
  async listInstallations(): Promise<DesktopInstallation[]> {
    return this.safe(() => this.installations.list())
  }
  async cancelInstallation(key: string): Promise<DesktopInstallation> {
    return this.safe(() => this.installations.cancel(key))
  }
  async inspectInstallation(key: string): Promise<DesktopInstallation> {
    return this.safe(() => {
      this.originalInstallationOnly(key)
      return this.installations.inspect(key)
    })
  }
  async sendInstallation(
    key: string,
    operation: Exclude<DesktopInstallationOperation, 'inspect'>,
    consent: true
  ): Promise<DesktopInstallation> {
    return this.safe(() => {
      this.originalInstallationOnly(key)
      return this.installations.send(key, operation, consent)
    })
  }
  async rebindInstallation(
    planId: string,
    key: string,
    confirm: true
  ): Promise<DesktopInstallation> {
    return this.safe(() => {
      this.originalInstallationOnly(key)
      return this.installations.rebind(planId, key, confirm)
    })
  }
  async prepareTarget(input: DesktopTargetPrepareInput): Promise<DesktopTargetSetup> {
    return this.safe(() => this.targets.prepare(input))
  }
  async sendTarget(input: DesktopTargetSendInput): Promise<DesktopTargetSetup> {
    return this.safe(() => this.targets.send(input))
  }
  async listTargetSetups(bindingId: string): Promise<DesktopTargetSetup[]> {
    return this.safe(() => this.targets.list(bindingId))
  }
  async cancelTarget(key: string): Promise<DesktopTargetSetup> {
    return this.safe(() => this.targets.cancel(key))
  }
  async projectReadiness(key: string): Promise<DesktopProjectReadiness> {
    return this.safe(() => this.firstDeployments.readiness(key))
  }
  async prepareFirstDeployment(
    input: DesktopFirstDeploymentInput
  ): Promise<DesktopFirstDeploymentPlan> {
    return this.safe(() => this.firstDeployments.prepare(input))
  }
  async sendFirstDeployment(
    input: DesktopFirstDeploymentSendInput
  ): Promise<DesktopControllerCommand> {
    return this.safe(() => this.firstDeployments.send(input))
  }
  async projectTargets(input: {
    binding_id: string
    after_id?: number | null
  }): Promise<DesktopProjectTargets> {
    return this.safe(() => {
      const parsed = z
        .strictObject({
          binding_id: z.uuid(),
          after_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional()
        })
        .safeParse(input)
      if (!parsed.success) throw new DesktopProjectSetupError('PROJECT_REQUEST_INVALID')
      return this.projects.targets(parsed.data.binding_id, parsed.data.after_id ?? null)
    })
  }
  async prepareProject(input: DesktopProjectSetupInput): Promise<DesktopProjectSetup> {
    return this.safe(() => this.projects.prepare(input))
  }
  async sendProject(key: string): Promise<DesktopProjectSetup> {
    return this.safe(() => this.projects.send(key))
  }
  async listProjects(bindingId: string): Promise<DesktopProjectSetup[]> {
    return this.safe(() => this.projects.list(bindingId))
  }
  async cancelProject(key: string): Promise<DesktopProjectSetup> {
    return this.safe(() => this.projects.cancel(key))
  }
  async verifyProjectSource(key: string): Promise<DesktopProjectSourceVerification> {
    return this.safe(() => this.projects.verifySource(key))
  }
  async projectTargetState(key: string): Promise<DesktopProjectTargetState> {
    return this.safe(() => this.projects.targetState(key))
  }
  async enrollProjectTarget(input: DesktopProjectTargetInput): Promise<DesktopProjectTargetState> {
    return this.safe(() => this.projects.enrollTarget(input))
  }
  async prepareCommand(input: DesktopControllerCommandInput): Promise<DesktopControllerCommand> {
    return this.safe(() => {
      if (input?.operation === 'redeploy' && input.require_first_deployment)
        throw new DesktopFirstDeploymentError('FIRST_DEPLOY_REVIEW_REQUIRED')
      return this.commands.prepare(input)
    })
  }
  async sendCommand(key: string): Promise<DesktopControllerCommand> {
    return this.safe(() => {
      const command = this.commands.get(key)
      if (command.require_first_deployment && command.state === 'prepared')
        throw new DesktopFirstDeploymentError('FIRST_DEPLOY_REVIEW_REQUIRED')
      return this.commands.send(key)
    })
  }
  async checkCommand(key: string): Promise<DesktopControllerCommand> {
    return this.safe(() => this.commands.check(key))
  }
  async cancelCommand(key: string): Promise<DesktopControllerCommand> {
    return this.safe(() => this.commands.cancel(key))
  }
  async listCommands(bindingId: string): Promise<DesktopControllerCommand[]> {
    return this.safe(() => this.commands.list(bindingId))
  }
  async list(): Promise<DesktopControllerConnection[]> {
    return this.safe(() => this.vault.list().map((row) => this.connection(row.binding_id)))
  }
  async register(input: DesktopControllerRegisterInput): Promise<DesktopControllerConnection> {
    return this.safe(async () => {
      const parsed = registerSchema.safeParse(input)
      if (!parsed.success) throw new DesktopControllerVaultError('REQUEST_INVALID')
      const { allow_write, ...value } = parsed.data
      const vps = this.db
        .prepare(
          'SELECT host,port,host_fingerprint,username,auth_type,ssh_security_revision,archived_at FROM vps WHERE id=?'
        )
        .get(value.vps_id) as
        | {
            host: string
            port: number
            host_fingerprint: string | null
            username: string
            auth_type: 'key' | 'password'
            ssh_security_revision: number
            archived_at: string | null
          }
        | undefined
      if (!vps || vps.archived_at !== null || !vps.host_fingerprint)
        throw new DesktopControllerVaultError('BINDING_UNAVAILABLE')
      this.vault.prepare({
        ...value,
        ssh_security_revision: vps.ssh_security_revision,
        principal: {
          vpsId: value.vps_id,
          host: vps.host,
          port: vps.port,
          hostFingerprint: vps.host_fingerprint,
          username: vps.username,
          authType: vps.auth_type
        },
        requested_scopes: allow_write ? ['read', 'deploy:manual', 'policy:write'] : ['read']
      })
      await this.enrollment.enroll(value.binding_id)
      return this.connection(value.binding_id)
    })
  }
  async registerInstalled(input: {
    installation_request_key: string
    binding_id: string
    display_name: string
    allow_write?: boolean
  }): Promise<DesktopControllerConnection> {
    return this.safe(async () => {
      const value = installedRegisterSchema.parse(input)
      this.originalInstallationOnly(value.installation_request_key)
      const intent = this.installations.bindingIntent(
        value.installation_request_key,
        value.binding_id,
        value.display_name,
        value.allow_write
      )
      this.vault.prepare(intent)
      await this.enrollment.enroll(value.binding_id)
      return this.connection(value.binding_id)
    })
  }
  async retry(bindingId: string): Promise<DesktopControllerConnection> {
    return this.safe(async () => {
      this.uuid(bindingId)
      await this.enrollment.enroll(bindingId)
      return this.connection(bindingId)
    })
  }
  async revoke(bindingId: string): Promise<DesktopControllerConnection> {
    return this.safe(async () => {
      this.uuid(bindingId)
      await this.enrollment.revoke(bindingId)
      return this.connection(bindingId)
    })
  }
  async disconnect(bindingId: string): Promise<DesktopControllerConnection> {
    return this.safe(() => {
      this.uuid(bindingId)
      const current = this.vault.get(bindingId)
      if (current.state !== 'disabled') this.vault.disable(bindingId, current.revision)
      return this.connection(bindingId)
    })
  }
  async apps(input: DesktopControllerPageInput): Promise<DesktopControllerSnapshot> {
    return this.safe(async () => {
      const parsed = pageSchema.safeParse(input)
      if (!parsed.success) throw new DesktopControllerVaultError('REQUEST_INVALID')
      const { binding_id, cursor } = parsed.data,
        initial = this.vault.resolve(binding_id)
      const client =
        this.clientFactory?.(binding_id) ??
        new ControllerHttpClient(this.ssh, () => this.vault.resolve(binding_id))
      const [identity, apps, capabilities] = await Promise.all([
        client.call('identity', {}),
        client.call('apps', { query: { limit: 50, ...(cursor ? { cursor } : {}) } }),
        client.call('capabilities', {})
      ])
      if (
        identity.state !== 'response_received' ||
        apps.state !== 'response_received' ||
        capabilities.state !== 'response_received'
      )
        throw new ControllerHttpClientError('PROTOCOL_INVALID')
      const final = this.vault.resolve(binding_id)
      if (
        initial.revision !== final.revision ||
        initial.controllerId !== final.controllerId ||
        initial.accessToken !== final.accessToken
      )
        throw new DesktopControllerVaultError('BINDING_CHANGED')
      const caps = capabilities.response,
        response = apps.response,
        id = identity.response
      if (
        id.controller_id !== final.controllerId ||
        response.controller_id !== final.controllerId ||
        caps.controller_id !== final.controllerId
      )
        throw new ControllerHttpClientError('PROTOCOL_INVALID')
      const age = Math.max(
        Date.now() - Date.parse(id.sampled_at),
        Date.now() - Date.parse(response.sampled_at),
        Date.now() - Date.parse(caps.sampled_at)
      )
      const flags = [id.data_freshness, response.data_freshness, caps.data_freshness]
      const freshness = flags.includes('unknown')
        ? 'unknown'
        : age > 30000 || flags.includes('stale')
          ? 'stale'
          : 'current'
      return {
        binding_id,
        controller_id: final.controllerId,
        binding_revision: final.revision,
        service_state: id.service_state,
        data_freshness: freshness,
        checked_at: new Date(
          Math.min(...[id.sampled_at, response.sampled_at, caps.sampled_at].map(Date.parse))
        ).toISOString(),
        capabilities: {
          redeploy: caps.manual_redeploy.state,
          pause: caps.pause_auto_deploy.state,
          resume: caps.resume_auto_deploy.state
        },
        items: response.items.map((app) => ({
          app_id: app.app_id,
          ownership_generation: app.ownership_generation,
          source_generation: app.source_generation,
          app_name: app.app_name,
          production_ref: app.production_ref,
          desired_sha: app.desired_sha,
          auto_deploy_paused: app.auto_deploy_paused,
          reconciliation_state: app.reconciliation_state,
          observed_at: app.observed_at
        })),
        next_cursor: response.next_cursor,
        has_more: response.has_more
      }
    })
  }
  async appStatus(input: {
    binding_id: string
    app_id: number
  }): Promise<DesktopControllerAppStatus> {
    return this.safe(async () => {
      const parsed = z
        .strictObject({
          binding_id: z.uuid(),
          app_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
        })
        .safeParse(input)
      if (!parsed.success) throw new DesktopControllerVaultError('REQUEST_INVALID')
      const { binding_id, app_id } = parsed.data,
        before = this.vault.resolve(binding_id)
      const client =
        this.clientFactory?.(binding_id) ??
        new ControllerHttpClient(this.ssh, () => this.vault.resolve(binding_id))
      const result = await client.call('app', { app_id })
      const after = this.vault.resolve(binding_id)
      if (
        before.revision !== after.revision ||
        before.accessToken !== after.accessToken ||
        before.controllerId !== after.controllerId
      )
        throw new DesktopControllerVaultError('BINDING_CHANGED')
      if (
        result.state !== 'response_received' ||
        result.response.controller_id !== after.controllerId ||
        result.response.app_id !== app_id
      )
        throw new ControllerHttpClientError('PROTOCOL_INVALID')
      const value = result.response
      return {
        binding_id,
        binding_revision: after.revision,
        controller_id: after.controllerId,
        app_id,
        ownership_generation: value.ownership_generation,
        source_generation: value.source_generation,
        current_deployment_id: value.current_deployment_id,
        current_deployment_sha: value.current_deployment_sha,
        current_deployment_state: value.current_deployment_state,
        latest_job_id: value.latest_job_id,
        latest_job_state: value.latest_job_state,
        checked_at: value.sampled_at,
        data_freshness: value.data_freshness
      }
    })
  }
  async exposure(input: DesktopExposureInput, check = false): Promise<DesktopExposureResult> {
    return this.safe(() =>
      new DesktopExposure(this.vault, this.ssh, this.clientFactory).run(input, check)
    )
  }
  private connection(bindingId: string): DesktopControllerConnection {
    const row = this.vault.get(bindingId)
    // Public intent only; avoid current-VPS check so an archived connection can still be disconnected.
    const stored = this.db
      .prepare('SELECT intent_json FROM desktop_controller_binding WHERE binding_id=?')
      .get(bindingId) as { intent_json: string }
    const name: unknown = JSON.parse(stored.intent_json).display_name
    const installation: unknown = JSON.parse(stored.intent_json).installation
    if (typeof name !== 'string') throw new DesktopControllerVaultError('BINDING_UNAVAILABLE')
    return {
      ...(installation
        ? {
            installation: z
              .strictObject({
                request_key: z.uuidv4(),
                authority_revision: z.number().int().positive()
              })
              .parse({
                request_key: (installation as { request_key: string }).request_key,
                authority_revision: (installation as { authority_revision: number })
                  .authority_revision
              })
          }
        : {}),
      binding_id: row.binding_id,
      controller_id: row.controller_id,
      vps_id: row.vps_id,
      revision: row.revision,
      state: row.state,
      display_name: name,
      remote_client_id: row.remote_client_id,
      credential_expires_at: row.client?.token_expires_at ?? null,
      updated_at: row.updated_at,
      scopes: [...(row.client?.scopes ?? [])]
    }
  }
  private originalInstallationOnly(key: string): void {
    this.uuid(key)
    // The original inspector attests the original runtime. Once an upgrade owns
    // that runtime, it must not overwrite installation authority with a stale result.
    if (
      this.db
        .prepare(
          `SELECT 1 FROM desktop_controller_upgrade WHERE installation_request_key=?
           AND state<>'cancelled' AND (upgrade_attempted=1 OR is_current=1) LIMIT 1`
        )
        .get(key)
    )
      throw new DesktopUpgradeError('UPGRADE_INSPECT_REQUIRED')
  }
  private uuid(value: string): void {
    if (!z.uuid().safeParse(value).success) throw new DesktopControllerVaultError('REQUEST_INVALID')
  }
  private async safe<T>(work: () => T | Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      const code =
        error instanceof DesktopControllerVaultError ||
        error instanceof DesktopControllerEnrollmentError ||
        error instanceof DesktopControllerCommandError ||
        error instanceof DesktopProjectSetupError ||
        error instanceof DesktopFirstDeploymentError ||
        error instanceof DesktopTargetSetupError ||
        error instanceof DesktopInstallationError ||
        error instanceof DesktopUpgradeError ||
        error instanceof ControllerBootstrapError ||
        error instanceof ProjectRegistrationError ||
        error instanceof ControllerHttpClientError
          ? error.code
          : 'CONTROLLER_UNAVAILABLE'
      throw new AppError(
        'VALIDATION',
        'Không hoàn tất được thao tác controller. Kiểm tra cấu hình và thử lại.',
        { cause: new Error(code) }
      )
    }
  }
}
