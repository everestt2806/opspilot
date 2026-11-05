import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  CADDY_STABLE_REPOSITORY,
  CADDY_STABLE_SIGNER_FINGERPRINT,
  collectCaddyAptEvidence,
  validateAptDownloadUriOutput
} from './caddyAptEvidence'

const verifierState = vi.hoisted(() => ({ output: '', shouldFail: false }))
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => {
    if (verifierState.shouldFail) throw new Error('gpgv rejected signature')
    return verifierState.output
  })
}))

const roots: string[] = []
const packageSha = 'a22b914ffd1958da42bc7ab13b7b62c6100634e0798ab594891d2d61d53ba749'

function packageParagraph(
  version: string,
  architecture = 'amd64',
  filenameOverride?: string
): string {
  const filename =
    filenameOverride ??
    `pool/any-version/main/c/ca/caddy_${version}/caddy_${version}_linux_${architecture}.deb`
  return (
    [
      'Package: caddy',
      `Version: ${version}`,
      `Architecture: ${architecture}`,
      `Filename: ${filename}`,
      `SHA256: ${packageSha}`,
      ''
    ].join('\n') + '\n'
  )
}

function createSnapshot(
  options: {
    sourceSuffix?: string
    packageData?: string
    checksumOverride?: string
    architecture?: 'amd64' | 'arm64'
  } = {}
): {
  root: string
  keyringPath: string
  sourceListPath: string
  inReleasePath: string
  packagesGzipPath: string
  architecture: 'amd64' | 'arm64'
} {
  const architecture = options.architecture ?? 'amd64'
  const root = mkdtempSync(path.join(tmpdir(), 'opspilot-caddy-apt-'))
  roots.push(root)
  const keyringPath = path.join(root, 'caddy-keyring.gpg')
  const sourceListPath = path.join(root, 'sources.list')
  const inReleasePath = path.join(root, 'InRelease')
  const packagesGzipPath = path.join(root, 'Packages.gz')
  const indexPath = `main/binary-${architecture}/Packages.gz`
  const packageData = Buffer.from(
    options.packageData ??
      packageParagraph('2.11.7') +
        packageParagraph('2.11.6') +
        packageParagraph('2.4.3', 'amd64', 'pool/any-version/main/c/ca/caddy_2.4.3_linux_amd64.deb')
  )
  const packagesGzip = gzipSync(packageData)
  const digest = options.checksumOverride ?? createHash('sha256').update(packagesGzip).digest('hex')
  const body = [
    'Origin: cloudsmith/caddy/stable',
    'Suite: any-version',
    'Codename: any-version',
    'Components: main',
    'SHA256:',
    ` ${digest} ${packagesGzip.length} ${indexPath}`,
    'SHA512:',
    ` ${'c'.repeat(128)} ${packagesGzip.length} ${indexPath}`,
    ''
  ].join('\n')
  const keyring = Buffer.from('mock public keyring')
  writeFileSync(keyringPath, keyring, { mode: 0o600 })
  const line = `deb [signed-by=${keyringPath}] ${CADDY_STABLE_REPOSITORY.uri} any-version main`
  writeFileSync(sourceListPath, `${line}${options.sourceSuffix ?? ''}\n`)
  writeFileSync(
    inReleasePath,
    `-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\n${body}-----BEGIN PGP SIGNATURE-----\nmock signature\n`
  )
  writeFileSync(packagesGzipPath, packagesGzip)
  verifierState.output = `[GNUPG:] VALIDSIG ${CADDY_STABLE_SIGNER_FINGERPRINT} 20261015 0 0 0 0 0 0 0 0 0\n`
  verifierState.shouldFail = false
  return { root, keyringPath, sourceListPath, inReleasePath, packagesGzipPath, architecture }
}

describe('collectCaddyAptEvidence', () => {
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  it('authenticates the source, signer, index checksum and selects the newest matching package', () => {
    const snapshot = createSnapshot()
    const result = collectCaddyAptEvidence(snapshot)
    expect(result.status, JSON.stringify(result)).toBe('verified')
    if (result.status !== 'verified') return
    expect(result.evidence).toMatchObject({
      version: '2.11.7',
      architecture: 'amd64',
      filename: 'pool/any-version/main/c/ca/caddy_2.11.7/caddy_2.11.7_linux_amd64.deb',
      outputFilename: 'caddy_2.11.7_amd64.deb',
      downloadUri: `${CADDY_STABLE_REPOSITORY.uri}/pool/any-version/main/c/ca/caddy_2.11.7/caddy_2.11.7_linux_amd64.deb`,
      sha256: packageSha,
      signerFingerprint: CADDY_STABLE_SIGNER_FINGERPRINT
    })
    expect(Object.isFrozen(result.evidence)).toBe(true)
  })

  it('rejects a failed InRelease signature', () => {
    const snapshot = createSnapshot()
    verifierState.shouldFail = true
    expect(collectCaddyAptEvidence(snapshot)).toMatchObject({
      status: 'blocked',
      code: 'APT_SIGNATURE_INVALID'
    })
  })

  it('rejects a signature by any key other than the pinned Caddy signer', () => {
    const snapshot = createSnapshot()
    verifierState.output = `[GNUPG:] VALIDSIG ${'1'.repeat(40)} 20261015 0 0 0 0 0 0 0 0 0\n`
    expect(collectCaddyAptEvidence(snapshot)).toMatchObject({
      status: 'blocked',
      code: 'APT_SIGNATURE_INVALID'
    })
  })

  it('rejects a Packages index checksum that differs from the signed release', () => {
    const snapshot = createSnapshot({ checksumOverride: 'd'.repeat(64) })
    expect(collectCaddyAptEvidence(snapshot)).toMatchObject({
      status: 'blocked',
      code: 'APT_INDEX_CHECKSUM_MISMATCH'
    })
  })

  it('rejects multiple configured APT sources', () => {
    const snapshot = createSnapshot({
      sourceSuffix: '\ndeb https://example.invalid/stable any-version main'
    })
    expect(collectCaddyAptEvidence(snapshot)).toMatchObject({
      status: 'blocked',
      code: 'APT_SOURCE_UNTRUSTED'
    })
  })

  it('rejects a duplicate package/version/architecture stanza', () => {
    const paragraph = packageParagraph('2.11.7')
    const snapshot = createSnapshot({ packageData: paragraph + paragraph })
    expect(collectCaddyAptEvidence(snapshot)).toMatchObject({
      status: 'blocked',
      code: 'APT_PACKAGE_DUPLICATE'
    })
  })

  it('rejects an index entry with a URI or filename that does not match repository layout', () => {
    const tampered = packageParagraph('2.11.7').replace(
      'caddy_2.11.7/caddy_2.11.7_linux_amd64.deb',
      'caddy_2.11.7/foreign.deb'
    )
    const snapshot = createSnapshot({ packageData: tampered })
    expect(collectCaddyAptEvidence(snapshot)).toMatchObject({
      status: 'blocked',
      code: 'APT_METADATA_INVALID'
    })
  })

  it('fails closed when a required metadata file is missing or unreadable', () => {
    const snapshot = createSnapshot()
    rmSync(snapshot.packagesGzipPath)
    expect(collectCaddyAptEvidence(snapshot)).toMatchObject({
      status: 'blocked',
      code: 'APT_METADATA_INVALID'
    })
  })
})

describe('validateAptDownloadUriOutput', () => {
  const uri = `${CADDY_STABLE_REPOSITORY.uri}/pool/any-version/main/c/ca/caddy_2.11.7/caddy_2.11.7_linux_amd64.deb`
  const filename = 'caddy_2.11.7_amd64.deb'
  const line = `'${uri}' ${filename} 18142322 SHA256:${packageSha}`

  it('accepts exactly the authenticated URI and filename printed by APT', () => {
    expect(validateAptDownloadUriOutput(line, uri, filename)).toBe(true)
  })

  it('rejects missing output, extra output, a different URI, filename or digest syntax', () => {
    expect(validateAptDownloadUriOutput('', uri, filename)).toBe(false)
    expect(validateAptDownloadUriOutput(`${line}\n${line}`, uri, filename)).toBe(false)
    expect(
      validateAptDownloadUriOutput(
        line.replace(uri, 'https://mirror.invalid/package.deb'),
        uri,
        filename
      )
    ).toBe(false)
    expect(validateAptDownloadUriOutput(line.replace(filename, 'other.deb'), uri, filename)).toBe(
      false
    )
    expect(validateAptDownloadUriOutput(line.replace(packageSha, 'missing'), uri, filename)).toBe(
      false
    )
  })
})
