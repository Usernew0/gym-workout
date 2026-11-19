import fs from 'fs';
import path from 'path';
import type { WorkoutPlan } from '../src/types';
import { exportWorkoutPlanToPdfBuffer } from '../src/lib/workoutPdfExport';
import { exportWorkoutPlanToExcelBuffer } from '../src/lib/workoutExcelExport';

export interface BotCommandSpec {
  command: string;
  description: string;
}

export const TELEGRAM_BOT_COMMANDS: BotCommandSpec[] = [
  { command: 'start', description: 'Activate bot & link your Gym Workout account' },
  { command: 'confirm', description: 'Confirm access & register for gym alerts' },
  { command: 'id', description: 'Get your Telegram Chat ID & username' },
  { command: 'status', description: 'Check bot connection & workout alerts status' },
  { command: 'workouts', description: 'View your assigned workout plans' },
  { command: 'progress', description: 'Check your weekly training completion' },
  { command: 'pdf', description: 'Send your workout plan as a PDF document' },
  { command: 'excel', description: 'Send your workout sheet as an Excel (.xlsx) file' },
  { command: 'water', description: 'Check water intake goal & hydration reminder' },
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
  waterIntake?: {
    date?: string;
    glasses?: number;
    updatedAt?: string;
    reminderEnabled?: boolean;
    reminderIntervalMinutes?: number;
  };
}

export interface FirestoreWorkoutPlanRecord {
  id: string;
  ownerUsername: string;
  title: string;
  description?: string;
  instructions?: string;
  sheetName?: string;
  defaultWeightUnit?: 'kg' | 'lbs';
  weeks: number;
  warmupExercises?: any[];
  warmupLogs?: Record<string, Record<string, any>>;
  exercises: Array<{
    id?: string;
    day?: string;
    name?: string;
    sets?: string;
    reps?: string;
    notes?: string;
    videoUrl?: string;
    isSuperset?: boolean;
    supersetGroup?: string;
  }>;
  sourceFileName?: string;
  createdBy?: string;
  assignedByAdmin?: boolean;
  progress?: Record<string, string[]>;
  exerciseLogs?: Record<string, Record<string, any>>;
  previousLogs?: Record<string, any>;
  updatedAt?: string;
  createdAt?: string;
}

export interface FirestoreTelegramConfigRecord {
  botToken?: string;
  chatId?: string;
  enabled?: boolean;
  autoSyncProfiles?: boolean;
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
  // Strip leading "/" and optional "@BotUsername" suffix (e.g. "/start@GymWorkoutBot")
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

function getTodayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getUserTodayWaterGlasses(user: FirestoreUserRecord | null): number | undefined {
  if (!user?.waterIntake) return undefined;
  const dateStr = (user.waterIntake.date || '').trim();
  if (dateStr && dateStr !== getTodayDateKey()) return 0;
  const n = Number(user.waterIntake.glasses);
  return Number.isFinite(n) && n >= 0 ? Math.min(40, Math.floor(n)) : undefined;
}

function toFullWorkoutPlan(rec: FirestoreWorkoutPlanRecord): WorkoutPlan {
  return {
    id: rec.id,
    ownerUsername: rec.ownerUsername || '',
    title: rec.title || 'Workout Plan',
    description: rec.description,
    instructions: rec.instructions,
    sheetName: rec.sheetName,
    defaultWeightUnit: rec.defaultWeightUnit === 'lbs' ? 'lbs' : 'kg',
    weeks: Math.max(1, Number(rec.weeks) || 1),
    warmupExercises: Array.isArray(rec.warmupExercises) ? rec.warmupExercises : [],
    warmupLogs: rec.warmupLogs || {},
    exercises: (Array.isArray(rec.exercises) ? rec.exercises : []).map((ex, idx) => ({
      id: ex?.id || `ex_${idx + 1}`,
      name: ex?.name || `Exercise ${idx + 1}`,
      ...(ex?.day ? { day: ex.day } : {}),
      ...(ex?.sets ? { sets: ex.sets } : {}),
      ...(ex?.reps ? { reps: ex.reps } : {}),
      ...(ex?.notes ? { notes: ex.notes } : {}),
      ...(ex?.videoUrl ? { videoUrl: ex.videoUrl } : {}),
      ...(ex?.isSuperset ? { isSuperset: true } : {}),
      ...(ex?.supersetGroup ? { supersetGroup: ex.supersetGroup } : {}),
    })),
    sourceFileName: rec.sourceFileName,
    createdBy: rec.createdBy || rec.ownerUsername || 'coach',
    assignedByAdmin: rec.assignedByAdmin,
    progress: rec.progress || {},
    exerciseLogs: rec.exerciseLogs || {},
    previousLogs: rec.previousLogs || {},
    createdAt: rec.createdAt || new Date().toISOString(),
    updatedAt: rec.updatedAt,
  };
}

function pickMemberPlan(plans: FirestoreWorkoutPlanRecord[], args: string): FirestoreWorkoutPlanRecord | null {
  if (plans.length === 0) return null;
  const sorted = [...plans].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
  const cleanArgs = (args || '').trim();
  if (!cleanArgs) return sorted[0];

  if (/^\d+$/.test(cleanArgs)) {
    const idx = parseInt(cleanArgs, 10) - 1;
    if (idx >= 0 && idx < sorted.length) return sorted[idx];
  }

  const lower = cleanArgs.toLowerCase();
  const byTitle = sorted.find(p => (p.title || '').toLowerCase().includes(lower));
  return byTitle || sorted[0];
}

export async function sendTelegramDocument(
  botToken: string,
  chatId: string,
  bytes: Uint8Array | Buffer,
  filename: string,
  mimeType: string,
  caption?: string
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const token = (botToken || '').trim();
  const cleanChat = (chatId || '').trim();
  if (!token || !cleanChat) {
    return { ok: false, error: 'Missing bot token or chat ID' };
  }
  try {
    const form = new FormData();
    form.append('chat_id', cleanChat);
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
    form.append('document', blob, filename);
    if (caption?.trim()) {
      form.append('caption', caption.trim());
      form.append('parse_mode', 'HTML');
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const data: any = await res.json();
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.description || `HTTP ${res.status}` };
    }
    return { ok: true, messageId: data.result?.message_id };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to upload Telegram document' };
  }
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

export interface TelegramAccessResolution {
  authorized: boolean;
  denyReason?: 'not_whitelisted' | 'paused' | 'ambiguous_account';
  linkedAccount: FirestoreUserRecord | null;
}

/**
 * Strictly verifies whether the incoming Telegram sender is authorized by the Admin Panel whitelist
 * and resolves ONLY that single sender's own UserAccount (1-to-1 isolation).
 * Never accepts unverified `/start <username>` arguments and never exposes other users' data.
 */
export function resolveTelegramAccess(
  accounts: FirestoreUserRecord[],
  tgConfig: FirestoreTelegramConfigRecord | null,
  chatId: string,
  tgUsername: string
): TelegramAccessResolution {
  const cleanChat = (chatId || '').trim();
  const cleanBare = (tgUsername || '').trim().replace(/^@/, '').toLowerCase();

  // 1. Check Admin's authorizedUsers registry (exact chatId or exact @username)
  const matchingAuthEntries = (tgConfig?.authorizedUsers || []).filter((a) => {
    const aChat = (a.chatId || '').trim();
    const aBare = (a.telegramUsername || '').trim().replace(/^@/, '').toLowerCase();
    const chatMatched = Boolean(aChat && cleanChat && aChat === cleanChat);
    const userMatched = Boolean(aBare && cleanBare && aBare === cleanBare);
    return chatMatched || userMatched;
  });

  // If ANY matching entry was explicitly paused/disabled by Admin, deny immediately
  if (matchingAuthEntries.some((a) => a.isActive === false)) {
    return { authorized: false, denyReason: 'paused', linkedAccount: null };
  }

  const activeAuthEntry = matchingAuthEntries.find((a) => a.isActive !== false);

  // 2. Check explicit Admin Whitelist handles
  const isInExplicitWhitelist =
    Boolean(cleanBare) &&
    (tgConfig?.whitelistedUsernames || []).some(
      (w) => (w || '').trim().replace(/^@/, '').toLowerCase() === cleanBare
    );

  // 3. Check primary Admin Chat ID fallback
  const isPrimaryAdminChat =
    Boolean(tgConfig?.chatId?.trim()) && tgConfig!.chatId!.trim() === cleanChat;

  // 4. Optional Auto-Sync Profiles (ONLY when Admin explicitly enabled autoSyncProfiles === true)
  const matchingProfileByHandle = cleanBare
    ? accounts.filter(
        (u) => (u.telegramUsername || '').trim().replace(/^@/, '').toLowerCase() === cleanBare
      )
    : [];
  const isProfileAutoAllowed =
    tgConfig?.autoSyncProfiles === true && matchingProfileByHandle.length > 0;

  if (!activeAuthEntry && !isInExplicitWhitelist && !isPrimaryAdminChat && !isProfileAutoAllowed) {
    return { authorized: false, denyReason: 'not_whitelisted', linkedAccount: null };
  }

  // Gate 2: Resolve strictly 1-to-1 to ONLY this sender's own UserAccount
  // Priority A: Admin explicitly mapped `appUsername` on their authorizedUsers entry
  if (activeAuthEntry?.appUsername?.trim()) {
    const boundUsername = activeAuthEntry.appUsername.trim().toLowerCase();
    const boundAccount =
      accounts.find((u) => u.username.trim().toLowerCase() === boundUsername) || null;
    if (boundAccount) {
      return { authorized: true, linkedAccount: boundAccount };
    }
  }

  // Priority B: Exact Chat ID match on UserAccount (must be unique to prevent cross-user sharing)
  const byChatMatches = cleanChat
    ? accounts.filter((u) => (u.telegramChatId || '').trim() === cleanChat)
    : [];
  if (byChatMatches.length > 1) {
    return { authorized: true, denyReason: 'ambiguous_account', linkedAccount: null };
  }
  if (byChatMatches.length === 1) {
    return { authorized: true, linkedAccount: byChatMatches[0] };
  }

  // Priority C: Exact @telegramUsername match on UserAccount (provided it isn't bound to a different Chat ID)
  const byHandleMatches = matchingProfileByHandle.filter((u) => {
    const boundChat = (u.telegramChatId || '').trim();
    return !boundChat || boundChat === cleanChat;
  });
  if (byHandleMatches.length > 1) {
    return { authorized: true, denyReason: 'ambiguous_account', linkedAccount: null };
  }
  if (byHandleMatches.length === 1) {
    return { authorized: true, linkedAccount: byHandleMatches[0] };
  }

  return { authorized: true, linkedAccount: null };
}

export async function buildTelegramCommandReply(params: {
  chatId: string;
  tgUsername: string;
  firstName: string;
  text: string;
}): Promise<string> {
  const { chatId, tgUsername, firstName, text } = params;
  const { command, rawLower } = normalizeCommandText(text);
  const safeName = escapeHtml(firstName || 'Athlete');
  const safeHandle = tgUsername ? `<code>${escapeHtml(tgUsername)}</code>` : 'No @username';

  // Fetch whitelist config, member accounts, and workout plans from Firestore
  const [tgConfig, accounts, allPlans] = await Promise.all([
    fetchFirestoreTelegramConfig().catch(() => null),
    fetchFirestoreUserAccounts().catch(() => []),
    fetchFirestoreWorkoutPlans().catch(() => []),
  ]);

  const access = resolveTelegramAccess(accounts, tgConfig, chatId, tgUsername);

  // STRICT WHITELIST GATE: Unauthorized or paused senders get ZERO user/workout data
  if (!access.authorized) {
    if (command === 'id' || command === 'chatid') {
      return (
        `🆔 <b>Your Telegram Credentials</b>\n\n` +
        `• <b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>\n` +
        `• <b>Username:</b> ${safeHandle}\n` +
        `• <b>Access Status:</b> ${
          access.denyReason === 'paused'
            ? 'Paused by Admin ⏸️'
            : 'Not on Admin Whitelist 🔒'
        }\n\n` +
        `Share your @username or Chat ID above with the Admin to request whitelist access in <b>Admin Panel → Telegram Bot</b>.`
      );
    }

    return (
      `🔒 <b>Access Restricted — Not Whitelisted</b>\n\n` +
      `Hello <b>${safeName}</b> (${safeHandle}),\n` +
      `• <b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>\n\n` +
      (access.denyReason === 'paused'
        ? `Your Telegram bot access is currently <b>paused by the Admin</b>.\n\n`
        : `Your Telegram account is <b>not on the Gym Workout Telegram Whitelist</b>.\n\n`) +
      `For privacy, workout plans and member profiles are only accessible to whitelisted users. ` +
      `Ask your Coach/Admin to add your @username in <b>Admin Panel → Telegram Bot → Authorized Users &amp; Whitelist</b>.`
    );
  }

  // Strictly isolate workout plans to ONLY the verified sender's own UserAccount
  const linkedAccount = access.linkedAccount;
  const memberPlans = linkedAccount
    ? allPlans.filter(
        (p) => (p.ownerUsername || '').trim().toLowerCase() === linkedAccount.username.trim().toLowerCase()
      )
    : [];

  const memberLabel = linkedAccount
    ? escapeHtml(linkedAccount.displayName?.trim() || linkedAccount.username)
    : '';

  if (
    access.denyReason === 'ambiguous_account' &&
    command !== 'id' &&
    command !== 'chatid' &&
    command !== 'help' &&
    command !== 'commands'
  ) {
    return (
      `⚠️ <b>Account Link Ambiguous</b>\n\n` +
      `Multiple Gym Workout profiles reference the same Telegram @username or Chat ID.\n` +
      `To protect user privacy, please ask your Admin to explicitly select your <b>Linked App Profile</b> in <b>Admin Panel → Telegram Bot</b>.`
    );
  }

  // 1. /id or /chatid — ALWAYS checked BEFORE /start & /confirm so it is never shadowed
  if (command === 'id' || command === 'chatid') {
    return (
      `🆔 <b>Your Telegram Credentials</b>\n\n` +
      `• <b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>\n` +
      `• <b>Username:</b> ${safeHandle}\n` +
      (linkedAccount
        ? `• <b>Linked Gym Workout Profile:</b> <b>${memberLabel}</b> (<code>${escapeHtml(linkedAccount.username)}</code>) 🟢\n\n`
        : `• <b>Whitelist Status:</b> Whitelisted 🟢 (Profile not linked yet)\n\n` +
          `Paste this Chat ID into <b>Gym Workout → Profile → Telegram Bot</b> (or ask your Admin to bind your App Profile).\n\n`) +
      `<i>Tip: Tap the Chat ID above to copy it instantly.</i>`
    );
  }

  // 2. /help or /commands
  if (command === 'help' || command === 'commands') {
    return (
      `🏋️ <b>Gym Workout Bot — Available Commands</b>\n\n` +
      `• <code>/start</code> or <code>/confirm</code> — Confirm access &amp; link alerts\n` +
      `• <code>/id</code> or <code>/chatid</code> — Show your Telegram Chat ID\n` +
      `• <code>/status</code> — Check bot connection &amp; alert settings\n` +
      `• <code>/workouts</code> — View your assigned workout plans\n` +
      `• <code>/progress</code> — View your weekly training progress\n` +
      `• <code>/pdf</code> — Download your workout sheet as a PDF file 📄\n` +
      `• <code>/excel</code> — Download your workout sheet as an Excel (.xlsx) file 📊\n` +
      `• <code>/water</code> — Check water intake goal &amp; hydration reminder 💧\n` +
      `• <code>/help</code> — Show this command reference\n\n` +
      `<i>Tip: If you have multiple plans, send <code>/pdf 2</code> or <code>/excel 2</code> to pick a plan by number!</i>`
    );
  }

  // 3. /status
  if (command === 'status') {
    const notificationsOn = linkedAccount
      ? linkedAccount.telegramNotificationsEnabled !== false
      : true;
    return (
      `📊 <b>Gym Workout Bot Status</b>\n\n` +
      `• <b>Telegram User:</b> ${safeName} (${safeHandle})\n` +
      `• <b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>\n` +
      `• <b>Whitelist Access:</b> Authorized 🟢\n` +
      `• <b>Account Link:</b> ${
        linkedAccount
          ? `Linked to <b>${memberLabel}</b> (<code>${escapeHtml(linkedAccount.username)}</code>) 🟢`
          : `Not linked to a member profile yet 🟡`
      }\n` +
      `• <b>Notifications:</b> ${notificationsOn ? 'Enabled 🔔' : 'Paused 🔕'}\n` +
      `• <b>Your Assigned Plans:</b> <b>${memberPlans.length}</b>\n` +
      `• <b>Server Time:</b> <i>${escapeHtml(new Date().toLocaleString())}</i>`
    );
  }

  // 4. /water, /hydration, /drink
  if (command === 'water' || command === 'hydration' || command === 'drink') {
    if (!linkedAccount) {
      return (
        `💧 <b>Hydration Reminder — Gym Workout</b>\n\n` +
        `Link your Chat ID (<code>${escapeHtml(chatId)}</code>) in <b>Gym Workout → Profile → Telegram Bot</b> to track your daily glasses right here!\n\n` +
        `<i>Goal: Drink 8 glasses (~2–2.5L) daily and sip water between sets.</i>`
      );
    }

    const todayGlasses = getUserTodayWaterGlasses(linkedAccount) ?? 0;
    const goal = 8;
    const pct = Math.min(100, Math.round((todayGlasses / goal) * 100));
    const remaining = Math.max(0, goal - todayGlasses);

    return (
      `💧 <b>Water Intake Reminder — ${memberLabel}</b>\n\n` +
      `• <b>Today's Intake:</b> <b>${todayGlasses} / ${goal}</b> glasses\n` +
      `• <b>Daily Goal:</b> <code>${buildProgressBar(pct)}</code>\n` +
      (remaining > 0
        ? `• <b>Remaining:</b> ${remaining} more glass${remaining === 1 ? '' : 'es'} to hit today's goal! 🥤\n\n` +
          `<i>Time for a water break — grab a glass now and tap <b>+</b> on your Dashboard!</i>`
        : `• <b>Status:</b> Daily hydration target reached! 🎉 Great discipline!`)
    );
  }

  // 5. /workouts, /plan, /today
  if (command === 'workouts' || command === 'plan' || command === 'today') {
    if (!linkedAccount) {
      return (
        `🏋️ <b>My Workout Plans</b>\n\n` +
        `Your Telegram chat (<code>${escapeHtml(chatId)}</code>) is whitelisted 🟢, but not bound to your Gym Workout account yet.\n\n` +
        `To link your own profile:\n` +
        `1. Open <b>Gym Workout → Profile → Telegram Bot</b>\n` +
        `2. Save your Chat ID (<code>${escapeHtml(chatId)}</code>) or ask Admin to map your App Profile.\n` +
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

    const sortedPlans = [...memberPlans].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    const lines = sortedPlans.slice(0, 6).map((plan, idx) => {
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
      `🏋️ <b>Your Workouts — ${memberLabel}</b>\n\n` +
      lines.join('\n\n') +
      (sortedPlans.length > 6 ? `\n\n<i>…and ${sortedPlans.length - 6} more plans in the app.</i>` : '') +
      `\n\n<i>Send /pdf or /excel to download your workout sheet directly here, or /progress for stats.</i>`
    );
  }

  // 6. /progress or /stats
  if (command === 'progress' || command === 'stats') {
    if (!linkedAccount) {
      return (
        `📈 <b>Training Progress</b>\n\n` +
        `Link your Chat ID (<code>${escapeHtml(chatId)}</code>) in <b>Gym Workout → Profile → Telegram Bot</b> to view your personal workout stats!`
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

    const sortedPlans = [...memberPlans].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    const latest = sortedPlans[0];
    const latestStats = computePlanStats(latest);

    return (
      `📈 <b>Training Progress — ${memberLabel}</b>\n\n` +
      `• <b>Active Plans:</b> ${memberPlans.length}\n` +
      `• <b>Total Exercises:</b> ${totalExercises}\n` +
      `• <b>Overall Completion:</b>\n` +
      `  <code>${buildProgressBar(overallPct)}</code> (${totalDone}/${totalChecks} checks)\n\n` +
      `🔥 <b>Latest Plan: ${escapeHtml(latest.title)}</b>\n` +
      `  <code>${buildProgressBar(latestStats.pct)}</code> (${latestStats.weeks} weeks)\n\n` +
      `<i>Send /pdf or /excel to get your latest sheet right here!</i> 💪`
    );
  }

  // 7. /start, /confirm, /verify, /access, ok, yes, hi, hello (ONLY for whitelisted users)
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
      `✅ <b>Gym Workout Bot Connected!</b> 🏋️\n\n` +
      `Hello <b>${safeName}</b> (${safeHandle})!\n` +
      `• <b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>\n` +
      `• <b>Whitelist Status:</b> Authorized 🟢\n` +
      (linkedAccount
        ? `• <b>Member Account:</b> <b>${memberLabel}</b> (<code>${escapeHtml(linkedAccount.username)}</code>) 🟢\n` +
          `• <b>Your Workout Plans:</b> ${memberPlans.length} active\n\n` +
          `You will receive your workout reminders, water intake alerts, and security alerts right here.\n\n`
        : `\nYour Telegram handle is whitelisted! Save your Chat ID above in <b>Profile → Telegram Bot</b> (or ask your Admin to bind your App Profile) to access your workouts.\n\n`) +
      `<b>Quick Commands:</b>\n` +
      `• /workouts — View your workout plans\n` +
      `• /pdf — Receive your workout sheet as PDF\n` +
      `• /excel — Receive your workout sheet as Excel (.xlsx)\n` +
      `• /water — Check water intake &amp; hydration reminder\n` +
      `• /progress — Check weekly completion\n` +
      `• /status — Check alert status\n` +
      `• /id — Get your Chat ID\n` +
      `• /help — All commands`
    );
  }

  // 8. Default fallback for arbitrary text (whitelisted users only)
  return (
    `🏋️ <b>Gym Workout Bot</b>\n\n` +
    `Hello <b>${safeName}</b>! Your Chat ID is <code>${escapeHtml(chatId)}</code>.\n` +
    (linkedAccount
      ? `Linked account: <b>${memberLabel}</b>.\n\n`
      : `\nBind your account in <b>Profile → Telegram Bot</b>, or `) +
    `Send <code>/help</code> to see all commands (<code>/workouts</code>, <code>/pdf</code>, <code>/excel</code>, <code>/water</code>, <code>/progress</code>, <code>/status</code>).`
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
  const { command, args } = normalizeCommandText(text);

  // Intercept /pdf and /excel (/sheet, /xlsx) document export commands with identical whitelist + 1-to-1 isolation
  if (command === 'pdf' || command === 'excel' || command === 'xlsx' || command === 'sheet') {
    const [tgConfig, accounts, allPlans] = await Promise.all([
      fetchFirestoreTelegramConfig().catch(() => null),
      fetchFirestoreUserAccounts().catch(() => []),
      fetchFirestoreWorkoutPlans().catch(() => []),
    ]);

    const access = resolveTelegramAccess(accounts, tgConfig, chatId, tgUsername);

    const sendTextFallback = async (msgHtml: string) => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: msgHtml,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });
        const data: any = await res.json();
        return { replied: Boolean(res.ok && data?.ok), replyText: msgHtml };
      } catch (err: any) {
        return { replied: false, replyText: msgHtml, error: err?.message };
      }
    };

    if (!access.authorized) {
      const deniedMsg = await buildTelegramCommandReply({ chatId, tgUsername, firstName, text });
      return sendTextFallback(deniedMsg);
    }

    if (access.denyReason === 'ambiguous_account') {
      return sendTextFallback(
        `⚠️ <b>Account Link Ambiguous</b>\n\n` +
        `Multiple Gym Workout profiles reference the same Telegram @username or Chat ID.\n` +
        `To protect user privacy, please ask your Admin to explicitly bind your <b>Linked App Profile</b>.`
      );
    }

    const linkedAccount = access.linkedAccount;
    if (!linkedAccount) {
      return sendTextFallback(
        `📄 <b>Workout Sheet Export</b>\n\n` +
        `Your Telegram chat (<code>${escapeHtml(chatId)}</code>) is whitelisted 🟢, but not bound to a Gym Workout profile yet.\n\n` +
        `Save your Chat ID in <b>Gym Workout → Profile → Telegram Bot</b>, then send <code>/${command === 'pdf' ? 'pdf' : 'excel'}</code> again!`
      );
    }

    const memberPlans = allPlans.filter(
      (p) => (p.ownerUsername || '').trim().toLowerCase() === linkedAccount.username.trim().toLowerCase()
    );

    if (memberPlans.length === 0) {
      return sendTextFallback(
        `📄 <b>Workout Sheet Export</b>\n\n` +
        `No workout plans are assigned to <b>${escapeHtml(linkedAccount.displayName?.trim() || linkedAccount.username)}</b> yet.`
      );
    }

    const targetRec = pickMemberPlan(memberPlans, args);
    if (!targetRec) {
      return sendTextFallback('No matching workout plan found.');
    }

    const fullPlan = toFullWorkoutPlan(targetRec);
    const ownerName = linkedAccount.displayName?.trim() || linkedAccount.username;
    const waterGlasses = getUserTodayWaterGlasses(linkedAccount);
    const planHint =
      memberPlans.length > 1
        ? `\n<i>You have ${memberPlans.length} plans — send /${command === 'pdf' ? 'pdf' : 'excel'} 2 for the next plan.</i>`
        : '';

    try {
      if (command === 'pdf') {
        const { filename, buffer } = exportWorkoutPlanToPdfBuffer(fullPlan, { ownerName, waterGlasses });
        const caption =
          `📄 <b>${escapeHtml(fullPlan.title)}</b> (PDF)\n` +
          `Member: <b>${escapeHtml(ownerName)}</b> • ${fullPlan.exercises.length} exercises • ${fullPlan.weeks}w` +
          planHint;
        const sent = await sendTelegramDocument(token, chatId, buffer, filename, 'application/pdf', caption);
        if (!sent.ok) {
          return sendTextFallback(`⚠️ Failed to generate/send PDF: ${escapeHtml(sent.error || 'Unknown error')}`);
        }
        return { replied: true, replyText: `[PDF Sent: ${filename}]` };
      } else {
        const { filename, buffer } = await exportWorkoutPlanToExcelBuffer(fullPlan, { ownerName, waterGlasses });
        const caption =
          `📊 <b>${escapeHtml(fullPlan.title)}</b> (Excel .xlsx)\n` +
          `Includes Workout Plan, Set-by-Set History (RPE & Volume), Warm-up Tracker, Notes & Summary.` +
          planHint;
        const sent = await sendTelegramDocument(
          token,
          chatId,
          buffer,
          filename,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          caption
        );
        if (!sent.ok) {
          return sendTextFallback(`⚠️ Failed to generate/send Excel sheet: ${escapeHtml(sent.error || 'Unknown error')}`);
        }
        return { replied: true, replyText: `[Excel Sent: ${filename}]` };
      }
    } catch (exportErr: any) {
      return sendTextFallback(`⚠️ Could not export workout sheet: ${escapeHtml(exportErr?.message || 'Unknown error')}`);
    }
  }

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
