CREATE TABLE IF NOT EXISTS paid_payment_display (
 event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 bank_name TEXT NOT NULL DEFAULT '',
 account_name TEXT NOT NULL DEFAULT '',
 account_number TEXT NOT NULL DEFAULT '',
 qr_png_base64 TEXT NOT NULL DEFAULT '',
 updated_ms BIGINT NOT NULL
);
