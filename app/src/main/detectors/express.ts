import type { BuildPlan, DetectionSignal, Detector, SourceTree } from './types'

type PackageJson = {
  main?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const DB_DRIVERS = ['pg', 'prisma', 'typeorm', 'sequelize']

function readPackageJson(tree: SourceTree): PackageJson | undefined {
  return tree.readJson<PackageJson>('package.json')
}

function nodeDeps(tree: SourceTree): Record<string, string> {
  const pkg = readPackageJson(tree)
  return { ...pkg?.devDependencies, ...pkg?.dependencies }
}

function stripVersion(value: string | undefined): string | undefined {
  return value?.replace(/^[\^~>=<]/, '')
}

/** Node chạy app + cổng lắng nghe + lệnh start — detector đọc từ package.json, không đoán. */
function entryModule(tree: SourceTree): string {
  const pkg = readPackageJson(tree)
  const start = pkg?.scripts?.start
  const match = start?.match(/node\s+(\S+)/)
  if (match?.[1]) {
    return match[1]
  }
  return pkg?.main ?? 'server.js'
}

/** Healthcheck: nếu entry khai báo route /health thì dùng nó, không thì fallback '/'. */
function detectHealthcheckPath(tree: SourceTree, entry: string): string {
  const content = tree.readText(entry) ?? ''
  return content.search(/\.(get|post|use)\s*\(\s*['"`]\/health['"`]/) >= 0 ? '/health' : '/'
}

function parseEnvExampleKeys(tree: SourceTree): string[] {
  const content = tree.readText('.env.example') ?? ''
  const keys: string[] = []
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/)
    if (match?.[1]) {
      keys.push(match[1])
    }
  }
  return keys
}

export const expressDetector: Detector = {
  id: 'express',
  displayName: 'Express',
  priority: 10,

  detect(tree: SourceTree): boolean {
    const deps = nodeDeps(tree)
    return deps.express !== undefined && deps.next === undefined && deps.vite === undefined
  },

  explain(tree: SourceTree): DetectionSignal[] {
    const deps = nodeDeps(tree)
    const pkg = readPackageJson(tree)
    return [
      {
        description: 'package.json tồn tại',
        passed: pkg !== undefined,
        found: pkg !== undefined ? dependenciesText(pkg) : undefined
      },
      {
        description: "dependencies có 'express'",
        passed: deps.express !== undefined,
        found: stripVersion(deps.express)
      },
      {
        description: "không có 'next'",
        passed: deps.next === undefined,
        found: stripVersion(deps.next)
      },
      {
        description: "không có 'vite'",
        passed: deps.vite === undefined,
        found: stripVersion(deps.vite)
      }
    ]
  },

  buildPlan(tree: SourceTree): BuildPlan {
    const deps = nodeDeps(tree)
    const pkg = readPackageJson(tree)
    const entry = entryModule(tree)
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
      startCommand: pkg?.scripts?.start ?? `node ${entry}`,
      containerPort: 3000,
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
