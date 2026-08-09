import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken, hashPassword, hashSessionToken } from "../auth";
import { SqliteAppDatabase } from "./sqliteAdapter";

function customerInput(email = "Buyer@Example.com") {
  return {
    email,
    normalized_email: email.trim().toLowerCase(),
    password_hash: hashPassword("correct horse battery staple"),
    first_name: "Buyer",
    last_name: "Example",
    phone: "+66 81 234 5678",
    normalized_phone: "0812345678",
    accepted_terms_at: new Date("2026-08-08T00:00:00.000Z"),
    accepted_privacy_at: new Date("2026-08-08T00:00:00.000Z"),
  };
}

test("customer identity keeps accounts and sessions separate from staff auth", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();

  const account = await db.createCustomerAccount(customerInput());
  assert.match(account.id, /^cst_/);
  assert.equal(account.email, "Buyer@Example.com");
  assert.equal(account.normalized_email, "buyer@example.com");
  assert.equal(account.status, "pending");
  assert.equal(await db.getUserByUsername("buyer@example.com"), undefined);

  await assert.rejects(
    () => db.createCustomerAccount(customerInput("buyer@example.com")),
    /unique/i,
  );

  const rawSessionToken = createSessionToken();
  await db.createCustomerSession(account.id, hashSessionToken(rawSessionToken), new Date(Date.now() + 60_000));
  const session = await db.getCustomerSessionWithAccount(hashSessionToken(rawSessionToken));
  assert.equal(session?.account.id, account.id);
  assert.notEqual(session?.token_hash, rawSessionToken);
});

test("customer verification and reset tokens are hashed, one-time, and expire", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const account = await db.createCustomerAccount(customerInput());

  const rawToken = createSessionToken();
  const token = await db.createCustomerAccountToken({
    customer_account_id: account.id,
    kind: "email_verification",
    token_hash: hashSessionToken(rawToken),
    expires_at: new Date(Date.now() + 60_000),
  });
  const sqlite = db as unknown as {
    db: { prepare: (sql: string) => { get: (...params: unknown[]) => unknown } };
  };
  const stored = sqlite.db.prepare("SELECT token_hash FROM customer_account_tokens WHERE id = ?").get(token.id) as { token_hash?: string } | undefined;
  assert.equal(stored?.token_hash, hashSessionToken(rawToken));
  assert.notEqual(stored?.token_hash, rawToken);

  assert.deepEqual(
    await db.consumeCustomerAccountToken(hashSessionToken(rawToken), "email_verification"),
    { token_id: token.id, customer_account_id: account.id },
  );
  assert.equal(await db.consumeCustomerAccountToken(hashSessionToken(rawToken), "email_verification"), undefined);

  const expiredRawToken = createSessionToken();
  await db.createCustomerAccountToken({
    customer_account_id: account.id,
    kind: "password_reset",
    token_hash: hashSessionToken(expiredRawToken),
    expires_at: new Date("2000-01-01T00:00:00.000Z"),
  });
  assert.equal(await db.consumeCustomerAccountToken(hashSessionToken(expiredRawToken), "password_reset"), undefined);
});

test("customer profile changes preserve account history fields and disabling revokes sessions", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const account = await db.createCustomerAccount(customerInput());
  const updated = await db.updateCustomerProfile(account.id, {
    first_name: "Updated",
    last_name: "Buyer",
    phone: "0812345678",
    normalized_phone: "0812345678",
    address_line1: "1 Main Street",
    province: "Bangkok",
  });
  assert.equal(updated?.first_name, "Updated");
  assert.equal(updated?.address_line1, "1 Main Street");
  assert.equal(updated?.accepted_terms_at, account.accepted_terms_at);
  assert.equal(await db.verifyCustomerAccountEmail(account.id), true);
  assert.equal((await db.getCustomerAccountById(account.id))?.status, "active");

  const rawSessionToken = createSessionToken();
  const sessionHash = hashSessionToken(rawSessionToken);
  await db.createCustomerSession(account.id, sessionHash, new Date(Date.now() + 60_000));
  assert.ok(await db.getCustomerSessionWithAccount(sessionHash));
  assert.equal(await db.setCustomerAccountStatus(account.id, "disabled"), true);
  assert.equal(await db.getCustomerSessionWithAccount(sessionHash), undefined);
});
