import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { SshManager } from '../ssh/manager'
import { enrollProductTarget } from './targetEnrollment'

describe('Product bootstrap channel pre-authentication boundary', () => {
  it.each(['../escape', '/tmp/a..b', '/tmp//a', '/tmp/a\n', '/' + 'a'.repeat(300)])(
    'rejects target roots incompatible with the guarded helper before filesystem/DB/SSH %#',
    async (target_root) => {
      await expect(
        enrollProductTarget(undefined as never, 'test-controller', '/unit', {
          format: 1,
          controller_id: 'test-controller',
          app_id: 1,
          ownership_generation: 1,
          artifact: '/unit/control-plane.cjs',
          manifest_sha256: 'a'.repeat(64),
          target_root
        })
      ).rejects.toThrow('TARGET_ENROLLMENT_INPUT_INVALID')
    }
  )
  it.each(['', 'x'.repeat(64 * 1024 + 1), 'changed'])(
    'rejects unpinned/oversized code before resolving credentials %#',
    async (text) => {
      const resolver = vi.fn()
      const ssh = new SshManager(resolver)
      await expect(
        ssh.openProductBootstrapChannel(1, { text, sha256: '0'.repeat(64) })
      ).rejects.toMatchObject({ code: 'VALIDATION' })
      expect(resolver).not.toHaveBeenCalled()
    }
  )
  it('requires the independently saved host pin before authentication on the bootstrap path', async () => {
    const text = 'import sys; sys.stdin.buffer.read()'
    const ssh = new SshManager(() => ({
      host: 'target.test',
      port: 22,
      hostFingerprint: null,
      username: 'deploy',
      authType: 'key',
      secret: 'SYNTHETIC_UNIT_MATERIAL'
    }))
    await expect(
      ssh.openProductBootstrapChannel(1, {
        text,
        sha256: createHash('sha256').update(text).digest('hex')
      })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await ssh.disconnectAll()
  })
})
