import { describe, expect, it } from 'vitest'

import type { IngressPreflightResult } from './preflight'
import { EXPECTED_OPSPILOT_UNIT } from './preflight'
import {
  buildCaddyInstallationManifest,
  CADDY_STABLE_REPOSITORY,
  prepareCaddyInstallPlan,
  type CaddyAptEvidence,
  type CaddyInstallHost
} from './caddyInstallPlan'

const sha256 = 'a22b914ffd1958da42bc7ab13b7b62c6100634e0798ab594891d2d61d53ba749'

function cleanIngress(overrides: Partial<IngressPreflightResult> = {}): IngressPreflightResult {
  return {
    ownership: 'ports_free',
    ports_status: 'free',
    install_assessment: 'safe',
    local_assessment: 'clear',
    reason_code: null,
    listeners: [],
    service: 'absent',
    caddy_version: null,
    ownership_marker: 'missing',
    config_exists: false,
    config_readable: false,
    ufw: {
      state: 'inactive',
      inbound_80: 'not_applicable',
      inbound_443: 'not_applicable',
      inbound_80_ipv4: 'not_applicable',
      inbound_80_ipv6: 'not_applicable',
      inbound_443_ipv4: 'not_applicable',
      inbound_443_ipv6: 'not_applicable'
    },
    route_activation: 'not_evaluated',
    ...overrides
  }
}

function cleanHost(overrides: Partial<CaddyInstallHost> = {}): CaddyInstallHost {
  return {
    ingress: cleanIngress(),
    distroId: 'debian',
    distroVersion: '12',
    architecture: 'x86_64',
    ...overrides
  }
}

function validApt(overrides: Partial<CaddyAptEvidence> = {}): CaddyAptEvidence {
  return {
    sourceLine: `deb [signed-by=${CADDY_STABLE_REPOSITORY.signedBy}] ${CADDY_STABLE_REPOSITORY.uri} ${CADDY_STABLE_REPOSITORY.suite} ${CADDY_STABLE_REPOSITORY.component}`,
    releaseSignature: 'valid',
    packageIndex: 'authenticated',
    originUri: CADDY_STABLE_REPOSITORY.uri,
    suite: 'any-version',
    component: 'main',
    package: 'caddy',
    version: '2.11.7',
    architecture: 'amd64',
    filename: 'pool/any-version/main/c/ca/caddy_2.11.7/caddy_2.11.7_linux_amd64.deb',
    sha256,
    ...overrides
  }
}

describe('prepareCaddyInstallPlan', () => {
  it('pins a supported Debian package and plans download/extract without installing or starting a service', () => {
    const result = prepareCaddyInstallPlan(cleanHost(), validApt())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    expect(result.plan).toMatchObject({
      distro: 'debian',
      distroVersion: '12',
      architecture: 'amd64',
      version: '2.11.7',
      packageSha256: sha256
    })
    expect(result.plan.repository).toEqual(CADDY_STABLE_REPOSITORY)
    expect(result.plan.unitContents).toBe(EXPECTED_OPSPILOT_UNIT)
    expect(result.plan.writePlan).toMatchObject({
      status: 'not-executed',
      serviceAccount: {
        name: 'opspilot-caddy',
        group: 'opspilot-caddy',
        shell: '/usr/sbin/nologin'
      }
    })
    expect(
      result.plan.writePlan.artifacts.find((artifact) =>
        artifact.path.endsWith('opspilot-caddy.service')
      )
    ).toMatchObject({
      owner: 'root',
      group: 'root',
      mode: '0644',
      content: EXPECTED_OPSPILOT_UNIT
    })
    expect(result.plan.writePlan.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/etc/opspilot/caddy/Caddyfile',
          owner: 'root',
          group: 'opspilot-caddy',
          mode: '0640',
          content: expect.stringContaining('storage file_system /var/lib/opspilot/caddy/production')
        }),
        expect.objectContaining({
          path: '/etc/opspilot/caddy/Caddyfile',
          owner: 'root',
          group: 'opspilot-caddy',
          mode: '0640'
        }),
        expect.objectContaining({
          path: '/var/lib/opspilot/caddy/production',
          owner: 'opspilot-caddy',
          group: 'opspilot-caddy',
          mode: '0700'
        })
      ])
    )
    expect(result.plan.installationManifest).toMatchObject({
      path: '/etc/opspilot/caddy/INSTALLATION',
      owner: 'root',
      group: 'root',
      mode: '0644'
    })
    expect(result.plan.installationManifest.template).toContain(`package_sha256=${sha256}`)
    expect(result.plan.installationManifest.template).toContain(
      'binary_sha256=<sha256-from-staged-binary>'
    )
    expect(result.plan.stagingScript).toContain("apt-get download 'caddy=2.11.7'")
    expect(result.plan.stagingScript).toContain('dpkg-deb --extract')
    expect(result.plan.stagingScript).toContain('sha256sum --check -')
    expect(`${result.plan.verificationSteps.join('\n')}\n${result.plan.stagingScript}`).not.toMatch(
      /apt(?:-get)?\s+install|dpkg\s+-i|systemctl|\bservice\s|caddy\s+(?:run|start|upgrade)/i
    )
  })

  it('maps Ubuntu arm64 to the package architecture from authenticated metadata', () => {
    const result = prepareCaddyInstallPlan(
      cleanHost({ distroId: 'ubuntu', distroVersion: '24.04', architecture: 'aarch64' }),
      validApt({
        version: '2.10.2',
        architecture: 'arm64',
        filename: 'pool/any-version/main/c/ca/caddy_2.10.2/caddy_2.10.2_linux_arm64.deb'
      })
    )
    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.plan.architecture).toBe('arm64')
  })

  it('refuses to prepare a plan unless preflight describes a clean host', () => {
    const result = prepareCaddyInstallPlan(
      cleanHost({ ingress: cleanIngress({ service: 'verified' }) }),
      validApt()
    )
    expect(result).toMatchObject({ status: 'blocked', code: 'INSTALL_HOST_NOT_CLEAN' })
  })

  it.each([
    ['unsupported distro', { distroId: 'alpine', distroVersion: '3.20' }],
    ['unsupported Ubuntu release', { distroId: 'ubuntu', distroVersion: '20.04' }],
    ['unsupported architecture', { architecture: 'riscv64' }]
  ])('rejects %s', (_label, platform) => {
    expect(prepareCaddyInstallPlan(cleanHost(platform), validApt())).toMatchObject({
      status: 'blocked',
      code: 'INSTALL_PLATFORM_UNSUPPORTED'
    })
  })

  it.each([
    [
      'foreign repository line',
      { sourceLine: 'deb https://packages.example.invalid/caddy stable main' }
    ],
    ['foreign origin', { originUri: 'https://packages.example.invalid/caddy' }],
    ['wrong suite', { suite: 'testing' }],
    ['unsigned release', { releaseSignature: 'unknown' as const }],
    ['unauthenticated package index', { packageIndex: 'unauthenticated' as const }]
  ])('blocks %s', (_label, metadata) => {
    expect(prepareCaddyInstallPlan(cleanHost(), validApt(metadata))).toMatchObject({
      status: 'blocked',
      code: 'APT_SOURCE_UNTRUSTED'
    })
  })

  it.each([
    ['non-stable version', { version: '2.10.2~beta1' }],
    ['wrong architecture', { architecture: 'arm64' }],
    ['malformed package hash', { sha256: 'not-a-sha256' }],
    ['missing package hash', { sha256: '' }],
    ['wrong package name', { package: 'caddy-beta' }],
    [
      'unsafe package filename',
      { filename: 'pool/../../tmp/caddy_2.11.7/caddy_2.11.7_linux_amd64.deb' }
    ],
    [
      'filename architecture mismatch',
      { filename: 'pool/any-version/main/c/ca/caddy_2.11.7/caddy_2.11.7_linux_arm64.deb' }
    ],
    [
      'filename version mismatch',
      { filename: 'pool/any-version/main/c/ca/caddy_2.10.2/caddy_2.10.2_linux_amd64.deb' }
    ]
  ])('rejects %s metadata', (_label, metadata) => {
    expect(prepareCaddyInstallPlan(cleanHost(), validApt(metadata))).toMatchObject({
      status: 'blocked',
      code: 'APT_METADATA_INVALID'
    })
  })

  it('builds a preflight-compatible INSTALLATION manifest only after a valid binary hash exists', () => {
    const result = prepareCaddyInstallPlan(cleanHost(), validApt())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(buildCaddyInstallationManifest(result.plan, 'b'.repeat(64))).toBe(
      `format=opspilot-caddy-installation-v1\nversion=2.11.7\narchitecture=amd64\nrepository_channel=stable\npackage_sha256=${sha256}\nbinary_sha256=${'b'.repeat(64)}\n`
    )
    expect(buildCaddyInstallationManifest(result.plan, 'missing')).toBeNull()
    expect(
      buildCaddyInstallationManifest({ ...result.plan, version: '2.0.0;touch' }, 'b'.repeat(64))
    ).toBeNull()
  })
})
