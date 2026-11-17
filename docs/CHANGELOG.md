# Changelog

## 0.9.5 - 2026-11-17

- Optimize paid registration proof images before encryption/storage. PNG screenshots use lossless WebP where smaller; JPEG/WebP photos use high-quality JPEG, with 1600px max dimensions. Preserve the original whenever re-encoding would make it bigger.
- Add encrypted payment proof image retention sweeps to the embedded worker: 180 days by default after both proof submission and the booking's last update, only for confirmed/expired/cancelled bookings. Never purge pending review, payment-exception or active booking proofs.
- Configuration: PAID_PROOF_RETENTION_DAYS accepts 30–3650; missing or invalid values default to 180.
- Each hourly worker run clears up to 1000 proof images in small batches, setting paid_proofs.content to NULL and deleted_ms to the purge time. Keep payment attempts, image checksums, booking history and audit records.
- Add image optimization tests and finished-vs-pending proof expiration tests; HTTP proof assertions now compare decoded image pixels.

## 0.9.4 - 2026-11-17

- Linked attendee Customer Area and account editor with clear in-app navigation: Events, My Account, and My Bookings remain one click away.
- Added breadcrumb navigation and persistent Events entry in the Customer App header and mobile menu.
- Profile/Security edit links now carry a constrained return_to route, allowing a reliable return to the correct customer section without browser history.
- Verified responsive links at 320 and 390 CSS pixel viewports and no horizontal page overflow.

## 0.9.3 - 2026-11-17

- Audited guest and signed-in attendee flows in mobile Chromium viewports (320, 360, 390, and 430 CSS pixels), including login, event catalog, profile menu, and external bank-transfer invoice with mocked owned booking data.
- Added Save QR image control so mobile attendees can use the same phone to import a recipient QR into a banking app, plus bilingual guidance.
- Constrained large uploaded payment QR images to the payment card width on small screens.
- Scroll directly to the invoice details when opening a newly placed booking by reference.
- Removed the misleading secondary No orders yet message when the attendee already has paid registrations.

## 0.9.2 - 2026-11-17

- Complete external/manual bank-transfer registration UX: Reserve leads directly to the attendee's private payment invoice in My Bookings, with amount, reference, deadline, organizer bank account and uploaded QR.
- Reuse the existing encrypted payment slip upload with bank_transfer method in external/manual mode; submission transitions the booking to verification_pending. My Bookings includes the full invoice and submission flow for revisits.
- Existing staff Paid Registration Reviews can inspect the uploaded slip and approve only after independently matching actual bank transfer, issuing distinct attendee admission QR tickets.
- Existing paid_booking.confirmed transactional email notification is now bilingual Thai/English; delivery requires a configured email provider.
- Distinguish publishing a bank-transfer event from the separate requirement to configure PAID_PROOF_ENCRYPTION_KEY for secure slip uploads, with actionable admin/error messaging.
- Added HTTP regression: external bank details, private slip upload, staff review, credential issuance, and queued confirmation email.

## 0.9.1 - 2026-11-17

- Added shared customer profile avatar and dropdown navigation across the public Event Catalog and Event pages.
- Signed-in customers see their name, Profile, My Bookings, Browse Events and Sign out; guests see Register and Sign in.
- Customer session refreshes when returning to the browser tab; the booking card no longer duplicates the My Account navigation.
- Added responsive header menu, keyboard escape/outside-click dismissal, and light/dark accessible colors.

## 0.9.0 - 2026-11-17

- Event Paid Registration now checks the actual customer account session before showing account controls.
- Signed-in attendees see their name/email and "Book places" and "My account" actions, not misleading "Register" and "Sign in" buttons; unverified emails show a reminder.
- Customer session is refreshed on focus/visibility when returning from a registration/login tab, and the primary booking contact is prefilled from the account.
- Unauthenticated visitors continue seeing the concise bilingual Register / Sign in actions, with light/dark theme styling preserved.

## 0.8.9 - 2026-11-16

- Fixed Paid Registration admin activation/readiness color contrast for both light and dark themes, especially the washed-out pale status panel, unreadable links, and error/check text.
- Added dedicated semantic style classes with matched background/foreground palettes, accessible link and focus colors, and improved diagnostic section contrast.

## 0.8.8 - 2026-11-16

- Condensed the public Paid Registration account introduction into short Thai/English text and two plainly labeled account actions, eliminating redundant explanatory paragraphs.
- Styled the registration account card, primary and secondary buttons, and external payment notice with deliberate light/dark background and foreground contrasts, including focus-visible states.
- Shortened the unavailable-booking message in both languages, preserving account signup visibility.

## 0.8.7 - 2026-11-16

- Return exact missing deployment-variable names when publishing Paid Registration is rejected, without returning any secret values.
- Explain that selecting PromptPay still requires an active Organizer receiver and that uploading an existing bank QR does not switch the payment mode; provide the exact External/Manual action on the Event configuration screen.
- Preserve Event data and safeguards; publishing never silently changes payment mode.

## 0.8.6 - 2026-11-16

- Display prominent attendee Create Account and Sign In links directly on paid event pages, even if Paid Registration is not currently bookable. Registration remains account-based and email verified, without Facebook.
- Show the exact Railway customer-account and paid-registration variables in the Event's Paid Registration settings, next to links to test account registration and login; preserve the advanced diagnostics section.
- Fix web-only bot session initialization in production by deriving a domain-separated stable session key from the existing private PostgreSQL connection credential if optional chat/media/ticket secrets were not configured.
- Do not bypass the existing paid booking financial or customer authentication safeguards. The deployment must still enable customer registration explicitly.

## 0.8.5 - 2026-11-16

- Consolidated event paid registration into one workflow: payment mode, recipient QR and bank details, capacity/pricing, and Save & Open Registration.
- Bank details are saved before publishing by the same primary action; QR uploads save directly with image validation.
- Removed duplicate payment-display save controls and hid advanced diagnostics in a collapsible troubleshooting section.
- Existing event data is retained; payment/server readiness requirements remain enforced.

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
