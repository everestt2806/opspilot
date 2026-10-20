# ML-READY-2 preflight evidence

Report được tạo bởi `experiments.run_experiment --preflight-only` trên profile clone LIVE-0 (`mode=ro`, `PRAGMA query_only=ON`) vào 20/10/2026 11:36:46 UTC. Profile/app/deployment selection đạt; app health GET trả HTTP 200. Profile có saved host-key pin nhưng không có credential handoff trong phiên, nên SSH key scan/authentication/resource command không chạy. ML URL không được chỉ định nên endpoint gate BLOCKED; runner không đoán cổng mặc định.

Kết quả tổng thể **BLOCKED**, không phải live SSH pass hay pilot readiness. Dữ liệu LIVE-0 trước đó ghi nhận VPS có 4 app/9 container và disk tổng 26.3 GB; yêu cầu dedicated host và target 40 GB vẫn chưa đạt. Không sửa profile nguồn, VPS, service, container, DNS, firewall hoặc app.

Report JSON không chứa credential, hostname/IP, fingerprint, stdout/stderr hay nội dung DB. Nó chỉ lưu ID bản ghi đã chọn, gate/reason, trạng thái health HTTP và cờ side-effect.

Report SHA-256: `38a9e3086e9df07bcfa1f56dd328ff9ea61a420ac9f7249f4b44b56eced23d77`.
