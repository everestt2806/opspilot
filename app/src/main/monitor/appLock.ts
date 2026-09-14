type Job<T> = () => Promise<T>

const tails = new Map<number, Promise<unknown>>()

/** One queue is shared by deploy/rollback and monitor polling for each app. */
export function withAppLock<T>(appId: number, job: Job<T>): Promise<T> {
  const previous = tails.get(appId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(job)
  tails.set(appId, current)
  return current.finally(() => {
    if (tails.get(appId) === current) tails.delete(appId)
  })
}
