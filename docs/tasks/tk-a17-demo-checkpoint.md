# TK-A17 — Điều phối Worker và review từng chặng

| Chủ    | Branch plan                | Baseline code | Trạng thái                  |
| ------ | -------------------------- | ------------- | --------------------------- |
| A solo | `plan/a17-demo-checkpoint` | `683bfc6`     | TUẦN NÀY — C00 chưa bắt đầu |

[Plan tổng](../24-ke-hoach-demo-theo-chang.md) · [Prompt](../prompts/tk-a17-worker.md)
· [Sổ bàn giao](tk-a17-worker-handoff.md).
Hướng dẫn thực thi: [Worker playbook](../prompts/tk-a17-worker-playbook.md).
Mục tiêu: A trình chiếu **tự phát hiện → tự rollback → xác minh phục hồi**. C08 bắt buộc.
Không chia theo ngày/giờ công. Thời lượng 10s/30s/baseline/test vẫn giữ theo yêu cầu kỹ thuật.

## 1. File giao theo thứ tự

| Chặng | Phụ thuộc APPROVED | File                                  | Phạm vi review                                 |
| ----- | ------------------ | ------------------------------------- | ---------------------------------------------- |
| C00   | Không              | [c00](tk-a17/c00-baseline.md)         | Môi trường và target                           |
| C01   | C00                | [c01](tk-a17/c01-collector-deploy.md) | Deploy/collector                               |
| C02   | C01                | [c02](tk-a17/c02-ingestion.md)        | SSH/SQLite, lifecycle deployment               |
| C03   | C02                | [c03](tk-a17/c03-ml-runtime.md)       | ML runtime                                     |
| C04   | C03                | [c04](tk-a17/c04-demo-experience.md)  | Website nghiệp vụ demo                         |
| C05   | C04                | [c05](tk-a17/c05-monitor-ui.md)       | Monitor chỉ đọc                                |
| C06   | C05                | [c06](tk-a17/c06-incident-flow.md)    | Alert/settings/fault/before-after              |
| C07   | C06                | [c07](tk-a17/c07-recovery.md)         | Versions/rollback/history                      |
| C08   | C07                | [c08](tk-a17/c08-auto-rollback.md)    | Bắt buộc: C08A → C08B → C08C, review từng phần |
| C09   | C08C APPROVED      | [c09](tk-a17/c09-demo-acceptance.md)  | Nghiệm thu toàn luồng tự khôi phục             |

Worker chỉ code một chặng mỗi lượt, không tự chạy cả bảng. B6/B8/S4 là scope trong A17,
không mở task ĐANG LÀM song song. Mỗi chặng có file chi tiết gồm đầu vào, việc làm, file được
sửa, test, DoD, evidence, trọng tâm review và điểm dừng. C08A/B/C cũng dừng review riêng.

## 2. Đọc trước và quyền thực hiện

1. Đọc `CLAUDE.md`, `docs/tasks/README.md`, board, plan tổng, file này, sổ bàn giao và
   đúng chặng. Đọc thêm contract/spec mà chặng chỉ ra trước sửa code.
2. Worker tạo `feat/a17-demo-checkpoint` từ HEAD nhánh plan chứa hồ sơ mới nhất. Nhánh đã
   có thì tiếp tục HEAD hiện tại; không tạo từ main cũ bỏ mất tài liệu/rewrite lịch sử.
3. Ghi base SHA trước sửa, chặng trước đã approve và reviewed SHA được kế thừa.
4. Được sửa/test/commit local. Commit/comment kỹ thuật tiếng Anh theo yêu cầu A; UI/docs
   tiếng Việt. Không push/PR/merge/spawn subagent; giữ untracked/stash của A.
5. A nhận scope B6/B8 để làm solo. Không migrate, detector breadth, redesign shell/title bar,
   thí nghiệm chính thức, thêm dependency/LLM API. Tái dùng AntD/Recharts/services/IPC.
6. Contract thắng. Mismatch chặn thật: lập proposal cụ thể/ảnh hưởng cho Leader trước đổi;
   schema cần migration mới. Không thêm `error_rate_source` từ bản RC đề xuất cũ.
7. GitNexus context/impact hỗ trợ core review nếu khả dụng; xác nhận source trực tiếp.
   Công cụ lỗi thì ghi hạn chế, dùng rg và tiếp tục trong scope.

## 3. Quy trình review mỗi chặng

1. Worker START, code/test đúng file chặng. Commit theo thay đổi có nghĩa, tránh một commit
   trộn backend/UI/model. Code sẵn đã đúng thì kiểm chứng, không viết lại cho có diff.
2. Tạo `docs/tasks/tk-a17/handoff-cNN.md`; evidence vào `docs/evidence/tk-a17/cNN/`.
   Ghi base/code HEAD, commands/cwd/runtime/exit/count/raw log, proof UI/VPS và việc chưa xong.
3. Update task log/board/sổ bàn giao. Gửi A kết quả READY_FOR_LOCAL_REVIEW hoặc BLOCKED rồi dừng.
4. Leader tạo `docs/tasks/tk-a17/review-cNN.md`: reviewed SHA, finding ID, severity,
   file/line, trigger, expected/actual, regression yêu cầu, verdict và chặng được mở tiếp.
5. Worker sửa ở HEAD hiện tại, append REVIEW-FIX: finding → commit → regression → evidence.
   Leader đóng finding; Worker không tự approve. Không code chặng sau trong lúc chờ review.
6. Chặng cũ phát sinh regression: mở lại review của chặng gốc, kiểm tra downstream bị ảnh hưởng.
   Không gọi “baseline” để bỏ qua lỗi khi chưa chứng minh trên baseline tương ứng.

Severity findings: BLOCKER/MAJOR/MINOR (khác ưu tiên feature P0/P1). BLOCKER/MAJOR về đúng
đắn, dữ liệu, secret hoặc demo phải đóng trước APPROVED. CHANGES_REQUESTED thì sửa cùng chặng;
BLOCKED cần bằng chứng và điều kiện gỡ. Chỉ C09 có verdict DEMO_READY.

## 4. Gate chung

- C00 ghi Node 22/pnpm/Python venv/native ABI thực tế. C01–C08 chạy test liên quan và scoped
  format/lint/typecheck khi đổi TS; Python đổi chạy suite liên quan. Build/smoke theo file chặng.
- C09 chạy full suite tuần tự Node 22 và build. Không skip test hay tăng timeout hàng loạt.
  Process treo: thu log/chẩn đoán rồi dừng đúng process mình tạo, ghi FAIL, không báo pass
  vì mới “transform complete”. Reviewer và Worker ghi kết quả riêng theo SHA.
- Fixture test được mock để kiểm tra logic; evidence demo/live không được mock. Screenshot
  placeholder không phải bằng chứng PASS. Không hiển thị số giả hoặc spinner có delay giả.
- Mọi trạng thái/summary trước-sau phải có nguồn dữ liệu, đơn vị, time window, null/stale policy.
  Không suy “đã phục hồi” chỉ vì lệnh rollback trả ID hoặc timestamp mới.

## 5. VPS và artifact

C00 read-only. Từ C01 deploy app demo riêng theo manifest đã kiểm tra, tạo record bằng service
thật. Không sửa app B, không reset toàn VPS/SQLite/experiment; không ghi secret vào git/log.
Thiếu credential thì báo blocker cụ thể, không yêu cầu paste secret trong chat. Chuẩn bị docs/
test plan được tiếp tục; không vượt live gate. Reset/xoá cần yêu cầu reset riêng của A theo
manifest; helper phục hồi fault của chính lượt test được thực hiện theo scope chặng.

## 6. Nhật ký

- START 10/09 — Leader lập plan theo `main@683bfc6`, chưa code/test runtime mới.
- UPDATE 10/09 — Source/merge: Monitor UI thiếu, Apps/Versions còn mock, compose thiếu
  collector; B6 report `dfc0ed7` chưa thuộc main. Shell Node `v24.16.0`, C00 cần Node 22.
- UPDATE 10/09 — Theo yêu cầu A, thay lịch ngày/G0–G3 bằng C00–C09 có review độc lập.
  Bổ sung website nghiệp vụ demo, màn tình trạng dễ hiểu, timeline/so sánh trước-sau;
  M8 tùy chọn theo readiness. Chưa có chặng PASS.

- UPDATE 10/09 — A xác nhận tự thao tác/trình chiếu, cần bước tiến chức năng lớn: nâng C08
  thành bắt buộc, tách C08A/B/C và thêm playbook thi công. Ghi chú “tùy chọn” trước đó chỉ
  là lịch sử. Chưa implementation/test runtime mới.

Worker append START/UPDATE/HANDOFF-LOCAL/REVIEW-FIX với ngày thực tế để giữ lịch sử.
Chờ review: board CHỜ REVIEW kèm ID chặng. Tiếp tục/sửa: ĐANG LÀM.
HOÀN THÀNH chỉ sau merge và đủ DoD; DEMO_READY không cấp quyền push/merge.
