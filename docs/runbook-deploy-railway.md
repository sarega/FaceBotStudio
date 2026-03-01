# Railway Deploy Runbook

## Services
- `FaceBotStudio` web service
- `Postgres` database service
- `Redis` database service

## Required variables on the web service
- `DATABASE_URL`
- `REDIS_URL`
- `OPENROUTER_API_KEY`
- `PAGE_ACCESS_TOKEN`
- `FACEBOOK_APP_SECRET` (recommended)
- `APP_URL`
- `ADMIN_USER`
- `ADMIN_PASS`
- `DB_PATH` (temporary fallback during SQLite -> Postgres transition)
- `APP_RUNTIME` (optional; default is `all`)

## Database migration
Run after pulling a new version that changes the schema:

```bash
npm run db:migrate
```

The migration runner will:
- create the `schema_migrations` table
- apply SQL files from `backend/db/migrations`
- bootstrap Postgres from the legacy SQLite file if Postgres is still empty
- seed default settings that are missing

## Deploy sequence
1. Ensure `DATABASE_URL` and `REDIS_URL` are connected to the web service.
2. For a single-service deploy, keep start command as `npm run start`.
3. Deploy the latest commit.
4. Verify `/api/health` returns `database: postgres`.
5. Verify `/api/health` reports `queue: redis` when Redis is available.
6. Test registration creation.
7. Test ticket preview/download.
8. If `FACEBOOK_APP_SECRET` is configured, confirm Meta webhook signature verification passes.
9. Test Facebook webhook verification and a live message.

## Optional split runtime
When ready to separate web and worker services:

1. Web service:
   - Start command: `npm run start:web`
   - `APP_RUNTIME=web`
2. Worker service:
   - Start command: `npm run start:worker`
   - `APP_RUNTIME=worker`
3. Both services must share the same `DATABASE_URL`, `REDIS_URL`, and app secrets.

## Runtime notes
- Login and webhook rate limiting use Redis when available, with in-memory fallback.
- Facebook inbound webhook events are deduplicated before processing.
- If Redis is unavailable, the app falls back to inline processing.

## Rollback notes
- Keep the SQLite volume in place during Sprint 1.
- If Postgres startup fails, unset `DATABASE_URL` to fall back to SQLite temporarily.
- Do not remove the SQLite volume until the Postgres cutover is fully validated.
