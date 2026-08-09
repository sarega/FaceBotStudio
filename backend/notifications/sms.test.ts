import assert from "node:assert/strict";
import test from "node:test";

import { getSmsConfig } from "./sms";
import { sendWithCurrentSmsSender, NotificationDeliveryError } from "./outbox";

test("SMS stays disabled until both the feature flag and provider config exist", async () => {
  const config = getSmsConfig({ SMS_NOTIFICATION_ENABLED: "0" });
  assert.equal(config.ready, false);
  assert.equal(config.errorMessage, "SMS notifications are disabled");

  await assert.rejects(
    () => sendWithCurrentSmsSender({
      id: "ntf_1",
      channel: "sms",
      kind: "order.created",
      recipient: "0812345678",
      recipient_snapshot: "0812345678",
      related_type: "order",
      related_id: "ord_1",
      payload_json: JSON.stringify({ message: "hello" }),
      idempotency_key: "sms:ord_1",
      status: "processing",
      attempt_count: 1,
      available_at: "",
      queued_at: "",
      locked_at: null,
      locked_by: "worker",
      sent_at: null,
      last_error: null,
      provider: null,
      provider_message_id: null,
      updated_at: "",
    }),
    (error: unknown) => error instanceof NotificationDeliveryError && error.retryable === false,
  );
});
