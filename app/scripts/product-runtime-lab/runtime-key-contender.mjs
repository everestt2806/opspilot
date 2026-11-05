import { createRequire } from 'node:module'

const [artifact, root, controller, appId, generation] = process.argv.slice(2)
try {
  const { createControllerRuntimeKey } = createRequire(artifact)(artifact)
  const key = createControllerRuntimeKey(root, {
    controller_id: controller,
    app_id: Number(appId),
    ownership_generation: Number(generation)
  })
  key.fill(0)
} catch (error) {
  // Expected loser of an O_EXCL race is distinct from an unexpected failure.
  process.exitCode = error.message === 'CONTROLLER_RUNTIME_KEY_CREATION_FAILED' ? 2 : 3
}
