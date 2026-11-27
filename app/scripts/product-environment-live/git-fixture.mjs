/* eslint-disable @typescript-eslint/explicit-function-return-type -- Nhánh demo riêng, không chứa credential. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const [mode, nonce] = process.argv.slice(2),
  modes = ['initial', 'update', 'build-fault', 'health-fault', 'final']
assert(modes.includes(mode) && /^[a-f0-9]{12}$/.test(nonce))
const root = resolve(import.meta.dirname, '../../..'),
  directory = join(root, 'app/.out-scripts/product-environment-git', nonce),
  source = join(directory, 'source'),
  branch = 'demo/environment-r7h-' + nonce,
  origin = 'https://github.com/everestt2806/opspilot.git',
  record = join(directory, mode + '.json')
mkdirSync(directory, { recursive: true })
const git = (...args) =>
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
  mkdirSync(source)
  for (const name of ['package.json', 'package-lock.json', 'server.js', 'public', 'README.md'])
    cpSync(join(root, 'demo-apps/san-nha-booking', name), join(source, name), {
      recursive: true,
      force: false
    })
  git('init', '-q', '-b', branch)
  git('remote', 'add', 'origin', origin)
  assert.equal(git('ls-remote', '--heads', 'origin', branch), '')
} else
  assert.equal(
    git('rev-parse', 'HEAD'),
    JSON.parse(readFileSync(join(directory, modes[modes.indexOf(mode) - 1] + '.json'), 'utf8')).sha
  )
assert.equal(git('branch', '--show-current'), branch)
assert.equal(git('remote', 'get-url', 'origin'), origin)
const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
pkg.scripts.postinstall = 'node -e "process.exit(' + (mode === 'build-fault' ? '42' : '0') + ')"'
writeFileSync(join(source, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
let server = readFileSync(join(root, 'demo-apps/san-nha-booking/server.js'), 'utf8')
const old = '.json({ status: "ok", service: "san-nha-booking" });'
assert(server.includes(old))
server = server.replace(
  old,
  `.status(${mode === 'health-fault' ? 503 : 200}).json({status:"ok",service:"environment-acceptance",marker:${JSON.stringify(nonce + '-' + mode)},title_configured:Boolean(process.env.APP_TITLE),configured:Boolean(process.env.APP_TOKEN)});`
)
writeFileSync(join(source, 'server.js'), server)
writeFileSync(join(source, 'public/release.txt'), nonce + '-' + mode + '\n')
const files = []
const scan = (relative = '') => {
  for (const item of readdirSync(join(source, relative), { withFileTypes: true })) {
    if (item.name === '.git') continue
    assert(!item.isSymbolicLink())
    const path = relative ? relative + '/' + item.name : item.name
    assert(!/(^|\/)(?:\.env|node_modules|\.owner)(?:$|\/)/.test(path))
    if (item.isDirectory()) scan(path)
    else files.push(path)
  }
}
scan()
git('config', 'user.name', 'everestt2806')
git('config', 'user.email', '128307265+everestt2806@users.noreply.github.com')
git('add', '--', ...files)
git('diff', '--cached', '--check')
const message = join(directory, mode + '-commit.txt')
writeFileSync(
  message,
  `test(demo): nguồn Express ${mode} cho nghiệm thu env R7h\n\nChỉ nhánh demo riêng; fault có chủ đích để kiểm build/health rollback. Không chứa giá trị env.\n\nCo-authored-by: Võ Thị Thiên Kim <Thienkim.dev@gmail.com>\n`
)
git('commit', '-q', '--file', message)
const sha = git('rev-parse', 'HEAD')
git('push', 'origin', 'HEAD:refs/heads/' + branch)
assert.equal(git('ls-remote', '--heads', 'origin', branch).split(/\s/)[0], sha)
const value = {
  mode,
  nonce,
  branch,
  sha,
  repository_url: origin,
  repository_root: '.',
  files: files.length
}
writeFileSync(record, JSON.stringify(value, null, 2) + '\n')
console.log(JSON.stringify(value))
