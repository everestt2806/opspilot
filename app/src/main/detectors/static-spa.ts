import type { BuildPlan, DetectionSignal, Detector, SourceTree } from './types'

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
function packageJson(tree: SourceTree): PackageJson | undefined {
  return tree.readJson<PackageJson>('package.json')
}
function devDependencies(tree: SourceTree): Record<string, string> {
  return packageJson(tree)?.devDependencies ?? {}
}
function hasNext(tree: SourceTree): boolean {
  const pkg = packageJson(tree)
  return pkg?.dependencies?.next !== undefined || pkg?.devDependencies?.next !== undefined
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
    return devDependencies(tree).vite !== undefined && !hasNext(tree)
  },
  explain(tree): DetectionSignal[] {
    const pkg = packageJson(tree)
    const deps = devDependencies(tree)
    const nextVersion = pkg?.dependencies?.next ?? pkg?.devDependencies?.next
    return [
      { description: 'package.json exists', passed: pkg !== undefined },
      {
        description: "devDependencies contains 'vite'",
        passed: deps.vite !== undefined,
        found: version(deps.vite)
      },
      { description: "package has no 'next'", passed: !hasNext(tree), found: version(nextVersion) }
    ]
  },
  buildPlan(tree): BuildPlan {
    const viteVersion = devDependencies(tree).vite
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
      detectedVersion: version(viteVersion)
    }
  }
}
