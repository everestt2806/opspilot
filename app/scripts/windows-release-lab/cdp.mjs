/* eslint-disable @typescript-eslint/explicit-function-return-type -- Công cụ kiểm chứng CDP cục bộ. */
import assert from 'node:assert/strict'

export const pause = (ms) => new Promise((done) => setTimeout(done, ms))

export async function until(check, message, timeout = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const result = await check()
    if (result) return result
    await pause(300)
  }
  throw Error(message)
}

export async function connect(url) {
  assert(url.startsWith('ws://127.0.0.1:'))
  const socket = new WebSocket(url)
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let sequence = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const reply = JSON.parse(data)
    const request = pending.get(reply.id)
    if (!request) return
    pending.delete(reply.id)
    clearTimeout(request.timer)
    if (reply.error) request.reject(Error('CDP_REQUEST_FAILED'))
    else request.done(reply.result)
  })
  const send = (method, params = {}) =>
    new Promise((done, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(Error('CDP_REQUEST_TIMEOUT'))
      }, 40000)
      pending.set(id, { done, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  return {
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      })
      assert(!result.exceptionDetails, 'RENDERER_EVALUATION_FAILED')
      return result.result.value
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(Error('CDP_CLOSED'))
      }
      pending.clear()
      socket.close()
    }
  }
}
