# Paid Registration integration audit - 2026-11-17

## Root cause
There are two authoritative registration data sources in Meetrix:
- Original free-event registrations in the registrations table, which previously powered Registered Attendees, Event Stats, export, and legacy ticket management.
- Paid customer event registrations in paid_bookings, paid_attendees, paid_payment_attempts, paid_credentials, and paid_proofs. One paid booking can have multiple named people.

A database trigger deliberately blocks creating legacy registration records for paid events. Duplicating paid bookings into the legacy table would risk duplicate records, tickets and incompatible payment and check-in history. Use a read-only projection for reports, rather than data migration or copying.

## Implemented in v0.11.2
- listPaidAttendeeRoster in paidRegistration.ts and both database adapters: a query with one row per attendee, including booking, customer, category, effective payment state, check-in and seminar choices. Requires organizer ownership.
- GET /api/events/:eventId/paid-registration/attendees, scoped admin API: attendee roster and event paid summary.
- The existing RegistrationsScreen includes paid attendees in named rows, search/filter and seat/count cards, while legacy entries remain untouched.
- EventWorkspaceScreen Registration Rules shows paid occupancy and marks the separately configured legacy capacity.
- GET /api/registrations/export?event_id=... now outputs a unified Event roster: one CSV row per attendee from either source; original legacy fields are retained with extended booking/customer, state and seminar metadata.
- GET /api/admin/customers/attendee-roster.csv exports one row per attendee across the organizer's Events (paid and legacy). Keep /api/admin/customers/paid-bookings.csv separate as one row per booking.
- Saved seminar answer arrays are decoded before export. Custom choice fields include food, accommodation, arrival, departure, room, transport and notes.
- Payment review dispatches an event to refresh the attendee summary on review completion.

## Correct accounting
- One booking for four persons means ONE booking and FOUR attendee rows.
- Occupancy is confirmed attendees plus active held attendees (awaiting payment within deadline or pending verification). Expired unpaid holds do not occupy seats.
- A submitted slip is not a verified payment: confirmation requires successful organizer review.
- Check-in belongs to individual attendees.
- Expired or cancelled historical attendees may appear in reports but cannot count as occupied seats.
- booking_total_thb repeats for all attendees of the booking, and should not be summed as attendee-level revenue.
- No existing production data or database schema is migrated or copied.

## Remaining repository-wide integration audit for Codex
1. Admin Agent commands list_registrations, count_registrations and Telegram CSV currently use the legacy-only registration query. Extend those under explicit proper permissions, without exposing private paid account details.
2. Survey Event discovery/capacity summaries, automated reports, ReportsScreen, outreach and check-in dashboards for legacy-only counts, deciding the right units and source for each feature.
3. Distinguish legacy ticket, paid attendee credentials and direct ticketing as distinct issuance flows before attempting to consolidate check-in and ticket resend operations.
4. Centralize shared stat derivation and authorization on the server to avoid repeated front-end calculations and potential stale snapshots.
5. Verify with real Production data after deployment: unpaid group, submitted slip, approved booking, expired hold, complimentary booking, and compare attendee rows, booking counts, seat occupancy and CSV.

## Validation cases
- Booking containing four people gives four named roster rows with one booking reference.
- Paid seat occupancy displays confirmed attendees plus valid holds, rather than 0 or all historical bookings.
- An approval refreshes the registered attendee view and payment counts.
- CSV contains each person's name and the correct food/accommodation options when supplied.
- Organizer export covers distinct Events and rejects unauthorized access.
- Legacy free registrations remain visible without duplicate paid records.
