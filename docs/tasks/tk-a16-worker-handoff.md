# BIÊN BẢN BÀN GIAO WORKER — TK-A16

> Worker phải điền file này trước khi kết thúc phiên. Không xóa tiêu đề hoặc mục bắt buộc. Nếu
> chưa có dữ liệu, ghi `CHƯA ĐẠT` kèm lý do; không để trống và không tự tuyên bố hoàn thành.

| Trường | Giá trị Worker điền |
|---|---|
| Trạng thái | `ĐANG LÀM` |
| Worker | GPT-5.6 Luna · Medium Effort |
| Reviewer | Codex/root |
| Branch | `feat/m06-monitor-poller-rule` |
| Baseline | `Worker ghi HEAD khi bắt đầu (phải >= 7057d42)` |
| Head local | `CHƯA CÓ` |
| Remote/PR | `CHƯA PUSH — CHƯA MỞ PR` |
| Thời gian bắt đầu/kết thúc | `CHƯA ĐIỀN` |

## 1. Kết luận

- Outcome: `CHƯA BÀN GIAO | READY_FOR_LOCAL_REVIEW | BLOCKED`.
- Tóm tắt phần đã hoàn thành: `CHƯA ĐIỀN`.
- Phần cố ý không làm theo scope: `CHƯA ĐIỀN`.
- Điều kiện còn thiếu để đạt DoD: `CHƯA ĐIỀN`.

## 2. Commit cục bộ theo checkpoint

| Checkpoint | Commit | Nội dung chính | Test ngay checkpoint | Kết quả |
|---|---|---|---|---|
| CP1 | `CHƯA CÓ` | Ingest/offset/repository | `CHƯA CHẠY` | `CHƯA ĐẠT` |
| CP2 | `CHƯA CÓ` | Rule/alert lifecycle | `CHƯA CHẠY` | `CHƯA ĐẠT` |
| CP3 | `CHƯA CÓ` | ML/IPC | `CHƯA CHẠY` | `CHƯA ĐẠT` |
| CP4 | `CHƯA CÓ` | Scheduler/CLI/handoff | `CHƯA CHẠY` | `CHƯA ĐẠT` |

Khoảng diff reviewer cần đọc: `CHƯA_CÓ_BASELINE..CHƯA_CÓ_HEAD`.

## 3. File đã thay đổi

| File/thư mục | Lý do thay đổi | Thuộc CP |
|---|---|---|
| `CHƯA ĐIỀN` | `CHƯA ĐIỀN` | `CP?` |

Xác nhận không sửa ngoài scope: `CHƯA XÁC NHẬN`.

## 4. Bằng chứng test

Ghi đúng command đã chạy, không chỉ ghi tên gate.

| Thời điểm | Môi trường | Lệnh | Exit code | Kết quả/số test |
|---|---|---|---:|---|
| `CHƯA ĐIỀN` | `Node/Python/OS chưa điền` | `CHƯA CHẠY` | `-` | `CHƯA ĐẠT` |

Gate cuối bắt buộc:

- [ ] `cd app && pnpm test`
- [ ] `cd app && pnpm lint`
- [ ] `cd app && pnpm typecheck`
- [ ] `cd app && pnpm exec prettier --check .`
- [ ] `cd app && pnpm build`

## 5. Đối chiếu Definition of Done

Worker copy từng mục DoD từ `tk-a16-m6-poller-rule.md` vào đây, đánh dấu `[x]` chỉ khi có bằng chứng
ở mục 2 hoặc 4. Mục chưa đạt phải giữ `[ ]` và ghi nguyên nhân.

- [ ] `CHƯA ĐỐI CHIẾU`.

## 6. Giới hạn, rủi ro và quyết định kỹ thuật

- Crash-window/transaction còn lại: `CHƯA ĐIỀN`.
- Hành vi khi ML down/not-ready: `CHƯA ĐIỀN`.
- Hành vi partial/corrupt/duplicate/rotate: `CHƯA ĐIỀN`.
- Khôi phục alert sau restart: `CHƯA ĐIỀN`.
- Warning hoặc giới hạn chưa xử lý: `CHƯA ĐIỀN`.
- Thay đổi contract/dependency: `KHÔNG`; nếu khác, dừng và ghi `BLOCKED`.

## 7. Lệnh tái hiện cho reviewer

```powershell
# Worker thay phần này bằng lệnh chạy được từ repository root.
```

Fixture/dữ liệu cần dùng: `CHƯA ĐIỀN`.

## 8. Điểm đề nghị reviewer kiểm tra mạnh

1. `CHƯA ĐIỀN`.
2. `CHƯA ĐIỀN`.
3. `CHƯA ĐIỀN`.

## 9. Xác nhận Git và an toàn

- [ ] Chỉ commit cục bộ trên `feat/m06-monitor-poller-rule`.
- [ ] Chưa `git push`, chưa mở PR và chưa merge.
- [ ] Không force-push/reset-hard/clean/rebase/drop-pop stash.
- [ ] Không stage `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png`, secret, DB hoặc runtime state.
- [ ] `git status` và `git diff --stat <baseline>..HEAD` đã được ghi lại trong bàn giao.

## 10. Lịch sử review

Reviewer điền; Worker không tự sửa kết luận review.

| Lần | Reviewer | Kết luận | Finding | Commit sửa |
|---|---|---|---|---|
| 1 | Codex/root | `CHƯA REVIEW` | `—` | `—` |
