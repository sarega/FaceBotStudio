export const RELEASE_NOTES = [
  {
    version: "0.8.3",
    date: "2026-11-16",
    title: "Internal events: external manual payments",
    features: [
      "Paid seminars accept bookings without Organizer PromptPay when external/manual payment is selected",
      "Admin confirms verified external payments later; admission QR is issued only after confirmation",
      "Event creation and paid settings offer payment method selection",
      "Organizer profile and finance settings use large, visible navigation buttons",
    ],
  },
  {
    version: "0.8.2",
    date: "2026-11-16",
    title: "Paid registration and Help Bot readiness hotfix",
    features: [
      "Admin Paid Registration settings explain individual deployment and event blockers",
      "One-click publish is available when payment prerequisites are satisfied",
      "Web Help Bot retries creating its session without reloading the event page",
    ],
  },
  {
    version: "0.8.1",
    date: "2026-11-16",
    title: "Faster event setup and web registration",
    features: [
      "New Event now asks for Free or Paid Registration and whether to enable the event web page and AI chat",
      "Free events can open web registration immediately without Facebook or public catalog listing",
      "Existing free events get a one-click enable action; paid drafts remain safely unpublished until configured",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-11-16",
    title: "Paid Seminar Registration",
    features: [
      "Event-specific paid registration adds capacity holds, group bookings, seminar forms and deferred full payments",
      "Secure slip review and audited payment approval unlock attendee-specific QR admission",
      "Admin booking operations cover extensions, cancellations, capacity-checked reinstatement and recorded full refunds",
      "Opt-in payment reminders and Telegram staff review alerts improve follow-up on pending payments",
      "Messenger and customer self-service booking are protected by opt-in feature configuration",
    ],
  },
  {
    version: "0.7.3",
    date: "2026-08-12",
    title: "Event-scoped Gatekeeper access",
    features: [
      "Gatekeeper accounts can check registrations only in explicitly assigned Events",
      "Owners and Admins can assign or remove Event access from Team Access",
      "Authorization checks now block cross-Event registration, check-in, outreach, ticketing, document, and agent access",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-08-11",
    title: "Organizer directory and customer operations",
    features: [
      "Reusable organizer profiles now provide event-facing identity, logos, contact details, and per-organizer finance policies",
      "Customer account verification and admin customer management show account status, delivery state, and purchase history",
      "Public checkout reads performance, ticket class, price, zone, and seat availability from Direct Ticketing",
      "Compact workspace layouts and dark-theme selection highlights improve daily use on 13-inch screens",
    ],
  },
  {
    version: "0.5.1",
    date: "2026-08-03",
    title: "Compact workspace layout",
    features: [
      "Reflowed the Event Information header for constrained 13-inch screens",
      "Kept event status details on one readable line while action buttons wrap cleanly",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-08-03",
    title: "Web research for outreach targets",
    features: [
      "Admin Agent can search public web sources for press-page recommendations and target enrichment",
      "Source URLs are retained in target notes and the confirmed target list can be downloaded as CSV",
      "Bounded search usage and no guessing of unsupported Page IDs or contact details",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-08-03",
    title: "Conversational outreach setup",
    features: [
      "Admin Agent can prepare Press Outreach campaigns, targets, and Press Kit assets from chat",
      "Explicit confirmation, duplicate checks, and URL validation before saving",
      "Setup never sends messages or binds a Facebook identity automatically",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-08-02",
    title: "Human-approved press outreach",
    features: [
      "Press Outreach campaigns, target management, AI initial and suggested replies, and manual first-contact workflow",
      "Verified Facebook replies and Press Kit image/link delivery with audit history, idempotency protection, and manual fallback",
      "Outreach dashboard, reminders, assignments, CSV import/export, identity matching, and channel-readiness checks",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-08-02",
    title: "Direct ticketing polish",
    features: [
      "Improved ticket preview, print layout, readability, and Thai font output",
      "Added class-specific ticket designs, multiple-seat issuing, and direct-seat recovery tools",
      "Added seat-map import review, draft persistence, and check-in readiness for direct tickets",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-07-31",
    title: "Direct ticketing and settings center",
    features: [
      "VIP and direct-seat allocation with manual payment verification",
      "Ticket Designer with graphic upload, live preview, PNG, A6 PDF, and A4 printing",
      "Central Settings for account preferences, access, system version, and feature updates",
    ],
  },
  {
    version: "0.1.2",
    date: "2026-07-30",
    title: "Multi-event operations foundation",
    features: [
      "Event workspaces, public event pages, registrations, check-in, and operational logs",
      "Role-based access for owner, admin, operator, checker, and viewer",
      "Multi-channel event routing and admin agent operations",
    ],
  },
] as const;
