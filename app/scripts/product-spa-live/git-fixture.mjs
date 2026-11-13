/* eslint-disable @typescript-eslint/explicit-function-return-type -- Source Git công khai riêng cho gate SPA. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const [mode, nonce] = process.argv.slice(2)
assert(['initial', 'update', 'fault', 'final'].includes(mode) && /^[a-f0-9]{12}$/.test(nonce))
const root = resolve(import.meta.dirname, '../../..'),
  directory = join(root, 'app/.out-scripts/product-spa-git', nonce),
  source = join(directory, 'source'),
  branch = 'demo/spa-r7c-' + nonce,
  origin = 'https://github.com/everestt2806/opspilot.git'
mkdirSync(directory, { recursive: true })
const git = (...args) =>
  execFileSync('git', ['-C', source, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 90000,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
const record = join(directory, mode + '.json')
if (existsSync(record)) {
  const previous = JSON.parse(readFileSync(record, 'utf8'))
  assert.equal(git('rev-parse', 'HEAD'), previous.sha)
  console.log(JSON.stringify(previous))
  process.exit(0)
}
if (mode === 'initial') {
  assert(!existsSync(source))
  mkdirSync(source)
  for (const name of [
    'package.json',
    'package-lock.json',
    'index.html',
    'vite.config.js',
    'src',
    'README.md'
  ])
    cpSync(join(root, 'demo-apps/tiem-doc-spa', name), join(source, name), {
      recursive: true,
      force: false
    })
  git('init', '-q', '-b', branch)
  git('remote', 'add', 'origin', origin)
  assert.equal(git('ls-remote', '--heads', 'origin', branch), '', 'REMOTE_BRANCH_EXISTS')
} else {
  const parent = mode === 'update' ? 'initial' : mode === 'fault' ? 'update' : 'fault'
  assert.equal(
    git('rev-parse', 'HEAD'),
    JSON.parse(readFileSync(join(directory, parent + '.json'), 'utf8')).sha
  )
}
assert.equal(git('branch', '--show-current'), branch)
assert.equal(git('remote', 'get-url', 'origin'), origin)
git('config', 'user.name', 'everestt2806')
git('config', 'user.email', '128307265+everestt2806@users.noreply.github.com')
const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
pkg.scripts.build = mode === 'fault' ? 'vite build && chmod 000 dist/index.html' : 'vite build'
writeFileSync(join(source, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
mkdirSync(join(source, 'public'), { recursive: true })
writeFileSync(join(source, 'public/release.txt'), `r7c-${nonce}-${mode}\n`)
const files = []
const scan = (path = '') => {
  for (const item of readdirSync(join(source, path), { withFileTypes: true })) {
    if (item.name === '.git') continue
    assert(!item.isSymbolicLink())
    const name = path ? path + '/' + item.name : item.name
    assert(!/(^|\/)(?:\.env|node_modules|\.owner)(?:$|\/)/.test(name))
    if (item.isDirectory()) scan(name)
    else files.push(name)
  }
}
scan()
git('add', '--', ...files)
git('diff', '--cached', '--check')
const message = join(directory, mode + '-commit.txt')
writeFileSync(
  message,
  `test(demo): nguồn SPA ${mode} cho nghiệm thu R7c\n\nFixture Tiệm Đọc trên nhánh demo riêng; không merge vào sản phẩm.\n\nCo-authored-by: Võ Thị Thiên Kim <Thienkim.dev@gmail.com>\n`
)
git('commit', '-q', '--file', message)
const sha = git('rev-parse', 'HEAD')
git('push', 'origin', `HEAD:refs/heads/${branch}`)
assert.equal(git('ls-remote', '--heads', 'origin', branch).split(/\s/)[0], sha)
const result = {
  mode,
  nonce,
  branch,
  sha,
  repository_url: origin,
  repository_root: '.',
  public_marker: `r7c-${nonce}-${mode}`,
  files: files.length
}
writeFileSync(record, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
