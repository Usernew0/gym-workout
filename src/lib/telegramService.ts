import { 
  TelegramConfig, 
  DEFAULT_TELEGRAM_CONFIG, 
  AdminSetting, 
  UserAccount, 
  TelegramAuthorizedUser,
  TelegramCapturedSender,
  TelegramAlertOptions,
  TelegramDiagnosticReport
} from '../types';

/**
 * Resolves active Telegram configuration from AdminSettings, local cache, or defaults
 */
export function getTelegramConfig(adminSettings?: AdminSetting[]): TelegramConfig {
  if (Array.isArray(adminSettings)) {
    const doc = adminSettings.find(s => s.id === 'telegramConfig');
    if (doc?.telegramConfig) {
      return {
        ...DEFAULT_TELEGRAM_CONFIG,
        ...doc.telegramConfig,
        whitelistedUsernames: Array.isArray(doc.telegramConfig.whitelistedUsernames) 
          ? doc.telegramConfig.whitelistedUsernames 
          : [],
        authorizedUsers: Array.isArray(doc.telegramConfig.authorizedUsers)
          ? doc.telegramConfig.authorizedUsers
          : [],
        capturedSenders: Array.isArray(doc.telegramConfig.capturedSenders)
          ? doc.telegramConfig.capturedSenders
          : []
      };
    }
  }

  try {
    const saved = localStorage.getItem('love_telegram_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_TELEGRAM_CONFIG,
        ...parsed,
        whitelistedUsernames: Array.isArray(parsed.whitelistedUsernames) 
          ? parsed.whitelistedUsernames 
          : [],
        authorizedUsers: Array.isArray(parsed.authorizedUsers)
          ? parsed.authorizedUsers
          : [],
        capturedSenders: Array.isArray(parsed.capturedSenders)
          ? parsed.capturedSenders
          : []
      };
    }
  } catch (e) {
    console.warn("Failed to parse cached Telegram config:", e);
  }

  return DEFAULT_TELEGRAM_CONFIG;
}

/**
 * Persists Telegram configuration to LocalStorage and Firestore AdminSettings
 */
export async function saveTelegramConfig(
  config: TelegramConfig,
  saveAdminDocFn?: (setting: AdminSetting) => Promise<void>
): Promise<void> {
  const updated: TelegramConfig = {
    ...config,
    whitelistedUsernames: Array.from(new Set(
      (config.whitelistedUsernames || [])
        .map(u => (u.startsWith('@') ? u.trim() : `@${u.trim()}`).toLowerCase())
        .filter(u => u.length > 1)
    )),
    authorizedUsers: Array.isArray(config.authorizedUsers) ? config.authorizedUsers : [],
    capturedSenders: Array.isArray(config.capturedSenders) ? config.capturedSenders : [],
    lastTestedAt: config.lastTestedAt || new Date().toISOString()
  };

  try {
    localStorage.setItem('love_telegram_config', JSON.stringify(updated));
  } catch (e) {
    console.warn("Failed to cache Telegram config in localStorage:", e);
  }


  if (saveAdminDocFn) {
    try {
      await saveAdminDocFn({
        id: 'telegramConfig',
        telegramConfig: updated
      });
    } catch (err) {
      console.error("Failed to persist Telegram config to database:", err);
      throw err;
    }
  }

  // Register '/' commands on Telegram & prime server token state when botToken is present
  if (updated.botToken) {
    void syncTelegramBotCommands(updated.botToken).catch(() => {});
  }
}

/**
 * Helper to safely parse JSON response without throwing "Unexpected token" errors
 * when serverless environments (e.g. Vercel) return an HTML 404/500 error page.
 */
async function safeParseResponse(res: Response): Promise<{ isJson: boolean; data: any; rawText: string }> {
  const rawText = await res.text();
  try {
    const data = JSON.parse(rawText);
    return { isJson: true, data, rawText };
  } catch {
    return { isJson: false, data: null, rawText };
  }
}

/**
 * Sends a live test ping to Telegram with automatic dual fallback:
 * 1. Attempts proxy server route (/api/telegram/test)
 * 2. If proxy returns HTML / Vercel 404, automatically falls back to direct Telegram Bot API
 */
export async function testTelegramConnection(
  botToken: string, 
  chatId: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const cleanToken = botToken.trim();
  const cleanChat = chatId.trim();

  if (!cleanToken || !cleanChat) {
    return { success: false, error: 'Please enter both the Bot Token and Chat ID.' };
  }

  const testMessage = `🏋️ <b>Iron House Telegram Alert Test</b>\n\n` +
    `Your Telegram bot is successfully connected to <b>Iron House — Gym Training</b>! 💪\n` +
    `You can receive workout plan alerts, coach updates, security notices, and use interactive bot commands (/workouts, /progress, /status, /id, /help).\n\n` +
    `<i>Time: ${new Date().toLocaleString()}</i>`;

  // 1. Try server proxy endpoint first
  try {
    const response = await fetch('/api/telegram/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: cleanToken, chatId: cleanChat })
    });

    const parsed = await safeParseResponse(response);
    if (parsed.isJson && response.ok && parsed.data?.success) {
      return {
        success: true,
        message: parsed.data.message || 'Test message received successfully in Telegram!'
      };
    }
  } catch (proxyErr) {
    console.warn("Proxy connection error, falling back to direct Telegram API:", proxyErr);
  }

  // 2. Direct fallback to Telegram Bot API (handles Vercel and CORS automatically)
  try {
    const directRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChat,
        text: testMessage,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const directParsed = await safeParseResponse(directRes);
    if (directRes.ok && directParsed.isJson && directParsed.data?.ok) {
      return {
        success: true,
        message: 'Test message received successfully in Telegram (via Direct Bot API)!'
      };
    }

    const errorDesc = directParsed.isJson && directParsed.data?.description 
      ? directParsed.data.description 
      : `Telegram API error status ${directRes.status}`;
    return {
      success: false,
      error: errorDesc
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Network error while attempting to connect to Telegram'
    };
  }
}

/**
 * Fetches recent captured senders from server endpoint or local storage cache
 */
export async function fetchCapturedTelegramSenders(): Promise<TelegramCapturedSender[]> {
  try {
    const res = await fetch('/api/telegram/senders');
    const parsed = await safeParseResponse(res);
    if (parsed.isJson && res.ok && Array.isArray(parsed.data?.senders)) {
      try {
        localStorage.setItem('love_telegram_captured_senders', JSON.stringify(parsed.data.senders));
      } catch (e) {}
      return parsed.data.senders;
    }
  } catch (err) {
    console.warn("Could not fetch captured senders from server proxy:", err);
  }

  try {
    const cached = localStorage.getItem('love_telegram_captured_senders');
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {}

  return [];
}

/**
 * Clears captured senders history
 */
export async function clearCapturedTelegramSenders(): Promise<boolean> {
  try {
    localStorage.removeItem('love_telegram_captured_senders');
    await fetch('/api/telegram/senders/clear', { method: 'POST' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Detailed updates fetcher with:
 * 1. Automatic 409 Webhook Conflict recovery (releases webhook if active so getUpdates succeeds)
 * 2. Merging webhook-captured senders
 * 3. Extracting rich sender metadata (username, first name, message text, date)
 */
export async function fetchTelegramChatIdsDetailed(
  botToken: string
): Promise<{
  mapped: { [username: string]: { chatId: string; firstName?: string; text?: string; date?: number } };
  senders: TelegramCapturedSender[];
  webhookReleased?: boolean;
}> {
  const cleanToken = botToken.trim();
  if (!cleanToken) return { mapped: {}, senders: [] };

  const mapped: { [username: string]: { chatId: string; firstName?: string; text?: string; date?: number } } = {};
  const sendersMap = new Map<string, TelegramCapturedSender>();
  let webhookReleased = false;

  // 1. Try server endpoint first
  try {
    const res = await fetch('/api/telegram/updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: cleanToken })
    });
    const parsed = await safeParseResponse(res);
    if (parsed.isJson && res.ok && parsed.data?.users) {
      Object.assign(mapped, parsed.data.users);
      if (parsed.data.webhookReleased) webhookReleased = true;
      if (Array.isArray(parsed.data.senders)) {
        parsed.data.senders.forEach((s: TelegramCapturedSender) => sendersMap.set(s.chatId, s));
      }
    }
  } catch (e) {
    console.warn("Proxy updates fetch failed, trying direct Telegram getUpdates:", e);
  }

  // 2. Fetch server-captured senders
  try {
    const serverSenders = await fetchCapturedTelegramSenders();
    serverSenders.forEach(s => {
      if (!sendersMap.has(s.chatId)) sendersMap.set(s.chatId, s);
      if (s.username) {
        const withAt = s.username.toLowerCase().trim();
        const bare = withAt.replace(/^@/, '');
        if (!mapped[withAt]) mapped[withAt] = { chatId: s.chatId, firstName: s.firstName, text: s.text, date: s.date };
        if (!mapped[bare]) mapped[bare] = { chatId: s.chatId, firstName: s.firstName, text: s.text, date: s.date };
      }
      if (s.firstName && !mapped[s.firstName.toLowerCase().trim()]) {
        mapped[s.firstName.toLowerCase().trim()] = { chatId: s.chatId, firstName: s.firstName, text: s.text, date: s.date };
      }
    });
  } catch (e) {}

  // 3. Direct fallback to Telegram Bot API getUpdates (with client-side 409 conflict handling)
  try {
    let directRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getUpdates?allowed_updates=["message"]`);
    let directParsed = await safeParseResponse(directRes);

    // If 409 Conflict: Telegram blocks getUpdates while webhook is active. Auto-release it!
    if (!directRes.ok && (directRes.status === 409 || directParsed.data?.error_code === 409)) {
      console.log("[Telegram Direct] 409 Webhook Conflict detected. Releasing webhook with drop_pending_updates: false...");
      try {
        await deleteTelegramWebhook(cleanToken);
        webhookReleased = true;
        await new Promise(r => setTimeout(r, 400));
        directRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getUpdates?allowed_updates=["message"]`);
        directParsed = await safeParseResponse(directRes);
      } catch (delErr) {
        console.warn("Failed direct deleteWebhook on 409:", delErr);
      }
    }

    if (directRes.ok && directParsed.isJson && Array.isArray(directParsed.data?.result)) {
      for (const u of directParsed.data.result) {
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

          sendersMap.set(chatIdStr, {
            chatId: chatIdStr,
            username: rawUser ? `@${rawUser.toLowerCase().trim()}` : '',
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
            mapped[normalized] = { chatId: chatIdStr, firstName: fName, text: msgText, date: msg.date };
            mapped[bare] = { chatId: chatIdStr, firstName: fName, text: msgText, date: msg.date };
          }
          if (fName) {
            mapped[fName.toLowerCase().trim()] = { chatId: chatIdStr, firstName: fName, text: msgText, date: msg.date };
          }
        }
      }
    }
  } catch (e) {
    console.warn("Direct getUpdates fetch failed:", e);
  }

  const senders = Array.from(sendersMap.values()).sort((a, b) => (b.date || 0) - (a.date || 0));

  try {
    localStorage.setItem('love_telegram_captured_senders', JSON.stringify(senders));
  } catch (e) {}

  return { mapped, senders, webhookReleased };
}

/**
 * Queries Telegram updates to automatically detect and map @usernames to their numeric Chat IDs
 */
export async function fetchTelegramChatIdsFromUpdates(
  botToken: string
): Promise<{ [username: string]: { chatId: string; firstName?: string; text?: string; date?: number } }> {
  const result = await fetchTelegramChatIdsDetailed(botToken);
  return result.mapped;
}

/**
 * Automatically inspects Telegram updates and resolves the Chat ID for all whitelisted & profile users
 */
export async function autoResolveTelegramUsers(
  config: TelegramConfig,
  userAccounts: UserAccount[] = []
): Promise<{
  updatedConfig: TelegramConfig;
  newlyResolvedCount: number;
  resolvedUsers: { username: string; chatId: string; displayName?: string }[];
  allSenders: TelegramCapturedSender[];
  webhookConflictResolved?: boolean;
}> {
  if (!config.botToken.trim()) {
    return { 
      updatedConfig: config, 
      newlyResolvedCount: 0, 
      resolvedUsers: [], 
      allSenders: config.capturedSenders || [],
      webhookConflictResolved: false 
    };
  }

  const detailed = await fetchTelegramChatIdsDetailed(config.botToken);
  const updatesMap = detailed.mapped;
  const allSenders = detailed.senders;
  const resolvedUsers: { username: string; chatId: string; displayName?: string }[] = [];
  let newlyResolvedCount = 0;

  // Build combined list of target usernames to resolve
  const targetUsernames = new Set<string>();
  (config.whitelistedUsernames || []).forEach(u => targetUsernames.add(u.toLowerCase().trim()));
  (config.authorizedUsers || []).forEach(u => targetUsernames.add(u.telegramUsername.toLowerCase().trim()));
  extractTelegramUsernamesFromProfiles(userAccounts).forEach(u => targetUsernames.add(u.username.toLowerCase().trim()));

  const currentAuthorizedList = Array.isArray(config.authorizedUsers) ? [...config.authorizedUsers] : [];

  for (const rawTg of targetUsernames) {
    const cleanWithAt = rawTg.startsWith('@') ? rawTg : `@${rawTg}`;
    const cleanBare = rawTg.replace(/^@/, '');

    // 1. Try exact matches from updatesMap
    let detected = updatesMap[cleanWithAt] || updatesMap[cleanBare];

    // 2. If not found in updatesMap, scan allSenders
    if (!detected && allSenders.length > 0) {
      const matchedSender = allSenders.find(s => {
        const sWithAt = (s.username || '').toLowerCase().trim();
        const sBare = sWithAt.replace(/^@/, '');
        const sFirst = (s.firstName || '').toLowerCase().trim();
        return (
          sWithAt === cleanWithAt ||
          sBare === cleanBare ||
          (sBare && cleanBare && (sBare.includes(cleanBare) || cleanBare.includes(sBare))) ||
          (sFirst && (sFirst === cleanBare || sFirst === cleanWithAt)) ||
          (s.text && (s.text.toLowerCase().includes(cleanBare) || s.text.toLowerCase().includes(cleanWithAt)))
        );
      });

      if (matchedSender) {
        detected = {
          chatId: matchedSender.chatId,
          firstName: matchedSender.firstName,
          text: matchedSender.text,
          date: matchedSender.date
        };
      }
    }

    // 3. Fallback heuristic: If user has a single unverified authorized user or whitelist, and only 1 sender sent start/confirm
    if (!detected && targetUsernames.size <= 2 && allSenders.length >= 1) {
      const confirmedSender = allSenders.find(s => s.isConfirmedCommand) || allSenders[0];
      if (confirmedSender) {
        detected = {
          chatId: confirmedSender.chatId,
          firstName: confirmedSender.firstName,
          text: confirmedSender.text,
          date: confirmedSender.date
        };
      }
    }

    if (detected && detected.chatId) {
      const existingIdx = currentAuthorizedList.findIndex(
        u => u.telegramUsername.toLowerCase() === cleanWithAt ||
             u.telegramUsername.toLowerCase().replace(/^@/, '') === cleanBare
      );

      if (existingIdx >= 0) {
        if (!currentAuthorizedList[existingIdx].chatId || currentAuthorizedList[existingIdx].chatId !== detected.chatId) {
          currentAuthorizedList[existingIdx] = {
            ...currentAuthorizedList[existingIdx],
            chatId: detected.chatId,
            confirmed: true,
            confirmedAt: currentAuthorizedList[existingIdx].confirmedAt || new Date().toISOString(),
            isActive: true
          };
          newlyResolvedCount++;
          resolvedUsers.push({ 
            username: cleanWithAt, 
            chatId: detected.chatId, 
            displayName: detected.firstName || currentAuthorizedList[existingIdx].appUsername 
          });
        }
      } else {
        // Find profile account if any
        const matchedProfile = userAccounts.find(
          a => (a.telegramUsername || '').toLowerCase().trim() === cleanWithAt.toLowerCase() ||
               (a.telegramUsername || '').toLowerCase().trim() === cleanBare.toLowerCase()
        );

        currentAuthorizedList.push({
          id: `tg_usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          telegramUsername: cleanWithAt,
          chatId: detected.chatId,
          appUsername: matchedProfile?.username || detected.firstName || '',
          confirmed: true,
          confirmedAt: new Date().toISOString(),
          isActive: true,
          role: 'partner'
        });
        newlyResolvedCount++;
        resolvedUsers.push({ 
          username: cleanWithAt, 
          chatId: detected.chatId, 
          displayName: detected.firstName || matchedProfile?.username 
        });
      }
    }
  }

  // Also ensure every confirmed sender with an @username is at least added if they executed confirm/start
  for (const sender of allSenders) {
    if (sender.isConfirmedCommand && sender.username && sender.chatId) {
      const cleanUser = sender.username.startsWith('@') ? sender.username : `@${sender.username}`;
      const existing = currentAuthorizedList.find(u => u.telegramUsername.toLowerCase() === cleanUser.toLowerCase());
      if (!existing) {
        currentAuthorizedList.push({
          id: `tg_usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          telegramUsername: cleanUser,
          chatId: sender.chatId,
          appUsername: sender.firstName || '',
          confirmed: true,
          confirmedAt: new Date().toISOString(),
          isActive: true,
          role: 'partner'
        });
        newlyResolvedCount++;
        resolvedUsers.push({
          username: cleanUser,
          chatId: sender.chatId,
          displayName: sender.firstName
        });
      }
    }
  }

  const updatedConfig: TelegramConfig = {
    ...config,
    authorizedUsers: currentAuthorizedList,
    capturedSenders: allSenders
  };

  return { 
    updatedConfig, 
    newlyResolvedCount, 
    resolvedUsers, 
    allSenders,
    webhookConflictResolved: detailed.webhookReleased 
  };
}


/**
 * Dispatches test alerts to ALL configured recipients (multi-user broadcast)
 */
export async function testTelegramMultiBroadcast(
  config: TelegramConfig,
  customTestMessage?: string
): Promise<{
  success: boolean;
  message: string;
  recipientsCount: number;
  details: { target: string; username?: string; success: boolean; error?: string }[];
}> {
  const cleanToken = config.botToken.trim();
  if (!cleanToken) {
    return { success: false, message: 'Please enter a Bot Token.', recipientsCount: 0, details: [] };
  }

  // Collect all destinations
  const destinations: { chatId: string; label: string }[] = [];
  if (config.chatId && config.chatId.trim()) {
    destinations.push({ chatId: config.chatId.trim(), label: 'Primary Group / Default' });
  }

  if (Array.isArray(config.authorizedUsers)) {
    for (const u of config.authorizedUsers) {
      if (u.isActive !== false && u.chatId && u.chatId.trim()) {
        if (!destinations.some(d => d.chatId === u.chatId.trim())) {
          destinations.push({ chatId: u.chatId.trim(), label: u.telegramUsername });
        }
      }
    }
  }

  if (destinations.length === 0) {
    return {
      success: false,
      message: 'No recipient Chat IDs found! Click "Auto-Detect Chat IDs" or ask users to send /confirm in your bot.',
      recipientsCount: 0,
      details: []
    };
  }

  const testMessage = customTestMessage || (
    `🏋️ <b>Iron House Telegram Alert Test</b>\n\n` +
    `Your Telegram bot is successfully connected to <b>Iron House — Gym Training</b>! 💪\n` +
    `You can receive workout plan alerts, coach updates, security notices, and use interactive bot commands (/workouts, /progress, /status, /id, /help).\n\n` +
    `<i>Time: ${new Date().toLocaleString()}</i>`
  );

  let successCount = 0;
  const details: { target: string; username?: string; success: boolean; error?: string }[] = [];

  for (const dest of destinations) {
    const res = await sendDirectTelegramMessage(cleanToken, dest.chatId, testMessage);
    if (res.success) {
      successCount++;
      details.push({ target: dest.chatId, username: dest.label, success: true });
    } else {
      details.push({ target: dest.chatId, username: dest.label, success: false, error: res.error });
    }
  }

  if (successCount > 0) {
    const labels = details.filter(d => d.success).map(d => d.username).join(', ');
    return {
      success: true,
      message: `Test alert successfully sent to ${successCount} recipient(s): ${labels}!`,
      recipientsCount: successCount,
      details
    };
  }

  return {
    success: false,
    message: `Failed to deliver test message to any recipient. Check bot permissions.`,
    recipientsCount: 0,
    details
  };
}

/**
 * Dispatches an alert message to Telegram with zero-crash direct fallback for Vercel production
 */
export async function sendTelegramAlert(
  message: string,
  type: 'security',
  adminSettingsOrOptions?: AdminSetting[] | TelegramAlertOptions,
  customConfig?: TelegramConfig
): Promise<{ success: boolean; error?: string; recipientsCount?: number }> {
  let options: TelegramAlertOptions | undefined;
  let adminSettings: AdminSetting[] | undefined;

  if (Array.isArray(adminSettingsOrOptions)) {
    adminSettings = adminSettingsOrOptions;
  } else if (adminSettingsOrOptions && typeof adminSettingsOrOptions === 'object') {
    options = adminSettingsOrOptions;
    adminSettings = options.adminSettings;
    customConfig = customConfig || options.customConfig;
  }

  const config = customConfig || getTelegramConfig(adminSettings);

  // If master toggle is disabled or bot token is missing, silently skip
  if (!config.enabled || !config.botToken.trim()) {
    return { success: false, error: 'Telegram alerts are disabled or not configured.' };
  }

  // Check security event filter
  if (type === 'security' && !config.notifySecurity) return { success: false, error: 'Security notifications disabled' };

  const cleanToken = config.botToken.trim();

  // Normalize exclusion and targeting parameters
  const normalizedExclude = options?.excludeUsername?.trim()
    ? options.excludeUsername.trim().toLowerCase()
    : null;
  const normalizedExcludeHandle = normalizedExclude
    ? (normalizedExclude.startsWith('@') ? normalizedExclude : `@${normalizedExclude}`)
    : null;

  const normalizedTarget = options?.targetUsername?.trim()
    ? options.targetUsername.trim().toLowerCase()
    : null;
  const normalizedTargetHandle = normalizedTarget
    ? (normalizedTarget.startsWith('@') ? normalizedTarget : `@${normalizedTarget}`)
    : null;

  // Collect active destination Chat IDs matching the user data criteria:
  const recipientChatIds = new Set<string>();

  if (Array.isArray(config.authorizedUsers)) {
    for (const u of config.authorizedUsers) {
      if (!u.isActive || !u.confirmed || !u.chatId || !u.chatId.trim()) {
        continue;
      }

      const userTg = u.telegramUsername.toLowerCase().trim();
      const userApp = (u.appUsername || '').toLowerCase().trim();

      // 1. Exclude sender so they don't get pinged about their own action
      if (normalizedExclude) {
        if (userApp === normalizedExclude || userTg === normalizedExclude || userTg === normalizedExcludeHandle) {
          continue;
        }
      }

      // 2. Personal targeting: if targeted to a single user (e.g. security alert), only deliver to them
      if (normalizedTarget) {
        if (userApp !== normalizedTarget && userTg !== normalizedTarget && userTg !== normalizedTargetHandle) {
          continue;
        }
      }

      recipientChatIds.add(u.chatId.trim());
    }
  }

  // Fallback to primary group Chat ID when no personal targeting is specified
  if (config.chatId && config.chatId.trim() && !normalizedTarget) {
    recipientChatIds.add(config.chatId.trim());
  }

  if (recipientChatIds.size === 0) {
    return { 
      success: false, 
      error: 'No active recipient Chat IDs matched the filter criteria for this alert category.' 
    };
  }

  let sentCount = 0;
  let lastError = '';

  // Dispatch alert to each recipient chat
  for (const targetChatId of recipientChatIds) {
    let delivered = false;

    // 1. Try server proxy endpoint first
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: cleanToken,
          chatId: targetChatId,
          text: message,
          parseMode: 'HTML'
        })
      });

      const parsed = await safeParseResponse(res);
      if (parsed.isJson && res.ok && parsed.data?.success) {
        delivered = true;
        sentCount++;
      }
    } catch (proxyErr) {
      console.warn(`Proxy dispatch failed for chat ${targetChatId}, trying direct API:`, proxyErr);
    }

    // 2. Direct fallback to Telegram Bot API
    if (!delivered) {
      try {
        const directRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          })
        });

        const directParsed = await safeParseResponse(directRes);
        if (directRes.ok && directParsed.isJson && directParsed.data?.ok) {
          delivered = true;
          sentCount++;
        } else {
          lastError = directParsed.isJson && directParsed.data?.description 
            ? directParsed.data.description 
            : `HTTP ${directRes.status}`;
        }
      } catch (err: any) {
        lastError = err.message || 'Direct dispatch failed';
      }
    }
  }

  if (sentCount > 0) {
    return { success: true, recipientsCount: sentCount };
  }

  return { success: false, error: lastError || 'Failed to dispatch to any Telegram recipients' };
}

/**
 * Sends a direct message to a specific single chat ID (used for individual user testing or confirmation)
 */
export async function sendDirectTelegramMessage(
  botToken: string,
  chatId: string,
  message: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const cleanToken = botToken.trim();
  const cleanChat = chatId.trim();

  if (!cleanToken || !cleanChat) {
    return { success: false, error: 'Both Bot Token and Chat ID are required.' };
  }

  // 1. Try server proxy endpoint
  try {
    const res = await fetch('/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botToken: cleanToken,
        chatId: cleanChat,
        text: message,
        parseMode: 'HTML'
      })
    });
    const parsed = await safeParseResponse(res);
    if (parsed.isJson && res.ok && parsed.data?.success) {
      return { success: true, message: 'Message sent successfully!' };
    }
  } catch (proxyErr) {
    console.warn("Proxy direct send failed, trying direct API:", proxyErr);
  }

  // 2. Direct fallback to Telegram Bot API
  try {
    const directRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChat,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const directParsed = await safeParseResponse(directRes);
    if (directRes.ok && directParsed.isJson && directParsed.data?.ok) {
      return { success: true, message: 'Message delivered directly via Bot API!' };
    }

    return { 
      success: false, 
      error: directParsed.isJson && directParsed.data?.description ? directParsed.data.description : `HTTP ${directRes.status}` 
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error sending direct message' };
  }
}

// ==========================================
// TELEGRAM WEBHOOK MANAGEMENT (SERVER & DIRECT)
// ==========================================

export async function setTelegramWebhook(
  botToken: string,
  webhookUrl: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const cleanToken = botToken.trim();
  const cleanUrl = webhookUrl.trim();

  if (!cleanToken || !cleanUrl) {
    return { success: false, error: 'Both Bot Token and Webhook URL are required.' };
  }

  // 1. Try server endpoint
  try {
    const res = await fetch('/api/telegram/webhook/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: cleanToken, webhookUrl: cleanUrl })
    });
    const parsed = await safeParseResponse(res);
    if (parsed.isJson && res.ok && parsed.data?.success) {
      return { success: true, message: parsed.data.message || 'Webhook activated successfully!' };
    }
  } catch (e) {
    console.warn("Server webhook set failed, using direct API:", e);
  }

  // 2. Direct fallback
  try {
    const directRes = await fetch(`https://api.telegram.org/bot${cleanToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: cleanUrl,
        drop_pending_updates: true
      })
    });

    const parsed = await safeParseResponse(directRes);
    if (directRes.ok && parsed.isJson && parsed.data?.ok) {
      return { success: true, message: parsed.data.description || 'Webhook activated successfully on Telegram!' };
    }

    return { success: false, error: parsed.data?.description || `HTTP ${directRes.status}` };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to set webhook' };
  }
}

export async function getTelegramWebhookInfo(
  botToken: string
): Promise<{ success: boolean; info?: any; error?: string }> {
  const cleanToken = botToken.trim();
  if (!cleanToken) return { success: false, error: 'Bot Token is required.' };

  // 1. Try server endpoint
  try {
    const res = await fetch('/api/telegram/webhook/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: cleanToken })
    });
    const parsed = await safeParseResponse(res);
    if (parsed.isJson && res.ok && parsed.data?.success) {
      return { success: true, info: parsed.data.info };
    }
  } catch (e) {
    console.warn("Server webhook info failed, using direct API:", e);
  }

  // 2. Direct fallback
  try {
    const directRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getWebhookInfo`);
    const parsed = await safeParseResponse(directRes);
    if (directRes.ok && parsed.isJson && parsed.data?.ok) {
      return { success: true, info: parsed.data.result };
    }
    return { success: false, error: parsed.data?.description || `HTTP ${directRes.status}` };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to fetch webhook info' };
  }
}

export async function deleteTelegramWebhook(
  botToken: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const cleanToken = botToken.trim();
  if (!cleanToken) return { success: false, error: 'Bot Token is required.' };

  // 1. Try server endpoint
  try {
    const res = await fetch('/api/telegram/webhook/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: cleanToken })
    });
    const parsed = await safeParseResponse(res);
    if (parsed.isJson && res.ok && parsed.data?.success) {
      return { success: true, message: parsed.data.message || 'Webhook removed successfully!' };
    }
  } catch (e) {
    console.warn("Server webhook delete failed, using direct API:", e);
  }

  // 2. Direct fallback
  try {
    const directRes = await fetch(`https://api.telegram.org/bot${cleanToken}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: true })
    });
    const parsed = await safeParseResponse(directRes);
    if (directRes.ok && parsed.isJson && parsed.data?.ok) {
      return { success: true, message: parsed.data.description || 'Webhook removed on Telegram!' };
    }
    return { success: false, error: parsed.data?.description || `HTTP ${directRes.status}` };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to remove webhook' };
  }
}

export const TELEGRAM_COMMAND_DEFINITIONS = [
  { command: 'start', description: 'Activate bot & link your Iron House account' },
  { command: 'confirm', description: 'Confirm access & register for gym alerts' },
  { command: 'id', description: 'Get your Telegram Chat ID & username' },
  { command: 'status', description: 'Check bot connection & workout alerts status' },
  { command: 'workouts', description: 'View your assigned workout plans' },
  { command: 'progress', description: 'Check your weekly training completion' },
  { command: 'help', description: 'Show all available bot commands' },
];

export async function syncTelegramBotCommands(
  botToken: string
): Promise<{ success: boolean; mode?: 'webhook' | 'polling'; repliesSent?: number; message?: string; error?: string }> {
  const cleanToken = (botToken || '').trim();
  if (!cleanToken) return { success: false, error: 'Bot Token is required.' };

  // 1. Try server endpoint (registers menu + checks webhook/polling + processes pending commands)
  try {
    const res = await fetch('/api/telegram/commands/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: cleanToken })
    });
    const parsed = await safeParseResponse(res);
    if (parsed.isJson && res.ok && parsed.data?.success) {
      return {
        success: true,
        mode: parsed.data.mode,
        repliesSent: parsed.data.repliesSent || 0,
        message: parsed.data.message || 'Bot commands registered successfully!'
      };
    }
  } catch (e) {
    console.warn('Server command sync failed, using direct Telegram setMyCommands:', e);
  }

  // 2. Direct fallback to Telegram Bot API setMyCommands
  try {
    const directRes = await fetch(`https://api.telegram.org/bot${cleanToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: TELEGRAM_COMMAND_DEFINITIONS })
    });
    const parsed = await safeParseResponse(directRes);
    if (directRes.ok && parsed.isJson && parsed.data?.ok) {
      return {
        success: true,
        mode: 'polling',
        message: `Registered ${TELEGRAM_COMMAND_DEFINITIONS.length} bot commands via Telegram Bot API!`
      };
    }
    return {
      success: false,
      error: (parsed.isJson && parsed.data?.description) || `HTTP ${directRes.status}`
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to sync bot commands' };
  }
}

// ==========================================
// TELEGRAM WHITELIST & PROFILE AUTO-SYNC HELPERS
// ==========================================

/**
 * Extracts and normalizes all Telegram usernames declared across user profiles
 */
export function extractTelegramUsernamesFromProfiles(userAccounts: UserAccount[]): { username: string; accountName: string }[] {
  if (!Array.isArray(userAccounts)) return [];

  const map = new Map<string, string>();
  for (const acc of userAccounts) {
    const rawTg = (acc.telegramUsername || '').trim();
    if (rawTg) {
      const normalized = rawTg.startsWith('@') ? rawTg.toLowerCase() : `@${rawTg.toLowerCase()}`;
      if (normalized.length > 1 && !map.has(normalized)) {
        map.set(normalized, acc.username);
      }
    }
  }

  return Array.from(map.entries()).map(([username, accountName]) => ({ username, accountName }));
}

/**
 * Automatically merges user profile Telegram usernames into the active whitelist
 */
export function mergeProfileUsernamesIntoWhitelist(
  currentWhitelist: string[] = [],
  userAccounts: UserAccount[] = []
): string[] {
  const discovered = extractTelegramUsernamesFromProfiles(userAccounts).map(d => d.username);
  const existing = currentWhitelist.map(u => (u.startsWith('@') ? u.trim() : `@${u.trim()}`).toLowerCase());
  return Array.from(new Set([...existing, ...discovered])).filter(u => u.length > 1);
}

/**
 * Confirms or registers an authorized Telegram user with their verified Chat ID
 */
export function confirmOrRegisterTelegramUser(
  telegramUsername: string,
  chatId: string,
  config: TelegramConfig,
  appUsername?: string
): { updatedConfig: TelegramConfig; user: TelegramAuthorizedUser; isNew: boolean } {
  const cleanUsername = telegramUsername.startsWith('@') 
    ? telegramUsername.toLowerCase().trim() 
    : `@${telegramUsername.toLowerCase().trim()}`;
  const cleanChat = chatId.trim();
  const currentList = Array.isArray(config.authorizedUsers) ? [...config.authorizedUsers] : [];
  
  const existingIndex = currentList.findIndex(
    u => u.telegramUsername.toLowerCase() === cleanUsername
  );

  let targetUser: TelegramAuthorizedUser;
  let isNew = false;

  if (existingIndex >= 0) {
    targetUser = {
      ...currentList[existingIndex],
      chatId: cleanChat,
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      lastNotifiedAt: new Date().toISOString(),
      isActive: true,
      appUsername: appUsername || currentList[existingIndex].appUsername
    };
    currentList[existingIndex] = targetUser;
  } else {
    isNew = true;
    targetUser = {
      id: `tg_usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      telegramUsername: cleanUsername,
      chatId: cleanChat,
      appUsername: appUsername || '',
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      lastNotifiedAt: new Date().toISOString(),
      isActive: true,
      role: 'partner'
    };
    currentList.push(targetUser);
  }

  // Ensure user is on whitelistedUsernames
  const currentWhitelist = Array.isArray(config.whitelistedUsernames) ? [...config.whitelistedUsernames] : [];
  if (!currentWhitelist.some(u => u.toLowerCase() === cleanUsername)) {
    currentWhitelist.push(cleanUsername);
  }

  return {
    updatedConfig: {
      ...config,
      whitelistedUsernames: currentWhitelist,
      authorizedUsers: currentList
    },
    user: targetUser,
    isNew
  };
}

/**
 * Adds or updates an authorized user in the Telegram config
 */
export function addAuthorizedTelegramUser(
  config: TelegramConfig,
  newUser: { 
    telegramUsername: string; 
    chatId?: string; 
    appUsername?: string; 
    role?: 'partner' | 'admin' | 'guest'; 
    confirmed?: boolean 
  }
): TelegramConfig {
  const cleanUsername = newUser.telegramUsername.startsWith('@') 
    ? newUser.telegramUsername.toLowerCase().trim() 
    : `@${newUser.telegramUsername.toLowerCase().trim()}`;
  
  const currentList = Array.isArray(config.authorizedUsers) ? [...config.authorizedUsers] : [];
  const existingIndex = currentList.findIndex(u => u.telegramUsername.toLowerCase() === cleanUsername);

  if (existingIndex >= 0) {
    currentList[existingIndex] = {
      ...currentList[existingIndex],
      chatId: newUser.chatId?.trim() || currentList[existingIndex].chatId,
      appUsername: newUser.appUsername || currentList[existingIndex].appUsername,
      role: newUser.role || currentList[existingIndex].role,
      confirmed: newUser.confirmed !== undefined ? newUser.confirmed : currentList[existingIndex].confirmed,
      isActive: true
    };
  } else {
    currentList.push({
      id: `tg_usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      telegramUsername: cleanUsername,
      chatId: newUser.chatId?.trim() || '',
      appUsername: newUser.appUsername || '',
      confirmed: !!newUser.confirmed || (!!newUser.chatId?.trim()),
      confirmedAt: (newUser.confirmed || newUser.chatId?.trim()) ? new Date().toISOString() : undefined,
      isActive: true,
      role: newUser.role || 'partner'
    });
  }

  const currentWhitelist = Array.isArray(config.whitelistedUsernames) ? [...config.whitelistedUsernames] : [];
  if (!currentWhitelist.some(u => u.toLowerCase() === cleanUsername)) {
    currentWhitelist.push(cleanUsername);
  }

  return {
    ...config,
    whitelistedUsernames: currentWhitelist,
    authorizedUsers: currentList
  };
}

/**
 * Removes an authorized user from the Telegram config
 */
export function removeAuthorizedTelegramUser(
  config: TelegramConfig,
  idOrUsername: string
): TelegramConfig {
  const clean = idOrUsername.toLowerCase().trim();
  const currentList = (config.authorizedUsers || []).filter(
    u => u.id !== clean && u.telegramUsername.toLowerCase() !== clean
  );
  return {
    ...config,
    authorizedUsers: currentList
  };
}

/**
 * Toggles an authorized user's active status
 */
export function toggleAuthorizedTelegramUserStatus(
  config: TelegramConfig,
  userId: string,
  isActive: boolean
): TelegramConfig {
  const currentList = (config.authorizedUsers || []).map(u => {
    if (u.id === userId) {
      return { ...u, isActive };
    }
    return u;
  });
  return {
    ...config,
    authorizedUsers: currentList
  };
}

// ==========================================
// HTML MESSAGE FORMATTERS
// ==========================================

export function formatSecurityAlertTelegramMessage(
  username: string, 
  action: string, 
  details: string
): string {
  return `🛡️ <b>Iron House — Security Alert</b> ⚠️\n\n` +
    `User Target: <b>${escapeHtml(username)}</b>\n` +
    `Action: <code>${escapeHtml(action)}</code>\n` +
    `Details: ${escapeHtml(details)}\n` +
    `Time: <i>${new Date().toLocaleString()}</i>\n\n` +
    `If this was not authorized by you, please check Admin Panel security controls immediately.`;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Runs an end-to-end diagnostic check against Telegram Bot API (getMe, getWebhookInfo, optional test message)
 */
export async function runTelegramBotDiagnostics(
  botToken: string,
  targetChat?: string
): Promise<TelegramDiagnosticReport> {
  const start = performance.now();
  const cleanToken = (botToken || '').trim();
  const cleanTarget = (targetChat || '').trim();

  const report: TelegramDiagnosticReport = {
    success: false,
    latencyMs: 0,
    checks: {
      tokenProvided: Boolean(cleanToken),
      apiReachable: false,
      botAuthenticated: false,
      webhookHealthy: false
    },
    testMessageSent: false,
    testMessageDelivered: false
  };

  if (!cleanToken) {
    report.error = 'Bot Token is missing.';
    report.latencyMs = Math.round(performance.now() - start);
    return report;
  }

  try {
    // 1. Validate bot identity via getMe
    const meRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
    const meParsed = await safeParseResponse(meRes);
    report.checks.apiReachable = true;
    report.rawTelegramResponse = meParsed.data ?? meParsed.rawText;

    if (!meRes.ok || !meParsed.isJson || !meParsed.data?.ok) {
      report.error = meParsed.data?.description || `Telegram authentication failed (HTTP ${meRes.status})`;
      report.latencyMs = Math.round(performance.now() - start);
      return report;
    }

    report.checks.botAuthenticated = true;
    const botResult = meParsed.data.result || {};
    report.bot = {
      id: botResult.id,
      username: botResult.username || '',
      firstName: botResult.first_name || 'Bot',
      canJoinGroups: botResult.can_join_groups
    };

    // 2. Inspect webhook status
    const whInfo = await getTelegramWebhookInfo(cleanToken);
    if (whInfo.success && whInfo.info) {
      report.webhook = {
        url: whInfo.info.url || '',
        pendingUpdateCount: whInfo.info.pending_update_count || 0,
        lastErrorMessage: whInfo.info.last_error_message
      };
      report.checks.webhookHealthy = !whInfo.info.last_error_message;
    } else {
      report.checks.webhookHealthy = true;
    }

    // 3. Optional test message dispatch (supports numeric Chat ID or @username lookup)
    if (cleanTarget) {
      let resolvedChatId = cleanTarget;
      if (cleanTarget.startsWith('@')) {
        const detailed = await fetchTelegramChatIdsDetailed(cleanToken);
        const match = detailed.mapped[cleanTarget.toLowerCase()] || detailed.mapped[cleanTarget.replace(/^@/, '').toLowerCase()];
        if (match?.chatId) {
          resolvedChatId = match.chatId;
        }
      }

      report.testMessageSent = true;
      const msgRes = await sendDirectTelegramMessage(
        cleanToken,
        resolvedChatId,
        `🔍 <b>Telegram Diagnostic Ping</b>\n\nBot <b>@${escapeHtml(report.bot.username)}</b> verified.\n<i>Time: ${new Date().toLocaleString()}</i>`
      );
      if (msgRes.success) {
        report.testMessageDelivered = true;
      } else {
        report.testMessageDelivered = false;
        report.testMessageError = msgRes.error || 'Failed to deliver diagnostic message';
      }
    }

    report.success = report.checks.botAuthenticated && (!report.testMessageSent || report.testMessageDelivered);
    if (!report.success && report.testMessageError) {
      report.error = report.testMessageError;
    }
  } catch (err: any) {
    report.error = err?.message || 'Network error connecting to Telegram Bot API';
  }

  report.latencyMs = Math.round(performance.now() - start);
  return report;
}
