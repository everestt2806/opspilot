/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder executes this standalone CommonJS hook. */
const { join } = require('node:path')

module.exports = async function verifyControllerInstallerBeforePack(context) {
  const root = context.packager.projectDir
  const verifier = require(join(root, 'out/main/controllerResourceVerifier.js'))
  verifier.verifyPackagedControllerResources(join(root, 'resources/controller-releases'))
  const mlVerifier = require(join(root, 'out/main/mlResourceVerifier.js'))
  mlVerifier.verifyPackagedMlResources(join(root, 'resources'))
}
