# Việc tiếp theo sau PR #33/#34 — 05/11/2026

Nguồn đối chiếu: code checkpoint H2, [review tích hợp](tk-s7-pr33-pr34-integration-2026-11-05.md), [roadmap sản phẩm](../31-lo-trinh-hoan-thien-san-pham.md), board và evidence task cũ. Không đánh đồng merge code với nghiệm thu sản phẩm production. Deadline nộp theo repo: **20/11/2026**.

## Hiện đã có gì

| Phần | Đã có / giới hạn kiểm chứng |
|---|---|
| Desktop và deploy thủ công | UI mới, VPS/connect/recovery, nguồn thư mục hoặc Git, detector Next.js/Express/Vite, deploy/history/rollback có code và evidence lịch sử. Chưa chạy lại live demo trên bản tích hợp 05/11 |
| Product nền + L0/H1 | Poll Git, queue/lease/fence, snapshot SHA, pinned SSH/guard, truyền source/render/build; Docker readiness có live fixture. Chưa phải push-to-deploy khi desktop tắt |
| H2 checkpoint | Có runtime pipeline, collector build, C0 attribution, health exact CID, rollback và receipt/T1/ACK/T2/recovery. Full Vitest + Python, controlled target và exact-CID Docker health đã pass; full runtime pinned SSH/Docker/collector/crash matrix chưa có |
| HTTPS | Ingress/Caddy plan/installer/reconcile/probe/CAS, IPC và UI có code + lab/component evidence. Chưa nghiệm thu domain/certificate/public HTTPS thật trên VPS phù hợp |
| ML | Có feature pipeline, Z-score/EWMA, Isolation Forest, One-Class SVM/ensemble, HTTP train/inference/restart và monitor→ML→SQLite smoke. Mẫu normal data 150 train + 30 inference không phải kết quả fault pilot/đánh giá F1 |
| Migrate | Có backup/transfer/restore/verify/cancel code và lịch sử demo. Cần drill hai VPS + PostgreSQL/volume/config và failure/rollback trên bản hiện tại |

## Danh sách checkpoint cần làm

| ID / mức | Owner đề xuất | Làm gì / điều kiện nhận xong |
|---|---|---|
| N1 — P0: H2 integration CLI | Sơn / Worker core | CLI lab gọi pipeline thật qua pinned SSH + scratch SQLite + Docker + collector, không fake ở boundary cần chứng minh. Healthy v1→v2, build fail giữ v1/collector, health fail rollback, first failure, collector/restore fail; kiểm image/SHA/current pointer/metric bytes B0/R0 |
| N2 — P0: H2 recovery/ownership | Sơn sau N1 | Crash/disconnect/expired lease quanh seal/T1/ACK/idle/T2, exact-record/fence idempotency, không replay mutation. Rà Desktop monitor `reconcilePrepared` với Product ownership: không promote/abort Product C0 ngoài fenced finalization. Đủ gate mới bật executor |
| N3 — P0: ML pilot và số liệu | Kim / Worker ML, song song N1 | Xác nhận lại host/resources/clock/SSH/ML endpoint theo preflight, chạy pilot 75 phút theo protocol; giữ raw JSONL/SQLite/labels/model metadata/export. Sau pilot mới chạy ma trận chính thức và thống kê; không tạo số đo/accuracy giả |
| N4 — P0: Demo/release smoke | Kim / Worker delivery | Tạo bản demo từ main đã tích hợp; thử installer/native SQLite trên máy partner, không yêu cầu có Node. Kịch bản 7–10 phút, dữ liệu chuẩn bị sẵn; đo giờ và diễn tập tối thiểu 3 lần. Ghi rõ phần runtime/ML chưa live |
| N5 — P1: Always-on auto deploy | Sơn sau N1/N2 | Nối executor với queue/heartbeat, enrollment và credential provision an toàn, startup/restart service, authenticated management/ownership. Push khi Electron tắt phải tạo đúng một deployment theo SHA, history/status đồng bộ. CLI hiện `init/run/poll-once/status`, worker mặc định không có executor |
| N6 — P1: ML auto rollback | Sơn + Kim sau pilot | Monitor hiện có setting/trusted_method/cooldown nhưng chưa thấy đường service gọi rollback tự động. Nối alert→policy→app lock→rollback→verify→audit; test số lần liên tiếp/cooldown/no-loop và live fault. Phân biệt rollback do deploy health fail với rollback do ML |
| N7 — P1: HTTPS thật | Kim / Worker ingress, file riêng | VPS/hostname có quyền DNS, owner/firewall preflight, Caddy route; ACME staging trước production, external HTTPS probe. Kiểm cấp/gia hạn cert, lỗi route/cert và rollback; không coi DNS A record là HTTPS hoạt động |
| N8 — P1: Migrate hai VPS | Sơn / Worker migrate | App + PostgreSQL + volume/config; checksum/row counts/source giữ nguyên tới xác nhận; target health, cancellation, ngắt transfer/restore và rollback. Chạy cả app nguồn Git không phụ thuộc clone tạm |
| N9 — P1: Parity/template/operations | Worker sau core ổn | Product hiện chỉ Express không DB. Kiểm local/Git × ba template; source tests/build config; custom Dockerfile nếu giữ trong cam kết. Runtime logs/start-stop-restart/env/DB tab cần đối chiếu và triển khai task riêng: IPC hiện chỉ app list/get/versions/runtime-inspect/rollback, không tự nhận lifecycle/DB backend đã có |
| N10 — P2: Nợ chất lượng/tài liệu | Worker riêng | Full ESLint hiện 0 errors nhưng 5999 warnings; sửa theo module để tránh diff format khổng lồ. Đồng bộ FR/NFR/board lịch sử với SHA/evidence hiện tại, CI tự động cho Windows/Linux và installer. Không mở rộng Flask trước gate Tier 2 trong CLAUDE.md |

## Những việc cần đầu vào / hạ tầng

- Phiên review này **không truy cập VPS**. Evidence tháng 10 ghi host shared, dung lượng mục tiêu chưa đủ, clock/ML endpoint và provider metadata từng bị chặn; cần đo lại, không suy ra tình trạng VPS ngày 05/11 từ số liệu cũ.
- ML dùng CPU/scikit-learn; cần một môi trường đúng protocol, lưu state và dữ liệu bền. Không bắt buộc Colab/GPU. 50 runs × 75 phút là **62,5 giờ chạy thuần**, chưa tính setup/retry; phải dành thời gian chạy dữ liệu song song phát triển runtime.
- Migrate cần hai VPS phù hợp; HTTPS cần hostname/DNS/provider quyền hợp lệ. Chưa có hạ tầng thì task ghi BLOCKED/NOT_RUN, không thay bằng mock để nhận live PASS.
- Không dùng VPS đang chạy thí nghiệm để đồng thời thử deploy/migrate/firewall. Mỗi lab có run ID, port/resource/DB riêng và cleanup đúng ownership.

## Thứ tự và nhịp đề xuất tới 20/11

1. **05–08/11:** Sơn N1; Kim N3 preflight/pilot + N4 installer. Nếu ML preflight chặn, giải quyết hạ tầng ngay; không chờ H2 xong mới bắt đầu.
2. **09–12/11:** Sơn N2/N5 trong phạm vi đã qua gate; Kim thu dữ liệu/đánh giá ML, HTTPS hoặc migrate drill theo resource có thật. N6 có task riêng khi pilot sẵn sàng.
3. **13–16/11:** Chốt build demo, ma trận chức năng bắt buộc, lỗi recovery/installer, số liệu/biểu đồ và slide. Thời điểm này là mục tiêu, không tự cấp DEMO_READY.
4. **17–19/11:** Diễn tập 7–10 phút, sửa lỗi chặn demo, đóng hồ sơ/evidence và bản cài; không thêm kiến trúc/tính năng lớn vào build demo. Nhánh phát triển tiếp vẫn giữ backlog đầy đủ.
5. **20/11:** Bàn giao bản cài/source/report/dataset references và danh sách giới hạn trung thực.

Không cam kết toàn roadmap production sẽ hoàn tất trong 15 ngày. Demo chọn chức năng đã chạy trọn vòng và có bản chuẩn bị dự phòng; những phần thiếu tiếp tục được giữ thành checkpoint, không xóa khỏi yêu cầu.

## Cách chia việc song song

- Sơn giữ runtime/DB/guard/contract Product N1/N2/N5; một owner ghi mỗi file.
- Kim giữ ML experiments/evidence N3 và installer/demo task N4; fixture/tài nguyên riêng. Khi cần đổi monitor/DB dùng chung, chốt interface với owner core trước.
- Pull `main` mới và tạo nhánh task từ đó; không merge lại nhánh H1 local `0f27648` cũ hoặc nhánh đã được tích hợp. Mỗi task có dossier START, DoD, commands, SHA và gate; Leader review trước tích hợp.
- H2 còn PARTIAL không có nghĩa toàn bộ code bị bỏ; tiếp tục từ pipeline/repository/target hiện có, dùng failure evidence để sửa từng checkpoint. Không bật production executor bằng cách bỏ guard/receipt.
