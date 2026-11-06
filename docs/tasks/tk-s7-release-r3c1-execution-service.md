# R3c-1 — Explicit execution service composition

START 06/11/2026 — Base `8e8d65d` đã push, R3b-6 local gates PASS. User cho phép tiếp tục và push theo checkpoint; không PR/merge, không production VPS/DB write. Áp dụng task-discipline/ADR-011. R3 tổng vẫn PARTIAL.

| Yêu cầu | Thay đổi / gate | State |
|---|---|---|
| Explicit opt-in execution, default vẫn polling-only | Linux CLI `run-product` strict stdin bundle pin, không renderer/env auto-enable; unit/service CLI lab | PASS |
| Service composition trọn vòng | Real production factory/router/admission/startup/provider, actual Git snapshot + queue → SSH/Docker/T1/T2; bad template env/cwd ignored | PASS |
| Health và shutdown đúng khả năng | 3 lifecycle regressions mới + slow/unconfirmed stop cũ; startup maintenance, blocked degraded, drain SSH trước DB | PASS |
| Linux service integration | 3 fresh CLI processes/2 Git commits/2 settled deployments, restart cùng SHA không duplicate, cleanup=true | PASS |
| Gate và checkpoint push | 34 focused/full1537 PASS/2 SKIP/types/lint/build/R1-R3b7/7; staged22files/secret/link/diff clean; `9dc3525` normal push, local=remote | PASS |

## Phạm vi và tiếp nối

- Checkpoint này nối service với implementation đã gate R3a/R3b. Public Git push/installed systemd/desktop API/UI authority cần evidence riêng, không tự nâng whole-product PASS.
- Không thay framework/DB support: Product runtime hiện Express không DB/required-env; Desktop templates vẫn giữ. Template parity thuộc R7.
- Không mở `/v1` hoặc public admin endpoint; giữ loopback health tối thiểu. Chỉ composition opt-in được cấp quyền claim sau startup recovery.

No accepted exception.

## Nhật ký và evidence

- UPDATE 06/11: `ControllerExecutionRuntime` chỉ tạo khi explicit bundle opt-in; đọc protected cipher (không tạo key), exact target proof/paths, packaged templates/collector reverify mỗi claim. Recovery trước cả poller/worker. Default run giữ polling-only nhưng health maintenance thay ready sai trước đây.
- UPDATE 06/11: thêm optional templates directory xuyên Product preflight/render/pipeline và renderer template functions; legacy Desktop caller không đổi. Actual Linux CLI chạy cwd `/` + bad `OPSPILOT_TEMPLATES_DIR` vẫn render/deploy thành công.
- Service gate **20af792fc092** PASS, linked R1 **ac082f50f0c6**, lab artifact `fa69f646e016bc44efda8420a30d58696da8fd184dcc31da3b5a4955564d1624`; CLI manifest `75f3c9645f1b84c4d3ad2bc026ba8cf912a302acd8e9d9b690ad3a3fe250795c`.
- **Giới hạn transport:** child dùng `--import execution-service-git-fixture.mjs` chỉ chuyển URL GitHub fixture cố định sang kho Git file scratch; ls-remote/fetch/detached snapshot chạy Git thật, production code/queue/SSH/runtime không stub. Không nhận public Git push hoặc systemd/live gate PASS. Cần gate R3c-2 bỏ adapter này trên GitHub thật.
- Hai run đầu FAIL (`dae263da7687`, `a27f2dbb43c7`) do lab file transport bị public Git HTTPS-only environment từ chối; không nới production protocol. Sửa đúng adapter lab (`GIT_ALLOW_PROTOCOL=file`) rồi final gate PASS. Không retry mù quáng hoặc bỏ qua lỗi.
- Raw không stage: `app/.out-scripts/execution-service/20af792fc092/{result,service}.json`, linked R1 SQLite; full suite `app/.out-scripts/release-r3c1-vitest-final.json` **1537 PASS/2 Linux-only SKIP/0 FAIL**. Baseline jsdom warnings không phải GUI proof. Python365/Ruff baseline cùng phiên R3b-6, không đổi Python trong checkpoint này.
- R1/R3b-6 final regression **3182685faa25**/linked **87778714f58f** 7/7 PASS,6 verified terminals +1unknown,7resource probes,historical proof/cold T1 CLI/no replay/cleanup/source unchanged. Cùng final management/lab bundles nêu trên.
- HANDOFF-LOCAL 06/11: CHỜ REVIEW; implementation `git log -1 -- app/src/main/controlPlane/controllerExecutionService.ts`. Next R3c-2 GitHub HTTPS không adapter + installed systemd start/stop/restart trong Linux lab, sau đó authenticated controller API/Desktop authority. Chưa production VPS/DB write.

## Tái hiện

```text
Node22: pnpm --prefix app exec vitest run src/main/controlPlane/controllerService.test.ts src/main/controlPlane/productRuntimeExecutor.test.ts src/main/deploy/templates.test.ts => 34 PASS
pnpm --prefix app exec vitest run --reporter=json --outputFile=.out-scripts/release-r3c1-vitest-final.json => 1537 PASS/2 SKIP
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <11 changed TS/MJS files> --max-warnings=0
pnpm --prefix app exec electron-vite build
=> types/lint/build PASS
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c1-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b5b/control-plane.cjs OPSPILOT_EXECUTION_SERVICE_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c1/control-plane.cjs node app/scripts/product-runtime-lab/execution-service.mjs
=> 3 processes/2 deployments/restart-no-duplicate PASS
```
