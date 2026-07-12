// Receives incoming Telegram messages via webhook and replies to /start.
// This is separate from cron.js: cron.js pushes feed items out on a timer;
// this endpoint reacts to a user messaging the bot. No storage needed here
// -- each /start is handled and answered in the same request, nothing is
// remembered afterward.
//
// One-time setup after deploying (see README): tell Telegram to call this
// URL by visiting, once, in a browser:
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-project>.vercel.app/api/webhook

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const WELCOME_MESSAGE =
  "👋 You're connected. This bot posts new items from configured RSS feeds to this chat.\n\n" +
  'Feeds are managed by the bot admin in feeds.json, not from here — there are no chat commands to add feeds yet.\n\n' +
  "This chat's ID is:";

async function sendTelegramMessage(chatId, text) {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
  return res.json();
}

module.exports = async (req, res) => {
  // Optional but recommended: Telegram can be told a secret token to send
  // back on every webhook call, so randoms can't POST fake messages at
  // this URL and make the bot spam a chat. Set WEBHOOK_SECRET in Vercel
  // env vars, then include it when calling setWebhook (see README) using
  // the secret_token parameter.
  if (process.env.WEBHOOK_SECRET) {
    const provided = req.headers['x-telegram-bot-api-secret-token'];
    if (provided !== process.env.WEBHOOK_SECRET) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN env var is not set' });
    return;
  }

  // Telegram expects a fast 200 response regardless of what's inside, or
  // it will retry the same update. We always ack first conceptually, but
  // since sending the reply is itself quick, we just do it inline and
  // still return 200 even if something below throws.
  try {
    const update = req.body || {};
    const message = update.message;
    const text = message?.text || '';
    const chatId = message?.chat?.id;

    if (chatId && text.startsWith('/start')) {
      await sendTelegramMessage(chatId, `${WELCOME_MESSAGE} ${chatId}`);
    }
    // Any other message/command is silently ignored for now — this
    // endpoint only handles /start.
  } catch (err) {
    // Log but still 200 — Telegram will keep retrying non-200 responses,
    // which isn't useful for a bug that will just fail the same way again.
    console.error('webhook error:', err.message);
  }

  res.status(200).json({ ok: true });
};
