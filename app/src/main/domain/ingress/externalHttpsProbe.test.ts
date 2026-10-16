import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isIP } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  probeExternalHttps,
  probeExternalHttpsWithLabTrust,
  probeExternalHttpsWithSystemTrustForTest,
  sameIpAddress,
  type ExternalHttpsProbeInput
} from './externalHttpsProbe'

const hostname = 'app.example.test'
let directory = ''
let key = ''
let cert = ''
let server: https.Server
let port = 0

function runOpenSsl(args: string[]): void {
  const executable = process.platform === 'win32' ? 'wsl' : 'openssl'
  const commandArgs = process.platform === 'win32' ? ['openssl', ...args] : args
  execFileSync(executable, commandArgs, { stdio: 'ignore' })
}

function linuxPath(path: string): string {
  if (process.platform !== 'win32') return path
  const normalized = path.replace(/\\/g, '/')
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (!match) throw new Error('Cannot map temporary Windows path into WSL.')
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`
}

const input = (overrides: Partial<ExternalHttpsProbeInput> = {}): ExternalHttpsProbeInput => ({
  hostname,
  healthcheckPath: '/health',
  dnsStatus: 'propagated',
  expectedPeerIps: ['127.0.0.1'],
  ...overrides
})

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-https-probe-'))
  const caKey = linuxPath(join(directory, 'ca.key'))
  const caCert = linuxPath(join(directory, 'ca.crt'))
  const serverKey = linuxPath(join(directory, 'server.key'))
  const request = linuxPath(join(directory, 'server.csr'))
  const serverCert = linuxPath(join(directory, 'server.crt'))
  const extensionFile = linuxPath(join(directory, 'extensions.cnf'))
  writeFileSync(
    join(directory, 'extensions.cnf'),
    'subjectAltName=DNS:app.example.test\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n'
  )
  runOpenSsl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-subj',
    '/CN=OpsPilot test CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-keyout',
    caKey,
    '-out',
    caCert
  ])
  runOpenSsl([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=app.example.test',
    '-keyout',
    serverKey,
    '-out',
    request
  ])
  runOpenSsl([
    'x509',
    '-req',
    '-in',
    request,
    '-CA',
    caCert,
    '-CAkey',
    caKey,
    '-CAcreateserial',
    '-days',
    '1',
    '-extfile',
    extensionFile,
    '-out',
    serverCert
  ])
  key = join(directory, 'server.key')
  cert = join(directory, 'server.crt')
  await listen('healthy')
}, 60_000)

afterAll(async () => {
  await closeServer()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function listen(
  response: 'healthy' | 'redirect' | 'unhealthy' | 'large' | 'timeout' | 'empty' | 'text',
  certPath = cert
): Promise<void> {
  await closeServer()
  server = https.createServer(
    { key: readFileSync(key), cert: readFileSync(certPath) },
    (_request, responseStream) => {
      if (response === 'timeout') return
      if (response === 'redirect') {
        responseStream.writeHead(302, { location: 'https://elsewhere.example/' })
        responseStream.end()
      } else if (response === 'unhealthy') {
        responseStream.writeHead(503, { 'content-type': 'application/json' })
        responseStream.end('{"ok":false}')
      } else if (response === 'large') {
        responseStream.writeHead(200, { 'content-type': 'text/plain' })
        responseStream.end('x'.repeat(20 * 1024))
      } else if (response === 'empty') {
        responseStream.writeHead(200, { 'content-type': 'application/json' })
        responseStream.end()
      } else if (response === 'text') {
        responseStream.writeHead(200, { 'content-type': 'text/plain' })
        responseStream.end('OK')
      } else {
        responseStream.writeHead(200, { 'content-type': 'application/json' })
        responseStream.end('{"ok":true}')
      }
    }
  )
  await new Promise<void>((resolve, reject) => {
    const currentServer = server!
    currentServer.once('error', reject)
    currentServer.listen(0, '127.0.0.1', () => {
      port = (currentServer.address() as { port: number }).port
      resolve()
    })
  })
}

async function closeServer(): Promise<void> {
  if (!server?.listening) return
  const currentServer = server
  await new Promise<void>((resolve) => currentServer.close(() => resolve()))
}

describe('external HTTPS probe', () => {
  it('compares IPv6 peer addresses by value, including IPv4-mapped forms', () => {
    expect(sameIpAddress('2001:db8::1', '2001:0db8:0000:0000:0000:0000:0000:0001')).toBe(true)
    expect(sameIpAddress('::ffff:127.0.0.1', '127.0.0.1')).toBe(true)
    expect(sameIpAddress('2001:db8::1', '2001:db8::2')).toBe(false)
  })

  it('uses hostname/SNI, trusts only supplied lab root in lab mode, and checks pinned peer + healthy response', async () => {
    const result = await probeExternalHttpsWithLabTrust(
      input(),
      readFileSync(join(directory, 'ca.crt')),
      port
    )
    expect(result).toEqual({
      status: 'passed',
      hostname,
      peer_ip: '127.0.0.1',
      http_status: 200,
      trust: 'lab'
    })
  })

  it('rejects untrusted certificates under system-default trust', async () => {
    expect(await probeExternalHttpsWithSystemTrustForTest(input(), port)).toEqual({
      status: 'failed',
      reason: 'certificate_untrusted'
    })
  })

  it('rejects certificate hostname mismatch with default hostname verification', async () => {
    const mismatch = join(directory, 'wrong-host.crt')
    const csr = linuxPath(join(directory, 'wrong-host.csr'))
    const mismatchKey = linuxPath(join(directory, 'wrong-host.key'))
    const mismatchCert = linuxPath(mismatch)
    const caKey = linuxPath(join(directory, 'ca.key'))
    const caCert = linuxPath(join(directory, 'ca.crt'))
    const ext = linuxPath(join(directory, 'wrong-host-ext.cnf'))
    writeFileSync(
      join(directory, 'wrong-host-ext.cnf'),
      'subjectAltName=DNS:other.example.test\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n'
    )
    runOpenSsl([
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=other.example.test',
      '-keyout',
      mismatchKey,
      '-out',
      csr
    ])
    runOpenSsl([
      'x509',
      '-req',
      '-in',
      csr,
      '-CA',
      caCert,
      '-CAkey',
      caKey,
      '-CAcreateserial',
      '-days',
      '1',
      '-extfile',
      ext,
      '-out',
      mismatchCert
    ])
    const oldKey = key
    key = join(directory, 'wrong-host.key')
    await listen('healthy', mismatch)
    expect(
      await probeExternalHttpsWithLabTrust(input(), readFileSync(join(directory, 'ca.crt')), port)
    ).toEqual({
      status: 'failed',
      reason: 'certificate_hostname_invalid'
    })
    key = oldKey
    await listen('healthy')
  })

  it('rejects expired certificates, redirects, unhealthy responses and oversized bodies', async () => {
    expect(isIP('127.0.0.1')).toBe(4)
    const expired = join(directory, 'expired.crt')
    const csr = linuxPath(join(directory, 'expired.csr'))
    const expiredKey = linuxPath(join(directory, 'expired.key'))
    const expiredCert = linuxPath(expired)
    const caKey = linuxPath(join(directory, 'ca.key'))
    const caCert = linuxPath(join(directory, 'ca.crt'))
    const caDb = linuxPath(join(directory, 'ca.db'))
    const caNew = linuxPath(join(directory, 'ca.newcerts'))
    const serial = linuxPath(join(directory, 'serial'))
    const config = linuxPath(join(directory, 'ca.cnf'))
    writeFileSync(join(directory, 'ca.db'), '')
    mkdirSync(join(directory, 'ca.newcerts'))
    writeFileSync(join(directory, 'serial'), '1000\n')
    writeFileSync(
      join(directory, 'ca.cnf'),
      `[ca]\ndefault_ca=local\n[local]\ndatabase=${caDb}\nnew_certs_dir=${caNew}\nserial=${serial}\nprivate_key=${caKey}\ncertificate=${caCert}\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=optional\n[server_ext]\nsubjectAltName=DNS:app.example.test\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`
    )
    runOpenSsl([
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=app.example.test',
      '-keyout',
      expiredKey,
      '-out',
      csr
    ])
    runOpenSsl([
      'ca',
      '-batch',
      '-config',
      config,
      '-in',
      csr,
      '-out',
      expiredCert,
      '-startdate',
      '20200101000000Z',
      '-enddate',
      '20200102000000Z',
      '-extensions',
      'server_ext'
    ])
    const priorKey = key
    key = join(directory, 'expired.key')
    await listen('healthy', expired)
    expect(
      await probeExternalHttpsWithLabTrust(input(), readFileSync(join(directory, 'ca.crt')), port)
    ).toEqual({ status: 'failed', reason: 'certificate_expired' })
    key = priorKey
    await listen('redirect')
    expect(
      await probeExternalHttpsWithLabTrust(input(), readFileSync(join(directory, 'ca.crt')), port)
    ).toMatchObject({ status: 'failed', reason: 'redirect_rejected' })
    await listen('unhealthy')
    expect(
      await probeExternalHttpsWithLabTrust(input(), readFileSync(join(directory, 'ca.crt')), port)
    ).toMatchObject({ status: 'failed', reason: 'health_response_invalid' })
    await listen('large')
    expect(
      await probeExternalHttpsWithLabTrust(input(), readFileSync(join(directory, 'ca.crt')), port)
    ).toMatchObject({ status: 'failed', reason: 'response_too_large' })
    await listen('empty')
    expect(
      await probeExternalHttpsWithLabTrust(input(), readFileSync(join(directory, 'ca.crt')), port)
    ).toMatchObject({ status: 'failed', reason: 'health_response_invalid' })
    await listen('text')
    expect(
      await probeExternalHttpsWithLabTrust(input(), readFileSync(join(directory, 'ca.crt')), port)
    ).toMatchObject({ status: 'failed', reason: 'health_response_invalid' })
  }, 30_000)

  it('bounds timeout, rejects non-propagated DNS and unsafe health paths', async () => {
    await listen('timeout')
    expect(
      await probeExternalHttpsWithLabTrust(input(), readFileSync(join(directory, 'ca.crt')), port)
    ).toMatchObject({ status: 'failed', reason: 'timeout' })
    expect(await probeExternalHttps(input({ dnsStatus: 'pending' }))).toEqual({
      status: 'failed',
      reason: 'dns_not_propagated'
    })
    expect(await probeExternalHttps(input({ healthcheckPath: '//evil.example' }))).toEqual({
      status: 'failed',
      reason: 'invalid_input'
    })
  }, 20_000)
})
