import type { BuildPlan, DetectionSignal, Detector, SourceTree } from './types'
import { dependencyVersion, envExampleKeys, publicBuildArgs, readPackage } from './helpers'

function hasNext(tree: SourceTree): boolean {
  const pkg = readPackage(tree)
  return pkg?.dependencies?.next !== undefined || pkg?.devDependencies?.next !== undefined
}

export const staticSpaDetector: Detector = {
  id: 'static-spa',
  displayName: 'Vite SPA',
  priority: 20,
  detect(tree): boolean {
    return pkgDevVite(tree) !== undefined && !hasNext(tree)
  },
  explain(tree): DetectionSignal[] {
    const pkg = readPackage(tree)
    const viteVersion = pkg?.devDependencies?.vite
    const nextVersion = pkg?.dependencies?.next ?? pkg?.devDependencies?.next
    return [
      { description: 'package.json tồn tại', passed: pkg !== undefined },
      {
        description: "devDependencies có 'vite'",
        passed: viteVersion !== undefined,
        found: dependencyVersion(viteVersion ?? pkg?.dependencies?.vite)
      },
      {
        description: "không có 'next'",
        passed: !hasNext(tree),
        found: dependencyVersion(nextVersion)
      }
    ]
  },
  buildPlan(tree): BuildPlan {
    const viteVersion = readPackage(tree)?.devDependencies?.vite
    return {
      dockerfileTemplate: 'static-spa.Dockerfile',
      buildArgs: publicBuildArgs(tree),
      buildCommand: 'npm ci && npm run build',
      startCommand: 'nginx -g "daemon off;"',
      containerPort: 80,
      healthcheckPath: '/',
      requiredEnv: envExampleKeys(tree).filter((key) => key.startsWith('VITE_')),
      optionalEnv: [],
      needsDb: false,
      manualSteps: [],
      detectedVersion: dependencyVersion(viteVersion)
    }
  }
}

function pkgDevVite(tree: SourceTree): string | undefined {
  return readPackage(tree)?.devDependencies?.vite
}
