-- TK: migrate observability — lưu lý do lỗi để hiện lại sau khi mở lại app.
ALTER TABLE migration_job ADD COLUMN error_message TEXT;
