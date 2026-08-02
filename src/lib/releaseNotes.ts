export const RELEASE_NOTES = [
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
