# M08 — Auto-rollback · Người A · Tuần 5

`app/src/main/monitor/auto-rollback.ts` — FR-E2, UC-07

## Mục tiêu
Khi phương pháp được tin cậy báo suy giảm đủ lâu, tự động rollback về version trước đó —
**trước khi** ngưỡng truyền thống kịp phản ứng. Đây là **màn 2 của buổi bảo vệ**.

## Đọc trước
- `docs/contracts/schema.sql` — `monitor_setting`, `alert.acted`
- `docs/contracts/ipc-contract.ts` — event `system:auto-rollback`
- `docs/prompts/m04-deploy-pipeline.md` — hàm `rollback()`

## Logic

```ts
export function shouldAutoRollback(ctx: {
  setting: MonitorSetting;
  consecutiveTriggered: number;     // số mẫu liên tiếp trusted_method đang triggered
  lastRollbackAt: string | null;
  now: string;
}): { rollback: boolean; reason: 'ok' | 'disabled' | 'not_enough' | 'cooldown' };
```

Rollback khi **cả ba** đúng:
1. `setting.auto_rollback === 1`
2. `consecutiveTriggered >= setting.rollback_consecutive` (mặc định 3) với **đúng**
   `setting.trusted_method`
3. Đã qua `cooldown_minutes` (mặc định 10) kể từ `last_rollback_at`

Khi kích hoạt:
1. Gọi `DeployPipeline.rollback(appId, deployment của version N−1)`
2. Cập nhật `alert.acted = 'rollback_auto'` cho alert đang mở của method đó
3. Ghi `action_log` (`action='rollback_auto'`) với chi tiết: method, score, số mẫu liên tiếp,
   version từ → tới
4. Cập nhật `monitor_setting.last_rollback_at`
5. Phát `system:auto-rollback` → renderer hiện **notification nổi bật, không tự tắt**
6. Vẽ **vạch đỏ đậm có nhãn** trên chart dashboard tại thời điểm đó

Bị chặn bởi cooldown → vẫn ghi `alert.acted = 'rollback_suppressed_cooldown'`. Số này có ý
nghĩa trong báo cáo (cho thấy cơ chế chống rollback lặp thực sự hoạt động).

## Ràng buộc an toàn

1. **`auto_rollback` mặc định TẮT.** Người dùng phải chủ động bật, và UI confirm 1 lớp có
   giải thích hậu quả. Lý do: rollback tự động trên hệ thống người khác đang dùng là hành vi
   nguy hiểm — mặc định phải an toàn.
2. **Không có version trước** (đang ở v1) → **không** rollback, chỉ cảnh báo và ghi
   `action_log` nêu rõ lý do.
3. Đang có deploy/migrate chạy trên cùng app → **không** rollback (khoá theo `app_id`).
4. Rollback thất bại → ghi `action_log` `status='failed'`, notification đỏ, **không thử lại
   tự động** (thử lại tự động khi đang hỏng dễ làm mọi thứ tệ hơn).
5. Cooldown tính từ **lần rollback thành công gần nhất**, lưu trong DB để sống sót qua restart app.

## Test — khó test tự nhiên, nên phải test chủ động

| Cách | Kỳ vọng |
|---|---|
| Chèn thủ công 3 dòng `score_sample` triggered cho `trusted_method` | Rollback kích hoạt |
| Chèn tiếp 3 dòng nữa ngay sau đó | **Không** rollback lần 2 (cooldown), `acted='rollback_suppressed_cooldown'` |
| `auto_rollback = 0` | Không rollback, chỉ có alert |
| App đang ở v1 | Không rollback, `action_log` ghi rõ lý do |
| Chạy `memory_leak` thật trên VPS | Rollback tự động sau ~3–5 phút, app hồi phục, `mem_mb` về mức nền |

## Định nghĩa xong
- [ ] 5 case trên đều đúng
- [ ] **Demo được trọn kịch bản màn 2:** chạy script leak → dashboard cho thấy score từng
      method tăng dần → vạch màu xuất hiện lần lượt → auto-rollback → `mem_mb` về bình thường,
      **trong khi vạch ngưỡng rule 90% chưa bị chạm**
- [ ] Toàn bộ chuỗi sự kiện tra lại được trong màn Lịch sử
- [ ] Bấm được số: từ `fault_start` đến lúc rollback là bao nhiêu giây, và rule đáng lẽ mất
      bao nhiêu giây — **đây chính là câu chốt lúc bảo vệ**
