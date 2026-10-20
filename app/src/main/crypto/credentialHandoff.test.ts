import { describe, expect, it } from 'vitest'

import { prepareIsolatedMlService, runSecretHandoff } from './credentialHandoff'

const SECRET_FIXTURE = 'handoff-secret-fixture-only'

describe('runSecretHandoff', () => {
  it('sends secret on stdin without argv, environment, or output disclosure', async () => {
    const code = `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({argv:process.argv.slice(2),secretEnv:process.env.OPSPILOT_SSH_SECRET||null,received:input.length>0})))`
    const args = ['-e', code, '--', '--profile', 'clone-fixture']
    const env = { ...process.env }
    delete env.OPSPILOT_SSH_SECRET
    const result = await runSecretHandoff({
      command: process.execPath,
      args,
      secret: SECRET_FIXTURE,
      cwd: process.cwd(),
      env,
      timeoutMs: 5000,
      maxOutputBytes: 4096
    })
    expect(args.join(' ')).not.toContain(SECRET_FIXTURE)
    expect(result.stdout).toContain('"received":true')
    expect(result.stdout).toContain('"secretEnv":null')
    expect(result.stdout).not.toContain(SECRET_FIXTURE)
    expect(result.stderr).not.toContain(SECRET_FIXTURE)
  })

  it('kills and waits for its own process tree on timeout', async () => {
    await expect(
      runSecretHandoff({
        command: process.execPath,
        args: ['-e', 'process.stdin.resume();setTimeout(()=>{},30000)'],
        secret: SECRET_FIXTURE,
        cwd: process.cwd(),
        env: { ...process.env },
        timeoutMs: 100,
        maxOutputBytes: 4096
      })
    ).rejects.toThrow('HANDOFF_TIMEOUT')
  }, 10000)
})

describe('prepareIsolatedMlService', () => {
  it('copies source modules but never copies existing model state', async () => {
    await new Promise<void>((resolve) => setImmediate(resolve))
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-source-'))
    const lab = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-lab-'))
    try {
      const source = path.join(root, 'ml-service')
      fs.mkdirSync(path.join(source, 'models'), { recursive: true })
      fs.mkdirSync(path.join(source, 'state', '77'), { recursive: true })
      fs.writeFileSync(path.join(source, 'state', '77', 'state.pkl'), 'existing-state')
      for (const name of ['main.py', 'config.py', 'features.py', 'store.py'])
        fs.writeFileSync(path.join(source, name), 'fixture-source')
      fs.writeFileSync(path.join(source, 'models', 'detector.py'), 'fixture-model')
      const isolated = prepareIsolatedMlService({ projectRoot: root, labRoot: lab })
      expect(fs.existsSync(path.join(isolated, 'main.py'))).toBe(true)
      expect(fs.existsSync(path.join(isolated, 'models', 'detector.py'))).toBe(true)
      expect(fs.existsSync(path.join(isolated, 'state'))).toBe(false)
      expect(fs.readFileSync(path.join(source, 'state', '77', 'state.pkl'), 'utf8')).toBe(
        'existing-state'
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(lab, { recursive: true, force: true })
    }
  })
})
