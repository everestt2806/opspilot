export { initializeDatabase, closeDatabase } from '../../src/main/db'
export { initializeControllerSecretKey } from '../../src/main/controlPlane/controllerSecrets'
export { validateProductSourceAndPlan } from '../../src/main/controlPlane/productPipelineSourceRender'
import {
  initializeController,
  openControllerDatabase
} from '../../src/main/controlPlane/controllerDatabase'
import { loadControllerCredentialCipher } from '../../src/main/controlPlane/controllerSecrets'
import { ProductEnvironmentRepository } from '../../src/main/db/productEnvironmentRepository'
import { ProductEnvironmentSelection } from '../../src/main/controlPlane/productEnvironmentSelection'
import { readControllerBootstrapInput } from '../../src/main/controlPlane/controllerBootstrapInput'

/** Fixture core riêng: không phải production CLI và không cấp target/dispatch capability. */
async function runCoreFixture(): Promise<void> {
  const [command, flag, directory, ...extra] = process.argv.slice(2)
  if (process.platform !== 'linux' || flag !== '--data-dir' || !directory || extra.length)
    throw Error('CORE_FIXTURE_INPUT_INVALID')
  if (command === 'init') {
    console.log(JSON.stringify({ controller_id: initializeController(directory).controllerId }))
    return
  }
  const uid = process.getuid?.()
  if (uid === undefined) throw Error('CORE_FIXTURE_INPUT_INVALID')
  const input = await readControllerBootstrapInput(process.stdin, new AbortController().signal),
    opened = openControllerDatabase(directory),
    administrator = 'unix:' + uid
  try {
    const cipher = loadControllerCredentialCipher(directory),
      vault = new ProductEnvironmentRepository(opened.database, cipher),
      selection = new ProductEnvironmentSelection(opened.database, cipher)
    let result: unknown
    if (command === 'stage-project-environment')
      result = vault.stage(input, opened.controllerId, administrator)
    else if (command === 'project-environment-state')
      result = vault.state(input, opened.controllerId, administrator)
    else if (command === 'project-environment-context')
      result = vault.context(input, opened.controllerId, administrator)
    else if (command === 'select-project-environment')
      result = selection.select(input, opened.controllerId, administrator)
    else if (command === 'project-environment-review')
      result = selection.review(input, opened.controllerId, administrator)
    else if (command === 'project-environment-selection-state')
      result = selection.lookup(input, opened.controllerId, administrator)
    else throw Error('CORE_FIXTURE_INPUT_INVALID')
    console.log(JSON.stringify(result))
  } finally {
    opened.database.close()
  }
}
if (require.main === module)
  void runCoreFixture().catch((error: unknown) => {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
        ? error.message
        : 'CORE_FIXTURE_FAILED'
    console.error('CONTROL_PLANE_ERROR ' + code)
    process.exitCode = 1
  })
