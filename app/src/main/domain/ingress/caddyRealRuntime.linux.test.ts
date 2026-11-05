import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterAll, describe, expect, it } from 'vitest'
import { shellQuote } from '../../ssh/shellQuote'
import { CADDY_OWNERSHIP_CHECK_SCRIPT } from './caddyInstallTransaction'
import { CADDY_RECONCILE_ROLLBACK_SCRIPT, CADDY_RECONCILE_SCRIPT } from './caddyReconcile'
import { buildSharedIngressConfig } from './routeBuilder'

const enabled = process.platform === 'win32' && process.env.OPSPILOT_CADDY_REAL_LAB === '1'
const workDirectory = mkdtempSync(join(tmpdir(), 'opspilot-caddy-real-runtime-'))
afterAll(() => rmSync(workDirectory, { recursive: true, force: true }))

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

function runtimeConfig(routes: readonly { hostname: string; host_port: number }[]): string {
  return buildSharedIngressConfig(routes)
    .replace('    persist_config off', '    persist_config off\n    http_port 18080')
    .replace('/var/lib/opspilot/caddy/production', '__LAB_ROOT__/storage/production')
    .replace(/^([a-z0-9.-]+) \{$/gm, 'http://$1 {')
}

function labReconcileScript(source: string): string {
  const ownerCall = `ownership=$(sh -c ${shellQuote(CADDY_OWNERSHIP_CHECK_SCRIPT)} 2>/dev/null)`
  return source
    .replaceAll(
      ownerCall,
      'ownership=$(if [ "$(cat "$TEST_ROOT/service.active" 2>/dev/null || printf inactive)" = active ]; then printf "OWNERSHIP=verified_active"; else printf "OWNERSHIP=verified_inactive"; fi)'
    )
    .replaceAll('/etc/opspilot/caddy', '$TEST_ROOT/etc/opspilot/caddy')
    .replaceAll('/run/lock', '$TEST_ROOT/run/lock')
    .replaceAll('/usr/bin/caddy', '$LAB/bin/caddy')
    .replaceAll('root:opspilot-caddy', '0:61001')
    .replaceAll('root:root', '0:0')
    .replaceAll('%U:%G', '%u:%g')
    .replaceAll(
      'check_dns || block RECONCILE_DNS_NOT_READY',
      ': # isolated HTTP fixture has no public DNS'
    )
}

function linuxPath(path: string): string {
  const canonicalPath = realpathSync.native(path)
  const result = spawnSync('wsl.exe', ['wslpath', '-a', canonicalPath.replaceAll('\\', '/')], {
    encoding: 'utf8',
    timeout: 10_000
  })
  if (result.status !== 0) throw new Error('WSL path conversion failed')
  return result.stdout.trim()
}

function prepareInputs(): string[] {
  const alpha = { hostname: 'alpha.example.test', host_port: 3011 }
  const beta = { hostname: 'beta.example.test', host_port: 3012 }
  const gamma = { hostname: 'gamma.example.test', host_port: 3013 }
  const generationOne = sha256('caddy-real-generation-one')
  const generationTwo = sha256('caddy-real-generation-two')
  const generationThree = sha256('caddy-real-generation-three')
  const values: Record<string, string> = {
    production: buildSharedIngressConfig([alpha, beta]).replace(
      '/var/lib/opspilot/caddy/production',
      '__LAB_ROOT__/storage/production'
    ),
    staging: buildSharedIngressConfig(
      [
        { hostname: 'alpha-staging.example.test', host_port: 3011 },
        { hostname: 'beta-staging.example.test', host_port: 3012 }
      ],
      'acme_staging'
    ).replace('/var/lib/opspilot/caddy/staging', '__LAB_ROOT__/storage/staging'),
    initial: runtimeConfig([]),
    'generation-one': `# opspilot-generation=${generationOne}\n${runtimeConfig([alpha, beta])}`,
    'generation-two': `# opspilot-generation=${generationTwo}\n${runtimeConfig([beta, gamma])}`,
    'generation-three': `# opspilot-generation=${generationThree}\n${runtimeConfig([alpha, gamma])}`,
    reconcile: labReconcileScript(CADDY_RECONCILE_SCRIPT),
    rollback: labReconcileScript(CADDY_RECONCILE_ROLLBACK_SCRIPT)
  }
  return Object.entries(values).map(([name, value]) => {
    const path = join(workDirectory, name)
    writeFileSync(path, value, { encoding: 'utf8', mode: 0o600 })
    return path
  })
}

describe('real Caddy lifecycle in an isolated WSL lab', () => {
  it.skipIf(!enabled)(
    'validates and reconciles real Caddy with loopback-only networking and tmpfs state',
    () => {
      const inputs = prepareInputs()
      const harness = linuxPath(resolve(process.cwd(), '../scripts/caddy-real-lab-harness.sh'))
      const mappedInputs = inputs.map(linuxPath)
      const run = spawnSync(
        'wsl.exe',
        ['-u', 'root', '--', 'bash', '-x', harness, ...mappedInputs],
        {
          encoding: 'utf8',
          timeout: 180_000,
          maxBuffer: 2 * 1024 * 1024
        }
      )
      if (run.status !== 0) {
        throw new Error(
          `Isolated real Caddy harness failed (${run.status ?? run.signal}):\n${run.stderr.slice(-4000)}\n${run.stdout.slice(-2000)}`
        )
      }
      expect(run.stdout).toContain(
        'CADDY_REAL_LAB_PASS=production_staging_validate,service_uid_storage,start,two_routes,reload,idempotency,db_failure_rollback,newer_generation_preserved,admin_api,upstream_http,acme_egress_blocked'
      )
    },
    190_000
  )
})
