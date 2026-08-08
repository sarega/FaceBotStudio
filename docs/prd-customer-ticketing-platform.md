# PRD: Customer Event and Ticketing Platform

## 1. Document status

| Field | Value |
| --- | --- |
| Status | Planning draft |
| Product | Meetrix / FaceBotStudio |
| Scope | Customer accounts, event discovery, direct-ticket purchasing, customer ticket wallet, notifications, and event-manager access boundaries |
| Delivery strategy | Additive, feature-flagged, backward-compatible rollout |
| Runtime changes in this PRD | None |

## 2. Executive summary

Meetrix will add a customer-facing application where a person can discover available events, create an account, maintain personal information, purchase direct tickets, view orders, and access all tickets that belong to the account.

The customer application is a separate product surface from the existing organizer/admin workspace, but the first release remains in the same repository, React application, API server, and database. This preserves the existing event, registration, direct-seat, payment, ticket-rendering, check-in, email, audit, and authorization code.

Free-event registration remains guest-friendly and must not require an account. A logged-in customer may use saved profile data and link a free registration to the account, but the existing guest registration flow and ticket remain valid.

Public paid direct-ticket purchases require a verified customer account. Organizer-created complimentary or direct tickets may continue to be issued without a customer account.

The implementation must not change current behavior until an explicit deployment-level and event-level feature flag is enabled. Database changes are additive, new foreign keys are nullable where legacy records exist, and no existing records are automatically converted into customer accounts.

## 3. Background and current baseline

Meetrix currently has four relevant capabilities:

1. Public free-event registration creates a `registrations` record and immediately exposes a registration ticket.
2. Organizer/admin authentication uses `users`, `memberships`, `sessions`, organization roles, and event assignments.
3. Direct ticketing supports performances, seat inventory, holds, payment proof, payment decisions, ticket rendering, reissue, void, print, export, and check-in.
4. Transactional email exists for registration confirmation and direct-ticket payment decisions, while SMS currently stores registration consent but has no general delivery system.

Important baseline constraints:

- `users` represents organizer staff, not ticket buyers.
- A current public direct order is effectively represented by one `direct_tickets` row.
- The public direct-ticket API is feature-gated and the public direct-ticket React panel is intentionally disabled.
- Registration and direct-ticket records store attendee/buyer contact snapshots independently.
- PostgreSQL and SQLite adapters must remain behaviorally compatible.

## 4. Problem statement

The existing system can issue tickets from the organizer workspace, but it does not provide a complete customer lifecycle:

- customers cannot create and maintain a buyer profile;
- customers cannot browse all currently available events from one catalog;
- public paid checkout is not account-bound;
- one payment cannot cleanly represent an order containing several tickets;
- customers do not have a durable ticket wallet or order history;
- registration email and direct-ticket email do not share a general notification delivery ledger;
- SMS delivery, retries, consent policy, and provider status are not implemented;
- staff roles and customer identity would become unsafe if placed in the same authorization model without a clear boundary.

## 5. Product goals

1. Provide a standard public event catalog and event-detail experience.
2. Let customers create a secure account and manage name, phone, email, and address.
3. Require a customer account for public paid ticket purchases.
4. Let one order contain one or more direct tickets and one payment decision.
5. Provide a customer ticket wallet containing linked free registrations and purchased direct tickets.
6. Keep guest registration available for free events.
7. Provide event managers with event-scoped organizer access without exposing unrelated events or organization administration.
8. Introduce a shared notification outbox for email first and SMS later.
9. Preserve all current admin, registration, direct-ticket, print, export, recovery, and check-in behavior during rollout.

## 6. Non-goals for the first production release

- A separate microservice, repository, frontend deployment, or database for the customer application.
- Social login, passkeys, loyalty points, memberships, subscriptions, resale, or ticket transfer.
- A general marketplace for third-party organizers.
- Replacing Ticketmelon inventory ownership or synchronizing Ticketmelon in real time.
- Card payment processing unless a payment-provider project is separately approved.
- Automatically creating customer accounts from existing registrations or tickets.
- Combining organizer staff and customers into one authorization table.
- Removing legacy direct-ticket payment fields or legacy ticket access links.
- Marketing automation or bulk SMS.

## 7. Product principles

1. **No regression by default.** New behavior is unreachable until feature flags are enabled.
2. **Separate authorization domains.** Customer identity never grants organizer permissions; organizer roles never imply ownership of customer tickets.
3. **Guest free registration remains valid.** An account is optional for free registration.
4. **Account required for paid public purchase.** A public buyer must authenticate and verify the required contact channel before creating a paid hold/order.
5. **Reference shared identity; preserve transaction snapshots.** Profiles store current customer data, while registrations and orders retain historical contact snapshots.
6. **One payment owner.** A multi-ticket purchase has one order-level payment state and auditable payment attempts.
7. **Event scope everywhere.** Organizer operations must always pass existing organization/event authorization checks.
8. **Notification delivery is observable.** Every attempted email or SMS has an idempotency key and delivery state.
9. **Expand before migrate; migrate before contract.** New schema is additive. Old columns/routes are not removed during this program.
10. **Reuse before rebuilding.** Existing password hashing, session helpers, transactional email, seat concurrency, payment review, ticket rendering, check-in, and audit infrastructure are reused.

## 8. Personas and access model

### 8.1 Customer

A customer may:

- browse public events;
- register for a free event without an account;
- create an account for paid purchases;
- edit personal profile data;
- select direct seats and create an order;
- upload payment proof where enabled;
- view only their own orders and tickets;
- download valid ticket assets;
- manage notification preferences and consent;
- sign out of all customer sessions.

A customer may not access organizer APIs, organizer data, payment-review tools, attendee exports, or another customer's records.

### 8.2 Event Manager

`Event Manager` is the product label for the existing organizer-side `operator` capability plus assigned event IDs. The first release does not add a new database role.

An event manager may, for assigned events only:

- edit operational event details allowed to operators;
- manage registration attendees;
- manage direct seats and tickets;
- create complimentary/admin-issued orders;
- review payment proof and update payment decisions;
- view customer/order information required to operate the event;
- send event-scoped notifications when permission is granted;
- view reports, exports, audit context, and check-in status.

An event manager may not:

- access unassigned events;
- manage organization owners/admins;
- change organization-level security or billing;
- grant themselves access to another event;
- use customer credentials to access organizer APIs.

### 8.3 Organization Owner/Admin

Owner/admin retains existing organization-wide authority, including staff management, event assignment, configuration, and access to all events in the organization.

### 8.4 Checker and Viewer

- Checker remains restricted to check-in capabilities granted for assigned events.
- Viewer remains read-only where currently authorized.

### 8.5 Person who is both staff and customer

The first release permits a staff account and customer account to use the same email address, but they remain separate accounts, cookies, sessions, and permission checks. Account linking and single sign-on are deferred until there is a validated operational need.

## 9. Product surfaces and information architecture

### 9.1 Public website

| Route | Purpose | Authentication |
| --- | --- | --- |
| `/events` | Browse available public events | None |
| `/events/:slug` | Event details, schedule, location, organizer, registration/sales state | None |
| `/events/:slug/register` | Guest or signed-in free registration | Optional |
| `/events/:slug/tickets` | Performance and seat selection | Browse optional; checkout required |

### 9.2 Customer application

| Route | Purpose |
| --- | --- |
| `/account/register` | Create customer account |
| `/account/login` | Customer login |
| `/account/verify-email` | Verify email token |
| `/account/forgot-password` | Request password reset |
| `/account/reset-password` | Complete password reset |
| `/app` | Customer dashboard |
| `/app/tickets` | Free registrations and purchased tickets |
| `/app/orders` | Order and payment history |
| `/app/orders/:id` | Order detail and payment actions |
| `/app/profile` | Personal and address information |
| `/app/notifications` | Transactional/optional notification settings |
| `/app/security` | Password and session management |

### 9.3 Organizer application

The existing organizer workspace remains the operational application. A future route prefix such as `/admin` may be introduced separately, but this project must not relocate current routes as a prerequisite.

### 9.4 Frontend composition

The first release uses three layouts in the existing React application:

```text
Application
├── PublicEventLayout
├── CustomerAppLayout
└── AdminWorkspaceLayout
```

Shared visual/domain components may be reused, but navigation, route guards, data loaders, and error boundaries remain specific to each surface.

## 10. Core user journeys

### 10.1 Browse and purchase paid direct tickets

1. Visitor opens `/events`.
2. Visitor filters or selects an available event.
3. Visitor reviews event details and opens ticket selection.
4. Visitor chooses a performance and available direct seats.
5. Before a hold is created, the visitor logs in or creates a customer account.
6. The system verifies that the account and event are allowed to purchase.
7. Customer confirms buyer profile, ticket holders, price, and terms.
8. Server creates one order, one or more tickets, and seat holds in one transaction.
9. Customer completes the configured payment/proof flow.
10. Staff or webhook verifies payment.
11. The order becomes paid and all eligible tickets become issued in one transaction.
12. The notification outbox sends order/ticket messages.
13. Issued tickets appear in `/app/tickets`.

### 10.2 Guest registration for a free event

1. Visitor opens the current public event page.
2. Visitor submits name, phone, and optional email without creating an account.
3. Existing registration rules, duplicate handling, capacity, ticket rendering, and recovery behavior remain unchanged.
4. The registration ticket is immediately available as it is today.

### 10.3 Signed-in registration for a free event

1. Customer is already signed in.
2. The registration form is prefilled from the customer profile.
3. Customer may edit event-specific attendee details before submission.
4. The existing registration is created through the existing registration service.
5. `customer_account_id` is stored when available.
6. The ticket appears in the customer wallet without changing the legacy ticket URL or check-in flow.

### 10.4 Organizer-created ticket

1. Event manager uses the existing direct-ticket admin screen.
2. Event manager selects seat(s), holder/buyer, price, and payment requirement.
3. Existing issue/hold behavior remains available.
4. Customer-account association is optional.
5. If an account is deliberately selected, the issued ticket appears in that customer's wallet.
6. No account is automatically created from typed buyer details.

### 10.5 Customer views a ticket

1. Customer opens `/app/tickets`.
2. API returns a normalized list of linked registrations and direct tickets.
3. Customer opens a ticket they own.
4. Server verifies customer ownership before returning metadata.
5. Existing signed PNG/PDF links may continue to deliver assets during migration.
6. Voided, expired, or superseded tickets are clearly labeled and cannot be used for check-in.

## 11. Event catalog requirements

### 11.1 Inclusion rules

An event may appear in `/events` only when all applicable conditions pass:

- public event page is enabled;
- event is active and not archived/cancelled/closed;
- event has a valid public slug;
- event has at least one currently meaningful public action: free registration, external ticket URL, or enabled direct-ticket sale;
- sale/registration timing permits display under the configured visibility policy.

An event can remain visible while registration/sales are not yet open if the organizer chooses an `upcoming` visibility policy, but the CTA must show the actual availability state.

### 11.2 Catalog fields

- event title and poster;
- organizer name/logo;
- date/time and timezone;
- venue/location summary;
- registration/ticket availability;
- starting price when direct prices are available;
- available performance summary;
- public category/tags only when later required.

### 11.3 Catalog API

Introduce a read-only endpoint that returns public-safe fields only:

```text
GET /api/public/events
```

It must not expose internal settings, customer counts beyond configured public availability, seat external references, private contact data, or organizer-only state.

## 12. Customer identity requirements

### 12.1 Account creation

Required initial fields:

- email;
- password;
- first name;
- last name;
- phone;
- acceptance of terms/privacy notice.

Address may be completed at profile or checkout time. Required address fields are configurable only if a genuine invoicing/legal need is confirmed; otherwise they remain optional to minimize personal-data collection.

### 12.2 Email and phone rules

- Email is normalized for comparison and unique among customer accounts.
- The original display form of email may be retained separately if needed.
- Phone is normalized to a stable canonical value before matching.
- Phone is not the primary login identifier in the first release.
- Email verification is required before a paid public order is created.
- SMS/phone verification is introduced only when SMS delivery is operational.

### 12.3 Password and sessions

- Reuse the current scrypt password hashing implementation and current hash-upgrade behavior.
- Use a customer-specific session table and cookie name.
- Customer cookies are HttpOnly, Secure in production, and SameSite-protected.
- Customer write APIs require CSRF protection consistent with the existing server approach.
- Login, registration, verification, and password-reset endpoints are rate limited.
- Password-reset and verification tokens are stored as hashes with expiration and one-time use.
- Account deactivation revokes all customer sessions.

### 12.4 Profile management

Customers can edit current:

- first and last name;
- phone;
- address lines;
- district/subdistrict where applicable;
- province/state;
- postal code;
- country;
- notification preferences.

Editing a profile must not rewrite historical registration, order, invoice, payment, or ticket snapshots.

## 13. Customer ticket wallet requirements

The wallet aggregates two existing domains without merging their lifecycle tables.

Normalized customer response:

```ts
type CustomerTicketSummary = {
  id: string;
  kind: "registration" | "direct_ticket";
  event_id: string;
  event_name: string;
  event_slug: string;
  holder_name: string;
  performance_label: string | null;
  seat_label: string | null;
  status: string;
  starts_at: string | null;
  ticket_url: string | null;
};
```

Wallet rules:

- return only records linked to the authenticated `customer_account_id`;
- do not infer ownership from an unverified email or phone during normal reads;
- group upcoming tickets before past tickets;
- show voided/cancelled tickets but prevent use;
- preserve existing registration and direct-ticket rendering/check-in behavior;
- do not expose payment proof through the wallet ticket endpoint.

## 14. Order and ticket requirements

### 14.1 Order boundary

One `direct_order` represents:

- one customer purchase;
- one event;
- one currency;
- one payment state;
- one or more direct tickets;
- buyer/contact/address snapshots;
- totals and payment audit metadata.

The first release may restrict one order to one performance if that avoids ambiguous hold and refund behavior. Cross-performance carts are explicitly deferred.

### 14.2 Atomic creation

Order creation must use one database transaction:

1. lock selected seat rows;
2. verify event, performance, allocation, price, and seat availability server-side;
3. create the order;
4. create ticket rows linked to the order;
5. update seat states to held;
6. commit all changes or none.

Client-submitted prices are never trusted.

### 14.3 Order states

Recommended initial order states:

`draft`, `held`, `payment_review`, `paid`, `cancelled`, `expired`, `refunded`.

Payment states remain compatible with the existing values:

`awaiting_payment`, `proof_submitted`, `verified`, `not_required`, `rejected`, `expired`, `refunded`.

### 14.4 Compatibility with legacy direct tickets

- `direct_tickets.order_id` is nullable.
- Existing direct tickets remain readable and operable without an order.
- Existing admin creation endpoints continue to work before migration.
- Existing ticket-level payment fields remain present.
- For new order-backed tickets, the order is the payment source of truth; compatibility fields may be mirrored transactionally while the existing admin UI still reads them.
- No existing payment column is removed in this program.
- Reissue keeps the order association and creates a new ticket identity as it does today.

### 14.5 Holds and expiration

- Account authentication occurs before a public paid hold is created.
- Existing seat concurrency protections remain mandatory.
- Expiring an order releases every held seat in the same transaction.
- Partial release is not allowed unless a separately designed order-edit flow exists.
- Late payment is queued for manual resolution and never silently assigns another seat.

## 15. Notification platform requirements

### 15.1 Purpose

Replace feature-specific fire-and-forget delivery with a shared, auditable outbox while retaining the existing email provider and templates.

### 15.2 Initial channels

1. Email: implemented first using the current transactional email sender.
2. SMS: disabled until a provider, sender identity, consent policy, cost model, and production credentials are approved.

### 15.3 Delivery events

Initial transactional event kinds:

- `customer.email_verification`;
- `customer.password_reset`;
- `registration.confirmed`;
- `order.created`;
- `order.payment_proof_received`;
- `order.payment_verified`;
- `order.payment_rejected`;
- `ticket.issued`;
- `event.reminder`;
- `event.changed`;
- `event.cancelled`.

### 15.4 Outbox behavior

- business transaction inserts an outbox row instead of directly depending on provider success;
- each delivery has a deterministic idempotency key;
- queued deliveries are claimable by one worker/process at a time;
- provider success records external message ID and sent time;
- transient failures retry with bounded backoff;
- permanent failures stop retrying and remain visible to staff;
- provider errors never roll back an already committed order or registration;
- existing direct email calls remain active until the corresponding outbox path is proven and enabled;
- dual sending is forbidden: the feature flag selects exactly one path for each notification kind.

### 15.5 Consent

- Transactional messages required to complete an order are distinct from marketing messages.
- Existing registration SMS consent remains valid for its current event context.
- Customer notification preferences do not silently overwrite registration-level historical consent.
- SMS marketing is outside the initial release.
- Consent changes are auditable with source and timestamp.

## 16. Target data model

### 16.1 New tables

#### `customer_accounts`

| Field | Notes |
| --- | --- |
| `id` | Opaque customer ID |
| `email` | Display/original email |
| `normalized_email` | Unique normalized identity |
| `password_hash` | Existing scrypt format |
| `email_verified_at` | Nullable until verification |
| `first_name`, `last_name` | Current profile |
| `phone`, `normalized_phone` | Current contact |
| address fields | Current profile; nullable unless required |
| `status` | `pending`, `active`, `disabled` |
| timestamps | Created/updated/last login |

#### `customer_sessions`

Customer-specific equivalent of staff sessions. It must not share cookies or authorization middleware with organizer sessions.

#### `customer_account_tokens`

Hashed, expiring, one-time tokens for email verification and password reset.

#### `direct_orders`

Contains customer/event relationship, buyer snapshot, address snapshot, totals, currency, order/payment state, hold expiry, payment reference, and audit timestamps.

#### `payment_attempts`

Stores proof/provider attempt metadata separately from ticket assets. Payment proof remains private.

#### `notification_deliveries`

Stores channel, kind, recipient snapshot, related entity, payload/template data, idempotency key, state, attempt count, provider IDs/errors, and timestamps.

#### `customer_notification_preferences`

Stores channel/purpose preference only after the notification model is defined. Transactional delivery rules remain server-controlled.

### 16.2 Additive columns

- `registrations.customer_account_id NULL REFERENCES customer_accounts(id)`
- `direct_tickets.order_id NULL REFERENCES direct_orders(id)`
- optionally `direct_tickets.customer_account_id NULL` only if wallet queries require a stable holder/account association independent of order ownership; do not add it speculatively.

### 16.3 Snapshot policy

- Customer profile is current mutable data.
- Registration is the attendee snapshot for that event registration.
- Order is the buyer/contact/address/price snapshot at purchase.
- Ticket is the holder/performance/seat snapshot for admission.
- Historical snapshots are not rewritten when profile data changes.

## 17. API boundaries

### 17.1 Public read APIs

```text
GET /api/public/events
GET /api/public/events/:slug
GET /api/public/events/:slug/direct-ticketing
```

Existing public registration endpoints remain compatible.

### 17.2 Customer auth APIs

```text
POST /api/customer/auth/register
POST /api/customer/auth/login
POST /api/customer/auth/logout
GET  /api/customer/auth/me
POST /api/customer/auth/verify-email
POST /api/customer/auth/forgot-password
POST /api/customer/auth/reset-password
```

### 17.3 Customer application APIs

```text
GET   /api/customer/profile
PATCH /api/customer/profile
GET   /api/customer/tickets
GET   /api/customer/orders
GET   /api/customer/orders/:id
POST  /api/customer/events/:slug/orders
POST  /api/customer/orders/:id/payment-proof
GET   /api/customer/notification-preferences
PATCH /api/customer/notification-preferences
```

### 17.4 Organizer APIs

Existing routes remain operational. New order-management routes use existing role and event-scope middleware. Event managers must pass both role and event assignment checks.

### 17.5 Authorization rules

- Public endpoints return public-safe projections only.
- Customer endpoints require a customer session and ownership checks.
- Organizer endpoints require organizer session, role, organization, and event scope.
- Possessing a customer ticket ID or order ID is never sufficient authorization.
- Existing signed ticket-delivery links remain valid but do not grant access to broader account/order data.

## 18. Backward-compatibility contract

The following behavior must remain unchanged while all new flags are disabled:

1. Organizer login, logout, role management, and sessions.
2. Existing organizer navigation and current root routes.
3. Public event pages addressed by slug.
4. Guest public registration form, validation, duplicate behavior, capacity, confirmation, ticket recovery, and ticket rendering.
5. Registration check-in and existing QR values.
6. Direct-ticket performance/seat import and management.
7. Admin issue, hold, payment verification/rejection, reissue, void, print, export, and check-in.
8. Existing direct-ticket signed PNG/PDF/SVG links.
9. Existing Ticketmelon/direct allocation boundary.
10. Existing email path until an individual notification kind is migrated.
11. Existing PostgreSQL and SQLite test behavior.

No phase may proceed if its migration or code changes violate this contract.

## 19. Feature flags and release gates

Use both deployment-level and event-level gates.

### 19.1 Proposed deployment flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `CUSTOMER_APP_ENABLED` | `0` | Enables customer routes/UI generally |
| `CUSTOMER_ACCOUNT_REGISTRATION_ENABLED` | `0` | Allows account creation |
| `NOTIFICATION_OUTBOX_ENABLED` | `0` | Enables outbox processing for migrated kinds |
| `SMS_NOTIFICATION_ENABLED` | `0` | Enables SMS provider dispatch |
| existing `PUBLIC_DIRECT_TICKETING_ENABLED` | unchanged | Deployment gate for public direct ticketing |

### 19.2 Proposed event settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `event_catalog_visible` | `0` | Shows event in `/events` |
| `customer_ticketing_enabled` | `0` | Enables customer checkout for event |
| existing `direct_ticketing_public_enabled` | unchanged | Enables direct seat inventory publicly |

### 19.3 Gate rule

Public paid checkout is enabled only when every required deployment and event flag is true. A missing/invalid flag always fails closed.

## 20. Delivery plan

### Phase 0 — Baseline protection and characterization

**Goal:** Establish measurable proof that the current system still works before adding new behavior.

#### Implementation steps

1. Document the backward-compatibility contract from Section 18 in tests.
2. Add/confirm small integration tests for:
   - guest public registration;
   - duplicate registration behavior;
   - registration ticket rendering/recovery;
   - registration check-in;
   - admin direct-ticket immediate issue;
   - paid hold, proof, verification/rejection, expiry;
   - reissue/void/check-in;
   - filtered print/export behavior;
   - event assignment authorization.
3. Capture representative PostgreSQL migration and SQLite initialization checks.
4. Add proposed feature settings with false/zero defaults only when their consuming code is ready.
5. Record baseline request error rates and key order/registration counts if production telemetry is available.

#### Exit criteria

- Current automated checks pass on `main`.
- New tests fail if a protected legacy behavior changes.
- No new UI or public API is reachable.

#### Rollback

Test-only changes can be reverted without database impact.

### Phase 1 — Add notification outbox in dark mode

**Goal:** Add a general delivery ledger without changing current email behavior.

#### Implementation steps

1. Add `notification_deliveries` using an additive PostgreSQL migration.
2. Add equivalent SQLite schema initialization and adapter methods.
3. Add database methods to enqueue, claim, mark sent, mark failed, and retry deliveries.
4. Add a notification dispatcher that initially supports the existing email sender.
5. Keep `NOTIFICATION_OUTBOX_ENABLED=0` and preserve all current direct sends.
6. Add tests for idempotency, one-worker claim, success, transient failure, permanent failure, and retry limits.
7. Migrate one low-risk email kind in a non-production environment.
8. Ensure the migrated kind uses either legacy direct send or outbox, never both.

#### Exit criteria

- Outbox disabled produces exactly current behavior.
- Outbox enabled sends one email for one idempotency key.
- Provider failure does not undo a registration/order transaction.
- Delivery state is inspectable by authorized staff.

#### Rollback

Disable `NOTIFICATION_OUTBOX_ENABLED`. Leave the additive table in place; do not drop it during incident rollback.

### Phase 2 — Customer identity and profile in dark mode

**Goal:** Implement secure customer identity without exposing checkout.

#### Implementation steps

1. Add `customer_accounts`, `customer_sessions`, and `customer_account_tokens` additively in PostgreSQL and SQLite.
2. Reuse password hashing/session token helpers while using separate tables, cookies, types, and middleware.
3. Implement register, verify email, login, logout, current account, forgot password, reset password, and revoke sessions.
4. Route verification/reset messages through the notification outbox.
5. Implement profile read/update APIs with server-side validation and audit events for security-sensitive changes.
6. Add customer-specific rate limits and CSRF checks.
7. Build minimal account screens behind `CUSTOMER_APP_ENABLED` and `CUSTOMER_ACCOUNT_REGISTRATION_ENABLED`.
8. Keep both flags disabled in production until security tests pass.

#### Exit criteria

- Customer credentials cannot authenticate organizer endpoints.
- Organizer credentials cannot authenticate customer endpoints unless a separate customer account exists.
- Duplicate normalized emails are rejected atomically.
- Verification/reset tokens expire, are one-time, and are not stored in plaintext.
- Disabling the flags makes customer routes unavailable without affecting admin auth.

#### Rollback

Disable customer flags and revoke customer sessions if necessary. Organizer auth remains independent.

### Phase 3 — Public event catalog and customer shell

**Goal:** Provide read-only discovery and customer navigation without enabling purchases.

#### Implementation steps

1. Add public-safe event catalog projection and `GET /api/public/events`.
2. Implement catalog inclusion rules and server-side availability labels.
3. Add `/events` and update event links without changing existing slug page behavior.
4. Add `CustomerAppLayout` with dashboard, tickets, orders, profile, notification, and security navigation.
5. Empty tickets/orders pages show explicit empty states and browse-event CTA.
6. Hide catalog events unless `event_catalog_visible=1`.
7. Add cache headers appropriate for public catalog data without caching customer data.

#### Exit criteria

- Catalog exposes no private/internal fields.
- Existing event links and public registration continue to work.
- An event hidden from catalog remains accessible by its existing slug only according to current public-page rules.
- No paid order can be created from the new UI.

#### Rollback

Set `event_catalog_visible=0` for all events or disable `CUSTOMER_APP_ENABLED`.

### Phase 4 — Optional account linkage for free registrations

**Goal:** Let signed-in customers see new free registrations in their wallet without requiring an account for guests.

#### Implementation steps

1. Add nullable `registrations.customer_account_id` in both database implementations.
2. Do not alter required fields, uniqueness, capacity, status, QR, or recovery rules.
3. When a valid customer session exists, pass the customer ID into the existing registration service.
4. Keep the submitted registration fields as historical snapshots.
5. Add customer wallet query for linked registrations.
6. Add ownership checks for customer registration detail.
7. Add tests for guest registration, signed-in registration, profile edits after registration, cancellation, and check-in.

#### Exit criteria

- Guest registration responses are byte/shape compatible where currently relied upon.
- Signed-in registration creates the same ticket plus an optional account link.
- Editing profile data does not edit registration data.
- Existing registrations remain unlinked and fully operational.

#### Rollback

Stop writing `customer_account_id` and hide linked registrations from the wallet. The nullable column remains harmless.

### Phase 5 — Introduce order domain without public sales

**Goal:** Establish multi-ticket order/payment behavior while preserving current admin direct-ticket operations.

#### Implementation steps

1. Add `direct_orders`, `payment_attempts`, and nullable `direct_tickets.order_id` in PostgreSQL and SQLite.
2. Implement database transaction methods for order creation, seat locking, ticket creation, expiry, payment decision, and refund state.
3. Keep current admin direct-ticket endpoint and ticket-level payment behavior unchanged initially.
4. Add an internal organizer-only order creation path behind a flag or non-public route.
5. For order-backed tickets, expose normalized effective payment state to admin serializers while preserving legacy fields.
6. Make order payment decisions update order, tickets, and seats atomically.
7. Ensure reissue retains order association and invalidates the old ticket.
8. Add reconciliation queries covering legacy tickets and order-backed tickets.
9. Pilot with complimentary/test orders on a non-production event.

#### Exit criteria

- Existing legacy direct-ticket tests pass unchanged.
- One order can own multiple tickets without duplicate seat ownership.
- One payment decision issues/rejects all eligible order tickets atomically.
- Legacy tickets with `order_id=NULL` continue to print, export, reissue, void, and check in.

#### Rollback

Disable order-backed creation. Continue legacy ticket operations. Do not drop order tables or nullable columns.

### Phase 6 — Customer paid checkout pilot

**Goal:** Enable a small, controlled account-required public sale.

#### Implementation steps

1. Build the public performance/seat selector by reusing current direct-seat projections and seat-map components where safe.
2. Require an active verified customer session before server-side hold creation.
3. Re-fetch and validate event, performance, seat allocation, availability, and price in the order transaction.
4. Support one performance per order and a defined maximum number of seats.
5. Build review, terms acceptance, order confirmation, PromptPay/payment proof, and order-status screens.
6. Add customer ownership checks to every order/proof endpoint.
7. Route order/payment/ticket notifications through the outbox.
8. Add organizer order/review views scoped to assigned events.
9. Keep `PUBLIC_DIRECT_TICKETING_ENABLED`, `direct_ticketing_public_enabled`, and `customer_ticketing_enabled` false by default.
10. Enable all gates for one internal/test event first.
11. Run concurrency, expiry, duplicate payment reference, authorization, and recovery tests.
12. Enable one production event with a small allocation and a documented operator runbook.

#### Exit criteria

- Two customers cannot hold or purchase the same seat.
- A customer cannot access another customer's order, ticket metadata, or payment proof.
- Client price manipulation cannot change order totals.
- Payment failure/rejection/expiry releases seats correctly.
- Verified payment issues every order ticket once.
- Turning off any required flag prevents new public orders while preserving existing orders and tickets.

#### Rollback

Disable `customer_ticketing_enabled` for the event first. Existing orders remain accessible and operable by staff; no new orders are accepted. If needed, disable the deployment gate globally.

### Phase 7 — SMS provider and customer preferences

**Goal:** Add controlled transactional SMS after email/outbox operation is stable.

#### Implementation steps

1. Select provider, sender identity, supported regions, cost controls, and delivery webhook requirements.
2. Define transactional versus optional/marketing message policy with legal review appropriate to operation regions.
3. Implement provider adapter using the notification dispatcher.
4. Add delivery callback/webhook verification and idempotency.
5. Add customer notification preferences and consent audit history.
6. Preserve existing registration SMS consent semantics.
7. Add per-event and global send limits, template length checks, and cost monitoring.
8. Start with one transactional message kind in staging, then a limited production event.
9. Keep `SMS_NOTIFICATION_ENABLED=0` until credentials, templates, consent behavior, and monitoring are approved.

#### Exit criteria

- Disabled SMS produces no provider calls.
- One idempotency key cannot send two SMS messages.
- Opt-out is respected for optional messages.
- Transactional/marketing classification is explicit.
- Delivery failures are visible and do not affect ticket validity.

#### Rollback

Disable `SMS_NOTIFICATION_ENABLED`; email and in-app ticket access remain available.

### Phase 8 — Claim existing records and operational hardening

**Goal:** Let verified customers link historical records safely after the new system is proven.

#### Implementation steps

1. Design an explicit claim flow using verified contact plus ticket/order-specific proof.
2. Never claim records by matching name alone.
3. Record claim audit events and notify the prior contact where appropriate.
4. Add admin dispute/unlink workflow.
5. Add customer session management, account disable/export/delete operational workflows according to approved privacy policy.
6. Review whether staff/customer account linking or SSO is actually needed.
7. Review legacy columns only after at least one stable production cycle; schema removal requires a separate PRD/migration plan.

#### Exit criteria

- Historical records cannot be claimed using public or easily guessed information alone.
- Claims are auditable and reversible by authorized staff.
- No automatic mass account creation or PII matching occurs.

#### Rollback

Disable claiming while preserving already verified links unless a security incident requires controlled unlinking.

## 21. Testing strategy

### 21.1 Required test layers

| Layer | Required coverage |
| --- | --- |
| Database | Constraints, atomic order/seat transitions, expiry, idempotency, both adapters |
| Service/API | Authentication boundaries, event scope, ownership, validation, response compatibility |
| Frontend | Route guards, loading/error/empty states, price review, expired order handling |
| Security | CSRF, rate limiting, token expiry, horizontal access, staff/customer separation |
| Regression | Existing registration, direct ticketing, printing, export, recovery, check-in |
| Operational | Feature flags, partial rollout, rollback, queued notifications, provider failure |

### 21.2 Minimum critical scenarios

1. Guest free registration still succeeds with all customer flags disabled.
2. Existing direct admin issue and check-in still succeed after every migration.
3. Customer A cannot read Customer B's order or ticket.
4. Event Manager A cannot access an unassigned event.
5. Two simultaneous order requests for one seat produce one success.
6. Order creation failure leaves no order, tickets, or held seats.
7. Payment verification replay does not duplicate issue or notification.
8. Hold expiry releases all seats in the order once.
9. Notification provider outage does not invalidate a paid order or issued ticket.
10. Profile edits do not rewrite historical snapshots.
11. Legacy tickets without `order_id` continue all supported operations.
12. PostgreSQL migrations and SQLite initialization expose equivalent behavior.

### 21.3 Release checks per phase

- Typecheck/lint passes.
- Production build passes.
- Relevant database tests pass for SQLite.
- PostgreSQL migration is tested against a recent schema copy.
- New migrations are forward-only and additive.
- Feature flags default off.
- Protected legacy smoke tests pass.
- Rollback procedure has been executed in staging.

## 22. Observability and audit

### 22.1 Metrics

- customer registration/login/verification success and failure;
- catalog and event-detail error rate;
- order created/expired/paid/rejected/refunded counts;
- seat conflict count;
- payment proof and decision latency;
- notification queued/sent/failed/retried counts by channel/kind;
- unauthorized/forbidden customer and event-scope access attempts;
- legacy versus order-backed direct-ticket counts during migration.

### 22.2 Audit events

Audit at minimum:

- customer account created, verified, disabled, password reset, profile/contact changed;
- order created, expired, cancelled, payment proof submitted, payment verified/rejected/refunded;
- ticket issued, reissued, voided, claimed, unlinked, checked in;
- event-manager access assignment changes;
- notification enqueued, permanently failed, manually retried;
- feature-flag changes affecting public sales.

Sensitive values such as passwords, tokens, payment proof, full provider payloads, and unnecessary address data must not be written to audit metadata.

## 23. Privacy and security requirements

- Collect only profile/address fields required for the actual customer or accounting flow.
- Publish a privacy notice before accepting customer accounts.
- Define retention for accounts, addresses, payment proof, notification logs, and audit records.
- Restrict payment proof to authorized event operators/admins and the owning customer only where product policy permits.
- Never expose customer lists or PII through public event/catalog APIs.
- Normalize identity fields server-side and validate every trust boundary.
- Use database ownership/event filters in addition to frontend route guards.
- Keep signed ticket URLs unguessable and revocable through ticket lifecycle.
- Do not log raw verification/reset/session tokens.
- Apply account enumeration-resistant responses to login/reset/verification where practical.
- Require explicit approval before introducing SMS marketing or cross-event promotional use of customer data.

## 24. Deployment and rollback policy

### 24.1 Expand

- Deploy additive tables/nullable columns first.
- Confirm old application instances can operate against the expanded schema.
- Deploy dormant code paths with flags off.

### 24.2 Migrate

- Enable internal/test organization first.
- Enable one event at a time.
- Compare old and new reporting/reconciliation outputs.
- Move notification kinds individually to the outbox.
- Keep legacy routes and fields available.

### 24.3 Contract

No destructive contract step is included in this PRD. Dropping legacy columns, routes, tables, or direct-send paths requires a separate proposal after production stability and rollback requirements are satisfied.

### 24.4 Incident response

For checkout incidents:

1. disable the affected event's `customer_ticketing_enabled`;
2. preserve access to existing orders/tickets;
3. stop new holds and let or explicitly release existing holds according to runbook;
4. reconcile payment and seat states;
5. notify affected customers through a working channel;
6. only then consider a global deployment flag shutdown.

## 25. Operational readiness checklist

Before enabling a production event:

- event manager assignments are verified;
- public event details, timezone, performances, prices, and inventory are approved;
- direct seats are confirmed locked from Ticketmelon public sale;
- customer terms/privacy notice are published;
- PromptPay/payment receiver and review policy are configured;
- customer verification email works;
- order and ticket email templates are approved;
- hold duration, late-payment, refund, and cancellation policies are documented;
- payment-review queue has assigned staff;
- notification failure view is monitored;
- support and escalation contacts are documented;
- reconciliation export is tested;
- rollback flags and runbook are tested;
- check-in still accepts existing and new ticket formats.

## 26. Success metrics

Initial success is operational correctness rather than sales volume:

- zero duplicate active ownership of a seat;
- zero cross-customer order/ticket exposure;
- zero regression in existing guest registration and admin direct-ticket operations;
- at least 99% of verified payments issue tickets without manual data repair;
- notification delivery state is known for every attempted transactional message;
- event managers cannot access unassigned events;
- production checkout can be disabled per event without disabling ticket access or admin operations.

## 27. Open product decisions

1. Is address required for all buyers, only invoice requests, or not required initially?
2. What is the first supported payment method and its authoritative payment status source?
3. How many seats may one customer hold per order?
4. Is one order restricted to one performance in the first release? Recommended: yes.
5. Which email address/domain and templates will be used for account verification and ticket delivery?
6. Which SMS provider, sender name, supported countries, and budget will be approved?
7. Which transactional SMS kinds are required at launch?
8. What retention period applies to payment proof and customer address data?
9. Can customers request tax invoices, and if so what additional legal fields are required?
10. What proof is required to claim a historical registration or direct ticket?
11. Should organizer-issued tickets be linkable to an existing customer account at issue time?
12. Which current `operator` actions must be restricted or expanded for the Event Manager product label?

## 28. Definition of done for the overall program

The customer ticketing platform is complete for the initial production scope when:

1. Customers can browse enabled events, create/verify accounts, maintain profiles, and sign in securely.
2. Guest free registration behaves as before without requiring an account.
3. Signed-in free registrations appear in the customer wallet.
4. Customers can purchase one or more direct tickets in one order for one performance.
5. Seat, order, payment, ticket, and notification transitions are atomic/idempotent where required.
6. Customers can access only their own orders and tickets.
7. Event managers can operate only assigned events.
8. Existing admin direct-ticket and registration workflows remain supported.
9. Email notifications use the observable outbox for approved event kinds.
10. Public checkout can be enabled and disabled independently per event.
11. PostgreSQL and SQLite implementations pass the agreed critical test matrix.
12. Production runbook, reconciliation, monitoring, incident rollback, and support ownership are approved.
