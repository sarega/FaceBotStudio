<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FaceBotStudio

FaceBotStudio is a workspace for designing, testing, and operating Facebook Page conversations, registrations, event communications, and staff check-in.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `OPENROUTER_API_KEY` in `.env` to your OpenRouter API key
3. If you want registration confirmation emails, also set:
   - `RESEND_API_KEY`
   - `EMAIL_FROM`
   - `EMAIL_REPLY_TO`
   - `APP_URL`
4. Run the app:
   `npm run dev`

Optional release metadata:
- `APP_VERSION` overrides the version shown in user profiles and audit logs.
- `APP_REVISION` stores the deployed Git commit or release ID in user profiles and audit logs.

Production runtime modes:
- `npm run start` = web + embedded worker (`APP_RUNTIME=all`)
- `npm run start:web` = web-only runtime
- `npm run start:worker` = worker-only runtime

## Facebook Auto-Reply (Webhook)

To auto-reply in Messenger (not just log messages), set these in `.env`:

- `OPENROUTER_API_KEY`
- `PAGE_ACCESS_TOKEN`
- `FACEBOOK_APP_SECRET` (recommended for webhook signature verification)
- `APP_URL` (public URL)

Then set your Facebook webhook callback URL to:

- `https://YOUR_DOMAIN/api/webhook`

## Railway (Demo Setup)

Recommended for low-traffic demos with SQLite:

1. Create a Railway project and connect this GitHub repo.
2. Add a Volume and mount it to `/data`.
3. Set environment variables:
   - `OPENROUTER_API_KEY`
   - `PAGE_ACCESS_TOKEN` (for real Messenger auto-replies)
   - `FACEBOOK_APP_SECRET` (recommended)
   - `REDIS_URL`
   - `RESEND_API_KEY` (for transactional registration email)
   - `EMAIL_FROM`
   - `EMAIL_REPLY_TO`
   - `OPENROUTER_DEFAULT_MODEL=your-supported-model-id`
   - `OPENROUTER_EMBEDDING_MODEL=text-embedding-3-small` (optional, for queued document vectors + retrieval)
   - `EMBEDDING_HOOK_URL=https://your-worker-or-api.example.com/embeddings` (optional, receives a copy of embedding jobs after local vectors are stored)
   - `SESSION_TTL_DAYS=14`
   - `CHECKIN_ACCESS_SESSION_TTL_MINUTES=120` (scoped check-in cookie lifetime)
   - `JSON_BODY_LIMIT=256kb` (API payload cap)
   - `CSRF_ALLOWED_ORIGINS=https://admin.example.com` (optional extra trusted origins)
   - `TRUST_PROXY=1` (set explicitly in production; use `false` if direct/no proxy)
   - `DB_PATH=/data/bot.db`
   - `PUBLIC_UPLOADS_DIR=/data/uploads`
   - `APP_URL=https://YOUR_APP.up.railway.app`
4. Build command: `npm run build`
5. Start command: `npm run start`
6. Verify health endpoint: `/api/health`

## Railway (Queue / Worker Foundation)

Current safe default:
- Keep one service on `npm run start`
- This runs `APP_RUNTIME=all`, so the web app also runs the embedded webhook worker
- `Queue Embedding` generates local chunk vectors through OpenRouter, so Retrieval Debug and live replies can use vector-aware matching once the job is ready

When ready to split services:
1. Web service start command: `npm run start:web`
2. Worker service start command: `npm run start:worker`
3. Both services must share:
   - `DATABASE_URL`
   - `REDIS_URL`
   - `OPENROUTER_API_KEY`
   - `PAGE_ACCESS_TOKEN`
   - `FACEBOOK_APP_SECRET`
   - `APP_URL`
