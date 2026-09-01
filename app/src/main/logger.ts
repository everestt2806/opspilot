import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
type LogContext = Record<string, unknown>

const SECRET_KEYS = new Set([
  'password',
  'secret',
  'private_key',
  'privatekey',
  'encrypted_secret',
  'auth_tag',
  'authorization',
  'token'
])

export function maskSecrets(value: string): string {
  return value
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gi, '***')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s/]+(@)/gi, '$1***$2')
    .replace(
      /(["']?(?:password|secret|private_key|privateKey|encrypted_secret|auth_tag|authorization|token)["']?\s*[:=]\s*)(["']?)([^\s,"'}]+|[^"']*)(\2)/gi,
      '$1***'
    )
}

function sanitizeContext(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      if (SECRET_KEYS.has(key.toLowerCase())) {
        return [key, '***']
      }

      if (typeof value === 'string') {
        return [key, maskSecrets(value)]
      }

      return [key, value]
    })
  )
}

function logPath(date = new Date()): string {
  const datePart = date.toISOString().slice(0, 10)
  return join(homedir(), '.opspilot', 'logs', `app-${datePart}.log`)
}

function write(level: LogLevel, module: string, message: string, context: LogContext = {}): void {
  const safeMessage = maskSecrets(message)
  const safeContext = sanitizeContext(context)
  const suffix = Object.keys(safeContext).length > 0 ? ` ${JSON.stringify(safeContext)}` : ''
  const line = `${new Date().toISOString()} ${level} [${module}] ${safeMessage}${suffix}`

  if (process.env.NODE_ENV !== 'production') {
    console.log(line)
  }

  const target = logPath()
  mkdirSync(join(homedir(), '.opspilot', 'logs'), { recursive: true })
  appendFileSync(target, `${line}\n`, { encoding: 'utf8' })
}

export const logger = {
  debug: (module: string, message: string, context?: LogContext): void =>
    write('DEBUG', module, message, context),
  info: (module: string, message: string, context?: LogContext): void =>
    write('INFO', module, message, context),
  warn: (module: string, message: string, context?: LogContext): void =>
    write('WARN', module, message, context),
  error: (module: string, message: string, context?: LogContext): void =>
    write('ERROR', module, message, context)
}
