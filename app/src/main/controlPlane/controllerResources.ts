import { readFileSync, statfsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import {
  PRODUCT_RESOURCE_MIN_RAM_BYTES,
  PRODUCT_RESOURCE_MIN_DISK_BYTES,
  type ProductResourceEvidence,
  type ProductAdmissionDecision
} from '../../../../docs/contracts/product-controller-readiness'
import type { ProductWorkerAdmission, ProductResourceAdmission } from './queueWorker'

export function assessProductResources(value: unknown, remote = false): ProductAdmissionDecision {
  if (!value || typeof value !== 'object') return { state: 'deferred', reason: 'resource_unknown' }
  const evidence = value as ProductResourceEvidence
  if (
    ![evidence.cpu_count, evidence.available_ram_bytes, evidence.workspace_available_bytes].every(
      (number) => Number.isSafeInteger(number) && number >= 0
    ) ||
    evidence.cpu_count < 1 ||
    (remote &&
      (typeof evidence.docker_ready !== 'boolean' || typeof evidence.port_ready !== 'boolean'))
  )
    return { state: 'deferred', reason: 'resource_unknown' }
  return evidence.available_ram_bytes > PRODUCT_RESOURCE_MIN_RAM_BYTES &&
    evidence.workspace_available_bytes > PRODUCT_RESOURCE_MIN_DISK_BYTES &&
    (!remote || (evidence.docker_ready && evidence.port_ready))
    ? { state: 'ready', reason: null }
    : { state: 'deferred', reason: 'resource_unavailable' }
}

export function measureControllerResources(dataDirectory: string): ProductResourceEvidence {
  if (process.platform !== 'linux') throw new Error('CONTROLLER_RESOURCES_REQUIRE_LINUX')
  const memory = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB$/m)
  if (!memory) throw new Error('CONTROLLER_MEMORY_UNKNOWN')
  const fs = statfsSync(dataDirectory, { bigint: true })
  return {
    cpu_count: availableParallelism(),
    available_ram_bytes: Number(memory[1]) * 1024,
    workspace_available_bytes: Number(fs.bavail * fs.bsize)
  }
}

/** Không claim khi recovery chưa ready, thiếu RAM/disk hoặc không đo được; không tạo target resource. */
export class ControllerResourceAdmission implements ProductWorkerAdmission {
  constructor(
    dataDirectory: string,
    private readonly recoveryReady: () => boolean,
    private readonly measure: () => ProductResourceEvidence = () =>
      measureControllerResources(dataDirectory)
  ) {}
  check(signal: AbortSignal): ProductResourceAdmission {
    if (signal.aborted || !this.recoveryReady())
      return { state: 'deferred', reason: 'resource_unknown' }
    try {
      const decision = assessProductResources(this.measure())
      return decision.state === 'ready'
        ? { state: 'ready' }
        : { state: 'deferred', reason: decision.reason! }
    } catch {
      return { state: 'deferred', reason: 'resource_unknown' }
    }
  }
}
