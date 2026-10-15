import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { lstatSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { shellQuote } from '../../ssh/shellQuote'
import {
  SshHostIdentityChangedError,
  SshOutputLimitError,
  type SshHostIdentity,
  type SshManager
} from '../../ssh/manager'

export const MAX_CADDY_INRELEASE_BYTES = 2 * 1024 * 1024
export const MAX_CADDY_PACKAGES_GZIP_BYTES = 32 * 1024 * 1024
export const MAX_CADDY_PACKAGES_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
export const MAX_CADDY_APT_SSH_STDOUT_BYTES = 48 * 1024 * 1024
export const MAX_CADDY_APT_SSH_STDERR_BYTES = 16 * 1024
export const CADDY_APT_SSH_TIMEOUT_MS = 120_000
export const CADDY_APT_EVIDENCE_MAX_AGE_MS = 5 * 60_000

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
  target: CaddyAptTargetBinding | null
  evidenceSource: 'local-lab' | 'pinned-ssh'
  issuedAt: number
}

export type CaddyAptTargetBinding = Pick<
  SshHostIdentity,
  'vpsId' | 'host' | 'port' | 'hostFingerprint'
>

export type CaddyAptEvidenceErrorCode =
  | 'APT_SOURCE_UNTRUSTED'
  | 'APT_SIGNATURE_INVALID'
  | 'APT_INDEX_CHECKSUM_MISMATCH'
  | 'APT_METADATA_INVALID'
  | 'APT_PACKAGE_DUPLICATE'
  | 'APT_METADATA_TOO_LARGE'
  | 'APT_SOURCE_MISSING'
  | 'APT_KEYRING_MISSING'
  | 'APT_VERIFIER_MISSING'
  | 'APT_REPOSITORY_UNAVAILABLE'
  | 'APT_SSH_FAILED'
  | 'APT_SSH_OUTPUT_TOO_LARGE'
  | 'APT_SSH_HOST_CHANGED'
  | 'APT_STALE_RESPONSE'

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

export interface CaddyAptSshTarget extends CaddyAptTargetBinding {}

export interface CaddyAptSshCollectionLimits {
  maxSshOutputBytes?: number
  maxInReleaseBytes?: number
  maxPackagesGzipBytes?: number
  maxPackagesUncompressedBytes?: number
}

export type CaddyAptSshResult = CaddyAptEvidenceResult

interface VerifiedSignature {
  valid: boolean
  fingerprint: string
}

interface CaddyAptRemoteSnapshot {
  schema: 'opspilot-caddy-apt-v1'
  requestId: string
  status: 'snapshot' | 'blocked'
  code?: string
  architecture?: string
  sourceListB64?: string
  keyringPath?: string
  inReleaseB64?: string
  packagesGzipB64?: string
  signatureStatusB64?: string
}

const verifiedEvidence = new WeakSet<object>()

/** Reads one repository snapshot and verifies its signature and index before returning evidence. */
export function collectCaddyAptEvidence(paths: CaddyAptSnapshotPaths): CaddyAptEvidenceResult {
  let sourceLine: string
  let inRelease: Buffer
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
    if (lstatSync(paths.inReleasePath).size > MAX_CADDY_INRELEASE_BYTES) {
      return blocked('APT_METADATA_TOO_LARGE', 'InRelease exceeds the configured size limit.')
    }
    if (lstatSync(paths.packagesGzipPath).size > MAX_CADDY_PACKAGES_GZIP_BYTES) {
      return blocked('APT_METADATA_TOO_LARGE', 'Packages.gz exceeds the configured size limit.')
    }
    inRelease = readFileSync(paths.inReleasePath)
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

  return buildEvidence({
    sourceLine,
    keyringPath: path.resolve(paths.keyringPath),
    inRelease,
    packagesGzip,
    architecture: paths.architecture,
    signature,
    target: null,
    evidenceSource: 'local-lab'
  })
}

export async function collectCaddyAptEvidenceOverSsh(
  ssh: SshManager,
  target: CaddyAptSshTarget,
  requestedLimits: CaddyAptSshCollectionLimits = {}
): Promise<CaddyAptSshResult> {
  if (!isValidTarget(target)) {
    return blocked(
      'APT_SSH_HOST_CHANGED',
      'The expected VPS SSH identity is incomplete or invalid.'
    )
  }
  const limits = createLimits(requestedLimits)
  if (!limits) {
    return blocked('APT_METADATA_INVALID', 'APT evidence limits must be positive finite integers.')
  }
  const requestId = randomBytes(16).toString('hex')
  let execution: Awaited<ReturnType<SshManager['execWithHostIdentity']>>
  try {
    execution = await ssh.execWithHostIdentity(
      target.vpsId,
      buildRemoteAptSnapshotCommand(requestId),
      {
        timeoutMs: CADDY_APT_SSH_TIMEOUT_MS,
        maxStdoutBytes: limits.sshOutputBytes,
        maxStderrBytes: MAX_CADDY_APT_SSH_STDERR_BYTES,
        logCommand: false,
        retryOnReconnect: false
      }
    )
  } catch (error) {
    return blocked(
      error instanceof SshOutputLimitError
        ? 'APT_SSH_OUTPUT_TOO_LARGE'
        : error instanceof SshHostIdentityChangedError
          ? 'APT_SSH_HOST_CHANGED'
          : 'APT_SSH_FAILED',
      error instanceof SshOutputLimitError
        ? 'APT metadata response exceeded the SSH output limit; verify repository size and retry.'
        : error instanceof SshHostIdentityChangedError
          ? 'The saved VPS SSH identity changed during the read; verify the host and fingerprint, then retry.'
          : 'Could not read authenticated Caddy APT metadata over the pinned SSH connection; verify connectivity and retry.'
    )
  }

  if (!sameTarget(target, execution.identity)) {
    return blocked(
      'APT_SSH_HOST_CHANGED',
      'The resolved VPS SSH host changed; reconnect and verify the saved fingerprint.'
    )
  }
  if (Buffer.byteLength(execution.result.stdout, 'utf8') > limits.sshOutputBytes) {
    return blocked(
      'APT_SSH_OUTPUT_TOO_LARGE',
      'APT metadata response exceeded the SSH output limit.'
    )
  }
  if (Buffer.byteLength(execution.result.stderr, 'utf8') > MAX_CADDY_APT_SSH_STDERR_BYTES) {
    return blocked(
      'APT_SSH_OUTPUT_TOO_LARGE',
      'APT metadata error output exceeded the SSH output limit.'
    )
  }
  if (execution.result.code !== 0) {
    return blocked(
      'APT_SSH_FAILED',
      'The remote read-only APT evidence command failed; verify the VPS and retry.'
    )
  }

  let response: CaddyAptRemoteSnapshot
  try {
    response = JSON.parse(execution.result.stdout) as CaddyAptRemoteSnapshot
  } catch {
    return blocked(
      'APT_METADATA_INVALID',
      'The VPS returned malformed APT evidence; retry after checking the VPS packages.'
    )
  }
  if (
    response.schema !== 'opspilot-caddy-apt-v1' ||
    response.requestId !== requestId ||
    !['snapshot', 'blocked'].includes(response.status)
  ) {
    return blocked(
      'APT_STALE_RESPONSE',
      'The APT response did not match this request; discard it and retry.'
    )
  }
  if (response.status === 'blocked') return mapRemoteBlock(response.code)

  if (
    (typeof response.inReleaseB64 === 'string' &&
      response.inReleaseB64.length > Math.ceil(limits.inReleaseBytes / 3) * 4) ||
    (typeof response.packagesGzipB64 === 'string' &&
      response.packagesGzipB64.length > Math.ceil(limits.packagesGzipBytes / 3) * 4)
  ) {
    return blocked(
      'APT_METADATA_TOO_LARGE',
      'Caddy APT metadata exceeds the configured size limits.'
    )
  }

  const decoded = decodeRemoteSnapshot(response, limits)
  if (!decoded) {
    return blocked(
      'APT_METADATA_INVALID',
      'The VPS response is missing required metadata or contains invalid encoding.'
    )
  }
  if (
    decoded.sourceLine !== expectedRemoteSourceLine() ||
    decoded.keyringPath !== CADDY_STABLE_REPOSITORY.signedBy
  ) {
    return blocked(
      'APT_SOURCE_UNTRUSTED',
      'Caddy stable source or signing key is missing or differs from the pinned configuration. Configure the official Caddy source/keyring, then retry.'
    )
  }
  if (decoded.architecture !== 'amd64' && decoded.architecture !== 'arm64') {
    return blocked(
      'APT_METADATA_INVALID',
      'The VPS architecture is unsupported or could not be identified.'
    )
  }
  const signature = parseRemoteSignatureStatus(decoded.signatureStatus)
  if (!signature.valid) {
    return blocked(
      'APT_SIGNATURE_INVALID',
      'Remote gpgv did not confirm the pinned Caddy stable signer.'
    )
  }
  if (
    decoded.inRelease.length > limits.inReleaseBytes ||
    decoded.packagesGzip.length > limits.packagesGzipBytes
  ) {
    return blocked(
      'APT_METADATA_TOO_LARGE',
      'Caddy APT metadata exceeds the configured size limits.'
    )
  }

  return buildEvidence({
    sourceLine: decoded.sourceLine,
    keyringPath: decoded.keyringPath,
    inRelease: decoded.inRelease,
    packagesGzip: decoded.packagesGzip,
    architecture: decoded.architecture,
    signature,
    target: execution.identity,
    evidenceSource: 'pinned-ssh',
    maxUncompressedBytes: limits.packagesUncompressedBytes
  })
}

interface EvidenceBuildInput {
  sourceLine: string
  keyringPath: string
  inRelease: Buffer
  packagesGzip: Buffer
  architecture: 'amd64' | 'arm64'
  signature: VerifiedSignature
  target: CaddyAptTargetBinding | null
  evidenceSource: CaddyAptEvidence['evidenceSource']
  maxUncompressedBytes?: number
}

function buildEvidence(input: EvidenceBuildInput): CaddyAptEvidenceResult {
  const {
    sourceLine,
    keyringPath,
    inRelease: inReleaseBytes,
    packagesGzip,
    architecture,
    signature
  } = input
  if (!signature.valid || signature.fingerprint !== CADDY_STABLE_SIGNER_FINGERPRINT)
    return blocked(
      'APT_SIGNATURE_INVALID',
      'APT metadata signature was not verified by the pinned signer.'
    )
  if (inReleaseBytes.length > MAX_CADDY_INRELEASE_BYTES)
    return blocked('APT_METADATA_TOO_LARGE', 'InRelease exceeds the configured size limit.')
  if (packagesGzip.length > MAX_CADDY_PACKAGES_GZIP_BYTES)
    return blocked('APT_METADATA_TOO_LARGE', 'Packages.gz exceeds the configured size limit.')
  const inRelease = inReleaseBytes.toString('utf8')

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

  const indexPath = `main/binary-${architecture}/Packages.gz`
  const index = release.sha256.get(indexPath)
  if (!index || index.size !== packagesGzip.length || sha256(packagesGzip) !== index.digest) {
    return blocked(
      'APT_INDEX_CHECKSUM_MISMATCH',
      'Packages index size or SHA-256 does not match signed InRelease.'
    )
  }

  let paragraphs: string[]
  try {
    paragraphs = gunzipSync(packagesGzip, {
      maxOutputLength: input.maxUncompressedBytes ?? MAX_CADDY_PACKAGES_UNCOMPRESSED_BYTES
    })
      .toString('utf8')
      .split(/\r?\n\r?\n/)
      .filter(Boolean)
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
    ) {
      return blocked(
        'APT_METADATA_TOO_LARGE',
        'Expanded Packages index exceeds the configured size limit.'
      )
    }
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
    if (fields.Architecture !== architecture) continue
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
  if (!isStablePackageEntry(selected, architecture)) {
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
    keyringPath,
    originUri: CADDY_STABLE_REPOSITORY.uri,
    suite: release.Suite,
    component: CADDY_STABLE_REPOSITORY.component,
    package: 'caddy' as const,
    version: selected.Version,
    architecture,
    filename: selected.Filename,
    outputFilename: `caddy_${selected.Version}_${architecture}.deb`,
    downloadUri,
    sha256: selected.SHA256.toLowerCase(),
    signerFingerprint: signature.fingerprint,
    target: input.target,
    evidenceSource: input.evidenceSource,
    issuedAt: Date.now()
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

const REMOTE_APT_SNAPSHOT_SCRIPT = `set -eu
request_id=${'$'}1
repo='${CADDY_STABLE_REPOSITORY.uri}'
source_file='/etc/apt/sources.list.d/caddy-stable.list'
keyring='${CADDY_STABLE_REPOSITORY.signedBy}'
expected_source='deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] ${CADDY_STABLE_REPOSITORY.uri} ${CADDY_STABLE_REPOSITORY.suite} ${CADDY_STABLE_REPOSITORY.component}'
emit_blocked() { printf '{"schema":"opspilot-caddy-apt-v1","requestId":"%s","status":"blocked","code":"%s"}\\n' "$request_id" "$1"; }
if [ ! -f "$source_file" ] || [ -L "$source_file" ]; then emit_blocked APT_SOURCE_MISSING; exit 0; fi
if [ ! -f "$keyring" ] || [ -L "$keyring" ] || [ ! -r "$keyring" ]; then emit_blocked APT_KEYRING_MISSING; exit 0; fi
if ! command -v curl >/dev/null 2>&1 || ! command -v gpgv >/dev/null 2>&1 || ! command -v dpkg >/dev/null 2>&1 || ! command -v base64 >/dev/null 2>&1; then emit_blocked APT_VERIFIER_MISSING; exit 0; fi
source_text=$(cat "$source_file")
source_count=$(printf '%s\\n' "$source_text" | awk 'NF && $1 !~ /^#/ { n++ } END { print n+0 }')
source_matches=$(grep -RhsF -- "$repo" /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null || true)
source_matches=$(printf '%s\\n' "$source_matches" | grep -v '^[[:space:]]*#' || true)
if [ "$source_count" -ne 1 ] || [ "$source_text" != "$expected_source" ] || [ "$source_matches" != "$expected_source" ]; then emit_blocked APT_SOURCE_MISSING; exit 0; fi
architecture=$(dpkg --print-architecture)
case "$architecture" in amd64|arm64) ;; *) emit_blocked APT_METADATA_INVALID; exit 0 ;; esac
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT HUP INT TERM
curl --fail --silent --show-error --location --max-filesize ${MAX_CADDY_INRELEASE_BYTES} "$repo/dists/${CADDY_STABLE_REPOSITORY.suite}/InRelease" --output "$tmp/InRelease" || { curl_status=$?; if [ "$curl_status" -eq 63 ]; then emit_blocked APT_METADATA_TOO_LARGE; else emit_blocked APT_REPOSITORY_UNAVAILABLE; fi; exit 0; }
curl --fail --silent --show-error --location --max-filesize ${MAX_CADDY_PACKAGES_GZIP_BYTES} "$repo/dists/${CADDY_STABLE_REPOSITORY.suite}/${CADDY_STABLE_REPOSITORY.component}/binary-$architecture/Packages.gz" --output "$tmp/Packages.gz" || { curl_status=$?; if [ "$curl_status" -eq 63 ]; then emit_blocked APT_METADATA_TOO_LARGE; else emit_blocked APT_REPOSITORY_UNAVAILABLE; fi; exit 0; }
release_size=$(wc -c < "$tmp/InRelease")
packages_size=$(wc -c < "$tmp/Packages.gz")
if [ "$release_size" -le 0 ] || [ "$release_size" -gt ${MAX_CADDY_INRELEASE_BYTES} ] || [ "$packages_size" -le 0 ] || [ "$packages_size" -gt ${MAX_CADDY_PACKAGES_GZIP_BYTES} ]; then emit_blocked APT_METADATA_TOO_LARGE; exit 0; fi
if ! gpgv --status-fd=1 --keyring "$keyring" -- "$tmp/InRelease" > "$tmp/signature-status" 2>/dev/null; then emit_blocked APT_SIGNATURE_INVALID; exit 0; fi
source_b64=$(printf '%s' "$source_text" | base64 -w 0)
release_b64=$(base64 -w 0 < "$tmp/InRelease")
packages_b64=$(base64 -w 0 < "$tmp/Packages.gz")
signature_b64=$(base64 -w 0 < "$tmp/signature-status")
printf '{"schema":"opspilot-caddy-apt-v1","requestId":"%s","status":"snapshot","architecture":"%s","sourceListB64":"%s","keyringPath":"%s","inReleaseB64":"%s","packagesGzipB64":"%s","signatureStatusB64":"%s"}\\n' "$request_id" "$architecture" "$source_b64" "$keyring" "$release_b64" "$packages_b64" "$signature_b64"
`

function buildRemoteAptSnapshotCommand(requestId: string): string {
  return `sh -c ${shellQuote(REMOTE_APT_SNAPSHOT_SCRIPT)} -- ${requestId}`
}

function expectedRemoteSourceLine(): string {
  return `deb [signed-by=${CADDY_STABLE_REPOSITORY.signedBy}] ${CADDY_STABLE_REPOSITORY.uri} ${CADDY_STABLE_REPOSITORY.suite} ${CADDY_STABLE_REPOSITORY.component}`
}

function decodeRemoteSnapshot(
  response: CaddyAptRemoteSnapshot,
  limits: { inReleaseBytes: number; packagesGzipBytes: number }
): {
  architecture: string
  sourceLine: string
  keyringPath: string
  inRelease: Buffer
  packagesGzip: Buffer
  signatureStatus: string
} | null {
  if (
    typeof response.architecture !== 'string' ||
    typeof response.sourceListB64 !== 'string' ||
    typeof response.keyringPath !== 'string' ||
    typeof response.inReleaseB64 !== 'string' ||
    typeof response.packagesGzipB64 !== 'string' ||
    typeof response.signatureStatusB64 !== 'string'
  )
    return null
  const sourceList = decodeBase64(response.sourceListB64, 4096)
  const inRelease = decodeBase64(response.inReleaseB64, limits.inReleaseBytes)
  const packagesGzip = decodeBase64(response.packagesGzipB64, limits.packagesGzipBytes)
  const signatureStatus = decodeBase64(response.signatureStatusB64, 8192)
  if (!sourceList || !inRelease || !packagesGzip || !signatureStatus) return null
  const sourceText = sourceList.toString('utf8')
  if (!Buffer.from(sourceText, 'utf8').equals(sourceList)) return null
  const sourceLines = sourceText.split(/\r?\n/).filter(Boolean)
  if (sourceLines.length !== 1) return null
  return {
    architecture: response.architecture,
    sourceLine: sourceLines[0],
    keyringPath: response.keyringPath,
    inRelease,
    packagesGzip,
    signatureStatus: signatureStatus.toString('utf8')
  }
}

function decodeBase64(value: string, maxBytes: number): Buffer | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null
  if (value.length > Math.ceil(maxBytes / 3) * 4) return null
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length > maxBytes || decoded.toString('base64') !== value) return null
  return decoded
}

function clampLimit(requested: number | undefined, hardLimit: number): number | null {
  if (requested === undefined) return hardLimit
  if (!Number.isSafeInteger(requested) || requested < 1) return null
  return Math.min(requested, hardLimit)
}

function createLimits(requested: CaddyAptSshCollectionLimits): {
  sshOutputBytes: number
  inReleaseBytes: number
  packagesGzipBytes: number
  packagesUncompressedBytes: number
} | null {
  const sshOutputBytes = clampLimit(requested.maxSshOutputBytes, MAX_CADDY_APT_SSH_STDOUT_BYTES)
  const inReleaseBytes = clampLimit(requested.maxInReleaseBytes, MAX_CADDY_INRELEASE_BYTES)
  const packagesGzipBytes = clampLimit(
    requested.maxPackagesGzipBytes,
    MAX_CADDY_PACKAGES_GZIP_BYTES
  )
  const packagesUncompressedBytes = clampLimit(
    requested.maxPackagesUncompressedBytes,
    MAX_CADDY_PACKAGES_UNCOMPRESSED_BYTES
  )
  if (
    sshOutputBytes === null ||
    inReleaseBytes === null ||
    packagesGzipBytes === null ||
    packagesUncompressedBytes === null
  )
    return null
  return { sshOutputBytes, inReleaseBytes, packagesGzipBytes, packagesUncompressedBytes }
}

function parseRemoteSignatureStatus(status: string): VerifiedSignature {
  const validSignatures = status.match(/^\[GNUPG:\] VALIDSIG ([A-F0-9]{40,64})\b/gm) ?? []
  if (validSignatures.length !== 1) return { valid: false, fingerprint: '' }
  const fingerprint = validSignatures[0].split(/\s+/)[2] ?? ''
  return {
    valid:
      fingerprint === CADDY_STABLE_SIGNER_FINGERPRINT &&
      !/^\[GNUPG:\] (?:BADSIG|ERRSIG|REVKEYSIG|EXPKEYSIG|KEYEXPIRED|SIGEXPIRED|NO_PUBKEY) /m.test(
        status
      ),
    fingerprint
  }
}

function isValidTarget(target: CaddyAptSshTarget): boolean {
  return (
    Number.isSafeInteger(target.vpsId) &&
    target.vpsId > 0 &&
    target.host.trim().length > 0 &&
    Number.isInteger(target.port) &&
    target.port > 0 &&
    target.port <= 65535 &&
    /^SHA256:[A-Za-z0-9+/]{43}$/.test(target.hostFingerprint)
  )
}

function sameTarget(expected: CaddyAptSshTarget, actual: SshHostIdentity): boolean {
  return (
    expected.vpsId === actual.vpsId &&
    expected.host === actual.host &&
    expected.port === actual.port &&
    expected.hostFingerprint === actual.hostFingerprint
  )
}

function mapRemoteBlock(code: string | undefined): CaddyAptEvidenceResult {
  switch (code) {
    case 'APT_SOURCE_MISSING':
      return blocked(
        'APT_SOURCE_MISSING',
        'Official Caddy stable APT source is missing or duplicated. Configure the official signed source, then retry.'
      )
    case 'APT_KEYRING_MISSING':
      return blocked(
        'APT_KEYRING_MISSING',
        'Pinned Caddy APT keyring is missing or unreadable. Install the official keyring before retrying.'
      )
    case 'APT_VERIFIER_MISSING':
      return blocked(
        'APT_VERIFIER_MISSING',
        'VPS is missing curl, gpgv, dpkg or base64 required for read-only verification.'
      )
    case 'APT_REPOSITORY_UNAVAILABLE':
      return blocked(
        'APT_REPOSITORY_UNAVAILABLE',
        'Caddy stable repository metadata could not be fetched; verify VPS DNS/network access and retry.'
      )
    case 'APT_SIGNATURE_INVALID':
      return blocked(
        'APT_SIGNATURE_INVALID',
        'Caddy stable InRelease signature is invalid or uses a different signer.'
      )
    case 'APT_METADATA_TOO_LARGE':
      return blocked(
        'APT_METADATA_TOO_LARGE',
        'Caddy APT metadata exceeds the configured size limits.'
      )
    default:
      return blocked(
        'APT_METADATA_INVALID',
        'VPS could not produce a supported Caddy APT snapshot.'
      )
  }
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
