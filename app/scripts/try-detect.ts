import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { detectFramework, DETECTORS } from '../src/main/detectors'
import { buildSourceTree } from '../src/main/detectors/sourceTree'

const args = process.argv.slice(2)
const explainFlag = args.includes('--explain') || args.includes('--evidence')
const sourceArg = args.find((arg) => !arg.startsWith('--'))

if (!sourceArg || !existsSync(sourceArg)) {
  console.error('Cách dùng: pnpm try:detect <đường-dẫn-source> [--explain]')
  process.exitCode = 2
} else {
  const resolved = resolve(sourceArg)
  if (!statSync(resolved).isDirectory()) {
    console.error(`Lỗi: '${sourceArg}' không phải là thư mục.`)
    process.exitCode = 2
  } else {
    const tree = buildSourceTree(resolved)
    const result = detectFramework(tree)
    const payload: Record<string, unknown> = {
      source_path: tree.rootPath,
      files: tree.files.length,
      ...result
    }
    if (explainFlag) {
      const evidence: Record<string, unknown> = {}
      for (const detector of DETECTORS) {
        evidence[detector.id] = detector.explain(tree)
      }
      payload.evidence = evidence
    }
    console.log(JSON.stringify(payload, null, 2))
  }
}
