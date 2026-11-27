import { createHash } from 'node:crypto'
import { z } from 'zod'
import script from '../../../control-plane-runtime/controller_host_probe.py?raw'
import type { SshManager, SshVerifiedConnectionIdentity } from '../ssh/manager'
import type {
  ControllerHostFacts,
  ControllerHostPreflight,
  ControllerReleaseManifest
} from '../../../../docs/contracts/product-controller-release'

const factsSchema = z
  .object({
    format: z.literal(1),
    system: z.string().max(64),
    architecture: z.string().max(64),
    libc: z.string().max(64),
    libc_version: z.string().max(32),
    uid: z.number().int().min(0).max(4294967295),
    available_memory_bytes: z.number().int().nonnegative().safe(),
    free_disk_bytes: z.number().int().nonnegative().safe(),
    systemd_system: z.boolean(),
    systemd_user_bus: z.boolean(),
    user_linger: z.boolean(),
    installation_conflict: z.boolean()
  })
  .strict()

/** Chỉ đánh giá snapshot; installer cần kiểm lại authority/tài nguyên ngay trước ghi. */
export function evaluateControllerHost(
  value: unknown,
  release: Pick<ControllerReleaseManifest, 'platform' | 'minimum_glibc'>
): ControllerHostPreflight {
  const facts: ControllerHostFacts = factsSchema.parse(value)
  if (release.platform !== 'linux-x64-glibc' || !/^\d{1,3}\.\d{1,3}$/.test(release.minimum_glibc))
    throw Error('INVALID_CONTROLLER_RELEASE_REQUIREMENTS')
  const reasons: Array<ControllerHostPreflight['reasons'][number]> = []
  if (facts.system !== 'Linux' || facts.architecture !== 'x86_64') reasons.push('PLATFORM')
  const actual = facts.libc_version.split('.').map(Number)
  const required = release.minimum_glibc.split('.').map(Number)
  if (
    facts.libc !== 'glibc' ||
    !/^\d{1,3}\.\d{1,3}$/.test(facts.libc_version) ||
    actual[0] < required[0] ||
    (actual[0] === required[0] && actual[1] < required[1])
  )
    reasons.push('LIBC')
  if (facts.available_memory_bytes <= 512 * 1024 * 1024) reasons.push('MEMORY')
  if (facts.free_disk_bytes <= 2 * 1024 * 1024 * 1024) reasons.push('DISK')
  if (facts.uid === 0 ? !facts.systemd_system : !(facts.systemd_user_bus && facts.user_linger))
    reasons.push('SYSTEMD')
  if (facts.installation_conflict) reasons.push('EXISTING_INSTALLATION')
  return {
    state: reasons.length ? 'blocked' : 'compatible_snapshot',
    service_mode: facts.uid === 0 ? 'system' : 'user',
    reasons,
    facts
  }
}

/** SSH identity/pin lấy từ current authority của caller, không học khóa từ host probe. */
export async function probeControllerHost(input: {
  ssh: Pick<SshManager, 'openProductBootstrapChannel'>
  vpsId: number
  expectedIdentity: SshVerifiedConnectionIdentity
  release: Pick<ControllerReleaseManifest, 'platform' | 'minimum_glibc'>
  signal?: AbortSignal
}): Promise<ControllerHostPreflight> {
  if (
    !input.expectedIdentity ||
    input.expectedIdentity.vpsId !== input.vpsId ||
    input.signal?.aborted
  )
    throw Error('CONTROLLER_HOST_PROBE_FAILED')
  const { channel } = await input.ssh
    .openProductBootstrapChannel(
      input.vpsId,
      { text: script, sha256: createHash('sha256').update(script).digest('hex') },
      { expectedIdentity: input.expectedIdentity, signal: input.signal, timeoutMs: 15000 }
    )
    .catch(() => {
      throw Error('CONTROLLER_HOST_PROBE_FAILED')
    })
  return new Promise((resolve, reject) => {
    let output = Buffer.alloc(0)
    let stderrBytes = 0
    let done = false
    const finish = (result?: ControllerHostPreflight): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', abort)
      // Handler lỗi giữ tới close để lỗi muộn không thành uncaught error; không thu stderr.
      channel.destroy()
      if (result) resolve(result)
      else reject(Error('CONTROLLER_HOST_PROBE_FAILED'))
    }
    const abort = (): void => finish()
    const timer = setTimeout(abort, 15000)
    input.signal?.addEventListener('abort', abort, { once: true })
    channel.on('error', abort)
    channel.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > 4096) finish()
    })
    channel.on('data', (chunk: Buffer) => {
      if (done) return
      if (output.length + chunk.length > 4096) return finish()
      output = Buffer.concat([output, chunk])
    })
    channel.on('close', (code: number | null) => {
      if (done) return
      try {
        if (code !== 0) return finish()
        finish(evaluateControllerHost(JSON.parse(output.toString('utf8')), input.release))
      } catch {
        finish()
      }
    })
    if (input.signal?.aborted) finish()
    else channel.end()
  })
}
