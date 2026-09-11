# Sổ bàn giao và review — TK-A17

> C00 APPROVED 11/09: [review](tk-a17/review-c00.md), code `d4ec3be`, docs `23cd248`.
> C01 review-01 CHANGES_REQUESTED 11/09: [review](tk-a17/review-c01.md),
> code `66cbdab`, docs `f0b73aa`. Worker sửa C01; C02 chưa được mở.
> Mỗi chặng tạo handoff/review riêng trong `docs/tasks/tk-a17/`; không ghi đè lịch sử.

- Owner A solo; Worker đã bàn giao C01; Leader yêu cầu sửa tại review-01.
- Baseline code `683bfc6`; branch plan `plan/a17-demo-checkpoint`.
- Branch Worker đã tạo `feat/a17-demo-checkpoint`, có cập nhật kế hoạch 11/09; tiếp tục HEAD hiện tại.
- Chặng được approve: C00. C01 đang sửa findings; C08 bắt buộc, tách C08A/B/C, đều chưa bắt đầu.

## Sổ gate (Leader xác nhận verdict)

| Chặng | Worker outcome | Reviewed SHA | Verdict | Handoff/review |
| ----- | -------------- | ------------ | ------- | -------------- |
| C00   | READY_FOR_LOCAL_REVIEW | code `d4ec3be` / docs `23cd248` | APPROVED | [handoff](tk-a17/handoff-c00.md) / [review](tk-a17/review-c00.md) |
| C01   | READY_FOR_LOCAL_REVIEW | code `0d15eb5` / docs `pending-this-commit` | REVIEW_FIX_SUBMITTED | [handoff](tk-a17/handoff-c01.md) / [review](tk-a17/review-c01.md) |
| C02   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C03   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C04   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C05   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C06   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C07   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C08A  | NOT_STARTED    | —            | PENDING | Chưa có        |
| C08B  | NOT_STARTED    | —            | PENDING | Chưa có        |
| C08C  | NOT_STARTED    | —            | PENDING | Chưa có        |
| C09   | NOT_STARTED    | —            | PENDING | Chưa có        |

## Mẫu `handoff-cNN.md`

### Identity và phạm vi

- Chặng / outcome / branch / ngày thực hiện:
- Base SHA / code HEAD / docs HEAD (docs HEAD có thể báo ở terminal sau commit):
- Review chặng trước được kế thừa:
- Commit list và bullet tiếng Anh mô tả thay đổi:
- File đổi, lý do, scope ngoại lệ nếu có:
- Diff để reviewer chạy: `git diff <base>..<code-head> -- <paths>`.

### Bằng chứng

| Case ID                  | Command + cwd + runtime | Exit/count | PASS/FAIL/NOT_RUN | Evidence path |
| ------------------------ | ----------------------- | ---------- | ----------------- | ------------- |
| Điền từng case của chặng | Chưa chạy               | —          | NOT_RUN           | —             |

- Checklist DoD: từng checkbox map tới case/evidence, không chỉ ghi “all pass”.
- Live manifest đã bỏ secret: host/app/path/port/container/deployment IDs.
- Dữ liệu nguồn: seq/time range, counts, offset, duplicates, model/null state nếu áp dụng.
- UI: route/click path, viewport, screenshot và kết quả mong đợi/quan sát.
- Incident/recovery: fault/reset UTC, alert ID, current/runtime image, marker DB trước/sau.
- Tình trạng laptop/VPS sau test: app/collector/ML còn chạy, fault đã reset chưa.
- Blocker, giới hạn, phần NOT_RUN và điều kiện gỡ; không nhận test cũ làm kết quả mới.
- Untracked/stash không bị chạm. CHƯA PUSH — CHƯA PR — CHƯA MERGE.

### REVIEW-FIX (append mỗi vòng)

| Finding | Fix commit | Regression | Evidence | Reviewer xác nhận |
| ------- | ---------- | ---------- | -------- | ----------------- |
| Chưa có | —          | —          | —        | Chờ review        |

## Mẫu `review-cNN.md` — Leader điền

- Reviewed base/code SHA và kiểm tra có kế thừa chặng trước:
- Gate checked: source/diff, commands, live/UI evidence nào đã kiểm tra trực tiếp:
- Findings: ID `Cnn-Rm-xx`, BLOCKER/MAJOR/MINOR, file/line, trigger, expected/actual,
  cách tái hiện, fix/kiểm chứng cần có. Phân biệt evidence Worker và reviewer tự chạy.
- Verdict: APPROVED / CHANGES_REQUESTED / BLOCKED.
- Chặng tiếp được mở; C08A/B/C mỗi phần cần APPROVED trước phần tiếp.
- Nếu APPROVED: liệt kê hạn chế được chấp nhận, ảnh hưởng demo và nơi theo dõi.

## Gate cuối

- [ ] C00–C07 APPROVED đúng SHA được kế thừa.
- [ ] C08A/B/C APPROVED, live tự khôi phục không có manual/reset can thiệp trước proof.
- [ ] C09: full tests/build, hai rehearsal, ảnh/video/runbook có bằng chứng.
- [ ] Leader xác nhận DEMO_READY đúng SHA.
- [ ] Merge + DoD đủ bằng chứng mới đổi board HOÀN THÀNH.
- REVIEW-FIX 01 - 11/09/2026: C01 `C01-R1-01…06` closed at code `0d15eb5`; handoff outcome
  is `READY_FOR_LOCAL_REVIEW`. Evidence is `docs/evidence/tk-a17/c01/review-fix-01.md`.
  The original review SHA remains historical; C02 and later stages remain `NOT_RUN`.
