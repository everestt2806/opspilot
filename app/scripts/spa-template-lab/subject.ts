import { buildSourceTree } from '../../src/main/detectors/sourceTree'
import { detectFramework } from '../../src/main/detectors'
import { renderBuildArgs, renderDockerfile } from '../../src/main/deploy/templates'
export { createGitSnapshotFromLocalFixture } from '../../src/main/git/snapshot'

export function renderSpaSource(
  source: string,
  templates: string
): {
  framework: 'static-spa'
  dockerfile: string
  container_port: number
  healthcheck_path: string
} {
  const detection = detectFramework(buildSourceTree(source))
  if (!detection.matched || detection.detector !== 'static-spa' || detection.plan.needsDb)
    throw Error('SPA_LAB_UNEXPECTED_PLAN')
  return {
    framework: detection.detector,
    dockerfile: renderDockerfile(
      detection.plan.dockerfileTemplate,
      {
        BUILD_COMMAND: detection.plan.buildCommand,
        BUILD_ARGS: renderBuildArgs(detection.plan.buildArgs),
        START_COMMAND: detection.plan.startCommand,
        CONTAINER_PORT: String(detection.plan.containerPort)
      },
      templates
    ),
    container_port: detection.plan.containerPort,
    healthcheck_path: detection.plan.healthcheckPath
  }
}
