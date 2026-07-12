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
      const newItems = (parsed.items || []).filter((item) => {
        const published = item.isoDate ? new Date(item.isoDate).getTime() : null;
        return published !== null && published >= cutoff;
      });

      // Oldest first, so channel order reads chronologically.
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

      results.push({ name, ok: true, checked: parsed.items?.length || 0, sent });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  }

  res.status(200).json({ ranAt: new Date().toISOString(), lookbackMinutes: LOOKBACK_MINUTES, results });
};
