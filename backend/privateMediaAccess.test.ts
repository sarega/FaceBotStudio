import assert from "node:assert/strict";
import test from "node:test";

import { createPrivateMediaToken, verifyPrivateMediaToken } from "./privateMediaAccess";

const secret = "private-media-secret-for-tests-0123456789";
const issuedAt = Date.UTC(2026, 7, 11, 0, 0, 0);

test("private media tokens are bound to scope and file name", () => {
  const token = createPrivateMediaToken(secret, "channel", "evt_default-chat.png", issuedAt, 60);

  assert.ok(token);
  assert.equal(verifyPrivateMediaToken(secret, "channel", "evt_default-chat.png", token, issuedAt), true);
  assert.equal(verifyPrivateMediaToken(secret, "admin-agent", "evt_default-chat.png", token, issuedAt), false);
  assert.equal(verifyPrivateMediaToken(secret, "channel", "other.png", token, issuedAt), false);
  assert.equal(verifyPrivateMediaToken(secret, "channel", "../secret.png", token, issuedAt), false);
});

test("private media tokens expire and reject tampering", () => {
  const token = createPrivateMediaToken(secret, "admin-agent", "admin-image.png", issuedAt, 60);

  assert.equal(verifyPrivateMediaToken(secret, "admin-agent", "admin-image.png", token, issuedAt + 59_000), true);
  assert.equal(verifyPrivateMediaToken(secret, "admin-agent", "admin-image.png", token, issuedAt + 60_000), false);
  assert.equal(verifyPrivateMediaToken(secret, "admin-agent", "admin-image.png", `${token}x`, issuedAt), false);
});
