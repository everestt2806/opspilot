# TK-S7 G2 — Live smoke deploy Git trên VPS phát triển

> Phụ thuộc: G0/G1a và luồng deploy Git thường của [G1b](tk-s7-g1b-git-ui-history-migrate.md) đã qua review local. Migrate Git sau rollback chưa hoàn tất; G2 không kiểm thử hoặc tuyên bố tính năng đó. Theo [kế hoạch demo](../29-ke-hoach-demo-14-10.md) và [preflight VPS](dev-vps-preflight-2026-10-08.md).

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | 11/10/2026; không cắt gate để kịp demo | `feat/deploy-reachability` | P0 |

## Mục tiêu

Chứng minh một người dùng có thể nhập **repository Git công khai trong Electron**, nhận diện framework, precheck, triển khai lên VPS phát triển qua SSH đã pin host key, rồi truy cập app từ máy ngoài. Ghi đúng SHA nguồn và trạng thái truy cập. Đây là live smoke cho **manual Git deploy**, chưa phải push-to-deploy hay pilot ML.

## Ranh giới vận hành

- Người dùng đã cho phép dùng VPS phát triển để hoàn thiện app. Dùng SSH key và fingerprint đã xác minh độc lập, lưu ngoài repo; không đưa mật khẩu, private key, env secret, token hoặc raw stderr vào prompt, commit, ảnh hay báo cáo. Dùng profile OpsPilot biệt lập, không ghi đè `userData` hiện có.
- Dùng app thử có tên riêng; chỉ thao tác container/thư mục/port thuộc lần thử đó. Không reset VPS, không dọn app khác, không chạy pilot ML (ổ 25 GB không đủ mốc 40 GB), không sửa firewall nhà cung cấp bằng tay để tạo kết quả giả. Nếu ingress bị chặn, ghi `degraded` và bằng chứng; chỉ cấu hình qua tính năng app nếu được hỗ trợ.
- Không push OpsPilot, không mở PR/merge. Không push repo demo chỉ để tạo SHA thứ hai. Không dùng CLI clone hoặc deploy local thay cho bằng chứng wizard Git. Trước khi chạy, ghi HEAD và `git status` của repo cùng phiên bản build thực sự mở trong Electron.

## Definition of Done

- [x] Từ Electron thật: tạo/kiểm tra VPS bằng fingerprint đã pin; `vps:test-connection` và scan đạt các điều kiện cần. Nếu VPS không sẵn sàng, dừng live smoke và ghi lỗi thực tế, không sửa rộng hạ tầng ngoài phạm vi app thử.
- [x] Trong wizard chọn **Git repository**: `https://github.com/everestt2806/opspilot.git`, ref `main`, root `demo-apps/express-api` (hoặc repo demo công khai tương đương nếu URL này không thể dùng, ghi rõ lý do). Prepare hiển thị full SHA, detector/plan hợp lệ; precheck và start dùng đúng handle/SHA đã pin. Không chọn thư mục local để giả làm Git.
- [x] Deploy kết thúc với bản ghi app `source_type=git`, `source_path=NULL`, URL/ref/root đúng; deployment lưu full SHA đúng với snapshot đã chuẩn bị. Ghi deployment ID, image/container ID, thời gian và ảnh màn hình. Kiểm tra loopback health trên VPS và URL public **từ máy điều khiển**; ghi HTTP status/body rút gọn, `exposure_status`, diagnosis nếu có. Chỉ gọi `reachable` khi external probe thật đạt.
- [x] Thử một redeploy cùng app bằng wizard Git. Nếu nhánh đã có commit mới thì ghi hai SHA và kết quả; nếu chưa có, redeploy cùng SHA để chứng minh version tăng và ghi rõ **same SHA**, không tuyên bố hai commit. Rollback chỉ chạy nếu có bản đích hợp lệ và đã kiểm tra được kết quả trước đó; không dùng rollback để che lỗi deploy.
- [x] Ghi bằng chứng tại `docs/demo-14-10/evidence.md`: thời điểm, branch/HEAD app, repo/ref/full SHA nguồn, bước chạy, deployment ID, URL, HTTP status, image/container, exposure và lỗi/NOT_RUN. Ảnh/video nếu có đặt dưới `docs/demo-14-10/` và che mọi secret. Ghi riêng `LIVE_VPS` hoặc `NOT_RUN`; không dùng fixture UI hay mock làm bằng chứng live.
- [x] Chạy gate Node 22 phù hợp với đúng HEAD được demo: lint, Node/Web/Scripts typecheck, Vitest, build và `git diff --check`. Nếu phải sửa blocker runtime, commit code/test riêng, lặp lại smoke và gate trên build mới; không giữ bằng chứng cũ cho SHA mới. Cập nhật task/board và commit cục bộ. Khi bàn giao chỉ báo “Worker đã xong”.

## Nhật ký

- START 09/10/2026 — Worker bắt đầu trên `feat/deploy-reachability`, HEAD `d4ceb81d814b13dfae27f376014395a1dde1f8e7`; Electron chạy bằng userData biệt lập.
- UPDATE 09/10/2026 — Wizard Git thật deploy và redeploy cùng app trên VPS; deployment 1/2 cùng SHA, external `/health` HTTP 200, scan sau deploy đạt. Bằng chứng: [evidence](../demo-14-10/evidence.md). Gates Node 22 đang chạy.
- UPDATE 09/10/2026 — Node 22.23.3 gates pass: `pnpm lint`, app Node/Web typecheck, scripts `tsc --noEmit -p tsconfig.scripts.json --composite false`, full Vitest 71 files / 666 tests, `pnpm build`, `git diff --check`. Không có thay đổi runtime giữa live smoke và gates.
- HANDOFF-LOCAL 09/10/2026 — Tài liệu/bằng chứng G2 commit `3776cfd` trên `feat/deploy-reachability`; chưa push/PR/merge. Migrate sau rollback vẫn chưa hoàn tất; không thử migrate hay pilot ML.
- PLAN 09/10 — Leader review guard `49300ea`: chặn mọi attempt Git mới hơn current trước migrate; focused migrate 19/19 Node 22. Cho phép G2 kiểm chứng deploy Git thường trên VPS phát triển; migrate sau rollback tiếp tục là gap được theo dõi riêng.

## PR

Chưa được phép push, mở PR hoặc merge.
