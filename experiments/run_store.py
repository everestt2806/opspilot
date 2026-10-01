"""Module quản lý vòng đời bản ghi experiment_run và truy vấn dữ liệu pha A (TK-S6, P2a).

Tuân thủ nghiêm ngặt schema tại docs/contracts/schema.sql (bảng experiment_run và metric_sample).

CÁC NGUYÊN TẮC THIẾT KẾ VÀ RÀNG BUỘC:
1. Quy tắc Single Active Run (CLAUDE.md mục 9, docs/07 §7):
   Tại một thời điểm chỉ cho phép duy nhất một run có status='running'. Hàm start_run()
   kiểm tra trạng thái này trong transaction và từ chối (ném ActiveRunExistsError) nếu
   đã có run running, tránh xung đột tải và làm bẩn số liệu giữa các lần chạy.

2. Quản lý vòng đời run:
   - start_run(): Khởi tạo bản ghi với status='running', trả về run_id.
   - update_phase_schedule(): Ghi nhận các mốc pha (train_at_ts, fault_start_ts, fault_end_ts, train_sample_count).
   - complete_run(): Kết thúc run bình thường (status='completed') và ghi mốc run_end_ts.
   - abort_run(): Huỷ run bất thường (status='aborted') kèm lý do bắt buộc (abort_reason) và run_end_ts.

3. Truy vấn đếm mẫu Pha A (docs/07 §7.6):
   - count_phase_a_samples(): Đếm số dòng metric_sample theo deployment_id trong đúng cửa sổ
     nửa mở [baseline_start_ts, train_at_ts). Tuyệt đối không đếm gộp toàn bộ deployment để
     tránh dính mẫu rác cũ từ các lần thử nghiệm trước.

4. GIỚI HẠN SCHEMA HIỆN TẠI VÀ LƯU Ý CHO LEADER:
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
    baseline_start_ts: str | float | None = None,
    clock_offset_ms: int = 0,
    detection_grace_s: int = 60,
    fault_params_json: str | None = None,
    notes: str | None = None,
    auto_commit: bool = True,
) -> int:
    """Bắt đầu một run thí nghiệm mới ở trạng thái 'running'.

    Quy tắc Single Active Run: Kiểm tra trong transaction, từ chối ném ActiveRunExistsError
    nếu đã có bất kỳ bản ghi nào mang status='running'.

    Lưu ý: Nếu cặp (scenario, repeat_index) đã tồn tại trong DB (kể cả đã completed hay aborted),
    SQLite sẽ ném sqlite3.IntegrityError do ràng buộc UNIQUE(scenario, repeat_index) của schema v1.
    """
    if scenario not in VALID_SCENARIOS:
        raise ValueError(
            f"Kịch bản '{scenario}' không hợp lệ. Phải thuộc: {', '.join(VALID_SCENARIOS)}"
        )
    if not isinstance(repeat_index, int) or repeat_index < 1:
        raise ValueError("repeat_index phải là số nguyên >= 1")

    cur = conn.cursor()

    # 1. Kiểm tra Single Active Run
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

    # 2. Thêm bản ghi run mới
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
            str(baseline_start_ts) if baseline_start_ts is not None else None,
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


def update_phase_schedule(
    conn: sqlite3.Connection,
    run_id: int,
    train_at_ts: str | float | None = None,
    fault_start_ts: str | float | None = None,
    fault_end_ts: str | float | None = None,
    train_sample_count: int | None = None,
    baseline_start_ts: str | float | None = None,
    notes: str | None = None,
    auto_commit: bool = True,
) -> None:
    """Cập nhật các mốc thời gian pha và thông tin tiến trình của run."""
    cur = conn.cursor()
    cur.execute("SELECT id, status FROM experiment_run WHERE id = ?", (run_id,))
    row = cur.fetchone()
    if row is None:
        raise RunNotFoundError(f"Không tìm thấy experiment_run với id={run_id}")

    updates: list[str] = []
    params: list[Any] = []

    if train_at_ts is not None:
        updates.append("train_at_ts = ?")
        params.append(str(train_at_ts))
    if fault_start_ts is not None:
        updates.append("fault_start_ts = ?")
        params.append(str(fault_start_ts))
    if fault_end_ts is not None:
        updates.append("fault_end_ts = ?")
        params.append(str(fault_end_ts))
    if train_sample_count is not None:
        updates.append("train_sample_count = ?")
        params.append(int(train_sample_count))
    if baseline_start_ts is not None:
        updates.append("baseline_start_ts = ?")
        params.append(str(baseline_start_ts))
    if notes is not None:
        updates.append("notes = ?")
        params.append(str(notes))

    if updates:
        params.append(run_id)
        cur.execute(f"UPDATE experiment_run SET {', '.join(updates)} WHERE id = ?", params)
        if auto_commit:
            conn.commit()


def complete_run(
    conn: sqlite3.Connection,
    run_id: int,
    run_end_ts: str | float,
    notes: str | None = None,
    auto_commit: bool = True,
) -> None:
    """Đánh dấu run hoàn tất bình thường (status='completed') và ghi nhận run_end_ts."""
    if run_end_ts is None:
        raise ValueError("run_end_ts không được để trống khi hoàn tất run")

    cur = conn.cursor()
    cur.execute("SELECT id, status FROM experiment_run WHERE id = ?", (run_id,))
    row = cur.fetchone()
    if row is None:
        raise RunNotFoundError(f"Không tìm thấy experiment_run với id={run_id}")

    current_status = row[1] if not hasattr(row, "keys") else row["status"]
    if current_status != "running":
        raise InvalidRunStateError(
            f"Run id={run_id} đang ở trạng thái '{current_status}', không thể hoàn tất (chỉ 'running' mới có thể complete)"
        )

    if notes is not None:
        cur.execute(
            """
            UPDATE experiment_run
            SET status = 'completed', run_end_ts = ?, notes = ?
            WHERE id = ?
            """,
            (str(run_end_ts), str(notes), run_id),
        )
    else:
        cur.execute(
            """
            UPDATE experiment_run
            SET status = 'completed', run_end_ts = ?
            WHERE id = ?
            """,
            (str(run_end_ts), run_id),
        )

    if auto_commit:
        conn.commit()


def abort_run(
    conn: sqlite3.Connection,
    run_id: int,
    reason: str,
    run_end_ts: str | float | None = None,
    auto_commit: bool = True,
) -> None:
    """Huỷ run thí nghiệm (status='aborted') kèm lý do huỷ bắt buộc."""
    if not reason or not str(reason).strip():
        raise ValueError("Lý do abort (reason) là bắt buộc và không được để trống")

    cur = conn.cursor()
    cur.execute("SELECT id, status FROM experiment_run WHERE id = ?", (run_id,))
    row = cur.fetchone()
    if row is None:
        raise RunNotFoundError(f"Không tìm thấy experiment_run với id={run_id}")

    current_status = row[1] if not hasattr(row, "keys") else row["status"]
    if current_status != "running":
        raise InvalidRunStateError(
            f"Run id={run_id} đang ở trạng thái '{current_status}', không thể abort (chỉ 'running' mới có thể abort)"
        )

    cur.execute(
        """
        UPDATE experiment_run
        SET status = 'aborted', abort_reason = ?, run_end_ts = ?
        WHERE id = ?
        """,
        (
            str(reason).strip(),
            str(run_end_ts) if run_end_ts is not None else None,
            run_id,
        ),
    )

    if auto_commit:
        conn.commit()


def count_phase_a_samples(
    conn: sqlite3.Connection,
    deployment_id: int,
    baseline_start_ts: str | float,
    train_at_ts: str | float,
) -> int:
    """Đếm số mẫu metric_sample thuộc deployment_id trong cửa sổ Pha A [baseline_start_ts, train_at_ts).

    docs/07 §7.5 & §7.6:
    Chỉ các mẫu có ts_vps nằm trong khoảng [baseline_start_ts, train_at_ts) mới hợp lệ
    để tính số lượng mẫu huấn luyện. Không dùng SELECT COUNT(*) gộp toàn deployment
    để ngăn dính mẫu rác cũ.
    """
    if baseline_start_ts is None or train_at_ts is None:
        raise ValueError("baseline_start_ts và train_at_ts không được để trống")

    start_str = str(baseline_start_ts)
    end_str = str(train_at_ts)

    cur = conn.cursor()
    cur.execute(
        """
        SELECT COUNT(*)
        FROM metric_sample
        WHERE deployment_id = ?
          AND ts_vps >= ?
          AND ts_vps < ?
        """,
        (deployment_id, start_str, end_str),
    )
    row = cur.fetchone()
    return int(row[0]) if row else 0
