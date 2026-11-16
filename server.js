const express = require('express');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 3000 });
const app = express();
app.disable('x-powered-by');
app.get('/', async (_request, response) => {
  try {
    const result = await pool.query('SELECT count(*)::integer AS rows FROM acceptance_sample');
    response.json({ service: 'postgres-acceptance', rows: result.rows[0].rows, release: "2a6785f2e51e-health-fault" });
  } catch { response.status(503).json({ status: 'unavailable' }); }
});
app.get('/health', async (_request, response) => {
  try {
    const result = await pool.query('SELECT count(*)::integer AS rows FROM acceptance_sample');
    response.status(503).json({ status: 'ok', service: 'postgres-acceptance', rows: result.rows[0].rows, release: "2a6785f2e51e-health-fault" });
  } catch { response.status(503).json({ status: 'unavailable' }); }
});
(async () => {
  await pool.query('CREATE TABLE IF NOT EXISTS acceptance_sample (id integer PRIMARY KEY, label text NOT NULL)');
  await pool.query("INSERT INTO acceptance_sample SELECT n, 'sample-' || n FROM generate_series(1,1000) n ON CONFLICT (id) DO NOTHING");
  app.listen(3000, '0.0.0.0');
})().catch(() => { console.error('Application database initialization failed'); process.exitCode = 1; });
