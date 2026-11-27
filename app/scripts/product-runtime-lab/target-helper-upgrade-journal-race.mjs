import { spawn } from 'node:child_process'
const chunks = []
for await (const chunk of process.stdin) {
  chunks.push(chunk)
  if (chunks.reduce((size, bytes) => size + bytes.length, 0) > 128 * 1024)
    throw Error('RACE_INPUT_TOO_LARGE')
}
const { artifact, directory, requests } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
if (!Array.isArray(requests) || requests.length !== 2) throw Error('RACE_INPUT_INVALID')
const results = await Promise.all(
  requests.map(
    (input) =>
      new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          [artifact, 'prepare-target-helper-upgrade', '--data-dir', directory],
          { stdio: ['pipe', 'pipe', 'pipe'] }
        )
        let output = '',
          error = ''
        const timeout = setTimeout(() => child.kill('SIGKILL'), 45000)
        child.stdout.on('data', (bytes) => {
          if (output.length + bytes.length > 32768) child.kill('SIGKILL')
          else output += bytes
        })
        child.stderr.on('data', (bytes) => {
          if (error.length + bytes.length > 32768) child.kill('SIGKILL')
          else error += bytes
        })
        child.on('close', (code) => {
          clearTimeout(timeout)
          resolve({
            code,
            result: code === 0 ? JSON.parse(output) : null,
            error_code: /CONTROL_PLANE_ERROR ([A-Z0-9_]+)/.exec(error)?.[1] ?? null
          })
        })
        child.stdin.end(JSON.stringify(input))
      })
  )
)
console.log(JSON.stringify(results))
