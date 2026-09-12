import type { BuildPlan, DetectionSignal, Detector, SourceTree } from './types'

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

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

function buildArgs(tree: SourceTree): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of (tree.readText('.env.example') ?? '').split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (match?.[1] && match[1].startsWith('VITE_')) values[match[1]] = match[2]
  }
  return values
}

export const staticSpaDetector: Detector = {
  id: 'static-spa',
  displayName: 'Vite SPA',
  priority: 20,
  detect(tree): boolean {
    const deps = dependencies(tree)
    return deps.vite !== undefined && deps.next === undefined
  },
  explain(tree): DetectionSignal[] {
    const pkg = packageJson(tree)
    const deps = dependencies(tree)
    return [
      { description: 'package.json tồn tại', passed: pkg !== undefined },
      {
        description: "dependencies có 'vite'",
        passed: deps.vite !== undefined,
        found: version(deps.vite)
      },
      { description: "không có 'next'", passed: deps.next === undefined, found: version(deps.next) }
    ]
  },
  buildPlan(tree): BuildPlan {
    const deps = dependencies(tree)
    return {
      dockerfileTemplate: 'static-spa.Dockerfile',
      buildArgs: buildArgs(tree),
      buildCommand: 'npm ci && npm run build',
      startCommand: 'nginx -g "daemon off;"',
      containerPort: 80,
      healthcheckPath: '/',
      requiredEnv: envKeys(tree).filter((key) => key.startsWith('VITE_')),
      optionalEnv: [],
      needsDb: false,
      manualSteps: [],
      detectedVersion: version(deps.vite)
    }
  }
}
