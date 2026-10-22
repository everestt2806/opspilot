import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [nodeBinary, modulesDirectoryArg] = process.argv.slice(2)
if (!nodeBinary || !modulesDirectoryArg || process.platform !== 'linux') {
  throw new Error('USAGE_LINUX_NODE_AND_MODULES_REQUIRED')
}

const appRoot = resolve(import.meta.dirname, '..')
const modulesDirectory = resolve(modulesDirectoryArg)
const runtimeRoot = resolve(modulesDirectory, '..')
const requireRuntime = createRequire(join(runtimeRoot, 'package.json'))
const esbuild = requireRuntime('esbuild')
const scratch = mkdtempSync(join(tmpdir(), 'opspilot-p3d-worker-lab-'))
const entry = join(scratch, 'worker-entry.ts')
const artifact = join(runtimeRoot, 'dist', `queue-worker-lab-${process.pid}.cjs`)
const dbDirectory = join(scratch, 'data')
const entrySource = `
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { initializeDatabase } from ${JSON.stringify(join(appRoot, 'src/main/db/index.ts'))};
import { ProductDeployRepository } from ${JSON.stringify(join(appRoot, 'src/main/db/productDeployRepository.ts'))};
import { ControlPlaneJobWorker } from ${JSON.stringify(join(appRoot, 'src/main/controlPlane/queueWorker.ts'))};
import { initializeController } from ${JSON.stringify(join(appRoot, 'src/main/controlPlane/controllerDatabase.ts'))};
import { ControllerService } from ${JSON.stringify(join(appRoot, 'src/main/controlPlane/controllerService.ts'))};
import type { ControlPlaneGitPoller } from ${JSON.stringify(join(appRoot, 'src/main/controlPlane/gitPoller.ts'))};
import type { ProductClaimToken } from ${JSON.stringify(join(appRoot, '../docs/contracts/product-auto-deploy.ts'))};

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('WORKER_LAB_WAIT_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function main(): Promise<void> {
  const directory = process.argv[2];
  const controllerId = 'p3d-linux-lab-controller';
  const configHash = '${'c'.repeat(64)}';
  const targetSha = '${'d'.repeat(40)}';
  const now = new Date().toISOString();
  const primary = initializeDatabase(directory);
  let secondary: Database.Database | null = null;
  const firstStop = new AbortController();
  const secondStop = new AbortController();
  let firstRun: Promise<void> | null = null;
  let secondRun: Promise<void> | null = null;
  let executorCalls = 0;
  let secondExecutorCalls = 0;
  let resolveEntered: (() => void) | undefined;
  const entered = new Promise<void>(resolve => { resolveEntered = resolve; });
  let initialExpiry = '';
  try {
    primary.exec(\`\
      INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret)
        VALUES(1,'lab-vps','fixture.invalid','lab','key',X'00');
      INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
        VALUES(1,1,'lab-app','express',30111,3000,'git','https://example.test/repo.git','main','.');
      INSERT INTO product_controller(controller_id,created_at,status)
        VALUES('\${controllerId}','\${now}','active');
      INSERT INTO product_source_config
        (app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at)
        VALUES(1,1,'https://example.test/repo.git','main','.','{}','\${configHash}','\${now}');
      INSERT INTO product_app_control
        (app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,
         auto_deploy_paused,pause_policy_provenance)
        VALUES(1,'product','\${controllerId}',1,1,'\${configHash}','\${now}',0,'legacy_clean');
      INSERT INTO product_deploy_job
        (job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
         trigger,idempotency_key,ref,target_sha,state,attempt_count,max_attempts,available_at,created_at,updated_at)
        VALUES('lab-job','\${controllerId}',1,1,1,'\${configHash}','manual_redeploy','manual:lab-job','main',
          '\${targetSha}','queued',0,3,'\${now}','\${now}','\${now}');
    \`);
    secondary = new Database(join(directory, 'opspilot.db'));
    secondary.pragma('foreign_keys = ON');
    const repoOne = new ProductDeployRepository(primary);
    const repoTwo = new ProductDeployRepository(secondary);
    const admission = { check: () => ({ state: 'ready' as const }) };
    const executor = {
      async execute(claim: { expires_at: string }, signal: AbortSignal) {
        executorCalls += 1;
        initialExpiry = claim.expires_at;
        resolveEntered?.();
        if (signal.aborted) return { state: 'stopped_before_write' as const };
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
        return { state: 'stopped_before_write' as const };
      }
    };
    const secondExecutor = {
      async execute() {
        secondExecutorCalls += 1;
        return { state: 'stopped_before_write' as const };
      }
    };
    const one = new ControlPlaneJobWorker({ repository: repoOne, controllerId, executor, admission,
      pollIntervalMs: 10, heartbeatIntervalMs: 25, stopGraceMs: 500 });
    const two = new ControlPlaneJobWorker({ repository: repoTwo, controllerId, executor: secondExecutor, admission,
      pollIntervalMs: 10, heartbeatIntervalMs: 25, stopGraceMs: 500 });
    firstRun = one.run(firstStop.signal);
    secondRun = two.run(secondStop.signal);
    await entered;
    await waitFor(() => two.getStatus().state === 'claim_blocked');
    await waitFor(() => {
      const row = primary.prepare('SELECT expires_at FROM product_app_lease WHERE released_at IS NULL').get() as { expires_at?: string } | undefined;
      return Boolean(row?.expires_at && Date.parse(row.expires_at) > Date.parse(initialExpiry));
    });
    firstStop.abort();
    secondStop.abort();
    await Promise.all([firstRun, secondRun]);
    assert.equal(executorCalls, 1);
    assert.equal(secondExecutorCalls, 0);
    assert.equal(one.getStatus().state, 'reconciliation_required');
    assert.equal(primary.prepare("SELECT state FROM product_deploy_job WHERE job_id='lab-job'").get()?.state, 'claimed');
    assert.equal(primary.prepare('SELECT COUNT(*) AS count FROM product_app_lease WHERE released_at IS NULL').get()?.count, 1);
    assert.equal(primary.prepare("SELECT COUNT(*) AS count FROM product_worker_lease WHERE released_at IS NULL").get()?.count, 1);
    const lifecycle = await runCompositionFailureScenario(directory);
    console.log(JSON.stringify({
      sqlite: 'isolated-file-backed',
      workers: 2,
      executors_called: executorCalls + secondExecutorCalls,
      heartbeat_renewed: true,
      shutdown_outcome: one.getStatus().state,
      claim_and_leases_preserved_for_reconciliation: true,
      controller_composition_waited_for_sibling: lifecycle.waited_for_executor,
      controller_close_idempotent: lifecycle.close_idempotent,
      controller_close_error: lifecycle.close_error,
      controller_claim_preserved: lifecycle.claim_preserved,
      remote_deploy: false
    }));
  } finally {
    firstStop.abort();
    secondStop.abort();
    const runs = [firstRun, secondRun].filter((run): run is Promise<void> => run !== null);
    if (runs.length) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all(runs),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 1500); })
      ]);
      if (timer) clearTimeout(timer);
    }
    if (secondary?.open) secondary.close();
    if (primary.open) primary.close();
  }
}

async function runCompositionFailureScenario(parentDirectory: string): Promise<{
  waited_for_executor: boolean;
  close_idempotent: boolean;
  close_error: string;
  claim_preserved: boolean;
}> {
  const directory = join(parentDirectory, 'controller-service');
  const initialized = initializeController(directory);
  const seed = initializeDatabase(directory);
  const now = new Date().toISOString();
  const configHash = '${'e'.repeat(64)}';
  const targetSha = '${'f'.repeat(40)}';
  seed.exec(\`\
    INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret)
      VALUES(1,'service-vps','fixture.invalid','lab','key',X'00');
    INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
      VALUES(1,1,'service-app','express',30112,3000,'git','https://example.test/service.git','main','.');
    INSERT INTO product_source_config
      (app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at)
      VALUES(1,1,'https://example.test/service.git','main','.','{}','\${configHash}','\${now}');
    INSERT INTO product_app_control
      (app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,
       auto_deploy_paused,pause_policy_provenance)
      VALUES(1,'product','\${initialized.controllerId}',1,1,'\${configHash}','\${now}',0,'legacy_clean');
    INSERT INTO product_deploy_job
      (job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
       trigger,idempotency_key,ref,target_sha,state,attempt_count,max_attempts,available_at,created_at,updated_at)
      VALUES('service-lab-job','\${initialized.controllerId}',1,1,1,'\${configHash}',
       'manual_redeploy','manual:service-lab-job','main','\${targetSha}','queued',0,3,
       '\${now}','\${now}','\${now}');
  \`);
  seed.close();

  let repository: ProductDeployRepository | null = null;
  let claim: ProductClaimToken | null = null;
  let databaseReadableAfterAbort = false;
  let resolveEntered: (() => void) | undefined;
  let resolvePollerFailure: (() => void) | undefined;
  const entered = new Promise<void>(resolve => { resolveEntered = resolve; });
  const pollerFailure = new Promise<void>(resolve => { resolvePollerFailure = resolve; });
  const poller = {
    getLastSummary: () => null,
    async run() {
      await entered;
      resolvePollerFailure?.();
      throw new Error('LAB_POLL_FAILURE');
    }
  } as unknown as ControlPlaneGitPoller;
  const service = new ControllerService({
    dataDirectory: directory,
    poller,
    workerFactory: (serviceRepository, controllerId) => {
      repository = serviceRepository;
      return new ControlPlaneJobWorker({
        repository: serviceRepository,
        controllerId,
        pollIntervalMs: 10,
        heartbeatIntervalMs: 10_000,
        stopGraceMs: 1000,
        admission: { check: () => ({ state: 'ready' }) },
        executor: {
          async execute(activeClaim, signal) {
            claim = activeClaim;
            resolveEntered?.();
            await new Promise<void>(resolve => {
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', () => resolve(), { once: true });
            });
            await new Promise(resolve => setTimeout(resolve, 150));
            try {
              databaseReadableAfterAbort =
                serviceRepository.readClaimExecutionState(activeClaim) === 'prewrite';
            } catch {
              databaseReadableAfterAbort = false;
            }
            return { state: 'stopped_before_write' as const };
          }
        }
      });
    }
  });
  await service.start();
  await pollerFailure;
  const stopResult = service.waitForStop().then(
    () => null,
    (error: unknown) => error instanceof Error ? error : new Error('UNKNOWN_STOP_ERROR')
  );
  const close = service.close();
  const secondClose = service.close();
  assert.strictEqual(close, secondClose);
  const closeResult = close.then(
    () => null,
    (error: unknown) => error instanceof Error ? error : new Error('UNKNOWN_CLOSE_ERROR')
  );
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(service.workerStatus.state, 'executing');
  assert.equal(databaseReadableAfterAbort, false);
  const closeError = await closeResult;
  const stopError = await stopResult;
  assert.equal(closeError?.message, 'CONTROL_PLANE_RUNTIME_FAILED');
  assert.equal(stopError?.message, 'CONTROL_PLANE_RUNTIME_FAILED');
  assert.equal(databaseReadableAfterAbort, true);
  assert.ok(repository);
  assert.ok(claim);
  assert.throws(() => repository.readClaimExecutionState(claim));
  const reopened = initializeDatabase(directory);
  const row = reopened.prepare(\`\
    SELECT j.state,
      (SELECT COUNT(*) FROM product_app_lease WHERE job_id=j.job_id AND released_at IS NULL) AS app_leases,
      (SELECT COUNT(*) FROM product_worker_lease WHERE job_id=j.job_id AND released_at IS NULL) AS build_leases,
      (SELECT COUNT(*) FROM deployment WHERE app_id=j.app_id) AS deployments
    FROM product_deploy_job j WHERE j.job_id='service-lab-job'
  \`).get() as { state: string; app_leases: number; build_leases: number; deployments: number };
  assert.deepEqual(row, { state: 'claimed', app_leases: 1, build_leases: 1, deployments: 0 });
  reopened.close();
  return {
    waited_for_executor: databaseReadableAfterAbort,
    close_idempotent: close === secondClose,
    close_error: closeError instanceof Error ? closeError.message : 'NO_ERROR',
    claim_preserved: row.state === 'claimed' && row.app_leases === 1 && row.build_leases === 1
  };
}

void main().catch((error: unknown) => {
  console.error('WORKER_LINUX_LAB_FAILED', error instanceof Error ? error.message : 'UNKNOWN');
  process.exitCode = 1;
});
`

/** @type {<T>(promise: Promise<T>, timeoutMs: number, code: string) => Promise<T>} */
// JavaScript JSDoc supplies the generic return type; this TS-only rule does not read it here.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const withWatchdog = (promise, timeoutMs, code) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

let child
try {
  writeFileSync(entry, entrySource)
  await esbuild.build({
    entryPoints: [entry],
    outfile: artifact,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    plugins: [
      {
        name: 'migration-sql-raw-loader',
        setup(build) {
          build.onResolve({ filter: /\.sql\?raw$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
            namespace: 'migration-sql'
          }))
          build.onLoad({ filter: /.*/, namespace: 'migration-sql' }, (args) => ({
            contents: requireRuntime('node:fs').readFileSync(args.path, 'utf8'),
            loader: 'text'
          }))
        }
      }
    ]
  })
  child = spawn(nodeBinary, [artifact, dbDirectory], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let outputError = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout = (stdout + chunk).slice(-4096)
  })
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    outputError = (outputError + chunk).slice(-512)
  })
  const exit = new Promise((resolveExit, rejectExit) => {
    child.once('error', () => rejectExit(new Error('WORKER_LAB_SPAWN_FAILED')))
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  const result = await withWatchdog(exit, 10_000, 'WORKER_LINUX_LAB_TIMEOUT').catch(
    async (error) => {
      if (child?.exitCode === null && child?.signalCode === null && child?.pid) {
        try {
          process.kill(child.pid, 'SIGKILL')
        } catch {
          // The exact harness child may have exited during timeout handling.
        }
        await withWatchdog(exit, 2_000, 'WORKER_LAB_CHILD_CLEANUP_TIMEOUT').catch(() => undefined)
      }
      throw error
    }
  )
  if (result.code !== 0)
    throw new Error(`WORKER_LAB_EXIT_${result.code ?? result.signal}:${outputError.slice(0, 80)}`)
  process.stdout.write(stdout)
} finally {
  if (child?.exitCode === null && child?.signalCode === null && child?.pid) {
    try {
      process.kill(child.pid, 'SIGKILL')
    } catch {
      // The exact harness child may have exited while cleanup began.
    }
  }
  if (existsSync(artifact)) rmSync(artifact, { force: true })
  rmSync(scratch, { recursive: true, force: true })
}
