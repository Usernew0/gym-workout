import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import {
  TELEGRAM_BOT_COMMANDS,
  escapeHtml,
  exportServerWaterIntakeOverrides,
  fetchFirestoreTelegramConfig,
  fetchFirestoreUserAccounts,
  formatWaterIntakeTelegramMessageHtml,
  getUserTodayWaterGlasses,
  hydrateServerWaterIntakeOverrides,
  isBotConfirmationCommand,
  registerTelegramCommandsMenu,
  replyToTelegramMessage,
  resolveEffectiveUserWaterIntake,
  resolveTelegramAccess,
  sendTelegramDocument,
  upsertServerWaterIntakeOverride,
} from './server/telegramBotEngine';
import { handleSupabaseProxyAction } from './server/supabaseProxy';

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

  // Private server-side Supabase proxy routes (reads SUPABASE_URL & SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY without VITE_ exposure)
  app.get('/api/supabase', async (req, res) => {
    try {
      const result = await handleSupabaseProxyAction({ action: 'status' });
      return res.status(result.status).json(result.json);
    } catch (err: any) {
      return res.status(500).json({ online: false, configured: false, error: err?.message || String(err) });
    }
  });

  app.post('/api/supabase', async (req, res) => {
    try {
      const result = await handleSupabaseProxyAction(req.body || {});
      return res.status(result.status).json(result.json);
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || String(err) });
    }
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

  // Telegram Senders Cache, Bot State & Command Poller
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
  let lastProcessedUpdateId = 0;
  let capturedTelegramSenders: TelegramCapturedSender[] = [];
  const processedUpdateIds = new Set<number>();
  let pollingPausedDueToWebhook = false;
  let isPollingInFlight = false;
  let commandsRegisteredForToken = '';
  let lastWaterReminderSentAt: Record<string, number> = {};

  const botStatePath = path.join(projectRoot, 'tmp', 'telegram_bot_state.json');
  try {
    if (fs.existsSync(botStatePath)) {
      const savedState = JSON.parse(fs.readFileSync(botStatePath, 'utf-8'));
      if (!lastKnownBotToken && savedState?.botToken) {
        lastKnownBotToken = String(savedState.botToken).trim();
      }
      if (typeof savedState?.lastProcessedUpdateId === 'number') {
        lastProcessedUpdateId = savedState.lastProcessedUpdateId;
      }
      if (savedState?.lastWaterReminderSentAt && typeof savedState.lastWaterReminderSentAt === 'object') {
        lastWaterReminderSentAt = savedState.lastWaterReminderSentAt;
      }
      if (savedState?.waterIntakeOverrides && typeof savedState.waterIntakeOverrides === 'object') {
        hydrateServerWaterIntakeOverrides(savedState.waterIntakeOverrides);
      }
    }
  } catch {
    // ignore state load failure
  }

  function saveBotState() {
    try {
      const tmpDir = path.join(projectRoot, 'tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(
        botStatePath,
        JSON.stringify({
          botToken: lastKnownBotToken,
          lastProcessedUpdateId,
          lastWaterReminderSentAt,
          waterIntakeOverrides: exportServerWaterIntakeOverrides(),
          updatedAt: new Date().toISOString(),
        }, null, 2)
      );
    } catch {
      // ignore disk write error
    }
  }

  function rememberBotToken(token?: string) {
    const clean = (token || '').trim();
    if (clean && clean !== lastKnownBotToken) {
      lastKnownBotToken = clean;
      saveBotState();
    }
  }

  async function resolveEffectiveBotToken(explicitToken?: string): Promise<string> {
    const direct = (explicitToken || '').trim();
    if (direct) {
      rememberBotToken(direct);
      return direct;
    }
    if (lastKnownBotToken.trim()) return lastKnownBotToken.trim();
    if (process.env.TELEGRAM_BOT_TOKEN?.trim()) {
      rememberBotToken(process.env.TELEGRAM_BOT_TOKEN);
      return process.env.TELEGRAM_BOT_TOKEN.trim();
    }
    const fsConfig = await fetchFirestoreTelegramConfig().catch(() => null);
    if (fsConfig?.botToken?.trim()) {
      rememberBotToken(fsConfig.botToken);
      return fsConfig.botToken.trim();
    }
    return '';
  }

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

  function trackProcessedUpdate(updateId: number) {
    processedUpdateIds.add(updateId);
    if (processedUpdateIds.size > 1000) {
      const first = processedUpdateIds.values().next().value;
      if (first !== undefined) processedUpdateIds.delete(first);
    }
    if (updateId > lastProcessedUpdateId) {
      lastProcessedUpdateId = updateId;
      saveBotState();
    }
  }

  async function processIncomingTelegramUpdate(u: any, token: string, shouldReply: boolean): Promise<boolean> {
    const msg = u?.message || u?.edited_message;
    if (!msg || !msg.from || !msg.chat) return false;

    const rawUser = msg.from.username || msg.chat.username || '';
    const chatIdStr = String(msg.chat.id);
    const fName = msg.from.first_name || msg.chat.first_name || '';
    const lName = msg.from.last_name || msg.chat.last_name || '';
    const msgText = (msg.text || '').trim();
    const isCmd = isBotConfirmationCommand(msgText);

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

    const updateId = typeof u.update_id === 'number' ? u.update_id : undefined;
    const alreadyHandled = updateId !== undefined && (processedUpdateIds.has(updateId) || updateId <= lastProcessedUpdateId);

    if (shouldReply && !alreadyHandled && msgText) {
      await replyToTelegramMessage(token, msg).catch(err =>
        console.warn('[Telegram Command] Failed to send reply:', err)
      );
    }

    if (updateId !== undefined) {
      trackProcessedUpdate(updateId);
    }
    return !alreadyHandled && Boolean(msgText);
  }

  async function pollTelegramCommandsOnce(explicitToken?: string): Promise<{
    polled: boolean;
    repliesSent: number;
    webhookActive?: boolean;
    error?: string;
  }> {
    if (isPollingInFlight) {
      return { polled: false, repliesSent: 0 };
    }
    isPollingInFlight = true;
    try {
      const token = await resolveEffectiveBotToken(explicitToken);
      if (!token) return { polled: false, repliesSent: 0 };

      if (commandsRegisteredForToken !== token) {
        const regRes = await registerTelegramCommandsMenu(token);
        if (regRes.ok) commandsRegisteredForToken = token;
      }

      const offsetParam = lastProcessedUpdateId > 0 ? `&offset=${lastProcessedUpdateId + 1}` : '';
      const response = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?allowed_updates=["message"]&timeout=0${offsetParam}`
      );
      const result = await response.json() as any;

      if (!response.ok && (response.status === 409 || result?.error_code === 409)) {
        // Webhook is active on Telegram; never delete it from background poller
        pollingPausedDueToWebhook = true;
        return { polled: false, repliesSent: 0, webhookActive: true };
      }

      if (!response.ok || !result?.ok) {
        return { polled: false, repliesSent: 0, error: result?.description || `HTTP ${response.status}` };
      }

      pollingPausedDueToWebhook = false;
      const updates = Array.isArray(result.result) ? result.result : [];
      let repliesSent = 0;

      for (const u of updates) {
        const replied = await processIncomingTelegramUpdate(u, token, true);
        if (replied) repliesSent++;
      }

      return { polled: true, repliesSent };
    } catch (err: any) {
      return { polled: false, repliesSent: 0, error: err?.message };
    } finally {
      isPollingInFlight = false;
    }
  }

  // Background Direct-Polling Command Listener (handles commands automatically when no webhook is active)
  setInterval(() => {
    if (!pollingPausedDueToWebhook) {
      void pollTelegramCommandsOnce();
    }
  }, 4500);

  // Run one initial command check shortly after startup
  setTimeout(() => {
    void pollTelegramCommandsOnce();
  }, 2500);

  // Resolve a single whitelisted user's target Telegram Chat ID for server-initiated notifications
  function resolveMemberChatId(
    user: { username: string; telegramChatId?: string; telegramUsername?: string; telegramNotificationsEnabled?: boolean },
    accounts: any[],
    tgConfig: any
  ): string | null {
    if (!tgConfig?.enabled || user.telegramNotificationsEnabled === false) return null;
    const unameLower = (user.username || '').trim().toLowerCase();
    const uHandleBare = (user.telegramUsername || '').trim().replace(/^@/, '').toLowerCase();
    const directChat = (user.telegramChatId || '').trim();

    const authEntry = (tgConfig.authorizedUsers || []).find((a: any) => {
      if (a.isActive === false) return false;
      const appMatch = (a.appUsername || '').trim().toLowerCase() === unameLower;
      const chatMatch = directChat && (a.chatId || '').trim() === directChat;
      const handleMatch = uHandleBare && (a.telegramUsername || '').trim().replace(/^@/, '').toLowerCase() === uHandleBare;
      return appMatch || chatMatch || handleMatch;
    });

    const candidateChat = (directChat || authEntry?.chatId || '').trim();
    if (!candidateChat) return null;

    const access = resolveTelegramAccess(accounts, tgConfig, candidateChat, user.telegramUsername || '');
    if (!access.authorized) return null;
    if (access.linkedAccount && access.linkedAccount.username.trim().toLowerCase() !== unameLower) {
      return null;
    }
    return candidateChat;
  }

  // Background Scheduled Water Intake Reminder Loop (continues running even when website is closed)
  let isWaterPassRunning = false;
  async function runScheduledWaterRemindersPass() {
    if (isWaterPassRunning) return;
    isWaterPassRunning = true;
    try {
      const [tgConfig, accounts] = await Promise.all([
        fetchFirestoreTelegramConfig().catch(() => null),
        fetchFirestoreUserAccounts().catch(() => []),
      ]);
      if (!tgConfig?.enabled || tgConfig?.notifyWater === false) return;
      const token = await resolveEffectiveBotToken(tgConfig.botToken);
      if (!token) return;

      const now = Date.now();
      let stateDirty = false;

      for (const user of accounts) {
        const effectiveWater = resolveEffectiveUserWaterIntake(user);
        if (effectiveWater?.reminderEnabled !== true) continue;
        const targetChatId = resolveMemberChatId(user, accounts, tgConfig);
        if (!targetChatId) continue;

        const intervalMin = Math.max(
          1,
          Math.min(1440, Math.round(Number(effectiveWater?.reminderIntervalMinutes || (tgConfig as any)?.waterReminderMinutes || 60)))
        );
        const userKey = user.username.trim().toLowerCase();
        const updatedMs = effectiveWater?.updatedAt ? Date.parse(effectiveWater.updatedAt) : 0;
        const lastSentMs = lastWaterReminderSentAt[userKey] || 0;
        const anchorMs = Math.max(lastSentMs, Number.isFinite(updatedMs) ? updatedMs : 0);

        if (now - anchorMs < intervalMin * 60_000) continue;

        const mergedUser = { ...user, waterIntake: effectiveWater };
        const glasses = getUserTodayWaterGlasses(mergedUser) ?? 0;
        const goal = 8;
        const memberName = user.displayName?.trim() || user.username;
        const note =
          glasses >= goal
            ? 'Great work staying hydrated!'
            : 'Time for another glass of water to fuel your recovery!';
        const msgHtml = formatWaterIntakeTelegramMessageHtml(
          memberName,
          glasses,
          goal,
          note,
          effectiveWater?.timezoneOffsetMinutes
        );

        try {
          const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetChatId,
              text: msgHtml,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          });
          const data: any = await resp.json().catch(() => null);
          if (resp.ok && data?.ok) {
            lastWaterReminderSentAt[userKey] = now;
            stateDirty = true;
          }
        } catch {
          // ignore transient network failures
        }
      }

      if (stateDirty) {
        saveBotState();
      }
    } finally {
      isWaterPassRunning = false;
    }
  }

  setInterval(() => {
    void runScheduledWaterRemindersPass();
  }, 60_000);
  setTimeout(() => {
    void runScheduledWaterRemindersPass();
  }, 15_000);

  // Live Water Intake Sync & Alert Coordination Endpoints
  app.post('/api/water-intake/sync', (req, res) => {
    try {
      const {
        username,
        date,
        glasses,
        updatedAt,
        timezoneOffsetMinutes,
        reminderEnabled,
        reminderIntervalMinutes,
      } = req.body || {};
      const uname = String(username || '').trim();
      if (!uname || !date) {
        return res.status(400).json({ success: false, error: 'Missing username or date' });
      }
      const cleanGlasses = Math.max(0, Math.min(40, Math.floor(Number(glasses) || 0)));
      upsertServerWaterIntakeOverride(uname, {
        date: String(date),
        glasses: cleanGlasses,
        updatedAt: typeof updatedAt === 'string' && updatedAt ? updatedAt : new Date().toISOString(),
        ...(typeof timezoneOffsetMinutes === 'number' && Number.isFinite(timezoneOffsetMinutes)
          ? { timezoneOffsetMinutes }
          : {}),
        ...(typeof reminderEnabled === 'boolean' ? { reminderEnabled } : {}),
        ...(typeof reminderIntervalMinutes === 'number' && Number.isFinite(reminderIntervalMinutes)
          ? { reminderIntervalMinutes: Math.min(1440, Math.max(1, Math.round(reminderIntervalMinutes))) }
          : {}),
      });
      saveBotState();
      return res.json({ success: true, glasses: cleanGlasses });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to sync water intake' });
    }
  });

  app.post('/api/water-intake/mark-sent', (req, res) => {
    try {
      const { username, sentAtMs } = req.body || {};
      const userKey = String(username || '').trim().toLowerCase();
      if (!userKey) {
        return res.status(400).json({ success: false, error: 'Missing username' });
      }
      const ts = Number(sentAtMs);
      lastWaterReminderSentAt[userKey] = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
      saveBotState();
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to record water alert timestamp' });
    }
  });

  // Server-Side Rest Timer Schedule / Cancel (ensures Telegram push fires even if website is closed)
  const scheduledRestTimers = new Map<string, ReturnType<typeof setTimeout>>();

  app.post('/api/rest-timer/schedule', (req, res) => {
    try {
      const { timerKey, username, exerciseName, setNumber, endAtMs, totalSec } = req.body || {};
      const key = String(timerKey || '').trim();
      const targetUsername = String(username || '').trim();
      const endMs = Number(endAtMs);
      if (!key || !targetUsername || !Number.isFinite(endMs)) {
        return res.status(400).json({ success: false, error: 'Missing timerKey, username, or endAtMs.' });
      }

      const prev = scheduledRestTimers.get(key);
      if (prev) clearTimeout(prev);

      // Add a tiny 1.5s buffer so an open browser tab finishes first and cancels to prevent duplicate alerts
      const delayMs = Math.max(500, endMs - Date.now() + 1500);
      const timeoutHandle = setTimeout(async () => {
        scheduledRestTimers.delete(key);
        try {
          const [tgConfig, accounts] = await Promise.all([
            fetchFirestoreTelegramConfig().catch(() => null),
            fetchFirestoreUserAccounts().catch(() => []),
          ]);
          const user = accounts.find(
            (u) => u.username.trim().toLowerCase() === targetUsername.toLowerCase()
          );
          if (!user || !tgConfig?.enabled) return;
          const chatId = resolveMemberChatId(user, accounts, tgConfig);
          const token = await resolveEffectiveBotToken(tgConfig.botToken);
          if (!chatId || !token) return;

          const exLabel = escapeHtml(String(exerciseName || 'Exercise'));
          const setLabel = Number(setNumber) > 0 ? `Set #${Number(setNumber)}` : 'Rest';
          const secLabel = Number(totalSec) > 0 ? ` (${Number(totalSec)}s)` : '';
          const msg =
            `⏱️ <b>Rest Timer Complete!</b> 🔔\n\n` +
            `• <b>Exercise:</b> ${exLabel}\n` +
            `• <b>Completed:</b> ${setLabel}${secLabel}\n\n` +
            `Time for your next set — let's crush it! 💪`;

          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: msg,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          });
        } catch {
          // ignore dispatch error
        }
      }, delayMs);

      scheduledRestTimers.set(key, timeoutHandle);
      return res.json({ success: true, timerKey: key, scheduledInMs: delayMs });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to schedule timer' });
    }
  });

  app.post('/api/rest-timer/cancel', (req, res) => {
    try {
      const { timerKey } = req.body || {};
      const key = String(timerKey || '').trim();
      if (key && scheduledRestTimers.has(key)) {
        clearTimeout(scheduledRestTimers.get(key)!);
        scheduledRestTimers.delete(key);
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to cancel timer' });
    }
  });

  // Telegram Bot Dispatch Endpoint
  app.post('/api/telegram/send', async (req, res) => {
    try {
      const { botToken, chatId, text, parseMode = 'HTML' } = req.body;
      const token = await resolveEffectiveBotToken(botToken);
      const chat = (chatId || process.env.TELEGRAM_CHAT_ID || '').trim();

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

  // Telegram Bot Document Dispatch Endpoint (.pdf / .xlsx)
  app.post('/api/telegram/send-document', async (req, res) => {
    try {
      const { botToken, chatId, fileBase64, filename, mimeType = 'application/octet-stream', caption } = req.body || {};
      const token = await resolveEffectiveBotToken(botToken);
      const chat = (chatId || process.env.TELEGRAM_CHAT_ID || '').trim();

      if (!token || !chat) {
        return res.status(400).json({
          success: false,
          error: 'Missing botToken or chatId. Configure your Telegram Bot credentials in Admin Panel.'
        });
      }

      if (!fileBase64 || !filename) {
        return res.status(400).json({ success: false, error: 'File payload and filename are required.' });
      }

      const buffer = Buffer.from(String(fileBase64), 'base64');
      const sent = await sendTelegramDocument(token, chat, buffer, String(filename), String(mimeType), caption);
      if (!sent.ok) {
        return res.status(400).json({
          success: false,
          error: sent.error || 'Telegram API rejected document upload'
        });
      }

      return res.json({ success: true, messageId: sent.messageId });
    } catch (err: any) {
      console.error('Telegram send-document error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal server error dispatching document' });
    }
  });

  // Telegram Bot Connection Test Endpoint
  app.post('/api/telegram/test', async (req, res) => {
    try {
      const { botToken, chatId } = req.body;
      const token = await resolveEffectiveBotToken(botToken);
      const chat = (chatId || process.env.TELEGRAM_CHAT_ID || '').trim();

      if (!token || !chat) {
        return res.status(400).json({ 
          success: false, 
          error: 'Please enter both the Bot Token and Chat ID to run the test.' 
        });
      }

      // Ensure '/' command menu is registered during connection test
      void registerTelegramCommandsMenu(token);

      const testMessage = `🏋️ <b>Gym Workout Telegram Alert Test</b>\n\n` +
        `Your Telegram bot is successfully connected to <b>Gym Workout</b>! 💪\n` +
        `You can receive workout plan alerts, water intake reminders, security notices, and download your sheets anytime using bot commands (/workouts, /pdf, /excel, /water, /progress, /status, /id, /help).\n\n` +
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

  // Register Telegram Bot '/' Command Menu & Check Active Mode
  app.post('/api/telegram/commands/sync', async (req, res) => {
    try {
      const { botToken } = req.body || {};
      const token = await resolveEffectiveBotToken(botToken);
      if (!token) {
        return res.status(400).json({ success: false, error: 'Bot Token is required.' });
      }

      const reg = await registerTelegramCommandsMenu(token);
      if (!reg.ok) {
        return res.status(400).json({ success: false, error: reg.error || 'Failed to register Telegram bot commands.' });
      }
      commandsRegisteredForToken = token;

      // Check whether webhook is active or polling handles commands
      let webhookUrl = '';
      try {
        const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
        const infoJson: any = await infoRes.json();
        webhookUrl = infoJson?.result?.url || '';
      } catch {
        // ignore
      }

      pollingPausedDueToWebhook = Boolean(webhookUrl);
      let repliesSent = 0;
      if (!webhookUrl) {
        const pollRes = await pollTelegramCommandsOnce(token);
        repliesSent = pollRes.repliesSent;
      }

      return res.json({
        success: true,
        mode: webhookUrl ? 'webhook' : 'polling',
        webhookUrl: webhookUrl || undefined,
        commands: TELEGRAM_BOT_COMMANDS,
        repliesSent,
        message: webhookUrl
          ? `Registered ${TELEGRAM_BOT_COMMANDS.length} bot commands! Webhook mode is active.`
          : `Registered ${TELEGRAM_BOT_COMMANDS.length} bot commands! Direct Polling listener is active.`
      });
    } catch (err: any) {
      console.error('Sync bot commands error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to sync bot commands' });
    }
  });

  // Trigger Immediate Command Poll Pass
  app.post('/api/telegram/poll', async (req, res) => {
    try {
      const { botToken } = req.body || {};
      const token = await resolveEffectiveBotToken(botToken);
      if (!token) {
        return res.status(400).json({ success: false, error: 'Bot Token is required.' });
      }
      const result = await pollTelegramCommandsOnce(token);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Polling failed' });
    }
  });

  // Telegram Get Updates & Map Usernames Route (with auto-409 webhook unlock & command replies)
  app.post('/api/telegram/updates', async (req, res) => {
    try {
      const { botToken } = req.body;
      const token = await resolveEffectiveBotToken(botToken);
      if (!token) {
        return res.status(400).json({ success: false, error: 'Bot Token is required.' });
      }

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
          pollingPausedDueToWebhook = false;

          await new Promise(r => setTimeout(r, 350));
          response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=["message"]`);
          result = await response.json() as any;
        } catch (delErr) {
          console.error('[Telegram Updates] Failed to auto-release webhook:', delErr);
        }
      }

      if (!response.ok || !result.ok) {
        // Even if Telegram API fails, return captured senders if available
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

      // Parse, record, and answer any unseen commands in Telegram updates
      const mappedUsers: { [username: string]: { chatId: string; firstName: string; date: number; text?: string } } = {};
      const updates = Array.isArray(result.result) ? result.result : [];
      let repliesSent = 0;

      for (const u of updates) {
        const msg = u.message || u.edited_message;
        if (msg && msg.from && msg.chat) {
          const replied = await processIncomingTelegramUpdate(u, token, true);
          if (replied) repliesSent++;

          const rawUser = msg.from.username || msg.chat.username || '';
          const chatIdStr = String(msg.chat.id);
          const fName = msg.from.first_name || msg.chat.first_name || '';
          const msgText = (msg.text || '').trim();

          if (rawUser) {
            const normalized = `@${rawUser.toLowerCase().trim()}`;
            const bare = rawUser.toLowerCase().trim();
            mappedUsers[normalized] = { chatId: chatIdStr, firstName: fName, date: msg.date, text: msgText };
            mappedUsers[bare] = { chatId: chatIdStr, firstName: fName, date: msg.date, text: msgText };
          }

          if (fName) {
            mappedUsers[fName.toLowerCase().trim()] = { chatId: chatIdStr, firstName: fName, date: msg.date, text: msgText };
          }
        }
      }

      // Also merge any captured senders from webhook/poller buffer
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
        repliesSent,
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
      const firstName = fromUser.first_name || message.chat.first_name || 'Athlete';
      const lastName = fromUser.last_name || message.chat.last_name || '';
      const text = (message.text || '').trim();
      const isConfirmedCommand = isBotConfirmationCommand(text);

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

      if (typeof update?.update_id === 'number') {
        trackProcessedUpdate(update.update_id);
      }

      // Respond automatically via unified Gym Workout command engine
      const token = await resolveEffectiveBotToken(req.query.token as string);
      if (token) {
        await replyToTelegramMessage(token, message).catch(err =>
          console.warn('Failed to reply to webhook update:', err)
        );
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
      const token = await resolveEffectiveBotToken(botToken);
      const url = (webhookUrl || '').trim();

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

      pollingPausedDueToWebhook = true;
      void registerTelegramCommandsMenu(token).then((reg) => {
        if (reg.ok) commandsRegisteredForToken = token;
      });

      return res.json({ success: true, message: result.description || 'Webhook activated & bot commands registered!' });
    } catch (err: any) {
      console.error('Set webhook error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Server error setting webhook' });
    }
  });

  // Telegram Webhook Info Route
  app.post('/api/telegram/webhook/info', async (req, res) => {
    try {
      const { botToken } = req.body;
      const token = await resolveEffectiveBotToken(botToken);

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

      pollingPausedDueToWebhook = Boolean(result.result?.url);
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
      const token = await resolveEffectiveBotToken(botToken);

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

      pollingPausedDueToWebhook = false;
      return res.json({ success: true, message: result.description || 'Webhook deleted! Direct polling command handler resumed.' });
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

