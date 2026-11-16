# Phase 0 — Decision log

## Confirmed by PRD v0.2

| Decision | Consequence |
|---|---|
| A successful booking holds capacity temporarily | Reserve one unit per attendee and enforce the deadline under transaction control. Timely accepted evidence pauses routine expiry pending review. |
| Full payment required | One combined obligation per booking. Exact trusted payment required before confirmation. Installments, deposits, split payers and automatic reconciliation are outside MVP. |
| Group booking in first release | One primary contact and N attendees with category/price snapshots and individual attendance state. |
| QR after confirmation | Issue distinct live credentials per active attendee only after manual verification has confirmed the booking. |
| Preserve existing event behavior | Add opt-in mode and leave legacy routing available. Follow phase gates before runtime changes. |

## Proposed technical decisions for review

| Proposal | Reason and tradeoff |
|---|---|
| Independent paid booking, attendee and evidence tables | Direct orders require performance and attempts require direct-order ownership. The paid lifecycle needs independent capacity and review deadlines. |
| Nullable mode and clean pilot event | Existing flags are multi-dimensional. A forced backfill could change external/public or staff ticket routing. Block mode changes on occupied events until cutover rules exist. |
| Event-first locks and derived occupancy | Serializes capacity-affecting actions without counters that drift. Load-test event contention and SQLite's single writer. |
| Verified customer ownership and linked Messenger identity | Reuses existing auth and recovery. Adds sign-in friction. Keep enrollment disabled when verified recovery is unavailable. |
| Private evidence with staged writes and cleanup | The current private-media pattern provides authorization guidance. Durable storage, object permissions and cleanup need explicit testing. |
| Atomic confirm, credential and outbox | Closes crash gaps between verification and queueing. External deliverability still depends on channel/provider. |
| Exact satang and versioned receiver snapshot | Prevents float comparisons and pricing drift. Receiver changes need explicit affected-booking handling. |

## Pending decisions and proposed interim behavior

| Topic | Proposal pending approval |
|---|---|
| Hold duration and cutoff | PRD suggests 48h. Require explicit positive per-event setting until default is confirmed. Optional cutoff disabled when omitted. Define event timezone conversion and editable cutoff policy. |
| Proof review SLA, rejection and escalation | Use original due time on rejection with no implicit extension. Escalate stale pending holds for human action. Approve SLA, escalation recipients and explicit extension limits before launch. |
| Reminders | 24h before due is a PRD proposal. Keep reminders disabled until timing, consent, channels and behavior for shorter holds are agreed. |
| Identity, dedup and group bounds | Verify customer account before web commit and require explicit verified Messenger binding. Idempotency handles retries. Decide distinct-command duplicate policy, maximum group size and optional contact fields without treating identical names as identity. |
| Finance and references | Reuse active PromptPay profile. Confirm bank-transfer account configuration, fee/tax/receipt policy, eligible seller and profile suspension effects. Decide whether Shared Receiver deployments require atomic reference dedup against legacy direct payments before pilot. A legacy lookup detects existing matches but cannot prevent a concurrent legacy writer from recording the same transfer. If shared writers are required, coordinate a common transactional reference claim/backfill or isolate pilot receivers. |
| Staff permissions | Propose owner/admin review, ordinary event staff only with a distinct payment-review capability, and check-in access scoped solely to scan. Confirm roles, proof access and separation requirements. |
| Late/mismatched/duplicate transfers | Queue exception and preserve verified observations separately. No automatic reinstatement or refund. Confirm waitlist, manual refund/reconciliation, post-check-in cancellation and whether a pending exception releases capacity. |
| Corrections and settings | Propose audited name-only correction. Confirm group count/category/price change and rebooking rules, quota reductions, cutoff edits, and ownership changes with live obligations. |
| Data retention | Confirm media store, max bytes/pixels, retention by outcome, retention after refund, access auditing, link expiry, privacy of form answers and deletion/recovery rules. |
| Dashboard accounting | Confirm outstanding/expiry reporting rules, refund attribution and reconciliation expectations. Distinguish verified transfers, confirmed sales and formal billing documents. |

Phase 0 approval is the next gate. Proposed defaults above require review before they drive implementation or public behavior.
