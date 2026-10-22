import type {
  ProductClaimToken,
  ProductGitSnapshotMetadata
} from '../../../../docs/contracts/product-auto-deploy'
import {
  ProductDeployRepository,
  type ProductGitSnapshotAuthority
} from '../db/productDeployRepository'
import {
  canonicalizeGitHubUrl,
  createGitSnapshot,
  createGitSnapshotFromLocalFixture,
  type GitSnapshot,
  type GitSnapshotInput
} from '../git/snapshot'

export type ProductSnapshotPreparationErrorCode =
  | 'snapshot_authority_rejected'
  | 'snapshot_source_invalid'
  | 'snapshot_source_changed'
  | 'snapshot_sha_unavailable_or_mismatched'
  | 'snapshot_timeout'
  | 'snapshot_cancelled'
  | 'snapshot_limit_exceeded'
  | 'snapshot_root_invalid'
  | 'snapshot_git_failed'
  | 'snapshot_verification_rejected'

export class ProductSnapshotPreparationError extends Error {
  constructor(readonly code: ProductSnapshotPreparationErrorCode) {
    super(code)
    this.name = 'ProductSnapshotPreparationError'
  }
}

export interface PreparedProductGitSnapshot {
  readonly claim: ProductClaimToken
  readonly metadata: ProductGitSnapshotMetadata
  readonly rootDirectory: string
  readonly snapshotDirectory: string
  cleanup(): void
}

type SnapshotFactory = (input: GitSnapshotInput) => Promise<GitSnapshot>

/** Prepares an immutable source snapshot for an already valid internal Product claim. */
export async function prepareProductGitSnapshot(
  repository: ProductDeployRepository,
  claim: ProductClaimToken,
  options: Pick<GitSnapshotInput, 'signal' | 'timeoutMs' | 'maxBytes' | 'tempDirectory'> = {}
): Promise<PreparedProductGitSnapshot> {
  return prepareWithFactory(repository, claim, createGitSnapshot, options, false)
}

/** Local file transport exists solely to exercise snapshot/authority integration in tests. */
export async function prepareProductGitSnapshotFromLocalFixture(
  repository: ProductDeployRepository,
  claim: ProductClaimToken,
  options: Pick<GitSnapshotInput, 'signal' | 'timeoutMs' | 'maxBytes' | 'tempDirectory'> = {}
): Promise<PreparedProductGitSnapshot> {
  return prepareWithFactory(repository, claim, createGitSnapshotFromLocalFixture, options, true)
}

async function prepareWithFactory(
  repository: ProductDeployRepository,
  claim: ProductClaimToken,
  factory: SnapshotFactory,
  options: Pick<GitSnapshotInput, 'signal' | 'timeoutMs' | 'maxBytes' | 'tempDirectory'>,
  fixtureTransport: boolean
): Promise<PreparedProductGitSnapshot> {
  const before = repository.readGitSnapshotAuthority(claim)
  if (before.state !== 'ready')
    throw new ProductSnapshotPreparationError('snapshot_authority_rejected')

  if (!/^[a-f0-9]{40}$/.test(before.authority.targetSha)) {
    throw new ProductSnapshotPreparationError('snapshot_source_invalid')
  }
  if (!fixtureTransport) {
    try {
      canonicalizeGitHubUrl(before.authority.repositoryUrl)
    } catch {
      throw new ProductSnapshotPreparationError('snapshot_source_invalid')
    }
  }

  let snapshot: GitSnapshot
  try {
    snapshot = await factory({
      repositoryUrl: before.authority.repositoryUrl,
      ref: before.authority.ref,
      targetSha: before.authority.targetSha,
      root: before.authority.repositoryRoot,
      ...options
    })
  } catch (error) {
    throw new ProductSnapshotPreparationError(classifySnapshotFailure(error))
  }

  let retained = false
  try {
    const expectedRepositoryUrl = fixtureTransport
      ? before.authority.repositoryUrl
      : canonicalizeGitHubUrl(before.authority.repositoryUrl)
    if (
      snapshot.commitSha !== before.authority.targetSha ||
      snapshot.repositoryUrl !== expectedRepositoryUrl ||
      snapshot.rootDirectory.length === 0
    ) {
      throw new ProductSnapshotPreparationError('snapshot_sha_unavailable_or_mismatched')
    }
    const after = repository.readGitSnapshotAuthority(claim)
    if (after.state !== 'ready' || !sameAuthority(before.authority, after.authority)) {
      throw new ProductSnapshotPreparationError('snapshot_source_changed')
    }
    const metadata: ProductGitSnapshotMetadata = {
      repositoryUrl: before.authority.repositoryUrl,
      repositoryRoot: before.authority.repositoryRoot,
      commitSha: snapshot.commitSha,
      sourceConfigSha256: before.authority.sourceConfigSha256
    }
    if (repository.markGitSnapshotVerified(claim, metadata).state !== 'snapshot_verified') {
      throw new ProductSnapshotPreparationError('snapshot_verification_rejected')
    }
    retained = true
    let cleaned = false
    return {
      claim,
      metadata,
      rootDirectory: snapshot.rootDirectory,
      snapshotDirectory: snapshot.snapshotDirectory,
      cleanup: () => {
        if (cleaned) return
        snapshot.cleanup()
        cleaned = true
      }
    }
  } finally {
    if (!retained) snapshot.cleanup()
  }
}

function classifySnapshotFailure(error: unknown): ProductSnapshotPreparationErrorCode {
  const message = error instanceof Error ? error.message : ''
  if (/quá thời gian/i.test(message)) return 'snapshot_timeout'
  if (/đã hủy/i.test(message)) return 'snapshot_cancelled'
  if (/giới hạn (?:dung lượng|output)/i.test(message)) return 'snapshot_limit_exceeded'
  if (/Git root/i.test(message)) return 'snapshot_root_invalid'
  if (/Git ref không tồn tại|full commit SHA|checkout không khớp/i.test(message)) {
    return 'snapshot_sha_unavailable_or_mismatched'
  }
  return 'snapshot_git_failed'
}

function sameAuthority(
  left: ProductGitSnapshotAuthority,
  right: ProductGitSnapshotAuthority
): boolean {
  return (
    left.repositoryUrl === right.repositoryUrl &&
    left.repositoryRoot === right.repositoryRoot &&
    left.ref === right.ref &&
    left.targetSha === right.targetSha &&
    left.sourceConfigSha256 === right.sourceConfigSha256
  )
}
