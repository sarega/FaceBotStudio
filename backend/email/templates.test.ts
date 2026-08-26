import assert from "node:assert/strict";
import test from "node:test";

import { renderEventUpdateEmail } from "./templates";

test("event update email personalizes the attendee and escapes the update for HTML", () => {
  const result = renderEventUpdateEmail({
    appUrl: "https://events.example.test",
    settings: {
      event_name: "Product Launch",
      event_timezone: "Asia/Bangkok",
      event_date: "2026-09-12T10:00:00+07:00",
      email_template_event_update_subject: "Update for {{event_name}}",
      email_template_event_update_text: "Hello {{full_name}} ({{registration_id}}): {{update_summary}}",
      email_template_event_update_html: "<p>{{full_name}}</p><p>{{update_summary}}</p>",
    },
    attendee: {
      registrationId: "reg_123",
      firstName: "Nina",
      lastName: "Wong",
    },
    eventId: "event_123",
    updateSummary: "Venue changed to Hall <A> & please arrive early.",
    supportEmail: "help@example.test",
  });

  assert.equal(result.subject, "Update for Product Launch");
  assert.match(result.text, /Hello Nina Wong \(reg_123\)/);
  assert.match(result.text, /Venue changed to Hall <A> & please arrive early\./);
  assert.match(result.html, /<p>Nina Wong<\/p>/);
  assert.match(result.html, /Venue changed to Hall &lt;A&gt; &amp; please arrive early\./);
});
