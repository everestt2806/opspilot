import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { AppError } from '../errors'
import {
  buildEnvFile,
  parseEnvFile,
  readEnvValue,
  renderCompose,
  renderBuildArgs,
  renderDockerfile,
  resolveTemplatesDir,
  type ComposeVars
} from './templates'
import { detectFramework } from '../detectors'
import { buildSourceTree } from '../detectors/sourceTree'

let fixture: string | undefined

afterEach(() => {
  if (fixture) {
    rmSync(fixture, { recursive: true, force: true })
    fixture = undefined
  }
})

const BASE_VARS: ComposeVars = {
  APP_NAME: 'demo-api',
  IMAGE_TAG: 'demo-api:v1',
  HOST_PORT: '30000',
  CONTAINER_PORT: '3000',
  HEALTHCHECK_PATH: '/health',
  START_COMMAND: 'node app.js',
  COLLECT_INTERVAL_S: '10',
  COLLECTOR_IMAGE_TAG: 'demo-api:collector',
  COLLECTOR_APP_PATH: '/items?limit=1',
  APP_DEPENDS_ON: ''
}

describe('resolveTemplatesDir', () => {
  it('tro ve thu muc templates o repo root khi chay tu app/', () => {
    expect(resolveTemplatesDir()).toMatch(/[\\/]templates$/)
  })
})

describe('renderCompose', () => {
  it('render du thu tu template voi port va healthcheck', () => {
    const yaml = renderCompose(BASE_VARS, false)
    expect(yaml).toContain('image: demo-api:v1')
    expect(yaml).toContain('container_name: demo-api-app')
    expect(yaml).toContain('"30000:3000"')
    expect(yaml).toContain('http://127.0.0.1:3000/health')
    expect(yaml).not.toContain('{{')
    expect(yaml).not.toContain('postgres')
    expect(yaml).toContain('image: demo-api:collector')
    expect(yaml).toContain('http://app:3000/items?limit=1')
    expect(yaml).toContain('/var/run/docker.sock:/var/run/docker.sock:ro')
  })

  it('chen service postgres khi needsDb', () => {
    const yaml = renderCompose(BASE_VARS, true)
    expect(yaml).toContain('image: postgres:16-alpine')
    expect(yaml).toContain('container_name: demo-api-db')
    expect(yaml).toContain('${POSTGRES_PASSWORD}')
    expect(yaml).toContain('./data/pg:/var/lib/postgresql/data')
    expect(yaml).not.toContain('{{')
    expect(yaml).toContain('DB_DSN: "${DATABASE_URL:-}"')
    expect(yaml).toContain('condition: service_healthy')
    expect(yaml).toContain('pg_isready -U opspilot -d opspilot')
  })
})

describe('renderDockerfile', () => {
  it('thay build command va start command, khong con placeholder', () => {
    const dockerfile = renderDockerfile('express.Dockerfile', {
      ...BASE_VARS,
      BUILD_COMMAND: 'npm ci --omit=dev'
    })
    expect(dockerfile).toContain('npm ci --omit=dev')
    expect(dockerfile).toContain('node app.js')
    expect(dockerfile).not.toContain('{{')
  })

  it.each(['nextjs.Dockerfile', 'static-spa.Dockerfile'])(
    '%s renders a production template',
    (name) => {
      const dockerfile = renderDockerfile(name, {
        ...BASE_VARS,
        BUILD_COMMAND: 'npm ci && npm run build',
        BUILD_ARGS: 'ARG NEXT_PUBLIC_API_URL\nENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}'
      })
      expect(dockerfile).not.toContain('{{')
      expect(dockerfile).toContain('FROM')
      expect(dockerfile).toContain('COPY src/package*.json')
      expect(dockerfile).toContain('ARG NEXT_PUBLIC_API_URL')
    }
  )

  it('renders every public build key without demo-specific template names', () => {
    const buildArgs = renderBuildArgs({
      NEXT_PUBLIC_API_URL: 'https://api.example.test',
      NEXT_PUBLIC_SITE_NAME: 'A name with spaces',
      VITE_SITE_NAME: 'A $value',
      VITE_API_URL: 'https://api.example.test'
    })
    expect(buildArgs).toContain(
      'ARG NEXT_PUBLIC_API_URL\nENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}'
    )
    expect(buildArgs).toContain(
      'ARG NEXT_PUBLIC_SITE_NAME\nENV NEXT_PUBLIC_SITE_NAME=${NEXT_PUBLIC_SITE_NAME}'
    )
    expect(buildArgs).toContain('ARG VITE_SITE_NAME\nENV VITE_SITE_NAME=${VITE_SITE_NAME}')
    expect(buildArgs).toContain('ARG VITE_API_URL\nENV VITE_API_URL=${VITE_API_URL}')
    expect(renderBuildArgs({})).toBe('')
  })

  it.each([
    {
      name: 'Next.js defaults and override-safe values',
      packageJson: { dependencies: { next: '14' } },
      env: 'NEXT_PUBLIC_API_URL=https://default.test\nNEXT_PUBLIC_SITE_NAME=Default\n',
      template: 'nextjs.Dockerfile',
      buildCommand: 'npm ci && npm run build',
      startCommand: 'npm start',
      port: '3000',
      keys: ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_SITE_NAME']
    },
    {
      name: 'Vite defaults and override-safe values',
      packageJson: { devDependencies: { vite: '5' } },
      env: 'VITE_API_URL=https://default.test\nVITE_SITE_NAME=Default\n',
      template: 'static-spa.Dockerfile',
      buildCommand: 'npm ci && npm run build',
      startCommand: 'nginx -g "daemon off;"',
      port: '80',
      keys: ['VITE_API_URL', 'VITE_SITE_NAME']
    },
    {
      name: 'Express without build args',
      packageJson: { dependencies: { express: '4' } },
      env: '',
      template: 'express.Dockerfile',
      buildCommand: 'npm ci --omit=dev',
      startCommand: 'node app.js',
      port: '3000',
      keys: []
    }
  ])('$name keeps the detector plan connected to Dockerfile rendering', (testCase) => {
    fixture = mkdtempSync(join(tmpdir(), 'c03-build-args-'))
    mkdirSync(fixture, { recursive: true })
    writeFileSync(join(fixture, 'package.json'), JSON.stringify(testCase.packageJson), 'utf8')
    if (testCase.env) writeFileSync(join(fixture, '.env.example'), testCase.env, 'utf8')

    const result = detectFramework(buildSourceTree(fixture))
    expect(result.matched).toBe(true)
    if (!result.matched) return

    expect(result.plan.dockerfileTemplate).toBe(testCase.template)
    const buildArgs = renderBuildArgs(result.plan.buildArgs)
    const dockerfile = renderDockerfile(result.plan.dockerfileTemplate, {
      BUILD_COMMAND: testCase.buildCommand,
      START_COMMAND: testCase.startCommand,
      CONTAINER_PORT: testCase.port,
      BUILD_ARGS: buildArgs
    })
    for (const key of testCase.keys) {
      expect(result.plan.buildArgs).toHaveProperty(key)
      expect(buildArgs).toContain(`ARG ${key}`)
      expect(dockerfile).toContain(`ARG ${key}`)
      expect(dockerfile).toContain(`ENV ${key}=\${${key}}`)
    }
    if (testCase.keys.length === 0) expect(buildArgs).toBe('')
  })

  it('bao loi ro rang khi thieu bien thay the', () => {
    const missingVars = Object.fromEntries(
      Object.entries({ ...BASE_VARS, BUILD_COMMAND: 'npm ci' }).filter(
        ([key]) => key !== 'START_COMMAND'
      )
    )

    let caught: unknown
    try {
      renderDockerfile('express.Dockerfile', missingVars)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppError)
    expect((caught as AppError).userMessage).toContain('Template thiếu biến START_COMMAND')
  })
})

describe('buildEnvFile', () => {
  it('khi khong can DB: chi ghi env nguoi dung truyen', () => {
    const { content, dbPassword } = buildEnvFile({ PORT: '3000', API_KEY: 'abc' }, false)
    expect(content).toBe('PORT=3000\nAPI_KEY=abc\n')
    expect(dbPassword).toBeNull()
  })

  it('khi can DB: bat buoc sinh POSTGRES_PASSWORD ngau nhien va DATABASE_URL tu dong', () => {
    const { content, dbPassword } = buildEnvFile({}, true)
    expect(dbPassword).toMatch(/^[0-9a-f]{24}$/)
    expect(content).toContain(`POSTGRES_PASSWORD=${dbPassword}`)
    expect(content).toContain(
      `DATABASE_URL=postgresql://opspilot:${dbPassword}@postgres:5432/opspilot`
    )
  })

  it('ton trong POSTGRES_PASSWORD va DATABASE_URL nguoi dung da nhap', () => {
    const { content, dbPassword } = buildEnvFile(
      { POSTGRES_PASSWORD: 'nguoi-dung-dat', DATABASE_URL: 'custom://x' },
      true
    )
    expect(dbPassword).toBe('nguoi-dung-dat')
    expect(content).toContain('POSTGRES_PASSWORD=nguoi-dung-dat')
    expect(content).toContain('DATABASE_URL=custom://x')
  })

  it('khong can bien nao: ghi chu thich thay vi file trong', () => {
    expect(buildEnvFile({}, false).content).toContain('#')
  })

  it('doc dung gia tri secret tu noi dung .env ma khong an phan sau dau bang', () => {
    const content = '# managed\nPOSTGRES_PASSWORD=abc=123\nDATABASE_URL=postgresql://x\n'
    expect(readEnvValue(content, 'POSTGRES_PASSWORD')).toBe('abc=123')
    expect(readEnvValue(content, 'DATABASE_URL')).toBe('postgresql://x')
    expect(readEnvValue(content, 'MISSING')).toBeUndefined()
  })
})

describe('parseEnvFile', () => {
  it('parse cac dong KEY=VALUE va bo comment, dong trong, gia tri rong', () => {
    expect(
      parseEnvFile(
        '# managed\nVITE_API_URL=http://221.121.1.80:30001\n\nPORT=3000\nEMPTY=\ndong-khong-co-dau-bang\n'
      )
    ).toEqual({ VITE_API_URL: 'http://221.121.1.80:30001', PORT: '3000' })
  })

  it('giu nguyen dau bang long trong value, quote va chiu CRLF', () => {
    expect(
      parseEnvFile(
        'DATABASE_URL=postgresql://user:pw@postgres:5432/db\r\nSITE_NAME="Ops Pilot"\r\n'
      )
    ).toEqual({
      DATABASE_URL: 'postgresql://user:pw@postgres:5432/db',
      SITE_NAME: '"Ops Pilot"'
    })
  })

  it('file rong hoac chi co comment tra bang rong', () => {
    expect(parseEnvFile('')).toEqual({})
    expect(parseEnvFile('# Khong can bien moi truong nao\n')).toEqual({})
  })
})
