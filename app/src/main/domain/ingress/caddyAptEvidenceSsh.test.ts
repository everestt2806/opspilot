import { mkdtempSync, rmSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  CADDY_STABLE_REPOSITORY,
  CADDY_STABLE_SIGNER_FINGERPRINT,
  collectCaddyAptEvidenceOverSsh,
  isVerifiedCaddyAptEvidence,
  CADDY_APT_SSH_TIMEOUT_MS,
  type CaddyAptEvidenceErrorCode
} from './caddyAptEvidence'
import type { SshManager, SshHostIdentity } from '../../ssh/manager'
import { prepareCaddyInstallPlanOverSsh } from './caddyInstallPreparation'
import { INGRESS_READ_COMMANDS } from './preflight'

const TARGET: SshHostIdentity = {
  vpsId: 31,
  host: 'vps.example.invalid',
  port: 2222,
  hostFingerprint: `SHA256:${'A'.repeat(43)}`
}
const roots: string[] = []

function snapshot(packagePaddingBytes = 0): {
  inRelease: Buffer
  packagesGzip: Buffer
  sourceLine: string
} {
  const root = mkdtempSync(path.join(tmpdir(), 'opspilot-apt-ssh-'))
  roots.push(root)
  const version = '2.11.7'
  const filename = `pool/any-version/main/c/ca/caddy_${version}/caddy_${version}_linux_amd64.deb`
  const paragraph =
    [
      'Package: caddy',
      `Version: ${version}`,
      'Architecture: amd64',
      `Filename: ${filename}`,
      `SHA256: ${'a'.repeat(64)}`,
      ''
    ].join('\n') + '\n'
  const packagesGzip = gzipSync(Buffer.from(paragraph + ' '.repeat(packagePaddingBytes)))
  const indexPath = 'main/binary-amd64/Packages.gz'
  const digest = createHash('sha256').update(packagesGzip).digest('hex')
  const signedBody = [
    'Origin: cloudsmith/caddy/stable',
    'Suite: any-version',
    'Codename: any-version',
    'Components: main',
    'SHA256:',
    ` ${digest} ${packagesGzip.length} ${indexPath}`,
    ''
  ].join('\n')
  const inRelease = Buffer.from(
    `-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\n${signedBody}-----BEGIN PGP SIGNATURE-----\nfixture\n`
  )
  return {
    inRelease,
    packagesGzip,
    sourceLine: `deb [signed-by=${CADDY_STABLE_REPOSITORY.signedBy}] ${CADDY_STABLE_REPOSITORY.uri} ${CADDY_STABLE_REPOSITORY.suite} ${CADDY_STABLE_REPOSITORY.component}`
  }
}

function fakeSsh(
  options: {
    mutate?: (response: Record<string, unknown>) => Record<string, unknown>
    identity?: SshHostIdentity
    error?: Error
    stdout?: string
    stderr?: string
    events?: string[]
  } = {}
): SshManager {
  const fixture = snapshot()
  const executor = vi.fn(async (_vpsId: number, command: string) => {
    if (command === INGRESS_READ_COMMANDS.platform) {
      options.events?.push('platform')
      return {
        identity: options.identity ?? TARGET,
        result: { code: 0, stdout: 'ID=ubuntu\nVERSION_ID="24.04"\nx86_64\n', stderr: '' }
      }
    }
    options.events?.push('apt-evidence')
    if (options.error) throw options.error
    const requestId = command.match(/-- ([a-f0-9]{32})$/)?.[1]
    if (!requestId) throw new Error('APT snapshot command did not include a request nonce')
    let response: Record<string, unknown> = {
      schema: 'opspilot-caddy-apt-v1',
      requestId,
      status: 'snapshot',
      architecture: 'amd64',
      sourceListB64: Buffer.from(fixture.sourceLine).toString('base64'),
      keyringPath: CADDY_STABLE_REPOSITORY.signedBy,
      inReleaseB64: fixture.inRelease.toString('base64'),
      packagesGzipB64: fixture.packagesGzip.toString('base64'),
      signatureStatusB64: Buffer.from(
        `[GNUPG:] VALIDSIG ${CADDY_STABLE_SIGNER_FINGERPRINT} 20261015 0 0 0 0 0 0 0 0 0\n`
      ).toString('base64')
    }
    response = options.mutate?.(response) ?? response
    return {
      identity: options.identity ?? TARGET,
      result: {
        code: 0,
        stdout: options.stdout ?? JSON.stringify(response),
        stderr: options.stderr ?? ''
      }
    }
  })
  return {
    execWithHostIdentity: executor,
    exec: vi.fn(async () => {
      options.events?.push('preflight')
      return { code: 1, stdout: '', stderr: '' }
    }),
    getHostIdentity: vi.fn(async () => {
      options.events?.push('identity-check')
      return options.identity ?? TARGET
    })
  } as unknown as SshManager
}

describe('collectCaddyAptEvidenceOverSsh', () => {
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  it('issues planner evidence only after the fixed command returns verified metadata for the pinned VPS', async () => {
    const ssh = fakeSsh()
    const result = await collectCaddyAptEvidenceOverSsh(ssh, TARGET)
    expect(result.status).toBe('verified')
    if (result.status !== 'verified') return
    expect(result.evidence).toMatchObject({
      target: TARGET,
      evidenceSource: 'pinned-ssh',
      architecture: 'amd64',
      version: '2.11.7',
      signerFingerprint: CADDY_STABLE_SIGNER_FINGERPRINT
    })
    expect(isVerifiedCaddyAptEvidence(result.evidence)).toBe(true)
    expect(ssh.execWithHostIdentity).toHaveBeenCalledWith(
      TARGET.vpsId,
      expect.stringContaining('/etc/apt/sources.list.d/caddy-stable.list'),
      expect.objectContaining({
        timeoutMs: CADDY_APT_SSH_TIMEOUT_MS,
        logCommand: false,
        retryOnReconnect: false,
        maxStdoutBytes: expect.any(Number),
        maxStderrBytes: expect.any(Number)
      })
    )
    const command = vi.mocked(ssh.execWithHostIdentity).mock.calls[0]?.[1] ?? ''
    expect(command).not.toContain(TARGET.host)
    expect(command).not.toContain('C:\\')
  })

  it('rejects a source/keyring missing on the VPS with remediation guidance', async () => {
    const ssh = fakeSsh({
      mutate: (response) => ({
        ...response,
        status: 'blocked',
        code: 'APT_SOURCE_MISSING'
      })
    })
    await expect(collectCaddyAptEvidenceOverSsh(ssh, TARGET)).resolves.toMatchObject({
      status: 'blocked',
      code: 'APT_SOURCE_MISSING',
      reason: expect.stringContaining('Configure the official signed source')
    })
    const keyringSsh = fakeSsh({
      mutate: (response) => ({
        ...response,
        status: 'blocked',
        code: 'APT_KEYRING_MISSING'
      })
    })
    await expect(collectCaddyAptEvidenceOverSsh(keyringSsh, TARGET)).resolves.toMatchObject({
      status: 'blocked',
      code: 'APT_KEYRING_MISSING',
      reason: expect.stringContaining('Install the official keyring')
    })
  })

  it.each([
    [
      'bad signature signer',
      (response: Record<string, unknown>) => ({
        ...response,
        signatureStatusB64: Buffer.from(
          `[GNUPG:] VALIDSIG ${'B'.repeat(40)} 0 0 0 0 0 0 0 0 0 0\n`
        ).toString('base64')
      }),
      'APT_SIGNATURE_INVALID'
    ],
    [
      'bad package index checksum',
      (response: Record<string, unknown>) => ({
        ...response,
        packagesGzipB64: Buffer.from(randomBytes(40)).toString('base64')
      }),
      'APT_INDEX_CHECKSUM_MISMATCH'
    ],
    [
      'wrong source',
      (response: Record<string, unknown>) => ({
        ...response,
        sourceListB64: Buffer.from('deb https://mirror.invalid/caddy stable main').toString(
          'base64'
        )
      }),
      'APT_SOURCE_UNTRUSTED'
    ],
    [
      'missing fields',
      (response: Record<string, unknown>) => ({
        schema: response.schema,
        requestId: response.requestId,
        status: response.status
      }),
      'APT_METADATA_INVALID'
    ]
  ] as Array<
    [
      string,
      (response: Record<string, unknown>) => Record<string, unknown>,
      CaddyAptEvidenceErrorCode
    ]
  >)('fails closed on %s', async (_label, mutate, code) => {
    await expect(
      collectCaddyAptEvidenceOverSsh(fakeSsh({ mutate }), TARGET)
    ).resolves.toMatchObject({
      status: 'blocked',
      code
    })
  })

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a primitive', '"snapshot"'],
    ['an invalid schema', '{"schema":"wrong","requestId":"x","status":"snapshot"}'],
    ['a missing schema', '{"requestId":"x","status":"snapshot"}']
  ])('blocks %s JSON before reading snapshot properties', async (_label, stdout) => {
    await expect(
      collectCaddyAptEvidenceOverSsh(fakeSsh({ stdout }), TARGET)
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'APT_METADATA_INVALID',
      reason: expect.stringContaining('invalid APT evidence object or schema')
    })
  })

  it('copies and freezes the verified target independently of caller and SSH identity objects', async () => {
    const callerTarget: SshHostIdentity = { ...TARGET }
    const returnedIdentity: SshHostIdentity = { ...TARGET }
    const ssh = fakeSsh({ identity: returnedIdentity })
    const pending = collectCaddyAptEvidenceOverSsh(ssh, callerTarget)
    callerTarget.vpsId = 999
    callerTarget.host = 'changed.example.invalid'
    const result = await pending
    expect(result.status).toBe('verified')
    if (result.status !== 'verified') return
    returnedIdentity.hostFingerprint = `SHA256:${'B'.repeat(43)}`
    expect(result.evidence.target).toEqual(TARGET)
    expect(Object.isFrozen(result.evidence.target)).toBe(true)
  })

  it('accepts large canonical base64 by scanning iteratively, with strict decoded-size boundaries', async () => {
    const maxBytes = 8 * 1024 * 1024
    const maxData = Buffer.alloc(maxBytes, 0x61).toString('base64')
    await expect(
      collectCaddyAptEvidenceOverSsh(
        fakeSsh({ mutate: (response) => ({ ...response, packagesGzipB64: maxData }) }),
        TARGET,
        { maxPackagesGzipBytes: maxBytes }
      )
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_INDEX_CHECKSUM_MISMATCH' })

    const nearLimitData = Buffer.alloc(maxBytes - 1, 0x61).toString('base64')
    await expect(
      collectCaddyAptEvidenceOverSsh(
        fakeSsh({ mutate: (response) => ({ ...response, packagesGzipB64: nearLimitData }) }),
        TARGET,
        { maxPackagesGzipBytes: maxBytes }
      )
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_INDEX_CHECKSUM_MISMATCH' })

    const overLimitData = Buffer.alloc(maxBytes + 1, 0x61).toString('base64')
    await expect(
      collectCaddyAptEvidenceOverSsh(
        fakeSsh({ mutate: (response) => ({ ...response, packagesGzipB64: overLimitData }) }),
        TARGET,
        { maxPackagesGzipBytes: maxBytes }
      )
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_METADATA_TOO_LARGE' })
  })

  it.each(['AAAA$AAA', 'AAAA====', 'AB=='])(
    'rejects malformed or noncanonical base64 %s',
    async (encoded) => {
      await expect(
        collectCaddyAptEvidenceOverSsh(
          fakeSsh({ mutate: (response) => ({ ...response, packagesGzipB64: encoded }) }),
          TARGET
        )
      ).resolves.toMatchObject({ status: 'blocked', code: 'APT_METADATA_INVALID' })
    }
  )

  it('rejects stale response nonces rather than using cached SSH JSON', async () => {
    await expect(
      collectCaddyAptEvidenceOverSsh(
        fakeSsh({ mutate: (response) => ({ ...response, requestId: '0'.repeat(32) }) }),
        TARGET
      )
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_STALE_RESPONSE' })
  })

  it('rejects an unknown remote blocking code instead of trusting JSON status', async () => {
    await expect(
      collectCaddyAptEvidenceOverSsh(
        fakeSsh({ mutate: (response) => ({ ...response, status: 'blocked', code: 'VERIFIED' }) }),
        TARGET
      )
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_METADATA_INVALID' })
  })

  it('rejects an SSH identity change even when the JSON snapshot is otherwise valid', async () => {
    await expect(
      collectCaddyAptEvidenceOverSsh(
        fakeSsh({ identity: { ...TARGET, host: 'other.example.invalid' } }),
        TARGET
      )
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_SSH_HOST_CHANGED' })
  })

  it('reruns read-only preflight after evidence collection before preparing the plan', async () => {
    const events: string[] = []
    const result = await prepareCaddyInstallPlanOverSsh(fakeSsh({ events }), TARGET)
    expect(events[0]).toBe('apt-evidence')
    expect(events[1]).toBe('platform')
    expect(events.at(-1)).toBe('identity-check')
    expect(events.slice(2, -1).length).toBeGreaterThan(0)
    expect(events.slice(2, -1).every((event) => event === 'preflight')).toBe(true)
    expect(result).toMatchObject({ status: 'blocked', code: 'INSTALL_HOST_NOT_CLEAN' })
  })

  it('maps an SSH disconnect and over-limit stdout to explicit fail-closed results', async () => {
    await expect(
      collectCaddyAptEvidenceOverSsh(fakeSsh({ error: new Error('connection closed') }), TARGET)
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_SSH_FAILED' })
    await expect(
      collectCaddyAptEvidenceOverSsh(fakeSsh({ stdout: 'x'.repeat(1025) }), TARGET, {
        maxSshOutputBytes: 1024
      })
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_SSH_OUTPUT_TOO_LARGE' })
    await expect(
      collectCaddyAptEvidenceOverSsh(fakeSsh(), TARGET, { maxSshOutputBytes: 0 })
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_METADATA_INVALID' })
    await expect(
      collectCaddyAptEvidenceOverSsh(fakeSsh({ stderr: 'x'.repeat(16 * 1024 + 1) }), TARGET)
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_SSH_OUTPUT_TOO_LARGE' })
  })

  it('rejects oversized InRelease, Packages.gz and decompressed index data', async () => {
    await expect(
      collectCaddyAptEvidenceOverSsh(fakeSsh(), TARGET, { maxInReleaseBytes: 16 })
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_METADATA_TOO_LARGE' })
    await expect(
      collectCaddyAptEvidenceOverSsh(fakeSsh(), TARGET, { maxPackagesGzipBytes: 16 })
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_METADATA_TOO_LARGE' })
    const expandedFixture = snapshot(4096)
    const expandedSsh = fakeSsh({
      mutate: (response) => ({
        ...response,
        packagesGzipB64: expandedFixture.packagesGzip.toString('base64'),
        inReleaseB64: expandedFixture.inRelease.toString('base64')
      })
    })
    await expect(
      collectCaddyAptEvidenceOverSsh(expandedSsh, TARGET, { maxPackagesUncompressedBytes: 512 })
    ).resolves.toMatchObject({ status: 'blocked', code: 'APT_METADATA_TOO_LARGE' })
  })
})
