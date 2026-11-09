import { spawn } from 'node:child_process'
import { z } from 'zod'
import {
  executeControllerInstallation,
  controllerInstallerPaths,
  type ControllerInstallerPaths
} from './controllerInstallation'
import script from './desktop_controller_admin.py?raw'
import catalog from '../../../control-plane-runtime/bundle-files.json'
import { installedControllerAdminSchema } from './installedControllerAdminProtocol'
export { installedControllerAdminSchema } from './installedControllerAdminProtocol'

const code = script.replace(
  'APPROVED_ASSETS = ()',
  'APPROVED_ASSETS = ' + JSON.stringify(Object.keys(catalog).sort())
)

/** Python bootstrap has independently verified this root-owned executable and packaged Node. */
export async function executeInstalledControllerAdmin(
  value: unknown,
  paths: ControllerInstallerPaths = controllerInstallerPaths
): Promise<unknown> {
  const parsed = installedControllerAdminSchema.safeParse(value)
  if (!parsed.success) throw Error('CONTROLLER_INSTALL_ADMIN_INPUT_INVALID')
  const input = parsed.data
  let response: unknown
  await executeControllerInstallation(
    { format: 1, operation: 'inspect', request_key: input.authority.request_key },
    paths,
    {
      inspected: async (installed, authority) => {
        if (
          installed.phase !== 'installed' ||
          installed.service_state === 'not_installed' ||
          installed.controller_id !== input.authority.controller_id ||
          installed.runtime_uid !== input.authority.runtime_uid ||
          authority.uid !== input.authority.runtime_uid ||
          authority.release_sha256 !== input.authority.release_sha256 ||
          installed.payload_sha256 !== input.authority.payload_sha256
        )
          throw Error('CONTROLLER_INSTALL_ADMIN_AUTHORITY_CHANGED')
        const request = JSON.stringify({
          ...input.command,
          artifact_path: installed.artifact_path,
          data_directory: installed.data_directory,
          node_path: installed.node_path,
          manifest_sha256: installed.payload_sha256,
          controller_id: installed.controller_id
        })
        if (
          Buffer.byteLength(request) >
          (input.command.operation === 'register-vps' ? 512 * 1024 : 16384)
        )
          throw Error('CONTROLLER_INSTALL_ADMIN_INPUT_INVALID')
        response = await runAsService(
          authority.uid,
          authority.gid,
          authority.lockFd,
          request,
          input.command.operation === 'project-readiness'
            ? 210000
            : input.command.operation === 'verify-project-source'
              ? 120000
              : ['register-vps', 'enroll-project-target'].includes(input.command.operation)
                ? 90000
                : 60000
        )
      }
    }
  )
  if (response === undefined) throw Error('CONTROLLER_INSTALL_ADMIN_FAILED')
  return response
}

function runAsService(
  uid: number,
  gid: number,
  lock: number,
  input: string,
  timeout: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/setpriv',
      [
        '--reuid',
        String(uid),
        '--regid',
        String(gid),
        '--clear-groups',
        '--no-new-privs',
        '--',
        '/usr/bin/python3',
        '-B',
        '-u',
        '-c',
        code
      ],
      {
        env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
        cwd: '/',
        stdio: ['pipe', 'pipe', 'pipe', lock]
      }
    )
    const chunks: Buffer[] = []
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    let size = 0,
      stderr = 0,
      failed = false
    const fail = (): void => {
      if (failed) return
      failed = true
      child.kill('SIGTERM')
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
      forceTimer.unref()
      reject(Error('CONTROLLER_INSTALL_ADMIN_FAILED'))
    }
    const timer = setTimeout(fail, timeout)
    child.on('error', fail)
    child.stdin!.on('error', fail)
    child.stdout!.on('data', (part: Buffer) => {
      size += part.length
      if (size > 65536) fail()
      else chunks.push(part)
    })
    child.stderr!.on('data', (part: Buffer) => {
      stderr += part.length
      if (stderr > 4096) fail()
    })
    child.on('close', (status) => {
      clearTimeout(timer)
      if (forceTimer) clearTimeout(forceTimer)
      if (failed) return
      if (status !== 0) return fail()
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const valid = z
          .union([
            z.strictObject({ ok: z.literal(true), data: z.unknown() }),
            z.strictObject({
              ok: z.literal(false),
              code: z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/)
            })
          ])
          .safeParse(value)
        if (!valid.success) return fail()
        resolve(valid.data)
      } catch {
        fail()
      }
    })
    child.stdin!.end(input)
  })
}
