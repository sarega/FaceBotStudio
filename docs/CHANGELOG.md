# Changelog

## 0.8.4 - 2026-11-16

- Added per-event upload of an existing recipient payment QR image (JPEG/PNG/WebP), plus bank name, account holder, and bank account number, without requiring a PromptPay ID.
- Payment QR is decoded and converted to metadata-free PNG and stored durably in a database table; the image is not dependent on Railway's ephemeral filesystem.
- Added authenticated organizer upload/update/remove endpoints and booking-owner-only payment instructions. Only external/manual Paid Registration bookings receive the uploaded QR and account details.
- Added guidance in Organizer Finance to distinguish generating a new PromptPay QR from uploading a supplied QR for an Event.
- Added migration 051 and HTTP integration coverage for QR upload, bank details, authorization isolation and invalid files. Payment confirmation remains manual; admission QR is issued only after verification.

## 0.8.3 - 2026-11-16

- Added External / Manual Payment for internal Paid Registration events. Organizer PromptPay account and payment-proof encryption are no longer required for this explicitly selected mode.
- Group bookings retain capacity holds and full amount due; organizer staff independently verify payment outside FaceBotStudio and manually record a unique external receipt/reference to confirm attendees and issue check-in QR credentials.
- Added payment mode selector to New Event and existing Paid Registration settings. New external/manual events can open immediately when customer registration services are enabled; existing events retain all configuration.
- Removed customer PromptPay QR/slip-upload controls for external/manual bookings and clarified instructions on the event and customer order pages.
- Replaced subtle Organizer Profile / Finance pills with large, clearly identifiable navigation buttons, icons, visible active state and keyboard focus.
- Added event-scoped database migration 050 and regression coverage for external bookings, manual confirmation, and UI/API readiness. Does not transfer or collect money, bypass admin approval, or allow QR before confirmed payment.

## 0.8.2 - 2026-11-16

- Added secure admin-only Paid Registration readiness checks for server flags, account availability, encryption, organizer receiver and web Help Bot session.
- Added an actionable activation checklist and safe one-click paid publishing in Registration settings. Payment secrets must be configured separately.
- Web Help Bot retries starting a missing session when the visitor sends a message and displays the actual session error.
- Added HTTP permissions and readiness regression tests.

## 0.8.1 - 2026-11-16

- Added New Event registration type (Free / Paid Seminar), web-page + AI chat choice, optional immediate activation, private catalog visibility by default, and basic paid price/capacity draft settings.
- Added an event-level one-click "Enable web registration + AI chat now" action for existing free events, guarded against accidentally activating paid checkout or changing past event schedules.
- Ensured paid events begin with safe unpublished booking configuration until organizer financial settings and deployment encryption prerequisites are verified.
- Clarified paid-registration draft state and public unavailable messaging; added HTTP coverage for new-event web-only publishing and guarded paid draft activation.

## 0.8.0 - 2026-11-16

- Added opt-in Paid Registration for seminars and retreats with per-event pricing, time-limited capacity holds, group bookings, booking recovery and configurable attendee fields.
- Added encrypted payment proof intake (AES-256-GCM), full-payment manual verification, financial audit, PromptPay instructions, and per-attendee QR admission issued only after confirmation.
- Added Messenger booking and confirmation flows, customer bookings, staff review dashboard, and paid check-in through the existing event authorization system.
- Added admin booking lookup, hold extension, capacity-checked reinstatement, cancellation, and audit-backed recording of completed full refunds with QR revocation. Refund recording does **not** transfer money.
- Hardened duplicate bank reference detection across Paid Registration and Direct Ticketing; added shared PostgreSQL transaction-scoped reference locking and HTTP 409 conflict handling.
- Added pending-review escalation through the autonomous Telegram Admin Agent when staff review has been waiting for at least 24 hours.
- Added optional, idempotent 24-hour payment-deadline email reminders for eligible unpaid holds, with entitlement revalidation at delivery and a default-off environment toggle.
- Added additive PostgreSQL migrations 040–049 and mirrored SQLite schema, group booking, payment and admission tests. Public Paid Registration remains disabled by default until deliberately configured.

## 0.7.3 - 2026-08-12

- Added Gatekeeper (`checker`) accounts with explicit per-Event access assignments managed from Team Access; newly created Events are not automatically exposed to restricted accounts.
- Scoped registration, check-in, reporting, outreach, document, direct-ticket, and Admin Agent APIs to the correct role and assigned Event, including cross-Event mutation checks.
- Redacted verification and Telegram integration secrets from settings responses for event-scoped accounts and added regression coverage for explicit Event assignments.

## 0.7.2 - 2026-08-11

- Kept production startup available when the optional public direct-ticketing flag is enabled without `DIRECT_TICKET_SECRET`; direct ticketing now stays disabled until its signing secret is configured, instead of taking down the whole web service.
- Added regression coverage for the deployment configuration failure and tightened public direct-ticketing route guards to require a signing secret.

## 0.7.1 - 2026-08-11

- Hardened production security with scoped public chat/media/ticket access, CSRF/session protections, safer external links, provider timeouts, rate-limit fail-closed behavior, and reduced sensitive logging.
- Added durable Facebook outbound delivery for bot replies, ticket artifacts, and inbox manual replies with database-backed retry/backoff, idempotency, Graph error classification, and worker health visibility.
- Added SQLite legacy upgrades and PostgreSQL migrations for registration timelines, indexed registration search/reporting, and the Facebook notification channel.
- Improved customer mobile/public layouts and Admin registration/outreach views for constrained screens while preserving existing workflows.
- Added regression coverage for security boundaries, database upgrades, notification delivery, runtime configuration, ticket access, public chat, and production readiness checks.

## 0.7.0 - 2026-08-11

- Added an organizer directory with reusable public profiles, logos, contact details, PromptPay receiving settings, tax, fee, and payout policies; events can now select their organizer instead of copying organizer data.
- Added customer account verification delivery, customer profile controls, and admin customer management with account status, verification state, and purchase history.
- Connected Direct Ticketing inventory to public checkout with performance, ticket-class, price, zone, and seat selection while preserving admin VIP and complimentary overrides.
- Improved checkout security and payment/order snapshots, SQLite/PostgreSQL migrations, regression coverage, compact workspace layouts, and dark-theme selection highlights.

## 0.6.0 - 2026-08-09

- Added the customer ticketing platform foundation: customer accounts, verified checkout, multi-seat order holds, PromptPay QR payment proof, fee/tax snapshots, and customer ticket/order history.
- Added customer claims, notification preferences, SMS outbox delivery, account export/disable controls, and admin payment review with audit coverage.
- Added event-level checkout controls for public seat inventory, customer checkout, order limits, platform fees, payment fees, and tax settings; all new commerce features remain disabled by default behind feature flags.
- Added SQLite/PostgreSQL migrations and legacy SQLite upgrade handling for customer links, order/payment records, preferences, and notification delivery.
- Added public checkout, customer account, and admin order-review UI plus regression coverage for the new domain and legacy SQLite startup.

## 0.5.3 - 2026-08-06

- Prioritized Facebook Page discovery for Outreach targets and made target Facebook and website URLs directly editable.
- Improved target-list navigation with status colors, keyboard up/down selection, and compact target actions.
- Added Admin Agent multi-line input (Shift+Enter) and target context-menu deletion with cascade cleanup of its drafts and deliveries.

## 0.5.2 - 2026-08-06

- Made Outreach fit a 13-inch screen: removed the KPI strip, made the target list independently scrollable, and kept target actions (including Copy) pinned at the top of the detail pane.
- Added target-list context actions and batch draft, approval, copy, status, and URL lookup operations.
- Updated Admin Agent Outreach handling so follow-up Facebook URLs update matching existing targets instead of being skipped as duplicates; Page/sender identity remains unbound until verified.

## 0.5.1 - 2026-08-03

- Reflowed the Event Information header for constrained 13-inch screens.
- Kept event status details on one readable line while action buttons wrap cleanly.

## 0.5.0 - 2026-08-03

- Added optional OpenRouter web research for public press-page recommendations and target enrichment.
- Added source-aware target notes and a downloadable outreach CSV after Agent confirmation.
- Added bounded search usage and rules to leave unsupported Page IDs or contact details blank.

## 0.4.0 - 2026-08-03

- Added conversational Admin Agent setup for Press Outreach campaigns, targets, and Press Kit assets.
- Added an explicit confirmation step before saving and duplicate/URL validation; setup never sends messages or binds identities.

## 0.3.0 - 2026-08-02

- Added human-approved Press Outreach campaigns with target management, AI initial and suggested replies, and manual first-contact workflow.
- Added verified Facebook replies and Press Kit image/link delivery with audit history, idempotency protection, and manual fallback.
- Added outreach dashboard, reminders, assignments, CSV import/export, identity matching, and channel-readiness checks.

## 0.2.1 - 2026-08-02

- Improved direct-ticket preview, print layout, readability, and Thai font output.
- Added class-specific ticket designs, multiple-seat issuing, and direct-seat recovery tools.
- Added seat-map import review, draft persistence, and check-in readiness for direct tickets.

## 0.2.0 - 2026-07-31

- Added VIP and direct-seat allocation with manual payment verification.
- Added Ticket Designer graphics, live preview, PNG, A6 PDF, and A4 printing.
- Added Central Settings for account preferences, access, system version, and feature updates.

## 0.1.2 - 2026-07-11

- Reworked workspace visual hierarchy with fewer container borders and distinct tonal sections in light and dark themes.
- Reserved stronger outlines for form fields, active selections, and actionable controls.
- Consolidated Event Workspace status filters and added a compact desktop show/hide control beside the editor actions.
- Corrected remaining light-only surfaces in the dark public-page preview.

## 0.1.1 - 2026-07-11

- Improved the authenticated workspace experience on mobile devices.
- Removed inherited third-party generator branding from public repository metadata and documentation.
- Updated the application package version to `0.1.1`.

## 0.1.0

- Initial tracked application release.
