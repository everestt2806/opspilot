/* eslint-disable @typescript-eslint/explicit-function-return-type -- CLI native Docker/HTTP/browser cho template SPA. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
if (
  process.platform !== 'win32' ||
  !process.version.startsWith('v22.') ||
  process.argv.length !== 3 ||
  !['--baseline', '--run'].includes(process.argv[2])
) {
  console.log('{"status":"REJECTED","error":"EXPLICIT_WINDOWS_NODE22_SPA_LAB_REQUIRED"}')
  process.exit(2)
}
const baseline = process.argv[2] === '--baseline',
  project = resolve(import.meta.dirname, '..'),
  root = dirname(project),
  require = createRequire(import.meta.url)
const nonce = randomBytes(6).toString('hex'),
  parent = join(project, '.out-scripts/spa-template-lab'),
  directory = join(parent, nonce)
mkdirSync(directory, { recursive: true })
writeFileSync(join(directory, '.owner'), nonce, { flag: 'wx' })
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const templates = baseline ? join(directory, 'baseline-templates') : join(root, 'templates'),
  source = join(directory, 'source'),
  labels = { 'opspilot.lab': nonce, 'opspilot.checkpoint': 'r7a' }
if (baseline) {
  mkdirSync(templates)
  const original = spawnSync(
    'git',
    ['show', 'b7163d92e4fc7580b8dca5f388f47b78c5bb072c:templates/static-spa.Dockerfile'],
    {
      cwd: root,
      windowsHide: true,
      timeout: 15000
    }
  )
  assert.equal(original.status, 0, 'BASELINE_TEMPLATE_UNAVAILABLE')
  writeFileSync(join(templates, 'static-spa.Dockerfile'), original.stdout)
}
const ownedContainers = [],
  ownedImages = []
let snapshot
const proof = {
  status: 'FAIL',
  mode: baseline ? 'baseline' : 'fixed',
  record: nonce,
  checks: [],
  baseline_template_sha256: sha(readFileSync(join(templates, 'static-spa.Dockerfile'))),
  production_database_used: false,
  vps_used: false
}
function command(exe, args, options = {}) {
  const result = spawnSync(exe, args, {
    cwd: directory,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 180000,
    ...options
  })
  return result
}
function docker(args, options = {}) {
  return command('docker.exe', args, options)
}
function checked(result, code = 'SPA_LAB_COMMAND_FAILED') {
  assert.equal(result.status, 0, code)
  return result.stdout.trim()
}
function cloneFiles(from, to) {
  assert(!lstatSync(from).isSymbolicLink())
  if (lstatSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const name of readdirSync(from))
      if (!['.git', 'node_modules', 'dist'].includes(name))
        cloneFiles(join(from, name), join(to, name))
  } else copyFileSync(from, to)
}
async function response(base, path, method = 'GET') {
  const result = await fetch(base + path, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(10000)
  })
  return {
    status: result.status,
    body: await result.text(),
    type: result.headers.get('content-type'),
    cache: result.headers.get('cache-control')
  }
}
async function imageCase(kind, sourceDirectory, subject) {
  const context = join(directory, 'context-' + kind)
  mkdirSync(context)
  cloneFiles(sourceDirectory, join(context, 'src'))
  const plan = subject.renderSpaSource(join(context, 'src'), templates)
  assert.equal(plan.container_port, 80)
  assert.equal(plan.healthcheck_path, '/')
  writeFileSync(join(context, 'Dockerfile'), plan.dockerfile)
  const image = 'opspilot-r7a:' + nonce + '-' + kind
  ownedImages.push(image)
  const build = docker(
    [
      'build',
      '--progress=plain',
      '--label',
      'opspilot.lab=' + nonce,
      '--label',
      'opspilot.checkpoint=r7a',
      '-t',
      image,
      context
    ],
    { timeout: 360000 }
  )
  writeFileSync(
    join(directory, kind + '-build.log'),
    (build.stdout ?? '') + '\n' + (build.stderr ?? '')
  )
  if (kind === 'missing-index' && !baseline) {
    assert(
      Number.isInteger(build.status) && build.status > 0,
      'MISSING_INDEX_BUILD_NOT_DEFINITELY_FAILED'
    )
    assert(
      /(?:^|\n)#\d+\s+\d+(?:\.\d+)?\s+SPA build output is missing dist\/index\.html(?:\r?\n|$)/.test(
        (build.stdout ?? '') + '\n' + (build.stderr ?? '')
      ),
      'MISSING_INDEX_FAILURE_REASON_NOT_PROVEN'
    )
    proof.missing_index_guard_observed = true
    proof.checks.push('build_refuses_artifact_without_index_html')
    return
  }
  checked(build, 'DOCKER_BUILD_FAILED')
  const name = 'opspilot-r7a-' + nonce + '-' + kind
  ownedContainers.push(name)
  checked(
    docker([
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'opspilot.lab=' + nonce,
      '--label',
      'opspilot.checkpoint=r7a',
      '-p',
      '127.0.0.1::80',
      image
    ]),
    'DOCKER_RUN_FAILED'
  )
  const inspect = JSON.parse(checked(docker(['inspect', name])))[0]
  assert.equal(inspect.Config.Labels['opspilot.lab'], nonce)
  const port = inspect.NetworkSettings.Ports['80/tcp'][0]
  assert.equal(port.HostIp, '127.0.0.1')
  const url = 'http://127.0.0.1:' + port.HostPort
  let home
  for (let i = 0; i < 50; i++) {
    try {
      home = await response(url, '/')
      if (home.status === 200) break
    } catch {
      // nginx có thể chưa mở listener ngay sau docker run.
    }
    await new Promise((done) => setTimeout(done, 200))
  }
  assert.equal(home?.status, 200, 'ROOT_NOT_HEALTHY')
  if (kind === 'missing-index') {
    assert(home.body.includes('Welcome to nginx!'))
    proof.checks.push('baseline_missing_index_builds_and_serves_stock_nginx_welcome')
    return
  }
  assert(home.body.includes('R7A_SPA_TEMPLATE'))
  const asset = home.body.match(/src="(\/assets\/[^" ]+\.js)"/)[1]
  const realAsset = await response(url, asset)
  assert.equal(realAsset.status, 200)
  assert(/javascript/.test(realAsset.type))
  const deep = await response(url, '/library/book/42?view=details')
  if (baseline) {
    assert.equal(deep.status, 404)
    proof.checks.push('baseline_root_and_real_asset_work_but_direct_client_route_is_404')
    return
  }
  assert.equal(deep.status, 200)
  assert.equal(deep.body, home.body)
  assert.equal(deep.cache, 'no-cache')
  const head = await response(url, '/library/book/42', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.body, '')
  for (const path of ['/assets/missing.js', '/missing.css', '/assets/missing-name'])
    assert.equal((await response(url, path)).status, 404)
  assert.equal((await response(url, '/index.html')).cache, 'no-cache')
  proof.checks.push(
    kind +
      '_production_detector_render_docker_root_deep_query_head_real_asset_mime_missing_assets404_and_index_no_cache'
  )
  proof[kind] = {
    image_id: inspect.Image,
    container_id: inspect.Id,
    source: 'actual ' + kind,
    asset_sha256: sha(realAsset.body),
    root_sha256: sha(home.body)
  }
  if (kind === 'git') {
    writeFileSync(
      join(directory, 'browser.json'),
      JSON.stringify({ nonce, url: url + '/library/book/42?view=details' })
    )
    const browser = command(
      require('electron'),
      [join(project, 'scripts/spa-template-lab/browser.mjs'), directory],
      {
        timeout: 60000,
        env: {
          SystemRoot: process.env.SystemRoot,
          PATH: join(process.env.SystemRoot, 'System32'),
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          USERPROFILE: join(directory, 'browser-home')
        }
      }
    )
    writeFileSync(
      join(directory, 'browser.log'),
      (browser.stdout ?? '') + '\n' + (browser.stderr ?? '')
    )
    checked(browser, 'ACTUAL_BROWSER_FAILED')
    const result = JSON.parse(readFileSync(join(directory, 'browser-result.json'), 'utf8'))
    assert.equal(result.status, 'PASS')
    assert.equal(result.checks.length, 2)
    proof.checks.push(...result.checks)
  }
}
try {
  assert.equal(checked(docker(['info', '--format', '{{.OSType}}'])), 'linux')
  const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
  await esbuild.build({
    entryPoints: [join(project, 'scripts/spa-template-lab/subject.ts')],
    outfile: join(directory, 'subject.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external'
  })
  const subject = require(join(directory, 'subject.cjs'))
  mkdirSync(join(source, 'src'), { recursive: true })
  for (const file of ['package.json', 'package-lock.json'])
    copyFileSync(join(root, 'demo-apps/tiem-doc-spa', file), join(source, file))
  writeFileSync(
    join(source, 'index.html'),
    '<!doctype html><html lang="vi"><meta charset="UTF-8"><meta name="lab" content="R7A_SPA_TEMPLATE"><title>SPA routing lab</title><div id="app"></div><script type="module" src="/src/main.js"></script></html>\n'
  )
  writeFileSync(
    join(source, 'src/main.js'),
    'document.querySelector("#app").innerHTML = "<h1>Tiệm sách thử nghiệm</h1><p id=route></p>"; document.querySelector("#route").textContent = location.pathname + location.search;\n'
  )
  checked(command('git', ['init', '--initial-branch=main', source]))
  checked(
    command('git', [
      '-C',
      source,
      'add',
      '--',
      'package.json',
      'package-lock.json',
      'index.html',
      'src/main.js'
    ])
  )
  checked(
    command('git', [
      '-C',
      source,
      '-c',
      'user.name=OpsPilot Lab',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'source fixture'
    ])
  )
  const commit = checked(command('git', ['-C', source, 'rev-parse', 'HEAD']))
  assert(/^[a-f0-9]{40}$/.test(commit))
  await imageCase('local', source, subject)
  if (!baseline) {
    const temp = join(directory, 'snapshots')
    mkdirSync(temp)
    snapshot = await subject.createGitSnapshotFromLocalFixture({
      repositoryUrl: source,
      ref: 'main',
      targetSha: commit,
      tempDirectory: temp
    })
    assert.equal(snapshot.commitSha, commit)
    proof.git_commit_sha = commit
    await imageCase('git', snapshot.rootDirectory, subject)
    assert.equal(proof.local.root_sha256, proof.git.root_sha256)
    assert.equal(proof.local.asset_sha256, proof.git.asset_sha256)
  }
  const broken = join(directory, 'broken')
  cloneFiles(source, broken)
  const pkg = JSON.parse(readFileSync(join(broken, 'package.json'), 'utf8'))
  pkg.scripts.build = 'vite build && rm -f dist/index.html'
  writeFileSync(join(broken, 'package.json'), JSON.stringify(pkg))
  await imageCase('missing-index', broken, subject)
  proof.status = 'PASS'
} catch (error) {
  proof.error = String(error.message).slice(0, 200)
}
try {
  if (snapshot) snapshot.cleanup()
  for (const name of ownedContainers) {
    const result = docker(['inspect', name])
    if (result.status !== 0) continue
    const info = JSON.parse(result.stdout)[0]
    for (const [key, value] of Object.entries(labels)) assert.equal(info.Config.Labels[key], value)
    checked(docker(['rm', '-f', name]), 'OWNED_CONTAINER_CLEANUP_FAILED')
  }
  for (const name of ownedImages) {
    const result = docker(['image', 'inspect', name])
    if (result.status !== 0) continue
    const info = JSON.parse(result.stdout)[0]
    for (const [key, value] of Object.entries(labels)) assert.equal(info.Config.Labels[key], value)
    checked(docker(['image', 'rm', name]), 'OWNED_IMAGE_CLEANUP_FAILED')
  }
  assert.equal(realpathSync(directory), resolve(directory))
  assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), nonce)
  for (const name of [
    'source',
    'broken',
    'context-local',
    'context-git',
    'context-missing-index',
    'snapshots',
    'browser-profile',
    'browser-home',
    'baseline-templates'
  ]) {
    const target = join(directory, name)
    if (existsSync(target)) {
      assert.equal(dirname(realpathSync(target)), directory)
      assert(!lstatSync(target).isSymbolicLink())
      rmSync(target, { recursive: true, maxRetries: 10, retryDelay: 100 })
    }
  }
  proof.owned_resources_removed = true
} catch {
  proof.status = 'FAIL'
  proof.cleanup_error = 'OWNED_CLEANUP_FAILED'
}
writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
console.log(
  JSON.stringify({
    status: proof.status,
    record: nonce,
    checks: proof.checks.length,
    error: proof.error,
    cleanup_error: proof.cleanup_error
  })
)
process.exitCode = proof.status === 'PASS' ? 0 : 1
