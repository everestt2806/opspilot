import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { detectFramework } from './index'
import { buildSourceTree } from './sourceTree'
import { expressDetector } from './express'
import { nextjsDetector } from './nextjs'
import { staticSpaDetector } from './static-spa'
import { resolveExpressEntry, resolveNextStart } from './helpers'

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

  it('khong khớp khi co next -> express detector tra false kem hint tieng Viet', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'web',
        dependencies: { express: '4.18.0', next: '14.2.3' }
      })
    })

    const tree = buildSourceTree(dir)
    expect(expressDetector.detect(tree)).toBe(false)
    const signals = expressDetector.explain(tree)
    expect(
      signals.some((signal) => signal.description.includes('next') && signal.passed === false)
    ).toBe(true)
  })
})

describe('C03 Tier 1 detector matrix', () => {
  it.each([
    {
      name: 'Next.js',
      packageJson: { dependencies: { next: '^14.2.35', react: '^18.3.1' } },
      env: 'NEXT_PUBLIC_SITE_NAME=Demo\n',
      detector: 'nextjs',
      port: 3000,
      template: 'nextjs.Dockerfile',
      build: 'npm ci && npm run build'
    },
    {
      name: 'Vite SPA',
      packageJson: { dependencies: { react: '^18.3.1' }, devDependencies: { vite: '^5.4.11' } },
      env: 'VITE_API_URL=http://api\n',
      detector: 'static-spa',
      port: 80,
      template: 'static-spa.Dockerfile',
      build: 'npm ci && npm run build'
    },
    {
      name: 'Express',
      packageJson: { dependencies: { express: '^4.21.2' } },
      env: 'PORT=3000\n',
      detector: 'express',
      port: 3000,
      template: 'express.Dockerfile',
      build: 'npm ci --omit=dev'
    }
  ])('$name is detected with its shared build plan', (fixture) => {
    const dir = createFixture({
      'package.json': JSON.stringify(fixture.packageJson),
      '.env.example': fixture.env
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.detector).toBe(fixture.detector)
    expect(result.plan.containerPort).toBe(fixture.port)
    expect(result.plan.dockerfileTemplate).toBe(fixture.template)
    expect(result.plan.buildCommand).toBe(fixture.build)
  })

  it('prefers Next.js over Vite and rejects malformed package JSON', () => {
    const nextOverVite = createFixture({
      'package.json': JSON.stringify({
        dependencies: { next: '14', react: '18' },
        devDependencies: { vite: '5' }
      })
    })
    expect(detectFramework(buildSourceTree(nextOverVite))).toMatchObject({
      matched: true,
      detector: 'nextjs'
    })
    const malformed = createFixture({ 'package.json': '{bad' })
    expect(detectFramework(buildSourceTree(malformed)).matched).toBe(false)
  })

  it.each([
    {
      name: 'Next only in devDependencies is not Next.js',
      packageJson: { devDependencies: { next: '14' } },
      detector: 'none'
    },
    {
      name: 'Vite only in dependencies is not Vite SPA',
      packageJson: { dependencies: { vite: '5' } },
      detector: 'none'
    },
    {
      name: 'Express only in devDependencies is not Express',
      packageJson: { devDependencies: { express: '4' } },
      detector: 'none'
    },
    {
      name: 'Next dependency wins over Vite devDependency',
      packageJson: { dependencies: { next: '14' }, devDependencies: { vite: '5' } },
      detector: 'nextjs'
    },
    {
      name: 'Vite devDependency wins over Express dependency',
      packageJson: { dependencies: { express: '4' }, devDependencies: { vite: '5' } },
      detector: 'static-spa'
    }
  ])('$name', (fixture) => {
    const dir = createFixture({ 'package.json': JSON.stringify(fixture.packageJson) })
    const result = detectFramework(buildSourceTree(dir))
    if (fixture.detector === 'none') {
      expect(result.matched).toBe(false)
    } else {
      expect(result).toMatchObject({ matched: true, detector: fixture.detector })
    }
  })

  it('keeps two public vars per framework in the BuildPlan defaults', () => {
    const nextDir = createFixture({
      'package.json': JSON.stringify({ dependencies: { next: '14' } }),
      '.env.example': 'NEXT_PUBLIC_API_URL=https://default.test\nNEXT_PUBLIC_SITE_NAME=Default\n'
    })
    const next = detectFramework(buildSourceTree(nextDir))
    expect(next.matched && next.plan.buildArgs).toEqual({
      NEXT_PUBLIC_API_URL: 'https://default.test',
      NEXT_PUBLIC_SITE_NAME: 'Default'
    })

    const viteDir = createFixture({
      'package.json': JSON.stringify({ devDependencies: { vite: '5' } }),
      '.env.example': 'VITE_API_URL=https://default.test\nVITE_SITE_NAME=Default\n'
    })
    const vite = detectFramework(buildSourceTree(viteDir))
    expect(vite.matched && vite.plan.buildArgs).toEqual({
      VITE_API_URL: 'https://default.test',
      VITE_SITE_NAME: 'Default'
    })
  })
})

describe('L6: Ba app mẫu thực tế (Next.js, Express, Vite SPA)', () => {
  const repoRoot = resolve(__dirname, '../../../../')
  const demoSources = join(repoRoot, 'demo/sources')

  it('nhận diện chính xác demo Next.js (next-blog)', () => {
    const sourcePath = join(demoSources, 'next-blog')
    const tree = buildSourceTree(sourcePath)
    const result = detectFramework(tree)

    expect(result.matched).toBe(true)
    if (!result.matched) return

    expect(result.detector).toBe('nextjs')
    expect(result.displayName).toBe('Next.js')
    expect(result.plan.dockerfileTemplate).toBe('nextjs.Dockerfile')
    expect(result.plan.containerPort).toBe(3000)
    expect(result.plan.buildCommand).toBe('npm ci && npm run build')
    expect(result.plan.startCommand).toBe('npm start')
    expect(result.plan.healthcheckPath).toBe('/')
    expect(result.plan.buildArgs).toEqual({
      NEXT_PUBLIC_SITE_NAME: 'OpsPilot Demo Blog'
    })
    expect(result.plan.requiredEnv).toContain('NODE_ENV')
    expect(result.plan.requiredEnv).toContain('NEXT_PUBLIC_SITE_NAME')
    expect(result.plan.needsDb).toBe(false)
    expect(result.plan.detectedVersion).toBe('14.2.35')

    // Kiểm tra evidence
    const signals = nextjsDetector.explain(tree)
    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'package.json tồn tại', passed: true }),
        expect.objectContaining({
          description: "dependencies có 'next'",
          passed: true,
          found: '14.2.35'
        })
      ])
    )
  })

  it('nhận diện chính xác demo Express (express-api)', () => {
    const sourcePath = join(demoSources, 'express-api')
    const tree = buildSourceTree(sourcePath)
    const result = detectFramework(tree)

    expect(result.matched).toBe(true)
    if (!result.matched) return

    expect(result.detector).toBe('express')
    expect(result.displayName).toBe('Express')
    expect(result.plan.dockerfileTemplate).toBe('express.Dockerfile')
    expect(result.plan.containerPort).toBe(3000)
    expect(result.plan.buildCommand).toBe('npm ci --omit=dev')
    expect(result.plan.startCommand).toBe('node server.js')
    expect(result.plan.healthcheckPath).toBe('/health')
    expect(result.plan.requiredEnv).toContain('DATABASE_URL')
    expect(result.plan.requiredEnv).toContain('PORT')
    expect(result.plan.requiredEnv).toContain('ENABLE_FAULT_ENDPOINTS')
    expect(result.plan.needsDb).toBe(true)
    expect(result.plan.detectedVersion).toBe('4.21.2')

    // Kiểm tra evidence
    const signals = expressDetector.explain(tree)
    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'package.json tồn tại', passed: true }),
        expect.objectContaining({
          description: "dependencies có 'express'",
          passed: true,
          found: '4.21.2'
        }),
        expect.objectContaining({ description: "không có 'next'", passed: true }),
        expect.objectContaining({ description: "không có 'vite'", passed: true })
      ])
    )
  })

  it('nhận diện chính xác demo Vite SPA (vite-spa)', () => {
    const sourcePath = join(demoSources, 'vite-spa')
    const tree = buildSourceTree(sourcePath)
    const result = detectFramework(tree)

    expect(result.matched).toBe(true)
    if (!result.matched) return

    expect(result.detector).toBe('static-spa')
    expect(result.displayName).toBe('Vite SPA')
    expect(result.plan.dockerfileTemplate).toBe('static-spa.Dockerfile')
    expect(result.plan.containerPort).toBe(80)
    expect(result.plan.buildCommand).toBe('npm ci && npm run build')
    expect(result.plan.startCommand).toBe('nginx -g "daemon off;"')
    expect(result.plan.healthcheckPath).toBe('/')
    expect(result.plan.buildArgs).toEqual({
      VITE_API_URL: 'http://localhost:3000'
    })
    expect(result.plan.requiredEnv).toContain('VITE_API_URL')
    expect(result.plan.needsDb).toBe(false)
    expect(result.plan.detectedVersion).toBe('5.4.11')

    // Kiểm tra evidence
    const signals = staticSpaDetector.explain(tree)
    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'package.json tồn tại', passed: true }),
        expect.objectContaining({
          description: "devDependencies có 'vite'",
          passed: true,
          found: '5.4.11'
        }),
        expect.objectContaining({ description: "không có 'next'", passed: true })
      ])
    )
  })
})

describe('L6: Evidence & Các trường hợp mơ hồ (ambiguous / edge cases)', () => {
  it('giải thích nguyên nhân khi dependency đặt sai vị trí (evidence reporting)', () => {
    // Next trong devDependencies thay vì dependencies
    const treeNextWrong = buildSourceTree(
      createFixture({
        'package.json': JSON.stringify({ devDependencies: { next: '14.2.35' } })
      })
    )
    const nextSignals = nextjsDetector.explain(treeNextWrong)
    const nextDepSignal = nextSignals.find((s) => s.description.includes('next'))
    expect(nextDepSignal?.passed).toBe(false)
    expect(nextDepSignal?.found).toBe('14.2.35')

    // Vite trong dependencies thay vì devDependencies
    const treeViteWrong = buildSourceTree(
      createFixture({
        'package.json': JSON.stringify({ dependencies: { vite: '5.4.11' } })
      })
    )
    const viteSignals = staticSpaDetector.explain(treeViteWrong)
    const viteDepSignal = viteSignals.find((s) => s.description.includes('vite'))
    expect(viteDepSignal?.passed).toBe(false)
    expect(viteDepSignal?.found).toBe('5.4.11')

    // Express trong devDependencies thay vì dependencies
    const treeExpressWrong = buildSourceTree(
      createFixture({
        'package.json': JSON.stringify({ devDependencies: { express: '4.21.2' } })
      })
    )
    const expressSignals = expressDetector.explain(treeExpressWrong)
    const expressDepSignal = expressSignals.find((s) => s.description.includes('express'))
    expect(expressDepSignal?.passed).toBe(false)
    expect(expressDepSignal?.found).toBe('4.21.2')
  })

  it('xung đột mơ hồ: Express dep + Vite dep -> cả hai detector đều từ chối', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'ambiguous-app',
        dependencies: { express: '4.21.2', vite: '5.4.11' }
      })
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    expect(result.hint).toContain('Không nhận diện được framework')
    // Vite SPA từ chối vì thiếu vite trong devDependencies
    expect(
      result.signals['static-spa'].some((s) => s.description.includes('vite') && !s.passed)
    ).toBe(true)
    // Express từ chối vì có vite trong dependencies
    expect(result.signals.express.some((s) => s.description.includes('vite') && !s.passed)).toBe(
      true
    )
  })

  it('thư mục không có package.json -> trả về matched false kèm signals và hint tiếng Việt', () => {
    const emptyDir = createFixture({ 'README.md': '# Dự án mới' })
    const result = detectFramework(buildSourceTree(emptyDir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    expect(result.hint).toContain('Không nhận diện được framework')
    expect(result.signals.nextjs.find((s) => s.description.includes('package.json'))?.passed).toBe(
      false
    )
    expect(result.signals.express.find((s) => s.description.includes('package.json'))?.passed).toBe(
      false
    )
    expect(
      result.signals['static-spa'].find((s) => s.description.includes('package.json'))?.passed
    ).toBe(false)
  })

  it('package.json chỉ có thư viện phụ trợ (lodash) -> matched false, không nhận bừa', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'utils',
        dependencies: { lodash: '4.17.21' }
      })
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
  })

  it('xử lý .env.example phức tạp: CRLF, comments, inline comments, quotes và export prefix', () => {
    const nextDir = createFixture({
      'package.json': JSON.stringify({ dependencies: { next: '14.2.35' } }),
      '.env.example':
        '# Header comment\r\n' +
        'NEXT_PUBLIC_API_URL="https://api.example.com" # inline comment\r\n' +
        "export NEXT_PUBLIC_SITE_NAME='Tên Website'\r\n" +
        'INTERNAL_SECRET=secret123\r\n'
    })
    const nextResult = detectFramework(buildSourceTree(nextDir))
    expect(nextResult.matched).toBe(true)
    if (!nextResult.matched) return
    expect(nextResult.plan.buildArgs).toEqual({
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
      NEXT_PUBLIC_SITE_NAME: 'Tên Website'
    })
    expect(nextResult.plan.requiredEnv).toContain('INTERNAL_SECRET')
    expect(nextResult.plan.requiredEnv).toContain('NEXT_PUBLIC_API_URL')
    expect(nextResult.plan.requiredEnv).toContain('NEXT_PUBLIC_SITE_NAME')
  })
})

describe('L6 Revision: Tự suy luận và xác thực custom port', () => {
  it('Express: nhận diện custom port từ .env.example (PORT=8080)', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'express-custom-port',
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node server.js' }
      }),
      'server.js': "require('express')().listen(process.env.PORT || 3000)",
      '.env.example': 'PORT=8080\n'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.detector).toBe('express')
    expect(result.plan.containerPort).toBe(8080)
  })

  it('Express: nhận diện custom port từ code app.listen(4000) khi không có .env.example', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'express-listen-port',
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node server.js' }
      }),
      'server.js': 'const app = require("express")(); app.listen(4000);'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.plan.containerPort).toBe(4000)
  })

  it('Express: nhận diện custom port từ scripts.start có biến môi trường (PORT=5000 node server.js)', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'express-env-port',
        dependencies: { express: '4.21.2' },
        scripts: { start: 'PORT=5000 node server.js' }
      }),
      'server.js': 'console.log("running")'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.plan.containerPort).toBe(5000)
  })

  it('Express: không nhận diện cờ -p trên lệnh node vì node không có ngữ nghĩa port (node server.js -p 5000) -> fallback 3000', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'express-flag-port',
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node server.js -p 5000' }
      }),
      'server.js': 'console.log("running")'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.plan.containerPort).toBe(3000)
  })

  it('Next.js: nhận diện custom port từ scripts.start (-p 8080)', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { next: '14.2.35' },
        scripts: { start: 'next start -p 8080' }
      })
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.detector).toBe('nextjs')
    expect(result.plan.containerPort).toBe(8080)
  })

  it('Next.js: nhận diện custom port từ .env.example (PORT=4000)', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { next: '14.2.35' },
        scripts: { start: 'next start' }
      }),
      '.env.example': 'PORT=4000\n'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.plan.containerPort).toBe(4000)
  })

  it('Dừng và báo lỗi khi PORT không hợp lệ trong .env.example (PORT=99999 hoặc PORT=invalid-port)', () => {
    const dirRange = createFixture({
      'package.json': JSON.stringify({
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node server.js' }
      }),
      'server.js': 'console.log(1)',
      '.env.example': 'PORT=99999\n'
    })
    const resultRange = detectFramework(buildSourceTree(dirRange))
    expect(resultRange.matched).toBe(false)
    if (resultRange.matched) return
    const portSignal = resultRange.signals.express.find((s) =>
      s.description.includes('cổng lắng nghe')
    )
    expect(portSignal?.passed).toBe(false)
    expect(portSignal?.found).toContain('99999')

    const dirString = createFixture({
      'package.json': JSON.stringify({
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node server.js' }
      }),
      'server.js': 'console.log(1)',
      '.env.example': 'PORT=invalid-port\n'
    })
    const resultString = detectFramework(buildSourceTree(dirString))
    expect(resultString.matched).toBe(false)
  })

  it('Dừng và báo lỗi khi port trong scripts.start không hợp lệ (next start -p 99999)', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { next: '14.2.35' },
        scripts: { start: 'next start -p 99999' }
      })
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const portSignal = result.signals.nextjs.find((s) => s.description.includes('cổng lắng nghe'))
    expect(portSignal?.passed).toBe(false)
    expect(portSignal?.found).toContain('99999')
  })

  it('Express: không nhận diện cờ không mang ngữ nghĩa port (-v 8080 hoặc --max-old-space-size=4096)', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node server.js -v 8080 --max-old-space-size=4096' }
      }),
      'server.js': 'console.log(1)'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    // Không được suy ra 8080 hay 4096 làm container port
    expect(result.plan.containerPort).toBe(3000)
  })

  it('Mâu thuẫn cổng: .env.example (PORT=8080) và scripts.start (PORT=4000) -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { express: '4.21.2' },
        scripts: { start: 'PORT=4000 node server.js' }
      }),
      'server.js': 'console.log(1)',
      '.env.example': 'PORT=8080\n'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const portSignal = result.signals.express.find((s) => s.description.includes('cổng lắng nghe'))
    expect(portSignal?.passed).toBe(false)
    expect(portSignal?.found).toContain('Mâu thuẫn cổng')
  })

  it('Mâu thuẫn cổng: .env.example (PORT=8080) và code cố định app.listen(3000) -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node server.js' }
      }),
      'server.js': 'const app = require("express")(); app.listen(3000);',
      '.env.example': 'PORT=8080\n'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const portSignal = result.signals.express.find((s) => s.description.includes('cổng lắng nghe'))
    expect(portSignal?.passed).toBe(false)
    expect(portSignal?.found).toContain('Mâu thuẫn cổng')
  })

  it('Mâu thuẫn cổng: scripts.start (PORT=5000) và code cố định app.listen(3000) -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { express: '4.21.2' },
        scripts: { start: 'PORT=5000 node server.js' }
      }),
      'server.js': 'const app = require("express")(); app.listen(3000);'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const portSignal = result.signals.express.find((s) => s.description.includes('cổng lắng nghe'))
    expect(portSignal?.passed).toBe(false)
    expect(portSignal?.found).toContain('Mâu thuẫn cổng')
  })
})

describe('L6 Revision: Xử lý start script thiếu hoặc khác chuẩn', () => {
  it('Express có start script không phải lệnh chạy app (echo) -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'echo-start-app',
        dependencies: { express: '4.21.2' },
        scripts: { start: "echo 'not starting'" }
      })
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const startSignal = result.signals.express.find((s) => s.description.includes('lệnh start'))
    expect(startSignal?.passed).toBe(false)
    expect(startSignal?.found).toContain('không phải lệnh chạy ứng dụng')
  })

  it('Express: không dùng scripts.build làm bằng chứng khi BuildPlan không chạy build (node dist/server.js thiếu file) -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'unbuilt-app',
        dependencies: { express: '4.21.2' },
        scripts: { build: 'tsc', start: 'node dist/server.js' }
      })
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const startSignal = result.signals.express.find((s) => s.description.includes('lệnh start'))
    expect(startSignal?.passed).toBe(false)
    expect(startSignal?.found).toContain('BuildPlan của Express không chạy build')
  })

  it('Next.js có start script không phải lệnh chạy app (vitest) -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { next: '14.2.35' },
        scripts: { start: 'vitest run' }
      })
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const startSignal = result.signals.nextjs.find((s) => s.description.includes('lệnh start'))
    expect(startSignal?.passed).toBe(false)
    expect(startSignal?.found).toContain('không phải lệnh chạy ứng dụng Next.js')
  })

  it('Express có start script khác chuẩn (node src/server.js) và file tồn tại -> khớp đúng plan', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'custom-start-app',
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node src/server.js' }
      }),
      'src/server.js': "require('express')().listen(3000)"
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.plan.startCommand).toBe('node src/server.js')
  })

  it('Express có start script trỏ file không tồn tại (node src/server.js) -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'missing-entry-app',
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node src/server.js' }
      })
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const startSignal = result.signals.express.find((s) => s.description.includes('lệnh start'))
    expect(startSignal?.passed).toBe(false)
    expect(startSignal?.found).toContain(
      "File 'src/server.js' khai báo trong scripts.start không tồn tại"
    )
  })

  it('Express thiếu scripts.start nhưng có main trỏ file tồn tại -> suy luận thành công', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'main-entry-app',
        dependencies: { express: '4.21.2' },
        main: 'app.js'
      }),
      'app.js': "require('express')().listen(3000)"
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.plan.startCommand).toBe('node app.js')
  })

  it('Express thiếu scripts.start, main trỏ file không tồn tại -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'bad-main-app',
        dependencies: { express: '4.21.2' },
        main: 'missing.js'
      })
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const startSignal = result.signals.express.find((s) => s.description.includes('lệnh start'))
    expect(startSignal?.passed).toBe(false)
    expect(startSignal?.found).toContain("File 'missing.js' khai báo trong main không tồn tại")
  })

  it('Express thiếu scripts.start và main, nhưng có file entry thông dụng (app.js) -> suy luận thành công', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'common-entry-app',
        dependencies: { express: '4.21.2' }
      }),
      'app.js': "require('express')().listen(3000)"
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.plan.startCommand).toBe('node app.js')
  })

  it('Express thiếu scripts.start và không tìm thấy file entry chuẩn trong source code -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'no-entry-app',
        dependencies: { express: '4.21.2' }
      }),
      'src/worker.js': 'console.log("worker")'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const startSignal = result.signals.express.find((s) => s.description.includes('lệnh start'))
    expect(startSignal?.passed).toBe(false)
    expect(startSignal?.found).toContain('Thiếu scripts.start và không tìm thấy file entry')
  })

  it('Next.js thiếu scripts.start nhưng có thư mục app/ -> suy luận npx next start', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { next: '14.2.35' }
      }),
      'app/page.tsx': 'export default function Page() { return <div>Blog</div> }'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.plan.startCommand).toBe('npx next start')
  })

  it('Next.js thiếu scripts.start và không có app/ hay pages/ -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { next: '14.2.35' }
      }),
      'lib/utils.js': 'module.exports = {}'
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const startSignal = result.signals.nextjs.find((s) => s.description.includes('lệnh start'))
    expect(startSignal?.passed).toBe(false)
    expect(startSignal?.found).toContain(
      'Thiếu scripts.start và không tìm thấy thư mục app/ hoặc pages/'
    )
  })

  it('Next.js có custom server trong scripts.start nhưng file server không tồn tại -> dừng và báo lỗi', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { next: '14.2.35' },
        scripts: { start: 'node custom-server.js' }
      })
    })
    const result = detectFramework(buildSourceTree(dir))
    expect(result.matched).toBe(false)
    if (result.matched) return
    const startSignal = result.signals.nextjs.find((s) => s.description.includes('lệnh start'))
    expect(startSignal?.passed).toBe(false)
    expect(startSignal?.found).toContain(
      "File custom server 'custom-server.js' trong scripts.start không tồn tại"
    )
  })
})

describe('L6 Revision 3: Regression tests theo 3 quy tắc chốt', () => {
  // Quy tắc 1: Chỉ đọc cờ port ở lệnh có ngữ nghĩa port đã biết
  describe('Quy tắc 1: Ngữ nghĩa cờ port', () => {
    it('không đọc cờ -p hay --port trên lệnh node (node server.js -p 8080) -> fallback mặc định 3000', () => {
      const dir = createFixture({
        'package.json': JSON.stringify({
          dependencies: { express: '4.21.2' },
          scripts: { start: 'node server.js -p 8080 --port 9090' }
        }),
        'server.js': 'console.log(1)'
      })
      const result = detectFramework(buildSourceTree(dir))
      expect(result.matched).toBe(true)
      if (!result.matched) return
      expect(result.plan.containerPort).toBe(3000)
    })

    it('đọc cờ -p và --port ở lệnh next start có ngữ nghĩa port đã biết', () => {
      // next start -p 8080
      const nextDir = createFixture({
        'package.json': JSON.stringify({
          dependencies: { next: '14.2.35' },
          scripts: { start: 'next start -p 8080' }
        })
      })
      const nextRes = detectFramework(buildSourceTree(nextDir))
      expect(nextRes.matched).toBe(true)
      if (nextRes.matched) expect(nextRes.plan.containerPort).toBe(8080)

      // next start --port 9090
      const nextDir2 = createFixture({
        'package.json': JSON.stringify({
          dependencies: { next: '14.2.35' },
          scripts: { start: 'next start --port 9090' }
        })
      })
      const nextRes2 = detectFramework(buildSourceTree(nextDir2))
      expect(nextRes2.matched).toBe(true)
      if (nextRes2.matched) expect(nextRes2.plan.containerPort).toBe(9090)
    })

    it('đọc biến môi trường PORT=... hoặc cross-env PORT=... ở bất kỳ lệnh start nào', () => {
      const dir = createFixture({
        'package.json': JSON.stringify({
          dependencies: { express: '4.21.2' },
          scripts: { start: 'cross-env PORT=4500 node server.js' }
        }),
        'server.js': 'console.log(1)'
      })
      const result = detectFramework(buildSourceTree(dir))
      expect(result.matched).toBe(true)
      if (!result.matched) return
      expect(result.plan.containerPort).toBe(4500)
    })
  })

  // Quy tắc 2: Ràng buộc regex start vào lệnh thực sự chạy app
  describe('Quy tắc 2: Ràng buộc regex start vào runner thực sự chạy app', () => {
    it('từ chối start script bắt đầu bằng lệnh không phải runner app (echo "node server.js")', () => {
      const dir = createFixture({
        'package.json': JSON.stringify({
          dependencies: { express: '4.21.2' },
          scripts: { start: "echo 'node server.js'" }
        }),
        'server.js': 'console.log(1)'
      })
      const result = detectFramework(buildSourceTree(dir))
      expect(result.matched).toBe(false)
      if (result.matched) return
      const startSignal = result.signals.express.find((s) => s.description.includes('lệnh start'))
      expect(startSignal?.passed).toBe(false)
      expect(startSignal?.found).toContain('không phải lệnh chạy ứng dụng')
    })

    it('từ chối start script dùng cờ eval hoặc print (node -e, node --eval, node -p)', () => {
      const dirEval = createFixture({
        'package.json': JSON.stringify({
          dependencies: { express: '4.21.2' },
          scripts: { start: "node -e 'console.log(1)'" }
        })
      })
      const resEval = detectFramework(buildSourceTree(dirEval))
      expect(resEval.matched).toBe(false)
      if (!resEval.matched) {
        const signal = resEval.signals.express.find((s) => s.description.includes('lệnh start'))
        expect(signal?.passed).toBe(false)
        expect(signal?.found).toContain('dùng cờ eval/print thay vì file entry')
      }

      const dirPrint = createFixture({
        'package.json': JSON.stringify({
          dependencies: { next: '14.2.35' },
          scripts: { start: "node -p '1+1'" }
        })
      })
      const resPrint = detectFramework(buildSourceTree(dirPrint))
      expect(resPrint.matched).toBe(false)
      if (!resPrint.matched) {
        const signal = resPrint.signals.nextjs.find((s) => s.description.includes('lệnh start'))
        expect(signal?.passed).toBe(false)
        expect(signal?.found).toContain('dùng cờ eval/print thay vì file entry')
      }
    })

    it('chấp nhận runner hợp lệ có tiền tố env setters (cross-env, dotenv, FOO=bar)', () => {
      const dir = createFixture({
        'package.json': JSON.stringify({
          dependencies: { express: '4.21.2' },
          scripts: { start: 'cross-env NODE_ENV=production node server.js' }
        }),
        'server.js': 'console.log(1)'
      })
      const result = detectFramework(buildSourceTree(dir))
      expect(result.matched).toBe(true)
      if (!result.matched) return
      expect(result.plan.startCommand).toBe('cross-env NODE_ENV=production node server.js')
    })
  })

  // Quy tắc 3: Không đánh dấu "chắc chắn" khi thiếu cả script và file/đường dẫn chạy
  describe('Quy tắc 3: Không đánh dấu "chắc chắn" khi thiếu cả script và file/đường dẫn chạy', () => {
    it('Express: resolveExpressEntry trả về certain: false và explain() báo signal passed: false khi thiếu cả script và entry file', () => {
      const dir = createFixture({
        'package.json': JSON.stringify({
          dependencies: { express: '4.21.2' }
        })
      })
      const tree = buildSourceTree(dir)
      const resolution = resolveExpressEntry(tree)
      expect(resolution.certain).toBe(false)
      expect(resolution.reason).toContain('Thiếu scripts.start và không tìm thấy file entry')

      const signals = expressDetector.explain(tree)
      const startSignal = signals.find((s) => s.description.includes('lệnh start / entry'))
      expect(startSignal?.passed).toBe(false)
      expect(startSignal?.found).toContain('Thiếu scripts.start và không tìm thấy file entry')
    })

    it('Next.js: resolveNextStart trả về certain: false và explain() báo signal passed: false khi thiếu cả script và app/pages', () => {
      const dir = createFixture({
        'package.json': JSON.stringify({
          dependencies: { next: '14.2.35' }
        })
      })
      const tree = buildSourceTree(dir)
      const resolution = resolveNextStart(tree)
      expect(resolution.certain).toBe(false)
      expect(resolution.reason).toContain(
        'Thiếu scripts.start và không tìm thấy thư mục app/ hoặc pages/'
      )

      const signals = nextjsDetector.explain(tree)
      const startSignal = signals.find((s) =>
        s.description.includes('lệnh start / cấu trúc thư mục')
      )
      expect(startSignal?.passed).toBe(false)
      expect(startSignal?.found).toContain(
        'Thiếu scripts.start và không tìm thấy thư mục app/ hoặc pages/'
      )
    })

    it('từ chối detectFramework khi repo có code JS/TS nhưng thiếu cả script và file entry', () => {
      const dir = createFixture({
        'package.json': JSON.stringify({
          dependencies: { express: '4.21.2' }
        }),
        'src/services/api.ts': 'export const api = 1'
      })
      const result = detectFramework(buildSourceTree(dir))
      expect(result.matched).toBe(false)
      if (result.matched) return
      expect(
        result.signals.express.some((s) => !s.passed && s.found?.includes('Thiếu scripts.start'))
      ).toBe(true)
    })
  })
})

describe('L6: CLI try-detect qua lệnh thực tế', () => {
  const repoRoot = resolve(__dirname, '../../../../')
  const scriptPath = join(repoRoot, 'app/.out-scripts/scripts/try-detect.js')
  const demoSources = join(repoRoot, 'demo/sources')

  beforeAll(() => {
    // Luôn build lại từ source mới nhất để CLI test luôn phản ánh code hiện tại
    execSync('pnpm --filter @opspilot/app exec tsc -p tsconfig.scripts.json', {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 60_000
    })
  }, 60_000)

  it('chạy try-detect tự biên dịch trên checkout mới nếu thiếu .out-scripts', () => {
    expect(existsSync(scriptPath)).toBe(true)
  })

  it('chạy try-detect trên fixture custom port qua CLI thực tế trả về containerPort tương ứng', () => {
    const customDir = createFixture({
      'package.json': JSON.stringify({
        name: 'cli-port-test',
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node server.js' }
      }),
      'server.js': 'console.log(1)',
      '.env.example': 'PORT=9090\n'
    })
    const out = execSync(`node "${scriptPath}" "${customDir}"`, { encoding: 'utf8' })
    const parsed = JSON.parse(out)
    expect(parsed.matched).toBe(true)
    expect(parsed.detector).toBe('express')
    expect(parsed.plan.containerPort).toBe(9090)
  })

  it('chạy try-detect trên fixture mâu thuẫn cổng qua CLI trả về matched: false và signal mâu thuẫn', () => {
    const conflictDir = createFixture({
      'package.json': JSON.stringify({
        name: 'cli-port-conflict',
        dependencies: { express: '4.21.2' },
        scripts: { start: 'PORT=4000 node server.js' }
      }),
      'server.js': 'console.log(1)',
      '.env.example': 'PORT=8080\n'
    })
    const out = execSync(`node "${scriptPath}" "${conflictDir}"`, { encoding: 'utf8' })
    const parsed = JSON.parse(out)
    expect(parsed.matched).toBe(false)
    expect(
      parsed.signals.express.some(
        (s: { passed: boolean; found?: string }) => !s.passed && s.found?.includes('Mâu thuẫn cổng')
      )
    ).toBe(true)
  })

  it('chạy try-detect trên fixture cấu hình mơ hồ/lỗi qua CLI trả về matched: false và signals rõ ràng', () => {
    const badPortDir = createFixture({
      'package.json': JSON.stringify({
        name: 'cli-bad-port',
        dependencies: { express: '4.21.2' },
        scripts: { start: 'node server.js' }
      }),
      'server.js': 'console.log(1)',
      '.env.example': 'PORT=99999\n'
    })
    const out = execSync(`node "${scriptPath}" "${badPortDir}"`, { encoding: 'utf8' })
    const parsed = JSON.parse(out)
    expect(parsed.matched).toBe(false)
    expect(
      parsed.signals.express.some(
        (s: { passed: boolean; found?: string }) => !s.passed && s.found?.includes('99999')
      )
    ).toBe(true)
  })

  it('chạy try-detect trên ba app mẫu thực tế trả về JSON đúng chuẩn', () => {
    // Next.js
    const nextOut = execSync(`node "${scriptPath}" "${join(demoSources, 'next-blog')}"`, {
      encoding: 'utf8'
    })
    const nextParsed = JSON.parse(nextOut)
    expect(nextParsed.matched).toBe(true)
    expect(nextParsed.detector).toBe('nextjs')
    expect(nextParsed.plan.containerPort).toBe(3000)

    // Express
    const expressOut = execSync(`node "${scriptPath}" "${join(demoSources, 'express-api')}"`, {
      encoding: 'utf8'
    })
    const expressParsed = JSON.parse(expressOut)
    expect(expressParsed.matched).toBe(true)
    expect(expressParsed.detector).toBe('express')
    expect(expressParsed.plan.containerPort).toBe(3000)

    // Vite
    const viteOut = execSync(`node "${scriptPath}" "${join(demoSources, 'vite-spa')}"`, {
      encoding: 'utf8'
    })
    const viteParsed = JSON.parse(viteOut)
    expect(viteParsed.matched).toBe(true)
    expect(viteParsed.detector).toBe('static-spa')
    expect(viteParsed.plan.containerPort).toBe(80)
  })

  it('chạy try-detect với cờ --explain đính kèm evidence đầy đủ', () => {
    const out = execSync(`node "${scriptPath}" "${join(demoSources, 'next-blog')}" --explain`, {
      encoding: 'utf8'
    })
    const parsed = JSON.parse(out)
    expect(parsed.matched).toBe(true)
    expect(parsed.evidence).toBeDefined()
    expect(parsed.evidence.nextjs).toBeDefined()
    expect(parsed.evidence.nextjs.some((s: { passed: boolean }) => s.passed === true)).toBe(true)
  })

  it('chạy try-detect trên thư mục không khớp trả về matched: false kèm signals', () => {
    const emptyDir = createFixture({ 'test.txt': 'data' })
    const out = execSync(`node "${scriptPath}" "${emptyDir}"`, {
      encoding: 'utf8'
    })
    const parsed = JSON.parse(out)
    expect(parsed.matched).toBe(false)
    expect(parsed.signals).toBeDefined()
    expect(parsed.hint).toContain('Không nhận diện được framework')
  })

  it('chạy try-detect với đường dẫn file hoặc đường dẫn không tồn tại -> exit code 2', () => {
    expect(() =>
      execSync(`node "${scriptPath}" "${join(demoSources, 'next-blog', 'package.json')}"`, {
        stdio: 'pipe'
      })
    ).toThrow()

    expect(() =>
      execSync(`node "${scriptPath}" "duong-dan-khong-ton-tai-abc-123"`, {
        stdio: 'pipe'
      })
    ).toThrow()
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
