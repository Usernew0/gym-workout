export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { botToken, chatId, text, parseMode = 'HTML' } = req.body || {};
    const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chat = (chatId || process.env.TELEGRAM_CHAT_ID || '').trim();

    if (!token || !chat) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing botToken or chatId. Configure your credentials in Admin Panel.' 
      });
    }

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'Message text is required.' });
    }

    const telegramUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true
      })
    });

    const result = await response.json() as any;

    if (!response.ok || !result.ok) {
      return res.status(response.status || 400).json({
        success: false,
        error: result.description || 'Telegram API returned an error',
        errorCode: result.error_code
      });
    }

    return res.status(200).json({ success: true, messageId: result.result?.message_id });
  } catch (err: any) {
    console.error('Vercel Telegram send error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Server error' });
  }
}
