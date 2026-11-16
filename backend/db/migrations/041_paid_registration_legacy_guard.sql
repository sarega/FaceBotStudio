CREATE OR REPLACE FUNCTION block_paid_event_legacy_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM events WHERE id=NEW.event_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM paid_event_settings WHERE event_id=NEW.event_id) THEN
    RAISE EXCEPTION 'paid_registration_required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_paid_registration_legacy_guard BEFORE INSERT ON registrations
FOR EACH ROW EXECUTE FUNCTION block_paid_event_legacy_insert();

CREATE TRIGGER trg_paid_performance_legacy_guard BEFORE INSERT ON event_performances
FOR EACH ROW EXECUTE FUNCTION block_paid_event_legacy_insert();
