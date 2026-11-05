import type { SshManager } from '../../ssh/manager'
import { collectCaddyAptEvidenceOverSsh, type CaddyAptSshTarget } from './caddyAptEvidence'
import { prepareCaddyInstallPlan, type CaddyInstallPlanResult } from './caddyInstallPlan'
import { preflightSharedIngress } from './preflight'
import { INGRESS_READ_COMMANDS } from './preflight'

/**
 * Reusable preparation boundary for a future installer. It collects fresh APT
 * evidence first, then reruns the read-only ingress preflight immediately
 * before producing the plan. No install or write operation is performed here.
 */
export async function prepareCaddyInstallPlanOverSsh(
  ssh: SshManager,
  target: CaddyAptSshTarget
): Promise<CaddyInstallPlanResult> {
  const evidence = await collectCaddyAptEvidenceOverSsh(ssh, target)
  if (evidence.status !== 'verified') {
    return { status: 'blocked', code: evidence.code, reason: evidence.reason }
  }

  let platform: { distroId: string; distroVersion: string; architecture: string }
  let ingress: Awaited<ReturnType<typeof preflightSharedIngress>>
  try {
    const platformRead = await ssh.execWithHostIdentity(
      target.vpsId,
      INGRESS_READ_COMMANDS.platform,
      {
        timeoutMs: 10_000,
        maxStdoutBytes: 4096,
        maxStderrBytes: 4096,
        retryOnReconnect: false
      }
    )
    if (!sameIdentity(target, platformRead.identity) || platformRead.result.code !== 0) {
      return {
        status: 'blocked',
        code: 'APT_SSH_HOST_CHANGED',
        reason: 'Could not verify the VPS identity and platform over the pinned SSH connection.'
      }
    }
    const parsedPlatform = parsePlatform(platformRead.result.stdout)
    if (!parsedPlatform) {
      return {
        status: 'blocked',
        code: 'INSTALL_PLATFORM_UNSUPPORTED',
        reason: 'The pinned VPS did not report a supported Debian/Ubuntu release and architecture.'
      }
    }
    platform = parsedPlatform
    ingress = await preflightSharedIngress(ssh, target.vpsId)
    const actual = await ssh.getHostIdentity(target.vpsId)
    if (!sameIdentity(target, actual)) {
      return {
        status: 'blocked',
        code: 'APT_SSH_HOST_CHANGED',
        reason:
          'The VPS SSH identity changed during preflight; reconnect and verify the saved fingerprint.'
      }
    }
  } catch {
    return {
      status: 'blocked',
      code: 'APT_SSH_FAILED',
      reason:
        'Could not rerun read-only ingress preflight over the pinned SSH connection; verify connectivity and retry.'
    }
  }

  if (evidence.evidence.architecture !== platform.architecture) {
    return {
      status: 'blocked',
      code: 'APT_METADATA_INVALID',
      reason: 'APT package architecture does not match the VPS architecture; refresh evidence.'
    }
  }
  return prepareCaddyInstallPlan({ ...platform, ingress, target }, evidence.evidence)
}

function parsePlatform(
  output: string
): { distroId: string; distroVersion: string; architecture: string } | null {
  const lines = output.trim().split(/\r?\n/)
  const values = new Map<string, string>()
  for (const line of lines) {
    const match = line.match(/^(ID|VERSION_ID)=(.+)$/)
    if (match) values.set(match[1], match[2].replace(/^['"]|['"]$/g, ''))
  }
  const rawArchitecture = lines.at(-1)?.trim()
  const distroId = values.get('ID')
  const distroVersion = values.get('VERSION_ID')
  if (!rawArchitecture || !distroId || !distroVersion) return null
  const architecture =
    rawArchitecture === 'x86_64'
      ? 'amd64'
      : rawArchitecture === 'aarch64'
        ? 'arm64'
        : rawArchitecture
  return { distroId, distroVersion, architecture }
}

function sameIdentity(
  expected: CaddyAptSshTarget,
  actual: { vpsId: number; host: string; port: number; hostFingerprint: string }
): boolean {
  return (
    expected.vpsId === actual.vpsId &&
    expected.host === actual.host &&
    expected.port === actual.port &&
    expected.hostFingerprint === actual.hostFingerprint
  )
}
