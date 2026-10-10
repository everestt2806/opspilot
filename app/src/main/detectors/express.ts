import type { BuildPlan, DetectionSignal, Detector, SourceTree } from './types'
import {
  dependencyVersion,
  detectPort,
  envExampleKeys,
  readPackage,
  resolveExpressEntry,
  type PackageJson
} from './helpers'

const DB_DRIVERS = ['pg', 'prisma', 'typeorm', 'sequelize']

function nodeDeps(tree: SourceTree): Record<string, string> {
  return readPackage(tree)?.dependencies ?? {}
}

function hasVite(tree: SourceTree): boolean {
  const pkg = readPackage(tree)
  return pkg?.devDependencies?.vite !== undefined || pkg?.dependencies?.vite !== undefined
}

function stripVersion(value: string | undefined): string | undefined {
  return dependencyVersion(value)
}

/** Healthcheck: nếu entry khai báo route /health thì dùng nó, không thì fallback '/'. */
function detectHealthcheckPath(tree: SourceTree, entry: string): string {
  const norm = entry.replace(/^\.\//, '')
  const resolved = tree.has(norm)
    ? norm
    : tree.has(`${norm}.js`)
      ? `${norm}.js`
      : tree.has(`${norm}.ts`)
        ? `${norm}.ts`
        : undefined
  if (!resolved) return '/'
  const content = tree.readText(resolved) ?? ''
  return content.search(/\.(get|post|use)\s*\(\s*['"`]\/health['"`]/) >= 0 ? '/health' : '/'
}

function parseEnvExampleKeys(tree: SourceTree): string[] {
  return envExampleKeys(tree)
}

export const expressDetector: Detector = {
  id: 'express',
  displayName: 'Express',
  priority: 10,

  detect(tree: SourceTree): boolean {
    const deps = nodeDeps(tree)
    if (deps.express === undefined || deps.next !== undefined || hasVite(tree)) {
      return false
    }
    const resolution = resolveExpressEntry(tree)
    const portInfo = detectPort(tree, resolution.entry, 3000)
    if (!portInfo.valid) {
      return false
    }

    if (
      resolution.reason?.includes('không phải lệnh chạy') ||
      resolution.reason?.includes('không chỉ định file entry') ||
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
    const deps = nodeDeps(tree)
    const pkg = readPackage(tree)
    const resolution = resolveExpressEntry(tree)
    const portInfo = detectPort(tree, resolution.entry, 3000)
    return [
      {
        description: 'package.json tồn tại',
        passed: pkg !== undefined,
        found: pkg !== undefined ? dependenciesText(pkg) : undefined
      },
      {
        description: "dependencies có 'express'",
        passed: deps.express !== undefined,
        found: stripVersion(deps.express ?? pkg?.devDependencies?.express)
      },
      {
        description: "không có 'next'",
        passed: deps.next === undefined,
        found: stripVersion(deps.next ?? pkg?.devDependencies?.next)
      },
      {
        description: "không có 'vite'",
        passed: !hasVite(tree),
        found: stripVersion(pkg?.devDependencies?.vite ?? pkg?.dependencies?.vite)
      },
      {
        description: 'lệnh start / entry xác định từ cấu hình',
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
    const deps = nodeDeps(tree)
    const resolution = resolveExpressEntry(tree)
    const portInfo = detectPort(tree, resolution.entry, 3000)
    const entry = resolution.entry || 'server.js'
    const needsDb = DB_DRIVERS.some((driver) => deps[driver] !== undefined)
    const requiredEnv = parseEnvExampleKeys(tree)
    if (needsDb && !requiredEnv.includes('DATABASE_URL')) {
      requiredEnv.push('DATABASE_URL')
    }

    const manualSteps: string[] = []
    if (deps.mongoose !== undefined) {
      manualSteps.push(
        'App dùng mongoose (MongoDB) — tool chưa tự dựng MongoDB, hãy tự cấp DATABASE_URL.'
      )
    }

    return {
      dockerfileTemplate: 'express.Dockerfile',
      buildArgs: {},
      buildCommand: 'npm ci --omit=dev',
      startCommand: resolution.startCommand || 'node server.js',
      containerPort: portInfo.port,
      healthcheckPath: detectHealthcheckPath(tree, entry),
      requiredEnv,
      optionalEnv: [],
      needsDb,
      manualSteps,
      detectedVersion: stripVersion(deps.express)
    }
  }
}

function dependenciesText(pkg: PackageJson): string {
  const names = Object.keys({ ...pkg.devDependencies, ...pkg.dependencies })
  return names.length > 0 ? names.join(', ') : 'không có dependency nào'
}
