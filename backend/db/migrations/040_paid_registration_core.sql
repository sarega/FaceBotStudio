CREATE TABLE IF NOT EXISTS paid_event_settings (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE RESTRICT,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  hold_minutes INTEGER NOT NULL CHECK (hold_minutes > 0),
  cutoff_ms BIGINT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1))
);

CREATE TABLE IF NOT EXISTS paid_categories (
  event_id TEXT NOT NULL REFERENCES paid_event_settings(event_id) ON DELETE RESTRICT,
  id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(label) > 0),
  unit_minor INTEGER NOT NULL CHECK (unit_minor > 0),
  quota INTEGER CHECK (quota > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  PRIMARY KEY (event_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_paid_owner ON events (id, organizer_id);

CREATE TABLE IF NOT EXISTS paid_bookings (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL REFERENCES paid_event_settings(event_id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  contact_json TEXT NOT NULL,
  pricing_version INTEGER NOT NULL CHECK (pricing_version > 0),
  state TEXT NOT NULL CHECK (state IN ('awaiting_payment', 'verification_pending', 'confirmed', 'expired', 'cancelled', 'payment_exception')),
  payment_state TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_state IN ('unpaid', 'proof_submitted', 'verified', 'rejected', 'underpaid', 'refunded')),
  currency TEXT NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
  total_minor BIGINT NOT NULL CHECK (total_minor BETWEEN 1 AND 9007199254740991),
  due_ms BIGINT NOT NULL,
  created_ms BIGINT NOT NULL,
  updated_ms BIGINT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (event_id, id),
  FOREIGN KEY (event_id, organization_id) REFERENCES events(id, organizer_id) ON DELETE RESTRICT,
  CHECK (due_ms > created_ms),
  CHECK (state <> 'confirmed' OR payment_state = 'verified')
);

CREATE TABLE IF NOT EXISTS paid_attendees (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  category_id TEXT NOT NULL,
  category_label TEXT NOT NULL,
  unit_minor INTEGER NOT NULL CHECK (unit_minor > 0),
  first_name TEXT NOT NULL CHECK (length(first_name) > 0),
  last_name TEXT NOT NULL CHECK (length(last_name) > 0),
  contact_json TEXT NOT NULL DEFAULT '{}',
  cancelled_ms BIGINT,
  checked_in_ms BIGINT,
  UNIQUE (booking_id, ordinal),
  FOREIGN KEY (event_id, booking_id) REFERENCES paid_bookings(event_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (event_id, category_id) REFERENCES paid_categories(event_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS paid_command_keys (
  principal TEXT NOT NULL,
  event_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  command_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_ms BIGINT NOT NULL,
  PRIMARY KEY (principal, event_id, operation, command_key),
  FOREIGN KEY (event_id, booking_id) REFERENCES paid_bookings(event_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS paid_audit_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_state TEXT,
  next_state TEXT NOT NULL,
  reason TEXT,
  occurred_ms BIGINT NOT NULL,
  FOREIGN KEY (event_id, booking_id) REFERENCES paid_bookings(event_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_paid_bookings_due ON paid_bookings (event_id, state, due_ms);
CREATE INDEX IF NOT EXISTS idx_paid_bookings_owner ON paid_bookings (customer_id, created_ms);
CREATE INDEX IF NOT EXISTS idx_paid_attendees_category ON paid_attendees (event_id, category_id);
CREATE INDEX IF NOT EXISTS idx_paid_audit_booking ON paid_audit_events (booking_id, occurred_ms);
