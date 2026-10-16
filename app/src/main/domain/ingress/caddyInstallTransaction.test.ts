import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import type { SshManager, SshHostIdentity } from '../../ssh/manager'
import {
  CADDY_STABLE_REPOSITORY,
  CADDY_STABLE_SIGNER_FINGERPRINT,
  collectCaddyAptEvidenceOverSsh
} from './caddyAptEvidence'
import { prepareCaddyInstallPlan, type CaddyInstallPlan } from './caddyInstallPlan'
import {
  CADDY_FIRST_RUN_INSTALL_SCRIPT,
  CADDY_OWNERSHIP_CHECK_SCRIPT,
  withVpsIngressMutex,
  buildCaddyFirstRunInstallCommand,
  installCaddyFirstRunOverSsh,
  verifyCaddyInstallationOwnershipOverSsh
} from './caddyInstallTransaction'
import type { IngressPreflightResult } from './preflight'

const target: SshHostIdentity = {
  vpsId: 71,
  host: 'install.fixture.invalid',
  port: 2222,
  hostFingerprint: `SHA256:${'A'.repeat(43)}`
}
const packageSha = 'a'.repeat(64)
const installedResponse = `RESULT=installed_not_running\nBINARY_SHA256=${'b'.repeat(64)}`
const aptVersion = '2.11.7'
const downloadFilename = `pool/any-version/main/c/ca/caddy_${aptVersion}/caddy_${aptVersion}_linux_amd64.deb`
const packageIndex = gzipSync(
  Buffer.from(
    [
      'Package: caddy',
      `Version: ${aptVersion}`,
      'Architecture: amd64',
      `Filename: ${downloadFilename}`,
      `SHA256: ${packageSha}`,
      '',
      ''
    ].join('\n')
  )
)
const indexPath = 'main/binary-amd64/Packages.gz'
const digest = createHash('sha256').update(packageIndex).digest('hex')
const inRelease = Buffer.from(
  [
    '-----BEGIN PGP SIGNED MESSAGE-----',
    'Hash: SHA256',
    '',
    'Origin: cloudsmith/caddy/stable',
    'Suite: any-version',
    'Codename: any-version',
    'Components: main',
    'SHA256:',
    ` ${digest} ${packageIndex.length} ${indexPath}`,
    '-----BEGIN PGP SIGNATURE-----',
    'fixture'
  ].join('\n')
)
const sourceLine = `deb [signed-by=${CADDY_STABLE_REPOSITORY.signedBy}] ${CADDY_STABLE_REPOSITORY.uri} any-version main`

const cleanIngress: IngressPreflightResult = {
  ownership: 'ports_free',
  ports_status: 'free',
  install_assessment: 'safe',
  local_assessment: 'clear',
  reason_code: null,
  listeners: [],
  service: 'absent',
  caddy_version: null,
  ownership_marker: 'missing',
  config_exists: false,
  config_readable: false,
  ufw: {
    state: 'inactive',
    inbound_80: 'not_applicable',
    inbound_443: 'not_applicable',
    inbound_80_ipv4: 'not_applicable',
    inbound_80_ipv6: 'not_applicable',
    inbound_443_ipv4: 'not_applicable',
    inbound_443_ipv6: 'not_applicable'
  },
  route_activation: 'not_evaluated'
}

vi.mock('./preflight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./preflight')>()),
  preflightSharedIngress: vi.fn(async () => cleanIngress)
}))

function fakeSsh(
  options: {
    installStdout?: string
    installCode?: number
    identity?: SshHostIdentity
    rejectInstall?: Error
    installWait?: Promise<void>
  } = {}
): SshManager {
  const execWithHostIdentity = vi.fn(async (_vpsId: number, command: string) => {
    if (command.includes('opspilot-caddy-apt-v1')) {
      const requestId = command.match(/-- ([a-f0-9]{32})$/)?.[1] ?? ''
      return {
        identity: target,
        result: {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            schema: 'opspilot-caddy-apt-v1',
            requestId,
            status: 'snapshot',
            architecture: 'amd64',
            sourceListB64: Buffer.from(sourceLine).toString('base64'),
            keyringPath: CADDY_STABLE_REPOSITORY.signedBy,
            inReleaseB64: inRelease.toString('base64'),
            packagesGzipB64: packageIndex.toString('base64'),
            signatureStatusB64: Buffer.from(
              `[GNUPG:] VALIDSIG ${CADDY_STABLE_SIGNER_FINGERPRINT} 20261015 0 0 0 0 0 0 0 0 0\n`
            ).toString('base64')
          })
        }
      }
    }
    if (options.rejectInstall) throw options.rejectInstall
    if (options.installWait) await options.installWait
    return {
      identity: options.identity ?? target,
      result: {
        code: options.installCode ?? 0,
        stdout: options.installStdout ?? installedResponse,
        stderr: ''
      }
    }
  })
  return {
    execWithHostIdentity,
    exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    getHostIdentity: vi.fn(async () => target)
  } as unknown as SshManager
}

async function makePlan(ssh: SshManager): Promise<CaddyInstallPlan> {
  const evidence = await collectCaddyAptEvidenceOverSsh(ssh, target)
  if (evidence.status !== 'verified') throw new Error(evidence.reason)
  const result = prepareCaddyInstallPlan(
    {
      ingress: cleanIngress,
      distroId: 'debian',
      distroVersion: '12',
      architecture: 'amd64',
      target
    },
    evidence.evidence
  )
  if (result.status !== 'ready') throw new Error(result.reason)
  return result.plan
}

describe('P1e-3 first-run Caddy transaction', () => {
  it('installs only after fresh clean preflight and returns installed_not_running', async () => {
    const ssh = fakeSsh()
    const plan = await makePlan(ssh)
    await expect(installCaddyFirstRunOverSsh(ssh, plan)).resolves.toEqual({
      status: 'installed_not_running',
      version: aptVersion,
      binarySha256: 'b'.repeat(64)
    })
    const calls = vi.mocked(ssh.execWithHostIdentity).mock.calls
    const [vpsId, command, options, expectedIdentity] = calls.at(-1)!
    expect(vpsId).toBe(target.vpsId)
    expect(expectedIdentity).toEqual(target)
    expect(options).toMatchObject({
      retryOnReconnect: false,
      logCommand: false,
      timeoutMs: 180_000
    })
    expect(command).toContain('flock -n 9')
    expect(command).toContain('/run/lock/opspilot-ingress.lock')
    expect(command).toContain('1777')
    expect(command).toContain('RESULT=installed_not_running')
    expect(command).toMatch(/dpkg-deb --extract/)
    expect(command).toMatch(/systemctl daemon-reload/)
    expect(command).not.toMatch(/systemctl (?:enable|start)|apt(?:-get)? install|dpkg -i/)
    expect(command).toContain('mv -nT')
    expect(command).toContain('rollback()')
    expect(command).toContain('rmdir --')
  })

  it('rejects stale evidence and a caller-cloned plan before sending a write', async () => {
    const ssh = fakeSsh()
    const plan = await makePlan(ssh)
    const forged = { ...plan } as CaddyInstallPlan
    await expect(installCaddyFirstRunOverSsh(ssh, forged)).resolves.toMatchObject({
      status: 'blocked',
      code: 'INSTALL_PLAN_UNVERIFIED'
    })
    vi.useFakeTimers()
    vi.setSystemTime(plan.issuedAt + 5 * 60_000 + 1)
    try {
      await expect(installCaddyFirstRunOverSsh(ssh, plan)).resolves.toMatchObject({
        status: 'blocked',
        code: 'INSTALL_EVIDENCE_STALE'
      })
    } finally {
      vi.useRealTimers()
    }
    expect(vi.mocked(ssh.execWithHostIdentity)).toHaveBeenCalledTimes(1)
  })

  it('fails closed on dirty preflight and lock/path/account conflicts', async () => {
    const ssh = fakeSsh({ installStdout: 'RESULT=blocked\nCODE=INSTALL_CONFLICT' })
    const plan = await makePlan(ssh)
    const preflightModule = await import('./preflight')
    vi.mocked(preflightModule.preflightSharedIngress).mockResolvedValueOnce({
      ...cleanIngress,
      ownership: 'conflict',
      ports_status: 'occupied',
      install_assessment: 'blocked'
    })
    await expect(installCaddyFirstRunOverSsh(ssh, plan)).resolves.toMatchObject({
      status: 'blocked',
      code: 'INSTALL_PREFLIGHT_NOT_CLEAN'
    })
    expect(vi.mocked(ssh.execWithHostIdentity)).toHaveBeenCalledTimes(1)

    const conflictSsh = fakeSsh({ installStdout: 'RESULT=blocked\nCODE=INSTALL_CONFLICT' })
    const conflictPlan = await makePlan(conflictSsh)
    await expect(installCaddyFirstRunOverSsh(conflictSsh, conflictPlan)).resolves.toMatchObject({
      status: 'blocked',
      code: 'INSTALL_CONFLICT'
    })
    const lockSsh = fakeSsh({ installStdout: 'RESULT=blocked\nCODE=INSTALL_LOCK_BUSY' })
    const lockPlan = await makePlan(lockSsh)
    await expect(installCaddyFirstRunOverSsh(lockSsh, lockPlan)).resolves.toMatchObject({
      status: 'blocked',
      code: 'INSTALL_LOCK_BUSY'
    })
  })

  it('serializes concurrent first-run attempts with a per-VPS mutex', async () => {
    let releaseFirst!: () => void
    const firstRemote = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const ssh = fakeSsh({ installWait: firstRemote })
    const plan = await makePlan(ssh)
    const first = installCaddyFirstRunOverSsh(ssh, plan)
    await vi.waitFor(() => expect(vi.mocked(ssh.execWithHostIdentity)).toHaveBeenCalledTimes(2))
    const second = installCaddyFirstRunOverSsh(ssh, plan)
    await Promise.resolve()
    expect(vi.mocked(ssh.execWithHostIdentity)).toHaveBeenCalledTimes(2)
    releaseFirst()
    await expect(first).resolves.toMatchObject({ status: 'installed_not_running' })
    await expect(second).resolves.toMatchObject({ status: 'installed_not_running' })
    expect(vi.mocked(ssh.execWithHostIdentity)).toHaveBeenCalledTimes(3)
  })

  it('shares the per-VPS ingress mutex with future reconcile work', async () => {
    const ssh = fakeSsh()
    const plan = await makePlan(ssh)
    let releaseReconcile!: () => void
    let enterReconcile!: () => void
    const reconcileGate = new Promise<void>((resolve) => {
      releaseReconcile = resolve
    })
    const reconcileEntered = new Promise<void>((resolve) => {
      enterReconcile = resolve
    })
    const reconcile = withVpsIngressMutex(target.vpsId, async () => {
      enterReconcile()
      await reconcileGate
    })
    await reconcileEntered
    const install = installCaddyFirstRunOverSsh(ssh, plan)
    await Promise.resolve()
    expect(vi.mocked(ssh.execWithHostIdentity)).toHaveBeenCalledTimes(1)
    releaseReconcile()
    await reconcile
    await expect(install).resolves.toMatchObject({ status: 'installed_not_running' })
  })

  it.each([
    'download',
    'extract_binary',
    'create_account',
    'create_paths',
    'write_artifacts',
    'verify'
  ])('reports a failed %s step only after rollback result is returned', async (step) => {
    const ssh = fakeSsh({
      installStdout: `RESULT=failed_rolled_back\nCODE=INSTALL_FAILED\nSTEP=${step}`
    })
    const plan = await makePlan(ssh)
    await expect(installCaddyFirstRunOverSsh(ssh, plan)).resolves.toMatchObject({
      status: 'blocked',
      code: 'INSTALL_FAILED_ROLLED_BACK'
    })
  })

  it('distinguishes verify failure, rollback failure and uncertain disconnect without retry', async () => {
    const verifySsh = fakeSsh({
      installStdout: 'RESULT=failed_rolled_back\nCODE=INSTALL_VERIFY_FAILED\nSTEP=verify'
    })
    await expect(
      installCaddyFirstRunOverSsh(verifySsh, await makePlan(verifySsh))
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'INSTALL_VERIFY_FAILED_ROLLED_BACK'
    })
    const rollbackSsh = fakeSsh({
      installStdout: 'RESULT=rollback_failed\nCODE=INSTALL_FAILED\nSTEP=write_artifacts'
    })
    await expect(
      installCaddyFirstRunOverSsh(rollbackSsh, await makePlan(rollbackSsh))
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'INSTALL_ROLLBACK_FAILED'
    })
    const droppedSsh = fakeSsh({ rejectInstall: new Error('connection lost') })
    await expect(
      installCaddyFirstRunOverSsh(droppedSsh, await makePlan(droppedSsh))
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'INSTALL_RECONCILIATION_REQUIRED'
    })
    expect(vi.mocked(droppedSsh.execWithHostIdentity)).toHaveBeenCalledTimes(2)
  })

  it('runs the shared ownership verifier on a pinned identity and blocks incomplete proof', async () => {
    expect(CADDY_OWNERSHIP_CHECK_SCRIPT).toContain("'DropInPaths='")
    expect(CADDY_OWNERSHIP_CHECK_SCRIPT).toContain("'ExecStartPre=/usr/bin/caddy validate")
    expect(CADDY_OWNERSHIP_CHECK_SCRIPT).toContain("'ExecReload=/usr/bin/caddy reload")
    expect(CADDY_OWNERSHIP_CHECK_SCRIPT).toContain("'NoNewPrivileges=yes'")
    const success = fakeSsh({ installStdout: 'OWNERSHIP=verified_inactive' })
    await expect(verifyCaddyInstallationOwnershipOverSsh(success, target)).resolves.toEqual({
      status: 'verified',
      active: false
    })
    const unknown = fakeSsh({ installStdout: 'OWNERSHIP=unknown' })
    await expect(verifyCaddyInstallationOwnershipOverSsh(unknown, target)).resolves.toMatchObject({
      status: 'blocked',
      code: 'INSTALL_RECONCILIATION_REQUIRED'
    })
  })

  it('keeps the command fixed to authenticated artifact metadata and refuses arbitrary paths', async () => {
    const plan = await makePlan(fakeSsh())
    const command = buildCaddyFirstRunInstallCommand(plan, '1'.repeat(32))
    expect(command).toContain(CADDY_STABLE_REPOSITORY.uri)
    expect(command).toContain(packageSha)
    expect(command).not.toContain('/tmp/arbitrary')
    expect(command).toContain('opspilot-caddy.service')
    expect(command).toContain('getent passwd opspilot-caddy')
    expect(command).toContain('sport = :80 or sport = :443')
    expect(command).toContain('/usr/bin/caddy')
    expect(command).toContain('/etc/systemd/system/opspilot-caddy.service')
    expect(command).toContain('mv -nT')
    expect(command).toContain('remove_hash')
    expect(command).not.toMatch(/rm -rf -- \/(?:usr|etc|var)\//)
    expect(command).not.toMatch(/systemctl (?:enable|start)/)
  })

  it('passes both fixed remote scripts through the available isolated POSIX shell parser', () => {
    for (const script of [CADDY_FIRST_RUN_INSTALL_SCRIPT, CADDY_OWNERSHIP_CHECK_SCRIPT]) {
      const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
    }
  })

  it.skipIf(process.env.OPSPILOT_RUN_LINUX_INGRESS_INTEGRATION !== '1')(
    'executes install and rollback against a disposable Linux filesystem root',
    { timeout: 120_000 },
    () => {
      const rootedScript = CADDY_FIRST_RUN_INSTALL_SCRIPT.replace(
        /(?<![A-Za-z0-9./])\/(?:usr|etc|var|run)(?:\/[A-Za-z0-9._-]+)*/g,
        '@@ROOT@@$&'
      ).replaceAll('@@ROOT@@/usr/sbin/nologin', '/usr/sbin/nologin')
      const harnessPath = fileURLToPath(
        new URL('./caddyInstallTransaction.linux-harness.sh', import.meta.url)
      )
      const harness = readFileSync(harnessPath, 'utf8').replace(
        '@@SCRIPT_B64@@',
        Buffer.from(rootedScript).toString('base64')
      )
      const result = spawnSync(
        'wsl.exe',
        ['-u', 'root', '--', 'unshare', '-m', '--propagation', 'private', 'bash', '-s'],
        {
          input: harness,
          encoding: 'utf8',
          timeout: 110_000,
          maxBuffer: 2 * 1024 * 1024
        }
      )
      expect(result.error).toBeUndefined()
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain('success|RESULT=installed_not_running')
      expect(result.stdout).toContain('create-before|RESULT=failed_rolled_back')
      expect(result.stdout).toContain('create-after|RESULT=reconciliation_required')
      expect(result.stdout).toContain('directory-race|RESULT=reconciliation_required')
      expect(result.stdout).toContain('stage-existing|RESULT=blocked,CODE=INSTALL_CONFLICT,')
      expect(result.stdout).toContain('external-link-race|RESULT=reconciliation_required')
      expect(result.stdout).toContain('external-group-race|RESULT=reconciliation_required')
      expect(result.stdout).toContain('external-user-race|RESULT=reconciliation_required')
      expect(result.stdout).toContain('external-file-race|RESULT=rollback_failed')
      expect(result.stdout).toContain('chown-failure|RESULT=failed_rolled_back')
      expect(result.stdout).toContain('write-failure|RESULT=failed_rolled_back')
      expect(result.stdout).toContain('rename-failure|RESULT=failed_rolled_back')
      expect(result.stdout).toContain('verify-failure|RESULT=failed_rolled_back')
      expect(result.stdout).toContain('rollback-failure|RESULT=rollback_failed')
      expect(result.stdout).toContain('lock-dir-symlink|RESULT=blocked,CODE=INSTALL_CONFLICT,')
      expect(result.stdout).toContain('lock-file-symlink|RESULT=blocked,CODE=INSTALL_CONFLICT,')
      expect(result.stdout).toContain('lock-bad-owner|RESULT=blocked,CODE=INSTALL_CONFLICT,')
      expect(result.stdout).toContain('LINUX_TMPFS_TRANSACTION_TESTS=PASS')
    }
  )
})
