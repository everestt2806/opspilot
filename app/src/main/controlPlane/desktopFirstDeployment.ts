import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  DesktopProjectReadiness,
  DesktopFirstDeploymentInput,
  DesktopFirstDeploymentPlan,
  DesktopFirstDeploymentSendInput
} from '@shared/desktopFirstDeployment'
import type { DesktopControllerCommand } from '@shared/desktopControllerCommands'
import type { DesktopProjectSetups } from './desktopProjectSetup'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import type { DesktopControllerCommands } from './desktopControllerCommands'
import { projectReadinessSchema } from './projectReadiness'
import { assessProductResources } from './controllerResources'
import { canonicalH2Json } from './productH2Proof'
const inputSchema = z.strictObject({ request_key: z.uuid(), readiness_id: z.uuid() })
type Context = ReturnType<DesktopProjectSetups['registeredContext']>
type Receipt = {
  value: DesktopProjectReadiness
  context: Context
  expires: number
  commandKey?: string
}
export class DesktopFirstDeploymentError extends Error {
  constructor(
    readonly code:
      | 'FIRST_DEPLOY_REQUEST_INVALID'
      | 'FIRST_DEPLOY_BUSY'
      | 'FIRST_DEPLOY_REVIEW_REQUIRED'
      | 'FIRST_DEPLOY_RESPONSE_INVALID'
  ) {
    super(code)
  }
}
/** Cache không thay durable journal; crash không bao giờ tự resend POST. */
export class DesktopFirstDeployments {
  private readonly receipts = new Map<string, Receipt>()
  private readonly busy = new Set<string>()
  constructor(
    private readonly projects: Pick<DesktopProjectSetups, 'registeredContext'>,
    private readonly admin: Pick<DesktopControllerEnrollment, 'projectReadiness'>,
    private readonly commands: Pick<DesktopControllerCommands, 'prepare' | 'get' | 'send'>,
    private readonly controllerReady: (bindingId: string) => Promise<boolean>,
    private readonly now: () => number = Date.now
  ) {}
  async readiness(key: string): Promise<DesktopProjectReadiness> {
    const before = this.projects.registeredContext(key),
      setup = before.setup,
      registration = before.registration
    if (this.busy.has(key)) throw new DesktopFirstDeploymentError('FIRST_DEPLOY_BUSY')
    this.busy.add(key)
    for (const [id, receipt] of this.receipts)
      if (receipt.expires <= this.now() || receipt.value.request_key === key)
        this.receipts.delete(id)
    try {
      const report = projectReadinessSchema.safeParse(
        await this.admin.projectReadiness(setup.binding_id, {
          format: 1,
          controller_id: setup.controller_id,
          app_id: registration.app_id,
          expected_ownership_generation: registration.ownership_generation,
          expected_source_generation: registration.source_generation,
          expected_source_config_sha256: registration.source_config_sha256,
          expected_target_security_revision: setup.target_security_revision
        })
      )
      if (!report.success) throw new DesktopFirstDeploymentError('FIRST_DEPLOY_RESPONSE_INVALID')
      const r = report.data
      if (
        r.controller_id !== setup.controller_id ||
        r.app_id !== registration.app_id ||
        r.ownership_generation !== registration.ownership_generation ||
        r.source_generation !== registration.source_generation ||
        r.source_config_sha256 !== registration.source_config_sha256 ||
        r.target_vps_id !== setup.target_vps_id ||
        r.target_security_revision !== setup.target_security_revision ||
        r.repository_url !== setup.repository_url ||
        r.production_ref !== setup.production_ref ||
        r.repository_root !== setup.repository_root ||
        r.host_port !== setup.host_port ||
        new Set(r.checks.map((check) => check.key)).size !== 5 ||
        Date.parse(r.checked_at) > this.now() + 5000 ||
        this.now() - Date.parse(r.checked_at) > 30_000 ||
        (r.state === 'ready' &&
          (r.commit_sha === null ||
            r.reasons.length !== 0 ||
            r.checks.some((check) => check.state !== 'passed') ||
            assessProductResources(r.controller_resources).state !== 'ready' ||
            assessProductResources(r.target_resources, true).state !== 'ready'))
      )
        throw new DesktopFirstDeploymentError('FIRST_DEPLOY_RESPONSE_INVALID')
      let available = false
      try {
        available = await this.controllerReady(setup.binding_id)
      } catch {
        /* Mất capability không biến thành sẵn sàng. */
      }
      this.assertContext(before)
      if (this.now() - Date.parse(r.checked_at) > 30_000)
        throw new DesktopFirstDeploymentError('FIRST_DEPLOY_REVIEW_REQUIRED')
      const expires = this.now() + 60_000,
        id = r.state === 'ready' && available ? randomUUID() : null
      const value: DesktopProjectReadiness = {
        binding_id: setup.binding_id,
        binding_revision: setup.binding_revision,
        request_key: key,
        controller_ready: available,
        state: id ? 'ready' : 'blocked',
        report: r,
        readiness_id: id,
        valid_until: id ? new Date(expires).toISOString() : null
      }
      if (id) {
        while (this.receipts.size >= 100) this.receipts.delete(this.receipts.keys().next().value!)
        this.receipts.set(id, { value, context: before, expires })
      }
      return value
    } finally {
      this.busy.delete(key)
    }
  }
  prepare(input: DesktopFirstDeploymentInput): DesktopFirstDeploymentPlan {
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) throw new DesktopFirstDeploymentError('FIRST_DEPLOY_REQUEST_INVALID')
    const receipt = this.receipt(parsed.data)
    const command = this.prepareCommand(receipt)
    receipt.commandKey = command.request_key
    return {
      request_key: input.request_key,
      readiness_id: input.readiness_id,
      binding_id: receipt.value.binding_id,
      binding_revision: receipt.value.binding_revision,
      app_id: receipt.value.report.app_id,
      source_sha: receipt.value.report.commit_sha!,
      valid_until: receipt.value.valid_until!,
      command
    }
  }
  async send(input: DesktopFirstDeploymentSendInput): Promise<DesktopControllerCommand> {
    const parsed = inputSchema.extend({ command_key: z.uuid() }).safeParse(input)
    if (!parsed.success) throw new DesktopFirstDeploymentError('FIRST_DEPLOY_REQUEST_INVALID')
    const context = this.projects.registeredContext(input.request_key),
      command = this.commands.get(input.command_key)
    if (
      command.app_id !== context.setup.app_id ||
      command.binding_id !== context.setup.binding_id ||
      command.controller_id !== context.setup.controller_id ||
      command.binding_revision !== context.setup.binding_revision ||
      !command.require_first_deployment ||
      command.operation !== 'redeploy'
    )
      throw new DesktopFirstDeploymentError('FIRST_DEPLOY_REVIEW_REQUIRED')
    if (command.state !== 'prepared') return command
    const receipt = this.receipt(parsed.data)
    if (
      receipt.commandKey !== command.request_key ||
      this.prepareCommand(receipt).request_key !== command.request_key
    )
      throw new DesktopFirstDeploymentError('FIRST_DEPLOY_REVIEW_REQUIRED')
    return this.commands.send(command.request_key)
  }
  private prepareCommand(receipt: Receipt): DesktopControllerCommand {
    return this.commands.prepare({
      binding_id: receipt.value.binding_id,
      app_id: receipt.value.report.app_id,
      expected_ownership_generation: receipt.value.report.ownership_generation,
      expected_source_generation: receipt.value.report.source_generation,
      operation: 'redeploy',
      require_first_deployment: true,
      target: { kind: 'specific_sha', sha: receipt.value.report.commit_sha! }
    })
  }
  private receipt(input: DesktopFirstDeploymentInput): Receipt {
    const value = this.receipts.get(input.readiness_id)
    if (
      !value ||
      value.value.request_key !== input.request_key ||
      value.expires <= this.now() ||
      this.busy.has(input.request_key)
    ) {
      if (value?.expires && value.expires <= this.now()) this.receipts.delete(input.readiness_id)
      throw new DesktopFirstDeploymentError('FIRST_DEPLOY_REVIEW_REQUIRED')
    }
    this.assertContext(value.context)
    return value
  }
  private assertContext(before: Context): void {
    if (
      canonicalH2Json(this.projects.registeredContext(before.setup.request_key)) !==
      canonicalH2Json(before)
    )
      throw new DesktopFirstDeploymentError('FIRST_DEPLOY_REVIEW_REQUIRED')
  }
}
