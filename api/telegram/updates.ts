export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { botToken } = req.body || {};
    const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) {
      return res.status(400).json({ success: false, error: 'Bot Token is required.' });
    }

    let response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=["message"]`);
    let result = await response.json() as any;
    let webhookReleased = false;

    // Handle 409 Conflict: when a webhook was active on this bot, getUpdates fails with 409
    if (!response.ok && (response.status === 409 || result?.error_code === 409)) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ drop_pending_updates: false })
        });
        webhookReleased = true;
        await new Promise(r => setTimeout(r, 400));
        response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=["message"]`);
        result = await response.json() as any;
      } catch (delErr) {
        console.error('Vercel updates auto-release webhook error:', delErr);
      }
    }

    if (!response.ok || !result.ok) {
      return res.status(response.status || 400).json({
        success: false,
        error: result?.description || 'Failed to fetch updates from Telegram'
      });
    }

    const mappedUsers: { [username: string]: { chatId: string; firstName: string; date: number; text?: string } } = {};
    const sendersList: any[] = [];
    const updates = Array.isArray(result.result) ? result.result : [];

    for (const u of updates) {
      const msg = u.message || u.edited_message;
      if (msg && msg.from && msg.chat) {
        const rawUser = msg.from.username || msg.chat.username || '';
        const chatIdStr = String(msg.chat.id);
        const fName = msg.from.first_name || msg.chat.first_name || '';
        const lName = msg.from.last_name || msg.chat.last_name || '';
        const msgText = (msg.text || '').trim();
        const lower = msgText.toLowerCase();
        const isCmd = (
          lower === 'start' || lower === '/start' ||
          lower === 'confirm' || lower === '/confirm' ||
          lower === 'access' || lower === '/access' ||
          lower === 'verify' || lower === '/verify' ||
          lower.startsWith('/start') || lower.startsWith('start') ||
          lower.startsWith('/confirm') || lower.startsWith('confirm') ||
          lower === 'id' || lower === '/id' || lower === '/chatid'
        );

        const senderObj = {
          chatId: chatIdStr,
          username: rawUser ? `@${rawUser.toLowerCase()}` : '',
          firstName: fName,
          lastName: lName,
          text: msgText,
          date: msg.date || Math.floor(Date.now() / 1000),
          timestamp: new Date().toISOString(),
          isConfirmedCommand: isCmd
        };
        sendersList.push(senderObj);

        if (rawUser) {
          const withAt = `@${rawUser.toLowerCase().trim()}`;
          const bare = rawUser.toLowerCase().trim();
          mappedUsers[withAt] = { chatId: chatIdStr, firstName: fName, date: msg.date, text: msgText };
          mappedUsers[bare] = { chatId: chatIdStr, firstName: fName, date: msg.date, text: msgText };
        }
        if (fName) {
          mappedUsers[fName.toLowerCase().trim()] = { chatId: chatIdStr, firstName: fName, date: msg.date, text: msgText };
        }
      }
    }

    return res.status(200).json({ 
      success: true, 
      count: Object.keys(mappedUsers).length, 
      users: mappedUsers, 
      senders: sendersList,
      rawUpdatesCount: updates.length,
      webhookReleased 
    });
  } catch (err: any) {
    console.error('Vercel Get updates error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Error fetching updates' });
  }
}
