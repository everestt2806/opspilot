'use strict'

/* eslint-disable @typescript-eslint/no-require-imports */

const { existsSync } = require('node:fs')
const { resolve } = require('node:path')
const { spawn } = require('node:child_process')

const electron = require('electron')
const appRoot = resolve(__dirname, '..')
const entry = resolve(appRoot, '.out-scripts/scripts/ml-preflight-live.js')

if (!existsSync(entry)) {
  process.stderr.write('ML_PREFLIGHT_BUILD_REQUIRED\n')
  process.exitCode = 2
} else {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/(SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|APP_ENV_JSON)/i.test(name) &&
        !['OPSPILOT_SSH_KEY_FILE', 'CHROME_CRASHPAD_PIPE_NAME', 'ELECTRON_RUN_AS_NODE'].includes(
          name.toUpperCase()
        )
    )
  )
  const child = spawn(electron, [entry, '--', ...process.argv.slice(2)], {
    cwd: appRoot,
    env,
    stdio: 'inherit',
    windowsHide: true
  })
  child.once('error', () => {
    process.stderr.write('ML_PREFLIGHT_ELECTRON_START_FAILED\n')
    process.exitCode = 3
  })
  child.once('close', (code) => {
    process.exitCode = code ?? 3
  })
}
