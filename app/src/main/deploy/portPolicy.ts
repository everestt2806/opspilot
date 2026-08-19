import { AppError } from '../errors'

/** Dải port cấp cho app deploy lên VPS (ADR-006). */
export const PORT_RANGE = { first: 30000, last: 30999 } as const

/** Port tự do nhỏ nhất trong dải — thuần, test không cần SSH/DB. */
export function allocatePort(usedPorts: number[]): number {
  const used = new Set(usedPorts)
  for (let port = PORT_RANGE.first; port <= PORT_RANGE.last; port += 1) {
    if (!used.has(port)) {
      return port
    }
  }
  throw new AppError(
    'PORT_EXHAUSTED',
    'Không còn cổng trống trong dải 30000-30999. Hãy gỡ bớt app trên VPS rồi thử lại.'
  )
}
