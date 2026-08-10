import assert from "node:assert/strict";
import test from "node:test";

import { isCustomerScopedCsrfPath } from "./auth";

test("customer checkout orders use customer-scoped CSRF", () => {
  assert.equal(isCustomerScopedCsrfPath("/api/customer/orders"), true);
  assert.equal(isCustomerScopedCsrfPath("/api/public/events/ai-innovation-summit-2026/orders"), true);
  assert.equal(isCustomerScopedCsrfPath("/api/public/events/ai-innovation-summit-2026/orders/"), true);
  assert.equal(isCustomerScopedCsrfPath("/api/public/events/ai-innovation-summit-2026/register"), false);
  assert.equal(isCustomerScopedCsrfPath("/api/events/ai-innovation-summit-2026/orders"), false);
});
