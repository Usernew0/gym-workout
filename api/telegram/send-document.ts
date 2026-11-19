import { sendTelegramDocument } from '../../server/telegramBotEngine';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { botToken, chatId, fileBase64, filename, mimeType = 'application/octet-stream', caption } = req.body || {};
    const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chat = (chatId || process.env.TELEGRAM_CHAT_ID || '').trim();

    if (!token || !chat) {
      return res.status(400).json({
        success: false,
        error: 'Missing botToken or chatId. Configure your credentials in Admin Panel.',
      });
    }

    if (!fileBase64 || !filename) {
      return res.status(400).json({ success: false, error: 'File content and filename are required.' });
    }

    const buffer = Buffer.from(String(fileBase64), 'base64');
    const result = await sendTelegramDocument(token, chat, buffer, String(filename), String(mimeType), caption);

    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Telegram sendDocument returned an error',
      });
    }

    return res.status(200).json({ success: true, messageId: result.messageId });
  } catch (err: any) {
    console.error('Vercel Telegram send-document error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Server error' });
  }
}
