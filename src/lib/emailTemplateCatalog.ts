export type EmailTemplateKind =
  | "registration_confirmation"
  | "ticket_delivery"
  | "payment_confirmation"
  | "event_update"
  | "magic_link_login";

export type EmailTemplateField = "subject" | "html" | "text";

export type EmailTemplateDefinition = {
  kind: EmailTemplateKind;
  label: string;
  description: string;
  supportedTokens: string[];
  subject: string;
  html: string;
  text: string;
};

export const EMAIL_TEMPLATE_DEFINITIONS: EmailTemplateDefinition[] = [
  {
    kind: "registration_confirmation",
    label: "Registration Confirmation",
    description: "Sent after a free/manual registration succeeds.",
    supportedTokens: [
      "event_name",
      "full_name",
      "registration_id",
      "event_date",
      "event_location",
      "ticket_url",
      "map_url",
      "travel_info",
      "event_page_url",
      "support_email",
    ],
    subject: "Your registration for {{event_name}}",
    text: [
      "Registration confirmed",
      "",
      "Event: {{event_name}}",
      "Name: {{full_name}}",
      "Registration ID: {{registration_id}}",
      "Date: {{event_date}}",
      "Location: {{event_location}}",
      "Ticket: {{ticket_url}}",
      "Event page: {{event_page_url}}",
      "Map: {{map_url}}",
      "Travel: {{travel_info}}",
      "Reply to: {{support_email}}",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f3f6fb;font-family:'Noto Sans Thai',system-ui,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:24px;overflow:hidden;">
      <div style="padding:24px 24px 18px;background:linear-gradient(135deg,#2857f0 0%,#3567f6 100%);color:#ffffff;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Registration confirmed</p>
        <h1 style="margin:0;font-size:28px;line-height:1.2;">{{event_name}}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:16px;">Hello {{full_name}}, your registration is confirmed.</p>
        <div style="border:1px solid #dbe4f0;border-radius:18px;padding:16px 18px;background:#f8fbff;">
          <p style="margin:0 0 8px;"><strong>Registration ID:</strong> {{registration_id}}</p>
          <p style="margin:0 0 8px;"><strong>Date:</strong> {{event_date}}</p>
          <p style="margin:0;"><strong>Location:</strong> {{event_location}}</p>
        </div>
        <p style="margin:18px 0 0;"><a href="{{ticket_url}}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#2857f0;color:#ffffff;text-decoration:none;font-weight:700;">Open Ticket</a></p>
        <p style="margin:18px 0 0;"><a href="{{event_page_url}}" style="color:#2857f0;">Open Event Page</a></p>
        <p style="margin:18px 0 0;"><a href="{{map_url}}" style="color:#2857f0;">Open Map</a></p>
        <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#334155;"><strong>Travel:</strong> {{travel_info}}</p>
      </div>
      <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
        Reply to {{support_email}} for help.
      </div>
    </div>
  </body>
</html>`,
  },
  {
    kind: "ticket_delivery",
    label: "Ticket Delivery",
    description: "Used for resend and paid-ticket delivery flows later.",
    supportedTokens: [
      "event_name",
      "full_name",
      "registration_id",
      "ticket_url",
      "event_date",
      "event_location",
      "event_page_url",
      "support_email",
    ],
    subject: "Your ticket for {{event_name}}",
    text: [
      "Your ticket is ready",
      "",
      "Event: {{event_name}}",
      "Name: {{full_name}}",
      "Registration ID: {{registration_id}}",
      "Date: {{event_date}}",
      "Location: {{event_location}}",
      "Open ticket: {{ticket_url}}",
      "Event page: {{event_page_url}}",
      "Reply to: {{support_email}}",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:'Noto Sans Thai',system-ui,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
      <div style="padding:24px;background:#0f172a;color:#ffffff;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.8;">Ticket delivery</p>
        <h1 style="margin:0;font-size:28px;">{{event_name}}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:16px;">Hello {{full_name}}, your ticket is ready.</p>
        <p style="margin:0 0 8px;"><strong>Registration ID:</strong> {{registration_id}}</p>
        <p style="margin:0 0 8px;"><strong>Date:</strong> {{event_date}}</p>
        <p style="margin:0 0 16px;"><strong>Location:</strong> {{event_location}}</p>
        <p style="margin:0 0 16px;"><a href="{{ticket_url}}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#111827;color:#ffffff;text-decoration:none;font-weight:700;">Open Ticket</a></p>
        <p style="margin:0;"><a href="{{event_page_url}}" style="color:#2563eb;">Open Event Page</a></p>
      </div>
    </div>
  </body>
</html>`,
  },
  {
    kind: "payment_confirmation",
    label: "Payment Confirmation",
    description: "For after-sale and paid event confirmations.",
    supportedTokens: [
      "event_name",
      "full_name",
      "payment_amount",
      "payment_status",
      "ticket_url",
      "event_page_url",
      "support_email",
    ],
    subject: "Payment confirmed for {{event_name}}",
    text: [
      "Payment confirmed",
      "",
      "Event: {{event_name}}",
      "Name: {{full_name}}",
      "Amount: {{payment_amount}}",
      "Status: {{payment_status}}",
      "Ticket: {{ticket_url}}",
      "Event page: {{event_page_url}}",
      "Reply to: {{support_email}}",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#fff7ed;font-family:'Noto Sans Thai',system-ui,sans-serif;color:#431407;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #fed7aa;border-radius:24px;overflow:hidden;">
      <div style="padding:24px;background:#fb923c;color:#ffffff;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Payment confirmed</p>
        <h1 style="margin:0;font-size:28px;">{{event_name}}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:16px;">Hello {{full_name}}, we have recorded your payment.</p>
        <p style="margin:0 0 8px;"><strong>Amount:</strong> {{payment_amount}}</p>
        <p style="margin:0 0 16px;"><strong>Status:</strong> {{payment_status}}</p>
        <p style="margin:0 0 16px;"><a href="{{ticket_url}}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#ea580c;color:#ffffff;text-decoration:none;font-weight:700;">Open Ticket</a></p>
        <p style="margin:0;"><a href="{{event_page_url}}" style="color:#c2410c;">Open Event Page</a></p>
      </div>
    </div>
  </body>
</html>`,
  },
  {
    kind: "event_update",
    label: "Event Update",
    description: "For schedule, venue, or operational changes after registration.",
    supportedTokens: [
      "event_name",
      "full_name",
      "update_summary",
      "event_date",
      "event_location",
      "event_page_url",
      "support_email",
    ],
    subject: "Important update for {{event_name}}",
    text: [
      "Event update",
      "",
      "Hello {{full_name}},",
      "{{update_summary}}",
      "",
      "Current date: {{event_date}}",
      "Current location: {{event_location}}",
      "Event page: {{event_page_url}}",
      "Reply to: {{support_email}}",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#eff6ff;font-family:'Noto Sans Thai',system-ui,sans-serif;color:#1e3a8a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #bfdbfe;border-radius:24px;overflow:hidden;">
      <div style="padding:24px;background:#2563eb;color:#ffffff;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Event update</p>
        <h1 style="margin:0;font-size:28px;">{{event_name}}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:16px;">Hello {{full_name}},</p>
        <p style="margin:0 0 16px;line-height:1.6;">{{update_summary}}</p>
        <p style="margin:0 0 8px;"><strong>Current date:</strong> {{event_date}}</p>
        <p style="margin:0 0 16px;"><strong>Current location:</strong> {{event_location}}</p>
        <p style="margin:0;"><a href="{{event_page_url}}" style="color:#2563eb;">Open Event Page</a></p>
      </div>
    </div>
  </body>
</html>`,
  },
  {
    kind: "magic_link_login",
    label: "Magic Link Login",
    description: "For future passwordless login or secure verification flows.",
    supportedTokens: [
      "full_name",
      "magic_link_url",
      "event_name",
      "support_email",
    ],
    subject: "Your secure login link",
    text: [
      "Secure sign-in link",
      "",
      "Hello {{full_name}},",
      "Use this link to continue: {{magic_link_url}}",
      "Context: {{event_name}}",
      "Reply to: {{support_email}}",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f5f3ff;font-family:'Noto Sans Thai',system-ui,sans-serif;color:#4c1d95;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #ddd6fe;border-radius:24px;overflow:hidden;">
      <div style="padding:24px;background:#7c3aed;color:#ffffff;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Secure sign-in</p>
        <h1 style="margin:0;font-size:28px;">Magic Link</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:16px;">Hello {{full_name}}, use the secure link below to continue.</p>
        <p style="margin:0 0 16px;"><a href="{{magic_link_url}}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;">Open Secure Link</a></p>
        <p style="margin:0;font-size:14px;color:#6d28d9;">Context: {{event_name}}</p>
      </div>
    </div>
  </body>
</html>`,
  },
];

export const EMAIL_TEMPLATE_KIND_OPTIONS = EMAIL_TEMPLATE_DEFINITIONS.map((definition) => ({
  kind: definition.kind,
  label: definition.label,
  description: definition.description,
}));

export const EMAIL_TEMPLATE_DEFAULTS = Object.fromEntries(
  EMAIL_TEMPLATE_DEFINITIONS.map((definition) => [definition.kind, definition]),
) as Record<EmailTemplateKind, EmailTemplateDefinition>;

export function getEmailTemplateSettingKey(kind: EmailTemplateKind, field: EmailTemplateField) {
  return `email_template_${kind}_${field}` as const;
}

export function replaceEmailTemplateTokens(template: string, tokens: Record<string, string>) {
  let output = String(template || "");
  for (const [key, value] of Object.entries(tokens)) {
    output = output.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi"), String(value ?? ""));
  }
  return output;
}
