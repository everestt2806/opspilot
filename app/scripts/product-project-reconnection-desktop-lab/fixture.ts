import { randomBytes } from 'node:crypto'
import { fixture as base } from '../product-environment-desktop-lab/fixture'
import { encryptControllerCredential } from '../../src/main/controlPlane/controllerSecrets'
import { readProjectReconnectionContext } from '../../src/main/controlPlane/projectReconnection'
import { DesktopProjectReconnections } from '../../src/main/controlPlane/desktopProjectReconnection'
import type { DesktopControllerEnrollment } from '../../src/main/controlPlane/desktopControllerEnrollment'

type Fixture = Omit<Awaited<ReturnType<typeof base>>, 'admin' | 'behavior'> & {
  admin: Pick<DesktopControllerEnrollment, 'reconnectionContext'>
  clock: { now: number }
  behavior: { fail: boolean; beforeReply?: () => void | Promise<void> }
  calls: { reads: number }
  make: () => DesktopProjectReconnections
  subject: DesktopProjectReconnections
}
/** Hai SQLite/cipher/vault thật, transport/admin giả. Không bằng chứng installed Root. */
export async function fixture(directory: string): Promise<Fixture> {
  const f = await base(directory)
  const target = {
    vps_id: 77,
    host: 'target.test',
    port: 22,
    username: 'operator',
    auth_type: 'key' as const,
    host_fingerprint: 'SHA256:' + 'A'.repeat(43),
    ssh_security_revision: 2
  }
  const credential = encryptControllerCredential(
    f.remoteCipher,
    { controller_id: f.controllerId, target },
    randomBytes(32).toString('base64url')
  )
  f.remote
    .prepare(
      `UPDATE vps SET crypto_scheme='aes_256_gcm',encrypted_secret=?,iv=?,auth_tag=?,ssh_security_revision=2 WHERE id=77`
    )
    .run(credential.encrypted_secret, credential.iv, credential.auth_tag)
  const clock = { now: Date.now() }
  const behavior: { fail: boolean; beforeReply?: () => void | Promise<void> } = { fail: false }
  const calls = { reads: 0 }
  const admin: Pick<DesktopControllerEnrollment, 'reconnectionContext'> = {
    reconnectionContext: async (id, input, guard) => {
      if (id !== f.bindingId) throw Error('FIXTURE_BINDING_MISMATCH')
      guard?.()
      calls.reads++
      const result = readProjectReconnectionContext(
        f.remote,
        f.remoteCipher,
        f.controllerId,
        'unix:1000',
        input
      )
      await behavior.beforeReply?.()
      if (behavior.fail) throw Error('SYNTHETIC_ADMIN_REPLY_LOST')
      return result
    }
  }
  const make = (): DesktopProjectReconnections =>
    new DesktopProjectReconnections(f.db, f.cipher, f.vault, admin, () => clock.now)
  return { ...f, admin, clock, behavior, calls, make, subject: make() }
}
