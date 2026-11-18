import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { randomBytes, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, rmSync, lstatSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

assert.equal(process.argv.slice(2).join(' '), '--confirm-private-vps-form')
const root = resolve(import.meta.dirname, '../../..')
const require = createRequire(join(root, 'app/package.json'))
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const nonce = randomBytes(6).toString('hex')
const directory = join(root, 'app/.out-scripts/vps-onboarding-form', nonce)
const profile = join(directory, 'private')
const screenshots = join(root, 'docs/ui-redesign/screenshots/ux1', nonce)
mkdirSync(profile, { recursive: true })
mkdirSync(screenshots, { recursive: true })
// Chromium holds cache files until process exit; keep those outside the private DB fixture.
app.setPath('userData', join(directory, 'electron-profile'))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const proof = {
  status: 'FAIL',
  scope: 'REAL_ELECTRON_PRODUCTION_FORM_PRELOAD_MAIN_ONBOARDING_SQLITE_SYNTHETIC_HOST_OBSERVATION',
  checks: [],
  layout_attempts: [],
  captures: [],
  VPS_used: false,
  private_cleanup: false
}
let code,
  window,
  observations = 0
const timer = setTimeout(() => app.exit(2), 120000)
app
  .whenReady()
  .then(async () => {
    try {
      await esbuild.build({
        entryPoints: [join(import.meta.dirname, 'entry.ts')],
        outfile: join(directory, 'entry.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node22',
        packages: 'external',
        plugins: [
          {
            name: 'raw',
            setup(b) {
              b.onResolve({ filter: /\?raw$/ }, (a) => ({
                path: resolve(a.resolveDir, a.path.slice(0, -4)),
                namespace: 'raw'
              }))
              b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
                contents: readFileSync(a.path, 'utf8'),
                loader: 'text'
              }))
            }
          }
        ]
      })
      code = require(join(directory, 'entry.cjs'))
      const db = code.initializeDatabase(join(profile, 'db'))
      const repository = new code.VpsRepository(db)
      const cipher = new code.AesGcmCredentialCipher(randomBytes(32))
      const pin = 'SHA256:' + 'A'.repeat(43)
      const onboarding = new code.VpsOnboarding(
        repository,
        new code.VpsService(repository, cipher),
        async () => {
          observations += 1
          return pin
        }
      )
      ipcMain.handle('vps:create', async (_event, input) => ({
        ok: true,
        data: await onboarding.create(input)
      }))
      await esbuild.build({
        stdin: {
          contents: `import React from'react';import{createRoot}from'react-dom/client';import{ConfigProvider}from'antd';import{VpsFormModal}from'./src/renderer/src/components/VpsFormModal';import{useUiState}from'./src/renderer/src/store/uiState';import{themeTokens,applyTheme}from'./src/renderer/src/utils/themeTokens';import'./src/renderer/src/assets/main.css';const root=createRoot(document.getElementById('root'));let id=0;window.showForm=(locale,theme)=>{useUiState.setState({locale,theme});applyTheme(theme);root.render(<ConfigProvider theme={{...themeTokens[theme],token:{...themeTokens[theme].token,motion:false}}}><VpsFormModal key={++id} open initialVps={null} saving={false} onCancel={()=>{}} onSubmit={async input=>{window.saved=await window.api.invoke('vps:create',input)}}/></ConfigProvider>)};`,
          resolveDir: join(root, 'app'),
          sourcefile: 'vps-form-proof.jsx',
          loader: 'jsx'
        },
        outfile: join(directory, 'renderer.js'),
        bundle: true,
        platform: 'browser',
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"production"' },
        loader: { '.png': 'file', '.woff2': 'file' },
        tsconfig: join(root, 'app/tsconfig.web.json')
      })
      writeFileSync(
        join(directory, 'index.html'),
        '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>'
      )
      window = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        webPreferences: {
          preload: join(root, 'app/out/preload/index.js'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      })
      await window.loadFile(join(directory, 'index.html'))
      window.showInactive()
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript Electron callback.
      const js = (source) => window.webContents.executeJavaScript(source, true)
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript polling helper.
      const wait = async (source) => {
        const end = Date.now() + 15000
        while (!(await js(source))) {
          assert(Date.now() < end, 'FORM_WAIT_TIMEOUT')
          await new Promise((r) => setTimeout(r, 60))
        }
      }
      for (const [locale, theme, width, height] of [
        ['en', 'dark', 1280, 800],
        ['vi', 'light', 1366, 768]
      ]) {
        window.setContentSize(width, height)
        await js(`window.showForm(${JSON.stringify(locale)},${JSON.stringify(theme)})`)
        await wait(
          'document.querySelector("#username")?.value==="root" && document.querySelector("#secret")?.type==="password"'
        )
        assert.deepEqual(await js('({width:innerWidth,height:innerHeight})'), { width, height })
        assert.equal(await js('document.querySelector("details").open'), false)
        const layout = await js(
          '({horizontal:document.documentElement.scrollWidth>document.documentElement.clientWidth,modal:document.querySelector(".ant-modal-body").scrollWidth>document.querySelector(".ant-modal-body").clientWidth,footerVisible:document.querySelector(".ant-modal-footer").getBoundingClientRect().bottom<=innerHeight})'
        )
        proof.layout_attempts.push({ locale, theme, width, height, layout })
        assert.deepEqual(layout, { horizontal: false, modal: false, footerVisible: true })
        await new Promise((r) => setTimeout(r, 350))
        const image = await window.webContents.capturePage()
        const file = join(screenshots, `vps-add-${locale}-${theme}-${width}x${height}.png`)
        const bytes = image.toPNG()
        assert(bytes.length > 10000, 'EMPTY_CAPTURE')
        writeFileSync(file, bytes)
        proof.captures.push({
          file: file.slice(root.length + 1).replaceAll('\\', '/'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
          layout
        })
      }
      proof.checks.push('default_root_password_advanced_closed_native_layout_two_locales_themes')
      await js(
        `for(const [id,value] of [['host','demo.example.invalid'],['secret','synthetic-ui-credential']]){const el=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}`
      )
      await js('document.querySelector(".ant-modal-footer .ant-btn-primary").click()')
      await wait('window.saved?.ok===true')
      const saved = await js('window.saved.data')
      assert.equal(saved.host_fingerprint, pin)
      assert.equal(saved.name, 'demo.example.invalid')
      assert.equal(saved.username, 'root')
      assert.equal(saved.port, 22)
      assert.equal(observations, 1)
      assert.equal(repository.getById(saved.id).host_fingerprint, pin)
      proof.checks.push(
        'ip_password_only_native_form_preload_main_automatic_pin_encrypted_SQLite_save'
      )
      proof.status = 'PASS'
    } catch (error) {
      proof.error = error?.code === 'ERR_ASSERTION' ? 'FORM_ASSERTION_FAILED' : 'FORM_GATE_FAILED'
      proof.failure_location = /electron\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? null
      process.exitCode = 1
    } finally {
      window?.destroy()
      code?.closeDatabase()
      try {
        assert.equal(dirname(profile), directory)
        assert(!lstatSync(profile).isSymbolicLink())
        rmSync(profile, { recursive: true })
        proof.private_cleanup = true
      } catch {
        proof.status = 'FAIL'
        proof.error = 'PRIVATE_DB_CLEANUP_FAILED'
      }
      writeFileSync(join(directory, 'proof.json'), JSON.stringify(proof, null, 2) + '\n')
      console.log(
        JSON.stringify({
          status: proof.status,
          evidence_directory: directory,
          checks: proof.checks,
          captures: proof.captures.length,
          error: proof.error,
          failure_location: proof.failure_location
        })
      )
      clearTimeout(timer)
      app.exit(proof.status === 'PASS' ? 0 : 1)
    }
  })
  .catch(() => app.exit(2))
