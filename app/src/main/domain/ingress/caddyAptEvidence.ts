import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { lstatSync, readFileSync } from 'node:fs'
import * as path from 'node:path'

export const CADDY_STABLE_REPOSITORY = {
  uri: 'https://dl.cloudsmith.io/public/caddy/stable/deb/debian',
  suite: 'any-version',
  component: 'main',
  signedBy: '/usr/share/keyrings/caddy-stable-archive-keyring.gpg'
} as const

export const CADDY_STABLE_SIGNER_FINGERPRINT = '2F5C3BE9886ACD2913299EFBABA1F9B8875A6661'

export interface CaddyAptEvidence {
  sourceLine: string
  keyringPath: string
  originUri: string
  suite: string
  component: string
  package: 'caddy'
  version: string
  architecture: 'amd64' | 'arm64'
  filename: string
  outputFilename: string
  downloadUri: string
  sha256: string
  signerFingerprint: string
}

export type CaddyAptEvidenceErrorCode =
  | 'APT_SOURCE_UNTRUSTED'
  | 'APT_SIGNATURE_INVALID'
  | 'APT_INDEX_CHECKSUM_MISMATCH'
  | 'APT_METADATA_INVALID'
  | 'APT_PACKAGE_DUPLICATE'

export type CaddyAptEvidenceResult =
  | { status: 'verified'; evidence: CaddyAptEvidence }
  | { status: 'blocked'; code: CaddyAptEvidenceErrorCode; reason: string }

export interface CaddyAptSnapshotPaths {
  sourceListPath: string
  keyringPath: string
  inReleasePath: string
  packagesGzipPath: string
  architecture: 'amd64' | 'arm64'
}

const verifiedEvidence = new WeakSet<object>()

/** Reads one repository snapshot and verifies its signature and index before returning evidence. */
export function collectCaddyAptEvidence(paths: CaddyAptSnapshotPaths): CaddyAptEvidenceResult {
  let sourceLine: string
  let inRelease: string
  let packagesGzip: Buffer
  try {
    const sourceLines = readFileSync(paths.sourceListPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (sourceLines.length !== 1)
      return blocked('APT_SOURCE_UNTRUSTED', 'Expected exactly one APT source.')
    sourceLine = sourceLines[0]
    if (!isExpectedSourceLine(sourceLine, paths.keyringPath)) {
      return blocked('APT_SOURCE_UNTRUSTED', 'APT source is not the pinned Caddy stable source.')
    }

    const keyring = lstatSync(paths.keyringPath)
    if (!keyring.isFile() || keyring.isSymbolicLink() || keyring.size === 0) {
      return blocked('APT_SOURCE_UNTRUSTED', 'Caddy APT keyring is not a safe regular file.')
    }
    inRelease = readFileSync(paths.inReleasePath, 'utf8')
    packagesGzip = readFileSync(paths.packagesGzipPath)
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code ?? 'IO_ERROR'
    const errorName = error instanceof Error ? error.name : typeof error
    const errorMessage = error instanceof Error ? error.message : ''
    return blocked(
      'APT_METADATA_INVALID',
      `Required source, keyring, or repository metadata is missing or unreadable (${errorName}:${errorCode}:${errorMessage}).`
    )
  }

  const signature = verifyInRelease(paths.keyringPath, paths.inReleasePath)
  if (!signature.valid) {
    return blocked(
      'APT_SIGNATURE_INVALID',
      'Caddy InRelease signature is invalid or signed by an unpinned key.'
    )
  }

  const release = parseInRelease(inRelease)
  if (!release) {
    return blocked('APT_METADATA_INVALID', 'Signed InRelease fields are malformed or incomplete.')
  }
  if (
    release.Origin !== 'cloudsmith/caddy/stable' ||
    release.Suite !== CADDY_STABLE_REPOSITORY.suite
  ) {
    return blocked('APT_METADATA_INVALID', 'Signed InRelease identity does not match Caddy stable.')
  }

  const indexPath = `main/binary-${paths.architecture}/Packages.gz`
  const index = release.sha256.get(indexPath)
  if (!index || index.size !== packagesGzip.length || sha256(packagesGzip) !== index.digest) {
    return blocked(
      'APT_INDEX_CHECKSUM_MISMATCH',
      'Packages index size or SHA-256 does not match signed InRelease.'
    )
  }

  let paragraphs: string[]
  try {
    paragraphs = gunzipSync(packagesGzip)
      .toString('utf8')
      .split(/\r?\n\r?\n/)
      .filter(Boolean)
  } catch {
    return blocked('APT_METADATA_INVALID', 'Authenticated Packages index is not valid gzip data.')
  }

  const candidates: Array<Record<string, string>> = []
  const seen = new Set<string>()
  for (const paragraph of paragraphs) {
    const fields = parsePackageParagraph(paragraph)
    if (!fields)
      return blocked(
        'APT_METADATA_INVALID',
        'Packages index contains malformed or duplicate fields.'
      )
    if (fields.Package !== 'caddy') continue
    if (fields.Architecture !== paths.architecture) continue
    const identity = `${fields.Package}|${fields.Version}|${fields.Architecture}`
    if (seen.has(identity))
      return blocked(
        'APT_PACKAGE_DUPLICATE',
        'Packages index contains duplicate Caddy package identities.'
      )
    seen.add(identity)
    if (!/^2\.\d+\.\d+$/.test(fields.Version ?? '')) continue
    candidates.push(fields)
  }
  if (candidates.length === 0)
    return blocked(
      'APT_METADATA_INVALID',
      'No stable Caddy package matches the requested architecture.'
    )

  candidates.sort((a, b) => compareVersion(b.Version, a.Version))
  const selected = candidates[0]
  if (!isStablePackageEntry(selected, paths.architecture)) {
    return blocked(
      'APT_METADATA_INVALID',
      'Selected stable Caddy package entry has an invalid filename or digest.'
    )
  }
  const downloadUri = `${CADDY_STABLE_REPOSITORY.uri}/${selected.Filename}`
  const uri = new URL(downloadUri)
  const repository = new URL(CADDY_STABLE_REPOSITORY.uri)
  if (
    uri.protocol !== 'https:' ||
    uri.origin !== repository.origin ||
    !uri.pathname.startsWith(`${repository.pathname}/`) ||
    uri.username ||
    uri.password ||
    downloadUri !== `${CADDY_STABLE_REPOSITORY.uri}/${selected.Filename}`
  ) {
    return blocked(
      'APT_METADATA_INVALID',
      'Package download URI does not match the verified repository origin.'
    )
  }

  const evidence = Object.freeze({
    sourceLine,
    keyringPath: path.resolve(paths.keyringPath),
    originUri: CADDY_STABLE_REPOSITORY.uri,
    suite: release.Suite,
    component: CADDY_STABLE_REPOSITORY.component,
    package: 'caddy' as const,
    version: selected.Version,
    architecture: paths.architecture,
    filename: selected.Filename,
    outputFilename: `caddy_${selected.Version}_${paths.architecture}.deb`,
    downloadUri,
    sha256: selected.SHA256.toLowerCase(),
    signerFingerprint: signature.fingerprint
  })
  verifiedEvidence.add(evidence)
  return { status: 'verified', evidence }
}

export function isVerifiedCaddyAptEvidence(evidence: CaddyAptEvidence): boolean {
  return verifiedEvidence.has(evidence)
}

export function validateAptDownloadUriOutput(
  output: string,
  expectedUri: string,
  expectedFilename: string
): boolean {
  const lines = output.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length !== 1) return false
  const match = lines[0].trim().match(/^'([^']+)'\s+(\S+)\s+\d+\s+SHA256:[a-fA-F0-9]{64}$/)
  return match !== null && match[1] === expectedUri && match[2] === expectedFilename
}

function verifyInRelease(
  keyringPath: string,
  inReleasePath: string
): { valid: boolean; fingerprint: string } {
  try {
    const status = execFileSync(
      '/usr/bin/gpgv',
      ['--status-fd', '1', '--keyring', keyringPath, '--', inReleasePath],
      { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true }
    )
    const validSignatures = status.match(/^\[GNUPG:\] VALIDSIG ([A-F0-9]{40,64})\b/gm) ?? []
    if (validSignatures.length !== 1) return { valid: false, fingerprint: '' }
    const fingerprint = validSignatures[0].split(/\s+/)[2]
    return {
      valid: fingerprint === CADDY_STABLE_SIGNER_FINGERPRINT,
      fingerprint
    }
  } catch {
    return { valid: false, fingerprint: '' }
  }
}

function parseInRelease(text: string): {
  Origin: string
  Suite: string
  sha256: Map<string, { digest: string; size: number }>
} | null {
  const normalized = text.replace(/\r\n/g, '\n')
  const bodyStart = normalized.indexOf('\n\n')
  const signatureStart = normalized.indexOf('\n-----BEGIN PGP SIGNATURE-----')
  if (
    !normalized.startsWith('-----BEGIN PGP SIGNED MESSAGE-----') ||
    bodyStart < 0 ||
    signatureStart < 0
  )
    return null
  const body = normalized.slice(bodyStart + 2, signatureStart)
  const fields = new Map<string, string>()
  const hashes = new Map<string, { digest: string; size: number }>()
  let readingHashes = false
  for (const line of body.split('\n')) {
    if (line === 'SHA256:') {
      if (readingHashes) return null
      readingHashes = true
      continue
    }
    if (line.startsWith(' ')) {
      if (readingHashes) {
        const row = line.trim().match(/^([a-fA-F0-9]{64})\s+(\d+)\s+(\S+)$/)
        if (!row || hashes.has(row[3])) return null
        hashes.set(row[3], { digest: row[1].toLowerCase(), size: Number(row[2]) })
      }
      continue
    }
    if (line === '') {
      readingHashes = false
      continue
    }
    const field = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/)
    if (!field || fields.has(field[1])) return null
    readingHashes = false
    fields.set(field[1], field[2])
  }
  const origin = fields.get('Origin')
  const suite = fields.get('Suite') ?? fields.get('Codename')
  return origin && suite && hashes.size > 0
    ? { Origin: origin, Suite: suite, sha256: hashes }
    : null
}

function parsePackageParagraph(paragraph: string): Record<string, string> | null {
  const fields: Record<string, string> = {}
  for (const line of paragraph.split(/\r?\n/)) {
    if (!line || line.startsWith(' ')) continue
    const match = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/)
    if (!match || Object.hasOwn(fields, match[1])) return null
    fields[match[1]] = match[2]
  }
  return Object.keys(fields).length > 0 ? fields : null
}

function isStablePackageEntry(
  fields: Record<string, string>,
  architecture: string
): fields is Record<'Package' | 'Version' | 'Architecture' | 'Filename' | 'SHA256', string> {
  return (
    fields.Package === 'caddy' &&
    fields.Architecture === architecture &&
    /^2\.\d+\.\d+$/.test(fields.Version ?? '') &&
    /^[a-fA-F0-9]{64}$/.test(fields.SHA256 ?? '') &&
    /^pool\/(?:[a-z0-9+._-]+\/)*caddy_[0-9][a-zA-Z0-9.+:~_-]*\/caddy_[0-9][a-zA-Z0-9.+:~_-]*_linux_(?:amd64|arm64)\.deb$/.test(
      fields.Filename ?? ''
    ) &&
    fields.Filename.endsWith(
      `/caddy_${fields.Version}/caddy_${fields.Version}_linux_${architecture}.deb`
    )
  )
}

function compareVersion(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function isExpectedSourceLine(line: string, keyringPath: string): boolean {
  const normalizedKeyring = path.resolve(keyringPath)
  return (
    isSafeKeyringPath(normalizedKeyring) &&
    line ===
      `deb [signed-by=${normalizedKeyring}] ${CADDY_STABLE_REPOSITORY.uri} ${CADDY_STABLE_REPOSITORY.suite} ${CADDY_STABLE_REPOSITORY.component}`
  )
}

function isSafeKeyringPath(value: string): boolean {
  // Windows may expose the temp directory using an 8.3 path containing `~`.
  return /^\/[A-Za-z0-9._~/-]+$/.test(value) || /^[A-Za-z]:[\\/][A-Za-z0-9._~\\/-]+$/.test(value)
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function blocked(code: CaddyAptEvidenceErrorCode, reason: string): CaddyAptEvidenceResult {
  return { status: 'blocked', code, reason }
}
