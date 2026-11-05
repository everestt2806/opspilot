# R1 — Full Product runtime integration lab

START 06/11/2026 — User yêu cầu thực hiện toàn bộ kế hoạch release 04/12, không chỉ giao prompt. Thực hiện R1 từ `ad37403`, sau R0 ownership guard; không giả định có Worker khác đang chạy. Dùng skill task-discipline, scope product-mode theo ADR-011.

## Requirement ledger

| Yêu cầu | Implementation / evidence | State |
|---|---|---|
| CLI gọi pipeline thật qua pinned SSH, scratch SQLite, Docker và collector thật | `product-runtime-lab/run.mjs`, original helper mặc định, actual Express/git commits/build/collector | PASS |
| Deploy đầu và cập nhật healthy giữ identity/SHA/metric attribution đúng | `adab2ad40de1`: CID/SHA/current pointer/B0, JSONL thật, sealed receipt/T1/ACK/T2; rollback R0 lớn hơn candidate B0 | PASS |
| Build fail, health fail, first failure và collector/restore failure | Standard 7/7 PASS `adab2ad40de1`; restore-failure 4/4 PASS `c506617bfeb1`; unknown giữ barrier/leases, không giả thành rollback thành công | PASS |
| Cleanup đúng ownership, không ảnh hưởng workload ngoài lab | Standard nonce namespace cleanup=true, labels app/controller xác minh, scratch keys xóa; không prune | PASS |
| Regression/typecheck/lint/build và hồ sơ bàn giao | 286 Vitest; config 2/2, controlled 23/23; typechecks/lint/Ruff/build, fresh Linux install, diff/link checks PASS; handoff cùng branch/commit | PASS |

## Ranh giới

- Giữ production executor tắt cho tới R1/R2 gates; dùng only local Docker lab và SQLite scratch. Không production DB/VPS/DNS mutation.
- Driver dùng credential/host keys tổng hợp trong private scratch; không in/lưu vào Git hoặc report. Host key fingerprint lấy từ file public key qua local Linux console, không tự trust khóa mạng.
- Nối pipeline hiện có trước, sửa lỗi runtime được lab chứng minh bằng regression. Contract/schema chỉ đổi khi cần và theo quy trình repo, không sửa migration cũ.
- R2 crash matrix là task kế tiếp; R1 chưa thay thế R2 hay PRODUCT_PASS. Kế hoạch tổng: [release 04/12](tk-s7-release-2026-12-04.md).

## Nhật ký

- START 06/11: Docker daemon 29.4.3 sẵn sàng, cached Node/Python/SSH lab images có sẵn. Đọc pipeline, fixtures và các lab hiện hành; bắt đầu driver pinned SSH runtime.
- UPDATE 06/11: driver mới đã chạy deploy đầu qua pipeline thật, có collector ghi metric thật (PASS bước đầu); đang tiếp tục update/failure cases. Lần đầu setup lỗi template cwd và git safe.directory đã sửa ở harness, chưa coi là lỗi production runtime.
- UPDATE 06/11: healthy update và build failure đã có lượt PASS; failure khác tái hiện ở `target_product_runtime.py:558` khi stop/re-inspect collector. Phát hiện config digest phụ thuộc thứ tự `Mounts`; regression đảo mount FAIL trên code cũ, các semantic-change tests vẫn PASS. Chuẩn hóa thứ tự mount trước hash, giữ nguyên Config/HostConfig/Type/Source/Destination/RW; đang kiểm lại live, chưa chốt nguyên nhân duy nhất của mọi failure trước đó.
- UPDATE 06/11: trace nonce `69f99732e5ac` xác nhận collector đã dừng, Config/HostConfig không đổi và mount order đổi. Sau fix, lab 4/4 `e39bb2e216cf`, 7/7 `3fe1b12eef4e`, và 7/7 `adab2ad40de1` đều PASS, cleanup=true. Lượt cuối dùng original helper, giữ subject hashes/bundle hash, SQLite backup và metrics JSONL. Những lượt trước commit ghi base `ad37403`; không đánh đồng base SHA với runtime source đang sửa.
- UPDATE 06/11: củng cố regression collector build failure: code cũ dừng collector trước build (controlled 22/23), code mới build/verify image trước quiesce/B0 (23/23). Unknown vẫn không seal/finalize; app và collector cũ tiếp tục chạy. Runtime package thiếu direct dependency Zod cần cho H2 đã thêm bản 4.4.3 đã được repo duyệt; fresh Linux npm ci + bundle import + SQLite migration 020 PASS.

## Gate và lệnh tái hiện

Windows Node22.23.3; Linux Node22.23.4/Python3.12.3; Docker29.4.3. Các lệnh pnpm chạy sau `. D:/Developing/DuAnCNTT/tools/enter-node22.ps1`. Cách build/chạy Linux CLI xem [README lab](../../app/scripts/product-runtime-lab/README.md).

| Gate | Lệnh / artifact | Kết quả |
|---|---|---|
| Real full pipeline | `node app/scripts/product-runtime-lab/run.mjs` với bundle Linux; `.out-scripts/product-runtime-lab/adab2ad40de1/result.json` | **7/7 PASS, cleanup=true, subject_unchanged=true** |
| Real restore failure | `node app/scripts/product-runtime-lab/run.mjs --restore-failure`; `.out-scripts/product-runtime-lab/c506617bfeb1/result.json` | **4/4 PASS, cleanup=true, subject_unchanged=true**; ca cuối xác minh không có canonical app, không terminal thành công, leases giữ nguyên |
| Config semantics | Linux `python3 app/scripts/test_product_runtime_config.py` | **2/2 PASS**; đảo mount không đổi hash, Env/memory/restart/source/target/RW/type thay đổi vẫn đổi hash |
| Guard/target regression | `node app/scripts/product-h2-review/run.mjs` | **23/23 PASS**, `6751b51a967d`, cleanup=true |
| Full focused Product + monitor | `pnpm --prefix app exec vitest run src/main/controlPlane src/main/db/productRuntimeRepository.test.ts src/main/monitor/service.test.ts --maxWorkers=4 --reporter=dot` | **286/286 PASS, 13 files** |
| Typechecks | `pnpm --prefix app typecheck`; `pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json`; `pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json` | PASS; lab tsconfig riêng để không đổi output path của CLI thường |
| ESLint | `pnpm --prefix app exec eslint scripts/product-runtime-lab --max-warnings=0` | PASS, 0 errors/warnings |
| Python lint | `python -m ruff check app/src/main/controlPlane/target_product_runtime.py app/scripts/product-h2-review/test_runtime.py app/scripts/test_product_runtime_config.py app/scripts/product-runtime-lab/trace_helper.py` | PASS |
| Build | `pnpm --prefix app exec electron-vite build` | PASS, main/preload/renderer; chưa thay installer gate |
| Fresh Linux runtime | `node app/scripts/product-runtime-lab/verify-deps.mjs` | PASS: clean npm ci, Node22.23.4, SQLite3.53.4, Zod4.4.3, migration020 |
| Diff / final review | `git diff --check`, staged check, explicit file list; relative links | PASS; 0 missing links |

Artifacts trong `app/.out-scripts/product-runtime-lab/<nonce>/` là local ignored, chứa dataset lab/DB scratch, không phải dữ liệu thí nghiệm ML chính thức. No accepted exception; production executor vẫn tắt.

HANDOFF-LOCAL 06/11 — R1 **CHỜ REVIEW**, đủ local integration gate; implementation SHA là commit chứa thay đổi `target_product_runtime.py` và hồ sơ này (`git log -1 -- app/src/main/controlPlane/target_product_runtime.py`). Thực hiện tiếp R2 crash/lease/fence matrix; R1 không cung cấp recovery tự động cho kết quả unknown trước T1, không bật executor và không nhận toàn sản phẩm production PASS. Các lỗi setup/typecheck/lint trung gian đã sửa; không có gate fail được miễn trừ. Không push/PR/merge/VPS mutation.
