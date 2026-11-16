# Codex Work Order — FaceBotStudio Paid Registration

Read and follow `docs/prd-paid-registration-v0.2.md` as the product source of truth.

## Objective

Start **Phase 0: Architecture Audit and Technical Design** immediately. Inspect the actual FaceBotStudio repository rather than assuming existing functionality. Produce all five documents:
- `docs/paid-registration/architecture-audit.md`
- `docs/paid-registration/data-model.md`
- `docs/paid-registration/api-contracts.md`
- `docs/paid-registration/implementation-tasks.md`
- `docs/paid-registration/decision-log.md`

## Required code inspection

Audit `server.ts`, `backend/db/postgresAdapter.ts`, `backend/db/sqliteAdapter.ts`, `backend/db/types.ts`, migrations, direct-order/payment attempts, organizer financial settings, public registration, dashboard, event capacity, QR/check-in, notification workers, Messenger integration, and existing tests. Trace full requests and transaction boundaries.

Capture precise reuse-vs-extend decisions; identify DB constraints and race conditions; define paid booking vs attendee vs payment semantics; make backward-compatible migration and API plans; specify idempotency, security, proof privacy, group and full-payment requirements and QR gated on verified confirmation. Identify unknowns without silently deciding unconfirmed product policies.

## Guardrails

- Do not modify runtime feature code, schema or public APIs in Phase 0.
- Do not touch the unrelated untracked `backups/` directory.
- No automatic commit, push or deploy.
- Use TypeScript-first guidance and keep Free Registration/Direct Ticketing behavior intact.
- Finish with a concise audit summary, concrete architecture recommendations, risks, and next-phase tasks for review.

After Phase 0 review is approved, implement Phase 1–5 in order with tests and milestone gates from the PRD. Do not skip approval to move to implementation.
