-- Durable per-admin, per-organization and per-event notification acknowledgement.
-- Never removes or changes paid_audit_events; read/archive are only presentation state.
CREATE TABLE IF NOT EXISTS admin_notification_preferences (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  read_before_ms BIGINT NOT NULL DEFAULT 0,
  imported_at_ms BIGINT,
  PRIMARY KEY (organization_id,user_id,event_id)
);
CREATE TABLE IF NOT EXISTS admin_notification_items (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  audit_id TEXT NOT NULL REFERENCES paid_audit_events(id) ON DELETE CASCADE,
  read_ms BIGINT,
  archived_ms BIGINT,
  PRIMARY KEY (organization_id,user_id,event_id,audit_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_notification_items_user
  ON admin_notification_items (organization_id,user_id,event_id);
