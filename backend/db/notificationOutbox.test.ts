import assert from "node:assert/strict";
import test from "node:test";

import { dispatchNotificationDeliveries, NotificationDeliveryError } from "../notifications/outbox";
import { SqliteAppDatabase } from "./sqliteAdapter";

function readDelivery(db: SqliteAppDatabase, id: string) {
  const sqlite = db as unknown as {
    db: { prepare: (sql: string) => { get: (...params: unknown[]) => unknown } };
  };
  return sqlite.db.prepare("SELECT * FROM notification_deliveries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
}

function notificationInput(idempotencyKey: string) {
  return {
    channel: "email" as const,
    kind: "order.created",
    recipient: "buyer@example.com",
    recipient_snapshot: "buyer@example.com",
    related_type: "order",
    related_id: "ord_123",
    payload_json: JSON.stringify({ subject: "Order created", text: "Your order is ready", html: "<p>Your order is ready</p>" }),
    idempotency_key: idempotencyKey,
  };
}

function facebookNotificationInput(idempotencyKey: string) {
  return {
    channel: "facebook" as const,
    kind: "facebook.inbound.reply",
    recipient: "psid_123",
    recipient_snapshot: JSON.stringify({ page_id: "page_123", recipient_id: "psid_123" }),
    related_type: "facebook_outbound",
    related_id: idempotencyKey,
    payload_json: JSON.stringify({
      type: "text",
      page_id: "page_123",
      recipient_id: "psid_123",
      text: "Hello",
    }),
    idempotency_key: idempotencyKey,
    provider: "facebook_graph",
  };
}

test("notification outbox deduplicates and enforces worker ownership across retry and success", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();

  const first = await db.enqueueNotificationDelivery(notificationInput("order-created:ord_123"));
  assert.ok(first);
  assert.equal(first.status, "queued");
  assert.equal(first.attempt_count, 0);
  assert.equal(await db.enqueueNotificationDelivery(notificationInput("order-created:ord_123")), null);

  const claimedByA = await db.claimNotificationDeliveries("worker-a");
  assert.equal(claimedByA.length, 1);
  assert.equal(claimedByA[0].status, "processing");
  assert.equal(claimedByA[0].attempt_count, 1);
  assert.deepEqual(await db.claimNotificationDeliveries("worker-b"), []);

  await db.markNotificationDeliveryRetryable(first.id, "worker-b", "wrong owner", "2000-01-01T00:00:00.000Z");
  assert.equal(readDelivery(db, first.id)?.status, "processing");

  await db.markNotificationDeliveryRetryable(first.id, "worker-a", "provider timeout", "2000-01-01T00:00:00.000Z");
  const claimedByB = await db.claimNotificationDeliveries("worker-b");
  assert.equal(claimedByB.length, 1);
  assert.equal(claimedByB[0].attempt_count, 2);

  await db.markNotificationDeliverySent(first.id, "worker-b", "msg_123", "resend");
  assert.deepEqual(await db.claimNotificationDeliveries("worker-c"), []);
  assert.equal(readDelivery(db, first.id)?.status, "sent");
  assert.equal(readDelivery(db, first.id)?.provider_message_id, "msg_123");
});

test("notification dispatcher retries transient failures and stops on permanent failures", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const delivery = await db.enqueueNotificationDelivery(notificationInput("order-created:retry"));
  assert.ok(delivery);

  const retry = await dispatchNotificationDeliveries(
    db,
    "worker-retry",
    async () => { throw new Error("provider timeout"); },
    { maxAttempts: 2, baseBackoffMs: 1_000, maxBackoffMs: 1_000, now: () => 0 },
  );
  assert.deepEqual(retry, { claimed: 1, sent: 0, retried: 1, failed: 0 });
  assert.equal(readDelivery(db, delivery.id)?.status, "queued");
  assert.equal(readDelivery(db, delivery.id)?.attempt_count, 1);

  const failed = await dispatchNotificationDeliveries(
    db,
    "worker-retry",
    async () => { throw new NotificationDeliveryError("invalid template", false); },
    { maxAttempts: 2 },
  );
  assert.deepEqual(failed, { claimed: 1, sent: 0, retried: 0, failed: 1 });
  assert.equal(readDelivery(db, delivery.id)?.status, "failed");
  assert.equal(readDelivery(db, delivery.id)?.last_error, "invalid template");
});

test("notification dispatcher records provider success and message id", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const delivery = await db.enqueueNotificationDelivery(notificationInput("order-created:success"));
  assert.ok(delivery);

  const result = await dispatchNotificationDeliveries(
    db,
    "worker-success",
    async (claimed) => {
      assert.equal(claimed.recipient, "buyer@example.com");
      return { provider: "test-provider", providerMessageId: "provider-msg-1" };
    },
  );
  assert.deepEqual(result, { claimed: 1, sent: 1, retried: 0, failed: 0 });
  assert.equal(readDelivery(db, delivery.id)?.status, "sent");
  assert.equal(readDelivery(db, delivery.id)?.provider, "test-provider");
  assert.equal(readDelivery(db, delivery.id)?.provider_message_id, "provider-msg-1");
});

test("notification outbox accepts Facebook deliveries without changing retry ownership", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const delivery = await db.enqueueNotificationDelivery(facebookNotificationInput("facebook:reply:1"));
  assert.ok(delivery);
  assert.equal(delivery.channel, "facebook");

  const result = await dispatchNotificationDeliveries(
    db,
    "worker-facebook",
    async (claimed) => {
      assert.equal(claimed.channel, "facebook");
      assert.equal(JSON.parse(claimed.payload_json).recipient_id, "psid_123");
      return { provider: "facebook_graph", providerMessageId: "mid.123" };
    },
  );

  assert.deepEqual(result, { claimed: 1, sent: 1, retried: 0, failed: 0 });
  assert.equal(readDelivery(db, delivery.id)?.status, "sent");
  assert.equal(readDelivery(db, delivery.id)?.provider_message_id, "mid.123");
});

test("default notification sender never misroutes Facebook payloads through email", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const delivery = await db.enqueueNotificationDelivery(facebookNotificationInput("facebook:unsupported:1"));
  assert.ok(delivery);

  const result = await dispatchNotificationDeliveries(db, "worker-default", undefined, { maxAttempts: 1 });
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 0, failed: 1 });
  assert.equal(readDelivery(db, delivery.id)?.last_error, "Unsupported notification channel: facebook");
});
