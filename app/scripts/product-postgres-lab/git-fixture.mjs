/* eslint-disable @typescript-eslint/explicit-function-return-type -- Explicit isolated public Git acceptance source. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [nonce, mode = 'initial'] = process.argv.slice(2),
  modes = ['initial', 'update', 'health-fault', 'final']
assert([3, 4].includes(process.argv.length) && /^[a-f0-9]{12}$/.test(nonce) && modes.includes(mode))
const root = resolve(import.meta.dirname, '../../..'),
  directory = join(root, 'app/.out-scripts/product-postgres-git', nonce),
  source = join(directory, 'source'),
  record = join(directory, mode + '.json'),
  branch = 'demo/postgres-r7h-' + nonce,
  origin = 'https://github.com/everestt2806/opspilot.git',
  git = (...args) =>
    execFileSync('git', ['-C', source, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
if (existsSync(record)) {
  const previous = JSON.parse(readFileSync(record, 'utf8'))
  assert.equal(git('rev-parse', 'HEAD'), previous.sha)
  console.log(JSON.stringify(previous))
  process.exit(0)
}
if (mode === 'initial') {
  assert(!existsSync(source))
  mkdirSync(source, { recursive: true })
  git('init', '-q', '-b', branch)
  git('remote', 'add', 'origin', origin)
  assert.equal(git('ls-remote', '--heads', 'origin', branch), '')
} else {
  const previous = JSON.parse(
    readFileSync(join(directory, modes[modes.indexOf(mode) - 1] + '.json'), 'utf8')
  )
  assert.equal(git('rev-parse', 'HEAD'), previous.sha)
}
assert.equal(git('remote', 'get-url', 'origin'), origin)
assert.equal(git('branch', '--show-current'), branch)
writeFileSync(
  join(source, 'package.json'),
  JSON.stringify(
    {
      name: 'postgres-acceptance',
      private: true,
      version: '1.0.0',
      scripts: { start: 'node server.js' },
      dependencies: { express: '4.21.2', pg: '8.13.0' }
    },
    null,
    2
  ) + '\n'
)
writeFileSync(
  join(source, 'server.js'),
  `const express = require('express');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 3000 });
const app = express();
app.disable('x-powered-by');
app.get('/', async (_request, response) => {
  try {
    const result = await pool.query('SELECT count(*)::integer AS rows FROM acceptance_sample');
    response.json({ service: 'postgres-acceptance', rows: result.rows[0].rows, release: ${JSON.stringify(nonce + '-' + mode)} });
  } catch { response.status(503).json({ status: 'unavailable' }); }
});
app.get('/health', async (_request, response) => {
  try {
    const result = await pool.query('SELECT count(*)::integer AS rows FROM acceptance_sample');
    response.status(${mode === 'health-fault' ? 503 : 200}).json({ status: 'ok', service: 'postgres-acceptance', rows: result.rows[0].rows, release: ${JSON.stringify(nonce + '-' + mode)} });
  } catch { response.status(503).json({ status: 'unavailable' }); }
});
(async () => {
  await pool.query('CREATE TABLE IF NOT EXISTS acceptance_sample (id integer PRIMARY KEY, label text NOT NULL)');
  await pool.query("INSERT INTO acceptance_sample SELECT n, 'sample-' || n FROM generate_series(1,1000) n ON CONFLICT (id) DO NOTHING");
  app.listen(3000, '0.0.0.0');
})().catch(() => { console.error('Application database initialization failed'); process.exitCode = 1; });
`
)
writeFileSync(
  join(source, 'README.md'),
  '# Managed PostgreSQL acceptance\n\nPrivate-purpose demo branch for OpsPilot integration tests. Requires runtime DATABASE_URL; no credentials in this repository. Creates 1,000 deterministic sample rows without overwriting existing data.\n'
)
if (mode === 'initial')
  execFileSync(
    process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32'
      ? [
          '/d',
          '/c',
          'npm.cmd',
          'install',
          '--package-lock-only',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund'
        ]
      : ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: source,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
git('config', 'user.name', 'everestt2806')
git('config', 'user.email', '128307265+everestt2806@users.noreply.github.com')
git('add', '--', 'package.json', 'package-lock.json', 'server.js', 'README.md')
git('diff', '--cached', '--check')
const message = join(directory, 'commit.txt')
writeFileSync(
  message,
  'test(demo): PostgreSQL ' +
    mode +
    ' source for public Git acceptance\n\nCo-authored-by: Võ Thị Thiên Kim <Thienkim.dev@gmail.com>\n'
)
git('commit', '-q', '--file', message)
const sha = git('rev-parse', 'HEAD')
git('push', 'origin', 'HEAD:refs/heads/' + branch)
assert.equal(git('ls-remote', '--heads', 'origin', branch).split(/\s/)[0], sha)
const value = { nonce, mode, branch, sha, repository_url: origin, repository_root: '.' }
writeFileSync(record, JSON.stringify(value, null, 2) + '\n')
console.log(JSON.stringify(value))
