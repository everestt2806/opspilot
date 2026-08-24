/** Parse detail_json từ action_log thành cặp key–value hiển thị trong drawer. */
export function parseDetailJson(detailJson: string | null): Array<[string, string]> {
  if (!detailJson) return []
  try {
    const parsed: unknown = JSON.parse(detailJson)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : JSON.stringify(value)
      ])
    }
  } catch {
    return []
  }
  return []
}
