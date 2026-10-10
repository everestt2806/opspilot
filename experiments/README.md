# Experiment harness

Các script trong thư mục này chỉ chạy trên lab/VPS thuộc quyền của nhóm. `load_gen.py` bắt buộc
target allowlist/private, giới hạn tối đa 50 RPS và 30 phút, đồng thời hỗ trợ kill-switch bằng
file `loadgen.stop`. Đây là bounded load test để sinh dữ liệu, không phải công cụ DDoS.

`manifest.py` lưu `protocol_version` riêng biệt với `feature_version`, git SHA, clock skew, sample count,
gap, null rate, fault/load parameters và hash các CSV. Parser `read_manifest()` hỗ trợ đọc dữ liệu cũ
trước pilot (tự fallback `legacy-pre-pilot` khi thiếu `protocol_version`). `analyze.py` chỉ đọc CSV export
và hỗ trợ grace sensitivity `{0,30,60,120}`; không đọc database sống và không tự thay đổi threshold/model.
