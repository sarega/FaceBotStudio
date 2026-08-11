import assert from "node:assert/strict";
import test from "node:test";

import { createTicketAccessToken, verifyTicketAccessToken } from "./ticketAccess";

const secret = "ticket-access-secret-for-tests-0123456789";
const registrationId = "REG-ABC123";
const issuedAt = Date.UTC(2026, 7, 11, 0, 0, 0);

test("ticket access tokens are bound to the ticket and format", () => {
  const token = createTicketAccessToken(secret, registrationId, "png", issuedAt, 60);

  assert.ok(token);
  assert.equal(verifyTicketAccessToken(secret, registrationId, "png", token, issuedAt), true);
  assert.equal(verifyTicketAccessToken(secret, registrationId, "svg", token, issuedAt), false);
  assert.equal(verifyTicketAccessToken(secret, "REG-OTHER", "png", token, issuedAt), false);
  assert.equal(verifyTicketAccessToken("other-secret", registrationId, "png", token, issuedAt), false);
});

test("ticket access tokens expire and reject tampering", () => {
  const token = createTicketAccessToken(secret, registrationId, "png", issuedAt, 60);

  assert.equal(verifyTicketAccessToken(secret, registrationId, "png", token, issuedAt + 59_000), true);
  assert.equal(verifyTicketAccessToken(secret, registrationId, "png", token, issuedAt + 60_000), false);
  assert.equal(verifyTicketAccessToken(secret, registrationId, "png", `${token}x`, issuedAt), false);
  assert.equal(verifyTicketAccessToken(secret, registrationId, "png", [token], issuedAt), false);
});
