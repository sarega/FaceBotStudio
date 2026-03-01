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
2. Deploy the latest commit.
3. Verify `/api/health` returns `database: postgres`.
4. Test registration creation.
5. Test ticket preview/download.
6. If `FACEBOOK_APP_SECRET` is configured, confirm Meta webhook signature verification passes.
7. Test Facebook webhook verification and a live message.

## Rollback notes
- Keep the SQLite volume in place during Sprint 1.
- If Postgres startup fails, unset `DATABASE_URL` to fall back to SQLite temporarily.
- Do not remove the SQLite volume until the Postgres cutover is fully validated.
