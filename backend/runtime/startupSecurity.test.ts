import assert from "node:assert/strict";
import test from "node:test";

import { resolveStartupSecurityConfig } from "./startupSecurity";

const productionWebEnv = {
  NODE_ENV: "production",
  APP_RUNTIME: "web",
  APP_URL: "https://events.example.com",
  TRUST_PROXY: "1",
};

test("public direct ticketing requires an independent production secret", () => {
  assert.throws(
    () => resolveStartupSecurityConfig({ ...productionWebEnv, PUBLIC_DIRECT_TICKETING_ENABLED: "1" }),
    /DIRECT_TICKET_SECRET is required/,
  );

  const config = resolveStartupSecurityConfig({
    ...productionWebEnv,
    PUBLIC_DIRECT_TICKETING_ENABLED: "1",
    DIRECT_TICKET_SECRET: "s".repeat(32),
  });
  assert.equal(config.appRuntime, "web");
});

test("production ticket links warn when their signing secret is missing", () => {
  const config = resolveStartupSecurityConfig(productionWebEnv);
  assert.equal(config.warnings.some((warning) => warning.includes("TICKET_ACCESS_SECRET")), true);
});

test("production warns when shared database and Redis services are not configured", () => {
  const config = resolveStartupSecurityConfig(productionWebEnv);
  assert.equal(config.warnings.some((warning) => warning.includes("DATABASE_URL")), true);
  assert.equal(config.warnings.some((warning) => warning.includes("REDIS_URL")), true);
});

test("production ticket links accept a generated signing secret", () => {
  const config = resolveStartupSecurityConfig({
    ...productionWebEnv,
    TICKET_ACCESS_SECRET: "t".repeat(32),
  });
  assert.equal(config.warnings.some((warning) => warning.includes("TICKET_ACCESS_SECRET")), false);
});

test("production rejects a weak private media signing secret", () => {
  assert.throws(
    () => resolveStartupSecurityConfig({ ...productionWebEnv, MEDIA_ACCESS_SECRET: "short" }),
    /MEDIA_ACCESS_SECRET must be a generated secret/,
  );
});

test("production rejects a weak public chat session secret", () => {
  assert.throws(
    () => resolveStartupSecurityConfig({ ...productionWebEnv, PUBLIC_CHAT_SESSION_SECRET: "short" }),
    /PUBLIC_CHAT_SESSION_SECRET must be a generated secret/,
  );
});

test("production only permits memory rate limits with explicit single-instance mode", () => {
  assert.throws(
    () => resolveStartupSecurityConfig({ ...productionWebEnv, RATE_LIMIT_FALLBACK_MODE: "memory_single_instance" }),
    /RATE_LIMIT_SINGLE_INSTANCE=1/,
  );

  const config = resolveStartupSecurityConfig({
    ...productionWebEnv,
    RATE_LIMIT_FALLBACK_MODE: "memory_single_instance",
    RATE_LIMIT_SINGLE_INSTANCE: "1",
  });
  assert.equal(config.warnings.some((warning) => warning.includes("in-memory single-instance fallback")), true);
});
