# Phân công song song Sơn / Kim — 16/11/2026

START16/11 — User yêu cầu hai người phát triển đồng thời, không sửa cùng file và không chờ checkpoint của nhau. Code baseline đã push: `f699615` (R7h-4d2). Nhánh Kim ghim tại commit tài liệu bàn giao ngay sau baseline. Deadline04/12/2026. Đây là setup, chưa phải bằng chứng các feature dưới đây đã hoàn tất.

## Hai đầu ra độc lập

| Luồng | Owner / nhánh | Đầu ra | Bắt đầu |
|---|---|---|---|
| A — Product database | Sơn + assistant, `feat/release-audit-20261204` | d3 Main/admin/IPC/UI inspector; d4 approved release/live; tiếp product backup/restore theo task riêng | Ngay; không cần installer/CI của Kim |
| B — Windows delivery | Kim + Worker, `feat/kim-windows-delivery-20261116` | K1 current-schema packaged-app gate; K2 clean-Windows installer; K3 source CI và demo delivery | Ngay trên baseline cố định; không cần database UI mới |

Hai luồng dùng checkout/process/profile/output riêng. Kim kiểm baseline f699615, không liên tục pull/rebase core. Feature mới của Sơn không làm mất hiệu lực checkpoint trên baseline của Kim; khi tích hợp cuối mới chạy lại trên bản ghép. Không hứa tuyệt đối không có xung đột: thay đổi dependency/behavior vẫn cần review và integration gate, nhưng công việc hằng ngày không phụ thuộc feature bên kia.

## Quyền sửa file

| Khu vực | Owner |
|---|---|
| `app/src/**`, `docs/contracts/**`, migrations, templates/collector/experiments/ml-service | Sơn |
| `app/scripts/windows-release-lab.mjs`, `windows-installer-lab.mjs`, `windows-upgrade-lab.mjs`, `windows-upgrade-baseline.py`, `legacy-ml-upgrade-lab.py`, `legacy-ml-upgrade.ps1`, `windows-release-lab/**`, `build-ml-runtime.py` | Kim |
| `app/scripts/windows-delivery/**` mới, `.github/workflows/windows-delivery-source.yml` mới | Kim |
| `app/electron-builder.yml`, `app/resources/installer.nsh`, `app/scripts/controller-installer-before-pack.cjs` | Kim; chỉ sửa lỗi delivery tái hiện được, giữ verification/pin/identity tương thích |
| Controller catalog/pins/release/build scripts khác; `app/electron.vite.config.ts`, `app/package.json`, lockfiles, `ml-service/runtime-lock.json` | Sơn; Kim đọc và dùng CLI hiện có |
| `docs/tasks/tk-s7-kim-windows-delivery.md`, `docs/delivery/windows-kim/**` mới | Kim |
| Board, DECISIONS, hồ sơ release chung/task core | Sơn/coordinator |

Ngoại lệ phối hợp hồ sơ: Kim cập nhật task riêng cùng commit; Sơn tổng hợp board/DECISIONS khi review. Không để hai người cùng sửa board/strings/IPC/lockfile. Lỗi ngoài phạm vi: Kim ghi repro/expected/actual/file gợi ý trong task riêng, tiếp tục đầu việc độc lập; không sửa chéo hoặc nới guard để làm xanh gate.

## Hạ tầng / dữ liệu

- Chỉ Sơn mutation VPS đang phục vụ8apps/2PostgreSQL và approved releases. Kim không cần credential/VPS/production DB.
- Kim dùng máy/VM Windows riêng; profile/HOME/output nonce. Default production install/uninstall chỉ trong Windows dùng để thử, không ghi đè bản app/DB/model đang sử dụng.
- Không dùng chung node_modules, venv, SQLite/userData, build output đang ghi. Hai máy có thể build/test đồng thời. Cùng máy: cổng cố định/registry/GUI automation phải có owner; dùng cổng/profile riêng hoặc làm K3 lúc tài nguyên bận. Đây là giới hạn tài nguyên lab, không phải phụ thuộc feature.
- Binary resources ignored không tự có sau clone. K1 kiểm kê prerequisite và chuẩn bị đúng nguồn đã duyệt; không phụ thuộc đường dẫn máy Sơn. Thiếu file đã pin thì ghi đúng tên/hash; không sửa pin/file rỗng. Trong lúc chờ artifact vẫn làm source CI/preflight/checklist; đây là rủi ro môi trường cần báo thật.
- Synthetic ML trong installer chỉ chứng minh bundled runtime; formal ML vẫn NOT_RUN chờ hai VPS riêng.

## Checkpoint và tích hợp

1. Sơn: A1=d3 Main/admin, A2=d3 UI, A3=d4 release. Kim: K1/K2/K3 theo task riêng. Mỗi bên commit/normal push nhánh mình khi gate đạt; không PR/merge/force/reset/stash/clean/rebase.
2. Ghi SHA/source hashes, môi trường, gate thực chạy, raw evidence/hash và giới hạn. Không lấy số test baseline cũ để báo cho core mới.
3. Sơn review diff/phạm vi/evidence. Khi user cho phép tích hợp: merge hai luồng trong checkout integration riêng, giữ lịch sử; chạy full suite/build và affected native/Electron/installer trên đúng HEAD ghép. Không chép đè thư mục hoặc tự bỏ test lỗi.
4. Hai người vẫn làm tiếp trong nhánh riêng khi coordinator kiểm bản ghép. Chỉ khóa candidate đang nghiệm thu. Publish installer/đổi release pins/upgrade VPS/PRODUCT_PASS là gate riêng.

## Ledger setup

| Requirement | Evidence | State |
|---|---|---|
| Kiểm baseline/backlog | f699615; d3/d4 OPEN; R11b thiếu clean-Windows/default identity, Windows labs có thể nâng cấp độc lập | PASS |
| Hai đầu ra không phụ thuộc feature mới | A database; B packaged app/installer/source CI trên baseline ghim | PASS |
| Tách file/nhánh/state | Bảng owner; task/docs/output riêng; VPS chỉ Sơn | PASS |
| Task tiếp nhận cho Kim | tk-s7-kim-windows-delivery.md, nhánh bàn giao riêng | PASS |
| Implementation A/K1/K2/K3 | Chưa bắt đầu từ setup này; đánh giá theo task tương ứng | OPEN |
