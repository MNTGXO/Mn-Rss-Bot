const Parser = require('rss-parser');
const feeds = require('../feeds.json');

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'rss-telegram-bot/1.0' },
});

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// How far back to look for "new" items, in minutes.
// Should be >= your cron interval so nothing falls in the gap between runs
// (padded above the interval, since Vercel cron timing can drift slightly).
// Default of 1500 (25h) matches the daily schedule in vercel.json.
// If you change the cron schedule, update this to match — see README.
// Override via LOOKBACK_MINUTES in Vercel env vars.
const LOOKBACK_MINUTES = parseInt(process.env.LOOKBACK_MINUTES || '1500', 10);

// Max items sent per feed per run. Caps how bad a flood can be — from a
// feed that's just genuinely busy, or from the very first run ever
// checking a feed that already had a backlog inside the lookback window.
//
// IMPORTANT: with no storage, the function has no way to know "this is
// the first time I've checked this feed" versus "this feed is just
// active." Both look identical from here — there's nothing written down
// anywhere to tell them apart. This cap limits the damage either way,
// it doesn't fix the underlying ambiguity. If you want true first-run
// suppression (silently mark a new feed as caught up, then only alert on
// genuinely new items after that), that requires persisting at least one
// fact per feed — say if you'd like that added later.
// Override via MAX_ITEMS_PER_FEED in Vercel env vars.
const MAX_ITEMS_PER_FEED = parseInt(process.env.MAX_ITEMS_PER_FEED || '5', 10);

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegramMessage(chatId, text) {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
  return res.json();
}

function formatMessage(feedName, item) {
  const title = escapeHtml(item.title || 'Untitled');
  const link = item.link || '';
  return `<b>${escapeHtml(feedName)}</b>\n${title}\n${link}`;
}

// Vercel cron invokes this via GET. We also accept POST for manual/local testing.
module.exports = async (req, res) => {
  // Verify the request is actually from Vercel Cron (or a manual call with the secret).
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN env var is not set' });
    return;
  }

  const cutoff = Date.now() - LOOKBACK_MINUTES * 60 * 1000;
  const results = [];

  for (const feed of feeds) {
    const { name, url, chatId } = feed;

    if (!url || !chatId) {
      results.push({ name, ok: false, error: 'Missing url or chatId in feeds.json' });
      continue;
    }

    try {
      const parsed = await parser.parseURL(url);
      const withinWindow = (parsed.items || []).filter((item) => {
        const published = item.isoDate ? new Date(item.isoDate).getTime() : null;
        return published !== null && published >= cutoff;
      });

      // Newest first, so if we have to cap, we keep the most recent ones.
      withinWindow.sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
      const capped = withinWindow.length > MAX_ITEMS_PER_FEED;
      const newItems = withinWindow.slice(0, MAX_ITEMS_PER_FEED);

      // Send oldest-of-the-kept-ones first, so channel order reads chronologically.
      newItems.sort((a, b) => new Date(a.isoDate) - new Date(b.isoDate));

      let sent = 0;
      for (const item of newItems) {
        try {
          await sendTelegramMessage(chatId, formatMessage(name, item));
          sent++;
          // Stay comfortably under Telegram's ~1 msg/sec per-chat limit.
          await new Promise((r) => setTimeout(r, 350));
        } catch (sendErr) {
          results.push({ name, ok: false, error: `send failed: ${sendErr.message}`, item: item.title });
        }
      }

      results.push({ name, ok: true, checked: parsed.items?.length || 0, sent, capped: capped || undefined });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  }

  res.status(200).json({ ranAt: new Date().toISOString(), lookbackMinutes: LOOKBACK_MINUTES, results });
};
