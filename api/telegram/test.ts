export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { botToken, chatId } = req.body || {};
    const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chat = (chatId || process.env.TELEGRAM_CHAT_ID || '').trim();

    if (!token || !chat) {
      return res.status(400).json({ 
        success: false, 
        error: 'Please enter both the Bot Token and Chat ID to run the test.' 
      });
    }

    const testMessage = `🎉 <b>Our Home Telegram Alert Test</b>\n\n` +
      `Your Telegram bot is successfully connected to <b>Our Home</b>! 💕\n` +
      `You will now receive milestone countdowns, date reminders, love letter alerts, and security notifications directly in this chat.\n\n` +
      `<i>Time: ${new Date().toLocaleString()}</i>`;

    const telegramUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: testMessage,
        parse_mode: 'HTML'
      })
    });

    const result = await response.json() as any;

    if (!response.ok || !result.ok) {
      return res.status(response.status || 400).json({
        success: false,
        error: result.description || 'Telegram API rejected the test message',
        errorCode: result.error_code
      });
    }

    return res.status(200).json({ success: true, message: 'Test message sent successfully to Telegram!' });
  } catch (err: any) {
    console.error('Vercel Telegram test error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to connect to Telegram API' });
  }
}
