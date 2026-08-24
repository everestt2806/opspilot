import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AppError } from '../errors'

/**
 * Thư mục chứa template deploy (Dockerfile từng framework + compose) — không kèm script bash
 * để tránh bẫy CRLF khi render lên VPS (docs/09 4.2).
 * Dev: repo root/templates; đóng gói: electron-builder extraResources (TK-A15).
 */
export function resolveTemplatesDir(): string {
  return process.env.OPSPILOT_TEMPLATES_DIR ?? join(process.cwd(), '..', 'templates')
}

/** Thay mọi {{VAR}}; VAR không có trong bảng -> lỗi rõ ràng, không im lặng bỏ qua. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (whole, name: string) => {
    const value = vars[name]
    if (value === undefined) {
      throw new AppError('UNKNOWN', `Template thiếu biến ${name}.`, { cause: whole })
    }
    return value
  })
}

function readTemplateFile(name: string): string {
  try {
    return readFileSync(join(resolveTemplatesDir(), name), 'utf8')
  } catch (error) {
    throw new AppError('UNKNOWN', `Không đọc được template ${name}. Hãy cài lại ứng dụng.`, {
      cause: error
    })
  }
}

export type ComposeVars = {
  APP_NAME: string
  IMAGE_TAG: string
  HOST_PORT: string
  CONTAINER_PORT: string
  HEALTHCHECK_PATH: string
  START_COMMAND: string
  COLLECT_INTERVAL_S: string
}

const POSTGRES_SERVICE_YAML = `  postgres:
    image: postgres:16-alpine
    container_name: {{APP_NAME}}-db
    environment:
      POSTGRES_USER: opspilot
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: opspilot
    volumes:
      - ./data/pg:/var/lib/postgresql/data
    mem_limit: 256m
    restart: unless-stopped`

/** Compose cho mọi framework: service app + postgres nếu needsDb (volume ./data/pg). */
export function renderCompose(vars: ComposeVars, needsDb: boolean): string {
  const template = readTemplateFile('docker-compose.template.yml')
  const extra = needsDb ? renderTemplate(POSTGRES_SERVICE_YAML, vars) : ''
  return (
    renderTemplate(template, {
      ...vars,
      EXTRA_SERVICES: extra
    }).trimEnd() + '\n'
  )
}

export function renderDockerfile(dockerfileTemplate: string, vars: Record<string, string>): string {
  return renderTemplate(readTemplateFile(dockerfileTemplate), vars).trimEnd() + '\n'
}

/**
 * Nội dung .env ghi lên VPS (chmod 600, ghi lặng — bất biến 3 deploy-events).
 * needsDb -> tự sinh DATABASE_URL + POSTGRES_PASSWORD nếu người dùng chưa truyền.
 */
export function buildEnvFile(
  env: Record<string, string>,
  needsDb: boolean,
  generatedDbPassword?: string
): { content: string; dbPassword: string | null } {
  const merged = { ...env }
  let dbPassword: string | null = null

  if (needsDb) {
    dbPassword = merged.POSTGRES_PASSWORD ?? generatedDbPassword ?? randomBytes(12).toString('hex')
    merged.POSTGRES_PASSWORD = dbPassword
    if (merged.DATABASE_URL === undefined) {
      merged.DATABASE_URL = `postgresql://opspilot:${dbPassword}@postgres:5432/opspilot`
    }
  }

  const lines = Object.entries(merged).map(([key, value]) => `${key}=${value}`)
  return {
    content: lines.length > 0 ? `${lines.join('\n')}\n` : '# Không cần biến môi trường nào\n',
    dbPassword
  }
}

/** Đọc một giá trị từ nội dung .env mà không log hoặc diễn giải secret. */
export function readEnvValue(content: string, key: string): string | undefined {
  const prefix = `${key}=`
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith(prefix)) {
      const value = line.slice(prefix.length).trim()
      return value.length > 0 ? value : undefined
    }
  }
  return undefined
}
