CREATE TABLE IF NOT EXISTS event_performances (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id, code)
);

CREATE TABLE IF NOT EXISTS direct_seats (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  performance_id TEXT NOT NULL REFERENCES event_performances(id) ON DELETE CASCADE,
  zone TEXT NOT NULL,
  row_label TEXT NOT NULL,
  seat_label TEXT NOT NULL,
  external_seat_ref TEXT,
  face_value NUMERIC(12, 2),
  x NUMERIC(12, 4),
  y NUMERIC(12, 4),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'issued', 'voided')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (performance_id, zone, row_label, seat_label)
);

CREATE TABLE IF NOT EXISTS direct_tickets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  performance_id TEXT NOT NULL REFERENCES event_performances(id) ON DELETE RESTRICT,
  seat_id TEXT NOT NULL REFERENCES direct_seats(id) ON DELETE RESTRICT,
  ticket_class TEXT NOT NULL,
  holder_name TEXT NOT NULL DEFAULT '',
  buyer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  price_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'verified', 'not_required', 'rejected')),
  payment_reference TEXT,
  status TEXT NOT NULL CHECK (status IN ('held', 'issued', 'checked_in', 'voided')),
  issued_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payment_verified_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payment_verified_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_performances_event ON event_performances (event_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_direct_seats_event_performance ON direct_seats (event_id, performance_id, status);
CREATE INDEX IF NOT EXISTS idx_direct_tickets_event ON direct_tickets (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_tickets_seat ON direct_tickets (seat_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_tickets_active_seat
  ON direct_tickets (seat_id)
  WHERE status IN ('held', 'issued', 'checked_in');
