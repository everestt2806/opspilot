import { EXPECTED_OPSPILOT_UNIT, type IngressPreflightResult } from './preflight'
import { buildSharedIngressConfig } from './routeBuilder'
import {
  CADDY_STABLE_REPOSITORY,
  CADDY_APT_EVIDENCE_MAX_AGE_MS,
  isVerifiedCaddyAptEvidence,
  type CaddyAptTargetBinding,
  type CaddyAptEvidence,
  type CaddyAptEvidenceErrorCode
} from './caddyAptEvidence'

export { CADDY_STABLE_REPOSITORY } from './caddyAptEvidence'
export type { CaddyAptEvidence } from './caddyAptEvidence'

export interface CaddyInstallHost {
  ingress: IngressPreflightResult
  distroId: string
  distroVersion: string
  architecture: string
  target: CaddyAptTargetBinding
}

export type CaddyInstallPlanErrorCode =
  | 'INSTALL_HOST_NOT_CLEAN'
  | 'INSTALL_PLATFORM_UNSUPPORTED'
  | 'APT_SOURCE_UNTRUSTED'
  | 'APT_METADATA_INVALID'
  | 'APT_SSH_HOST_CHANGED'
  | 'APT_EVIDENCE_STALE'
  | CaddyAptEvidenceErrorCode

export type CaddyInstallPlanResult =
  | { status: 'ready'; plan: CaddyInstallPlan }
  | { status: 'blocked'; code: CaddyInstallPlanErrorCode; reason: string }

export interface CaddyInstallPlan {
  distro: 'debian' | 'ubuntu'
  distroVersion: string
  architecture: 'amd64' | 'arm64'
  version: string
  packageSha256: string
  downloadUri: string
  issuedAt: number
  target: CaddyAptTargetBinding
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

const verifiedInstallPlans = new WeakSet<object>()

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

  if (!isVerifiedCaddyAptEvidence(apt)) {
    return blocked(
      'APT_SOURCE_UNTRUSTED',
      'APT evidence must come from the Caddy repository collector, not caller-provided status flags.'
    )
  }

  if (apt.evidenceSource !== 'pinned-ssh' || apt.target === null) {
    return blocked(
      'APT_SOURCE_UNTRUSTED',
      'Only APT evidence collected and verified over the pinned SSH adapter can be used for a VPS install plan.'
    )
  }
  if (!sameTarget(host.target, apt.target)) {
    return blocked(
      'APT_SSH_HOST_CHANGED',
      'APT evidence belongs to a different VPS or pinned SSH host.'
    )
  }
  if (Date.now() - apt.issuedAt < 0 || Date.now() - apt.issuedAt > CADDY_APT_EVIDENCE_MAX_AGE_MS) {
    return blocked(
      'APT_EVIDENCE_STALE',
      'APT evidence is stale; refresh SSH evidence and preflight before preparing an install plan.'
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
  const packageFilename = apt.outputFilename
  const expectedUri = apt.downloadUri
  const stagingScript = [
    '#!/bin/sh',
    'set -eu',
    `stage_dir='${stageDir}'`,
    'apt_root="$stage_dir/apt"',
    'source_list="$apt_root/caddy.list"',
    `package_file='${packageFilename}'`,
    `expected_uri='${expectedUri}'`,
    `expected_package_sha256='${apt.sha256.toLowerCase()}'`,
    'mkdir -m 0700 -- "$stage_dir"',
    'mkdir -m 0700 -p -- "$apt_root/lists/partial" "$apt_root/archives/partial"',
    'touch "$apt_root/status"',
    `printf '%s\\n' 'deb [signed-by=${apt.keyringPath}] ${CADDY_STABLE_REPOSITORY.uri} ${CADDY_STABLE_REPOSITORY.suite} ${CADDY_STABLE_REPOSITORY.component}' > "$source_list"`,
    'apt_get() { apt-get -o "Dir::Etc::sourcelist=$source_list" -o Dir::Etc::sourceparts=- -o "Dir::State::lists=$apt_root/lists" -o "Dir::State::status=$apt_root/status" -o "Dir::Cache::archives=$apt_root/archives" -o "Dir::Cache::pkgcache=$apt_root/pkgcache" -o "Dir::Cache::srcpkgcache=$apt_root/srcpkgcache" -o Acquire::AllowInsecureRepositories=false -o APT::Get::List-Cleanup=0 "$@"; }',
    'cd -- "$stage_dir"',
    'apt_get update',
    `apt_get download --print-uris --yes 'caddy=${apt.version}' > "$stage_dir/uris.txt"`,
    '[ "$(wc -l < "$stage_dir/uris.txt")" -eq 1 ]',
    'printed_uri=$(awk \'{print $1}\' "$stage_dir/uris.txt" | tr -d "\\047")',
    'printed_filename=$(awk \'{print $2}\' "$stage_dir/uris.txt")',
    '[ "$printed_uri" = "$expected_uri" ] && [ "$printed_filename" = "$package_file" ]',
    `apt_get download 'caddy=${apt.version}'`,
    '[ -s "$package_file" ]',
    `printf '%s  %s\\n' "$expected_package_sha256" "$package_file" | sha256sum --check -`,
    'dpkg-deb --fsys-tarfile "$package_file" > "$stage_dir/package-data.tar"',
    'tar -xOf "$stage_dir/package-data.tar" ./usr/bin/caddy > "$stage_dir/authenticated-caddy"',
    'expected_binary_sha256=$(sha256sum -- "$stage_dir/authenticated-caddy" | awk \'{print $1}\')',
    'rm -- "$stage_dir/package-data.tar" "$stage_dir/authenticated-caddy"',
    'mkdir -m 0700 -- root',
    'dpkg-deb --extract "$package_file" root',
    `test -f '${extractedBinary}' && test ! -L '${extractedBinary}'`,
    `actual_binary_sha256=$(sha256sum -- '${extractedBinary}' | awk '{print $1}')`,
    '[ "$actual_binary_sha256" = "$expected_binary_sha256" ]',
    'printf "%s  %s\\n" "$actual_binary_sha256" "usr/bin/caddy"'
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

  const result: CaddyInstallPlanResult = {
    status: 'ready',
    plan: Object.freeze<CaddyInstallPlan>({
      distro,
      distroVersion: host.distroVersion,
      architecture: supportedArchitecture,
      version: apt.version,
      packageSha256: apt.sha256.toLowerCase(),
      downloadUri: apt.downloadUri,
      issuedAt: apt.issuedAt,
      target: Object.freeze({ ...apt.target }),
      packageFilename,
      repository: CADDY_STABLE_REPOSITORY,
      verificationSteps: [
        'Re-run the complete read-only ingress preflight immediately before staging.',
        'Use collectCaddyAptEvidence; it checks the single stable source, pinned signer fingerprint, InRelease signature, Packages index checksum, and selected package fields.',
        'The staging script creates a private APT source-list/cache and runs apt-get update with insecure repositories disabled.',
        'Require apt-get download --print-uris to match the exact authenticated package URI and output filename before downloading.'
      ],
      stagingSteps: [
        'Download the exact caddy=<version> package from an isolated APT source-list/cache only.',
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
    })
  }
  if (result.status === 'ready') verifiedInstallPlans.add(result.plan)
  return result
}

export function isVerifiedCaddyInstallPlan(plan: CaddyInstallPlan): boolean {
  return verifiedInstallPlans.has(plan)
}

function sameTarget(left: CaddyAptTargetBinding, right: CaddyAptTargetBinding): boolean {
  return (
    left.vpsId === right.vpsId &&
    left.host === right.host &&
    left.port === right.port &&
    left.hostFingerprint === right.hostFingerprint
  )
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
  return new RegExp(
    `^deb \\[signed-by=[^\\s\\]]+\\] ${escapeRegExp(CADDY_STABLE_REPOSITORY.uri)} ${CADDY_STABLE_REPOSITORY.suite} ${CADDY_STABLE_REPOSITORY.component}$`
  ).test(sourceLine.trim())
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
    apt.outputFilename === `caddy_${apt.version}_${architecture}.deb` &&
    /^pool\/(?:[a-z0-9+._-]+\/)*caddy_[0-9][a-zA-Z0-9.+:~_-]*\/caddy_[0-9][a-zA-Z0-9.+:~_-]*_linux_(?:amd64|arm64)\.deb$/.test(
      apt.filename
    ) &&
    apt.filename.split('/').every((segment) => segment !== '.' && segment !== '..') &&
    apt.filename.endsWith(`/caddy_${apt.version}/caddy_${apt.version}_linux_${architecture}.deb`) &&
    apt.downloadUri === `${CADDY_STABLE_REPOSITORY.uri}/${apt.filename}`
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function blocked(code: CaddyInstallPlanErrorCode, reason: string): CaddyInstallPlanResult {
  return { status: 'blocked', code, reason }
}
