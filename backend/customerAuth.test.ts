import assert from "node:assert/strict";
import test from "node:test";

import {
  createCustomerAccountToken,
  isValidCustomerEmail,
  isValidCustomerPhone,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  renderCustomerAccountEmail,
} from "./customerAuth";

test("customer contact normalization is deterministic", () => {
  assert.equal(normalizeCustomerEmail("  Buyer@Example.COM "), "buyer@example.com");
  assert.equal(normalizeCustomerPhone("+66 81-234-5678"), "0812345678");
  assert.equal(isValidCustomerEmail("buyer@example.com"), true);
  assert.equal(isValidCustomerEmail("not-an-email"), false);
  assert.equal(isValidCustomerPhone("081 234 5678"), true);
  assert.equal(isValidCustomerPhone("12"), false);
});

test("customer account links contain raw tokens but email HTML escapes user-controlled values", () => {
  const { rawToken, tokenHash } = createCustomerAccountToken();
  assert.ok(rawToken.length >= 32);
  assert.notEqual(tokenHash, rawToken);

  const email = renderCustomerAccountEmail({
    kind: "password_reset",
    appUrl: "https://example.com",
    rawToken,
    firstName: "<Buyer>",
    supportEmail: "support@example.com",
  });
  assert.match(email.text, new RegExp(rawToken));
  assert.match(email.html, /&lt;Buyer&gt;/);
  assert.doesNotMatch(email.html, /<Buyer>/);
  assert.match(email.html, /reset-password/);
});
