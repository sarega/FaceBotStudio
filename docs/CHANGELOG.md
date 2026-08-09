# Changelog

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
