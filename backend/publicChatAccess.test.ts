import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicChatSessionToken,
  verifyPublicChatSessionToken,
} from "./publicChatAccess";

const SECRET = "public-chat-secret-for-tests";
const EVENT_ID = "event-123";
const ROUTE_ID = "public-event";
const SENDER_ID = "public-web:event-123:sender-456";

test("public chat session is bound to event, route, and sender", () => {
  const token = createPublicChatSessionToken(SECRET, EVENT_ID, SENDER_ID, ROUTE_ID, 1_700_000_000_000, 3600);
  const session = verifyPublicChatSessionToken(SECRET, EVENT_ID, ROUTE_ID, token, 1_700_000_100_000);

  assert.deepEqual(session, {
    version: 1,
    eventId: EVENT_ID,
    senderId: SENDER_ID,
    routeId: ROUTE_ID,
    expiresAt: 1_700_003_600,
  });
  assert.equal(verifyPublicChatSessionToken(SECRET, "other-event", ROUTE_ID, token, 1_700_000_100_000), null);
  assert.equal(verifyPublicChatSessionToken(SECRET, EVENT_ID, "other-route", token, 1_700_000_100_000), null);
  assert.equal(verifyPublicChatSessionToken("wrong-secret", EVENT_ID, ROUTE_ID, token, 1_700_000_100_000), null);
});

test("public chat session rejects expiry and tampering", () => {
  const token = createPublicChatSessionToken(SECRET, EVENT_ID, SENDER_ID, ROUTE_ID, 1_700_000_000_000, 60);
  assert.equal(verifyPublicChatSessionToken(SECRET, EVENT_ID, ROUTE_ID, token, 1_700_000_060_000), null);

  const [payload, signature] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({
    version: 1,
    eventId: EVENT_ID,
    senderId: "someone-else",
    routeId: ROUTE_ID,
    expiresAt: 1_700_000_060,
  }), "utf8").toString("base64url");
  assert.equal(
    verifyPublicChatSessionToken(SECRET, EVENT_ID, ROUTE_ID, `${tamperedPayload}.${signature}`, 1_700_000_001_000),
    null,
  );
});
