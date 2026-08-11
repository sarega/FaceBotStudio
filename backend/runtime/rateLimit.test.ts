import assert from "node:assert/strict";
import test from "node:test";

import { resolveRateLimitFallbackMode } from "./rateLimit";

test("rate limit fallback fails closed by default in production", () => {
  assert.equal(resolveRateLimitFallbackMode({ NODE_ENV: "production" }), "fail_closed");
  assert.equal(resolveRateLimitFallbackMode({ NODE_ENV: "development" }), "memory_single_instance");
});

test("rate limit fallback mode must be explicit when configured", () => {
  assert.equal(
    resolveRateLimitFallbackMode({ NODE_ENV: "production", RATE_LIMIT_FALLBACK_MODE: "memory_single_instance" }),
    "memory_single_instance",
  );
  assert.equal(
    resolveRateLimitFallbackMode({ NODE_ENV: "production", RATE_LIMIT_FALLBACK_MODE: "fail_closed" }),
    "fail_closed",
  );
});
