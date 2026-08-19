import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import type { SourceTree } from './types'

/** Đồ án detector (docs/10): detector không được chạm fs — mọi thứ đọc sẵn ở đây. */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.venv', '__pycache__'])
const MAX_FILES = 20_000

export function buildSourceTree(rootPath: string): SourceTree {
  const root = resolve(rootPath)
  const files: string[] = []
  const cache = new Map<string, string>()

  const walk = (dir: string, depth: number): void => {
    if (files.length >= MAX_FILES || depth > 12) {
      return
    }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(join(dir, entry.name), depth + 1)
        }
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const rel = toPosix(relative(root, join(dir, entry.name)))
      files.push(rel)
    }
  }

  walk(root, 0)
  files.sort()

  const readText = (relPath: string): string | undefined => {
    if (cache.has(relPath)) {
      return cache.get(relPath)
    }
    if (!files.includes(relPath)) {
      return undefined
    }
    try {
      const content = readFileSync(join(root, ...relPath.split('/')), 'utf8')
      cache.set(relPath, content)
      return content
    } catch {
      return undefined
    }
  }

  const readJson = <T = unknown>(relPath: string): T | undefined => {
    const text = readText(relPath)
    if (text === undefined) {
      return undefined
    }
    try {
      return JSON.parse(text) as T
    } catch {
      return undefined
    }
  }

  return {
    rootPath: root,
    files,
    readText,
    readJson,
    has: (relPath) => files.includes(relPath)
  }
}

function toPosix(value: string): string {
  return value.split(sep).join('/')
}
