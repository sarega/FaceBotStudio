import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { fetchWithTimeout } from "./fetchWithTimeout";

test("fetchWithTimeout aborts a request that exceeds the deadline", async () => {
  const server = createServer(() => {
    // Keep the response open until the client timeout aborts it.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await assert.rejects(
      fetchWithTimeout(`http://127.0.0.1:${address.port}/timeout`, undefined, 1_000),
      (error: unknown) => error instanceof Error && /abort|timed out|timeout|fetch failed/i.test(error.message),
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
