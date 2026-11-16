# FaceBotStudio — Paid Registration
## Product Requirements Document and Implementation Plan

**Version:** 0.2 (confirmed product decisions)
**Date:** 2026-11-16
**Project:** FaceBotStudio
**Status:** Technical design review requested; implementation not yet authorized until Phase 0 review.

## 1. Objective and boundaries

Introduce Paid Registration for seminars, retreats, workshops and multiday events within the existing FaceBotStudio Event model. Customers can reserve a place before paying, register groups, upload payment proofs, and receive attendee QR check-in credentials only after full payment has been manually verified.

Preserve all existing Free Registration and Direct Ticketing behavior. Avoid coupling seminar bookings to seating/seat maps just to reuse payments.

**Decisions explicitly confirmed:**
1. A successful booking temporarily holds capacity, with a payment deadline.
2. Full payment is required; no installments/deposits in MVP.
3. Group booking is required in the first release.
4. Issue usable QR only after Booking becomes Confirmed.

## 2. Existing architecture: preliminary findings

Code inspection identified Event Management, Organizer Financial Profiles, PromptPay settings, Direct Orders, Payment Attempts, manual payment proof submission and verification, Event registration, check-in and QR, and Messenger Bot integration. Relevant code includes `server.ts`, `backend/db/postgresAdapter.ts`, `backend/db/sqliteAdapter.ts`, and `backend/db/types.ts`. Direct-ticket order payment logic is associated with seats/tickets. **Do not assume payment reuse is safe until Phase 0 confirms exact contracts, transaction boundaries and lifecycle differences.**

## 3. Event modes

Add a backward-compatible event-level registration mode:
- `free`: unchanged free-event registration.
- `paid_registration`: new booking + full-payment + manual verification lifecycle.
- `direct_ticketing`: unchanged seat/ticket checkout.

Existing events must retain effective behavior after migration; do not globally change existing defaults. Paid Registration respects event- and organizer-level authorization boundaries.

## 4. Booking, attendee and capacity model

**Booking**: booking ID, event/organizer IDs, primary contact, booking state, payment state, currency, total due, deadline, immutable price snapshot, created/updated timestamps.
**Attendees**: distinct attendee IDs, booking ID, names, optional contact data, category, price snapshot, custom answers, registration and check-in state. A group booking has multiple attendees, one primary contact, one combined amount due and one full-payment obligation in MVP.

Atomic capacity formula: `available = max_capacity - confirmed_attendees - active_held_attendees`. An unpaid group booking holds as many capacity units as attendees. Capacity checks and hold creation must be protected by a DB transaction/concurrency control; prevent oversubscription, concurrent duplicate bookings, negative capacity and race conditions. If categories have quotas, validate both category and event capacity.

**Deadline**: event configurable hold duration (proposed default 48 hours, NOT confirmed) and optional absolute payment cutoff. `due_at` is the earlier applicable deadline. Without a valid proof submitted by the deadline: expire booking and release held units exactly once. Proof submitted before due date pauses routine expiration pending review; flagged pending review requires admin escalation. Rejected proof may resume a defined remaining payment window rather than silently extending indefinitely; define explicitly during Phase 0.

Late transfer cannot automatically restore a released hold. Admin reinstatement must recheck live capacity and be audit logged; otherwise waitlist, resolution or manual refund path.

## 5. Lifecycle and financial truth

Booking lifecycle (proposed): `awaiting_payment`, `verification_pending`, `confirmed`, `expired`, `cancelled`, `payment_exception`.

Payment lifecycle (proposed): `unpaid`, `proof_submitted`, `verified`, `rejected`, `underpaid`, `refunded`. Attendee/check-in statuses are separate from money state.

**Only verified full payment** can advance booking to Confirmed, subject to valid hold and conditions. Uploading an image is never proof of funds. No QR capable of check-in may be issued before confirmation. Maintain amount precision, single currency per booking, full amount due, trusted verified totals and remaining balance. Detect inconsistent amount/duplicate reference and route to manual resolution. Do not allow duplicate approvals, messages or financial recording under retry/replayed webhook.

## 6. Pricing and group registration

Event configurable fees by attendee category; optional discount rules subject to future scope. Snapshot prices at booking creation; subsequent event price changes do not silently alter existing bookings. During MVP a booking contact submits all attendees and pays **the full combined amount**; no group-member split payment, installments or partial allocations. A single proof/verified transfer may settle the booking. If verified amount differs from due amount, do not confirm; route to manual exception workflow.

Group edits affecting attendee count or pricing must atomically revalidate capacity and payment obligations. Safe name correction with audit can be offered. Attendee QR is individual even when payment is group-level.

## 7. Payment evidence, verification and security

Payment methods for MVP: PromptPay/bank transfer using existing organizer financial profile where compatible; admin manual payment recording with audited source.

Proof: private file storage, validated content/size/MIME, JPEG/PNG/WebP, upload time, claimed transfer amount/date, reference, uploader identity, booking link, checksum/fingerprint. Check duplicates against same and other bookings and surface warnings; duplicate heuristics are not bank verification. Must protect private media with authorization and short-lived access as applicable. Never expose full bank slip via unrestricted URL.

Verification queue: inspect booking/attendees/amount/proof, approve/reject with reason and actor/time, request resubmission, investigate underpayment/late payment. Admin checks actual transfer against trusted bank/settlement information. Use transaction boundaries, idempotency keys, event scoping and immutable audit entries for every status change.

Refunds and partial refund automation are outside MVP; manual exception/refund record must never misrepresent booking as paid.

## 8. QR issuance and check-in

After paid/full verification and confirmed booking, issue a unique credential per attendee, tied to event + attendee + booking. Check-in service verifies live credential validity, event, current booking state, and revocation, not just QR image appearance. Expired/cancelled/unpaid/unverified bookings cannot check in. Generation and delivery must be idempotent and retry-safe; delivery failures must not invalidate legitimate confirmation.

## 9. Web UI and Messenger Bot

Public registration: choose category/count, enter primary contact + attendee info, review total and policy, submit, see booking reference/remaining deadline, return later to pay, upload proof, check status securely. Customer account or verified identity/recovery approach must prevent information leaks.

Admin event dashboard: total bookings vs attendee count, confirmed, active held, available, expired, unpaid, pending review, verified receipts, outstanding balance; filter/search/export; detail view of group, deadlines, proof, financial audit; restricted approve/reject, extend hold, cancel or reinstate with capacity validation.

Messenger: create single/group booking via tools, explain pricing and deadline, check **authorized** booking status, send payment instructions, receive/link proof, say only 'pending verification' until admin approves, notify after confirmation, share QR per attendee on supported channels. Follow existing automatic customer language matching. Recover gracefully from lost/ambiguous sessions, repeated messages, webhook retries and bot timeouts; bot must never approve a transfer from a slip image.

## 10. Seminar-specific custom data

Event-configurable optional/required fields at booking or attendee scope: arrival/departure, accommodation need and room preference, transport, food preference and notes. Avoid imposing seminar fields on other event modes. Restrict sensitive answers to authorized operators and apply minimization/retention principles.

## 11. Logical data model (names provisional)

- Bookings: event_id, organizer_id, contact, state, currency, total_due, due_at, price_snapshot.
- Booking attendees: booking_id, attendee, category, unit price, form answers, attendance state.
- Payment obligation: booking_id, amount_due, currency.
- Payment attempts/transactions: amount, method, claimed or verified status, references, verified actor/time.
- Proof attachments: private storage reference, type, size, checksum, metadata, upload actor/time.
- Payment audit events: actor/action/from/to/reason/timestamp and idempotency reference.

Whether to reuse `payment_attempts` and other existing tables must be determined in Phase 0 with both SQLite and PostgreSQL contract review. Avoid storing unnecessary base64 blobs in broadly accessible tables if private media storage is available. Include referential constraints, unique indexes, transactions, retry and rollback strategy.

## 12. Release phases and acceptance gates

### Phase 0 — Technical architecture audit and design (first task)
Inspect routes, DB adapters/migrations, settings, frontend, QR/check-in, notification and bot pipelines. Produce:
- `docs/paid-registration/architecture-audit.md`: actual code paths, sequence/data flows, reuse-vs-extend decisions, risks.
- `docs/paid-registration/data-model.md`: tables/columns, enums, invariants and migration plan for SQLite/Postgres.
- `docs/paid-registration/api-contracts.md`: routes/tools, payloads, authorization, error and idempotency contracts.
- `docs/paid-registration/implementation-tasks.md`: ordered tasks with test/acceptance gates and identified unknowns.
- `docs/paid-registration/decision-log.md`: confirmed decisions and outstanding configurable defaults.

**Gate:** Review Phase 0 designs before implementing schema or runtime behavior.

### Phase 1 — Core registration + group + holds
Add mode/settings/pricing, booking + attendees, full amount, atomic capacity holds, deadlines, expiry and reliable recovery. Gate: existing Free/Ticketing unaffected; groups count correctly, no oversubscription even under concurrency; expiration exactly once.

### Phase 2 — Payment + proof verification + QR
Use existing compatible financial infrastructure, secure proof upload, review approval/rejection, audit, amount validation, booking confirmation, per-attendee QR and live check-in verification. Gate: no usable QR before confirmed verified full payment, no duplicated revenue or issuance.

### Phase 3 — Messenger integration
Customer booking tools, group data collection, payment status, proof matching, notifications, language matching, session replay and retry safety. Gate: bots cannot approve payment, leak booking or double-create.

### Phase 4 — Seminar forms + admin experience
Custom fields for stay/travel/food, group management, dashboard/search/filter/export, hold extension and exception review. Gate: event isolation and accurate summary financial metrics.

### Phase 5 — Automation and production readiness
Reminders, scheduled hold expiration, Telegram admin alerts, daily outstanding summary, monitoring/error recovery, end-to-end staging tests and rollout runbook. Gate: PostgreSQL/SQLite migration verification, free registration/direct ticketing regression, controlled deployment with rollback.

## 13. Acceptance matrix

- Paid booking can be created without immediate transfer.
- A group of N attendees holds N capacity units and one total amount.
- Concurrent requests cannot exceed event capacity.
- Unpaid booking automatically expires after configured due_at, releasing units once.
- Valid on-time proof yields pending verification without premature expiration.
- Slip upload never marks Paid or issues a usable QR.
- Full verified amount plus valid hold transitions booking to Confirmed.
- Group attendee QR credentials are distinct and can be revoked/checked against current status.
- Underpayment, duplicate slip, late payment and rejected proof cannot silently confirm.
- Authorized admin review is fully auditable and idempotent.
- Free Registration and Direct Ticketing behaviors remain unchanged.
- Access isolation and identity checks protect bookings, media and attendee details.
- Bot replies in user's language and never asserts unverified payment.
- Regression tests pass for PostgreSQL/SQLite, APIs, concurrency and Messenger.

## 14. MVP exclusions

No installments, deposits, multi-payer split settlements, automatic statement reconciliation, AI approval of slip images, new credit card gateway, automatic room allocation, accounting suite or automated partial refunds.

## 15. Open technical/product decisions

**Not yet confirmed:** hold duration (proposed 48h), reminders (proposed 24h before due), pending-proof SLA and rejection grace period, absolute payment cutoff, default public account/identity verification, waitlist policy, refunds, attendee corrections and file retention. Document safe defaults but avoid silently treating proposals as confirmed.

## 16. Engineering rules

TypeScript-first. Keep old events backward-compatible. Do not use destructive migrations. Implement with tests and reversible releases. Respect organizer/event authorization and payment evidence privacy. Do not include unrelated local changes. Review Phase 0 before runtime code modifications. No automatic commit, push or Railway deployment without explicit authorization.

**Immediate instruction to Codex:** Start Phase 0 now; inspect the real repo and create the five design deliverables. Reconcile assumptions with code. Do not implement payment or registration features before the design review.
