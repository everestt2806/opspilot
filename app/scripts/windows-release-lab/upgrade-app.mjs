/* eslint-disable @typescript-eslint/explicit-function-return-type -- Thao tác full application riêng cho upgrade lab. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, until, pause } from './cdp.mjs'

export async function openUpgradeApp(executable, profile, directory, system) {
  const server = createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const debugPort = server.address().port
  await new Promise((done) => server.close(done))
  const environment = {
    SystemRoot: system,
    WINDIR: system,
    PATH: join(system, 'System32'),
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    USERPROFILE: join(directory, 'home')
  }
  const child = spawn(
    executable,
    [
      '--user-data-dir=' + profile,
      '--remote-debugging-port=' + debugPort,
      '--remote-debugging-address=127.0.0.1'
    ],
    { cwd: directory, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const log = []
  let bytes = 0
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes < 65536) log.push(chunk)
    })
  child.once('close', () =>
    writeFileSync(join(directory, `process-${child.pid}.log`), Buffer.concat(log))
  )
  let cdp, port, pid
  try {
    const page = await until(async () => {
      assert.equal(child.exitCode, null, 'FULL_APP_EXITED')
      try {
        return (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(
          (p) => p.type === 'page' && p.url.startsWith('file:')
        )
      } catch {
        return false
      }
    }, 'FULL_WINDOW_NOT_READY')
    cdp = await connect(page.webSocketDebuggerUrl)
    await until(
      () => cdp.evaluate('!!window.api && !!document.querySelector(".app-shell")'),
      'FULL_APP_NOT_RENDERED'
    )
    await until(async () => {
      const result = await cdp.evaluate('window.api.invoke("system:ml-status")')
      return result?.ok && result.data.running
    }, 'FULL_APP_ML_NOT_READY')
    const command = `$all=@(Get-CimInstance Win32_Process); $ids=@(${child.pid}); do { $next=@($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | Select-Object -ExpandProperty ProcessId); $ids+= $next } while ($next.Count); @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $ids -and $_.LocalPort -in 8765,8766,8767 } | Select-Object LocalAddress,LocalPort,OwningProcess) | ConvertTo-Json -Compress`
    const inspect = spawnSync(
      join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-Command', command],
      { windowsHide: true, encoding: 'utf8', timeout: 15000 }
    )
    assert.equal(inspect.status, 0)
    const listeners = JSON.parse(inspect.stdout)
    const listener = Array.isArray(listeners) ? listeners[0] : listeners
    if (Array.isArray(listeners)) assert.equal(listeners.length, 1)
    assert.equal(listener.LocalAddress, '127.0.0.1')
    port = listener.LocalPort
    pid = listener.OwningProcess
    return {
      cdp,
      pid,
      port,
      child,
      async api(route, input) {
        const response = await fetch(`http://127.0.0.1:${port}${route}`, {
          method: input ? 'POST' : 'GET',
          headers: input ? { 'content-type': 'application/json' } : undefined,
          body: input ? JSON.stringify(input) : undefined,
          signal: AbortSignal.timeout(30000)
        })
        assert.equal(response.status, 200)
        return response.json()
      },
      async close() {
        void cdp.evaluate('window.api.invoke("window:close"); true').catch(() => {})
        await until(() => child.exitCode !== null, 'FULL_APP_QUIT_TIMEOUT', 30000)
        cdp.close()
        await until(
          () => {
            try {
              process.kill(pid, 0)
              return false
            } catch {
              return true
            }
          },
          'FULL_APP_ORPHAN_ML',
          10000
        )
        await assert.rejects(
          fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
        )
      }
    }
  } catch (error) {
    if (cdp) {
      void cdp.evaluate('window.api.invoke("window:close"); true').catch(() => {})
      await pause(500)
      cdp.close()
    }
    if (child.exitCode === null)
      spawnSync(join(system, 'System32/taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 10000
      })
    throw error
  }
}
