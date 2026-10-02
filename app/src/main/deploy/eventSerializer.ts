/**
 * Event Serializer & Secret Redactor cho deploy-cli.ts (TK-S6 P2d-1b)
 *
 * Ràng buộc bảo mật:
 *   1. Khử SSH secret, password và toàn bộ giá trị env_vars trước khi phát bất kỳ sự kiện
 *      hoặc log lỗi nào ra stdout.
 *   2. Khử đệ quy qua các đối tượng, chuỗi, mảng, error message, và technical details.
 *   3. Định dạng JSON chuẩn một dòng máy đọc được cho stdout.
 */

export function sanitizeText(text: string, secrets: string[]): string {
  if (!text) return text
  let result = text
  for (const secret of secrets) {
    if (secret && typeof secret === 'string' && secret.trim().length > 0) {
      result = result.split(secret).join('***REDACTED***')
    }
  }
  return result
}

export function sanitizeObject<T>(obj: T, secrets: string[]): T {
  if (!secrets || secrets.length === 0 || obj === null || obj === undefined) {
    return obj
  }
  if (typeof obj === 'string') {
    return sanitizeText(obj, secrets) as unknown as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, secrets)) as unknown as T
  }
  if (typeof obj === 'object') {
    const res: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      const sanitizedKey = sanitizeText(k, secrets)
      res[sanitizedKey] = sanitizeObject(v, secrets)
    }
    return res as unknown as T
  }
  return obj
}

export function serializeCliEvent(eventObj: unknown, secrets: string[]): string {
  const sanitized = sanitizeObject(eventObj, secrets)
  return JSON.stringify(sanitized)
}
