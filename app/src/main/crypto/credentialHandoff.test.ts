import { describe, expect, it } from 'vitest'

import {
  cleanupPreflightScratch,
  prepareIsolatedMlService,
  removeLauncherScratchDirectory,
  resolveProfileClone,
  runSecretHandoff
} from './credentialHandoff'

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

  it('rejects a child that closes stdin before receiving the complete fixture', async () => {
    await expect(
      runSecretHandoff({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        secret: 'x'.repeat(1024 * 1024),
        cwd: process.cwd(),
        env: { ...process.env },
        timeoutMs: 5000,
        maxOutputBytes: 4096
      })
    ).rejects.toThrow('HANDOFF_STDIN_FAILED')
  })

  it('reports a sanitized spawn failure', async () => {
    await expect(
      runSecretHandoff({
        command: `${process.execPath}.missing`,
        args: [],
        secret: SECRET_FIXTURE,
        cwd: process.cwd(),
        env: {},
        timeoutMs: 1000,
        maxOutputBytes: 64
      })
    ).rejects.toThrow('HANDOFF_SPAWN_FAILED')
  })

  it('kills a child that exceeds the combined output limit', async () => {
    await expect(
      runSecretHandoff({
        command: process.execPath,
        args: ['-e', "process.stdin.resume();process.stdout.write('x'.repeat(8192))"],
        secret: SECRET_FIXTURE,
        cwd: process.cwd(),
        env: { ...process.env },
        timeoutMs: 5000,
        maxOutputBytes: 128
      })
    ).rejects.toThrow('HANDOFF_OUTPUT_LIMIT')
  })
})

describe('launcher path and scratch cleanup', () => {
  it('removes an empty or populated scratch directory recursively but only below temp root', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-launch-root-'))
    const scratch = fs.mkdtempSync(path.join(root, 'opspilot-ml-preflight-'))
    fs.mkdirSync(path.join(scratch, 'nested'))
    fs.writeFileSync(path.join(scratch, 'nested', 'fixture'), 'temporary')
    try {
      removeLauncherScratchDirectory(scratch, root)
      expect(fs.existsSync(scratch)).toBe(false)
      expect(() => removeLauncherScratchDirectory(root, root)).toThrow(
        'HANDOFF_SCRATCH_PATH_INVALID'
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([0, 2])('preserves preflight exit %s when cleanup succeeds', async (preflightExit) => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-clean-exit-'))
    const scratch = fs.mkdtempSync(path.join(root, 'opspilot-ml-preflight-'))
    fs.mkdirSync(path.join(scratch, 'ml-service'))
    try {
      expect(cleanupPreflightScratch(scratch, root, preflightExit)).toEqual({
        exitCode: preflightExit,
        cleanupFailed: false
      })
      expect(fs.existsSync(scratch)).toBe(false)
      expect(fs.readdirSync(root)).toEqual([])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves early failure before decrypt when no scratch directory exists', () => {
    expect(cleanupPreflightScratch(null, process.cwd(), 3)).toEqual({
      exitCode: 3,
      cleanupFailed: false
    })
  })

  it('reports a distinct cleanup failure after decrypt without masking it as preflight output', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-clean-fail-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-clean-outside-'))
    try {
      expect(cleanupPreflightScratch(outside, root, 0)).toEqual({
        exitCode: 3,
        cleanupFailed: true
      })
      expect(fs.existsSync(outside)).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('uses path containment rather than string prefixes and rejects root/outside profiles', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-profile-base-'))
    const root = path.join(base, 'temp')
    const sibling = path.join(base, 'temp-escape')
    fs.mkdirSync(root)
    fs.mkdirSync(sibling)
    const clone = path.join(root, 'profile')
    fs.mkdirSync(clone)
    try {
      expect(resolveProfileClone(clone, root)).toBe(fs.realpathSync(clone))
      expect(() => resolveProfileClone(root, root)).toThrow('HANDOFF_PROFILE_NOT_ISOLATED_CLONE')
      expect(() => resolveProfileClone(sibling, root)).toThrow('HANDOFF_PROFILE_NOT_ISOLATED_CLONE')
      const link = path.join(root, 'escape')
      try {
        fs.symlinkSync(sibling, link, 'junction')
        expect(() => resolveProfileClone(link, root)).toThrow('HANDOFF_PROFILE_NOT_ISOLATED_CLONE')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
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
