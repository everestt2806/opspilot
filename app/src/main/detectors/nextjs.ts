import type { BuildPlan, DetectionSignal, Detector, SourceTree } from './types'
import {
  dependencyVersion,
  detectPort,
  envExampleKeys,
  publicBuildArgs,
  readPackage,
  resolveNextStart
} from './helpers'

const DB_DRIVERS = ['pg', 'prisma', 'typeorm', 'sequelize']

export const nextjsDetector: Detector = {
  id: 'nextjs',
  displayName: 'Next.js',
  priority: 30,

  detect(tree: SourceTree): boolean {
    const pkg = readPackage(tree)
    if (pkg?.dependencies?.next === undefined) {
      return false
    }
    const resolution = resolveNextStart(tree)
    const portInfo = detectPort(tree, resolution.entry, 3000)
    if (!portInfo.valid) {
      return false
    }

    if (
      resolution.reason?.includes('không phải lệnh chạy') ||
      resolution.reason?.includes('không tồn tại')
    ) {
      return false
    }

    const hasCodeFiles = tree.files.some(
      (f) =>
        /\.(?:js|ts|jsx|tsx|mjs|cjs)$/.test(f) &&
        !f.startsWith('node_modules/') &&
        !f.startsWith('.git/')
    )
    if (hasCodeFiles && !resolution.certain) {
      return false
    }

    return true
  },

  explain(tree: SourceTree): DetectionSignal[] {
    const pkg = readPackage(tree)
    const nextDep = pkg?.dependencies?.next
    const nextDevDep = pkg?.devDependencies?.next
    const resolution = resolveNextStart(tree)
    const portInfo = detectPort(tree, resolution.entry, 3000)
    return [
      {
        description: 'package.json tồn tại',
        passed: pkg !== undefined
      },
      {
        description: "dependencies có 'next'",
        passed: nextDep !== undefined,
        found: dependencyVersion(nextDep ?? nextDevDep)
      },
      {
        description: 'lệnh start / cấu trúc thư mục Next.js xác định',
        passed: resolution.certain,
        found: resolution.certain ? resolution.startCommand : resolution.reason
      },
      {
        description: 'cổng lắng nghe hợp lệ',
        passed: portInfo.valid,
        found: portInfo.valid ? `${portInfo.port} (${portInfo.source})` : portInfo.error
      }
    ]
  },

  buildPlan(tree: SourceTree): BuildPlan {
    const pkg = readPackage(tree)
    const deps = pkg?.dependencies ?? {}
    const requiredEnv = ['NODE_ENV', ...envExampleKeys(tree)]
    const needsDb = DB_DRIVERS.some((driver) => deps[driver] !== undefined)
    if (needsDb && !requiredEnv.includes('DATABASE_URL')) {
      requiredEnv.push('DATABASE_URL')
    }
    const resolution = resolveNextStart(tree)
    const portInfo = detectPort(tree, resolution.entry, 3000)

    return {
      dockerfileTemplate: 'nextjs.Dockerfile',
      buildArgs: publicBuildArgs(tree, 'NEXT_PUBLIC_'),
      buildCommand: 'npm ci && npm run build',
      startCommand: resolution.startCommand || 'npm start',
      containerPort: portInfo.port,
      healthcheckPath: '/',
      requiredEnv: [...new Set(requiredEnv)],
      optionalEnv: [],
      needsDb,
      manualSteps: [],
      detectedVersion: dependencyVersion(deps.next)
    }
  }
}
