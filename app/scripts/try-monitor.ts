import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { LocalMetricSource } from '../src/main/monitor/metricSource'
import { MonitorPoller } from '../src/main/monitor/poller'

const dir = mkdtempSync(join(tmpdir(), 'opspilot-monitor-cli-'))
async function main(): Promise<void> {
  const fixture = join(dir, 'metrics.jsonl')
  const generator = resolve(process.cwd(), '..', 'ml-service', 'scripts', 'gen_fake_series.py')
  const python = resolve(process.cwd(), '..', 'ml-service', '.venv', 'Scripts', 'python.exe')
  execFileSync(
    python,
    [
      generator,
      '--scenario',
      'normal',
      '--n',
      '150',
      '--start',
      '2026-08-30T00:00:00Z',
      '--out',
      fixture
    ],
    { stdio: 'pipe' }
  )
  const content = readFileSync(fixture, 'utf8')
  const db = new Database(join(dir, 'opspilot.db'))
  db.exec(readFileSync(join(process.cwd(), 'src/main/db/migrations/001_init.sql'), 'utf8'))
  db.exec(
    "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('cli','127.0.0.1','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'cli','express',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'cli:v1','running'); UPDATE app SET current_deployment_id=1 WHERE id=1;"
  )
  const poller = new MonitorPoller(db)
  const source = new LocalMetricSource(fixture)
  const first = await poller.poll(1, 1, source)
  const second = await poller.poll(1, 1, source)
  const metrics = (db.prepare('SELECT COUNT(*) n FROM metric_sample').get() as { n: number }).n
  const scoreRows = (db.prepare('SELECT COUNT(*) n FROM score_sample').get() as { n: number }).n
  const alerts = (db.prepare('SELECT COUNT(*) n FROM alert').get() as { n: number }).n
  const offset = (
    db.prepare('SELECT metrics_offset FROM app WHERE id=1').get() as { metrics_offset: number }
  ).metrics_offset
  db.close()
  if (
    metrics !== 150 ||
    scoreRows !== 750 ||
    alerts !== 0 ||
    first.inserted !== 150 ||
    second.inserted !== 0 ||
    offset !== Buffer.byteLength(content) + 1
  )
    throw new Error('Monitor CLI invariant failed')
  console.log(
    JSON.stringify({
      metrics,
      score_rows: scoreRows,
      alerts,
      offset,
      first_inserted: first.inserted,
      retry_inserted: second.inserted
    })
  )
}
main().finally(() => {
  rmSync(dir, { recursive: true, force: true })
})
