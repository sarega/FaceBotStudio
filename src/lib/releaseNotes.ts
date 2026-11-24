export const RELEASE_NOTES = [
  {
    version: "0.11.10",
    date: "2026-11-24",
    title: "Role previews and clearer slip review",
    features: [
      "Preview staff roles and the attendee app from the Owner workspace",
      "Resize roster columns and copy full booking references",
      "Read slip and booking statuses directly in the review queue",
    ],
  },
  {
    version: "0.11.9",
    date: "2026-11-23",
    title: "Unified booking management and seminar operations",
    features: [
      "Manage bookings, review and upload slips, and see attendee prices in one view",
      "Flag and correct prices, notify customers of balances, review split payments, and apply coupons",
      "Plan rooms and carpools, and see paid attendees in Operations reports",
      "Prevent duplicate attendee bookings when unique names are required",
      "Use improved staff activation, account switching, and password recovery",
    ],
  },
  {
    version: "0.11.8",
    date: "2026-11-20",
    title: "Staff invitations and clearer slip review",
    features: [
      "Invite staff by email with their role and event access",
      "Verify staff email in Settings and continue signing in with a username",
      "See the active booking filter and return to the full Slip Review queue",
    ],
  },
  {
    version: "0.11.7",
    date: "2026-11-20",
    title: "Admin notifications sync across devices",
    features: [
      "Read and archived notification state follows an Admin account across devices",
      "Existing browser notification state migrates into the database once",
      "Mark all read, archive and restore persist safely without affecting booking records",
    ],
  },
  {
    version: "0.11.6",
    date: "2026-11-20",
    title: "Reliable admin notifications and recoverable history",
    features: [
      "Refresh, unread, archive and restore controls",
      "Payment review outcomes and booking changes appear in notifications",
      "Load older activities without losing existing rows on refresh",
    ],
  },
  {
    version: "0.11.5",
    date: "2026-11-18",
    title: "Clear email verification after customer signup",
    features: [
      "New customers see a large bilingual instruction to verify email before booking",
      "Persistent reminders for unverified accounts on Customer App and Event pages",
      "A prominent resend verification action with accurate delivery feedback",
    ],
  },
  {
    version: "0.11.4",
    date: "2026-11-18",
    title: "Daily transfer reports and compact customer management",
    features: [
      "Download a daily transfer reconciliation PDF from Slip Review, with payment totals and slip thumbnails",
      "Configure fixed or relative payment deadlines and show customers a live countdown",
      "Set custom transport dropdown choices and switch key registration settings labels between Thai and English",
      "See booking status in the customer account and fit more of the Customers dashboard on smaller screens",
      "Open the organizer saved for the selected event",
    ],
  },
  {
    version: "0.11.3",
    date: "2026-11-17",
    title: "Clearer dark-mode registration management",
    features: [
      "Improved readability in Coupons, Slip Review, attendee roster and booking status cards",
      "Consistent form, label and status contrast in both light and dark themes",
      "Improved compact table text and verified mobile/desktop rendering",
    ],
  },
  {
    version: "0.11.2",
    date: "2026-11-17",
    title: "Unified Event attendees, booking capacity and hotel roster export",
    features: [
      "Event Registrations and Stats now include paid booking attendees alongside legacy registrations",
      "Group bookings display every person individually with customer and booking identity",
      "Excel and CSV exports support all named attendees and seminar choices across Events",
    ],
  },
  {
    version: "0.11.1",
    date: "2026-11-17",
    title: "Unified Registration Settings, Coupons and Slip Review UI",
    features: [
      "All three sections now share one icon, typography, header and collapse layout",
      "Blue Settings, purple Coupons and green Slip Review across light and dark themes",
      "More compact, aligned section headers on laptops and mobile",
    ],
  },
  {
    version: "0.11.0",
    date: "2026-11-17",
    title: "Customer booking dashboard and connected payment review",
    features: [
      "Customer dashboard shows actual paid bookings with accurate payment and review counts",
      "Proof review identifies each Event, customer account, and booking with direct navigation",
      "Cross-event booking search and Excel-compatible CSV export with payment timestamps",
    ],
  },
  {
    version: "0.10.9",
    date: "2026-11-17",
    title: "Four-step payment and simplified admin slip approval",
    features: [
      "Customers see 1 Pay amount, 2 Bank/QR, 3 Upload slip, 4 Wait for approval",
      "Admin sees the uploaded slip beside the amount and can approve without retyping routine fields",
      "Review queue prioritizes slips ready for approval and keeps advanced tools collapsed",
    ],
  },
  {
    version: "0.10.8",
    date: "2026-11-17",
    title: "Compact Event Workspace for small laptops",
    features: [
      "Hide unnecessary search/filter controls when only one event is available",
      "Use a compact single-event row without an additional scrolling panel",
      "Reduce Event Information and Registration Rules spacing on desktop and mobile",
    ],
  },
  {
    version: "0.10.7",
    date: "2026-11-17",
    title: "Custom registration defaults and food choices",
    features: [
      "Set default answers for seminar questions, including Accommodation = Yes",
      "Food Preference can use free text or configurable dropdown options",
      "Attendee selections remain editable and existing bookings remain unchanged",
    ],
  },
  {
    version: "0.10.6",
    date: "2026-11-17",
    title: "Coupon code validation and current-price preview",
    features: [
      "Coupon Apply now validates code syntax before unrelated attendee options",
      "A valid coupon discounts the current checkout subtotal while accommodation choices remain editable",
      "Required accommodation answers are enforced only when placing the final booking",
    ],
  },
  {
    version: "0.10.5",
    date: "2026-11-17",
    title: "Fix customer coupon CSRF when Admin is signed in",
    features: [
      "Coupon Apply now uses the Customer security token even if the same browser has an Admin session",
      "Admin and customer security checks remain isolated and enforced",
      "Coupon form explains any remaining CSRF session errors clearly",
    ],
  },
  {
    version: "0.10.3",
    date: "2026-11-17",
    title: "Coupon eligibility diagnostics and event matching",
    features: [
      "Checkout distinguishes missing, disabled, not-yet-started, expired and exhausted coupons",
      "Admin coupon cards show live eligibility based on the server clock",
      "Coupon management links to the specific Public Event for accurate event matching",
    ],
  },
  {
    version: "0.10.2",
    date: "2026-11-17",
    title: "Clear checkout coupon validation feedback",
    features: [
      "Coupon validation now explains expired, exhausted, inactive, stale-price and login failures",
      "Typed coupon codes are normalized and previews cannot overwrite later selections",
      "Unexpected server coupon errors are logged for production diagnosis",
    ],
  },
  {
    version: "0.10.1",
    date: "2026-11-17",
    title: "Coupon management: edit, duplicate and safe delete",
    features: [
      "Fixed white screen caused by PostgreSQL timestamp formatting in coupon editing",
      "Separate Edit, Duplicate and Delete actions with clearer confirmation",
      "Used coupons can be disabled while their booking history remains intact",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-11-17",
    title: "Coupons & Promotions",
    features: [
      "Event administrators can manage percentage, fixed amount and complimentary coupon codes",
      "Checkout previews the discount while the server enforces final prices and limits",
      "Expired holds release coupon quotas and 100% free bookings receive admission tickets",
    ],
  },
  {
    version: "0.9.9",
    date: "2026-11-17",
    title: "Conditional accommodation discounts for paid seminars",
    features: [
      "Set a per-category discount when attendees decline accommodation",
      "Instant attendee and booking total updates, with secure server-side price calculation",
      "Show applied accommodation discounts on the customer invoice",
    ],
  },
  {
    version: "0.9.8",
    date: "2026-11-17",
    title: "Cleaner public event and attendee booking experience",
    features: [
      "Compact expandable booking status, without repeating the signed-in profile",
      "Public event language switch (TH / EN) and smaller, more consistent typography",
      "Single-page scrolling layout with no sticky booking sidebar",
    ],
  },
  {
    version: "0.9.7",
    date: "2026-11-17",
    title: "Expired booking recovery and repeat registration",
    features: [
      "Expired bookings can be reactivated by their owner in My Bookings",
      "Previous bookings no longer block signing up additional attendees",
      "New paid events use 24-hour payment windows, with a one-click 24-hour preset for existing events",
    ],
  },
  {
    version: "0.9.6",
    date: "2026-11-17",
    title: "Free child attendees in family bookings",
    features: [
      "Registration categories now accept a zero price for free children",
      "Free and paid attendees share one booking and each receive an admission QR",
      "Public forms display Free clearly and keep charging only for paid attendees",
    ],
  },
  {
    version: "0.9.5",
    date: "2026-11-17",
    title: "Payment slip compression and retention",
    features: [
      "Payment slip images are compressed before secure storage",
      "Old proof images expire automatically after 180 days for finalized bookings",
      "Payment audit trails and pending-verification slips remain intact",
    ],
  },
  {
    version: "0.9.4",
    date: "2026-11-17",
    title: "Customer navigation without browser back",
    features: [
      "Customer App links directly to Events and My Account from mobile and desktop",
      "Edit Profile and Security return to the originating section",
      "Persistent navigation to bookings and events across customer pages",
    ],
  },
  {
    version: "0.9.3",
    date: "2026-11-17",
    title: "Mobile payment experience improvements",
    features: [
      "Save bank payment QR image for use in mobile banking apps",
      "Large QR images fit narrow phone screens",
      "Deep-linked invoices open in view without confusing duplicate empty states",
    ],
  },
  {
    version: "0.9.2",
    date: "2026-11-17",
    title: "Bank transfer invoice and slip verification",
    features: [
      "Reserve now opens a payment invoice with organizer QR and bank details",
      "External/manual bookings accept encrypted payment slips and wait for staff approval",
      "Confirmed attendees receive admission QR tickets and a bilingual confirmation email",
    ],
  },
  {
    version: "0.9.1",
    date: "2026-11-17",
    title: "Familiar account navigation on public events",
    features: [
      "Profile avatar menu appears in Event Catalog and Event headers when signed in",
      "Profile, My Bookings, Browse Events and Sign out remain one click away",
      "Guest register/sign-in actions and dark/light themes remain consistent",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-11-17",
    title: "Event registration recognizes signed-in accounts",
    features: [
      "Signed-in attendees see their name and booking controls instead of account creation prompts",
      "Returning to the Event tab refreshes the account session",
      "Primary booking contact is prefilled from the customer account",
    ],
  },
  {
    version: "0.8.9",
    date: "2026-11-16",
    title: "Readable Paid Registration setup status",
    features: [
      "Fixed light/dark contrast of registration activation notices",
      "Readable warning, success, error, and link colors",
      "Clearer technical readiness diagnostics",
    ],
  },
  {
    version: "0.8.8",
    date: "2026-11-16",
    title: "Clearer bilingual registration and theme contrast",
    features: [
      "Short Thai and English signup copy on public event pages",
      "Clear Create Account and Sign In actions",
      "Improved paid registration appearance for light and dark themes",
    ],
  },
  {
    version: "0.8.5",
    date: "2026-11-16",
    title: "Simplified one-page paid event setup",
    features: [
      "Configure payment method, uploaded QR and bank details, pricing and capacity in one form",
      "Save and Open Registration in one action",
      "Advanced readiness diagnostics are tucked away until needed",
    ],
  },
  {
    version: "0.8.4",
    date: "2026-11-16",
    title: "Upload recipient QR and bank details",
    features: [
      "Upload an existing bank payment QR image in Paid Registration settings without needing a PromptPay ID",
      "Attendees can see QR and bank details in their own booking",
      "Organizer finance now directs internal events to the correct payment setup",
    ],
  },
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
