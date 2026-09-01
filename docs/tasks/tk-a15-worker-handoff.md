# BIÊN BẢN BÀN GIAO WORKER — TK-A15

> Worker điền đủ trước khi dừng. Không tự tuyên bố `HOÀN THÀNH`; reviewer quyết định
> `READY_FOR_LOCAL_REVIEW`, A quyết định push/PR/merge.

| Trường       | Giá trị                     |
| ------------ | --------------------------- |
| Outcome      | `CHƯA BÀN GIAO`             |
| Branch       | `feat/m04-deploy-hardening` |
| Baseline     | `d40afc9`                   |
| Code head    | `CHƯA CÓ`                   |
| Handoff head | `CHƯA CÓ`                   |
| Remote/PR    | `CHƯA PUSH — CHƯA MỞ PR`    |

## 1. Commit CP1–CP4

| CP  | Commit    | Finding/invariant           | Test tại checkpoint |
| --- | --------- | --------------------------- | ------------------- |
| CP1 | `CHƯA CÓ` | rollback truthful           | `CHƯA CHẠY`         |
| CP2 | `CHƯA CÓ` | image retention + port      | `CHƯA CHẠY`         |
| CP3 | `CHƯA CÓ` | diagnostic + retry boundary | `CHƯA CHẠY`         |
| CP4 | `CHƯA CÓ` | docs/gate/handoff           | `CHƯA CHẠY`         |

## 2. File thay đổi và ngoài scope

- File đổi: `CHƯA CÓ`.
- Ngoài scope xác nhận không chạm: `CHƯA XÁC NHẬN`.

## 3. Evidence test

| Môi trường | Command                   | Exit | Kết quả     |
| ---------- | ------------------------- | ---: | ----------- |
| Node 22    | focused deploy/repository |    — | `CHƯA CHẠY` |
| Node 22    | lint                      |    — | `CHƯA CHẠY` |
| Node 22    | typecheck                 |    — | `CHƯA CHẠY` |
| Node 22    | scoped Prettier           |    — | `CHƯA CHẠY` |
| Node 22    | build                     |    — | `CHƯA CHẠY` |
| Node 22    | full test verbose         |    — | `CHƯA CHẠY` |
| VM01 smoke | chỉ khi A cho phép        |    — | `CHƯA CHẠY` |

## 4. Đối chiếu DoD

Copy từng checkbox mục 7 của task packet vào đây và gắn bằng chứng commit/test. Mục chưa đạt giữ
`[ ]`, không đổi nghĩa hoặc tự hạ tiêu chuẩn.

## 5. Rủi ro/giới hạn

- `CHƯA GHI`.

## 6. Lệnh tái hiện

```powershell
# Worker điền exact command đã chạy
```

## 7. Lịch sử review

| Vòng | Reviewer   | Kết luận      | Finding | Commit sửa |
| ---- | ---------- | ------------- | ------- | ---------- |
| —    | Codex/root | `CHƯA REVIEW` | —       | —          |

## 8. Xác nhận Git

- [ ] Chỉ stage file trong scope.
- [ ] Không chạm untracked/stash của user.
- [ ] Chưa push, chưa mở PR, chưa merge.
