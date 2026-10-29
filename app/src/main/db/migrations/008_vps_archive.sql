-- Giữ app và lịch sử khi người dùng gỡ VPS khỏi danh sách.
-- Thêm lại đúng SSH host đã pin fingerprint sẽ kích hoạt lại bản ghi cũ.
ALTER TABLE vps ADD COLUMN archived_at TEXT;
ALTER TABLE vps ADD COLUMN archived_name TEXT;
CREATE INDEX idx_vps_archived_identity
  ON vps(host, port, host_fingerprint, archived_at);
