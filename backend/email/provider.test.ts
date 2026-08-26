import assert from "node:assert/strict";
import test from "node:test";

import { sendProviderEmail } from "./provider";

test("Resend email payload includes base64 attachments", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "email_123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await sendProviderEmail({
      to: "attendee@example.test",
      subject: "Event update",
      text: "The event has changed",
      html: "<p>The event has changed</p>",
      attachments: [{ filename: "reg_123-ticket.png", content: "iVBORw0KGgo=" }],
    }, {
      provider: "resend",
      apiKey: "re_test_key",
      fromAddress: "events@example.test",
      replyToAddress: "help@example.test",
      appUrl: "https://events.example.test",
      hasApiKey: true,
      hasFrom: true,
      hasReplyTo: true,
      hasAppUrl: true,
      configured: true,
      ready: true,
      readiness: "ready",
      missingFields: [],
      errorMessage: null,
    });

    assert.equal(result.providerMessageId, "email_123");
    assert.deepEqual(requestBody?.attachments, [{ filename: "reg_123-ticket.png", content: "iVBORw0KGgo=" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
