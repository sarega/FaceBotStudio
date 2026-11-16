# Phase 0 — API and Messenger contracts

Proposed additive routes. Reuse Express validation, session, CSRF, rate limits, event-scope middleware and error logging patterns. Paid enrollment must be explicitly enabled. Publish paid summary through the existing public-event payload as an additive discriminator. Existing free and direct contracts retain their behavior for legacy events.

## Customer

| Method and path | Contract |
|---|---|
| GET `/api/public/events/:slug/paid-registration` | Public safe catalog. Returns `registration_mode, currency, pricing_version, form_version, categories[{id,label,unit_minor}], form, availability` and applicable policies. Omit payment account data, PII and private settings. Availability is advisory. |
| POST `/api/public/events/:slug/paid-bookings` | Verified customer. Body `{pricing_version,form_version,contact:{name,email?,phone?},answers?,attendees:[{category_id,first_name,last_name,email?,phone?,answers?}]}`. Validate bounded group size and keys, derive owner/event/organization from trusted context, calculate amount server-side. Returns 201 with `{id,reference,status,payment_status,currency,total_due_minor,due_at,version}`. |
| GET `/api/customer/paid-bookings[/:id]` | Verified owner only, paginated list and detail. Return booking snapshot, own group details, current states, remaining balance and permitted actions. A display reference is never an access credential. |
| GET `/api/customer/paid-bookings/:id/payment-instructions` | Verified owner, payable state. Return exact amount and safe instructions or a generated PromptPay payment QR from the receiver snapshot. Payment QR uses a separate purpose from admission. |
| POST `/api/customer/paid-bookings/:id/proofs` | Verified owner, idempotency key. Bounded multipart with one `file` and bounded JSON `{claimed_minor,claimed_at,reference?,method,version}`. Accept only decoded JPEG/PNG/WebP with MIME/signature agreement, dimensions and byte caps. Stream/stage privately, hash raw bytes, limit decompression and reject broken files. Returns 202 with `{attempt_id,status,payment_status,version}` for intake pending review. Late intake has no hold effect and goes through staff resolution. |
| GET `/api/customer/paid-bookings/:id/attendees/:attendeeId/credential` | Verified owner and live eligible credential. Return renderable admission token or image with `Cache-Control: private, no-store`. Recheck eligibility at download and scan. |

## Staff and checker

Prefix staff routes with `/api/events/:eventId/paid-registration`. Require explicit event scope, tenant and confirmed permission for each action, with object queries constrained by the same scope.

| Path | Contract |
|---|---|
| GET/PATCH `/settings` | Event setup permission. Versioned payload includes mode, publishing status, capacity, category quotas/prices, hold duration, cutoff, organizer finance readiness and form schema. Transaction validates live occupancy and mode eligibility. |
| GET `/bookings`, `/bookings/:id`, `/summary`, `/export` | Authorized role-scoped access. Filters for date/state/category/reference, cursor pagination. Detail includes group, evidence metadata and audit. Summary from one as-of snapshot with confirmed/held/available counts and per-state booking counts. Export limits PII to authorized roles and escapes spreadsheet formulas. |
| GET `/bookings/:id/proofs/:proofId` | Payment review permission and verified proof-to-booking/event relationship. Stream from private store or issue short-lived object-specific signed access after authorization. No CDN cache, public mount, raw link in logs or general-purpose public token. |
| POST `/bookings/:id/review` | Payment review permission and idempotency key. Body `{attempt_id?,version,decision,reason,observed?:{amount_minor,currency,paid_at,rail,reference,receiver_match,evidence_source}}`. Decisions approve, reject or flag exception. Manual recording requires trusted source/reference, reviewed receiver and exact amount. Return updated summary and version; capture actor from session. |
| POST `/bookings/:id/{extend,cancel,reinstate,record-refund}` | Restrict by action and require version, reason and idempotency. Extension/reinstatement can include proposed due time subject to policy. Refund records trusted amount, reference and date. These commands are gated until applicable product policies are approved. |
| PATCH `/bookings/:id/attendees/:attendeeId` | Policy-gated staff correction with version and reason. Group count/category changes require transactional repricing and capacity handling or cancel/rebook, and are disabled until policy is agreed. |
| POST `/api/events/:eventId/paid-registration/checkin` and `/api/checkin-access/checkin-paid` | Staff event role or valid event-scoped check-in session. Body `{credential}`. Derive event from session for guest checker and reject conflicting inputs. Return attendee name/status and `already_checked_in`; exclude contact, payment and proof fields. |

Financial dashboard returns due, observed receipts, accepted settlements, refund records and outstanding separately, once per booking. Proposed outstanding covers actionable unpaid obligations, with expired/cancelled obligations excluded and exceptions separately visible. Do not label transfer records as issued tax documents.

## Shared command behavior

Require `Idempotency-Key` on mutations. Scope to authenticated principal, event and action. Hash canonical validated body and file checksum where applicable, bind route resource and version, and record result in the mutation transaction. Check successful replay before version/deadline validation and after authorization. Same key/body returns original mutation outcome and resource ID with original status. Changed input yields 409. Reauthorize every replay and avoid replaying secrets. Two different keys cannot approve twice or record the same trusted transaction twice. An intentionally repeated separate booking remains possible subject to reviewed duplicate-booking policy.

Use machine codes and field errors, with localized UI messages. 400 malformed, 401 unauthenticated, 403 insufficient role/unverified, 404 unavailable or cross-scope resource, 409 `capacity_exhausted`, `quote_stale`, `version_conflict`, `hold_expired`, `duplicate_reference`, `state_conflict` or `idempotency_conflict`, 413 oversized, 415 unsupported content, 422 invalid answers or payment evidence, 429 throttled, 503 transient dependency with safe retry. A recorded exception returns the resulting state. Never infer approval from proof upload, rendering success or notification delivery.

## Messenger tools

- `get_paid_registration_options()` returns safe catalog for routed event. `start_paid_booking(contact, attendees, answers, pricing_version, form_version)` commits only after explicit group/amount confirmation and verified account binding. Use stable draft/confirmation action ID persisted with the inbound message; do not derive booking identity from model text.
- `get_paid_booking_status(booking_reference)` and `get_paid_payment_instructions(booking_reference)` resolve event plus linked verified customer. For an unlinked or ambiguous session, direct the user to authenticated web recovery. Never match by name, PSID alone, reference alone or phone text.
- `submit_paid_proof(booking_reference,attachment_handle,metadata)` uses only a trusted ingress-owned attachment handle for the same page/sender and authorized booking. Download via allowlisted provider flow with size/time bounds and no arbitrary URLs. If matching or secure intake is unavailable, use verified web upload. Acknowledge pending verification only after successful intake.
- `get_paid_attendee_credentials(booking_reference)` requires confirmed eligibility and authorization. Deliver via supported secure channel, or link to verified customer portal. Preserve latest meaningful customer language and explicit language override.
- Persist dedup over provider/page/message/action and ownership checks throughout queue retries. Retried tool execution returns prior outcome. Lost context resumes only with verified binding. Keep approval, exceptions and staff review out of customer tools. Avoid raw proof/PII in LLM transcripts, outbound logs and Telegram alerts.
