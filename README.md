# RSS → Telegram Bot (Vercel)

Polls multiple RSS/Atom feeds on a schedule and posts new items to Telegram chats/channels, plus replies with a welcome message when someone messages the bot `/start`. No database — each cron run compares item publish dates against "now minus lookback window" to decide what's new.

## How it works

1. Vercel Cron hits `/api/cron` on a schedule (daily, by default — see step 6).
2. The function loops through `feeds.json`, fetching and parsing each feed.
3. Any item published within the last `LOOKBACK_MINUTES` gets sent to that feed's `chatId` via the Telegram Bot API, newest `MAX_ITEMS_PER_FEED` only.
4. No storage: the feed's own `pubDate` is the only source of truth. **`LOOKBACK_MINUTES` must be ≥ your cron interval**, or items published in the gap between runs get missed.

Separately, `/api/webhook` listens for Telegram sending it messages (a different trigger — Telegram calls it directly, not on a timer) and replies to `/start` with a welcome message that includes the chat's ID, handy for filling in `feeds.json`.

**Trade-offs of the no-storage approach:**
- If a run fails, or Vercel's cron timing drifts, you can rarely miss or double-post an item right at the boundary of the lookback window.
- The function has no way to know "this is the first time I've ever checked this feed" versus "this feed is just active" — both look identical with nothing persisted anywhere. `MAX_ITEMS_PER_FEED` caps how bad either case can be (only ever sends the N newest items per feed per run), but it's a damage cap, not a real fix for the ambiguity.
- Telegram sendMessage is not deduplicated.

If any of this ever matters more than staying storage-free, the real fix is persisting one fact per feed (last-seen item), which needs a KV store — ask if you want that added later.

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

Two more are optional (both have working defaults — see `.env.example`): `LOOKBACK_MINUTES` and `MAX_ITEMS_PER_FEED` (caps how many items post per feed in one run, default 5).

Deploy to production (cron jobs only run on production deployments, not previews):
```bash
vercel --prod
```

### 5. Enable the `/start` welcome message (optional)

This is a one-time step, separate from the cron — it tells Telegram to call your bot's webhook whenever someone messages it.

1. Set the webhook secret (recommended, stops randoms from POSTing fake messages at your endpoint):
   ```bash
   vercel env add WEBHOOK_SECRET
   ```
2. After deploying, register the webhook by visiting this URL once (in a browser, or via curl) — replace both placeholders:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<your-project>.vercel.app/api/webhook&secret_token=<YOUR_WEBHOOK_SECRET>
   ```
   A `{"ok":true,"result":true,...}` response means it's registered.
3. Message your bot `/start` on Telegram. You should get a welcome reply that includes the chat's ID — the same ID you need for `feeds.json`.

If you skip this step, the bot still works for posting feed items; `/start` just won't get a reply.

### 6. Check the schedule matches your plan

`vercel.json` ships with `"0 9 * * *"` (daily, 9am UTC) — Hobby-plan compatible, paired with `LOOKBACK_MINUTES=1500` (25h) so the daily run catches everything since the previous one.

**Vercel Hobby (free) accounts only allow cron jobs that run once per day** — more frequent schedules fail at deploy time. If you're on Vercel Pro and want closer-to-real-time posting:

1. In `vercel.json`, change `"schedule"` to e.g. `"*/15 * * * *"` (every 15 min).
2. Lower `LOOKBACK_MINUTES` to roughly 25–30 (padded above the interval, not equal to it — see the trade-offs note above for why).

Keep these two numbers matched any time you change either one — a schedule and a lookback that disagree means either flooding (lookback way bigger than the interval) or silent misses (lookback smaller than the interval).

## Testing without waiting for the cron

After deploying, trigger it manually:
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-project.vercel.app/api/cron
```
You'll get back JSON showing what was checked and sent per feed — useful for confirming chat IDs and feed URLs are correct.

## Adding/removing feeds later

Just edit `feeds.json` and redeploy (`vercel --prod`). No other code changes needed.

## Files

- `api/cron.js` — the function Vercel invokes on schedule; posts new feed items
- `api/webhook.js` — receives Telegram messages, replies to `/start`
- `feeds.json` — your feed-to-chat config
- `vercel.json` — cron schedule + function timeout
- `.env.example` — documents required env vars (copy to `.env` for local testing with `vercel dev`)
