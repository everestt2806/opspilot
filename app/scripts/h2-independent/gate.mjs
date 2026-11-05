/* eslint-disable @typescript-eslint/explicit-function-return-type -- Công cụ QA JavaScript. */
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'

export const WORKER_BRANCH = 'feat/product-h2-checkpoint'
export const WORKER_DOSSIER = 'docs/tasks/tk-s7-product-h2-runtime.md'
export const PROOF_PATH = 'app/src/main/controlPlane/productH2Proof.ts'
export const CONTRACT_PATH = 'docs/contracts/product-h2-runtime.ts'

export function execute(program, args, cwd, options = {}) {
  return new Promise((resolve) => {
    execFile(
      program,
      args,
      {
        cwd,
        shell: false,
        windowsHide: true,
        timeout: options.timeoutMs ?? 10000,
        maxBuffer: options.maxBuffer ?? 256 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
      },
      (error, stdout, stderr) =>
        resolve({
          exit: error ? (Number.isInteger(error.code) ? error.code : 2) : 0,
          bounded: !error?.killed && error?.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '')
        })
    )
  })
}
export async function git(worker, args) {
  const result = await execute('git', args, worker)
  if (result.exit !== 0 || !result.bounded) throw new Error('QA_GIT_READ_FAILED')
  return result.stdout.trim()
}
export function handoffRecord(text) {
  const normalized = text.replaceAll('**', '').replaceAll('\r\n', '\n')
  const starts = [
    ...normalized.matchAll(
      /^(?:\s*-\s*(?:START|UPDATE|HANDOFF-LOCAL)\b[^\n]*|#{1,6}\s+(?:\d+\.\s*)?(?:Tuyên bố\s+)?HANDOFF-LOCAL\b[^\n]*)/gm
    )
  ]
  const last = starts.at(-1)
  if (!last || !/HANDOFF-LOCAL\b/.test(last[0])) return null
  const block = normalized
    .slice(last.index)
    .split(/\n\s*(?:-\s*(?:START|UPDATE|HANDOFF-LOCAL)\b|#{1,6}\s)/)[0]
  return /\bREADY_FOR_LEADER_RETEST\b/.test(block) && !/\b(?:PARTIAL|BLOCKED|NOT_RUN)\b/.test(block)
    ? block.trim()
    : null
}
export function assessReadiness(state, expectedSha) {
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) return 'INVALID_SHA'
  if (state.branch !== WORKER_BRANCH) return 'WRONG_BRANCH'
  if (state.head !== expectedSha) return 'HEAD_MISMATCH'
  if (state.dirty) return 'WORKER_DIRTY'
  if (!state.sameRepository) return 'WRONG_REPOSITORY'
  const record = handoffRecord(state.dossier)
  if (!record) return 'WAITING_HANDOFF'
  if (!state.changedDossier || record === handoffRecord(state.previousDossier))
    return 'STALE_HANDOFF'
  if (!state.proofPresent || !state.contractPresent) return 'MISSING_COMPONENT'
  return 'READY'
}
async function blob(worker, object, optional = false) {
  const exists = await execute('git', ['cat-file', '-e', object], worker)
  if (exists.exit !== 0) {
    if (optional && exists.bounded && exists.exit === 128) return ''
    throw new Error('QA_GIT_OBJECT_MISSING')
  }
  const content = await execute('git', ['show', object], worker)
  if (content.exit !== 0 || !content.bounded) throw new Error('QA_GIT_READ_FAILED')
  return content.stdout
}
export async function readWorkerState(worker, qaRepo, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('QA_INVALID_SHA')
  const [
    branch,
    head,
    dirty,
    common,
    qaCommon,
    dossier,
    previousDossier,
    changes,
    proof,
    contract
  ] = await Promise.all([
    git(worker, ['branch', '--show-current']),
    git(worker, ['rev-parse', 'HEAD']),
    git(worker, ['status', '--porcelain=v1', '--untracked-files=all']),
    git(worker, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git(qaRepo, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    blob(worker, `${sha}:${WORKER_DOSSIER}`, true),
    blob(worker, `${sha}^:${WORKER_DOSSIER}`, true),
    git(worker, ['diff-tree', '--no-commit-id', '--name-only', '-r', sha, '--', WORKER_DOSSIER]),
    blob(worker, `${sha}:${PROOF_PATH}`, true),
    blob(worker, `${sha}:${CONTRACT_PATH}`, true)
  ])
  return {
    branch,
    head,
    dirty: dirty.length > 0,
    sameRepository: realpathSync(common) === realpathSync(qaCommon),
    dossier,
    previousDossier,
    changedDossier: changes.split('\n').includes(WORKER_DOSSIER),
    proofPresent: !!proof,
    contractPresent: !!contract,
    proof,
    contract
  }
}
