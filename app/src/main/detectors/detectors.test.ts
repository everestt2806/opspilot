import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { detectFramework } from './index'
import { buildSourceTree } from './sourceTree'
import { expressDetector } from './express'

let testDirectory: string | null = null

afterEach(() => {
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('buildSourceTree', () => {
  it('liet ke file, bo node_modules/.git, ho tro readText/readJson/has', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({ name: 'demo' }),
      'app.js': 'console.log(1)',
      'node_modules/express/package.json': '{}',
      '.git/config': 'x'
    })

    const tree = buildSourceTree(dir)
    expect(tree.files).toContain('package.json')
    expect(tree.files).toContain('app.js')
    expect(tree.files).not.toContain('node_modules/express/package.json')
    expect(tree.files).not.toContain('.git/config')
    expect(tree.has('package.json')).toBe(true)
    expect(tree.readJson('package.json')).toEqual({ name: 'demo' })
    expect(tree.readText('app.js')).toContain('console.log')
  })

  it('readJson tra undefined voi JSON loi cu phap, khong throw', () => {
    const dir = createFixture({ 'package.json': '{ loi cu phap' })
    const tree = buildSourceTree(dir)
    expect(tree.readJson('package.json')).toBeUndefined()
  })
})

describe('expressDetector + engine', () => {
  it('nhan dien express voi pg -> needsDb, doc healthcheck path va env.example', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'demo-api',
        main: 'app.js',
        scripts: { start: 'node app.js' },
        dependencies: { express: '^4.19.2', pg: '^8.11.0' },
        devDependencies: { nodemon: '^3.0.0' }
      }),
      'app.js': `
        const express = require('express')
        const app = express()
        app.get('/health', (req, res) => res.json({ ok: true }))
        app.listen(3000)
      `,
      '.env.example': 'PORT=3000\nSECRET_KEY=thay-gia-tri\n# ghi chu\nDB_HOST=localhost\n'
    })

    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) {
      return
    }

    expect(result.detector).toBe('express')
    expect(result.displayName).toBe('Express')
    expect(result.plan.dockerfileTemplate).toBe('express.Dockerfile')
    expect(result.plan.containerPort).toBe(3000)
    expect(result.plan.healthcheckPath).toBe('/health')
    expect(result.plan.startCommand).toBe('node app.js')
    expect(result.plan.needsDb).toBe(true)
    expect(result.plan.detectedVersion).toBe('4.19.2')
    expect(result.plan.requiredEnv).toEqual(
      expect.arrayContaining(['PORT', 'SECRET_KEY', 'DB_HOST', 'DATABASE_URL'])
    )
    expect(result.plan.buildCommand).toBe('npm ci --omit=dev')
  })

  it('khong co route /health trong entry -> fallback healthcheck path "/"', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'api',
        main: 'index.js',
        scripts: { start: 'node index.js' },
        dependencies: { express: '4.18.0' }
      }),
      'index.js': "const app = require('express')()\napp.get('/', (req, res) => res.send('ok'))\n"
    })

    const detector = expressDetector
    const tree = buildSourceTree(dir)
    expect(detector.detect(tree)).toBe(true)
    expect(detector.buildPlan(tree).healthcheckPath).toBe('/')
  })

  it('mongoose -> canh bao thao tac thu cong, khong sinh postgres', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'api',
        dependencies: { express: '4.18.0', mongoose: '8.0.0' }
      })
    })

    const plan = expressDetector.buildPlan(buildSourceTree(dir))
    expect(plan.needsDb).toBe(false)
    expect(plan.manualSteps.some((step) => step.includes('mongoose'))).toBe(true)
  })

  it('khong khớp khi co next -> engine tra unmatched kem hint tieng Viet', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'web',
        dependencies: { express: '4.18.0', next: '14.2.3' }
      })
    })

    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) {
      return
    }
    expect(result.hint).toContain('Không nhận diện được framework')
    expect(result.signals.express.some((signal) => signal.passed === false)).toBe(true)
  })
})

function createFixture(files: Record<string, string>): string {
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-detectors-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(testDirectory, relativePath)
    mkdirFor(target)
    writeFileSync(target, content, 'utf8')
  }
  return testDirectory
}

function mkdirFor(filePath: string): void {
  mkdirSync(join(filePath, '..'), { recursive: true })
}
