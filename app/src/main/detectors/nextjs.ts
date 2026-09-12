import type { BuildPlan, DetectionSignal, Detector, SourceTree } from './types'

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const DB_DRIVERS = ['pg', 'prisma', 'typeorm', 'sequelize']

function packageJson(tree: SourceTree): PackageJson | undefined {
  return tree.readJson<PackageJson>('package.json')
}

function dependencies(tree: SourceTree): Record<string, string> {
  const pkg = packageJson(tree)
  return { ...pkg?.devDependencies, ...pkg?.dependencies }
}

function version(value: string | undefined): string | undefined {
  return value?.replace(/^[\^~>=<]/, '')
}

function envKeys(tree: SourceTree): string[] {
  const keys: string[] = []
  for (const line of (tree.readText('.env.example') ?? '').split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/)
    if (match?.[1] && !keys.includes(match[1])) keys.push(match[1])
  }
  return keys
}

function envDefaults(tree: SourceTree): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of (tree.readText('.env.example') ?? '').split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (match?.[1] && match[1].startsWith('NEXT_PUBLIC_')) values[match[1]] = match[2]
  }
  return values
}

export const nextjsDetector: Detector = {
  id: 'nextjs',
  displayName: 'Next.js',
  priority: 30,
  detect(tree): boolean {
    return dependencies(tree).next !== undefined
  },
  explain(tree): DetectionSignal[] {
    const pkg = packageJson(tree)
    const deps = dependencies(tree)
    return [
      { description: 'package.json tồn tại', passed: pkg !== undefined },
      {
        description: "dependencies có 'next'",
        passed: deps.next !== undefined,
        found: version(deps.next)
      }
    ]
  },
  buildPlan(tree): BuildPlan {
    const deps = dependencies(tree)
    const requiredEnv = ['NODE_ENV', ...envKeys(tree)]
    const needsDb = DB_DRIVERS.some((driver) => deps[driver] !== undefined)
    if (needsDb && !requiredEnv.includes('DATABASE_URL')) requiredEnv.push('DATABASE_URL')
    return {
      dockerfileTemplate: 'nextjs.Dockerfile',
      buildArgs: envDefaults(tree),
      buildCommand: 'npm ci && npm run build',
      startCommand: 'npm start',
      containerPort: 3000,
      healthcheckPath: '/',
      requiredEnv: [...new Set(requiredEnv)],
      optionalEnv: [],
      needsDb,
      manualSteps: [],
      detectedVersion: version(deps.next)
    }
  }
}
