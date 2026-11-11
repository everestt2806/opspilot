import { dirname, join, resolve } from 'node:path'
import { lstatSync } from 'node:fs'
import { z } from 'zod'
import { readReleaseFile, assertReleaseDirectory } from './controllerRelease'
import type { ControllerUpgradeGate } from '../../../../docs/contracts/product-controller-upgrade'
const gateSchema = z.strictObject({
  request_key: z.uuidv4().refine((v) => v === v.toLowerCase()),
  path: z.string().max(512)
})
export function controllerUpgradeGate(artifact: string, input: unknown): () => boolean {
  const gate: ControllerUpgradeGate = gateSchema.parse(input)
  const parent = resolve(dirname(artifact), '../..')
  if (
    gate.path !== join(parent, 'activation.json') ||
    !parent.endsWith('/revisions/' + gate.request_key) ||
    process.platform !== 'linux'
  )
    throw Error('CONTROLLER_INSTALL_UPGRADE_GATE_INVALID')
  let directory = parent
  for (;;) {
    assertReleaseDirectory(directory, 0)
    if (lstatSync(directory).uid !== 0) throw Error('CONTROLLER_INSTALL_UPGRADE_GATE_INVALID')
    if (dirname(directory) === directory) break
    directory = dirname(directory)
  }
  return () => {
    try {
      if ((lstatSync(gate.path).mode & 0o777) !== 0o644) return false
      const value = JSON.parse(readReleaseFile(gate.path, 512, false, 0).toString('utf8'))
      return (
        Object.keys(value).sort().join(',') === 'format,request_key' &&
        value.format === 1 &&
        value.request_key === gate.request_key
      )
    } catch {
      return false
    }
  }
}
