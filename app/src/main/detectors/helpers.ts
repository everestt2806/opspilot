import type { SourceTree } from './types'

export type PackageJson = {
  name?: string
  main?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export function readPackage(tree: SourceTree): PackageJson | undefined {
  return tree.readJson<PackageJson>('package.json')
}

export function allNodeDependencies(tree: SourceTree): Record<string, string> {
  const pkg = readPackage(tree)
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
}

export function dependencyVersion(value: string | undefined): string | undefined {
  return value?.replace(/^[\^~>=<\s]+/, '').split(' ')[0]
}

/** Parse .env.example mà không làm lộ giá trị secret vào BuildPlan. */
export function envExampleKeys(tree: SourceTree): string[] {
  const keys: string[] = []
  for (const rawLine of (tree.readText('.env.example') ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/)
    if (match?.[1] && !keys.includes(match[1])) keys.push(match[1])
  }
  return keys
}

export function publicBuildArgs(
  tree: SourceTree,
  prefix: 'VITE_' | 'NEXT_PUBLIC_' = 'VITE_'
): Record<string, string> {
  const args: Record<string, string> = {}
  for (const rawLine of (tree.readText('.env.example') ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(new RegExp(`^(?:export\\s+)?(${prefix}[A-Z0-9_]*)\\s*=\\s*(.*)$`))
    if (!match?.[1]) continue
    // Inline comments are documentation, not part of the public value.
    args[match[1]] = match[2]
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
  }
  return args
}

export function hasDependency(tree: SourceTree, name: string): boolean {
  return allNodeDependencies(tree)[name] !== undefined
}

export function hasSource(tree: SourceTree, pattern: RegExp): boolean {
  return tree.files.some((file) => pattern.test(file))
}

export type PortDetection = {
  port: number
  source: string
  valid: boolean
  error?: string
}

function parseEnvPort(
  tree: SourceTree
): { port: number; valid: boolean; rawVal: string; source: string } | undefined {
  const envText = tree.readText('.env.example') ?? ''
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?(?:PORT|APP_PORT)\s*=\s*(.*)$/)
    if (match?.[1] !== undefined) {
      const rawVal = match[1]
        .replace(/\s+#.*$/, '')
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2')
      if (!rawVal) continue
      const num = Number(rawVal)
      const valid = Number.isInteger(num) && num >= 1 && num <= 65535
      return {
        port: num,
        valid,
        rawVal,
        source: `.env.example (PORT=${rawVal})`
      }
    }
  }
  return undefined
}

function parseScriptPort(
  startScript: string
): { port: number; valid: boolean; rawVal: string; source: string } | undefined {
  if (!startScript) return undefined

  // 1. Biến môi trường PORT=... hoặc cross-env PORT=...
  const envMatch = startScript.match(/(?:^|\s)(?:cross-env\s+)?PORT=([^\s&|;]+)/)
  if (envMatch?.[1]) {
    const rawVal = envMatch[1].replace(/['"`]/g, '').trim()
    const num = Number(rawVal)
    const valid = Number.isInteger(num) && num >= 1 && num <= 65535
    return { port: num, valid, rawVal, source: `scripts.start (PORT=${rawVal})` }
  }

  // 2. Chỉ đọc cờ port ở lệnh có ngữ nghĩa port đã biết (ví dụ next start, npx next start, vite preview)
  const isNextStart = /^(?:(?:\w+=\S+|cross-env)\s+)*(?:npx\s+)?next\s+(?:start|dev)\b/.test(
    startScript
  )
  const isVitePreview = /^(?:(?:\w+=\S+|cross-env)\s+)*(?:npx\s+)?vite\s+preview\b/.test(
    startScript
  )
  const hasKnownPortCommand = isNextStart || isVitePreview

  if (hasKnownPortCommand) {
    const portFlagMatch = startScript.match(/(?:^|\s)(?:-p|--port)(?:=|\s+)([^\s&|;]+)/)
    if (portFlagMatch?.[1]) {
      const rawVal = portFlagMatch[1].replace(/['"`]/g, '').trim()
      const num = Number(rawVal)
      const valid = Number.isInteger(num) && num >= 1 && num <= 65535
      return { port: num, valid, rawVal, source: `scripts.start (${portFlagMatch[0].trim()})` }
    }
  }

  // Các lệnh khác (ví dụ: node server.js -p 5000, node server.js -v 8080, --max-old-space-size=4096)
  // KHÔNG có ngữ nghĩa port đã biết -> không suy bừa port từ cờ
  return undefined
}

function parseCodePort(
  tree: SourceTree,
  entryFile?: string
):
  | {
      port: number
      hardcoded: boolean
      source: string
      valid: boolean
      rawVal: string
    }
  | undefined {
  if (!entryFile) return undefined
  const normEntry = entryFile.replace(/^\.\//, '')
  const resolvedEntry = tree.has(normEntry)
    ? normEntry
    : tree.has(`${normEntry}.js`)
      ? `${normEntry}.js`
      : tree.has(`${normEntry}.ts`)
        ? `${normEntry}.ts`
        : undefined
  if (!resolvedEntry) return undefined

  const content = tree.readText(resolvedEntry) ?? ''
  const hasEnvPortRef = /process\.env\.(?:PORT|APP_PORT)\b/.test(content)

  // 1. dynamic port fallback: process.env.PORT || 3000 hoặc process.env.PORT ?? 3000
  const fallbackMatch =
    content.match(/process\.env\.(?:PORT|APP_PORT)\s*(?:\|\||\?\?)\s*(\d{2,5})\b/) ??
    content.match(
      /(?:const|let|var)\s+(?:PORT|port)\s*=\s*process\.env\.(?:PORT|APP_PORT)\s*(?:\|\||\?\?)\s*(\d{2,5})\b/
    )
  if (fallbackMatch?.[1]) {
    const rawVal = fallbackMatch[1].trim()
    const num = Number(rawVal)
    const valid = Number.isInteger(num) && num >= 1 && num <= 65535
    return {
      port: num,
      hardcoded: false,
      source: `${resolvedEntry} (${fallbackMatch[0]})`,
      valid,
      rawVal
    }
  }

  // 2. hardcoded listen: app.listen(3000)
  const listenMatch = content.match(/app\.listen\(\s*(\d{2,5})\b/)
  if (listenMatch?.[1]) {
    const rawVal = listenMatch[1].trim()
    const num = Number(rawVal)
    const valid = Number.isInteger(num) && num >= 1 && num <= 65535
    return {
      port: num,
      hardcoded: !hasEnvPortRef,
      source: `${resolvedEntry} (${listenMatch[0]})`,
      valid,
      rawVal
    }
  }

  // 3. hardcoded const PORT = 3000
  const constPortMatch = content.match(/(?:const|let|var)\s+(?:PORT|port)\s*=\s*(\d{2,5})\b/)
  if (constPortMatch?.[1]) {
    const rawVal = constPortMatch[1].trim()
    const num = Number(rawVal)
    const valid = Number.isInteger(num) && num >= 1 && num <= 65535
    return {
      port: num,
      hardcoded: !hasEnvPortRef,
      source: `${resolvedEntry} (${constPortMatch[0]})`,
      valid,
      rawVal
    }
  }

  // 4. Nếu chỉ gọi app.listen(process.env.PORT) không có fallback số
  if (hasEnvPortRef) {
    return {
      port: 3000,
      hardcoded: false,
      source: `${resolvedEntry} (process.env.PORT)`,
      valid: true,
      rawVal: 'process.env.PORT'
    }
  }

  return undefined
}

export function detectPort(
  tree: SourceTree,
  entryFile?: string,
  defaultPort = 3000
): PortDetection {
  const envPort = parseEnvPort(tree)
  const scriptPort = parseScriptPort(readPackage(tree)?.scripts?.start ?? '')
  const codePort = parseCodePort(tree, entryFile)

  // 1. Kiểm tra tính hợp lệ ở từng nguồn
  if (envPort && !envPort.valid) {
    return {
      port: defaultPort,
      source: envPort.source,
      valid: false,
      error: `Giá trị PORT '${envPort.rawVal}' trong .env.example không hợp lệ (cần từ 1 đến 65535)`
    }
  }
  if (scriptPort && !scriptPort.valid) {
    return {
      port: defaultPort,
      source: scriptPort.source,
      valid: false,
      error: `Giá trị port '${scriptPort.rawVal}' trong scripts.start không hợp lệ (cần từ 1 đến 65535)`
    }
  }
  if (codePort && !codePort.valid) {
    return {
      port: defaultPort,
      source: codePort.source,
      valid: false,
      error: `Giá trị port '${codePort.rawVal}' trong code không hợp lệ (cần từ 1 đến 65535)`
    }
  }

  // 2. Kiểm tra MÂU THUẪN (conflict) giữa các nguồn:
  // a) Mâu thuẫn giữa .env.example và scripts.start
  if (envPort && scriptPort && envPort.port !== scriptPort.port) {
    return {
      port: defaultPort,
      source: 'Mâu thuẫn cấu hình',
      valid: false,
      error: `Mâu thuẫn cổng: .env.example chỉ định port ${envPort.port} nhưng scripts.start chỉ định port ${scriptPort.port}`
    }
  }

  // b) Mâu thuẫn giữa .env.example và code cố định (hardcoded không dùng process.env.PORT)
  if (envPort && codePort && codePort.hardcoded && envPort.port !== codePort.port) {
    return {
      port: defaultPort,
      source: 'Mâu thuẫn cấu hình',
      valid: false,
      error: `Mâu thuẫn cổng: .env.example chỉ định port ${envPort.port} nhưng code (${codePort.source}) cố định port ${codePort.port} không nhận process.env.PORT`
    }
  }

  // c) Mâu thuẫn giữa scripts.start và code cố định
  if (scriptPort && codePort && codePort.hardcoded && scriptPort.port !== codePort.port) {
    return {
      port: defaultPort,
      source: 'Mâu thuẫn cấu hình',
      valid: false,
      error: `Mâu thuẫn cổng: scripts.start chỉ định port ${scriptPort.port} nhưng code (${codePort.source}) cố định port ${codePort.port}`
    }
  }

  // 3. Không có mâu thuẫn -> xác định port ưu tiên
  if (envPort) {
    return { port: envPort.port, source: envPort.source, valid: true }
  }
  if (scriptPort) {
    return { port: scriptPort.port, source: scriptPort.source, valid: true }
  }
  if (codePort && codePort.port) {
    return { port: codePort.port, source: codePort.source, valid: true }
  }

  return { port: defaultPort, source: `mặc định (${defaultPort})`, valid: true }
}

export type EntryResolution = {
  entry: string
  startCommand: string
  certain: boolean
  reason?: string
}

export function resolveExpressEntry(tree: SourceTree): EntryResolution {
  const pkg = readPackage(tree)
  if (!pkg) {
    return {
      entry: '',
      startCommand: '',
      certain: false,
      reason: 'Không tìm thấy file package.json'
    }
  }

  // 1. Trường hợp có scripts.start: ràng buộc regex vào lệnh thực sự chạy app
  if (pkg.scripts?.start) {
    const start = pkg.scripts.start.trim()

    // Chặn các cờ eval/print (-e, --eval, -p, --print) không phải file chạy app
    if (/\b(?:node|nodemon|ts-node)\s+(?:--?\S+\s+)*(?:-e|--eval|-p|--print)\b/.test(start)) {
      return {
        entry: '',
        startCommand: start,
        certain: false,
        reason: `Lệnh scripts.start '${start}' không phải lệnh chạy ứng dụng (dùng cờ eval/print thay vì file entry)`
      }
    }

    const runnerMatch = start.match(
      /^(?:(?:\w+=\S+|cross-env|dotenv(?:\s+-[^\s&|;]+)*(?:\s+--)?)\s+)*(?:node|nodemon|ts-node|pm2\s+start)\s+(?:--?\S+(?:=\S+|\s+\S+)?\s+)*([^\s&|;]+)/
    )

    if (runnerMatch?.[1]) {
      const rawEntry = runnerMatch[1].replace(/^\.\//, '').replace(/['"`]/g, '')
      if (rawEntry.startsWith('-')) {
        return {
          entry: '',
          startCommand: start,
          certain: false,
          reason: `Lệnh scripts.start '${start}' không chỉ định file entry hợp lệ`
        }
      }

      const resolved = tree.has(rawEntry)
        ? rawEntry
        : tree.has(`${rawEntry}.js`)
          ? `${rawEntry}.js`
          : tree.has(`${rawEntry}.ts`)
            ? `${rawEntry}.ts`
            : undefined

      if (resolved) {
        return { entry: resolved, startCommand: start, certain: true }
      }

      // BuildPlan của Express dùng 'npm ci --omit=dev' (không chạy build).
      // Không được dùng scripts.build làm bằng chứng nếu BuildPlan không chạy build.
      return {
        entry: rawEntry,
        startCommand: start,
        certain: false,
        reason: `File '${rawEntry}' khai báo trong scripts.start không tồn tại trong source (BuildPlan của Express không chạy build)`
      }
    }

    // Nếu start script không ràng buộc vào lệnh runner hợp lệ (ví dụ: echo, vitest, eslint, jest, exit 1, ...)
    return {
      entry: '',
      startCommand: start,
      certain: false,
      reason: `Lệnh scripts.start '${start}' không phải lệnh chạy ứng dụng (cần lệnh thực thi node/runtime)`
    }
  }

  // 2. Trường hợp thiếu scripts.start -> suy luận từ main hoặc file entry thực tế
  if (pkg.main) {
    const mainFile = pkg.main.trim().replace(/^\.\//, '')
    if (tree.has(mainFile)) {
      return { entry: mainFile, startCommand: `node ${mainFile}`, certain: true }
    }
    if (tree.has(`${mainFile}.js`)) {
      return { entry: `${mainFile}.js`, startCommand: `node ${mainFile}.js`, certain: true }
    }
    if (tree.has(`src/${mainFile}`)) {
      return { entry: `src/${mainFile}`, startCommand: `node src/${mainFile}`, certain: true }
    }
    return {
      entry: mainFile,
      startCommand: `node ${mainFile}`,
      certain: false,
      reason: `File '${pkg.main}' khai báo trong main không tồn tại trong source`
    }
  }

  // Tìm trong các file entry thông dụng
  const commonEntry = findCommonEntryFile(tree)
  if (commonEntry) {
    return { entry: commonEntry, startCommand: `node ${commonEntry}`, certain: true }
  }

  // Không đánh dấu "chắc chắn" khi thiếu cả script và file/đường dẫn chạy
  return {
    entry: 'server.js',
    startCommand: 'node server.js',
    certain: false,
    reason: 'Thiếu scripts.start và không tìm thấy file entry (server.js, app.js, index.js)'
  }
}

function findCommonEntryFile(tree: SourceTree, main?: string): string | undefined {
  const candidates = [
    main,
    'server.js',
    'app.js',
    'index.js',
    'src/server.js',
    'src/app.js',
    'src/index.js'
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    const norm = candidate.replace(/^\.\//, '')
    if (tree.has(norm)) return norm
    if (tree.has(`${norm}.js`)) return `${norm}.js`
    if (tree.has(`${norm}.ts`)) return `${norm}.ts`
  }
  return undefined
}

export type NextResolution = {
  startCommand: string
  entry?: string
  certain: boolean
  reason?: string
}

export function resolveNextStart(tree: SourceTree): NextResolution {
  const pkg = readPackage(tree)
  if (!pkg) {
    return { startCommand: '', certain: false, reason: 'Không tìm thấy package.json' }
  }

  if (pkg.scripts?.start) {
    const start = pkg.scripts.start.trim()

    // Chặn các cờ eval/print (-e, --eval, -p, --print) không phải file chạy app
    if (/\b(?:node|nodemon|ts-node)\s+(?:--?\S+\s+)*(?:-e|--eval|-p|--print)\b/.test(start)) {
      return {
        startCommand: start,
        certain: false,
        reason: `Lệnh scripts.start '${start}' không phải lệnh chạy ứng dụng Next.js (dùng cờ eval/print thay vì file entry)`
      }
    }

    // 1. next start (lệnh chuẩn chạy Next.js, có ràng buộc bắt đầu lệnh)
    const isNextStart = /^(?:(?:\w+=\S+|cross-env)\s+)*(?:npx\s+)?next\s+start\b/.test(start)
    if (isNextStart) {
      return { startCommand: 'npm start', certain: true }
    }

    // 2. custom server (node server.js ... có ràng buộc bắt đầu lệnh)
    const nodeMatch = start.match(
      /^(?:(?:\w+=\S+|cross-env)\s+)*(?:node|nodemon|ts-node)\s+(?:--?\S+(?:=\S+|\s+\S+)?\s+)*([^\s&|;]+)/
    )
    if (nodeMatch?.[1]) {
      const customServer = nodeMatch[1].replace(/^\.\//, '').replace(/['"`]/g, '')
      if (
        tree.has(customServer) ||
        tree.has(`${customServer}.js`) ||
        tree.has(`${customServer}.ts`)
      ) {
        return { startCommand: 'npm start', entry: customServer, certain: true }
      }
      return {
        startCommand: 'npm start',
        entry: customServer,
        certain: false,
        reason: `File custom server '${customServer}' trong scripts.start không tồn tại trong source`
      }
    }

    // 3. Start script không phải next start cũng không phải node runner
    return {
      startCommand: start,
      certain: false,
      reason: `Lệnh scripts.start '${start}' không phải lệnh chạy ứng dụng Next.js (cần 'next start' hoặc custom node server)`
    }
  }

  // Thiếu scripts.start:
  const hasAppDir =
    tree.has('app') ||
    tree.has('pages') ||
    tree.has('src/app') ||
    tree.has('src/pages') ||
    tree.files.some(
      (f) =>
        f.startsWith('app/') ||
        f.startsWith('pages/') ||
        f.startsWith('src/app/') ||
        f.startsWith('src/pages/')
    )

  if (hasAppDir) {
    return { startCommand: 'npx next start', certain: true }
  }

  // Không đánh dấu "chắc chắn" khi thiếu cả script và file/đường dẫn chạy
  return {
    startCommand: 'npm start',
    certain: false,
    reason: 'Thiếu scripts.start và không tìm thấy thư mục app/ hoặc pages/ để chạy Next.js'
  }
}
