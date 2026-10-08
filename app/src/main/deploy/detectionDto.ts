import type { DetectionResultDto, FrameworkId } from '@shared/ipc'

import { detectFramework } from '../detectors'
import { buildSourceTree } from '../detectors/sourceTree'
import type { BuildPlan } from '../detectors/types'

export function detectSource(sourcePath: string): {
  dto: DetectionResultDto
  plan: BuildPlan | null
} {
  const tree = buildSourceTree(sourcePath)
  const result = detectFramework(tree)

  if (result.matched) {
    return {
      plan: result.plan,
      dto: {
        matched: true,
        framework: result.detector,
        display_name: result.displayName,
        build_command: result.plan.buildCommand,
        container_port: result.plan.containerPort,
        healthcheck_path: result.plan.healthcheckPath,
        dockerfile_template: result.plan.dockerfileTemplate,
        required_env: result.plan.requiredEnv,
        optional_env: result.plan.optionalEnv,
        needs_db: result.plan.needsDb,
        manual_steps: result.plan.manualSteps,
        detected_version: result.plan.detectedVersion,
        file_tree_preview: tree.files.slice(0, 50)
      }
    }
  }

  const signals = Object.entries(result.signals).flatMap(([framework, entries]) =>
    entries.map((signal) => ({
      framework: framework as FrameworkId,
      description: signal.description,
      passed: signal.passed,
      found: signal.found
    }))
  )
  return { plan: null, dto: { matched: false, hint: result.hint, signals } }
}
