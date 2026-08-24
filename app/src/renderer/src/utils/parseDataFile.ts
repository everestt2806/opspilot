/** Parse JSON/CSV thành bảng dữ liệu hiển thị trong workspace Database. */
export interface DbTable {
  name: string
  columns: string[]
  rows: Array<Record<string, string>>
}

export function parseJsonImport(text: string, fallbackName = 'imported'): DbTable[] {
  const parsed: unknown = JSON.parse(text)
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return [{ name: fallbackName, columns: [], rows: [] }]
    }
    const objects = parsed.filter(
      (item) => item && typeof item === 'object' && !Array.isArray(item)
    )
    if (objects.length === 0) {
      throw new Error('JSON array must contain objects')
    }
    const columns = [...new Set(objects.flatMap((row) => Object.keys(row as object)))]
    return [
      {
        name: fallbackName,
        columns,
        rows: objects.map((row) => flattenRow(row as Record<string, unknown>, columns))
      }
    ]
  }
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => Array.isArray(value))
      .map(([name, value]) => {
        const rows = (value as unknown[]).filter(
          (item) => item && typeof item === 'object' && !Array.isArray(item)
        ) as Record<string, unknown>[]
        const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
        return {
          name,
          columns,
          rows: rows.map((row) => flattenRow(row, columns))
        }
      })
  }
  throw new Error('Unsupported JSON shape')
}

function flattenRow(row: Record<string, unknown>, columns: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const col of columns) {
    const value = row[col]
    out[col] = value === null || value === undefined ? '' : String(value)
  }
  return out
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current.trim())
  return cells
}

export function parseCsvImport(text: string, fallbackName = 'imported'): DbTable[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
  if (lines.length === 0) {
    return [{ name: fallbackName, columns: [], rows: [] }]
  }
  const columns = splitCsvLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const row: Record<string, string> = {}
    columns.forEach((col, index) => {
      row[col] = cells[index] ?? ''
    })
    return row
  })
  return [{ name: fallbackName, columns, rows }]
}

export function exportTableJson(table: DbTable): string {
  return JSON.stringify(table.rows, null, 2)
}

export function exportTableCsv(table: DbTable): string {
  const header = table.columns.join(',')
  const body = table.rows
    .map((row) =>
      table.columns
        .map((col) => {
          const value = row[col] ?? ''
          return value.includes(',') || value.includes('"')
            ? `"${value.replace(/"/g, '""')}"`
            : value
        })
        .join(',')
    )
    .join('\n')
  return `${header}\n${body}`
}

export function downloadTextFile(filename: string, content: string, mime: string): void {
  try {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  } catch {
    // Môi trường test (jsdom) không có URL.createObjectURL — bỏ qua an toàn.
  }
}
