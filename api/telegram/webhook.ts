import {
  fetchFirestoreTelegramConfig,
  replyToTelegramMessage,
} from '../../server/telegramBotEngine';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const update = req.body;
    const message = update?.message || update?.edited_message;

    if (!message || !message.chat) {
      return res.status(200).json({ ok: true, note: 'No message payload' });
    }

    const chatId = String(message.chat.id);
    const fromUser = message.from || {};
    const rawUser = fromUser.username || message.chat.username || '';
    const tgUsername = rawUser ? `@${rawUser}` : '';
    const text = (message.text || '').trim();

    let token = (req.query?.token as string) || process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token) {
      const fsConfig = await fetchFirestoreTelegramConfig().catch(() => null);
      token = (fsConfig?.botToken || '').trim();
    }

    if (token) {
      await replyToTelegramMessage(token, message).catch((err) =>
        console.warn('Failed to reply to Vercel webhook update:', err)
      );
    }

    return res.status(200).json({ ok: true, received: true, chatId, username: tgUsername, text });
  } catch (err: any) {
    console.error('Vercel Telegram webhook handler error:', err);
    return res.status(200).json({ ok: true, error: err.message });
  }
}
