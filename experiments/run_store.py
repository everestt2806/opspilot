"""Module quản lý vòng đời bản ghi experiment_run và truy vấn dữ liệu pha A (TK-S6, P2a).

Tuân thủ nghiêm ngặt schema tại docs/contracts/schema.sql (bảng experiment_run và metric_sample).

CÁC NGUYÊN TẮC THIẾT KẾ VÀ RÀNG BUỘC:
1. Quy tắc Single Active Run & Tính nguyên tử (Atomic Check-and-Create):
   Tại một thời điểm chỉ cho phép duy nhất một run có status='running'. Hàm start_run()
   bắt buộc mở transaction BEGIN IMMEDIATE để lấy khoá ghi tức thì trên SQLite, kiểm tra
   sự tồn tại của run đang running và nạp bản ghi mới trong cùng một transaction nguyên tử.
   - Nếu connection đang ở trong một transaction chưa hoàn tất (in_transaction=True), start_run()
     từ chối ngay (ném RunStoreError) vì không thể bảo đảm tính nguyên tử của BEGIN IMMEDIATE.
   - Nếu hai kết nối hoặc hai luồng cùng gọi start_run() đồng thời, một kết nối thành công và
     kết nối còn lại sẽ bị chặn/từ chối với ActiveRunExistsError, triệt tiêu hoàn toàn race condition.

2. Quản lý transaction minh bạch (Transaction Ownership):
   - update_phase_schedule(), complete_run(), abort_run() chỉ commit hoặc rollback transaction
     do chính hàm mở (khi caller chưa mở transaction trước đó trên connection).
   - Tuyệt đối không tự commit hoặc rollback các thay đổi chưa hoàn tất do caller tạo ra trước đó.
     Nếu caller đã ở trong transaction (in_transaction=True), toàn bộ quyền commit/rollback
     vẫn thuộc về caller.

3. Cập nhật trạng thái và mốc pha nguyên tử với điều kiện SQL (status='running'):
   - update_phase_schedule(), complete_run(), abort_run() đều sử dụng điều kiện:
     `WHERE id = ? AND status = 'running'`
     trực tiếp trong câu lệnh SQL UPDATE.
   - Cơ chế này ngăn chặn tuyệt đối việc ghi đè hoặc sửa đổi một run vừa kết thúc/bị huỷ
     ở một kết nối khác (tránh race condition giữa complete/abort/update).
   - Nếu rowcount == 0, hàm kiểm tra lại cơ sở dữ liệu để ném đúng lỗi RunNotFoundError
     (nếu run_id không tồn tại) hoặc InvalidRunStateError (nếu run không còn 'running').

4. Chuẩn hoá và so sánh mốc thời gian với độ chính xác đầy đủ (Microsecond Precision):
   - normalize_ts() chuẩn hoá mốc thời gian về định dạng ISO 8601 UTC (YYYY-MM-DDTHH:MM:SSZ hoặc
     có phần lẻ microsecond YYYY-MM-DDTHH:MM:SS.ffffffZ), chấp nhận epoch seconds (float/int do runner
     cung cấp), datetime object, hoặc chuỗi ISO.
   - to_epoch_seconds() chuyển đổi bất kỳ dạng timestamp nào sang epoch float đầy đủ.
   - count_phase_a_samples() so sánh mốc thời gian với độ chính xác thập phân đầy đủ (đến microsecond),
     không cắt/làm tròn phần lẻ trước khi lọc mẫu trong cửa sổ nửa mở [start, end),
     bảo đảm các mẫu tại đúng giây biên có phần thập phân được phân loại chính xác, kể cả khi
     đếm từ mốc đã lưu trong DB.

5. GIỚI HẠN SCHEMA HIỆN TẠI VÀ LƯU Ý CHO LEADER:
   Bảng experiment_run trong docs/contracts/schema.sql có ràng buộc:
       UNIQUE (scenario, repeat_index)
   Nếu một lần chạy bị 'aborted', bản ghi đó vẫn tồn tại trong SQLite và chiếm giữ cặp
   (scenario, repeat_index). Do đó, việc retry ngay kịch bản và lần lặp đó sẽ bị SQLite chặn
   (IntegrityError: UNIQUE constraint failed).
   Tại Checkpoint P2a, chúng ta KHÔNG tự ý thay đổi file docs/contracts/schema.sql.
   Giới hạn này được bảo toàn và ghi nhận để Tech Lead / Leader quyết định giải pháp
   (ví dụ: thêm cột attempt_index và đổi UNIQUE thành (scenario, repeat_index, attempt_index))
   ở các bước tiếp theo.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any

VALID_SCENARIOS = (
    "memory_leak",
    "cpu_spike",
    "error_burst",
    "slow_db",
    "latency_creep",
)

VALID_STATUSES = ("running", "completed", "aborted")


class RunStoreError(Exception):
    """Lỗi cơ sở cho các thao tác trong run_store."""


class ActiveRunExistsError(RunStoreError):
    """Ném ra khi cố khởi tạo run mới trong khi đang có run khác ở trạng thái 'running'."""


class RunNotFoundError(RunStoreError):
    """Ném ra khi không tìm thấy run_id yêu cầu."""


class InvalidRunStateError(RunStoreError):
    """Ném ra khi thao tác không hợp lệ với trạng thái hiện tại của run."""


def to_epoch_seconds(ts: str | float | datetime) -> float:
    """Chuyển đổi timestamp bất kỳ sang epoch seconds (float) với độ chính xác đầy đủ."""
    if ts is None:
        raise ValueError("Timestamp không được là None")

    if isinstance(ts, (int, float)):
        return float(ts)

    if isinstance(ts, datetime):
        dt = ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)
        return dt.timestamp()

    if isinstance(ts, str):
        s = ts.strip()
        if not s:
            raise ValueError("Timestamp chuỗi không được để trống")
        # Chuỗi số thuần biểu thị epoch (không chứa '-' ngày tháng hay ':' giờ phút)
        if "-" not in s and ":" not in s:
            try:
                return float(s)
            except ValueError:
                pass

        iso_str = s.replace("Z", "+00:00") if s.endswith("Z") else s
        try:
            dt = datetime.fromisoformat(iso_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except ValueError as err:
            raise ValueError(f"Không thể phân tích timestamp '{ts}': {err}") from err

    raise TypeError(f"Kiểu dữ liệu timestamp không được hỗ trợ: {type(ts)}")


def normalize_ts(ts: str | float | datetime) -> str:
    """Chuẩn hoá mốc thời gian về định dạng ISO 8601 UTC.

    Bảo tồn phần thập phân giây (microseconds) nếu có, hoặc giữ định dạng giây tròn nếu không có phần lẻ.
    """
    if ts is None:
        raise ValueError("Timestamp không được là None")

    if isinstance(ts, datetime):
        dt = ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)
        dt_utc = dt.astimezone(timezone.utc)
        if dt_utc.microsecond > 0:
            return dt_utc.isoformat(timespec="microseconds").replace("+00:00", "Z")
        return dt_utc.isoformat(timespec="seconds").replace("+00:00", "Z")

    if isinstance(ts, (int, float)):
        val = float(ts)
        dt_utc = datetime.fromtimestamp(val, tz=timezone.utc)
        if dt_utc.microsecond > 0:
            return dt_utc.isoformat(timespec="microseconds").replace("+00:00", "Z")
        return dt_utc.isoformat(timespec="seconds").replace("+00:00", "Z")

    if isinstance(ts, str):
        s = ts.strip()
        if not s:
            raise ValueError("Timestamp chuỗi không được để trống")
        if "-" not in s and ":" not in s:
            try:
                val = float(s)
                dt_utc = datetime.fromtimestamp(val, tz=timezone.utc)
                if dt_utc.microsecond > 0:
                    return dt_utc.isoformat(timespec="microseconds").replace("+00:00", "Z")
                return dt_utc.isoformat(timespec="seconds").replace("+00:00", "Z")
            except ValueError:
                pass

        iso_str = s.replace("Z", "+00:00") if s.endswith("Z") else s
        try:
            dt = datetime.fromisoformat(iso_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            dt_utc = dt.astimezone(timezone.utc)
            if dt_utc.microsecond > 0:
                return dt_utc.isoformat(timespec="microseconds").replace("+00:00", "Z")
            return dt_utc.isoformat(timespec="seconds").replace("+00:00", "Z")
        except ValueError as err:
            raise ValueError(f"Không thể phân tích timestamp '{ts}': {err}") from err

    raise TypeError(f"Kiểu dữ liệu timestamp không được hỗ trợ: {type(ts)}")


def _row_to_dict(cursor: sqlite3.Cursor, row: sqlite3.Row | tuple[Any, ...]) -> dict[str, Any]:
    if hasattr(row, "keys"):
        return dict(row)  # type: ignore[call-overload]
    return {col[0]: row[i] for i, col in enumerate(cursor.description)}


def get_active_run(conn: sqlite3.Connection) -> dict[str, Any] | None:
    """Lấy thông tin run đang chạy (status='running') nếu có."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT *
        FROM experiment_run
        WHERE status = 'running'
        ORDER BY id DESC
        LIMIT 1
        """
    )
    row = cur.fetchone()
    if row is None:
        return None
    return _row_to_dict(cur, row)


def get_run(conn: sqlite3.Connection, run_id: int) -> dict[str, Any] | None:
    """Lấy thông tin chi tiết của một run theo run_id."""
    cur = conn.cursor()
    cur.execute("SELECT * FROM experiment_run WHERE id = ?", (run_id,))
    row = cur.fetchone()
    if row is None:
        return None
    return _row_to_dict(cur, row)


def start_run(
    conn: sqlite3.Connection,
    scenario: str,
    repeat_index: int,
    deployment_id: int | None = None,
    vps_id: int | None = None,
    baseline_start_ts: str | float | datetime | None = None,
    clock_offset_ms: int = 0,
    detection_grace_s: int = 60,
    fault_params_json: str | None = None,
    notes: str | None = None,
    auto_commit: bool = True,
) -> int:
    """Bắt đầu một run thí nghiệm mới ở trạng thái 'running'.

    Quy tắc Single Active Run & Tính nguyên tử (Atomic Check-and-Create):
      - Nếu connection đang ở trong một transaction chưa commit/rollback (in_transaction=True),
        hàm từ chối ngay (ném RunStoreError) vì không thể mở BEGIN IMMEDIATE để bảo đảm tính nguyên tử.
      - Mở transaction BEGIN IMMEDIATE để lấy khoá ghi tức thì, ngăn chặn hiện tượng
        race condition khi hai kết nối SQLite cùng cố gắng khởi tạo run đồng thời.
      - Kiểm tra trong transaction xem đã có run nào running hay chưa; nếu có thì ném
        ActiveRunExistsError và rollback sạch sẽ.
      - Chuẩn hoá baseline_start_ts về định dạng ISO UTC (bảo tồn microsecond nếu có).

    Lưu ý: Nếu cặp (scenario, repeat_index) đã tồn tại trong DB (kể cả đã completed hay aborted),
    SQLite sẽ ném sqlite3.IntegrityError do ràng buộc UNIQUE(scenario, repeat_index) của schema v1.
    """
    if scenario not in VALID_SCENARIOS:
        raise ValueError(
            f"Kịch bản '{scenario}' không hợp lệ. Phải thuộc: {', '.join(VALID_SCENARIOS)}"
        )
    if not isinstance(repeat_index, int) or repeat_index < 1:
        raise ValueError("repeat_index phải là số nguyên >= 1")

    if conn.in_transaction:
        raise RunStoreError(
            "Không thể gọi start_run() khi connection đang ở trong transaction chưa hoàn tất (in_transaction=True). "
            "start_run() bắt buộc mở BEGIN IMMEDIATE để bảo đảm tính nguyên tử của quy tắc Single Active Run."
        )

    norm_baseline = normalize_ts(baseline_start_ts) if baseline_start_ts is not None else None

    conn.execute("BEGIN IMMEDIATE")

    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, scenario, repeat_index FROM experiment_run WHERE status = 'running' LIMIT 1"
        )
        active = cur.fetchone()
        if active is not None:
            active_id = active[0] if not hasattr(active, "keys") else active["id"]
            active_sc = active[1] if not hasattr(active, "keys") else active["scenario"]
            active_rep = active[2] if not hasattr(active, "keys") else active["repeat_index"]
            raise ActiveRunExistsError(
                f"Không thể bắt đầu run mới: đang có run đang chạy (id={active_id}, scenario='{active_sc}', repeat_index={active_rep})"
            )

        cur.execute(
            """
            INSERT INTO experiment_run (
                scenario, repeat_index, deployment_id, vps_id,
                baseline_start_ts, clock_offset_ms, detection_grace_s,
                fault_params_json, notes, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')
            """,
            (
                scenario,
                repeat_index,
                deployment_id,
                vps_id,
                norm_baseline,
                int(clock_offset_ms),
                int(detection_grace_s),
                fault_params_json,
                notes,
            ),
        )
        run_id = cur.lastrowid
        if run_id is None:
            raise RunStoreError("Không lấy được lastrowid sau khi insert experiment_run")

        if auto_commit:
            conn.commit()

        return int(run_id)
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise


def update_phase_schedule(
    conn: sqlite3.Connection,
    run_id: int,
    train_at_ts: str | float | datetime | None = None,
    fault_start_ts: str | float | datetime | None = None,
    fault_end_ts: str | float | datetime | None = None,
    train_sample_count: int | None = None,
    baseline_start_ts: str | float | datetime | None = None,
    notes: str | None = None,
    auto_commit: bool = True,
) -> None:
    """Cập nhật các mốc thời gian pha và thông tin tiến trình của run.

    Cập nhật nguyên tử với điều kiện SQL `status = 'running'`:
      - Từ chối cập nhật nếu run không còn ở trạng thái 'running' (ném InvalidRunStateError).
      - Quản lý transaction: chỉ commit/rollback khi transaction do chính hàm mở; không
        huỷ hoặc commit thay đổi có trước của caller trên cùng connection.
      - Mọi mốc thời gian đều được chuẩn hoá về ISO UTC bảo tồn độ chính xác.
    """
    caller_had_tx = conn.in_transaction
    updates: list[str] = []
    params: list[Any] = []

    if train_at_ts is not None:
        updates.append("train_at_ts = ?")
        params.append(normalize_ts(train_at_ts))
    if fault_start_ts is not None:
        updates.append("fault_start_ts = ?")
        params.append(normalize_ts(fault_start_ts))
    if fault_end_ts is not None:
        updates.append("fault_end_ts = ?")
        params.append(normalize_ts(fault_end_ts))
    if train_sample_count is not None:
        updates.append("train_sample_count = ?")
        params.append(int(train_sample_count))
    if baseline_start_ts is not None:
        updates.append("baseline_start_ts = ?")
        params.append(normalize_ts(baseline_start_ts))
    if notes is not None:
        updates.append("notes = ?")
        params.append(str(notes))

    cur = conn.cursor()
    if not updates:
        cur.execute("SELECT id, status FROM experiment_run WHERE id = ?", (run_id,))
        row = cur.fetchone()
        if not caller_had_tx and conn.in_transaction:
            conn.rollback()
        if row is None:
            raise RunNotFoundError(f"Không tìm thấy experiment_run với id={run_id}")
        current_status = row[1] if not hasattr(row, "keys") else row["status"]
        if current_status != "running":
            raise InvalidRunStateError(
                f"Run id={run_id} đang ở trạng thái '{current_status}', không thể cập nhật mốc pha (chỉ 'running' mới có thể cập nhật)"
            )
        return

    params.append(run_id)
    cur.execute(
        f"UPDATE experiment_run SET {', '.join(updates)} WHERE id = ? AND status = 'running'",
        params,
    )
    if cur.rowcount == 0:
        cur.execute("SELECT id, status FROM experiment_run WHERE id = ?", (run_id,))
        row = cur.fetchone()
        if not caller_had_tx and conn.in_transaction:
            conn.rollback()
        if row is None:
            raise RunNotFoundError(f"Không tìm thấy experiment_run với id={run_id}")
        current_status = row[1] if not hasattr(row, "keys") else row["status"]
        raise InvalidRunStateError(
            f"Run id={run_id} đang ở trạng thái '{current_status}', không thể cập nhật mốc pha (chỉ 'running' mới có thể cập nhật)"
        )

    if auto_commit and not caller_had_tx:
        conn.commit()


def complete_run(
    conn: sqlite3.Connection,
    run_id: int,
    run_end_ts: str | float | datetime,
    notes: str | None = None,
    auto_commit: bool = True,
) -> None:
    """Đánh dấu run hoàn tất bình thường (status='completed') và ghi nhận run_end_ts chuẩn ISO UTC.

    Cập nhật nguyên tử với điều kiện SQL `WHERE id = ? AND status = 'running'`.
    Chỉ commit/rollback khi transaction do chính hàm mở; không can thiệp transaction của caller.
    """
    if run_end_ts is None:
        raise ValueError("run_end_ts không được để trống khi hoàn tất run")

    caller_had_tx = conn.in_transaction
    norm_end = normalize_ts(run_end_ts)
    cur = conn.cursor()

    if notes is not None:
        cur.execute(
            """
            UPDATE experiment_run
            SET status = 'completed', run_end_ts = ?, notes = ?
            WHERE id = ? AND status = 'running'
            """,
            (norm_end, str(notes), run_id),
        )
    else:
        cur.execute(
            """
            UPDATE experiment_run
            SET status = 'completed', run_end_ts = ?
            WHERE id = ? AND status = 'running'
            """,
            (norm_end, run_id),
        )

    if cur.rowcount == 0:
        cur.execute("SELECT id, status FROM experiment_run WHERE id = ?", (run_id,))
        row = cur.fetchone()
        if not caller_had_tx and conn.in_transaction:
            conn.rollback()
        if row is None:
            raise RunNotFoundError(f"Không tìm thấy experiment_run với id={run_id}")
        current_status = row[1] if not hasattr(row, "keys") else row["status"]
        raise InvalidRunStateError(
            f"Run id={run_id} đang ở trạng thái '{current_status}', không thể hoàn tất (chỉ 'running' mới có thể complete)"
        )

    if auto_commit and not caller_had_tx:
        conn.commit()


def abort_run(
    conn: sqlite3.Connection,
    run_id: int,
    reason: str,
    run_end_ts: str | float | datetime | None = None,
    auto_commit: bool = True,
) -> None:
    """Huỷ run thí nghiệm (status='aborted') kèm lý do huỷ bắt buộc và run_end_ts chuẩn ISO UTC.

    Cập nhật nguyên tử với điều kiện SQL `WHERE id = ? AND status = 'running'`.
    Chỉ commit/rollback khi transaction do chính hàm mở; không can thiệp transaction của caller.
    """
    if not reason or not str(reason).strip():
        raise ValueError("Lý do abort (reason) là bắt buộc và không được để trống")

    caller_had_tx = conn.in_transaction
    norm_end = normalize_ts(run_end_ts) if run_end_ts is not None else None
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE experiment_run
        SET status = 'aborted', abort_reason = ?, run_end_ts = ?
        WHERE id = ? AND status = 'running'
        """,
        (
            str(reason).strip(),
            norm_end,
            run_id,
        ),
    )

    if cur.rowcount == 0:
        cur.execute("SELECT id, status FROM experiment_run WHERE id = ?", (run_id,))
        row = cur.fetchone()
        if not caller_had_tx and conn.in_transaction:
            conn.rollback()
        if row is None:
            raise RunNotFoundError(f"Không tìm thấy experiment_run với id={run_id}")
        current_status = row[1] if not hasattr(row, "keys") else row["status"]
        raise InvalidRunStateError(
            f"Run id={run_id} đang ở trạng thái '{current_status}', không thể abort (chỉ 'running' mới có thể abort)"
        )

    if auto_commit and not caller_had_tx:
        conn.commit()


def count_phase_a_samples(
    conn: sqlite3.Connection,
    deployment_id: int,
    baseline_start_ts: str | float | datetime,
    train_at_ts: str | float | datetime,
) -> int:
    """Đếm số mẫu metric_sample thuộc deployment_id trong cửa sổ Pha A [baseline_start_ts, train_at_ts).

    docs/07 §7.5 & §7.6:
    Chỉ các mẫu có ts_vps nằm trong khoảng nửa mở [baseline_start_ts, train_at_ts) mới hợp lệ.
    So sánh mốc thời gian với độ chính xác thập phân đầy đủ (đến microsecond), không cắt phần
    lẻ trước khi lọc mẫu, bảo đảm xử lý chính xác các trường hợp ranh giới có phần thập phân
    kể cả khi đọc từ mốc đã lưu.
    """
    if baseline_start_ts is None or train_at_ts is None:
        raise ValueError("baseline_start_ts và train_at_ts không được để trống")

    start_sec = to_epoch_seconds(baseline_start_ts)
    end_sec = to_epoch_seconds(train_at_ts)

    cur = conn.cursor()
    cur.execute(
        "SELECT ts_vps FROM metric_sample WHERE deployment_id = ?",
        (deployment_id,),
    )
    count = 0
    for row in cur.fetchall():
        ts_raw = row[0] if not hasattr(row, "keys") else row["ts_vps"]
        if ts_raw is not None:
            sample_sec = to_epoch_seconds(ts_raw)
            if start_sec <= sample_sec < end_sec:
                count += 1
    return count
