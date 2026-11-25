#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * Test runtime app restoration from backup profile on Windows.
 * Verifies that backed up profile contains Local State context and can be successfully opened
 * by the real application executable without DB_ERROR.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').toLowerCase()
}

async function main() {
  const args = process.argv.slice(2)
  let exePath = null
  let sourceProfile = null
  let outDir = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exe' && args[i + 1]) {
      exePath = resolve(args[++i])
    } else if (args[i] === '--profile' && args[i + 1]) {
      sourceProfile = resolve(args[++i])
    } else if (args[i] === '--out-dir' && args[i + 1]) {
      outDir = resolve(args[++i])
    }
  }

  if (!exePath || !sourceProfile || !outDir) {
    console.error('Usage: node test-restore-runtime.mjs --exe <OpsPilot.exe> --profile <source-profile> --out-dir <out-dir>')
    process.exit(1)
  }

  assert(existsSync(exePath), `Executable not found: ${exePath}`)
  assert(existsSync(sourceProfile), `Source profile not found: ${sourceProfile}`)

  mkdirSync(outDir, { recursive: true })
  const backupDir = join(outDir, 'backup')
  const restoredProfile = join(outDir, 'restored-profile')
  const backupScript = resolve(REPO_ROOT, 'app/scripts/windows-delivery/backup-profile.ps1')
  const restoreScript = resolve(REPO_ROOT, 'app/scripts/windows-delivery/restore-profile.ps1')

  console.log(`[*] Source profile: ${sourceProfile}`)
  console.log(`[*] Target executable: ${exePath}`)
  console.log(`[*] Output directory: ${outDir}`)

  // 1. Run backup-profile.ps1
  console.log('[*] Step 1: Running backup-profile.ps1...')
  const backupRes = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      backupScript,
      '-SourceProfile',
      sourceProfile,
      '-BackupTarget',
      backupDir,
      '-Force'
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 }
  )
  assert.equal(backupRes.status, 0, `backup-profile.ps1 failed: ${backupRes.stderr}`)
  console.log('[+] Backup created successfully')

  const manifestPath = join(backupDir, 'backup-manifest.json')
  assert(existsSync(manifestPath), 'backup-manifest.json must exist in backup')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
  const manifestPaths = new Set(manifest.items.map((i) => i.path.replace(/\\/g, '/')))

  assert(manifestPaths.has('opspilot.db'), 'Manifest must contain opspilot.db')
  assert(manifestPaths.has('credential-master-key.protected'), 'Manifest must contain credential-master-key.protected')
  assert(manifestPaths.has('Local State'), 'Manifest must contain Local State (F2 context requirement)')
  console.log('[+] Manifest contains all required files including Local State')

  // 2. Run restore-profile.ps1 into fresh target
  console.log('[*] Step 2: Running restore-profile.ps1 into fresh target...')
  const restoreRes = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      restoreScript,
      '-BackupDir',
      backupDir,
      '-TargetProfile',
      restoredProfile
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 }
  )
  assert.equal(restoreRes.status, 0, `restore-profile.ps1 failed: ${restoreRes.stderr}`)
  assert(existsSync(join(restoredProfile, 'Local State')), 'Local State must be restored')
  assert.equal(
    sha256(join(restoredProfile, 'Local State')),
    sha256(join(sourceProfile, 'Local State')),
    'Restored Local State hash must match source'
  )
  console.log('[+] Restored profile created and verified')

  // 3. Open real application with restored profile
  console.log('[*] Step 3: Launching app with restored profile...')
  const { openUpgradeApp } = await import(
    pathToFileURL(resolve(REPO_ROOT, 'app/scripts/windows-release-lab/upgrade-app.mjs'))
  )

  let app = null
  const result = {
    status: 'FAIL',
    executable: exePath,
    source_profile: sourceProfile,
    restored_profile: restoredProfile
  }

  try {
    app = await openUpgradeApp(exePath, restoredProfile, outDir, process.env.SystemRoot)
    console.log('[+] App launched successfully without DB_ERROR')

    // Query UI shell
    const hasShell = await app.cdp.evaluate('!!document.querySelector(".app-shell")')
    assert(hasShell, 'App shell must render')
    console.log('[+] App shell rendered')

    // Query UI session
    const uiSession = await app.cdp.evaluate('localStorage.getItem("opspilot-ui-session")')
    if (uiSession) {
      const parsed = JSON.parse(uiSession)
      console.log(`[+] UI session state: locale=${parsed?.state?.locale}, theme=${parsed?.state?.theme}`)
      result.ui_state = parsed?.state
    }

    // Query ML service status
    const mlStatus = await app.api('/status?deployment_id=900004').catch(() => null)
    if (mlStatus) {
      console.log(`[+] ML service status: trained=${mlStatus.trained}, sample_count=${mlStatus.sample_count}`)
      result.ml_status = mlStatus
    }

    result.status = 'PASS'
    result.runtime_app_opened = true
    result.local_state_context_verified = true
  } catch (err) {
    result.error = err.message
    console.error(`[-] App launch failed: ${err.message}`)
    throw err
  } finally {
    if (app) {
      await app.close()
    }
  }

  // 4. Negative Test: Backup lacking Local State must be rejected by restore-profile.ps1
  console.log('[*] Step 4: Running negative test (backup lacking Local State must be rejected)...')
  const corruptBackupDir = join(outDir, 'backup-no-local-state')
  mkdirSync(corruptBackupDir, { recursive: true })
  // Copy all files except Local State
  for (const item of manifest.items) {
    if (item.path === 'Local State') continue
    const src = join(backupDir, item.path.replace(/\//g, '\\'))
    const dst = join(corruptBackupDir, item.path.replace(/\//g, '\\'))
    mkdirSync(dirname(dst), { recursive: true })
    writeFileSync(dst, readFileSync(src))
  }
  const corruptManifest = {
    ...manifest,
    items: manifest.items.filter((i) => i.path !== 'Local State'),
    items_count: manifest.items.length - 1
  }
  writeFileSync(join(corruptBackupDir, 'backup-manifest.json'), JSON.stringify(corruptManifest, null, 2), 'utf8')

  const negTarget = join(outDir, 'neg-target')
  mkdirSync(negTarget, { recursive: true })
  writeFileSync(join(negTarget, 'sentinel.txt'), 'SENTINEL_DATA\n', 'utf8')

  const negRestoreRes = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      restoreScript,
      '-BackupDir',
      corruptBackupDir,
      '-TargetProfile',
      negTarget
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 }
  )
  assert.notEqual(negRestoreRes.status, 0, 'Restore must reject backup lacking Local State')
  assert.equal(readFileSync(join(negTarget, 'sentinel.txt'), 'utf8'), 'SENTINEL_DATA\n', 'Target must remain untouched')
  console.log('[+] Negative test passed: restore-profile rejected backup lacking Local State')

  const resultPath = join(outDir, 'restore-runtime-result.json')
  writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8')
  console.log(`[+] All tests passed! Result written to ${resultPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
