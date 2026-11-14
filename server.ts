import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const app = express();
const PORT = 3000;

const isProduction = process.env.NODE_ENV === 'production';
const projectRoot = process.cwd();

// Initialize GoogleGenAI server-side with User-Agent header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build'
    }
  }
});


async function startServer() {
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // AI Date Night Itinerary Generator Endpoint (Pro Feature)
  app.post('/api/generate-date', async (req, res) => {
    try {
      const { budget, mood, location, duration, occasion } = req.body;

      const prompt = `Design a romantic, memorable, and creative date night itinerary for a couple.
Occasion: ${occasion || 'Romantic Date'}
Budget: ${budget || 'Flexible'}
Mood/Vibe: ${mood || 'Cozy & Romantic'}
Location/Setting: ${location || 'Local city'}
Duration: ${duration || 'Evening (3-4 hours)'}

Return a structured JSON object containing:
- "title": a captivating date title
- "category": one of ["dinner", "adventure", "home", "budget", "other"]
- "description": a warm 2-3 sentence overview of why this date is special
- "theme": a 2-4 word aesthetic theme
- "cost": one of ["Free", "$", "$$", "$$$"]
- "checklist": an array of 4-6 step-by-step checklist items with "id" and "text"
- "notes": romantic advice or secret tips for making it unforgettable`;

      if (process.env.GEMINI_API_KEY) {
        const response = await ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                category: { type: Type.STRING },
                description: { type: Type.STRING },
                theme: { type: Type.STRING },
                cost: { type: Type.STRING },
                checklist: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      text: { type: Type.STRING }
                    },
                    required: ['id', 'text']
                  }
                },
                notes: { type: Type.STRING }
              },
              required: ['title', 'category', 'description', 'checklist']
            }
          }
        });

        const data = JSON.parse(response.text || '{}');
        return res.json({ success: true, plan: data });
      } else {
        // Fallback structured date plan generator if GEMINI_API_KEY is not set yet
        const fallbackPlan = {
          title: `${mood || 'Romantic'} Candlelight ${occasion || 'Evening'}`,
          category: budget === 'Free' || budget === '$' ? 'home' : 'dinner',
          description: `An intimate, handcrafted ${mood?.toLowerCase() || 'romantic'} experience curated specifically for your setting at ${location || 'home'}. Enjoy quality uninterrupted time together.`,
          theme: `${mood || 'Cozy'} Elegance`,
          cost: budget || '$$',
          checklist: [
            { id: '1', text: 'Set up soft background acoustic music & warm ambient lighting' },
            { id: '2', text: `Prepare a special ${budget === 'Free' ? 'homemade treat' : 'dinner reservation'}` },
            { id: '3', text: 'Put away mobile phones in a memory box for complete focus' },
            { id: '4', text: 'Exchange a surprise written Love Note or memory card' }
          ],
          notes: 'Pro Tip: Take a candid photo during dinner to save in your Memory Vault Scrapbook!'
        };
        return res.json({ success: true, plan: fallbackPlan, isFallback: true });
      }
    } catch (err: any) {
      console.error('Error generating AI date itinerary:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to generate date plan' });
    }
  });

  // Stripe Checkout Session Endpoint (Simulated / Real Handler)
  app.post('/api/stripe/checkout', async (req, res) => {
    try {
      const { plan, coupleId, email, promoCode } = req.body;
      const checkoutId = 'cs_live_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      
      // Simulate successful Stripe checkout session
      res.json({
        success: true,
        sessionId: checkoutId,
        url: `#stripe-checkout-success?session=${checkoutId}`,
        plan: plan || 'pro',
        amount: promoCode === 'LOVE50' ? 2.49 : (plan === 'annual' ? 39.99 : 4.99),
        currency: 'usd',
        status: 'complete',
        customerEmail: email || 'couple@ourhome.app'
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Telegram Senders Cache & Memory Buffer
  interface TelegramCapturedSender {
    chatId: string;
    username: string;
    firstName: string;
    lastName?: string;
    text: string;
    date: number;
    timestamp: string;
    isConfirmedCommand?: boolean;
  }

  let lastKnownBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
  let capturedTelegramSenders: TelegramCapturedSender[] = [];

  const sendersCachePath = path.join(projectRoot, 'public', 'telegram_senders.json');
  try {
    if (fs.existsSync(sendersCachePath)) {
      const raw = fs.readFileSync(sendersCachePath, 'utf-8');
      capturedTelegramSenders = JSON.parse(raw);
    }
  } catch (e) {
    console.warn("Could not load cached telegram senders:", e);
  }

  function recordCapturedSender(sender: TelegramCapturedSender) {
    const existingIdx = capturedTelegramSenders.findIndex(s => s.chatId === sender.chatId);
    if (existingIdx >= 0) {
      capturedTelegramSenders[existingIdx] = {
        ...capturedTelegramSenders[existingIdx],
        ...sender,
        username: sender.username || capturedTelegramSenders[existingIdx].username,
        text: sender.text || capturedTelegramSenders[existingIdx].text,
        date: sender.date || capturedTelegramSenders[existingIdx].date,
        timestamp: new Date().toISOString(),
        isConfirmedCommand: sender.isConfirmedCommand ?? capturedTelegramSenders[existingIdx].isConfirmedCommand
      };
    } else {
      capturedTelegramSenders.unshift(sender);
    }
    if (capturedTelegramSenders.length > 100) {
      capturedTelegramSenders = capturedTelegramSenders.slice(0, 100);
    }
    try {
      const pubDir = path.join(projectRoot, 'public');
      if (!fs.existsSync(pubDir)) fs.mkdirSync(pubDir, { recursive: true });
      fs.writeFileSync(sendersCachePath, JSON.stringify(capturedTelegramSenders, null, 2));
    } catch (err) {
      // ignore
    }
  }

  // Telegram Bot Dispatch Endpoint
  app.post('/api/telegram/send', async (req, res) => {
    try {
      const { botToken, chatId, text, parseMode = 'HTML' } = req.body;
      const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
      const chat = (chatId || process.env.TELEGRAM_CHAT_ID || '').trim();

      if (token) lastKnownBotToken = token;

      if (!token || !chat) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing botToken or chatId. Configure your Telegram Bot credentials in Admin Panel.' 
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

      return res.json({ success: true, messageId: result.result?.message_id });
    } catch (err: any) {
      console.error('Telegram send message error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal server error dispatching Telegram alert' });
    }
  });

  // Telegram Bot Connection Test Endpoint
  app.post('/api/telegram/test', async (req, res) => {
    try {
      const { botToken, chatId } = req.body;
      const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
      const chat = (chatId || process.env.TELEGRAM_CHAT_ID || '').trim();

      if (token) lastKnownBotToken = token;

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

      return res.json({ success: true, message: 'Test message sent successfully to Telegram!' });
    } catch (err: any) {
      console.error('Telegram test error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to connect to Telegram API' });
    }
  });

  // Telegram Get Updates & Map Usernames Route (with auto-409 webhook unlock)
  app.post('/api/telegram/updates', async (req, res) => {
    try {
      const { botToken } = req.body;
      const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
      if (!token) {
        return res.status(400).json({ success: false, error: 'Bot Token is required.' });
      }

      if (token) lastKnownBotToken = token;

      let response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=["message"]`);
      let result = await response.json() as any;
      let webhookReleased = false;

      // Handle 409 Conflict: when a webhook is active, getUpdates fails with 409
      // We automatically delete the webhook with drop_pending_updates: false to preserve user messages
      if (!response.ok && (response.status === 409 || result?.error_code === 409)) {
        console.log('[Telegram Updates] 409 Conflict detected (webhook active). Auto-releasing webhook to retrieve pending messages...');
        try {
          const delRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ drop_pending_updates: false })
          });
          const delResult = await delRes.json() as any;
          console.log('[Telegram Updates] Released webhook:', delResult);
          webhookReleased = true;

          // Wait brief moment for Telegram to unlock
          await new Promise(r => setTimeout(r, 350));
          response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=["message"]`);
          result = await response.json() as any;
        } catch (delErr) {
          console.error('[Telegram Updates] Failed to auto-release webhook:', delErr);
        }
      }

      if (!response.ok || !result.ok) {
        // Even if Telegram API fails, return captured webhook senders if available
        if (capturedTelegramSenders.length > 0) {
          const mappedUsers: { [username: string]: { chatId: string; firstName: string; date: number; text?: string } } = {};
          for (const s of capturedTelegramSenders) {
            if (s.username) {
              mappedUsers[s.username.toLowerCase()] = { chatId: s.chatId, firstName: s.firstName, date: s.date, text: s.text };
              mappedUsers[s.username.replace(/^@/, '').toLowerCase()] = { chatId: s.chatId, firstName: s.firstName, date: s.date, text: s.text };
            }
          }
          return res.json({ 
            success: true, 
            count: Object.keys(mappedUsers).length, 
            users: mappedUsers, 
            senders: capturedTelegramSenders,
            fromCacheOnly: true,
            warning: result?.description || 'Telegram getUpdates unavailable' 
          });
        }

        return res.status(response.status || 400).json({
          success: false,
          error: result?.description || 'Failed to fetch updates from Telegram'
        });
      }

      // Parse and map all users who messaged the bot
      const mappedUsers: { [username: string]: { chatId: string; firstName: string; date: number; text?: string } } = {};
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

          recordCapturedSender({
            chatId: chatIdStr,
            username: rawUser ? `@${rawUser.toLowerCase()}` : '',
            firstName: fName,
            lastName: lName,
            text: msgText,
            date: msg.date || Math.floor(Date.now() / 1000),
            timestamp: new Date().toISOString(),
            isConfirmedCommand: isCmd
          });

          if (rawUser) {
            const normalized = `@${rawUser.toLowerCase().trim()}`;
            const bare = rawUser.toLowerCase().trim();
            mappedUsers[normalized] = {
              chatId: chatIdStr,
              firstName: fName,
              date: msg.date,
              text: msgText
            };
            mappedUsers[bare] = {
              chatId: chatIdStr,
              firstName: fName,
              date: msg.date,
              text: msgText
            };
          }

          if (fName) {
            mappedUsers[fName.toLowerCase().trim()] = {
              chatId: chatIdStr,
              firstName: fName,
              date: msg.date,
              text: msgText
            };
          }
        }
      }

      // Also merge any captured senders from webhook buffer
      for (const s of capturedTelegramSenders) {
        if (s.username) {
          const withAt = s.username.toLowerCase().trim();
          const bare = withAt.replace(/^@/, '');
          if (!mappedUsers[withAt]) {
            mappedUsers[withAt] = { chatId: s.chatId, firstName: s.firstName, date: s.date, text: s.text };
          }
          if (!mappedUsers[bare]) {
            mappedUsers[bare] = { chatId: s.chatId, firstName: s.firstName, date: s.date, text: s.text };
          }
        }
        if (s.firstName && !mappedUsers[s.firstName.toLowerCase().trim()]) {
          mappedUsers[s.firstName.toLowerCase().trim()] = { chatId: s.chatId, firstName: s.firstName, date: s.date, text: s.text };
        }
      }

      return res.json({ 
        success: true, 
        count: Object.keys(mappedUsers).length, 
        users: mappedUsers, 
        senders: capturedTelegramSenders,
        rawUpdatesCount: updates.length,
        webhookReleased 
      });
    } catch (err: any) {
      console.error('Get updates error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Error fetching updates' });
    }
  });

  // Captured Senders Feed Endpoint
  app.get('/api/telegram/senders', (req, res) => {
    res.json({
      success: true,
      count: capturedTelegramSenders.length,
      senders: capturedTelegramSenders
    });
  });

  // Clear Captured Senders Endpoint
  app.post('/api/telegram/senders/clear', (req, res) => {
    capturedTelegramSenders = [];
    try {
      if (fs.existsSync(sendersCachePath)) {
        fs.writeFileSync(sendersCachePath, JSON.stringify([], null, 2));
      }
    } catch (e) {
      // ignore
    }
    res.json({ success: true, message: 'Captured senders reset successfully' });
  });

  // Client record sender endpoint
  app.post('/api/telegram/senders/record', (req, res) => {
    const sender = req.body;
    if (sender && sender.chatId) {
      recordCapturedSender(sender);
    }
    res.json({ success: true, count: capturedTelegramSenders.length });
  });

  // Telegram Incoming Webhook Handler (Receives updates when users message the bot)
  app.post('/api/telegram/webhook', async (req, res) => {
    try {
      const update = req.body;
      const message = update?.message || update?.edited_message;

      if (!message || !message.chat) {
        return res.json({ ok: true, note: 'No message payload' });
      }

      const chatId = String(message.chat.id);
      const fromUser = message.from || {};
      const rawUser = fromUser.username || message.chat.username || '';
      const tgUsername = rawUser ? `@${rawUser}` : '';
      const firstName = fromUser.first_name || message.chat.first_name || 'Lover';
      const lastName = fromUser.last_name || message.chat.last_name || '';
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

      console.log(`[Telegram Webhook] Received message from ${tgUsername || firstName} (${chatId}): "${text}" (isConfirmedCommand=${isConfirmedCommand})`);

      // Record sender into persistent buffer immediately
      recordCapturedSender({
        chatId,
        username: tgUsername ? tgUsername.toLowerCase() : '',
        firstName,
        lastName,
        text,
        date: message.date || Math.floor(Date.now() / 1000),
        timestamp: new Date().toISOString(),
        isConfirmedCommand
      });

      // Respond automatically if bot token is available
      const token = (req.query.token as string) || lastKnownBotToken || process.env.TELEGRAM_BOT_TOKEN;
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

      return res.json({ ok: true, received: true, chatId, username: tgUsername, text, count: capturedTelegramSenders.length });
    } catch (err: any) {
      console.error('Telegram webhook handler error:', err);
      return res.status(200).json({ ok: true, error: err.message });
    }
  });

  // Telegram Webhook Configuration Route
  app.post('/api/telegram/webhook/set', async (req, res) => {
    try {
      const { botToken, webhookUrl } = req.body;
      const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
      const url = (webhookUrl || '').trim();

      if (token) lastKnownBotToken = token;

      if (!token || !url) {
        return res.status(400).json({ success: false, error: 'Bot Token and Webhook URL are required.' });
      }

      const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          drop_pending_updates: false
        })
      });

      const result = await response.json() as any;
      if (!response.ok || !result.ok) {
        return res.status(response.status || 400).json({
          success: false,
          error: result.description || 'Failed to set webhook on Telegram API'
        });
      }

      return res.json({ success: true, message: result.description || 'Webhook activated successfully!' });
    } catch (err: any) {
      console.error('Set webhook error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Server error setting webhook' });
    }
  });

  // Telegram Webhook Info Route
  app.post('/api/telegram/webhook/info', async (req, res) => {
    try {
      const { botToken } = req.body;
      const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();

      if (token) lastKnownBotToken = token;

      if (!token) {
        return res.status(400).json({ success: false, error: 'Bot Token is required.' });
      }

      const response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const result = await response.json() as any;

      if (!response.ok || !result.ok) {
        return res.status(response.status || 400).json({
          success: false,
          error: result.description || 'Failed to fetch webhook info'
        });
      }

      return res.json({ success: true, info: result.result });
    } catch (err: any) {
      console.error('Get webhook info error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Server error fetching webhook info' });
    }
  });

  // Telegram Webhook Delete Route
  app.post('/api/telegram/webhook/delete', async (req, res) => {
    try {
      const { botToken } = req.body;
      const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();

      if (token) lastKnownBotToken = token;

      if (!token) {
        return res.status(400).json({ success: false, error: 'Bot Token is required.' });
      }

      const response = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drop_pending_updates: false })
      });

      const result = await response.json() as any;
      if (!response.ok || !result.ok) {
        return res.status(response.status || 400).json({
          success: false,
          error: result.description || 'Failed to delete webhook'
        });
      }

      return res.json({ success: true, message: result.description || 'Webhook deleted successfully!' });
    } catch (err: any) {
      console.error('Delete webhook error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Server error deleting webhook' });
    }
  });


  // Dedicated Audio / MP3 Upload Endpoint
  app.post('/api/upload-audio', async (req, res) => {
    try {
      const { fileName, dataUrl, title, artist } = req.body;
      if (!fileName || !dataUrl) {
        return res.status(400).json({ success: false, error: 'File name and audio data are required.' });
      }

      const uploadsDir = path.join(projectRoot, 'public', 'audio', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const ext = path.extname(fileName) || '.mp3';
      const cleanBase = path.basename(fileName, ext).replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_');
      const safeName = `${Date.now()}_${cleanBase}${ext}`;
      const filePath = path.join(uploadsDir, safeName);

      const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches[2]) {
        const buffer = Buffer.from(matches[2], 'base64');
        fs.writeFileSync(filePath, buffer);
      } else {
        const buffer = Buffer.from(dataUrl, 'base64');
        fs.writeFileSync(filePath, buffer);
      }

      const publicUrl = `/audio/uploads/${safeName}`;
      return res.json({ 
        success: true, 
        url: publicUrl, 
        fileName: safeName,
        title: title || cleanBase
      });
    } catch (err: any) {
      console.error('Audio upload error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to save audio file.' });
    }
  });

  // Explicit static route for audio assets
  app.use('/audio', express.static(path.join(projectRoot, 'public', 'audio')));

  if (!isProduction) {
    // Use Vite dev server as middleware in non-production mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve production static assets from dist/ folder
    const distPath = path.join(projectRoot, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} (Production: ${isProduction})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

