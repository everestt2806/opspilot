// eslint-disable-next-line @typescript-eslint/no-require-imports -- Fixture CommonJS chạy trực tiếp bằng Node.
const express = require('express')

const app = express()
const port = parseInt(process.env.PORT || '3000', 10)
const runId = process.env.LAB_RUN_ID || 'unknown_run'
const simulateFailHealth = process.env.SIMULATE_FAIL_HEALTH === '1'

app.get('/health', async (req, res) => {
  const delayMs = Number(process.env.HEALTH_DELAY_MS || 0)
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 30000)))
  if (simulateFailHealth) {
    return res.status(500).json({
      status: 'error',
      reason: 'simulated_health_failure',
      run_id: runId,
      timestamp: new Date().toISOString()
    })
  }

  return res.status(200).json({
    status: 'ok',
    app: 'product-docker-lab-fixture',
    run_id: runId,
    timestamp: new Date().toISOString(),
    uptime_seconds: process.uptime()
  })
})

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[lab-fixture] Server listening on 0.0.0.0:${port}, run_id=${runId}`)
})

process.on('SIGTERM', () => {
  console.log('[lab-fixture] SIGTERM received, exiting gracefully...')
  server.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  console.log('[lab-fixture] SIGINT received, exiting gracefully...')
  server.close(() => process.exit(0))
})
