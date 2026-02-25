<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

<!-- View your app in AI Studio: https://ai.studio/apps/8ae339aa-d752-43e7-bcb4-6295c4d2f4b4 -->

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `OPENROUTER_API_KEY` in `.env` to your OpenRouter API key
3. Run the app:
   `npm run dev`

## Facebook Auto-Reply (Webhook)

To auto-reply in Messenger (not just log messages), set these in `.env`:

- `OPENROUTER_API_KEY`
- `PAGE_ACCESS_TOKEN`
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
   - `OPENROUTER_DEFAULT_MODEL=google/gemini-3-flash-preview`
   - `DB_PATH=/data/bot.db`
   - `APP_URL=https://YOUR_APP.up.railway.app`
4. Build command: `npm run build`
5. Start command: `npm run start`
6. Verify health endpoint: `/api/health`
