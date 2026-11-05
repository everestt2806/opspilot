# Product runtime integration lab (R1)

This CLI calls the **real** Product pipeline through fingerprint-pinned OpenSSH, scratch SQLite,
the target guard/helper, Docker build/run/inspect, and the production collector. It does not use a
fake channel, Docker command implementation, receipt, or metric generator. It is a local Linux lab,
not evidence of a production VPS rollout or public HTTPS.

Requirements: Linux/WSL with Node 22, Python 3, Git, npm, OpenSSH server, Docker Linux daemon,
permission to create an isolated sshd and `/opt/opspilot/r1-<nonce>*` directories. The lab requires
root in that isolated Linux environment. No existing app/profile/database is used. Pull/build can
use the network to obtain the approved Node/Python images and Express/collector dependencies.

Use a separate **Linux** installation of `app/control-plane-runtime/package.json` dependencies
(see the existing controller runtime package in this repo), including its approved esbuild tool.
Do not rebuild the Windows/Electron `better-sqlite3` binary for Linux. For the existing WSL setup:

```sh
export OPSPILOT_R1_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules
export OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r1-lab.cjs
node app/scripts/product-runtime-lab/build.mjs
node app/scripts/product-runtime-lab/run.mjs
node app/scripts/product-runtime-lab/run.mjs --restore-failure
node app/scripts/product-runtime-lab/verify-deps.mjs
```

`node` must resolve to Node 22. Build embeds migration SQL with esbuild's raw loader and leaves
approved runtime packages external. Check TypeScript without changing the regular CLI rootDir:

```sh
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
```

Cases: first healthy deployment, healthy update, failed app build preserving app+collector,
unhealthy update restoring the previous exact container and collector with a real rollback byte
boundary, first build failure, first health failure, and failed collector build. The last case
must keep the previous collector running, leave the barrier/leases pending and refuse terminal
success. `--restore-failure` deliberately removes **only this run's verified previous container**
before rollback; the pipeline must refuse successful finalization and retain authority for recovery.
This is an unknown outcome requiring R2 reconciliation, not a successful rollback.

Optional `--trace` uses `trace_helper.py` to observe/rethrow exceptions and forward all real operations.
The default gate uses the unchanged target helper directly. The optional trace contains
only method names, exception types, source locations, changed top-level configuration field names,
and whether mount order changed. It never records exception messages, env values, arguments, source,
credentials or subprocess output. Neither the trace wrapper nor the driver alters protocol responses.

Reports are ignored artifacts in `app/.out-scripts/product-runtime-lab/<nonce>/`: `result.json`,
`progress.json`, scratch SQLite backup and actual collector JSONL when available. Report the base
commit **and** subject/bundle hashes; a dirty working-tree run is not a proof of the unchanged base SHA.
The Git source fixture has real local commits/full SHAs; repository fetching is covered separately.

Cleanup checks exact nonce namespace plus Product app/controller labels before removing containers,
images or networks; it deletes only verified scratch and per-run metrics directories. It never uses
prune/reset/clean or inspects/deletes unrelated resources. Temporary SSH keys and enrollment secret
are generated inside private scratch, never printed or committed, and removed after disconnect.
The shared Docker image/build cache can grow normally; this tool does not prune global cache.

R1 passing does not enable the executor. R2 still covers lost responses/crashes around seal, T1,
ACK, idle, T2 and lease/fence expiry; production enrollment, controller service, public exposure,
three-template/DB parity, installer and real VPS acceptance are separate release gates.
