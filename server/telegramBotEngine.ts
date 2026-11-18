import fs from 'fs';
import path from 'path';

export interface BotCommandSpec {
  command: string;
  description: string;
}

export const TELEGRAM_BOT_COMMANDS: BotCommandSpec[] = [
  { command: 'start', description: 'Activate bot & link your Iron House account' },
  { command: 'confirm', description: 'Confirm access & register for gym alerts' },
  { command: 'id', description: 'Get your Telegram Chat ID & username' },
  { command: 'status', description: 'Check bot connection & workout alerts status' },
  { command: 'workouts', description: 'View your assigned workout plans' },
  { command: 'progress', description: 'Check your weekly training completion' },
  { command: 'help', description: 'Show all available bot commands' },
];

export interface FirestoreUserRecord {
  id: string;
  username: string;
  displayName?: string;
  role?: string;
  telegramUsername?: string;
  telegramChatId?: string;
  telegramNotificationsEnabled?: boolean;
}

export interface FirestoreWorkoutPlanRecord {
  id: string;
  ownerUsername: string;
  title: string;
  weeks: number;
  exercises: Array<{
    id?: string;
    day?: string;
    name?: string;
  }>;
  progress?: Record<string, string[]>;
  exerciseLogs?: Record<string, Record<string, any>>;
  updatedAt?: string;
  createdAt?: string;
}

export interface FirestoreTelegramConfigRecord {
  botToken?: string;
  chatId?: string;
  enabled?: boolean;
  webhookEnabled?: boolean;
  webhookUrl?: string;
  whitelistedUsernames?: string[];
  authorizedUsers?: Array<{
    telegramUsername?: string;
    chatId?: string;
    appUsername?: string;
    confirmed?: boolean;
    isActive?: boolean;
  }>;
}

function getFirebaseProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID?.trim()) return process.env.FIREBASE_PROJECT_ID.trim();
  if (process.env.VITE_FIREBASE_PROJECT_ID?.trim()) return process.env.VITE_FIREBASE_PROJECT_ID.trim();
  try {
    const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (cfg?.projectId) return String(cfg.projectId);
    }
  } catch {
    // ignore fallback
  }
  return 'gym-workout-d621e';
}

function decodeFirestoreValue(val: any): any {
  if (!val || typeof val !== 'object') return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    const vals = val.arrayValue?.values;
    return Array.isArray(vals) ? vals.map(decodeFirestoreValue) : [];
  }
  if ('mapValue' in val) {
    const fields = val.mapValue?.fields || {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

function decodeFirestoreDoc(doc: any): Record<string, any> | null {
  if (!doc || !doc.fields) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  if (!out.id && typeof doc.name === 'string') {
    const segs = doc.name.split('/');
    out.id = segs[segs.length - 1];
  }
  return out;
}

export async function fetchFirestoreTelegramConfig(): Promise<FirestoreTelegramConfigRecord | null> {
  try {
    const projectId = getFirebaseProjectId();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/adminSettings/telegramConfig`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const decoded = decodeFirestoreDoc(json);
    if (decoded?.telegramConfig && typeof decoded.telegramConfig === 'object') {
      return decoded.telegramConfig as FirestoreTelegramConfigRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchFirestoreUserAccounts(): Promise<FirestoreUserRecord[]> {
  try {
    const projectId = getFirebaseProjectId();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/userAccounts?pageSize=200`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json: any = await res.json();
    const docs = Array.isArray(json?.documents) ? json.documents : [];
    return docs
      .map(decodeFirestoreDoc)
      .filter((d): d is FirestoreUserRecord => Boolean(d && d.username));
  } catch {
    return [];
  }
}

export async function fetchFirestoreWorkoutPlans(): Promise<FirestoreWorkoutPlanRecord[]> {
  try {
    const projectId = getFirebaseProjectId();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/workoutPlans?pageSize=200`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json: any = await res.json();
    const docs = Array.isArray(json?.documents) ? json.documents : [];
    return docs
      .map(decodeFirestoreDoc)
      .filter((d): d is FirestoreWorkoutPlanRecord => Boolean(d && d.title));
  } catch {
    return [];
  }
}

export function normalizeCommandText(rawText: string): {
  command: string;
  args: string;
  rawLower: string;
} {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return { command: '', args: '', rawLower: '' };
  const rawLower = trimmed.toLowerCase();
  const [firstToken, ...restTokens] = trimmed.split(/\s+/);
  const args = restTokens.join(' ').trim();
  // Strip leading "/" and optional "@BotUsername" suffix (e.g. "/start@IronHouseBot")
  const cleanedCmd = firstToken.replace(/^\/+/, '').split('@')[0].toLowerCase().trim();
  return { command: cleanedCmd, args, rawLower };
}

export function isBotConfirmationCommand(rawText: string): boolean {
  const { command } = normalizeCommandText(rawText);
  return (
    command === 'start' ||
    command === 'confirm' ||
    command === 'access' ||
    command === 'verify' ||
    command === 'ok' ||
    command === 'yes' ||
    command === 'id' ||
    command === 'chatid'
  );
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildProgressBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round(clamped / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${clamped}%`;
}

function computePlanStats(plan: FirestoreWorkoutPlanRecord): {
  done: number;
  total: number;
  pct: number;
  weeks: number;
  exerciseCount: number;
  days: string[];
  loggedWeeksCount: number;
} {
  const weeks = Math.max(1, Number(plan.weeks) || 1);
  const exercises = Array.isArray(plan.exercises) ? plan.exercises : [];
  const exerciseCount = exercises.length;
  const total = exerciseCount * weeks;
  let done = 0;
  const progress = plan.progress || {};
  for (let w = 0; w < weeks; w++) {
    const arr = progress[`w${w + 1}`];
    if (Array.isArray(arr)) done += arr.length;
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const daysSet = new Set<string>();
  exercises.forEach((ex) => {
    if (ex?.day && typeof ex.day === 'string' && ex.day.trim()) {
      daysSet.add(ex.day.trim());
    }
  });
  const loggedWeeksCount = Object.values(plan.exerciseLogs || {}).reduce((acc, byEx) => {
    if (byEx && typeof byEx === 'object') return Math.max(acc, Object.keys(byEx).length);
    return acc;
  }, 0);

  return {
    done,
    total,
    pct,
    weeks,
    exerciseCount,
    days: Array.from(daysSet),
    loggedWeeksCount,
  };
}

export async function registerTelegramCommandsMenu(botToken: string): Promise<{ ok: boolean; error?: string }> {
  const token = (botToken || '').trim();
  if (!token) return { ok: false, error: 'Missing bot token' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: TELEGRAM_BOT_COMMANDS,
      }),
    });
    const data: any = await res.json();
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.description || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error setting bot commands' };
  }
}

export function findLinkedAccount(
  accounts: FirestoreUserRecord[],
  tgConfig: FirestoreTelegramConfigRecord | null,
  chatId: string,
  tgUsername: string,
  startArg?: string
): FirestoreUserRecord | null {
  const cleanChat = chatId.trim();
  const cleanAt = tgUsername ? (tgUsername.startsWith('@') ? tgUsername.toLowerCase() : `@${tgUsername.toLowerCase()}`) : '';
  const cleanBare = cleanAt.replace(/^@/, '');

  // 1. Match directly by telegramChatId on userAccounts
  const byChat = accounts.find((u) => (u.telegramChatId || '').trim() === cleanChat);
  if (byChat) return byChat;

  // 2. Match by telegramUsername on userAccounts
  if (cleanBare) {
    const byHandle = accounts.find((u) => {
      const uh = (u.telegramUsername || '').trim().toLowerCase().replace(/^@/, '');
      return uh && uh === cleanBare;
    });
    if (byHandle) return byHandle;
  }

  // 3. Match via tgConfig.authorizedUsers appUsername mapping
  const authMatch = (tgConfig?.authorizedUsers || []).find((a) => {
    const aChat = (a.chatId || '').trim();
    const aUser = (a.telegramUsername || '').trim().toLowerCase().replace(/^@/, '');
    return (aChat && aChat === cleanChat) || (cleanBare && aUser === cleanBare);
  });
  if (authMatch?.appUsername) {
    const byAppUser = accounts.find(
      (u) => u.username.toLowerCase() === authMatch.appUsername!.toLowerCase().trim()
    );
    if (byAppUser) return byAppUser;
  }

  // 4. Match optional `/start <username>` deep link arg
  if (startArg) {
    const argLower = startArg.toLowerCase().trim();
    const byArg = accounts.find((u) => u.username.toLowerCase() === argLower);
    if (byArg) return byArg;
  }

  return null;
}

export async function buildTelegramCommandReply(params: {
  chatId: string;
  tgUsername: string;
  firstName: string;
  text: string;
}): Promise<string> {
  const { chatId, tgUsername, firstName, text } = params;
  const { command, args, rawLower } = normalizeCommandText(text);
  const safeName = escapeHtml(firstName || 'Athlete');
  const safeHandle = tgUsername ? `<code>${escapeHtml(tgUsername)}</code>` : 'No @username';

  // Fetch member & workout context from Firestore safely (never fails the reply)
  const [tgConfig, accounts, allPlans] = await Promise.all([
    fetchFirestoreTelegramConfig().catch(() => null),
    fetchFirestoreUserAccounts().catch(() => []),
    fetchFirestoreWorkoutPlans().catch(() => []),
  ]);

  const linkedAccount = findLinkedAccount(
    accounts,
    tgConfig,
    chatId,
    tgUsername,
    command === 'start' ? args : undefined
  );

  const memberPlans = linkedAccount
    ? allPlans.filter(
        (p) => (p.ownerUsername || '').trim().toLowerCase() === linkedAccount.username.trim().toLowerCase()
      )
    : [];

  const memberLabel = linkedAccount
    ? escapeHtml(linkedAccount.displayName?.trim() || linkedAccount.username)
    : '';

  // 1. /id or /chatid — ALWAYS checked BEFORE /start & /confirm so it is never shadowed
  if (command === 'id' || command === 'chatid') {
    return (
      `🆔 <b>Your Telegram Credentials</b>\n\n` +
      `• <b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>\n` +
      `• <b>Username:</b> ${safeHandle}\n` +
      (linkedAccount
        ? `• <b>Linked Iron House Profile:</b> <b>${memberLabel}</b> (<code>${escapeHtml(linkedAccount.username)}</code>) 🟢\n\n`
        : `• <b>Profile Link:</b> Not linked yet 🟡\n\n` +
          `Paste this Chat ID into <b>Iron House → Profile → Telegram Bot</b> (or send <code>/confirm</code> after saving your @username).\n\n`) +
      `<i>Tip: Tap the Chat ID above to copy it instantly.</i>`
    );
  }

  // 2. /help or /commands
  if (command === 'help' || command === 'commands') {
    return (
      `🏋️ <b>Iron House Bot — Available Commands</b>\n\n` +
      `• <code>/start</code> or <code>/confirm</code> — Confirm access &amp; link alerts\n` +
      `• <code>/id</code> or <code>/chatid</code> — Show your Telegram Chat ID\n` +
      `• <code>/status</code> — Check bot connection &amp; alert settings\n` +
      `• <code>/workouts</code> — View your assigned workout plans\n` +
      `• <code>/progress</code> — View your weekly training progress\n` +
      `• <code>/help</code> — Show this command reference\n\n` +
      `<i>You can type commands with or without the leading slash (e.g. <code>id</code>, <code>workouts</code>).</i>`
    );
  }

  // 3. /status
  if (command === 'status') {
    const notificationsOn = linkedAccount
      ? linkedAccount.telegramNotificationsEnabled !== false
      : true;
    return (
      `📊 <b>Iron House Bot Status</b>\n\n` +
      `• <b>Telegram User:</b> ${safeName} (${safeHandle})\n` +
      `• <b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>\n` +
      `• <b>Account Link:</b> ${
        linkedAccount
          ? `Linked to <b>${memberLabel}</b> (<code>${escapeHtml(linkedAccount.username)}</code>) 🟢`
          : `Not linked yet 🟡`
      }\n` +
      `• <b>Notifications:</b> ${notificationsOn ? 'Enabled 🔔' : 'Paused 🔕'}\n` +
      `• <b>Assigned Workout Plans:</b> <b>${memberPlans.length}</b>\n` +
      `• <b>Server Time:</b> <i>${escapeHtml(new Date().toLocaleString())}</i>`
    );
  }

  // 4. /workouts, /plan, /today
  if (command === 'workouts' || command === 'plan' || command === 'today') {
    if (!linkedAccount) {
      return (
        `🏋️ <b>My Workout Plans</b>\n\n` +
        `Your Telegram chat (<code>${escapeHtml(chatId)}</code>) is not linked to an Iron House account yet.\n\n` +
        `To link it:\n` +
        `1. Open <b>Iron House → Profile → Telegram Bot</b>\n` +
        `2. Enter your Chat ID (<code>${escapeHtml(chatId)}</code>) or @username and save.\n` +
        `Then send <code>/workouts</code> again! 💪`
      );
    }

    if (memberPlans.length === 0) {
      return (
        `🏋️ <b>Workout Plans for ${memberLabel}</b>\n\n` +
        `No workout plans are assigned to your account yet.\n` +
        `Upload a workout sheet in the <b>Upload Sheet</b> tab or ask your coach to assign one!`
      );
    }

    const lines = memberPlans.slice(0, 6).map((plan, idx) => {
      const stats = computePlanStats(plan);
      const dayText =
        stats.days.length > 0
          ? ` • Days: ${stats.days.slice(0, 4).map(escapeHtml).join(', ')}${stats.days.length > 4 ? '…' : ''}`
          : '';
      return (
        `<b>${idx + 1}. ${escapeHtml(plan.title)}</b>\n` +
        `   ${stats.weeks}w • ${stats.exerciseCount} exercises${dayText}\n` +
        `   <code>${buildProgressBar(stats.pct)}</code> (${stats.done}/${stats.total})`
      );
    });

    return (
      `🏋️ <b>Assigned Workouts — ${memberLabel}</b>\n\n` +
      lines.join('\n\n') +
      (memberPlans.length > 6 ? `\n\n<i>…and ${memberPlans.length - 6} more plans in the app.</i>` : '') +
      `\n\n<i>Send /progress for full completion stats.</i>`
    );
  }

  // 5. /progress or /stats
  if (command === 'progress' || command === 'stats') {
    if (!linkedAccount) {
      return (
        `📈 <b>Training Progress</b>\n\n` +
        `Link your Chat ID (<code>${escapeHtml(chatId)}</code>) in <b>Iron House → Profile → Telegram Bot</b> to view your live workout stats!`
      );
    }

    if (memberPlans.length === 0) {
      return (
        `📈 <b>Training Progress — ${memberLabel}</b>\n\n` +
        `You don't have any tracked workout plans yet. Upload a workout sheet to start tracking sets, weights, and weekly history!`
      );
    }

    let totalDone = 0;
    let totalChecks = 0;
    let totalExercises = 0;
    memberPlans.forEach((p) => {
      const s = computePlanStats(p);
      totalDone += s.done;
      totalChecks += s.total;
      totalExercises += s.exerciseCount;
    });
    const overallPct = totalChecks > 0 ? Math.round((totalDone / totalChecks) * 100) : 0;

    const latest = memberPlans[0];
    const latestStats = computePlanStats(latest);

    return (
      `📈 <b>Training Progress — ${memberLabel}</b>\n\n` +
      `• <b>Active Plans:</b> ${memberPlans.length}\n` +
      `• <b>Total Exercises:</b> ${totalExercises}\n` +
      `• <b>Overall Completion:</b>\n` +
      `  <code>${buildProgressBar(overallPct)}</code> (${totalDone}/${totalChecks} checks)\n\n` +
      `🔥 <b>Latest Plan: ${escapeHtml(latest.title)}</b>\n` +
      `  <code>${buildProgressBar(latestStats.pct)}</code> (${latestStats.weeks} weeks)\n\n` +
      `<i>Keep pushing! Open Iron House to log today's weights &amp; reps.</i> 💪`
    );
  }

  // 6. /start, /confirm, /verify, /access, ok, yes, hi, hello
  if (
    command === 'start' ||
    command === 'confirm' ||
    command === 'verify' ||
    command === 'access' ||
    command === 'ok' ||
    command === 'yes' ||
    rawLower === 'hi' ||
    rawLower === 'hello' ||
    rawLower === 'hey'
  ) {
    return (
      `✅ <b>Iron House Bot Connected!</b> 🏋️\n\n` +
      `Hello <b>${safeName}</b> (${safeHandle})!\n` +
      `• <b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>\n` +
      (linkedAccount
        ? `• <b>Member Account:</b> <b>${memberLabel}</b> (<code>${escapeHtml(linkedAccount.username)}</code>) 🟢\n` +
          `• <b>Workout Plans:</b> ${memberPlans.length} active\n\n` +
          `You will receive workout reminders, coach updates, and security alerts right here.\n\n`
        : `• <b>Status:</b> Verified &amp; Captured 🟢\n\n` +
          `Copy your Chat ID above into <b>Profile → Telegram Bot</b> (or ask your Admin to click <b>Auto-Detect Chat IDs</b>) to finish linking.\n\n`) +
      `<b>Quick Commands:</b>\n` +
      `• /workouts — View your workout plans\n` +
      `• /progress — Check weekly completion\n` +
      `• /status — Check alert status\n` +
      `• /id — Get your Chat ID\n` +
      `• /help — All commands`
    );
  }

  // 7. Default fallback for arbitrary text
  return (
    `🏋️ <b>Iron House — Gym Training Bot</b>\n\n` +
    `Hello <b>${safeName}</b>! Your Chat ID is <code>${escapeHtml(chatId)}</code>.\n` +
    (linkedAccount
      ? `Linked account: <b>${memberLabel}</b>.\n\n`
      : `\nSend <code>/confirm</code> to register your chat, or `) +
    `send <code>/help</code> to see all commands (<code>/workouts</code>, <code>/progress</code>, <code>/status</code>, <code>/id</code>).`
  );
}

export async function replyToTelegramMessage(
  botToken: string,
  message: any
): Promise<{ replied: boolean; replyText?: string; error?: string }> {
  const token = (botToken || '').trim();
  if (!token || !message?.chat?.id) {
    return { replied: false, error: 'Missing bot token or chat id' };
  }

  const chatId = String(message.chat.id);
  const fromUser = message.from || {};
  const rawUser = fromUser.username || message.chat.username || '';
  const tgUsername = rawUser ? `@${rawUser}` : '';
  const firstName = fromUser.first_name || message.chat.first_name || 'Athlete';
  const text = (message.text || '').trim();

  const replyText = await buildTelegramCommandReply({
    chatId,
    tgUsername,
    firstName,
    text,
  });

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: replyText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data: any = await res.json();
    if (!res.ok || !data?.ok) {
      return { replied: false, replyText, error: data?.description || `HTTP ${res.status}` };
    }
    return { replied: true, replyText };
  } catch (err: any) {
    return { replied: false, replyText, error: err?.message || 'Failed to send reply' };
  }
}
