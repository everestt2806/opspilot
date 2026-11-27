/* eslint-disable @typescript-eslint/explicit-function-return-type -- Source Git công khai riêng cho gate SPA. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const [mode, nonce, variant] = process.argv.slice(2)
assert(variant === undefined || variant === '--nextjs')
const next = variant === '--nextjs'
assert(['initial', 'update', 'fault', 'final'].includes(mode) && /^[a-f0-9]{12}$/.test(nonce))
const root = resolve(import.meta.dirname, '../../..'),
  directory = join(
    root,
    next ? 'app/.out-scripts/product-next-git' : 'app/.out-scripts/product-spa-git',
    nonce
  ),
  source = join(directory, 'source'),
  branch = (next ? 'demo/next-r7f-' : 'demo/spa-r7c-') + nonce,
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
  for (const name of next
    ? ['package.json', 'package-lock.json']
    : ['package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'src', 'README.md'])
    cpSync(
      join(root, next ? 'demo-apps/next-blog' : 'demo-apps/tiem-doc-spa', name),
      join(source, name),
      {
        recursive: true,
        force: false
      }
    )
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
pkg.scripts.build = next
  ? 'next build'
  : mode === 'fault'
    ? 'vite build && chmod 000 dist/index.html'
    : 'vite build'
if (next) {
  pkg.scripts = { build: 'next build', start: 'next start' }
  mkdirSync(join(source, 'pages/books'), { recursive: true })
  writeFileSync(join(source, 'next.config.js'), 'module.exports={experimental:{cpus:1}};\n')
  const marker = `r7f-${nonce}-${mode}`
  writeFileSync(
    join(source, 'pages/index.jsx'),
    `export function getServerSideProps({res}){res.statusCode=${mode === 'fault' ? 503 : 200};return {props:{}}}
export default function Home(){return <main style={{maxWidth:760,margin:'64px auto',padding:'0 24px',fontFamily:'Georgia,serif',color:'#23342c'}}><p style={{letterSpacing:3,fontSize:13}}>SỔ ĐỌC · NHẬT KÝ SÁCH</p><h1 style={{fontSize:52,fontWeight:400,lineHeight:1.15}}>Một góc nhỏ cho những trang sách.</h1><p style={{fontSize:20,lineHeight:1.7}}>Ghi lại một ý hay, một đoạn muốn đọc lại, hay cuốn sách dành cho cuối tuần.</p><hr/><section style={{display:'grid',gap:24,margin:'32px 0'}}><article><small>ĐANG ĐỌC</small><h2>Đi tìm lẽ sống</h2><p>Viktor E. Frankl · Trang 86 / 224</p></article><article><small>GHI CHÚ GẦN ĐÂY</small><h2>Chậm một nhịp, đọc thêm một trang</h2><p>Mười lăm phút trước giờ ngủ, giữ lại điều đáng nhớ trong ngày.</p></article></section><footer style={{borderTop:'1px solid #ddd',paddingTop:16,fontSize:12}}>Sổ Đọc · Bản triển khai: ${marker}</footer></main>}\n`
  )
  writeFileSync(
    join(source, 'pages/books/[...slug].jsx'),
    "export {default,getServerSideProps} from '../index';\n"
  )
  writeFileSync(
    join(source, 'README.md'),
    '# Sổ Đọc\n\nDemo Next.js Pages Router SSR cho OpsPilot R7f. Không DB hoặc biến môi trường. npm ci, npm run build, npm start. Nhánh demo riêng; fault503 có chủ đích để nghiệm thu health rollback.\n'
  )
}
writeFileSync(join(source, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
mkdirSync(join(source, 'public'), { recursive: true })
writeFileSync(join(source, 'public/release.txt'), `${next ? 'r7f' : 'r7c'}-${nonce}-${mode}\n`)
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
  `test(demo): nguồn ${next ? 'Next.js' : 'SPA'} ${mode} cho nghiệm thu ${next ? 'R7f' : 'R7c'}\n\nFixture trên nhánh demo riêng; không merge vào sản phẩm.\n\nCo-authored-by: Võ Thị Thiên Kim <Thienkim.dev@gmail.com>\n`
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
  public_marker: `${next ? 'r7f' : 'r7c'}-${nonce}-${mode}`,
  files: files.length
}
writeFileSync(record, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
