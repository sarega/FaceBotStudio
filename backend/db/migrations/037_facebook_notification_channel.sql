ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;

ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('email', 'sms', 'facebook'));
