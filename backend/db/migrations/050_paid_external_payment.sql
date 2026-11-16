ALTER TABLE paid_event_settings ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'promptpay' CHECK (payment_mode IN ('promptpay','external_manual'));
