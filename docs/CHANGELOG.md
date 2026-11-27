# Changelog

## 0.11.38 - 2026-11-27

- Make attendee roster and chat ticket batches collapsible with compact summary headers.
- Keep report actions available when the attendee roster is collapsed.
- Remove nested vertical scrolling from attendee tables and chat batches while retaining horizontal table scrolling.
- Expand the roster automatically for search focus and event statistics filters.

## 0.11.37 - 2026-11-27

- Align registration operations in a continuous two-column workspace, with roster first and collapsible sticky event statistics.
- Open room and carpool planning as dedicated full-screen workspaces while preserving unsaved drafts on return.
- Refresh clean logistics plans when reopened.

## 0.11.36 - 2026-11-27

- Show existing and new refund liabilities, additional payments due, gross receipts and net cash in event statistics and reports.
- Separate new booking balances from confirmed booking adjustments.
- Allow ordinary attendee price corrections in both directions and include refund and additional-payment worklists in accounting PDF.

## 0.11.35 - 2026-11-27

- Adjust confirmed attendee room preference and price without replacing verified slips or QR credentials.
- Record completed partial refunds and external disbursements separately from booking receipts, with outstanding surplus and audit history.
- Separate actual receipts, booking value and surplus settlement in accounting PDF and CSV reports.

## 0.11.34 - 2026-11-27

- Add customer profile editing, password reset requests, suspension, reactivation and session revocation.
- Protect staff-linked accounts and scope customer access by organization.
- Add server-side search, filtering and pagination.

## 0.11.33 - 2026-11-27

- Open room assignments in an expanded viewport workspace with independently scrolling guest and room lists.
- Consolidate room creation into one menu and move exports, automatic drafting and reload into Actions.
- Keep Save, search fields and assignment counts visible; preserve the draft when exiting the expanded workspace.

## 0.11.32 - 2026-11-27

- Prioritize daily operations and customer management in the sidebar, with registrations as the default admin workspace.
- Group Bot Simulator under Agent and move configuration tools into workspace setup.
- Add event-level bot and channel assignment with searchable reusable connections, immediate linking and unlinking, and existing routing safeguards.

## 0.11.31 - 2026-11-27

- Show actual attendee names in collapsed booking review rows and beside payment slips; tuck account-owner information into optional details.
- Remove proxy account names and fallback account contact information from operational registration reports while preserving full historical exports.
- Add compact staff editing of configured seminar registration answers at booking and attendee level.
- Persist individual field locks, enforce them in staff and customer preference edits, and audit changes. Keep pricing changes explicit and separate.

## 0.11.30 - 2026-11-26

- Balance slip preview size with a responsive 420px height limit and equal-width booking and slip columns. Keep full-screen zoom available.

## 0.11.29 - 2026-11-26

- Correct recorded slip amounts before or after approval with audit history and preserved evidence.
- Recalculate outstanding balances after correcting a single verified payment.
- Enlarge payment slip previews and add a full-screen viewer with independent zoom.

## 0.11.28 - 2026-11-26

- Display payment warnings in attendee rows and collapsed booking summaries; refresh review counts independently every 15 seconds.
- Allow clearing manual price flags after reopening payment.
- Show actual attendee names on customer orders and beside payment slip upload forms.
- Simplify the meal roster into readable portrait pages with food-group totals and names, without booking references.
- Name registration and logistics exports by report purpose, event and Bangkok date.

## 0.11.27 - 2026-11-26

- Allow scoped administrators to revoke an incorrectly approved single payment slip, reopen payment and release the duplicate-proof claim.
- Remove the incorrect image, retain an audit record, revoke old QR passes and issue new passes after correct approval.
- Protect checked-in bookings and multiple verified payments from unsafe reversal.

## 0.11.26 - 2026-11-26

- Add shared and hired vehicles to carpool planning with independent capacity and external driver details.
- Assign passengers across private and shared vehicles, with departure and notes.
- Include shared vehicles and logistics details in CSV and PDF reports.

## 0.11.25 - 2026-11-26

- Add independent event logo, header background and three public page layouts.
- Preview unsaved appearance in desktop and mobile widths.
- Reset appearance without changing registration, poster or platform branding.

## 0.11.24 - 2026-11-26

- Publish and unpublish approved translations immediately, without a second Save Event Setup action.
- Request the selected public locale on initial load and on language changes; cancel stale requests and bypass cached event content.
- Show the current language using a flag and language name in the public header.

## 0.11.23 - 2026-11-26

- Move language-specific event title, summary and rich HTML description editing into Event Setup.
- Preserve the last approved translation while editing or generating a new draft.
- Save language drafts and explicit publication through Event Setup.

## 0.11.22 - 2026-11-26

- Add event-scoped source language and persisted multilingual public content.
- Generate editable translation drafts through OpenRouter, review and explicitly publish or unpublish.
- Flag changes to source content; retain original content as fallback.
- Localize public catalog and event detail without changing stable slugs, maps, prices or registration data.

## 0.11.21 - 2026-11-26

- Add searchable event access selector with lifecycle filters, local per-user preferences and paginated selection.
- Default Event Workspace to current events; add workspace pagination and searchable header switching.
- Add owner bulk archive for completed and cancelled events without deleting records or assignments.
- Add optional filtered/paginated event API responses; preserve legacy list clients.
- Reject public automated conversations for non-active events.

## 0.11.20 - 2026-11-26

- Simplify publishing visibility to Public, Unlisted, or Private (public page disabled). New public pages are listed when active; existing visibility remains unchanged.
- Include information-only events in the public catalog without requiring registration or ticket sales.
- Let owners save staff roles and event assignments together. Admins may have all events or selected events; existing admins retain all-event access until changed.
- Revoke staff sessions after permission updates and audit changes. Restrict scoped admins from organization-wide actions.

## 0.11.19 - 2026-11-26

- Add Single Event, Recurring Event and Ongoing Campaign types to existing event creation and settings.
- Keep recurring activities and campaigns active without an end date; provide a recurring schedule description.
- Inherit the existing global agent prompt and use the campaign Event Context and event-scoped knowledge and conversation. Disable automated registration and ticket tools in enquiry-only campaigns.
- Show the inherited prompt read-only in campaign Context; preserve existing paid events and channel assignments.

## 0.11.18 - 2026-11-26

- Allow every staff role to switch to the attendee experience and make returning to the staff workspace visible.
- Export active attendee rosters (confirmed and pending) to CSV and PDF.
- Include paid and outstanding payment totals in attendee roster exports, counting each booking once.

## 0.11.17 - 2026-11-25

- Add the event-scoped Room & Transport Coordinator role for staff who manage room assignments and carpools.
- Download separate PDFs from the saved room and carpool plans, with a card for each room or car.

## 0.11.16 - 2026-11-25

- Show the carpool discard confirmation only when the current plan has unsaved changes.
- Place the return-to-queue button next to the booking search and remove the repeated filter reference.

## 0.11.15 - 2026-11-24

- Add a right-click menu and an Add room button in Room Assignments. Choose a preset or set a capacity from 1 to 50 beds.
- Export team-ready CSVs for active, confirmed, or pending registrations from the Actions menu. Include ticket prices, meal preferences, and contact details, and omit inactive records, flagged prices, matched duplicates, and internal IDs.

## 0.11.14 - 2026-11-24

- Give the guest and room lists more vertical space while keeping each list independently scrollable.

## 0.11.13 - 2026-11-24

- Keep room cards at their full height in the scrollable Room Assignments grid so new rooms and bed controls remain accessible.

## 0.11.12 - 2026-11-24

- Add optional phone numbers for individual attendees during registration and booking edits so staff can contact guests directly on group bookings.
- Open Checker accounts in the check-in workspace. Show attendee details and seat and check-in counts, and omit financial data from Checker screens, API responses, and roster exports.
- Give the unassigned guest list and room list separate scrolling and search. Highlight the bed or unassigned area that can accept the current drag.
- Fix room plan saves when staff and attendee sessions share a browser. Keep the draft on screen after a failed save and show the reason beside the save button.

## 0.11.11 - 2026-11-24

- Download event-scoped accounting, payment follow-up, coupon and VIP, and attendee and meal PDFs from the registration Actions menu.
- Count financial totals once per booking, show the attendee names for group bookings, and keep registration and payment statuses distinct.

## 0.11.10 - 2026-11-24

- Let owners preview staff and attendee experiences without leaving their session. Preview requests are read-only.
- Make the registration roster resizable, shorten booking references, and show slip and booking statuses in the review queue.

## 0.11.9 - 2026-11-23

- Include paid registrations in Operations reports and align paid roster permissions with legacy registrations. Notify operators about booking activity.
- Streamline public event cards and preserve full event posters on mobile and desktop. Improve attendee payment reminders and booking navigation.
- Unify booking management and slip review with sorting, attendee names and prices, slip history, staff uploads, AI-assisted slip reading, and support for early transfers.
- Flag and correct attendee prices, notify customers about balances, review split payments, and apply coupons to eligible unpaid bookings. Record refunds or issue booking credits.
- Add room assignments and carpool planning, with color-coded room and registration statuses.
- Link staff and attendee accounts and improve staff activation, profiles, and password recovery.
- Reject duplicate attendee names within a booking or across active bookings when unique names are required, including when restoring a booking.

## 0.11.8 - 2026-11-20

- Invite staff by email from Team Access with a role and event assignments. The recipient verifies the address and sets their password using a one-time link that expires after 24 hours.
- Existing staff can verify their email in My account. Staff continue signing in by username, and on-site Gate access keys use the existing flow.
- Show pending invitations in Team Access and allow authorized managers to resend them. Disabling the account invalidates outstanding links.
- Slip Review shows when a booking filter is active and lets staff return to the full queue. Restore the audit summary pagination parameters used by both database adapters.

## 0.11.7 - 2026-11-20

- Synchronize Admin Notification Inbox read/archive state between devices using database-backed user/organizer/event-scoped acknowledgements, instead of browser localStorage as the source of truth.
- Add portable migration 056_admin_notification_state.sql for PostgreSQL and SQLite: per-admin/event preferences (read-all high-water mark, migration flag) and per-audit-ID read/archive timestamps. Do not copy or delete any original Booking, slip, ticket or audit records.
- Add authenticated GET/POST /api/events/:eventId/admin-notifications/state with scoped authorization and validated read, read_all, archive, restore, restore_all and one-time import operations.
- Use transactionally merged per-ID upserts so two devices cannot replace each other's state. One-time localStorage import preserves previously read/hidden alerts and prevents stale migrations on other devices.
- UI persists actions to the database and synchronizes with existing 30-second polling. Mark all read covers the Event's entire audit history. Stale polling results cannot override a recent save.
- Test per-user isolation, multiple DB connections, migration idempotence, read/archive/restore, read_all, forged IDs and authenticated HTTP operations.
- Desktop/Telegram/Email channels remain separate; read/archive is for the signed-in Admin, not the entire Admin team.

## 0.11.6 - 2026-11-20

- Repair in-app Admin Notifications: missing Refresh, no recovery for dismissed items, and fixed 40-entry limits.
- Add Inbox, Unread and Archived tabs; Mark all read, Archive read, single-item Archive/Restore, Restore all and manual Refresh.
- Persist per-user/per-event view state in this browser with cross-tab synchronization and migration of legacy numeric read timestamp.
- Expand paid booking audit feed to include payment review outcomes and booking lifecycle events.
- Support paged audit history (default 100, up to 200 per page) with Load older. Periodic polling merges fresh data with previously loaded pages.
- Read/archive operations never delete bookings, proofs or audit events. Surface API errors with a retry button.
- Add tests for read/archive/restore, pagination and approved-slip notifications.
- Limitations: read/archive is not synchronized across devices; feed is for the selected Event and paid booking activities. External Desktop/Telegram/Email channels use different delivery state.

## 0.11.5 - 2026-11-18

- Make email verification a prominent next step after customer registration. New customers land on the dedicated /account/check-email page instead of a small English-only notice on Sign in.
- Display a bold bilingual Thai/English message, the registered email address, Inbox/Spam guidance, and an obvious Resend verification email action. Do not claim a message was sent when email delivery could not be queued.
- Signed-in but unverified customers see the same actionable warning on their account screen, and a reminder from the Customer App and public Event registration pages.
- Reuse the existing rate-limited resend API and keep server-side verified-email requirements in place.
- When the check-email route is refreshed without a saved signup email, allow the customer to enter their address and request a replacement link.
- Browser-tested at 390px and 1280px in Light and Dark themes, with no horizontal overflow or JavaScript errors.

## 0.11.3 - 2026-11-17

- Improve low-contrast text and mismatched backgrounds in the dark-mode Registrations admin sections, especially Coupons & Promotions, Slip Review, Paid Attendee roster, and Booking/Event Stats.
- Introduce scope-specific, paired foreground/background colors for editable coupons, input controls, payment-review cards, review status counts, attendee table headers and alternating rows. Preserve the light-theme appearance.
- Remove conflicting generic Tailwind background classes where the global dark-theme !important palette was overriding registration-specific colors. Use component-owned class names for reliable dark rendering.
- Raise tiny captions to 12px, increase muted text contrast, and improve field/keyboard focus visibility without reducing primary action or body text size.
- Verify actual computed background colors in Chrome at 390px and 1280px, dark/light, with no horizontal page overflow or JavaScript errors.

## 0.11.2 - 2026-11-17

- Resolve the disconnected Event administration reporting: original registrations data and paid booking attendees are separate durable sources. Show all named attendees in the original Registrations screen without inserting duplicates into the legacy registrations table.
- Add organizer-scoped paid attendee roster API, one row per person, with the booking reference, purchasing customer, category, payment/booking status and check-in state. One booking for four people displays four attendee rows.
- Event Stats now include confirmed paid attendees and active seat holds alongside the original attendee totals, showing the correct Paid Registration seat capacity and separate counts of bookings awaiting payment, pending slip review and confirmed.
- Event Workspace Registration Rules also show paid seat occupancy and distinguish the legacy editable capacity from Paid Registration capacity. Refresh the Registrations roster and stats on payment review changes.
- Existing Event registrations Excel/CSV export combines paid and legacy attendee rows. Preserve original export columns; add Event/Booking/Customer identities, source, category, status, food, accommodation, arrival/departure, room preference, transport, notes and check-in information.
- Customer management gains all-Events attendee CSV with one row for each person, including both free and paid Event registrations; the existing booking-level CSV remains separately available. Restrict exports by organizer and reject oversized datasets instead of silent truncation.
- Decode saved seminar answers in the correct normalized array format so hotel Food and Accommodation preferences are actually included in exported data.
- Add database and HTTP tests for attendee-level grouping, account attribution, organizer isolation, and one-Event/all-Events CSV; verify responsive UI at 390px and 1280px. Remaining cross-product legacy-only reporting is documented for follow-up.

## 0.11.1 - 2026-11-17

- Unify the three Paid Registration administrator panels (Registration Settings, Coupons & Promotions, Slip Review) using one reusable accessible header component: matching icon boxes, text size and weight, subtitle spacing, chevron toggle and focus treatment.
- Assign distinct color identities: Registration Settings blue, Coupons purple, and Slip Review green. Provide paired light and dark theme palettes with accessible text/background contrast and consistent borders and padding.
- Make collapsed sections genuinely compact and remove empty settings body space while closed. Reposition Slip Review Refresh as a small secondary header action available only when expanded.
- Shorten bilingual headings to keep all three headers at the same 55px height on narrow screens and 59px on desktop. Responsive layout verified at 390px and 1280px in light/dark themes, with no horizontal overflow.

## 0.11.0 - 2026-11-17

- Correct misleading Customers metrics: prior Paid orders counted only the legacy direct-ticket order system and ignored actual paid-registration bookings. Show separate account/email counts, all-event Bookings, Awaiting Payment, Slip Uploaded / Awaiting Review, Confirmed, Expired/Cancelled, and legacy Ticket Orders.
- Add searchable, status-filterable Bookings across Events table showing Event, Customer account, booking reference, number of attendees, amount, status, registration time, transfer time and slip upload time. Each booking remains separate from its attendee count.
- Link individual accounts to their event bookings and enable bidirectional navigation between event review queue and the exact customer profile and event reference.
- Include verified customer identity, email, phone, event name/id, booking reference/id, and booking timestamps on payment proof review list and detail; even unpaid bookings show their account owners.
- Add Export Bookings (Excel/CSV): UTF-8 BOM CSV across organizer-owned Events with Event ID, Customer ID, booking ID/reference, name, email/phone, attendees, amounts, payment/booking status, booking/due/transfer/slip times. Neutralize CSV formula injection.
- Use organization-scoped SQL in both SQLite and PostgreSQL to avoid mixing booking data across organizers. Report supports 10,000 newest bookings; the interactive table shows the first 300 filtered records.
- Added DB and HTTP tests for customer attribution, organization isolation, CSV access/content, and verification-pending status. Responsive Customer UI checked at 390px and 1280px.

## 0.10.9 - 2026-11-17

- Redesign the Customer Paid Booking payment page into four clear numbered steps: **1 Amount to pay**, **2 Scan payment QR / transfer to bank account**, **3 Upload payment slip**, and **4 Wait for organizer confirmation**.
- Make payment slip selection and submission prominent. The booked amount is pre-filled, and a provisional current transfer time is initialized when the slip is selected; the customer can correct either under an expandable advanced section. Move technical attendee/coupon details into a disclosure.
- Redesign Admin payment review as an inline bank-transfer comparison: attendees and amount, customer's reported amount/time, and a secure inline slip image with a link to enlarge. Make **Confirm funds received & Approve** the primary explicit action; rejection and detailed adjustments are secondary.
- Use the booking amount and submitted transfer time automatically; no recurring amount, time or review reason typing for routine external/manual payments. A per-proof audit reference is supplied when the customer did not provide a bank transaction ID, while independent bank verification remains the administrator's responsibility.
- Disable the routine approval action for submissions with missing proof, mismatched amount or known duplicate proof. Preserve server-side version/idempotency checks, immutable audit trail, duplicate detection, actual approval state transition, ticket issuance and confirmation email queue.
- Prioritize bookings with uploaded proof ahead of bookings still awaiting uploads in the Admin review queue. Keep the broader booking operations and statistics accessible but outside the main review flow.
- Browser-tested Admin review and customer four-step payment flow at 390px and 1280px with no horizontal overflow or JavaScript errors; backend approval test covers the streamlined review payload.

## 0.10.8 - 2026-11-17

- Compact the Event Workspace layout for one event, particularly on 13-inch laptop screens. Remove the unused Search / Filter / Sort / lifecycle counts when a single event is selected, while retaining New Event and Refresh controls.
- Display that single event as a compact 64px selection row in place of the much taller event card. The compact Event Workspace is not a separately scrolling panel; multi-event lists retain their full controls and scrolling.
- Reduce spacing, card padding and action button stacking in Event Information and Registration Rules; keep fields and navigation usable on narrow and desktop screens.
- Browser-check responsive single-event layout at 390px, 1280px and 1440px: no horizontal overflow, no nested panel scroll, no runtime errors. New Event restores full creation/search/filter UI.

## 0.10.7 - 2026-11-17

- Add configurable default answers to each customized Seminar question in Event Paid Registration Settings, including Accommodation needed (Yes/No). Defaults are populated as real editable answers for the first and every additional attendee.
- Food Preference now supports either original free-text entry or a dropdown of 2–20 unique Admin-defined choices; switching to dropdown supplies Vegetarian and Non-vegetarian as editable starter options.
- Admin can optionally choose a default Food option. The Public Event form uses those choices and defaults for the selected booking/attendee scope.
- Server validates and persists configured options/defaults within existing paid_event_forms JSON (no schema migration); it rejects food answers outside the configured dropdown choices while retaining backward compatibility for Events with the old free-text field.
- Add validation before settings save and regression tests for defaults, custom food lists, persisted catalogs, attendee responses, and accommodation discount calculations.
- This change does not alter previously submitted booking answer snapshots or force any default on existing Events.

## 0.10.6 - 2026-11-17

- Correct Coupon Apply error ordering: verify coupon code syntax independently instead of conflating a blank accommodation answer with coupon validity. YOGISUPPORT is a valid code under the shared normalization and formatting rules.
- Coupon Preview now uses the current displayed category/base amount when Accommodation has not been selected, and discounts the live adjusted price after a Yes/No choice. Preview marks an unanswered accommodation-based amount as provisional and explains that final selection is required before reservation.
- Final booking still requires configured mandatory seminar answers and independently recalculates all prices and coupon eligibility; customers cannot bypass accommodation requirements by applying a coupon early.
- Return precise coupon_invalid only for actual malformed code input, and distinct coupon_not_found for valid codes that are not registered to the selected event.
- Add HTTP regression with YOGISUPPORT and an accommodation-dependent category, verifying full/reduced quote, format-vs-not-found errors, and required final booking validation.

## 0.10.5 - 2026-11-17

- Fix root cause of Coupon Apply CSRF rejection when an organizer tests the public customer checkout while signed in to Admin in the same browser. The coupon preview POST was missing from the customer-scoped CSRF route matcher, so it incorrectly expected the Admin CSRF cookie despite receiving the valid Customer CSRF token.
- Explicitly classify `/api/public/events/:slug/paid-registration/coupon-preview` as a customer-scoped CSRF route (including an optional trailing slash). Preserve origin checks and strict customer token validation; do not relax CSRF security.
- Regression-test dual Admin + Customer sessions: the correct Customer CSRF token is accepted, the Admin CSRF token is rejected, and the coupon preview returns the correct 100%-free total.
- Add bilingual actionable CSRF failure messages for session/origin issues in the coupon form.

## 0.10.4 - 2026-11-17

- Fix Event link in Coupons & Promotions. The previous implementation incorrectly used internal event.slug instead of the canonical public slug resolved from Event Settings event_public_slug, so following the coupon link could open a non-existent or unrelated public page.
- Resolve the coupon owner event by its scoped Event ID and return its canonical Public Event slug, event name, and public-page enabled status using the same slug logic as the actual public page API.
- Display the owning Event name, canonical public slug and immutable Event ID in the coupon manager. Only show the public-page link if that event's public page is enabled; otherwise explain that it is not published.
- Preserve current coupon ownership and redemptions. Do not automatically reassign coupons to a different event merely because an old link was wrong.
- Add HTTP regression test with different internal and custom Public Event slugs, asserting the Admin link resolves to the exact same event and that the disabled-page state is recognized.

## 0.10.3 - 2026-11-17

- Diagnose why an apparently enabled coupon is rejected in Public Event Checkout: split the former coupon_unavailable error into coupon_not_found (event/code mismatch), coupon_disabled, coupon_not_started, and coupon_expired.
- Make saved coupon eligibility visible in Admin, calculated from the server clock with Active / Scheduled / Expired / Disabled / Fully Used states. Preserve quota accounting across event bookings and help distinguish active status from date/limit eligibility.
- Show the coupon-owning Event ID and a direct link to the matching public Event in the Admin Coupons section, making mistaken event selection visible.
- Harden activation state parsing for PostgreSQL numeric/string representations.
- Add database and HTTP regression coverage for exact event binding and distinct coupon rejection reasons.
- Production customer-specific coupon rejection could not be confirmed without the signed-in browser response; the new diagnostic status and returned error code enable precise follow-up.

## 0.10.2 - 2026-11-17

- Replace the generic coupon verification failure in Public Event Checkout with actionable Thai/English explanations for disabled, expired, fully redeemed, stale pricing, unselected accommodation, expired customer session, and internal errors. Unexpected error codes are surfaced rather than silently hidden.
- Normalize coupon codes before API submission, prevent old asynchronous coupon previews from overriding newer edits, and avoid accidentally reserving without applying a typed coupon.
- Emit private server logs for unexpected coupon quote failures (no personal fields, credentials or coupon codes logged) to aid Railway production diagnostics.
- Confirmed the Production public seminar catalog is available and requires authenticated customer sessions for private coupon quote calls. The exact user-specific rejection shown in a screenshot cannot be determined without the authenticated response/log.
- Added automated bilingual coupon failure regression; existing booking, payment and coupon API tests pass.

## 0.10.1 - 2026-11-17

- Fix Coupons & Promotions white screen when editing saved coupons: PostgreSQL BIGINT date fields are returned as numeric strings. Parse timestamps into numbers and safely handle invalid dates before formatting datetime-local controls.
- Replace ambiguous clickable coupon cards with explicit **Edit**, **Duplicate**, and **Delete** actions. Editing preserves the existing immutable code; Duplicate clones its settings into a new unsaved coupon that requires a new code.
- Support permanent deletion of unused coupons through a scoped, authenticated DELETE API and database method; require a confirmation in the UI.
- Prevent deletion when the coupon has any historical booking redemption, including expired holds. The UI explains to disable Active instead to retain financial audit history.
- Add database and HTTP regression tests for unused-coupon removal, repeated removal, unauthorized deletion, historical deletion block and disabling coupons.
- Verify Edit, Duplicate and Delete in Chrome at 390px/mobile and 1366px/desktop with PostgreSQL-shaped string timestamps and no runtime errors.

## 0.10.0 - 2026-11-17

- Introduce Event-scoped Coupons & Promotions under Registrations, with editable, enable/disable rules and use counts. Support percentage, fixed THB, and complimentary (100% free) codes, optional active dates, overall quota and per-customer quota.
- Checkout includes Apply Coupon preview with a backend quote based on actual category/accommodation selections. Recompute and validate authoritatively inside the atomic paid-booking transaction; allow at most one coupon per booking, prevent silently ignoring un-applied codes.
- Persist immutable coupon subtotal and applied discount snapshots on each booking and display breakdown in My Bookings. Previously placed bookings keep their original financial amounts when an admin changes a rule.
- A zero-THB coupon booking is immediately confirmed and verified with attendee admission QR credentials and a bilingual complimentary confirmation email; no bank transfer or slip upload.
- Reserve coupon usage for live unpaid holds as well as verified bookings; automatically release quota for expired/cancelled holds. Reinstating an expired coupon booking re-checks promotion dates, enabled state, and quota.
- Add Postgres migration 054 and idempotent SQLite table migration supporting zero-THB booking totals, preserving historical data.
- Add end-to-end HTTP and database tests for admin authorization, preview, percent/fixed/free discounts, use limits, expiry reclaims, idempotency, zero-total credentials and email queue.
- Validate mobile coupon checkout at 320px, 390px and desktop 1366px.

## 0.9.9 - 2026-11-17

- Added a configurable no-accommodation discount to each paid registration category (adult, child, etc.), with backward-compatible 0 THB default.
- Admin Paid Registration Settings can enter a THB deduction for customers choosing No for accommodation. An event using the discount must enable Accommodation needed at For each attendee, allowing different choices within one family booking.
- The public form shows the per-attendee adjusted amount and updates the total immediately; the server independently validates the configured rule, attendee answers and final amount before creating the invoice.
- Persist a per-attendee pricing snapshot with the full price and applied discount, show net attendee price and accommodation deduction in My Bookings; prior bookings remain unchanged when Admin updates pricing.
- Added PostgreSQL migration 053 and idempotent SQLite column migration preserving existing data.
- Added regression tests for adult/child mixed selections, server-side discount calculation, saved attendee prices, missing answers, and invalid discount rules.

## 0.9.8 - 2026-11-17

- Simplified the paid Public Event registration sidebar. Signed-in attendee identity is represented by the header avatar only; guest sign-in remains compact and email verification is still prompted when needed.
- Previous paid bookings appear as short, expandable status strips (amber for payment required or expired, green for cleared/confirmed). The booking reference, amount, deadline and account recovery link are available inside the disclosure.
- Added an attendee TH/EN toggle in the public Event header with local preference persistence. Localized the public header, account menu, main event metadata, paid registration form and configured seminar field labels. Event organizer-authored content is not machine-translated.
- Reduced global Public Event small-text inflation, condensed spacing in the payment panel, removed the redundant paid registration status tile/hero action and eliminated the sticky long booking sidebar.
- Simplified event header scrolling: only the compact attendee navbar is sticky. The branding bar participates in normal page flow, avoiding layout-height changes while scrolling.
- Kept the sanitizer/editor HTML layout CSS unchanged to preserve parity; validated its browser/server HTML rendering tests.
- Verified Public Event with the published seminar payload and mocked customer booking at 390px and 1366px widths: no page overflow, language switching and persistence, no duplicate signed-in card, collapsed pending booking, and no nested sticky sidebar.

## 0.9.7 - 2026-11-17

- Fix Public Event Paid Registration dead-end: a cached previous booking no longer hides the new booking form, including when previous booking is expired, pending or confirmed.
- My Bookings now offers customer-initiated reactivation of their own expired, unpaid booking; the server rechecks registration window, capacity, quotas and payment state, preserving the original attendees/reference.
- Expired reactivation opens a new payment deadline according to the currently configured event hold duration. It never reopens verified, submitted-proof or non-expired bookings, and does not silently duplicate attendees.
- Customers can separately book additional attendees from My Bookings by returning straight to the original Event; a new booking receives its own invoice and QR after approval.
- New paid Events default to a 24-hour payment window. Existing Events have an explicit 24 hours (1440 minutes) shortcut in Paid Registration Settings; this must be saved to update the existing Event.
- Added database and HTTP regression coverage for account ownership, 24-hour reactivation, capacity retention and repeat booking.

## 0.9.6 - 2026-11-17

- Accept no-cost attendee categories in paid event settings (Price = 0) and store zero-price attendee records with normal names, capacity counting, and admission credentials.
- Add PostgreSQL schema migration and idempotent SQLite schema update preserving existing category/attendee rows.
- Public registration labels zero-price categories "ฟรี / Free"; mixed paying adult and free child bookings calculate their total correctly and issue admission QR for every attendee once approved.
- A booking with no paying attendee is not yet supported in the paid payment workflow; explain this before Reserve instead of a confusing server failure.
- Tested mixed booking with two adults and one free child, including payment approval and three issued credentials.

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
