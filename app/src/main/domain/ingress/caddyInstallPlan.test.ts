import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { IngressPreflightResult } from './preflight'
import { EXPECTED_OPSPILOT_UNIT } from './preflight'
import {
  collectCaddyAptEvidenceOverSsh,
  CADDY_STABLE_REPOSITORY,
  CADDY_STABLE_SIGNER_FINGERPRINT,
  type CaddyAptEvidence
} from './caddyAptEvidence'
import type { SshManager } from '../../ssh/manager'
import {
  buildCaddyInstallationManifest,
  prepareCaddyInstallPlan,
  type CaddyInstallHost
} from './caddyInstallPlan'

const packageHash = 'a22b914ffd1958da42bc7ab13b7b62c6100634e0798ab594891d2d61d53ba749'
const snapshotRoots: string[] = []
let aptEvidence: CaddyAptEvidence
const TARGET = {
  vpsId: 17,
  host: 'vps.example.test',
  port: 2222,
  hostFingerprint: `SHA256:${'A'.repeat(43)}`
}

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
    target: TARGET,
    ...overrides
  }
}

async function verifiedEvidence(architecture: 'amd64' | 'arm64'): Promise<CaddyAptEvidence> {
  const root = mkdtempSync(path.join(tmpdir(), 'opspilot-caddy-plan-'))
  snapshotRoots.push(root)
  const keyringPath = path.join(root, 'caddy-keyring.gpg')
  const sourceListPath = path.join(root, 'sources.list')
  const inReleasePath = path.join(root, 'InRelease')
  const packagesGzipPath = path.join(root, 'Packages.gz')
  const version = '2.11.7'
  const filename = `pool/any-version/main/c/ca/caddy_${version}/caddy_${version}_linux_${architecture}.deb`
  const packageParagraph =
    [
      'Package: caddy',
      `Version: ${version}`,
      `Architecture: ${architecture}`,
      `Filename: ${filename}`,
      `SHA256: ${packageHash}`,
      ''
    ].join('\n') + '\n'
  const packagesGzip = gzipSync(Buffer.from(packageParagraph))
  const indexPath = `main/binary-${architecture}/Packages.gz`
  const signedBody = [
    'Origin: cloudsmith/caddy/stable',
    'Suite: any-version',
    'Codename: any-version',
    'Components: main',
    'SHA256:',
    ` ${createHash('sha256').update(packagesGzip).digest('hex')} ${packagesGzip.length} ${indexPath}`,
    'SHA512:',
    ` ${'c'.repeat(128)} ${packagesGzip.length} ${indexPath}`,
    ''
  ].join('\n')

  writeFileSync(keyringPath, 'test keyring')
  writeFileSync(
    sourceListPath,
    `deb [signed-by=${keyringPath}] ${CADDY_STABLE_REPOSITORY.uri} any-version main\n`
  )
  writeFileSync(
    inReleasePath,
    `-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\n${signedBody}-----BEGIN PGP SIGNATURE-----\nmock\n`
  )
  writeFileSync(packagesGzipPath, packagesGzip)
  const sourceLine = `deb [signed-by=${CADDY_STABLE_REPOSITORY.signedBy}] ${CADDY_STABLE_REPOSITORY.uri} any-version main`
  const ssh = {
    execWithHostIdentity: vi.fn(async (_vpsId: number, command: string) => {
      const requestId = command.match(/-- ([a-f0-9]{32})$/)?.[1]
      if (!requestId) throw new Error('missing request id')
      return {
        identity: TARGET,
        result: {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            schema: 'opspilot-caddy-apt-v1',
            requestId,
            status: 'snapshot',
            architecture,
            sourceListB64: Buffer.from(sourceLine).toString('base64'),
            keyringPath: CADDY_STABLE_REPOSITORY.signedBy,
            inReleaseB64: readFileSync(inReleasePath).toString('base64'),
            packagesGzipB64: readFileSync(packagesGzipPath).toString('base64'),
            signatureStatusB64: Buffer.from(
              `[GNUPG:] VALIDSIG ${CADDY_STABLE_SIGNER_FINGERPRINT} 20261015 0 0 0 0 0 0 0 0 0\n`
            ).toString('base64')
          })
        }
      }
    })
  }
  const result = await collectCaddyAptEvidenceOverSsh(ssh as unknown as SshManager, TARGET)
  if (result.status !== 'verified') throw new Error(result.reason)
  return result.evidence
}

describe('prepareCaddyInstallPlan', () => {
  beforeAll(async () => {
    aptEvidence = await verifiedEvidence('amd64')
  })

  afterAll(() => {
    for (const root of snapshotRoots) rmSync(root, { recursive: true, force: true })
  })

  it('pins a collector-verified package and plans isolated download/extract only', () => {
    const result = prepareCaddyInstallPlan(cleanHost(), aptEvidence)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    expect(result.plan).toMatchObject({
      distro: 'debian',
      distroVersion: '12',
      architecture: 'amd64',
      version: '2.11.7',
      packageSha256: packageHash,
      packageFilename: 'caddy_2.11.7_amd64.deb'
    })
    expect(result.plan.repository).toEqual(CADDY_STABLE_REPOSITORY)
    expect(result.plan.unitContents).toBe(EXPECTED_OPSPILOT_UNIT)
    expect(result.plan.writePlan.status).toBe('not-executed')
    expect(
      result.plan.writePlan.artifacts.find((artifact) =>
        artifact.path.endsWith('opspilot-caddy.service')
      )
    ).toMatchObject({ owner: 'root', group: 'root', mode: '0644', content: EXPECTED_OPSPILOT_UNIT })
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
          path: '/var/lib/opspilot/caddy/production',
          owner: 'opspilot-caddy',
          group: 'opspilot-caddy',
          mode: '0700'
        })
      ])
    )
    expect(result.plan.installationManifest).toMatchObject({
      path: '/etc/opspilot/caddy/INSTALLATION',
      mode: '0644'
    })
    expect(result.plan.stagingScript).toContain(
      "apt_get download --print-uris --yes 'caddy=2.11.7'"
    )
    expect(result.plan.stagingScript).toContain("apt_get download 'caddy=2.11.7'")
    expect(result.plan.stagingScript).toContain('dpkg-deb --extract')
    expect(result.plan.stagingScript).toContain('apt_get update')
    expect(result.plan.stagingScript).toContain('expected_uri=')
    expect(result.plan.stagingScript).toContain('[ -s "$package_file" ]')
    expect(result.plan.stagingScript).toContain('sha256sum --check -')
    expect(result.plan.stagingScript).toContain(
      'tar -xOf "$stage_dir/package-data.tar" ./usr/bin/caddy'
    )
    expect(result.plan.stagingScript).toContain(
      '[ "$actual_binary_sha256" = "$expected_binary_sha256" ]'
    )
    expect(result.plan.stagingScript).not.toMatch(
      /apt(?:-get)?\s+install|dpkg\s+-i|systemctl|\bservice\s|caddy\s+(?:run|start|upgrade)/i
    )
  })

  it('rejects caller-created valid/authenticated flags without collector evidence', () => {
    expect(
      prepareCaddyInstallPlan(cleanHost(), {
        ...aptEvidence,
        releaseSignature: 'valid',
        packageIndex: 'authenticated'
      } as unknown as CaddyAptEvidence)
    ).toMatchObject({ status: 'blocked', code: 'APT_SOURCE_UNTRUSTED' })
  })

  it('rejects pinned SSH evidence when the target VPS or fingerprint differs', () => {
    expect(
      prepareCaddyInstallPlan(
        cleanHost({ target: { ...TARGET, vpsId: TARGET.vpsId + 1 } }),
        aptEvidence
      )
    ).toMatchObject({ status: 'blocked', code: 'APT_SSH_HOST_CHANGED' })
    expect(
      prepareCaddyInstallPlan(
        cleanHost({ target: { ...TARGET, hostFingerprint: `SHA256:${'B'.repeat(43)}` } }),
        aptEvidence
      )
    ).toMatchObject({ status: 'blocked', code: 'APT_SSH_HOST_CHANGED' })
  })

  it('rejects pinned SSH evidence after the five minute freshness window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(aptEvidence.issuedAt + 5 * 60_000 + 1))
    try {
      expect(prepareCaddyInstallPlan(cleanHost(), aptEvidence)).toMatchObject({
        status: 'blocked',
        code: 'APT_EVIDENCE_STALE'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps Ubuntu arm64 evidence selected by the pinned SSH adapter', async () => {
    const result = prepareCaddyInstallPlan(
      cleanHost({ distroId: 'ubuntu', distroVersion: '24.04', architecture: 'aarch64' }),
      await verifiedEvidence('arm64')
    )
    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.plan.architecture).toBe('arm64')
  })

  it('requires a clean-host preflight before considering repository evidence', () => {
    expect(
      prepareCaddyInstallPlan(
        cleanHost({ ingress: cleanIngress({ service: 'verified' }) }),
        aptEvidence
      )
    ).toMatchObject({
      status: 'blocked',
      code: 'INSTALL_HOST_NOT_CLEAN'
    })
  })

  it.each([
    ['unsupported distro', { distroId: 'alpine', distroVersion: '3.20' }],
    ['unsupported Ubuntu release', { distroId: 'ubuntu', distroVersion: '20.04' }],
    ['unsupported architecture', { architecture: 'riscv64' }]
  ])('rejects %s', (_label, platform) => {
    expect(prepareCaddyInstallPlan(cleanHost(platform), aptEvidence)).toMatchObject({
      status: 'blocked',
      code: 'INSTALL_PLATFORM_UNSUPPORTED'
    })
  })

  it('builds INSTALLATION only from a well-formed staged binary hash', () => {
    const result = prepareCaddyInstallPlan(cleanHost(), aptEvidence)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(buildCaddyInstallationManifest(result.plan, 'b'.repeat(64))).toContain(
      `binary_sha256=${'b'.repeat(64)}`
    )
    expect(buildCaddyInstallationManifest(result.plan, 'wrong-hash')).toBeNull()
    expect(
      buildCaddyInstallationManifest({ ...result.plan, version: '2.0.0;touch' }, 'b'.repeat(64))
    ).toBeNull()
  })
})
