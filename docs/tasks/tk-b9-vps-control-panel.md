# TK-B9 — VPS Control Panel v1

> **HOÀN THÀNH 30/08/2026 — không nhận lại task này.** PR #21 và #22 đã merge. Điểm vào mới
> của B là [`tk-b4-m5-probes.md`](tk-b4-m5-probes.md); xem kế hoạch sau demo ở
> [`../23-ke-hoach-sau-demo-30-08.md`](../23-ke-hoach-sau-demo-30-08.md).

| Chủ | Hạn        | Branch                      | Brief                           | Ưu tiên |
| --- | ---------- | --------------------------- | ------------------------------- | ------- |
| B   | 28/08/2026 | `feat/ui-vps-control-panel` | `docs/02-ui-ux-spec.md` mục 3.1 | P0      |

## Trạng thái bàn giao

Giữ phần mục tiêu/DoD bên dưới làm bằng chứng lịch sử. AI mới không code tiếp trên branch cũ và
không dựng lại các component đã merge.

## Mục tiêu

Biến màn **VPS** hiện tại từ một bảng CRUD thành **VPS Control Panel v1**: người dùng nhìn được
tình trạng toàn bộ VPS, chọn một máy để xem và thao tác, quản lý các app đã deploy trên máy đó,
khởi tạo deploy/redeploy đúng VPS, và xem hoạt động gần đây của máy.

“Panel thực thụ” trong task này nghĩa là **trung tâm vận hành các chức năng OpsPilot đã có**.
Nó không phải bản sao cPanel/Plesk và không mở rộng thành công cụ quản trị Linux tổng quát.

Phục vụ trực tiếp FR-A1, FR-A2, FR-A3 và làm điểm vào cho UC-01/UC-02/UC-03/UC-09.

## Bố cục và hành vi bắt buộc

### 1. Tổng quan đội VPS

- Hàng số liệu: tổng số VPS, online, offline, tổng số app; số đang tải/không xác định không bị
  tính nhầm thành online.
- Danh sách có tìm theo tên/host và lọc trạng thái; mỗi VPS hiện tên, host, trạng thái, Docker,
  RAM/disk khả dụng và số app.
- Chọn một VPS mở vùng chi tiết mà không làm mất danh sách. Khi tải lại dữ liệu, giữ selection nếu
  VPS đó vẫn tồn tại; nếu không, tự chọn VPS hợp lệ đầu tiên.

### 2. Chi tiết VPS — tab `Tổng quan`

- Thông tin máy: tên, host/port, username, provider/region, Docker version, lần thấy gần nhất.
- Tài nguyên: CPU core/load 1 phút, RAM và disk khả dụng, kèm thời điểm/lần làm mới và trạng
  thái loading/error riêng của VPS được chọn.
- Hành động nhanh: Kiểm tra lại, kiểm tra/chẩn đoán kết nối, sửa thông tin, cài Docker khi thiếu,
  xoá VPS với confirm đúng `docs/02`.
- Lỗi phải có đủ “chuyện gì · ở bước nào · làm gì tiếp”; chi tiết kỹ thuật để trong vùng thu gọn.

### 3. Chi tiết VPS — tab `Ứng dụng & deploy`

- Gọi `app:list(vpsId)` và hiển thị app trên đúng VPS: tên, framework, cổng/URL, deployment hiện
  tại. Khi cần trạng thái/version thì dùng `app:versions(appId)`, không đoán từ UI.
- Có `Deploy ứng dụng mới` với VPS đang chọn được điền sẵn vào Deploy Wizard.
- Có `Redeploy` từ một app với cả VPS và app được điền sẵn; việc truyền lựa chọn dùng state/context
  ở renderer, không thêm IPC chỉ để điều hướng.
- Có `Mở ứng dụng` qua `system:open-external`. Nếu chưa có app, empty state chỉ rõ bước tiếp theo.

### 4. Chi tiết VPS — tab `Hoạt động`

- Dùng `history:list({ vps_id, limit, offset })`, mặc định 20 bản ghi mới nhất của VPS đang chọn.
- Hiện thời gian, hành động, trạng thái, message; click một dòng mở chi tiết key–value, không dump
  JSON thô. Ưu tiên tái sử dụng component/formatter của PR #18 thay vì copy logic.
- Có loading, empty, error và retry riêng; đổi VPS phải bỏ dữ liệu cũ trước khi render kết quả mới.

## IPC được phép dùng

- VPS: `vps:list`, `vps:get-resources`, `vps:test-connection`, `vps:create`, `vps:update`,
  `vps:delete`, `vps:install-docker`.
- App/deploy: `app:list`, `app:get`, `app:versions`, `deploy:*` thông qua Deploy Wizard hiện có.
- Hoạt động/hệ thống: `history:list`, `system:open-external`.

Nếu một nút cần channel chưa có handler thật, **không dựng nút giả và không sửa contract**. Ghi
`BLOCKED/UPDATE` vào nhật ký với channel còn thiếu để A tạo task backend riêng.

## Được sửa

- `app/src/renderer/**`: `VpsPage`, component/store/test mới cho panel, `App.tsx`, `DeployPage`
  và state điều hướng cần thiết để preselect VPS/app.
- `docs/tasks/board.md` và file này để cập nhật trạng thái/bằng chứng.

Ưu tiên tách component theo vùng (`fleet summary`, `server selector`, `overview`, `apps`,
`activity`) thay vì tiếp tục dồn toàn bộ vào `VpsPage.tsx`.

## Không được sửa

- `app/src/main/**`, `ml-service/**`, `collector/**`, `demo-apps/**`, migration và
  `docs/contracts/**`.
- Không thêm dependency; dùng Ant Design v5, Zustand/React và thư viện đã duyệt trong repo.
- Không làm web terminal/SSH terminal, file manager, firewall/port editor, DNS/SSL, package
  manager, user Linux, cron, process manager hoặc shell tùy ý.
- Không tự thêm start/stop/reboot VPS. `app:start`/`app:stop` đang có trong contract nhưng chưa có
  handler thật trên `main`; chỉ làm khi A mở task backend và bàn giao handler.
- Không làm chart monitoring/ML trong task này; phần đó thuộc TK-B8.

## Definition of Done

- [x] Bố cục master–detail và đủ ba tab `Tổng quan`, `Ứng dụng & deploy`, `Hoạt động`; panel dùng
      được ở kích thước cửa sổ Electron hiện tại, không tràn ngang ở 1280×720.
- [x] Fleet summary, tìm kiếm/lọc, chọn VPS và số app lấy từ typed IPC; không hard-code fixture trong
      production code.
- [x] Tổng quan VPS có đủ loading/empty/success/error và các hành động CRUD/check/install Docker
      hiện có vẫn hoạt động, không làm mất chẩn đoán của TK-B7.
- [x] App list có loading/empty/success/error; `Deploy ứng dụng mới` preselect đúng VPS và
      `Redeploy` preselect đúng VPS + app trong Deploy Wizard.
- [x] Hoạt động lọc đúng `vps_id`, không ló dữ liệu VPS trước trong lúc đổi selection; drawer hiển
      thị `detail_json` dạng key–value.
- [x] Hành động xoá/khác có rủi ro giữ confirm theo `docs/02`; mọi lỗi người dùng thấy bằng tiếng
      Việt, text mới đặt trong `strings.ts`.
- [x] Không import Node/Electron từ renderer, không thêm/sửa IPC contract, không thêm dependency.
- [x] Component test tối thiểu phủ: không có VPS; hai VPS online/offline; lỗi resource; chọn VPS;
      app empty/success; quick deploy preselect; activity success/error và đổi VPS không stale.
- [x] `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm exec prettier --check .` trong `app/`
      đều xanh.
- [x] Có ảnh hoặc video ngắn của ba tab với fixture/VPS thật đã che IP; board + nhật ký file này cập
      nhật trong cùng PR, trạng thái `CHỜ REVIEW`, không tự merge.

## Nhật ký

- ASSIGNED 20/08 — A giao B biến UI VPS hiện tại thành VPS Control Panel v1; chốt ba vùng
  Tổng quan / Ứng dụng & deploy / Hoạt động, dùng typed IPC hiện có và không mở rộng backend.
- START 21/08 — dựng panel theo ba lát: khung + Tổng quan → Ứng dụng & deploy → Hoạt động.
- UPDATE 24/08 — Xong giao diện toàn bộ panel: tab Database (9 channel `db:*` đã thiết kế trong
  `IpcInvokeMap`, chưa có handler — UI hiện lỗi trung thực), quét môi trường `vps:scan`
  (handler + scanService nằm ở nhánh riêng `feat/vps-env-scan`), tinh chỉnh: action bar đầu tab
  Tổng quan kèm nhãn hover native, header chi tiết bỏ khung, cột checkbox chọn VPS ghi id thật
  + đếm "N VPS selected" trên topbar. Gate: 172/172 test, lint 0 lỗi, typecheck xanh. Tiếp
  theo: commit UI trên `feat/ui-vps-control-panel`, commit backend scan trên `feat/vps-env-scan`,
  đồng bộ contract, mở PR.
- DONE 30/08 — PR #21 đã merge `main`; PR #22 merge scan môi trường SSH. Panel được dùng trong
  buổi demo cơ bản với giảng viên; baseline bàn giao 172/172 test, lint/typecheck xanh. Việc tiếp
  theo của B là TK-B4, không tiếp tục polish branch panel cũ.

## Lệnh tái hiện

```powershell
cd app
pnpm test
pnpm lint
pnpm typecheck
pnpm exec prettier --check .
pnpm dev
```

Trong app: mở **VPS** → chọn VM01/VM02 → lần lượt kiểm tra ba tab → bấm quick deploy và xác
nhận Deploy Wizard đã chọn đúng VPS/app.

## PR

- [#21 — VPS Control Panel v1](https://github.com/everestt2806/opspilot/pull/21) — merged.
- [#22 — environment scan over SSH](https://github.com/everestt2806/opspilot/pull/22) — merged.
