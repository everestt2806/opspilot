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

## Recovery matrix (R2)

```sh
node app/scripts/product-runtime-lab/recovery.mjs
# Optional focused cases:
node app/scripts/product-runtime-lab/recovery.mjs after-t1 after-ack
```

Nine cases: before seal, durable seal before T1, after T1, durable ACK before idle, idle before ACK
response, after T2, expired committed lease, changed SSH identity in DB, and advanced target fence.
Target faults terminate the actual helper process after its real fsync/atomic write. Controller
faults throw after actual repository commits and recovery reads through a **new SQLite connection**;
this does not claim an OS-level restart of an installed controller service. Expiry is forced into
the past only in the scratch DB; it is not a natural 60-second soak.

Pre-T1 outcomes intentionally remain unknown and reject settlement; operator reconciliation is
still required. Post-T1 recovery verifies persisted signed records, leaves the app and collector
CID/image/start time unchanged and settles idempotently. Stale pin/fence must reject without lease
release. No phase is replayed to make a run look successful.

The R2 preloader injects faults into an R1 child. After its assertions pass it raises
`R2_CHECKPOINT_FINISHED` so the R1 child's normal cleanup runs. That child's intentional exit 1
is **not** a standalone R1 regression result. Only the R2 aggregate may report this profile PASS,
after checking its own assertions and the child's cleanup/source-unchanged flags.
Reports: `app/.out-scripts/product-runtime-recovery/<nonce>/result.json`; per-case evidence and
linked R1 scratch DB/collector artifacts remain separately identified.

## Executor adapter (R3a)

```sh
# Use a separate artifact so an in-flight R2 matrix keeps its frozen bundle.
export OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3-lab.cjs
node app/scripts/product-runtime-lab/build.mjs
node app/scripts/product-runtime-lab/executor.mjs
```

The adapter prepares/verifies its snapshot, runs the real pipeline and returns an internal
`runtime_settled` reference only when the persisted exact claim/commit/T1/T2 is verified. The
queue requires a trusted verifier callback; a result string alone cannot let it continue.
Post-dispatch unknown outcomes do not enter prewrite retry handling.

This fixture supplies an already-verified immutable local Git snapshot to isolate the adapter;
it does not claim a live repository fetch or service-driven Git polling. All runtime operations,
receipts and DB records remain real. Six terminal cases reject forged attempt/commit references;
the collector failure remains unknown without retry. Reports are in
`app/.out-scripts/product-runtime-executor/<nonce>/` with the linked R1 DB/JSONL artifacts.
Default `ControllerService` still has no executor: provisioning/admission/cold startup recovery
and management/UI integration must pass R3b/R3c before enabling always-on deployment.

## Controller key-store component (R3b-1)

```sh
export OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b-lab.cjs
node app/scripts/product-runtime-lab/build.mjs
node app/scripts/product-runtime-lab/secrets-check.mjs
```

This Linux-only filesystem gate uses a private scratch directory, generated key material and the
real AES-GCM cipher. It checks missing-key rejection, create-once/reopen, no implicit rotation,
owner/mode/symlink/hardlink/size/directory checks. Run as root only in the isolated lab to test
foreign ownership. It never uses a production profile or prints key/credential bytes. Credential
binding/tamper tests run separately in `controllerSecrets.test.ts`; per-app HMAC key storage,
target enrollment and service composition remain pending.

## Per-app runtime keys and routing (R3b-2)

```sh
export OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b2-lab.cjs
node app/scripts/product-runtime-lab/build.mjs
node app/scripts/product-runtime-lab/runtime-keys-check.mjs
node app/scripts/product-runtime-lab/key-router.mjs
```

The first gate checks encrypted material, exact controller/app/generation/purpose binding,
create-once/load-only semantics, retained old generations, damaged records, unsafe permissions,
symlinks/hardlinks/owner/size/encoding and two concurrent creator processes. It uses isolated
root Linux scratch for the foreign-owner check; never a production profile.

The router gate explicitly provisions two app keys from the real store into **lab-only** target
enrollments before execution. It forwards real pipeline operations; the old R1 assertion reader's
key is adapted to the app being read, while the subject router loads a fresh repository/key per
claim. No response, receipt or Docker command is forged. Snapshot transport is the verified local
Git fixture, not a public Git fetch claim.

During a healthy update it creates future-generation material, verifies a pending T1 record using
a fresh old-generation repository and injects an exception after the real commit. The production
adapter performs recovery; the container ID and StartedAt must stay unchanged. Generation material
is prepared without switching SQL ownership. This does not prove production enrollment or an OS
restart of an installed service. Reports are in `app/.out-scripts/product-runtime-key-router/<nonce>`.

## Controller SQLite credential to pinned SSH (R3b-3)

```sh
export OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b3-lab.cjs
node app/scripts/product-runtime-lab/build.mjs
OPSPILOT_KEY_ROUTER_BOUND_SSH=1 node app/scripts/product-runtime-lab/key-router.mjs
```

This variant explicitly encrypts the lab's generated client key into its scratch SQLite VPS row,
bound to that controller and exact SSH target/revision. Each runtime attempt opens a fresh
SshManager using `createControllerSshResolver` and the real protected key store. Host key
verification, SSH, Docker, helpers, per-app HMAC routing and T1 recovery remain real. The fixture
reads only its generated key already held by the lab manager; it does not import a Desktop DB,
credential or environment fallback. All owned connections are disconnected on success/failure.

Reports are in `app/.out-scripts/product-runtime-bound-ssh/<nonce>` and include the actual number
of fresh bound-credential SSH connections. Missing/archived/invalid profiles, identity/revision
changes, ciphertext/controller/VPS swaps, tampering, missing keys and legacy scheme rejection are
covered separately by the SQLite/AES unit gate. Windows units substitute only the filesystem key
loader; they do not establish SSH or prove production enrollment. The service remains polling-only.

## CLI khởi tạo khóa / đăng ký VPS (R3b-4)

```sh
export OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules
export OPSPILOT_CONTROL_PLANE_OUTPUT=/var/tmp/opspilot-p3e3a-runtime/r3b4/control-plane.cjs
node app/scripts/build-control-plane.mjs
OPSPILOT_CONTROLLER_ARTIFACT="$OPSPILOT_CONTROL_PLANE_OUTPUT" node app/scripts/product-runtime-lab/controller-enrollment.mjs
```

Gate chạy bằng root **trong Linux lab**, tạo sshd loopback riêng với host/client keys ngẫu nhiên,
controller data directory/SQLite riêng và gọi bundle CLI bằng các process thật. Không cần Docker
cho checkpoint này: không chạy remote command, build app hoặc enroll target helper/HMAC. Credential
chỉ truyền qua stdin; stderr/stdout được kiểm không có secret, không lưu raw output. Gate kiểm
init không tự sinh key, explicit create-once/permissions, missing/wrong pin/auth, encrypted binding,
cold CLI replay, hai process đồng thời, conflict, missing/unsafe master key, retained runtime key,
archived record và input cap/invalid JSON/env fallback. Auth thật dùng key sinh trong lab; password
path kiểm bằng unit transport, chưa nhận password trên VPS người dùng đã pass.

Reports: `app/.out-scripts/controller-enrollment/<nonce>/result.json`, gồm bundle/driver/subject
hashes, các ca PASS và cleanup. Scratch keys/SQLite/sshd xóa hoặc dừng cuối gate; không dùng profile
Desktop hoặc VPS thật. R1/R2/R3a runtime lab có scope riêng, không chạy lại hoặc tính là gate của CLI
này. Hướng dẫn vận hành: [controller README](../../control-plane-runtime/README.md).

## Gói controller độc lập / verifier (R3b-5a)

```sh
OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules node app/scripts/product-runtime-lab/controller-bundle.mjs
node app/scripts/product-runtime-lab/verify-deps.mjs
```

Gate thứ nhất dùng root Linux scratch để thử foreign owner/permissions, build một CLI tin cậy và
copy candidate riêng. CLI tin cậy chỉ đọc candidate từ cwd khác repo. Kiểm 10 asset byte-identical,
11 payload files, explicit manifest pin, không DB; negative cases gồm sửa/mất file, extra file/dir,
traversal dù pin khớp, symlink file/manifest/directory, hardlink ngoài bundle, owner/mode và builder
từ chối linked entrypoint. Candidate giả ghi sentinel nếu execute; verifier phải từ chối mà không
tạo sentinel. Không gọi code trong candidate để tự chứng minh integrity.

Fresh-dependency gate `verify-deps.mjs` cài lại approved lockfile vào scratch rồi build artifact,
verify payload11files từ cwd khác và chạy CLI init/status/native SQLite/Zod. Không cần source repo
ở runtime cwd; builder vẫn đọc source repo để build. Templates/collector đã đóng gói và kiểm byte,
chưa chứng minh 3-framework Product pipeline hoặc installed-service activation.

Reports: `app/.out-scripts/controller-bundle/<nonce>/result.json`; fresh-install summary stdout.
Không dữ liệu/khóa người dùng, không target app enrollment/SSH command/VPS mutation trong bundle gate.
