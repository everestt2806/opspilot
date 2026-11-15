/* eslint-disable @typescript-eslint/explicit-function-return-type -- Chỉ stdin có giới hạn cho gate vận hành. */
export async function privateInput() {
  const tty = process.stdin.isTTY
  if (!tty) {
    let text = ''
    for await (const chunk of process.stdin) {
      text += chunk
      if (text.length > 32768) throw Error('INPUT_LIMIT')
    }
    try {
      return JSON.parse(text)
    } finally {
      text = ''
    }
  }
  // Raw mode tắt echo trước READY; newline Windows có thể là CR thay vì LF.
  process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  console.log('PRIVATE_INPUT_READY_NO_ECHO')
  return new Promise((resolve, reject) => {
    let text = ''
    const timer = setTimeout(() => finish(Error('INPUT_TIMEOUT')), 60000)
    const finish = (error) => {
      clearTimeout(timer)
      process.stdin.removeListener('data', read)
      process.stdin.pause()
      process.stdin.setRawMode(false)
      try {
        if (error) reject(error)
        else resolve(JSON.parse(text.split(/[\r\n]/, 1)[0]))
      } catch {
        reject(Error('INPUT_INVALID'))
      } finally {
        text = ''
      }
    }
    const read = (chunk) => {
      text += chunk
      if (text.length > 32768) finish(Error('INPUT_LIMIT'))
      else if (/[\r\n]/.test(text)) finish()
    }
    process.stdin.on('data', read)
    process.stdin.resume()
  })
}
