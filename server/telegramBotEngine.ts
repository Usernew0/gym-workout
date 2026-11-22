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
  { command: 'workout', description: 'View workout details, done & remaining weeks' },
  { command: 'workouts', description: 'View your assigned workout plans & weeks' },
  { command: 'progress', description: 'Check weekly completion, done & remaining weeks' },
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
    goalGlasses?: number;
    targetLiters?: number;
    updatedAt?: string;
    timezoneOffsetMinutes?: number;
    reminderEnabled?: boolean;
    reminderIntervalMinutes?: number;
  };
  bodyWeightHistory?: Array<{
    id?: string;
    date?: string;
    weight?: number;
    unit?: string;
    updatedAt?: string;
  }>;
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
  hasRpeColumn?: boolean;
  hasRirColumn?: boolean;
  warmupExercises?: any[];
  warmupLogs?: Record<string, Record<string, any>>;
  exercises: Array<{
    id?: string;
    day?: string;
    name?: string;
    sets?: string;
    reps?: string;
    targetRpe?: string;
    targetRir?: string;
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

export function escapeHtml(str: string): string {
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

function formatShortDate(iso?: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function countEntrySets(entry: any): number {
  if (!entry || typeof entry !== 'object') return 0;
  if (Array.isArray(entry.setEntries) && entry.setEntries.length > 0) {
    return entry.setEntries.filter(
      (s: any) =>
        s &&
        (String(s.weight || '').trim() !== '' ||
          String(s.reps || '').trim() !== '' ||
          String(s.rpe || '').trim() !== '' ||
          String(s.rir || '').trim() !== '')
    ).length;
  }
  if (String(entry.weight || '').trim() !== '' || String(entry.reps || '').trim() !== '') {
    return 1;
  }
  return 0;
}

export interface PlanRemainingWeekDetail {
  week: number;
  done: number;
  total: number;
  loggedSets: number;
  inProgress: boolean;
}

export interface PlanStatsSummary {
  done: number;
  total: number;
  pct: number;
  weeks: number;
  exerciseCount: number;
  days: string[];
  loggedWeeksCount: number;
  doneWeeks: number[];
  remainingWeeks: PlanRemainingWeekDetail[];
  currentFocusWeek: number;
  totalSetsLogged: number;
  warmupCount: number;
  notesCount: number;
  lastUpdatedLabel: string;
  dayBreakdown: Array<{
    day: string;
    total: number;
    doneInFocusWeek: number;
  }>;
}

export function computePlanStats(plan: FirestoreWorkoutPlanRecord): PlanStatsSummary {
  const weeks = Math.max(1, Number(plan.weeks) || 1);
  const exercises = Array.isArray(plan.exercises) ? plan.exercises : [];
  const exerciseCount = exercises.length;
  const exerciseIdSet = new Set(
    exercises.map((ex, idx) => ex?.id || `ex_${idx + 1}`)
  );
  const total = exerciseCount * weeks;
  const progress = plan.progress || {};
  const exerciseLogs = plan.exerciseLogs || {};

  let done = 0;
  let totalSetsLogged = 0;
  let loggedWeeksCount = 0;
  let notesCount = 0;
  const doneWeeks: number[] = [];
  const remainingWeeks: PlanRemainingWeekDetail[] = [];

  exercises.forEach((ex) => {
    if (typeof ex?.notes === 'string' && ex.notes.trim()) notesCount++;
  });
  if (typeof plan.instructions === 'string' && plan.instructions.trim()) notesCount++;

  for (let w = 1; w <= weeks; w++) {
    const wk = `w${w}`;
    const arr = Array.isArray(progress[wk]) ? progress[wk] : [];
    const doneSetInWeek = new Set(arr.filter((id) => typeof id === 'string'));
    const doneInWeek = exerciseCount > 0 ? doneSetInWeek.size : 0;
    done += doneInWeek;

    const wkLogs = exerciseLogs[wk] && typeof exerciseLogs[wk] === 'object' ? exerciseLogs[wk] : {};
    let wkLoggedSets = 0;
    let wkHasActivity = doneInWeek > 0;

    for (const [entryKey, entryVal] of Object.entries(wkLogs)) {
      if (entryKey.startsWith('__session_note__')) {
        if (entryVal && typeof entryVal.notes === 'string' && entryVal.notes.trim()) {
          notesCount++;
        }
        continue;
      }
      if (!exerciseIdSet.has(entryKey) && !exercises.some((e) => e.id === entryKey)) {
        // Still count custom/direct keys when ids are normalized cleanly
      }
      const setCount = countEntrySets(entryVal);
      if (setCount > 0) {
        wkLoggedSets += setCount;
        wkHasActivity = true;
      }
      if (entryVal && typeof entryVal.notes === 'string' && entryVal.notes.trim()) {
        notesCount++;
        wkHasActivity = true;
      }
    }

    totalSetsLogged += wkLoggedSets;
    if (wkHasActivity) loggedWeeksCount++;

    if (exerciseCount > 0 && doneInWeek >= exerciseCount) {
      doneWeeks.push(w);
    } else {
      remainingWeeks.push({
        week: w,
        done: doneInWeek,
        total: exerciseCount,
        loggedSets: wkLoggedSets,
        inProgress: doneInWeek > 0 || wkLoggedSets > 0,
      });
    }
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const daysSet = new Set<string>();
  exercises.forEach((ex) => {
    if (ex?.day && typeof ex.day === 'string' && ex.day.trim()) {
      daysSet.add(ex.day.trim());
    }
  });
  const days = Array.from(daysSet);

  const currentFocusWeek =
    remainingWeeks.length > 0 ? remainingWeeks[0].week : weeks;
  const focusDoneSet = new Set(
    Array.isArray(progress[`w${currentFocusWeek}`]) ? progress[`w${currentFocusWeek}`] : []
  );

  const dayMap = new Map<string, { total: number; doneInFocusWeek: number }>();
  exercises.forEach((ex, idx) => {
    const dayLabel = (ex?.day && typeof ex.day === 'string' && ex.day.trim()) || 'General';
    const exId = ex?.id || `ex_${idx + 1}`;
    const cur = dayMap.get(dayLabel) || { total: 0, doneInFocusWeek: 0 };
    cur.total += 1;
    if (focusDoneSet.has(exId)) cur.doneInFocusWeek += 1;
    dayMap.set(dayLabel, cur);
  });

  const dayBreakdown = Array.from(dayMap.entries()).map(([day, counts]) => ({
    day,
    total: counts.total,
    doneInFocusWeek: counts.doneInFocusWeek,
  }));

  const warmupCount = Array.isArray(plan.warmupExercises) ? plan.warmupExercises.length : 0;
  const lastUpdatedLabel = formatShortDate(plan.updatedAt || plan.createdAt);

  return {
    done,
    total,
    pct,
    weeks,
    exerciseCount,
    days,
    loggedWeeksCount,
    doneWeeks,
    remainingWeeks,
    currentFocusWeek,
    totalSetsLogged,
    warmupCount,
    notesCount,
    lastUpdatedLabel,
    dayBreakdown,
  };
}

export interface ServerWaterIntakeSnapshot {
  date: string;
  glasses: number;
  goalGlasses?: number;
  targetLiters?: number;
  updatedAt: string;
  timezoneOffsetMinutes?: number;
  reminderEnabled?: boolean;
  reminderIntervalMinutes?: number;
}

const serverWaterIntakeOverrides = new Map<string, ServerWaterIntakeSnapshot>();

export function hydrateServerWaterIntakeOverrides(
  mapObj?: Record<string, ServerWaterIntakeSnapshot> | null
) {
  if (!mapObj || typeof mapObj !== 'object') return;
  for (const [k, v] of Object.entries(mapObj)) {
    if (!v || typeof v !== 'object') continue;
    const key = k.trim().toLowerCase();
    if (!key) continue;
    const prev = serverWaterIntakeOverrides.get(key);
    const prevTs = prev?.updatedAt ? (Date.parse(prev.updatedAt) || 0) : 0;
    const nextTs = v.updatedAt ? (Date.parse(v.updatedAt) || 0) : 0;
    if (!prev || nextTs >= prevTs) {
      serverWaterIntakeOverrides.set(key, v);
    }
  }
}

export function upsertServerWaterIntakeOverride(
  username: string,
  snapshot: ServerWaterIntakeSnapshot
) {
  const key = (username || '').trim().toLowerCase();
  if (!key) return;
  const prev = serverWaterIntakeOverrides.get(key);
  const prevTs = prev?.updatedAt ? (Date.parse(prev.updatedAt) || 0) : 0;
  const nextTs = snapshot.updatedAt ? (Date.parse(snapshot.updatedAt) || 0) : Date.now();
  if (!prev || nextTs >= prevTs) {
    serverWaterIntakeOverrides.set(key, snapshot);
  }
}

export function exportServerWaterIntakeOverrides(): Record<string, ServerWaterIntakeSnapshot> {
  const out: Record<string, ServerWaterIntakeSnapshot> = {};
  for (const [k, v] of serverWaterIntakeOverrides.entries()) {
    out[k] = v;
  }
  return out;
}

export function resolveEffectiveUserWaterIntake(
  user: FirestoreUserRecord | null
): FirestoreUserRecord['waterIntake'] | undefined {
  if (!user) return undefined;
  const key = (user.username || '').trim().toLowerCase();
  const dbWater = user.waterIntake;
  const memWater = key ? serverWaterIntakeOverrides.get(key) : undefined;
  if (!dbWater && !memWater) return undefined;
  if (!dbWater) return memWater;
  if (!memWater) return dbWater;
  const dbTs = dbWater.updatedAt ? (Date.parse(dbWater.updatedAt) || 0) : 0;
  const memTs = memWater.updatedAt ? (Date.parse(memWater.updatedAt) || 0) : 0;
  return memTs >= dbTs ? { ...dbWater, ...memWater } : dbWater;
}

function formatDateKeyInOffset(nowMs: number, offsetMinutes: number): string {
  const shifted = new Date(nowMs + offsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function getTodayDateKey(offsetMinutes?: number): string {
  if (typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)) {
    return formatDateKeyInOffset(Date.now(), offsetMinutes);
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getUserTodayWaterGlasses(user: FirestoreUserRecord | null): number | undefined {
  const water = resolveEffectiveUserWaterIntake(user);
  if (!water) return undefined;
  const dateStr = (water.date || '').trim();
  if (dateStr) {
    if (typeof water.timezoneOffsetMinutes === 'number' && Number.isFinite(water.timezoneOffsetMinutes)) {
      const userToday = getTodayDateKey(water.timezoneOffsetMinutes);
      if (dateStr !== userToday) return 0;
    } else {
      const serverToday = getTodayDateKey();
      const utcToday = formatDateKeyInOffset(Date.now(), 0);
      const updatedMs = water.updatedAt ? (Date.parse(water.updatedAt) || 0) : 0;
      const recentlyUpdated = updatedMs > 0 && Date.now() - updatedMs < 14 * 3600_000;
      if (dateStr !== serverToday && dateStr !== utcToday && !recentlyUpdated) {
        return 0;
      }
    }
  }
  const n = Number(water.glasses);
  return Number.isFinite(n) && n >= 0 ? Math.min(40, Math.floor(n)) : undefined;
}

export function computeUserWaterGoal(user: FirestoreUserRecord | null): {
  goalGlasses: number;
  targetLiters: number;
} {
  const GLASS_LITERS = 0.25;
  const effectiveWater = resolveEffectiveUserWaterIntake(user);
  const explicitGoal = Number(effectiveWater?.goalGlasses);
  const explicitLiters = Number(effectiveWater?.targetLiters);

  if (Number.isFinite(explicitGoal) && explicitGoal >= 4 && explicitGoal <= 40) {
    const goalGlasses = Math.round(explicitGoal);
    const targetLiters =
      Number.isFinite(explicitLiters) && explicitLiters >= 0.5 && explicitLiters <= 10
        ? Number(explicitLiters.toFixed(1))
        : Number((goalGlasses * GLASS_LITERS).toFixed(1));
    return { goalGlasses, targetLiters };
  }

  const history = Array.isArray(user?.bodyWeightHistory) ? user.bodyWeightHistory : [];
  const validEntries = history
    .filter((entry) => entry && Number.isFinite(Number(entry.weight)) && Number(entry.weight) > 0)
    .sort((a, b) => {
      const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
      if (dateCmp !== 0) return dateCmp;
      return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
    });

  if (validEntries.length > 0) {
    const latest = validEntries[validEntries.length - 1];
    const rawWeight = Number(latest.weight);
    const weightKg = latest.unit === 'lbs' ? rawWeight * 0.45359237 : rawWeight;
    if (Number.isFinite(weightKg) && weightKg > 0) {
      const targetLiters = Math.min(6.0, Math.max(1.2, Math.round(weightKg * 0.035 * 10) / 10));
      const goalGlasses = Math.max(4, Math.round(targetLiters / GLASS_LITERS));
      return { goalGlasses, targetLiters };
    }
  }

  return { goalGlasses: 8, targetLiters: 2.0 };
}

export function formatWaterIntakeTelegramMessageHtml(
  memberName: string,
  glassesToday: number,
  goalGlasses = 8,
  note?: string,
  timezoneOffsetMinutes?: number,
  targetLiters?: number
): string {
  const safeGoal = Math.max(1, Math.round(goalGlasses || 8));
  const consumedLiters = Number((glassesToday * 0.25).toFixed(2));
  const resolvedTargetLiters =
    typeof targetLiters === 'number' && Number.isFinite(targetLiters) && targetLiters > 0
      ? Number(targetLiters.toFixed(2))
      : Number((safeGoal * 0.25).toFixed(2));
  const remaining = Math.max(0, safeGoal - glassesToday);
  const pct = Math.min(100, Math.round((glassesToday / safeGoal) * 100));
  const bar = buildProgressBar(pct);

  let timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (typeof timezoneOffsetMinutes === 'number' && Number.isFinite(timezoneOffsetMinutes)) {
    const shifted = new Date(Date.now() + timezoneOffsetMinutes * 60_000);
    const hrs24 = shifted.getUTCHours();
    const mins = shifted.getUTCMinutes();
    const ampm = hrs24 >= 12 ? 'PM' : 'AM';
    const hrs12 = hrs24 % 12 || 12;
    timeLabel = `${String(hrs12).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${ampm}`;
  }

  return (
    `💧 <b>Gym Workout — Water Intake Reminder</b>\n\n` +
    `Athlete: <b>${escapeHtml(memberName)}</b>\n` +
    `Today's Intake: <b>${glassesToday} / ${safeGoal}</b> glasses (<b>${consumedLiters} / ${resolvedTargetLiters} L</b>)\n` +
    `Progress: <code>${bar}</code>\n` +
    (remaining > 0
      ? `Remaining: <b>${remaining} glass${remaining === 1 ? '' : 'es'}</b> left for today's hydration target.\n`
      : `Daily hydration target reached! 🎉\n`) +
    (note ? `\n<i>${escapeHtml(note)}</i>\n` : '') +
    `\nTime: <i>${escapeHtml(timeLabel)}</i>`
  );
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
    ...(typeof rec.hasRpeColumn === 'boolean' ? { hasRpeColumn: rec.hasRpeColumn } : {}),
    ...(typeof rec.hasRirColumn === 'boolean' ? { hasRirColumn: rec.hasRirColumn } : {}),
    warmupExercises: Array.isArray(rec.warmupExercises) ? rec.warmupExercises : [],
    warmupLogs: rec.warmupLogs || {},
    exercises: (Array.isArray(rec.exercises) ? rec.exercises : []).map((ex, idx) => ({
      id: ex?.id || `ex_${idx + 1}`,
      name: ex?.name || `Exercise ${idx + 1}`,
      ...(ex?.day ? { day: ex.day } : {}),
      ...(ex?.sets ? { sets: ex.sets } : {}),
      ...(ex?.reps ? { reps: ex.reps } : {}),
      ...(ex?.targetRpe ? { targetRpe: ex.targetRpe } : {}),
      ...(ex?.targetRir ? { targetRir: ex.targetRir } : {}),
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
  const { command, args, rawLower } = normalizeCommandText(text);
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
      `• <code>/workout</code> or <code>/workouts</code> — View workout details, done &amp; remaining weeks\n` +
      `• <code>/progress</code> — View weekly completion, done &amp; remaining weeks\n` +
      `• <code>/pdf</code> — Download your workout sheet as a PDF file 📄\n` +
      `• <code>/excel</code> — Download your workout sheet as an Excel (.xlsx) file 📊\n` +
      `• <code>/water</code> — Check water intake goal &amp; hydration reminder 💧\n` +
      `• <code>/help</code> — Show this command reference\n\n` +
      `<i>Tip: Send <code>/workout 2</code>, <code>/pdf 2</code>, or <code>/excel 2</code> to focus on a specific workout plan!</i>`
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

    const effectiveWater = resolveEffectiveUserWaterIntake(linkedAccount);
    const mergedUser = { ...linkedAccount, waterIntake: effectiveWater };
    const todayGlasses = getUserTodayWaterGlasses(mergedUser) ?? 0;
    const { goalGlasses: goal, targetLiters } = computeUserWaterGoal(mergedUser);
    const note =
      todayGlasses >= goal
        ? 'Great work staying hydrated!'
        : 'Time for a water break — grab a glass now and tap + on your Dashboard!';
    return formatWaterIntakeTelegramMessageHtml(
      linkedAccount.displayName?.trim() || linkedAccount.username,
      todayGlasses,
      goal,
      note,
      effectiveWater?.timezoneOffsetMinutes,
      targetLiters
    );
  }

  // 5. /workout, /workouts, /plan, /today
  if (command === 'workout' || command === 'workouts' || command === 'plan' || command === 'today') {
    if (!linkedAccount) {
      return (
        `🏋️ <b>My Workout Plans</b>\n\n` +
        `Your Telegram chat (<code>${escapeHtml(chatId)}</code>) is whitelisted 🟢, but not bound to your Gym Workout account yet.\n\n` +
        `To link your own profile:\n` +
        `1. Open <b>Gym Workout → Profile → Telegram Bot</b>\n` +
        `2. Save your Chat ID (<code>${escapeHtml(chatId)}</code>) or ask Admin to map your App Profile.\n` +
        `Then send <code>/workout</code> again! 💪`
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

    const formatWeekTags = (stats: PlanStatsSummary) => {
      const doneText =
        stats.doneWeeks.length > 0
          ? stats.doneWeeks.map((w) => `W${w}`).join(', ')
          : 'None yet';
      const remText =
        stats.remainingWeeks.length > 0
          ? stats.remainingWeeks
              .map((rw) => {
                if (rw.inProgress) {
                  return `W${rw.week} (${rw.done}/${rw.total}${rw.loggedSets > 0 ? ` • ${rw.loggedSets} sets` : ''})`;
                }
                return `W${rw.week}`;
              })
              .join(', ')
          : 'All weeks finished! 🎉';
      return { doneText, remText };
    };

    const formatPlanDetailBlock = (plan: FirestoreWorkoutPlanRecord, idxNum: number, includeDayBreakdown: boolean) => {
      const stats = computePlanStats(plan);
      const { doneText, remText } = formatWeekTags(stats);
      const unitLabel = (plan.defaultWeightUnit || 'kg').toUpperCase();
      const dayText =
        stats.days.length > 0
          ? `\n   • <b>Split / Days:</b> ${stats.days.slice(0, 6).map(escapeHtml).join(', ')}${stats.days.length > 6 ? '…' : ''}`
          : '';
      const metaParts = [
        `${stats.weeks}w`,
        `${stats.exerciseCount} exercises`,
        unitLabel,
        stats.warmupCount > 0 ? `${stats.warmupCount} warm-ups` : '',
        stats.notesCount > 0 ? `${stats.notesCount} notes` : '',
      ].filter(Boolean);

      const dayLines =
        includeDayBreakdown && stats.dayBreakdown.length > 0
          ? `\n   • <b>Week ${stats.currentFocusWeek} Focus Breakdown:</b>\n` +
            stats.dayBreakdown
              .slice(0, 8)
              .map(
                (db) =>
                  `      ◦ ${escapeHtml(db.day)}: <b>${db.doneInFocusWeek}/${db.total}</b> exercises`
              )
              .join('\n')
          : '';

      return (
        `<b>${idxNum}. ${escapeHtml(plan.title)}</b>\n` +
        `   ${metaParts.join(' • ')}${stats.lastUpdatedLabel ? ` • Updated ${escapeHtml(stats.lastUpdatedLabel)}` : ''}` +
        dayText +
        `\n   • <b>Overall:</b> <code>${buildProgressBar(stats.pct)}</code> (${stats.done}/${stats.total} checks • ${stats.totalSetsLogged} sets logged)` +
        `\n   • ✅ <b>Done Weeks (${stats.doneWeeks.length}/${stats.weeks}):</b> ${doneText}` +
        `\n   • ⏳ <b>Remaining Weeks (${stats.remainingWeeks.length}/${stats.weeks}):</b> ${remText}` +
        dayLines
      );
    };

    // Detailed single-plan mode when user sends `/workout 2`, `/workout push`, or has only 1 plan
    if (args.trim() || sortedPlans.length === 1) {
      const picked = args.trim() ? pickMemberPlan(sortedPlans, args) : sortedPlans[0];
      if (picked) {
        const pickedIndex = Math.max(0, sortedPlans.findIndex((p) => p.id === picked.id));
        const detailBlock = formatPlanDetailBlock(picked, pickedIndex + 1, true);
        const otherHint =
          sortedPlans.length > 1
            ? `\n\n<i>Showing plan ${pickedIndex + 1} of ${sortedPlans.length}. Send <code>/workouts</code> to see all plans or <code>/workout 2</code> to switch.</i>`
            : '';
        return (
          `🏋️ <b>Workout Details — ${memberLabel}</b>\n\n` +
          detailBlock +
          otherHint +
          `\n\n<i>Send <code>/pdf${pickedIndex > 0 ? ` ${pickedIndex + 1}` : ''}</code> or <code>/excel${pickedIndex > 0 ? ` ${pickedIndex + 1}` : ''}</code> to download this sheet, or <code>/progress</code> for full stats.</i>`
        );
      }
    }

    const lines = sortedPlans.slice(0, 5).map((plan, idx) =>
      formatPlanDetailBlock(plan, idx + 1, idx === 0)
    );

    return (
      `🏋️ <b>Your Workouts — ${memberLabel}</b>\n\n` +
      lines.join('\n\n') +
      (sortedPlans.length > 5 ? `\n\n<i>…and ${sortedPlans.length - 5} more plans in the app.</i>` : '') +
      `\n\n<i>Tip: Send <code>/workout 1</code> for focused breakdown, <code>/pdf</code> or <code>/excel</code> to download, or <code>/progress</code> for stats.</i>`
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
    let totalSets = 0;
    let totalWeeksAll = 0;
    let totalDoneWeeksAll = 0;
    let totalRemainingWeeksAll = 0;

    memberPlans.forEach((p) => {
      const s = computePlanStats(p);
      totalDone += s.done;
      totalChecks += s.total;
      totalExercises += s.exerciseCount;
      totalSets += s.totalSetsLogged;
      totalWeeksAll += s.weeks;
      totalDoneWeeksAll += s.doneWeeks.length;
      totalRemainingWeeksAll += s.remainingWeeks.length;
    });
    const overallPct = totalChecks > 0 ? Math.round((totalDone / totalChecks) * 100) : 0;

    const sortedPlans = [...memberPlans].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    const latest = sortedPlans[0];
    const latestStats = computePlanStats(latest);
    const latestDoneWeeksText =
      latestStats.doneWeeks.length > 0
        ? latestStats.doneWeeks.map((w) => `W${w}`).join(', ')
        : 'None yet';
    const latestRemainingWeeksText =
      latestStats.remainingWeeks.length > 0
        ? latestStats.remainingWeeks
            .map((rw) => (rw.inProgress ? `W${rw.week} (${rw.done}/${rw.total})` : `W${rw.week}`))
            .join(', ')
        : 'Completed 🎉';

    return (
      `📈 <b>Training Progress — ${memberLabel}</b>\n\n` +
      `• <b>Active Plans:</b> ${memberPlans.length}\n` +
      `• <b>Total Exercises:</b> ${totalExercises} • <b>Total Sets Logged:</b> ${totalSets}\n` +
      `• <b>Program Weeks Summary:</b> ✅ <b>${totalDoneWeeksAll}</b> done / ⏳ <b>${totalRemainingWeeksAll}</b> remaining (of ${totalWeeksAll}w)\n` +
      `• <b>Overall Completion:</b>\n` +
      `  <code>${buildProgressBar(overallPct)}</code> (${totalDone}/${totalChecks} checks)\n\n` +
      `🔥 <b>Latest Plan: ${escapeHtml(latest.title)}</b>\n` +
      `  <code>${buildProgressBar(latestStats.pct)}</code> (${latestStats.weeks}w • ${latestStats.totalSetsLogged} sets)\n` +
      `  • ✅ <b>Done Weeks:</b> ${latestDoneWeeksText}\n` +
      `  • ⏳ <b>Remaining Weeks:</b> ${latestRemainingWeeksText}\n\n` +
      `<i>Send <code>/workout</code> for full week breakdown or <code>/pdf</code> / <code>/excel</code> for your latest sheet!</i> 💪`
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
      `• /workout — View workout details, done &amp; remaining weeks\n` +
      `• /workouts — View all assigned workout plans\n` +
      `• /progress — Check weekly completion &amp; remaining weeks\n` +
      `• /pdf — Receive your workout sheet as PDF\n` +
      `• /excel — Receive your workout sheet as Excel (.xlsx)\n` +
      `• /water — Check water intake &amp; hydration reminder\n` +
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
    `Send <code>/help</code> to see all commands (<code>/workout</code>, <code>/workouts</code>, <code>/pdf</code>, <code>/excel</code>, <code>/water</code>, <code>/progress</code>, <code>/status</code>).`
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
    const { goalGlasses: waterGoalGlasses, targetLiters: waterTargetLiters } =
      computeUserWaterGoal(linkedAccount);
    const planHint =
      memberPlans.length > 1
        ? `\n<i>You have ${memberPlans.length} plans — send /${command === 'pdf' ? 'pdf' : 'excel'} 2 for the next plan.</i>`
        : '';

    try {
      if (command === 'pdf') {
        const { filename, buffer } = exportWorkoutPlanToPdfBuffer(fullPlan, {
          ownerName,
          waterGlasses,
          waterGoalGlasses,
          waterTargetLiters,
        });
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
          `Includes Workout Plan, Daily Analytics, Set-by-Set History, Warm-up Tracker &amp; Notes.` +
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
