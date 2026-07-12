# RSS → Telegram Bot (Vercel)

Polls multiple RSS/Atom feeds on a schedule and posts new items to Telegram chats/channels. No database — each run compares item publish dates against "now minus lookback window" to decide what's new.

## How it works

1. Vercel Cron hits `/api/cron` on a schedule.
2. The function loops through `feeds.json`, fetching and parsing each feed.
3. Any item published within the last `LOOKBACK_MINUTES` gets sent to that feed's `chatId` via the Telegram Bot API.
4. No storage: the feed's own `pubDate` is the only source of truth. **`LOOKBACK_MINUTES` must be ≥ your cron interval**, or items published in the gap between runs get missed.

**Trade-off of the no-storage approach:** if a run fails, or Vercel's cron timing drifts, you can rarely miss or double-post an item right at the boundary. Telegram sendMessage is not deduplicated. If that ever matters more than simplicity, the fix is Vercel KV storing last-seen GUIDs — ask if you want that added later.

## Setup

### 1. Create the Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → follow prompts.
2. Save the token it gives you (looks like `123456789:AA...`).

### 2. Get your chat ID(s)

- **For a channel:** add your bot as an admin of the channel. Channel IDs look like `-100xxxxxxxxxx`.
- **For a group:** add the bot to the group. Group IDs look like `-xxxxxxxxx`.
- **For a DM to yourself:** message your bot first (anything, e.g. `/start`), then IDs are positive, e.g. `123456789`.

Easiest way to find any chat ID: send a message in that chat, then visit (in a browser, while logged into nothing special):
```
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
```
Look for `"chat":{"id": ...}` in the JSON response.

### 3. Configure your feeds

Edit `feeds.json`:
```json
[
  { "name": "Hacker News", "url": "https://news.ycombinator.com/rss", "chatId": "-1001234567890" },
  { "name": "My Blog", "url": "https://example.com/feed.xml", "chatId": "987654321" }
]
```
- `name` — label shown in the Telegram message
- `url` — the RSS/Atom feed URL
- `chatId` — where that feed's items get posted (string or number, quotes are fine either way)

Multiple feeds can share the same `chatId`, or each can go to a different one — that's the multi-channel routing.

### 4. Deploy to Vercel

```bash
npm i -g vercel
cd rss-telegram-bot
vercel
```

Then set environment variables (Vercel dashboard → Project → Settings → Environment Variables, or via CLI):
```bash
vercel env add TELEGRAM_BOT_TOKEN
vercel env add CRON_SECRET
```
- `TELEGRAM_BOT_TOKEN` — from step 1
- `CRON_SECRET` — any random 16+ char string (e.g. `openssl rand -hex 16`). Vercel automatically sends this as the cron request's `Authorization: Bearer <value>` header, and `api/cron.js` checks it — this stops randoms from hitting your endpoint and spamming your channels.

Deploy to production (cron jobs only run on production deployments, not previews):
```bash
vercel --prod
```

### 5. Check the schedule matches your plan

`vercel.json` ships with `*/15 * * * *` (every 15 min). **Vercel Hobby (free) accounts only allow cron jobs that run once per day** — more frequent schedules fail at deploy time. If you're on Hobby:

1. In `vercel.json`, change `"schedule"` to something like `"0 9 * * *"` (daily, 9am UTC).
2. Set `LOOKBACK_MINUTES` to `1440` (24 hours) via `vercel env add LOOKBACK_MINUTES`, so the daily run catches everything since the last one.

On Vercel Pro, more frequent schedules (e.g. every 15 min) work fine and are more useful for "new updates" feeling timely.

## Testing without waiting for the cron

After deploying, trigger it manually:
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-project.vercel.app/api/cron
```
You'll get back JSON showing what was checked and sent per feed — useful for confirming chat IDs and feed URLs are correct.

## Adding/removing feeds later

Just edit `feeds.json` and redeploy (`vercel --prod`). No other code changes needed.

## Files

- `api/cron.js` — the function Vercel invokes on schedule
- `feeds.json` — your feed-to-chat config
- `vercel.json` — cron schedule + function timeout
- `.env.example` — documents required env vars (copy to `.env` for local testing with `vercel dev`)
