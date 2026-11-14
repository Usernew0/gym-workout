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
    const firstName = fromUser.first_name || message.chat.first_name || 'Lover';
    const text = (message.text || '').trim();
    const lowerText = text.toLowerCase();

    // Check for confirmation command (accepts bare words and slash commands)
    const isConfirmedCommand = (
      lowerText === 'start' || lowerText === '/start' ||
      lowerText === 'confirm' || lowerText === '/confirm' ||
      lowerText === 'access' || lowerText === '/access' ||
      lowerText === 'verify' || lowerText === '/verify' ||
      lowerText === 'ok' || lowerText === 'yes' ||
      lowerText.startsWith('/start') || lowerText.startsWith('start') ||
      lowerText.startsWith('/confirm') || lowerText.startsWith('confirm') ||
      lowerText === 'id' || lowerText === '/id' || lowerText === '/chatid'
    );

    console.log(`[Vercel Telegram Webhook] Message from ${tgUsername || firstName} (${chatId}): "${text}" (isConfirmedCommand=${isConfirmedCommand})`);

    const token = (req.query?.token as string) || process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      let replyText = '';

      if (isConfirmedCommand || lowerText === 'hi' || lowerText === 'hello') {
        replyText = `✅ <b>Access Confirmed & Verified!</b> 🎉\n\n` +
          `Hello <b>${firstName}</b> (${tgUsername ? '<code>' + tgUsername + '</code>' : 'Your Chat'})!\n\n` +
          `Your Telegram account is now successfully confirmed and linked with <b>Our Home</b>.\n` +
          `• <b>Chat ID:</b> <code>${chatId}</code>\n` +
          `• <b>Status:</b> Active Recipient 🟢\n\n` +
          `You will now receive personalized real-time alerts for anniversaries 💍, dates 🗓️, love letters 💌, and sweet chats 💬!\n\n` +
          `<i>Tip: Send /status anytime to inspect your active bot connection.</i> 💕`;
      } else if (lowerText === '/id' || lowerText === '/chatid' || lowerText === 'id' || lowerText === 'chatid') {
        replyText = `🆔 <b>Your Telegram Credentials:</b>\n\n` +
          `• Chat ID: <code>${chatId}</code>\n` +
          (tgUsername ? `• Username: <b>${tgUsername}</b>\n\n` : '\n') +
          `Your Chat ID is registered! Send <b>confirm</b> or <b>/confirm</b> to complete verification.`;
      } else if (lowerText === '/status' || lowerText === 'status') {
        replyText = `📊 <b>Our Home Alert Connection Status:</b>\n\n` +
          `• Name: <b>${firstName}</b>\n` +
          (tgUsername ? `• Telegram: <code>${tgUsername}</code>\n` : '') +
          `• Chat ID: <code>${chatId}</code>\n` +
          `• Alerts Engine: <b>Online & Receiving Alerts 🟢</b>\n` +
          `• System Time: <i>${new Date().toLocaleString()}</i>`;
      } else if (lowerText === '/help' || lowerText === 'help') {
        replyText = `🤖 <b>Our Home Telegram Bot Commands:</b>\n\n` +
          `• <code>confirm</code> or <code>/confirm</code> - Confirm your access and register for alerts\n` +
          `• <code>chatid</code> or <code>/id</code> - Display your destination Chat ID\n` +
          `• <code>status</code> or <code>/status</code> - Check your alert delivery status\n` +
          `• <code>help</code> or <code>/help</code> - Show available commands`;
      } else {
        replyText = `💍 <b>Our Home Bot</b> 💕\n\n` +
          `Hello <b>${firstName}</b> (${tgUsername ? '<code>' + tgUsername + '</code>' : ''})!\n` +
          `Your Chat ID is <code>${chatId}</code>.\n\n` +
          `Send <b>confirm</b> or <b>/confirm</b> to activate multi-user alerts for your account! ✨`;
      }

      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
          parse_mode: 'HTML'
        })
      }).catch(err => console.warn('Failed to reply to webhook update:', err));
    }

    return res.status(200).json({ ok: true, received: true, chatId, username: tgUsername, text });
  } catch (err: any) {
    console.error('Vercel Telegram webhook handler error:', err);
    return res.status(200).json({ ok: true, error: err.message });
  }
}
