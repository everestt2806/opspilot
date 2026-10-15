import { EXPECTED_OPSPILOT_UNIT, type IngressPreflightResult } from './preflight'
import { buildSharedIngressConfig } from './routeBuilder'

export const CADDY_STABLE_REPOSITORY = {
  uri: 'https://dl.cloudsmith.io/public/caddy/stable/deb/debian',
  suite: 'any-version',
  component: 'main',
  signedBy: '/usr/share/keyrings/caddy-stable-archive-keyring.gpg'
} as const

export interface CaddyInstallHost {
  ingress: IngressPreflightResult
  distroId: string
  distroVersion: string
  architecture: string
}

export interface CaddyAptEvidence {
  sourceLine: string
  releaseSignature: 'valid' | 'invalid' | 'unknown'
  packageIndex: 'authenticated' | 'unauthenticated' | 'unknown'
  originUri: string
  suite: string
  component: string
  package: string
  version: string
  architecture: string
  filename: string
  sha256: string
}

export type CaddyInstallPlanErrorCode =
  | 'INSTALL_HOST_NOT_CLEAN'
  | 'INSTALL_PLATFORM_UNSUPPORTED'
  | 'APT_SOURCE_UNTRUSTED'
  | 'APT_METADATA_INVALID'

export type CaddyInstallPlanResult =
  | { status: 'ready'; plan: CaddyInstallPlan }
  | { status: 'blocked'; code: CaddyInstallPlanErrorCode; reason: string }

export interface CaddyInstallPlan {
  distro: 'debian' | 'ubuntu'
  distroVersion: string
  architecture: 'amd64' | 'arm64'
  version: string
  packageSha256: string
  packageFilename: string
  repository: typeof CADDY_STABLE_REPOSITORY
  verificationSteps: string[]
  stagingSteps: string[]
  stagingScript: string
  writePlan: {
    status: 'not-executed'
    serviceAccount: { name: 'opspilot-caddy'; group: 'opspilot-caddy'; shell: '/usr/sbin/nologin' }
    artifacts: Array<{
      path: string
      kind: 'directory' | 'file' | 'symlink'
      owner: string
      group: string
      mode: string
      content?: string
      target?: string
    }>
  }
  unitContents: string
  installationManifest: {
    path: '/etc/opspilot/caddy/INSTALLATION'
    owner: 'root'
    group: 'root'
    mode: '0644'
    format: 'opspilot-caddy-installation-v1'
    template: string
  }
}

const SUPPORTED_PLATFORMS = new Map<string, 'debian' | 'ubuntu'>([
  ['debian:12', 'debian'],
  ['ubuntu:22.04', 'ubuntu'],
  ['ubuntu:24.04', 'ubuntu']
])

/** Prepares a plan only. It never invokes APT, dpkg, shell, IPC, or SSH. */
export function prepareCaddyInstallPlan(
  host: CaddyInstallHost,
  apt: CaddyAptEvidence
): CaddyInstallPlanResult {
  if (!isCleanHostEligible(host.ingress)) {
    return blocked(
      'INSTALL_HOST_NOT_CLEAN',
      'Preflight must mark the host eligible before preparing a fresh install plan.'
    )
  }

  const distro = SUPPORTED_PLATFORMS.get(`${host.distroId}:${host.distroVersion}`)
  const architecture =
    host.architecture === 'x86_64'
      ? 'amd64'
      : host.architecture === 'aarch64'
        ? 'arm64'
        : host.architecture
  if (!distro || !['amd64', 'arm64'].includes(architecture)) {
    return blocked(
      'INSTALL_PLATFORM_UNSUPPORTED',
      'The distro release or architecture is outside the supported P1e matrix.'
    )
  }
  const supportedArchitecture = architecture as 'amd64' | 'arm64'

  if (
    !isOfficialAptSource(apt.sourceLine) ||
    apt.releaseSignature !== 'valid' ||
    apt.packageIndex !== 'authenticated' ||
    apt.originUri !== CADDY_STABLE_REPOSITORY.uri ||
    apt.suite !== CADDY_STABLE_REPOSITORY.suite ||
    apt.component !== CADDY_STABLE_REPOSITORY.component
  ) {
    return blocked(
      'APT_SOURCE_UNTRUSTED',
      'The official Caddy stable source or authenticated APT metadata could not be verified.'
    )
  }

  if (!isValidPackageMetadata(apt, supportedArchitecture)) {
    return blocked(
      'APT_METADATA_INVALID',
      'Caddy package metadata is missing or has an invalid version, architecture, origin, or SHA-256.'
    )
  }

  const stageDir = `/var/tmp/opspilot-caddy-stage-${apt.version}-${supportedArchitecture}`
  const extractedBinary = `${stageDir}/root/usr/bin/caddy`
  const versionDir = `/usr/local/lib/opspilot-caddy/versions/${apt.version}`
  const binaryPath = `${versionDir}/caddy`
  const packageFilename = apt.filename.split('/').at(-1)!
  const stagingScript = [
    '#!/bin/sh',
    'set -eu',
    `stage_dir='${stageDir}'`,
    `package_file='${packageFilename}'`,
    `expected_package_sha256='${apt.sha256.toLowerCase()}'`,
    'mkdir -m 0700 -- "$stage_dir"',
    'cd -- "$stage_dir"',
    `apt-get download 'caddy=${apt.version}'`,
    `printf '%s  %s\\n' "$expected_package_sha256" "$package_file" | sha256sum --check -`,
    'mkdir -m 0700 -- root',
    'dpkg-deb --extract "$package_file" root',
    `test -f '${extractedBinary}' && test ! -L '${extractedBinary}'`,
    `sha256sum -- '${extractedBinary}'`
  ].join('\n')

  const manifestTemplate =
    [
      'format=opspilot-caddy-installation-v1',
      `version=${apt.version}`,
      `architecture=${supportedArchitecture}`,
      'repository_channel=stable',
      `package_sha256=${apt.sha256.toLowerCase()}`,
      'binary_sha256=<sha256-from-staged-binary>'
    ].join('\n') + '\n'

  return {
    status: 'ready',
    plan: {
      distro,
      distroVersion: host.distroVersion,
      architecture: supportedArchitecture,
      version: apt.version,
      packageSha256: apt.sha256.toLowerCase(),
      packageFilename,
      repository: CADDY_STABLE_REPOSITORY,
      verificationSteps: [
        'Re-run the complete read-only ingress preflight immediately before staging.',
        'Require the exact official Caddy stable APT source and signed-by keyring shown in the plan.',
        'Run apt-get update with insecure repositories and unauthenticated packages disabled; stop unless the InRelease signature verifies.',
        'Read apt-cache policy/show output and confirm this exact origin, suite, version, architecture, filename, and authenticated SHA-256 before downloading.'
      ],
      stagingSteps: [
        'Download the exact caddy=<version> package with apt-get download only.',
        'Compare the downloaded package SHA-256 with the authenticated Packages index.',
        'Extract with dpkg-deb --extract into a private staging directory; do not invoke package maintainer scripts.',
        'Hash the extracted regular usr/bin/caddy file and retain that hash for INSTALLATION.'
      ],
      stagingScript,
      writePlan: {
        status: 'not-executed',
        serviceAccount: {
          name: 'opspilot-caddy',
          group: 'opspilot-caddy',
          shell: '/usr/sbin/nologin'
        },
        artifacts: [
          {
            path: '/usr/local/lib/opspilot-caddy',
            kind: 'directory',
            owner: 'root',
            group: 'root',
            mode: '0755'
          },
          {
            path: '/usr/local/lib/opspilot-caddy/versions',
            kind: 'directory',
            owner: 'root',
            group: 'root',
            mode: '0755'
          },
          { path: versionDir, kind: 'directory', owner: 'root', group: 'root', mode: '0755' },
          { path: binaryPath, kind: 'file', owner: 'root', group: 'root', mode: '0755' },
          {
            path: '/usr/bin/caddy',
            kind: 'symlink',
            owner: 'root',
            group: 'root',
            mode: '0777',
            target: binaryPath
          },
          { path: '/etc/opspilot', kind: 'directory', owner: 'root', group: 'root', mode: '0755' },
          {
            path: '/etc/opspilot/caddy',
            kind: 'directory',
            owner: 'root',
            group: 'opspilot-caddy',
            mode: '0750'
          },
          {
            path: '/etc/opspilot/caddy/Caddyfile',
            kind: 'file',
            owner: 'root',
            group: 'opspilot-caddy',
            mode: '0640',
            content: buildSharedIngressConfig([])
          },
          {
            path: '/etc/systemd/system/opspilot-caddy.service',
            kind: 'file',
            owner: 'root',
            group: 'root',
            mode: '0644',
            content: EXPECTED_OPSPILOT_UNIT
          },
          {
            path: '/etc/opspilot/caddy/OWNER',
            kind: 'file',
            owner: 'root',
            group: 'root',
            mode: '0644',
            content: 'opspilot-shared-ingress-v1\n'
          },
          {
            path: '/etc/opspilot/caddy/INSTALLATION',
            kind: 'file',
            owner: 'root',
            group: 'root',
            mode: '0644',
            content: manifestTemplate
          },
          {
            path: '/var/lib/opspilot',
            kind: 'directory',
            owner: 'root',
            group: 'root',
            mode: '0755'
          },
          {
            path: '/var/lib/opspilot/caddy',
            kind: 'directory',
            owner: 'opspilot-caddy',
            group: 'opspilot-caddy',
            mode: '0700'
          },
          {
            path: '/var/lib/opspilot/caddy/production',
            kind: 'directory',
            owner: 'opspilot-caddy',
            group: 'opspilot-caddy',
            mode: '0700'
          }
        ]
      },
      unitContents: EXPECTED_OPSPILOT_UNIT,
      installationManifest: {
        path: '/etc/opspilot/caddy/INSTALLATION',
        owner: 'root',
        group: 'root',
        mode: '0644',
        format: 'opspilot-caddy-installation-v1',
        template: manifestTemplate
      }
    }
  }
}

export function buildCaddyInstallationManifest(
  plan: Pick<CaddyInstallPlan, 'version' | 'architecture' | 'packageSha256'>,
  binarySha256: string
): string | null {
  if (
    !/^2\.\d+\.\d+$/.test(plan.version) ||
    !['amd64', 'arm64'].includes(plan.architecture) ||
    !/^[a-f0-9]{64}$/i.test(plan.packageSha256) ||
    !/^[a-f0-9]{64}$/i.test(binarySha256)
  )
    return null
  return (
    [
      'format=opspilot-caddy-installation-v1',
      `version=${plan.version}`,
      `architecture=${plan.architecture}`,
      'repository_channel=stable',
      `package_sha256=${plan.packageSha256.toLowerCase()}`,
      `binary_sha256=${binarySha256.toLowerCase()}`
    ].join('\n') + '\n'
  )
}

function isCleanHostEligible(ingress: IngressPreflightResult): boolean {
  return (
    ingress.install_assessment === 'safe' &&
    ingress.local_assessment === 'clear' &&
    ingress.service === 'absent' &&
    ingress.ownership === 'ports_free' &&
    ingress.ports_status === 'free' &&
    ingress.listeners.length === 0 &&
    ingress.ufw.state !== 'unknown'
  )
}

function isOfficialAptSource(sourceLine: string): boolean {
  const match = sourceLine.trim().match(/^deb \[([^\]]+)\] (\S+) (\S+) (\S+)$/)
  if (!match) return false
  const options = match[1].split(/\s+/)
  return (
    options.length === 1 &&
    options[0] === `signed-by=${CADDY_STABLE_REPOSITORY.signedBy}` &&
    match[2] === CADDY_STABLE_REPOSITORY.uri &&
    match[3] === CADDY_STABLE_REPOSITORY.suite &&
    match[4] === CADDY_STABLE_REPOSITORY.component
  )
}

function isValidPackageMetadata(apt: CaddyAptEvidence, architecture: string): boolean {
  return (
    apt.originUri === CADDY_STABLE_REPOSITORY.uri &&
    apt.suite === CADDY_STABLE_REPOSITORY.suite &&
    apt.component === CADDY_STABLE_REPOSITORY.component &&
    apt.package === 'caddy' &&
    /^2\.\d+\.\d+$/.test(apt.version) &&
    apt.architecture === architecture &&
    /^[a-f0-9]{64}$/i.test(apt.sha256) &&
    /^pool\/(?:[a-z0-9+._-]+\/)*caddy_[0-9][a-zA-Z0-9.+:~_-]*\/caddy_[0-9][a-zA-Z0-9.+:~_-]*_linux_(?:amd64|arm64)\.deb$/.test(
      apt.filename
    ) &&
    apt.filename.split('/').every((segment) => segment !== '.' && segment !== '..') &&
    apt.filename.endsWith(`/caddy_${apt.version}/caddy_${apt.version}_linux_${architecture}.deb`)
  )
}

function blocked(code: CaddyInstallPlanErrorCode, reason: string): CaddyInstallPlanResult {
  return { status: 'blocked', code, reason }
}
