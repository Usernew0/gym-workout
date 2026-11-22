import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import confetti from 'canvas-confetti';
import {
  Dumbbell, LayoutDashboard, ListChecks, Upload, TrendingUp, LogOut,
  Play, Pause, CheckCircle2, Circle, Video, Flame, CalendarDays,
  Trash2, Trophy, FileText, History, Check, X, ExternalLink,
  ChevronDown, ChevronUp, Plus, Minus, Zap, Pencil,
  FileSpreadsheet, Maximize2, ShieldCheck, Loader2, Download,
  User, KeyRound, Eye, EyeOff, Send, ShieldAlert, AlertCircle, Bell,
  Droplets, RotateCcw, Clock, Timer, Volume2, Scale, Image as ImageIcon, Layers
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import {
  WorkoutPlan, WorkoutExercise, ExerciseLogEntry, SetLogEntry, WeightUnit,
  UserAccount, AdminSetting, WarmupExercise, WarmupLogEntry, BodyWeightEntry
} from '../../types';
import {
  subscribeToWorkoutPlans,
  saveWorkoutPlanDoc,
  deleteWorkoutPlanDoc,
  mergeUpdatedWorksheetIntoPlan,
  planHasRpeColumn,
  planHasRirColumn,
} from '../../lib/gymService';
import { saveUserAccountDoc, saveAdminSettingDoc, logActivity, getFirestoreUserAccounts } from '../../lib/syncService';
import { hashPassword, verifyPassword } from '../../utils/crypto';
import {
  getTelegramConfig,
  saveTelegramConfig as persistTelegramConfig,
  fetchTelegramChatIdsDetailed,
  sendDirectTelegramMessage,
  sendTelegramAlert,
  sendTelegramDocumentFile,
  formatSecurityAlertTelegramMessage,
  formatWaterIntakeTelegramMessage,
} from '../../lib/telegramService';
import {
  getVideoThumbnailInfo,
  parseSetsCount,
  splitSetsAndReps,
  parseSheetFileAllSheets,
  consolidateMultiTabWorkoutSheets,
  normalizeExerciseMatchKey,
  ParsedWeekData,
} from '../../lib/sheetParser';
import { exportWorkoutPlanToPdf, exportWorkoutPlanToPdfBuffer, exportAllWorkoutPlansToPdf } from '../../lib/workoutPdfExport';
import { exportWorkoutPlanToExcel, exportWorkoutPlanToExcelBuffer, exportAllWorkoutPlansToExcel } from '../../lib/workoutExcelExport';
import { TwoFactorSetupModal } from '../TwoFactorSetupModal';
import { SheetUploader } from './SheetUploader';

interface GymAppProps {
  currentUser: string;
  userAccounts?: UserAccount[];
  adminSettings?: AdminSetting[];
  onLogout: () => void;
}

type GymTab = 'dashboard' | 'workouts' | 'weight' | 'upload' | 'progress' | 'profile';

const GYM_TABS: { id: GymTab; label: string;  short: string; icon: React.ComponentType<{ className?: string }>; }[] = [
  { id: 'dashboard', label: 'Dashboard',    short: 'Home',     icon: LayoutDashboard },
  { id: 'workouts',  label: 'My Workouts',  short: 'Workouts', icon: ListChecks },
  { id: 'weight',    label: 'Body Weight',  short: 'Weight',   icon: Scale },
  { id: 'upload',    label: 'Upload Sheet', short: 'Upload',   icon: Upload },
  { id: 'progress',  label: 'Progress',     short: 'Progress', icon: TrendingUp },
  { id: 'profile',   label: 'Profile',      short: 'Profile',  icon: User },
];

const weekKey = (weekIdx: number) => `w${weekIdx + 1}`;
const SESSION_NOTE_KEY_PREFIX = '__session_note__';
const WATER_DAILY_GOAL = 8;
const WATER_REMINDER_PRESETS = [5, 10, 15, 30, 45, 60, 90] as const;
const EXERCISE_MOTIVATIONS = [
  'All sets crushed — great discipline!',
  'Target locked in — strong finish!',
  'Full set volume logged — keep pushing!',
  'Exercise complete — unstoppable momentum!',
];

type RestSoundType = 'chime' | 'bell' | 'beep' | 'gong' | 'fanfare' | 'silent';

const REST_SOUND_OPTIONS: { id: RestSoundType; label: string }[] = [
  { id: 'chime', label: 'Harmonic Chime' },
  { id: 'bell', label: 'Boxing Bell' },
  { id: 'beep', label: 'Digital Beep' },
  { id: 'gong', label: 'Zen Gong' },
  { id: 'fanfare', label: 'Power Fanfare' },
  { id: 'silent', label: 'Silent (Visual/Vibrate)' },
];

interface ActiveRestTimerState {
  timerKey: string;
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  remainingSec: number;
  totalSec: number;
  endAtMs?: number;
  running: boolean;
  finished?: boolean;
}

function getSessionNoteKey(dayFilter: string): string {
  if (!dayFilter || dayFilter === 'ALL') return `${SESSION_NOTE_KEY_PREFIX}ALL`;
  return `${SESSION_NOTE_KEY_PREFIX}${dayFilter.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_')}`;
}

function getTodayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getWaterStorageKey(username: string): string {
  return `gymworkout_water_${(username || 'member').toLowerCase().trim()}_${getTodayDateKey()}`;
}

function getWaterReminderStorageKey(username: string): string {
  return `gymworkout_water_reminder_${(username || 'member').toLowerCase().trim()}`;
}

function readStoredWaterReminder(username: string): { enabled: boolean; intervalMinutes: number; updatedAt: number } {
  try {
    const raw = localStorage.getItem(getWaterReminderStorageKey(username));
    if (!raw) return { enabled: false, intervalMinutes: 30, updatedAt: 0 };
    const parsed = JSON.parse(raw);
    const interval = Math.round(Number(parsed?.intervalMinutes));
    const updatedAt = Number(parsed?.updatedAt) || 0;
    return {
      enabled: Boolean(parsed?.enabled),
      intervalMinutes: Number.isFinite(interval) && interval >= 1 && interval <= 1440 ? interval : 30,
      updatedAt,
    };
  } catch {
    return { enabled: false, intervalMinutes: 30, updatedAt: 0 };
  }
}

function saveStoredWaterReminder(username: string, enabled: boolean, intervalMinutes: number) {
  try {
    const clamped = Math.min(1440, Math.max(1, Math.round(intervalMinutes || 30)));
    localStorage.setItem(
      getWaterReminderStorageKey(username),
      JSON.stringify({ enabled, intervalMinutes: clamped, updatedAt: Date.now() })
    );
  } catch {
    // ignore storage errors
  }
}

function getBodyWeightStorageKey(username: string): string {
  return `gymworkout_body_weight_${(username || 'member').toLowerCase().trim()}`;
}

function readStoredBodyWeight(username: string): { updatedAt: number; entries: BodyWeightEntry[] } {
  try {
    const raw = localStorage.getItem(getBodyWeightStorageKey(username));
    if (!raw) return { updatedAt: 0, entries: [] };
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
    const normalized = list
      .filter((item: any) => item && item.date && Number.isFinite(Number(item.weight)) && Number(item.weight) > 0)
      .map((item: any) => ({
        id: String(item.id || `bw_${item.date}`),
        date: String(item.date),
        weight: Number(item.weight),
        unit: (item.unit === 'lbs' ? 'lbs' : 'kg') as WeightUnit,
        ...(item.note ? { note: String(item.note) } : {}),
        ...(item.updatedAt ? { updatedAt: String(item.updatedAt) } : {}),
      }))
      .sort((a: BodyWeightEntry, b: BodyWeightEntry) => a.date.localeCompare(b.date));
    return {
      updatedAt: Number(parsed?.updatedAt) || 0,
      entries: normalized,
    };
  } catch {
    return { updatedAt: 0, entries: [] };
  }
}

function saveStoredBodyWeight(username: string, entries: BodyWeightEntry[]) {
  try {
    localStorage.setItem(
      getBodyWeightStorageKey(username),
      JSON.stringify({ updatedAt: Date.now(), entries })
    );
  } catch {
    // ignore storage errors
  }
}

const MAX_BG_DATA_URL_CHARS = 420_000;

export function getUserBgSettingId(username: string): string {
  const clean = (username || 'member').trim().toLowerCase();
  const slug = clean.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'user';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash * 31) + clean.charCodeAt(i)) >>> 0;
  }
  const suffix = hash.toString(36);
  const raw = `userBg_${slug}_${suffix}`;
  return raw.slice(0, 128);
}

function computeWaterGoalFromBodyWeightEntries(entries: BodyWeightEntry[]): {
  hasWeight: boolean;
  weightDisplay: string;
  weightKg: number | null;
  targetLiters: number;
  targetGlasses: number;
} {
  const GLASS_LITERS = 0.25;
  if (entries && entries.length > 0) {
    const sorted = [...entries].sort((a, b) => {
      const dCmp = a.date.localeCompare(b.date);
      if (dCmp !== 0) return dCmp;
      return (a.updatedAt || '').localeCompare(b.updatedAt || '');
    });
    const latest = sorted[sorted.length - 1];
    const weightKgRaw = latest.unit === 'lbs' ? latest.weight * 0.45359237 : latest.weight;
    const weightKg = Math.round(weightKgRaw * 10) / 10;
    if (Number.isFinite(weightKg) && weightKg > 0) {
      const targetLiters = Math.min(6.0, Math.max(1.2, Math.round(weightKg * 0.035 * 10) / 10));
      const targetGlasses = Math.max(4, Math.round(targetLiters / GLASS_LITERS));
      return {
        hasWeight: true,
        weightDisplay: `${latest.weight} ${latest.unit}`,
        weightKg,
        targetLiters,
        targetGlasses,
      };
    }
  }
  const defaultLiters = Number((WATER_DAILY_GOAL * GLASS_LITERS).toFixed(1));
  return {
    hasWeight: false,
    weightDisplay: '',
    weightKg: null,
    targetLiters: defaultLiters,
    targetGlasses: WATER_DAILY_GOAL,
  };
}

function getUserBgStorageKey(username: string): string {
  return `gymworkout_bg_${(username || 'member').toLowerCase().trim()}`;
}

function readStoredUserBg(username: string): { imageUrl: string; dimPercent: number } {
  try {
    const raw = localStorage.getItem(getUserBgStorageKey(username));
    if (!raw) return { imageUrl: '', dimPercent: 72 };
    const parsed = JSON.parse(raw);
    const dim = Number(parsed?.dimPercent);
    return {
      imageUrl: typeof parsed?.imageUrl === 'string' ? parsed.imageUrl : '',
      dimPercent: Number.isFinite(dim) && dim >= 20 && dim <= 95 ? Math.round(dim) : 72,
    };
  } catch {
    return { imageUrl: '', dimPercent: 72 };
  }
}

function saveStoredUserBg(username: string, imageUrl: string, dimPercent: number) {
  try {
    if (!imageUrl) {
      localStorage.removeItem(getUserBgStorageKey(username));
      return;
    }
    localStorage.setItem(
      getUserBgStorageKey(username),
      JSON.stringify({ imageUrl, dimPercent })
    );
  } catch {
    // ignore storage errors
  }
}

async function compressBackgroundImageToDataUrl(file: File): Promise<string> {
  const rawDataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  // Preserve animated GIFs only when safely within Firestore 1 MiB doc limit
  if (file.type === 'image/gif' && rawDataUrl.length <= MAX_BG_DATA_URL_CHARS) {
    return rawDataUrl;
  }

  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const steps: Array<{ maxDim: number; quality: number }> = [
        { maxDim: 1600, quality: 0.82 },
        { maxDim: 1280, quality: 0.72 },
        { maxDim: 1024, quality: 0.62 },
        { maxDim: 800, quality: 0.52 },
        { maxDim: 640, quality: 0.44 },
      ];
      const preferredMime = file.type === 'image/png' ? 'image/webp' : 'image/jpeg';
      let bestEncoded = '';

      for (const step of steps) {
        let width = img.width || 1280;
        let height = img.height || 720;
        if (width > step.maxDim || height > step.maxDim) {
          const scale = Math.min(step.maxDim / width, step.maxDim / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) break;
        ctx.drawImage(img, 0, 0, width, height);

        let encoded = canvas.toDataURL(preferredMime, step.quality);
        if (!encoded.startsWith('data:image/')) {
          encoded = canvas.toDataURL('image/jpeg', step.quality);
        }
        bestEncoded = encoded;
        if (encoded.length <= MAX_BG_DATA_URL_CHARS) {
          resolve(encoded);
          return;
        }
      }

      if (bestEncoded && bestEncoded.length <= 750_000) {
        resolve(bestEncoded);
        return;
      }
      if (rawDataUrl.length <= MAX_BG_DATA_URL_CHARS) {
        resolve(rawDataUrl);
        return;
      }
      reject(new Error('Image is too large after optimization. Please choose a smaller image.'));
    };
    img.onerror = () => {
      if (rawDataUrl.length <= MAX_BG_DATA_URL_CHARS) {
        resolve(rawDataUrl);
      } else {
        reject(new Error('Unable to process this image format in your browser.'));
      }
    };
    img.src = rawDataUrl;
  });
}

function formatTimerClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const REST_TIMER_PRESETS = [45, 60, 90, 120, 180] as const;

function getRestTimerStorageKey(username: string): string {
  return `gymworkout_rest_sec_${(username || 'member').toLowerCase().trim()}`;
}

function getRestSoundStorageKey(username: string): string {
  return `gymworkout_rest_sound_${(username || 'member').toLowerCase().trim()}`;
}

function getActiveRestTimerStorageKey(username: string): string {
  return `gymworkout_active_rest_${(username || 'member').toLowerCase().trim()}`;
}

function readStoredRestSeconds(username: string): number {
  try {
    const raw = localStorage.getItem(getRestTimerStorageKey(username));
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 600) {
      return Math.round(parsed);
    }
    return 90;
  } catch {
    return 90;
  }
}

function saveStoredRestSeconds(username: string, seconds: number) {
  try {
    const clamped = Math.min(600, Math.max(10, Math.round(seconds)));
    localStorage.setItem(getRestTimerStorageKey(username), String(clamped));
  } catch {
    // ignore storage errors
  }
}

function readStoredRestSound(username: string): RestSoundType {
  try {
    const raw = localStorage.getItem(getRestSoundStorageKey(username)) as RestSoundType | null;
    if (raw && REST_SOUND_OPTIONS.some(o => o.id === raw)) return raw;
    return 'chime';
  } catch {
    return 'chime';
  }
}

function saveStoredRestSound(username: string, sound: RestSoundType) {
  try {
    localStorage.setItem(getRestSoundStorageKey(username), sound);
  } catch {
    // ignore storage errors
  }
}

function readStoredActiveRestTimer(username: string): ActiveRestTimerState | null {
  try {
    const raw = localStorage.getItem(getActiveRestTimerStorageKey(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveRestTimerState;
    if (!parsed || !parsed.timerKey) return null;
    if (parsed.running && parsed.endAtMs) {
      const rem = Math.ceil((parsed.endAtMs - Date.now()) / 1000);
      if (rem <= 0) {
        return { ...parsed, remainingSec: 0, running: false, finished: true };
      }
      return { ...parsed, remainingSec: rem, running: true, finished: false };
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistActiveRestTimer(username: string, timer: ActiveRestTimerState | null) {
  try {
    const key = getActiveRestTimerStorageKey(username);
    if (!timer) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(timer));
    }
  } catch {
    // ignore storage errors
  }
}

async function triggerBrowserRestNotification(title: string, body: string, tag: string) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) {
        reg.active.postMessage({ type: 'SHOW_NOTIFICATION', title, body, tag });
        return;
      }
    }
    new Notification(title, { body, tag, icon: '/favicon.ico' });
  } catch {
    // ignore browser notification failures
  }
}

function playRestFinishedChime(sound: RestSoundType = 'chime') {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(sound === 'bell' || sound === 'fanfare' ? [180, 80, 180, 80, 220] : [120, 60, 120]);
    }
  } catch {
    // ignore vibration unsupported
  }
  if (sound === 'silent') return;

  try {
    const win = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioCtx = win.AudioContext || win.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    const scheduleTone = (
      freq: number,
      offsetSec: number,
      durSec: number,
      wave: OscillatorType,
      peakGain: number
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      const startAt = now + offsetSec;
      const endAt = startAt + durSec;
      osc.frequency.setValueAtTime(freq, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(endAt + 0.02);
    };

    if (sound === 'bell') {
      // Twin metallic boxing bell strikes
      [0, 0.24].forEach((offset) => {
        scheduleTone(1046.5, offset, 0.45, 'triangle', 0.11);
        scheduleTone(1568, offset, 0.35, 'sine', 0.07);
        scheduleTone(2093, offset, 0.25, 'sine', 0.045);
      });
    } else if (sound === 'beep') {
      // Crisp digital timer beeps
      scheduleTone(880, 0, 0.11, 'square', 0.045);
      scheduleTone(880, 0.16, 0.11, 'square', 0.045);
      scheduleTone(1174.66, 0.32, 0.24, 'triangle', 0.075);
    } else if (sound === 'gong') {
      // Deep warm zen gong
      scheduleTone(220, 0, 1.15, 'sine', 0.12);
      scheduleTone(330, 0.02, 0.95, 'triangle', 0.055);
      scheduleTone(440, 0.04, 0.75, 'sine', 0.035);
    } else if (sound === 'fanfare') {
      // Energetic 4-note triad
      scheduleTone(523.25, 0, 0.18, 'triangle', 0.08);
      scheduleTone(659.25, 0.1, 0.18, 'triangle', 0.08);
      scheduleTone(783.99, 0.2, 0.18, 'triangle', 0.085);
      scheduleTone(1046.5, 0.3, 0.48, 'triangle', 0.1);
    } else {
      // Default harmonic chime
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        scheduleTone(freq, idx * 0.11, 0.34, 'sine', 0.08);
      });
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1500);
  } catch {
    // ignore Web Audio restriction errors
  }
}

function readStoredWaterCount(username: string): { count: number; updatedAt: number } {
  try {
    const raw = localStorage.getItem(getWaterStorageKey(username));
    if (!raw) return { count: 0, updatedAt: 0 };
    const parsed = JSON.parse(raw);
    const val = typeof parsed === 'number' ? parsed : Number(parsed?.count ?? 0);
    const ts = parsed?.updatedAt ? (Date.parse(parsed.updatedAt) || 0) : 0;
    return {
      count: Number.isFinite(val) && val >= 0 ? Math.min(40, Math.floor(val)) : 0,
      updatedAt: ts,
    };
  } catch {
    return { count: 0, updatedAt: 0 };
  }
}

function planCompletion(plan: WorkoutPlan): { done: number; total: number; pct: number } {
  const total = (plan.exercises?.length || 0) * Math.max(1, plan.weeks || 1);
  let done = 0;
  const progress = plan.progress || {};
  for (let w = 0; w < Math.max(1, plan.weeks || 1); w++) {
    done += (progress[weekKey(w)] || []).length;
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

function getExerciseTargetDisplay(ex: WorkoutExercise): { setsDisplay: string; repsDisplay: string } {
  const split = splitSetsAndReps(ex.sets);
  if (split) {
    return {
      setsDisplay: split.sets,
      repsDisplay: ex.reps?.trim() || split.reps,
    };
  }
  return {
    setsDisplay: (ex.sets || '').trim(),
    repsDisplay: (ex.reps || '').trim(),
  };
}

function normalizeSetEntries(
  ex: WorkoutExercise,
  logged: ExerciseLogEntry | undefined,
  defaultUnit: WeightUnit
): SetLogEntry[] {
  const targetCount = parseSetsCount(ex.sets);

  // Respect user-customized setEntries length AND expand if target sets increased from an updated sheet
  if (logged?.setEntries && logged.setEntries.length > 0) {
    const count = Math.max(targetCount, logged.setEntries.length);
    return Array.from({ length: count }, (_, idx) => {
      const existing = logged.setEntries![idx];
      return {
        setNumber: idx + 1,
        weight: existing?.weight ?? '',
        unit: existing?.unit || logged.unit || defaultUnit,
        reps: existing?.reps ?? '',
        rpe: existing?.rpe ?? '',
        rir: existing?.rir ?? '',
      };
    });
  }

  // Backward-compatible hydration for legacy single sets/reps entries
  if (logged && (logged.sets?.trim() || logged.reps?.trim() || logged.weight?.trim())) {
    const count = Math.max(targetCount, parseSetsCount(logged.sets));
    return Array.from({ length: count }, (_, idx) => ({
      setNumber: idx + 1,
      weight: logged.weight ?? '',
      unit: logged.unit || defaultUnit,
      reps: logged.reps ?? '',
      rpe: '',
      rir: '',
    }));
  }

  return Array.from({ length: targetCount }, (_, idx) => ({
    setNumber: idx + 1,
    weight: '',
    unit: defaultUnit,
    reps: '',
    rpe: '',
    rir: '',
  }));
}

function entryHasLoggedData(entry?: ExerciseLogEntry): boolean {
  if (!entry) return false;
  if (
    entry.setEntries &&
    entry.setEntries.some(
      s =>
        s.weight.trim() !== '' ||
        s.reps.trim() !== '' ||
        (s.rpe || '').trim() !== '' ||
        (s.rir || '').trim() !== ''
    )
  ) {
    return true;
  }
  return Boolean(entry.weight?.trim() || entry.reps?.trim() || entry.sets?.trim());
}

interface RpeIntensityMeta {
  level: 'Light' | 'Moderate' | 'High' | 'Max';
  dotClass: string;
  chipClass: string;
  textClass: string;
}

function getRpeIntensityMeta(rpeRaw?: string): RpeIntensityMeta | null {
  const clean = (rpeRaw || '').trim();
  if (!clean) return null;
  const nums = (clean.match(/\d+(?:\.\d+)?/g) || [])
    .map(Number)
    .filter(n => Number.isFinite(n) && n > 0 && n <= 10);
  if (nums.length === 0) return null;
  const peak = Math.max(...nums);

  if (peak >= 9) {
    return {
      level: 'Max',
      dotClass: 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.85)]',
      chipClass: 'border-red-500/40 bg-red-950/35 text-neutral-100',
      textClass: 'text-red-300',
    };
  }
  if (peak >= 8) {
    return {
      level: 'High',
      dotClass: 'bg-orange-400',
      chipClass: 'border-orange-500/35 bg-orange-950/25 text-neutral-100',
      textClass: 'text-orange-300',
    };
  }
  if (peak >= 6.5) {
    return {
      level: 'Moderate',
      dotClass: 'bg-amber-400',
      chipClass: 'border-amber-500/30 bg-amber-950/20 text-neutral-100',
      textClass: 'text-amber-300',
    };
  }
  return {
    level: 'Light',
    dotClass: 'bg-emerald-400',
    chipClass: 'border-emerald-500/30 bg-emerald-950/20 text-neutral-100',
    textClass: 'text-emerald-300',
  };
}

interface WeekHistoryRecord {
  weekLabel: string;
  weekNum: number;
  planTitle?: string;
  updatedAt?: string;
  note?: string;
  setEntries: SetLogEntry[];
}

function buildWeeklyHistory(
  plan: WorkoutPlan,
  ex: WorkoutExercise,
  allUserPlans: WorkoutPlan[]
): WeekHistoryRecord[] {
  const records: WeekHistoryRecord[] = [];
  const weekLogs = plan.exerciseLogs || {};
  const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';

  const weekNums = new Set<number>();
  for (let w = 1; w <= Math.max(1, plan.weeks || 1); w++) weekNums.add(w);
  Object.keys(weekLogs).forEach((k) => {
    const m = k.match(/^w(\d+)$/i);
    if (m) weekNums.add(parseInt(m[1], 10));
  });

  Array.from(weekNums)
    .sort((a, b) => a - b)
    .forEach((w) => {
      const entry = weekLogs[weekKey(w - 1)]?.[ex.id];
      const weekNote = entry?.notes?.trim() || '';
      const hasSets = entryHasLoggedData(entry);
      if (!hasSets && !weekNote) return;
      const setsList = hasSets
        ? entry?.setEntries && entry.setEntries.length > 0
          ? entry.setEntries
              .filter(
                s =>
                  s.weight.trim() !== '' ||
                  s.reps.trim() !== '' ||
                  (s.rpe || '').trim() !== '' ||
                  (s.rir || '').trim() !== ''
              )
              .map(s => ({ ...s, unit: s.unit || entry.unit || planUnit }))
          : [{ setNumber: 1, weight: entry?.weight || '', unit: entry?.unit || planUnit, reps: entry?.reps || '', rpe: '', rir: '' }]
        : [];
      if (setsList.length === 0 && !weekNote) return;
      records.push({
        weekLabel: `Week ${w}`,
        weekNum: w,
        updatedAt: entry?.updatedAt,
        note: weekNote || undefined,
        setEntries: setsList,
      });
    });

  const normName = (ex.name || '').trim().toLowerCase();
  if (normName) {
    for (const other of allUserPlans) {
      if (other.id === plan.id) continue;
      const otherUnit: WeightUnit = other.defaultWeightUnit || 'kg';
      const matchingEx = other.exercises.find(e => (e.name || '').trim().toLowerCase() === normName);
      if (!matchingEx) continue;
      const otherLogs = other.exerciseLogs || {};
      const otherWeeks = Object.keys(otherLogs)
        .map(k => {
          const m = k.match(/^w(\d+)$/i);
          return m ? { key: k, num: parseInt(m[1], 10) } : null;
        })
        .filter((x): x is { key: string; num: number } => x !== null)
        .sort((a, b) => a.num - b.num);

      for (const wk of otherWeeks) {
        const entry = otherLogs[wk.key]?.[matchingEx.id];
        const weekNote = entry?.notes?.trim() || '';
        const hasSets = entryHasLoggedData(entry);
        if (!hasSets && !weekNote) continue;
        const setsList = hasSets
          ? entry?.setEntries && entry.setEntries.length > 0
            ? entry.setEntries
                .filter(
                  s =>
                    s.weight.trim() !== '' ||
                    s.reps.trim() !== '' ||
                    (s.rpe || '').trim() !== '' ||
                    (s.rir || '').trim() !== ''
                )
                .map(s => ({ ...s, unit: s.unit || entry.unit || otherUnit }))
            : [{ setNumber: 1, weight: entry?.weight || '', unit: entry?.unit || otherUnit, reps: entry?.reps || '', rpe: '', rir: '' }]
          : [];
        if (setsList.length === 0 && !weekNote) continue;
        records.push({
          weekLabel: `${other.title} · W${wk.num}`,
          weekNum: wk.num,
          planTitle: other.title,
          updatedAt: entry?.updatedAt,
          note: weekNote || undefined,
          setEntries: setsList,
        });
      }
    }
  }

  return records;
}

function findPreviousWeekSets(
  plan: WorkoutPlan,
  selectedWeek: number,
  ex: WorkoutExercise,
  allUserPlans: WorkoutPlan[]
): { sourceLabel: string; setEntries: SetLogEntry[] } | null {
  const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';

  for (let w = selectedWeek - 1; w >= 1; w--) {
    const entry = plan.exerciseLogs?.[weekKey(w - 1)]?.[ex.id];
    if (entryHasLoggedData(entry)) {
      return { sourceLabel: `Week ${w}`, setEntries: normalizeSetEntries(ex, entry, planUnit) };
    }
  }

  const snap = plan.previousLogs?.[ex.id];
  if (entryHasLoggedData(snap)) {
    return {
      sourceLabel: snap?.updatedAt ? new Date(snap.updatedAt).toLocaleDateString() : 'Prior Session',
      setEntries: normalizeSetEntries(ex, snap, planUnit),
    };
  }

  const normName = (ex.name || '').trim().toLowerCase();
  if (normName) {
    for (const other of allUserPlans) {
      if (other.id === plan.id) continue;
      const otherUnit: WeightUnit = other.defaultWeightUnit || 'kg';
      const matchingEx = other.exercises.find(e => (e.name || '').trim().toLowerCase() === normName);
      if (!matchingEx) continue;
      for (let w = Math.max(1, other.weeks || 1); w >= 1; w--) {
        const entry = other.exerciseLogs?.[weekKey(w - 1)]?.[matchingEx.id];
        if (entryHasLoggedData(entry)) {
          return {
            sourceLabel: `${other.title} (W${w})`,
            setEntries: normalizeSetEntries(ex, entry, otherUnit),
          };
        }
      }
    }
  }

  return null;
}

export const GymApp: React.FC<GymAppProps> = ({
  currentUser,
  userAccounts = [],
  adminSettings = [],
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<GymTab>('dashboard');
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [selectedDayFilter, setSelectedDayFilter] = useState<string>('ALL');
  const [showInstructions, setShowInstructions] = useState(true);

  // Custom Delete Plan Confirmation Modal state
  const [planToDelete, setPlanToDelete] = useState<WorkoutPlan | null>(null);
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);

  // User Profile State (Display Name, Password Change, Telegram Bot, 2FA)
  const [localAccountOverride, setLocalAccountOverride] = useState<UserAccount | null>(null);
  const matchedAccount = useMemo(() => {
    const clean = (currentUser || '').toLowerCase().trim();
    const fromDb = userAccounts.find(
      u =>
        u.username?.toLowerCase().trim() === clean ||
        u.id?.toLowerCase().trim() === clean ||
        u.id?.toLowerCase().trim() === `user_${clean}`
    );
    if (localAccountOverride && (!fromDb || fromDb.id === localAccountOverride.id)) {
      return { ...(fromDb || {}), ...localAccountOverride } as UserAccount;
    }
    return fromDb || null;
  }, [userAccounts, currentUser, localAccountOverride]);

  const resolvedDisplayName = matchedAccount?.displayName?.trim() || currentUser;
  const matchedAccountRef = useRef<UserAccount | null>(matchedAccount);
  matchedAccountRef.current = matchedAccount;
  const resolvedDisplayNameRef = useRef<string>(resolvedDisplayName);
  resolvedDisplayNameRef.current = resolvedDisplayName;

  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileGender, setProfileGender] = useState('male');
  const [profileWeightUnit, setProfileWeightUnit] = useState<WeightUnit>('kg');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password Change (Old -> New -> Confirm New)
  const [oldPasswordInput, setOldPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Member Telegram Bot settings
  const [tgUsernameInput, setTgUsernameInput] = useState('');
  const [tgChatIdInput, setTgChatIdInput] = useState('');
  const [tgNotificationsEnabled, setTgNotificationsEnabled] = useState(true);
  const [isSavingTelegram, setIsSavingTelegram] = useState(false);
  const [isDetectingTelegram, setIsDetectingTelegram] = useState(false);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramFeedback, setTelegramFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Member 2FA modal state
  const [is2FAModalOpen, setIs2FAModalOpen] = useState(false);

  useEffect(() => {
    setProfileDisplayName(matchedAccount?.displayName?.trim() || currentUser);
    setProfileGender(matchedAccount?.gender || 'male');
    setProfileWeightUnit(matchedAccount?.weightUnitPreference || 'kg');
    setTgUsernameInput(matchedAccount?.telegramUsername || '');
    setTgChatIdInput(matchedAccount?.telegramChatId || '');
    setTgNotificationsEnabled(matchedAccount?.telegramNotificationsEnabled ?? true);
  }, [matchedAccount, currentUser]);

  // Per-set draft inputs keyed by `${planId}__w${wk}__${exId}`
  const [draftSets, setDraftSets] = useState<Record<string, SetLogEntry[]>>({});
  // Per-exercise week note checkbox + drafts keyed by `${planId}__w${wk}__${exId}`
  const [exerciseNoteEnabledOverrides, setExerciseNoteEnabledOverrides] = useState<Record<string, boolean>>({});
  const [exerciseNoteDrafts, setExerciseNoteDrafts] = useState<Record<string, string>>({});
  // Warm-up UI, drafts, editing, countdown timer & set entries keyed by `${planId}__wu_w${wk}__${wuId}`
  const [showWarmupSection, setShowWarmupSection] = useState(true);
  const [showAddWarmupForm, setShowAddWarmupForm] = useState(false);
  const [newWarmupDraft, setNewWarmupDraft] = useState({
    name: '',
    minutes: '5',
    targetSets: '2',
    target: '',
    notes: '',
  });
  const [editingWarmupId, setEditingWarmupId] = useState<string | null>(null);
  const [editWarmupDraft, setEditWarmupDraft] = useState<{
    name: string;
    minutes: string;
    targetSets: string;
    target: string;
    notes: string;
  } | null>(null);
  const [warmupDraftSets, setWarmupDraftSets] = useState<Record<string, SetLogEntry[]>>({});
  const [warmupTimer, setWarmupTimer] = useState<{
    wuId: string;
    remainingSec: number;
    totalSec: number;
    running: boolean;
    finished?: boolean;
  } | null>(null);

  // Weekly & daily session notes toggle + drafts keyed by `${planId}__w${wk}__${noteKey}`
  const [sessionNoteEnabledOverrides, setSessionNoteEnabledOverrides] = useState<Record<string, boolean>>({});
  const [sessionNoteDrafts, setSessionNoteDrafts] = useState<Record<string, string>>({});
  const [savedNoticeId, setSavedNoticeId] = useState<string | null>(null);

  // Auto-complete exercise celebration animation state & manual check/uncheck override tracking
  const manuallyUncheckedRef = useRef<Set<string>>(new Set());
  const manuallyCheckedRef = useRef<Set<string>>(new Set());
  const autoSaveTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const celebrationClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [justCompletedExKey, setJustCompletedExKey] = useState<string | null>(null);
  const [justCompletedMotivation, setJustCompletedMotivation] = useState<string | null>(null);

  // Water intake counter + Telegram hydration reminder state
  const [waterGlasses, setWaterGlasses] = useState<number>(() => readStoredWaterCount(currentUser).count);
  const [waterReminderEnabled, setWaterReminderEnabled] = useState<boolean>(
    () => readStoredWaterReminder(currentUser).enabled
  );
  const [waterReminderIntervalMinutes, setWaterReminderIntervalMinutes] = useState<number>(
    () => readStoredWaterReminder(currentUser).intervalMinutes
  );
  const [customWaterIntervalInput, setCustomWaterIntervalInput] = useState<string>(
    () => String(readStoredWaterReminder(currentUser).intervalMinutes)
  );
  const waterGlassesRef = useRef<number>(waterGlasses);
  waterGlassesRef.current = waterGlasses;
  const waterReminderEnabledRef = useRef<boolean>(waterReminderEnabled);
  waterReminderEnabledRef.current = waterReminderEnabled;
  const waterReminderIntervalRef = useRef<number>(waterReminderIntervalMinutes);
  waterReminderIntervalRef.current = waterReminderIntervalMinutes;
  const activeTelegramConfigRef = useRef<ReturnType<typeof getTelegramConfig> | null>(null);
  const memberWhitelistStatusRef = useRef<'active' | 'paused' | 'not_whitelisted'>('not_whitelisted');
  const resolvedMemberChatIdRef = useRef<string>('');
  const hasTelegramUsernameRef = useRef<boolean>(false);
  const [isSendingWaterAlert, setIsSendingWaterAlert] = useState(false);
  const [waterAlertNotice, setWaterAlertNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Body Weight Tracker state
  const [bodyWeightEntries, setBodyWeightEntries] = useState<BodyWeightEntry[]>(
    () => readStoredBodyWeight(currentUser).entries
  );
  const [bodyWeightDateInput, setBodyWeightDateInput] = useState<string>(() => getTodayDateKey());
  const [bodyWeightValueInput, setBodyWeightValueInput] = useState<string>('');
  const [bodyWeightUnitInput, setBodyWeightUnitInput] = useState<WeightUnit>(() => matchedAccount?.weightUnitPreference || 'kg');
  const [bodyWeightChartUnit, setBodyWeightChartUnit] = useState<WeightUnit>(() => matchedAccount?.weightUnitPreference || 'kg');
  const [bodyWeightNoteInput, setBodyWeightNoteInput] = useState<string>('');
  const [bodyWeightNotice, setBodyWeightNotice] = useState<string | null>(null);
  const [quickWaterWeightInput, setQuickWaterWeightInput] = useState<string>('');
  const [quickWaterWeightUnit, setQuickWaterWeightUnit] = useState<WeightUnit>(() => matchedAccount?.weightUnitPreference || 'kg');

  // Per-User Custom Website Background Image state
  const [userBgImageUrl, setUserBgImageUrl] = useState<string>(() => readStoredUserBg(currentUser).imageUrl);
  const [userBgDimPercent, setUserBgDimPercent] = useState<number>(() => readStoredUserBg(currentUser).dimPercent);
  const [isUploadingBg, setIsUploadingBg] = useState(false);
  const [bgFeedback, setBgFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const bgDimSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-set Rest Timer state (user-controlled countdown + sound variety + background persistence)
  const [defaultRestSeconds, setDefaultRestSeconds] = useState<number>(() => readStoredRestSeconds(currentUser));
  const [customRestInput, setCustomRestInput] = useState<string>(() => String(readStoredRestSeconds(currentUser)));
  const [restSound, setRestSound] = useState<RestSoundType>(() => readStoredRestSound(currentUser));
  const restSoundRef = useRef<RestSoundType>(restSound);
  useEffect(() => {
    restSoundRef.current = restSound;
  }, [restSound]);
  const [setRestTimer, setSetRestTimer] = useState<ActiveRestTimerState | null>(
    () => readStoredActiveRestTimer(currentUser)
  );
  const [restAlertBanner, setRestAlertBanner] = useState<{
    id: string;
    timerKey: string;
    exerciseId: string;
    exerciseName: string;
    setNumber: number;
    totalSec: number;
  } | null>(null);

  // Register lightweight Service Worker for reliable rest-timer notifications
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Re-initialize per-user local caches on username switch
  useEffect(() => {
    setLocalAccountOverride(null);
    const storedWater = readStoredWaterCount(currentUser);
    waterGlassesRef.current = storedWater.count;
    setWaterGlasses(storedWater.count);
    const rem = readStoredWaterReminder(currentUser);
    waterReminderEnabledRef.current = rem.enabled;
    waterReminderIntervalRef.current = rem.intervalMinutes;
    setWaterReminderEnabled(rem.enabled);
    setWaterReminderIntervalMinutes(rem.intervalMinutes);
    setCustomWaterIntervalInput(String(rem.intervalMinutes));
    const storedRest = readStoredRestSeconds(currentUser);
    setDefaultRestSeconds(storedRest);
    setCustomRestInput(String(storedRest));
    setRestSound(readStoredRestSound(currentUser));
    setSetRestTimer(readStoredActiveRestTimer(currentUser));
    setBodyWeightEntries(readStoredBodyWeight(currentUser).entries);

    const localBg = readStoredUserBg(currentUser);
    setUserBgImageUrl(localBg.imageUrl);
    setUserBgDimPercent(localBg.dimPercent);
    setBgFeedback(null);

    if (currentUser) {
      // Optional legacy local-server background sync (only applies if Firestore adminSettings does not have an entry yet)
      fetch(`/api/profile/background?username=${encodeURIComponent(currentUser)}`)
        .then(r => (r.ok && r.headers.get('content-type')?.includes('application/json') ? r.json() : null))
        .then((res) => {
          if (!res?.success || !res.background?.imageUrl) return;
          const settingId = getUserBgSettingId(currentUser);
          const hasCloudSetting = adminSettings.some(s => s.id === settingId);
          if (hasCloudSetting) return;
          const dim = typeof res.background.dimPercent === 'number' ? res.background.dimPercent : 72;
          setUserBgImageUrl(res.background.imageUrl);
          setUserBgDimPercent(dim);
          saveStoredUserBg(currentUser, res.background.imageUrl, dim);
        })
        .catch(() => {});

      // Only push local water count to backend if this browser actually logged water updates today
      if (storedWater.updatedAt > 0) {
        const storedGoal = computeWaterGoalFromBodyWeightEntries(readStoredBodyWeight(currentUser).entries);
        fetch('/api/water-intake/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: currentUser,
            date: getTodayDateKey(),
            timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
            glasses: storedWater.count,
            goalGlasses: storedGoal.targetGlasses,
            targetLiters: storedGoal.targetLiters,
            updatedAt: new Date(storedWater.updatedAt).toISOString(),
            reminderEnabled: rem.enabled,
            reminderIntervalMinutes: rem.intervalMinutes,
          }),
        }).catch(() => {});
      }
    }
  }, [currentUser]);

  // Hydrate persistent per-user Website Background from Firestore adminSettings across production & multi-device
  useEffect(() => {
    if (!currentUser) return;
    const bgSettingId = getUserBgSettingId(currentUser);
    const cloudBgDoc = adminSettings.find(s => s.id === bgSettingId);
    if (!cloudBgDoc) return;

    const cloudUrl = typeof cloudBgDoc.imageUrl === 'string' ? cloudBgDoc.imageUrl : '';
    const rawDim = Number(cloudBgDoc.dimPercent);
    const cloudDim = Number.isFinite(rawDim) && rawDim >= 20 && rawDim <= 95 ? Math.round(rawDim) : 72;
    setUserBgImageUrl(cloudUrl);
    setUserBgDimPercent(cloudDim);
    saveStoredUserBg(currentUser, cloudUrl, cloudDim);
  }, [adminSettings, currentUser]);

  // Hydrate persistent Water Reminder, Body Weight & Rest Timer prefs from Firestore UserAccount
  useEffect(() => {
    if (!matchedAccount) return;
    const effectiveGoal = computeWaterGoalFromBodyWeightEntries(
      Array.isArray(matchedAccount.bodyWeightHistory) && matchedAccount.bodyWeightHistory.length > 0
        ? matchedAccount.bodyWeightHistory
        : readStoredBodyWeight(currentUser).entries
    );

    if (matchedAccount.waterIntake) {
      const dbUpdated = matchedAccount.waterIntake.updatedAt ? (Date.parse(matchedAccount.waterIntake.updatedAt) || 0) : 0;
      const localRem = readStoredWaterReminder(currentUser);
      if (dbUpdated >= localRem.updatedAt || localRem.updatedAt === 0) {
        if (typeof matchedAccount.waterIntake.reminderEnabled === 'boolean') {
          waterReminderEnabledRef.current = matchedAccount.waterIntake.reminderEnabled;
          setWaterReminderEnabled(matchedAccount.waterIntake.reminderEnabled);
          const dbInterval = Number(matchedAccount.waterIntake.reminderIntervalMinutes);
          const nextInt = Number.isFinite(dbInterval) && dbInterval >= 1 && dbInterval <= 1440
            ? Math.round(dbInterval)
            : localRem.intervalMinutes;
          waterReminderIntervalRef.current = nextInt;
          setWaterReminderIntervalMinutes(nextInt);
          setCustomWaterIntervalInput(String(nextInt));
          saveStoredWaterReminder(currentUser, matchedAccount.waterIntake.reminderEnabled, nextInt);
        }
      }
      const localWater = readStoredWaterCount(currentUser);
      if (matchedAccount.waterIntake.date === getTodayDateKey() && (dbUpdated >= localWater.updatedAt || localWater.updatedAt === 0)) {
        const dbGlasses = Math.max(0, Math.min(40, Math.floor(Number(matchedAccount.waterIntake.glasses) || 0)));
        waterGlassesRef.current = dbGlasses;
        setWaterGlasses(dbGlasses);
        try {
          localStorage.setItem(
            getWaterStorageKey(currentUser),
            JSON.stringify({ count: dbGlasses, updatedAt: matchedAccount.waterIntake.updatedAt || new Date().toISOString() })
          );
        } catch {
          // ignore
        }
        // Keep backend live bot cache synchronized with Firestore value
        fetch('/api/water-intake/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: currentUser,
            date: getTodayDateKey(),
            timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
            glasses: dbGlasses,
            goalGlasses: effectiveGoal.targetGlasses,
            targetLiters: effectiveGoal.targetLiters,
            updatedAt: matchedAccount.waterIntake.updatedAt || new Date().toISOString(),
            reminderEnabled: matchedAccount.waterIntake.reminderEnabled ?? waterReminderEnabledRef.current,
            reminderIntervalMinutes: matchedAccount.waterIntake.reminderIntervalMinutes ?? waterReminderIntervalRef.current,
          }),
        }).catch(() => {});
      } else if (localWater.updatedAt > dbUpdated && matchedAccount.username?.toLowerCase().trim() !== 'admin') {
        // Local water intake is newer than DB (e.g. saved just before refresh); push local state up cleanly
        const syncPayload: UserAccount = {
          ...matchedAccount,
          waterIntake: {
            date: getTodayDateKey(),
            glasses: localWater.count,
            goalGlasses: effectiveGoal.targetGlasses,
            targetLiters: effectiveGoal.targetLiters,
            updatedAt: new Date(localWater.updatedAt).toISOString(),
            timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
            reminderEnabled: readStoredWaterReminder(currentUser).enabled,
            reminderIntervalMinutes: readStoredWaterReminder(currentUser).intervalMinutes,
          },
        };
        setLocalAccountOverride(syncPayload);
        saveUserAccountDoc(syncPayload).catch(() => {});
      }
    } else if (currentUser && matchedAccount.username?.toLowerCase().trim() !== 'admin') {
      const localWater = readStoredWaterCount(currentUser);
      if (localWater.updatedAt > 0 || effectiveGoal.hasWeight) {
        const remState = readStoredWaterReminder(currentUser);
        const syncPayload: UserAccount = {
          ...matchedAccount,
          waterIntake: {
            date: getTodayDateKey(),
            glasses: localWater.count,
            goalGlasses: effectiveGoal.targetGlasses,
            targetLiters: effectiveGoal.targetLiters,
            updatedAt: localWater.updatedAt > 0 ? new Date(localWater.updatedAt).toISOString() : new Date().toISOString(),
            timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
            reminderEnabled: remState.enabled,
            reminderIntervalMinutes: remState.intervalMinutes,
          },
        };
        setLocalAccountOverride(syncPayload);
        saveUserAccountDoc(syncPayload).catch(() => {});
      }
    }

    if (Array.isArray(matchedAccount.bodyWeightHistory) && matchedAccount.bodyWeightHistory.length > 0) {
      const localBw = readStoredBodyWeight(currentUser);
      if (matchedAccount.bodyWeightHistory.length >= localBw.entries.length || localBw.entries.length === 0) {
        const sorted = [...matchedAccount.bodyWeightHistory].sort((a, b) => a.date.localeCompare(b.date));
        setBodyWeightEntries(sorted);
        saveStoredBodyWeight(currentUser, sorted);
      }
    }

    if (matchedAccount.restTimerPrefs) {
      const dbSec = Number(matchedAccount.restTimerPrefs.seconds);
      if (Number.isFinite(dbSec) && dbSec >= 10 && dbSec <= 600) {
        setDefaultRestSeconds(Math.round(dbSec));
        setCustomRestInput(String(Math.round(dbSec)));
        saveStoredRestSeconds(currentUser, dbSec);
      }
      const dbSound = matchedAccount.restTimerPrefs.sound as RestSoundType | undefined;
      if (dbSound && REST_SOUND_OPTIONS.some(o => o.id === dbSound)) {
        setRestSound(dbSound);
        saveStoredRestSound(currentUser, dbSound);
      }
    }
  }, [matchedAccount?.id, matchedAccount?.waterIntake?.updatedAt, matchedAccount?.bodyWeightHistory?.length, currentUser]);

  // Inline exercise metadata editor (to freely modify sets/reps/targetRpe/targetRir/superset/notes/video later)
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    day: string;
    sets: string;
    reps: string;
    targetRpe: string;
    targetRir: string;
    notes: string;
    videoUrl: string;
    isSuperset: boolean;
    supersetGroup: string;
  } | null>(null);

  // Inline WebView video player state (plays directly inside exercise card)
  const [inlineVideoExId, setInlineVideoExId] = useState<string | null>(null);

  // Full Worksheet Modifier state (edits plan & rows or re-imports file without losing saved logs/history)
  const worksheetFileInputRef = useRef<HTMLInputElement>(null);
  const [worksheetEditPlanId, setWorksheetEditPlanId] = useState<string | null>(null);
  const [worksheetDraft, setWorksheetDraft] = useState<{
    title: string;
    description: string;
    instructions: string;
    weeks: number;
    defaultWeightUnit: WeightUnit;
    sourceFileName?: string;
    hasRpeColumn?: boolean;
    hasRirColumn?: boolean;
    replaceExistingWeekLogs?: boolean;
    exercises: Array<{
      id?: string;
      day: string;
      name: string;
      sets: string;
      reps: string;
      targetRpe?: string;
      targetRir?: string;
      notes: string;
      videoUrl: string;
      isSuperset: boolean;
      supersetGroup: string;
      loggedWeight?: string;
      loggedUnit?: WeightUnit;
      loggedReps?: string;
      weeklyLogs?: Record<number, ParsedWeekData>;
      completed?: boolean;
    }>;
  } | null>(null);
  const [worksheetImportNotice, setWorksheetImportNotice] = useState<string | null>(null);
  const [isSavingWorksheet, setIsSavingWorksheet] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [openExportMenu, setOpenExportMenu] = useState<'toolbar' | 'dashboard' | 'profile' | null>(null);
  const exportButtonRefs = useRef<Record<'toolbar' | 'dashboard' | 'profile', HTMLButtonElement | null>>({
    toolbar: null,
    dashboard: null,
    profile: null,
  });
  const [exportMenuCoords, setExportMenuCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
  } | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isSendingSheetToBot, setIsSendingSheetToBot] = useState<'pdf' | 'excel' | null>(null);

  // Active video preview modal state (expanded WebView)
  const [activeVideoModal, setActiveVideoModal] = useState<{
    exerciseName: string;
    url: string;
    embedUrl?: string;
    provider: string;
  } | null>(null);

  useEffect(() => {
    const unsub = subscribeToWorkoutPlans(setPlans);
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!openExportMenu) {
      setExportMenuCoords(null);
      return;
    }

    const updateMenuPosition = () => {
      const btn = exportButtonRefs.current[openExportMenu];
      if (!btn || typeof window === 'undefined') return;
      const rect = btn.getBoundingClientRect();
      const menuWidth = 264;
      const estMenuHeight = hasTelegramUsernameRef.current ? 236 : 124;
      const left = Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12));
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeAbove = spaceBelow < estMenuHeight && rect.top > estMenuHeight;
      if (placeAbove) {
        setExportMenuCoords({ bottom: Math.max(12, window.innerHeight - rect.top + 8), left });
      } else {
        setExportMenuCoords({ top: Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - estMenuHeight - 12)), left });
      }
    };

    updateMenuPosition();

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-export-menu-root="true"]') || target?.closest('[data-export-menu-portal="true"]')) return;
      setOpenExportMenu(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenExportMenu(null);
    };
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openExportMenu]);

  const isOwnPlan = (plan: WorkoutPlan | null | undefined) =>
    Boolean(plan && (plan.ownerUsername || '').toLowerCase().trim() === currentUser.toLowerCase().trim());

  const myPlans = useMemo(() => {
    const clean = currentUser.toLowerCase().trim();
    return plans
      .filter((p) => (p.ownerUsername || '').toLowerCase().trim() === clean)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [plans, currentUser]);

  const activePlan = useMemo(() => {
    if (myPlans.length === 0) return null;
    return myPlans.find((p) => p.id === selectedPlanId) || myPlans[0];
  }, [myPlans, selectedPlanId]);

  const activePlanDays = useMemo(() => {
    if (!activePlan) return [];
    const seen = new Set<string>();
    for (const ex of activePlan.exercises) {
      const d = ex.day?.trim();
      if (d) seen.add(d);
    }
    return Array.from(seen);
  }, [activePlan]);

  const stats = useMemo(() => {
    const totalExercises = myPlans.reduce((sum, p) => sum + (p.exercises?.length || 0), 0);
    const totalWeeks = myPlans.reduce((sum, p) => sum + Math.max(1, p.weeks || 1), 0);
    let done = 0;
    let total = 0;
    myPlans.forEach((p) => {
      const c = planCompletion(p);
      done += c.done;
      total += c.total;
    });
    return {
      plans: myPlans.length,
      totalExercises,
      totalWeeks,
      done,
      total,
      pct: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }, [myPlans]);

  const draftKey = (planId: string, wk: number, exId: string) => `${planId}__w${wk}__${exId}`;

  const getCurrentSetEntries = (plan: WorkoutPlan, wk: number, ex: WorkoutExercise): SetLogEntry[] => {
    const dKey = draftKey(plan.id, wk, ex.id);
    if (draftSets[dKey]) return draftSets[dKey];
    const logged = plan.exerciseLogs?.[weekKey(wk - 1)]?.[ex.id];
    return normalizeSetEntries(ex, logged, plan.defaultWeightUnit || 'kg');
  };

  const triggerExerciseCompleteCelebration = (dKey: string) => {
    if (celebrationClearTimerRef.current) {
      clearTimeout(celebrationClearTimerRef.current);
    }
    const phrase = EXERCISE_MOTIVATIONS[Math.floor(Math.random() * EXERCISE_MOTIVATIONS.length)];
    setJustCompletedExKey(dKey);
    setJustCompletedMotivation(phrase);
    try {
      confetti({
        particleCount: 28,
        spread: 54,
        origin: { y: 0.72 },
        disableForReducedMotion: true,
      });
    } catch {
      // ignore if canvas/confetti is unavailable
    }
    celebrationClearTimerRef.current = setTimeout(() => {
      setJustCompletedExKey(prev => (prev === dKey ? null : prev));
      setJustCompletedMotivation(null);
    }, 3400);
  };

  const planVersionMapRef = useRef<Record<string, string>>({});

  const clearPlanDraftCaches = (planId: string) => {
    const prefix = `${planId}__`;
    setDraftSets(prev => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(prefix) && !autoSaveTimerRef.current[k]) {
          delete next[k];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setWarmupDraftSets(prev => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(prefix)) {
          delete next[k];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setExerciseNoteDrafts(prev => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(prefix)) {
          delete next[k];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setExerciseNoteEnabledOverrides(prev => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(prefix)) {
          delete next[k];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    for (const k of Array.from(manuallyUncheckedRef.current)) {
      if (k.startsWith(prefix)) manuallyUncheckedRef.current.delete(k);
    }
    for (const k of Array.from(manuallyCheckedRef.current)) {
      if (k.startsWith(prefix)) manuallyCheckedRef.current.delete(k);
    }
  };

  useEffect(() => {
    const prevVersions = planVersionMapRef.current;
    const nextVersions: Record<string, string> = {};
    plans.forEach(p => {
      const sig = `${p.updatedAt || p.createdAt || ''}|${p.weeks}|${p.exercises?.length || 0}`;
      nextVersions[p.id] = sig;
      if (prevVersions[p.id] && prevVersions[p.id] !== sig) {
        clearPlanDraftCaches(p.id);
      }
    });
    planVersionMapRef.current = nextVersions;
  }, [plans]);

  useEffect(() => {
    return () => {
      if (celebrationClearTimerRef.current) clearTimeout(celebrationClearTimerRef.current);
      Object.values(autoSaveTimerRef.current).forEach(clearTimeout);
    };
  }, []);

  const areExerciseInputsComplete = (entries: SetLogEntry[]) =>
    entries.length > 0 && entries.every(s => (s.weight || '').trim() !== '' && (s.reps || '').trim() !== '');

  const updateSetField = (
    plan: WorkoutPlan,
    wk: number,
    ex: WorkoutExercise,
    setIdx: number,
    field: 'weight' | 'reps' | 'rpe' | 'rir' | 'unit',
    value: string
  ) => {
    const dKey = draftKey(plan.id, wk, ex.id);
    if (field === 'weight' || field === 'reps') {
      manuallyUncheckedRef.current.delete(dKey);
      manuallyCheckedRef.current.delete(dKey);
    }
    const current = getCurrentSetEntries(plan, wk, ex);
    const updated = current.map((s, idx) =>
      idx === setIdx ? { ...s, setNumber: idx + 1, [field]: value } : s
    );
    setDraftSets(prev => ({ ...prev, [dKey]: updated }));
    if (autoSaveTimerRef.current[dKey]) {
      clearTimeout(autoSaveTimerRef.current[dKey]);
      delete autoSaveTimerRef.current[dKey];
    }
    if (field === 'unit') {
      saveExerciseSets(plan, wk, ex, updated);
      return;
    }
    const wKey = weekKey(wk - 1);
    const wasCompleted = (plan.progress?.[wKey] || []).includes(ex.id);
    const allComplete = areExerciseInputsComplete(updated);
    // Auto-commit cleanly when all inputs are filled (triggers check + motivation animation)
    // OR when inputs return incomplete on an already-checked card (triggers auto-uncheck)
    if (allComplete || (wasCompleted && !allComplete)) {
      autoSaveTimerRef.current[dKey] = setTimeout(() => {
        delete autoSaveTimerRef.current[dKey];
        saveExerciseSets(plan, wk, ex, updated);
      }, 650);
    }
  };

  const adjustSetCount = (plan: WorkoutPlan, wk: number, ex: WorkoutExercise, delta: 1 | -1) => {
    if (!isOwnPlan(plan)) return;
    const dKey = draftKey(plan.id, wk, ex.id);
    manuallyUncheckedRef.current.delete(dKey);
    manuallyCheckedRef.current.delete(dKey);
    const current = getCurrentSetEntries(plan, wk, ex);
    const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
    let next = current;
    if (delta === 1 && current.length < 20) {
      const lastUnit = current[current.length - 1]?.unit || planUnit;
      next = [...current, { setNumber: current.length + 1, weight: '', unit: lastUnit, reps: '', rpe: '', rir: '' }];
    } else if (delta === -1 && current.length > 1) {
      next = current.slice(0, current.length - 1);
    } else {
      return;
    }
    setDraftSets(prev => ({ ...prev, [dKey]: next }));
    saveExerciseSets(plan, wk, ex, next);
  };

  const changePlanWeightUnit = async (plan: WorkoutPlan, unit: WeightUnit) => {
    if (!isOwnPlan(plan)) return;
    if ((plan.defaultWeightUnit || 'kg') === unit) return;
    const nextPlan: WorkoutPlan = {
      ...plan,
      defaultWeightUnit: unit,
    };
    // Update current active draft units where weight hasn't been customized differently
    setDraftSets(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(k => {
        if (k.startsWith(`${plan.id}__`)) {
          updated[k] = updated[k].map(s => ({ ...s, unit }));
        }
      });
      return updated;
    });
    try {
      await saveWorkoutPlanDoc(nextPlan);
    } catch (err) {
      console.warn('Failed to update plan defaultWeightUnit:', err);
    }
  };

  const saveExerciseSets = async (
    plan: WorkoutPlan,
    wk: number,
    ex: WorkoutExercise,
    overrideEntries?: SetLogEntry[]
  ) => {
    if (!isOwnPlan(plan)) return;
    const dKey = draftKey(plan.id, wk, ex.id);
    if (autoSaveTimerRef.current[dKey]) {
      clearTimeout(autoSaveTimerRef.current[dKey]);
      delete autoSaveTimerRef.current[dKey];
    }

    const wKey = weekKey(wk - 1);
    const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
    const rawEntries = overrideEntries || getCurrentSetEntries(plan, wk, ex);
    const cleanedEntries: SetLogEntry[] = rawEntries.map((s, idx) => ({
      setNumber: idx + 1,
      weight: (s.weight || '').trim(),
      unit: s.unit || planUnit,
      reps: (s.reps || '').trim(),
      rpe: (s.rpe || '').trim(),
      rir: (s.rir || '').trim(),
    }));

    const prevLogged = plan.exerciseLogs?.[wKey]?.[ex.id];
    const prevNormalized = JSON.stringify(
      (prevLogged?.setEntries || []).map(s => ({
        w: (s.weight || '').trim(),
        u: s.unit || prevLogged?.unit || planUnit,
        r: (s.reps || '').trim(),
        e: (s.rpe || '').trim(),
        i: (s.rir || '').trim(),
      }))
    );
    const nextNormalized = JSON.stringify(
      cleanedEntries.map(s => ({ w: s.weight, u: s.unit || planUnit, r: s.reps, e: s.rpe, i: s.rir }))
    );

    const existingDoneList = plan.progress?.[wKey] || [];
    const wasCompleted = existingDoneList.includes(ex.id);
    const allInputsComplete = areExerciseInputsComplete(cleanedEntries);
    const shouldAutoCheck = allInputsComplete && !wasCompleted && !manuallyUncheckedRef.current.has(dKey);
    const shouldAutoUncheck = !allInputsComplete && wasCompleted && !manuallyCheckedRef.current.has(dKey);

    if (prevNormalized === nextNormalized && prevLogged?.setEntries && !shouldAutoCheck && !shouldAutoUncheck) {
      return;
    }

    const firstPopulated = cleanedEntries.find(s => s.weight || s.reps || s.rpe || s.rir);
    const updatedWeekLogs: Record<string, ExerciseLogEntry> = {
      ...(plan.exerciseLogs?.[wKey] || {}),
      [ex.id]: {
        ...(prevLogged || {}),
        sets: String(cleanedEntries.length),
        weight: firstPopulated?.weight || '',
        unit: firstPopulated?.unit || planUnit,
        reps: firstPopulated?.reps || '',
        setEntries: cleanedEntries,
        updatedAt: new Date().toISOString(),
      },
    };

    const updatedPreviousLogs = { ...(plan.previousLogs || {}) };
    if (prevLogged && entryHasLoggedData(prevLogged) && prevNormalized !== nextNormalized) {
      updatedPreviousLogs[ex.id] = { ...prevLogged };
    }

    const updatedProgress = shouldAutoCheck
      ? {
          ...(plan.progress || {}),
          [wKey]: [...existingDoneList, ex.id],
        }
      : shouldAutoUncheck
      ? {
          ...(plan.progress || {}),
          [wKey]: existingDoneList.filter(id => id !== ex.id),
        }
      : plan.progress;

    const nextPlan: WorkoutPlan = {
      ...plan,
      ...(updatedProgress ? { progress: updatedProgress } : {}),
      exerciseLogs: {
        ...(plan.exerciseLogs || {}),
        [wKey]: updatedWeekLogs,
      },
      previousLogs: updatedPreviousLogs,
    };

    try {
      await saveWorkoutPlanDoc(nextPlan);
      setSavedNoticeId(ex.id);
      setTimeout(() => setSavedNoticeId(prev => (prev === ex.id ? null : prev)), 2000);
      if (shouldAutoCheck) {
        triggerExerciseCompleteCelebration(dKey);
      } else if (shouldAutoUncheck) {
        setJustCompletedExKey(prev => (prev === dKey ? null : prev));
      }
    } catch (err) {
      console.warn('Failed to save exercise sets:', err);
    }
  };

  // --- PER-EXERCISE WEEKLY NOTE CHECKITEM & PERSISTENCE ---
  const isExerciseNoteEnabled = (plan: WorkoutPlan, wk: number, exId: string): boolean => {
    const key = draftKey(plan.id, wk, exId);
    if (key in exerciseNoteEnabledOverrides) return exerciseNoteEnabledOverrides[key];
    const entry = plan.exerciseLogs?.[weekKey(wk - 1)]?.[exId];
    if (typeof entry?.noteEnabled === 'boolean') return entry.noteEnabled;
    return Boolean(entry?.notes?.trim());
  };

  const getCurrentExerciseWeekNote = (plan: WorkoutPlan, wk: number, exId: string): string => {
    const key = draftKey(plan.id, wk, exId);
    if (key in exerciseNoteDrafts) return exerciseNoteDrafts[key];
    return plan.exerciseLogs?.[weekKey(wk - 1)]?.[exId]?.notes || '';
  };

  const updateExerciseWeekNoteDraft = (plan: WorkoutPlan, wk: number, exId: string, value: string) => {
    const key = draftKey(plan.id, wk, exId);
    setExerciseNoteDrafts(prev => ({ ...prev, [key]: value }));
  };

  const toggleExerciseWeekNote = async (plan: WorkoutPlan, wk: number, ex: WorkoutExercise, enabled: boolean) => {
    if (!isOwnPlan(plan)) return;
    const key = draftKey(plan.id, wk, ex.id);
    setExerciseNoteEnabledOverrides(prev => ({ ...prev, [key]: enabled }));
    const wKey = weekKey(wk - 1);
    const prevLogged = plan.exerciseLogs?.[wKey]?.[ex.id] || {};
    const nextPlan: WorkoutPlan = {
      ...plan,
      exerciseLogs: {
        ...(plan.exerciseLogs || {}),
        [wKey]: {
          ...(plan.exerciseLogs?.[wKey] || {}),
          [ex.id]: {
            ...prevLogged,
            noteEnabled: enabled,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    };
    try {
      await saveWorkoutPlanDoc(nextPlan);
    } catch (err) {
      console.warn('Failed to toggle exercise week note:', err);
    }
  };

  const saveExerciseWeekNote = async (plan: WorkoutPlan, wk: number, ex: WorkoutExercise) => {
    if (!isOwnPlan(plan)) return;
    const key = draftKey(plan.id, wk, ex.id);
    const wKey = weekKey(wk - 1);
    const raw = key in exerciseNoteDrafts ? exerciseNoteDrafts[key] : getCurrentExerciseWeekNote(plan, wk, ex.id);
    const cleaned = raw.trim();
    const prevLogged = plan.exerciseLogs?.[wKey]?.[ex.id] || {};
    const prevNotes = (prevLogged.notes || '').trim();
    const isEnabled = isExerciseNoteEnabled(plan, wk, ex.id);
    if (cleaned === prevNotes && prevLogged.noteEnabled === isEnabled) return;

    const nextPlan: WorkoutPlan = {
      ...plan,
      exerciseLogs: {
        ...(plan.exerciseLogs || {}),
        [wKey]: {
          ...(plan.exerciseLogs?.[wKey] || {}),
          [ex.id]: {
            ...prevLogged,
            notes: cleaned,
            noteEnabled: isEnabled,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    };

    try {
      await saveWorkoutPlanDoc(nextPlan);
      setExerciseNoteDrafts(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSavedNoticeId(`exnote_${ex.id}`);
      setTimeout(() => setSavedNoticeId(prev => (prev === `exnote_${ex.id}` ? null : prev)), 2000);
    } catch (err) {
      console.warn('Failed to save exercise week note:', err);
    }
  };

  // Warm-up Countdown Timer Effect
  useEffect(() => {
    if (!warmupTimer || !warmupTimer.running) return;
    const id = setInterval(() => {
      setWarmupTimer(prev => {
        if (!prev || !prev.running) return prev;
        if (prev.remainingSec <= 1) {
          return { ...prev, remainingSec: 0, running: false, finished: true };
        }
        return { ...prev, remainingSec: prev.remainingSec - 1 };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [warmupTimer?.running]);

  // Sync active rest timer to localStorage on every update
  useEffect(() => {
    persistActiveRestTimer(currentUser, setRestTimer);
  }, [setRestTimer, currentUser]);

  // Timestamp-based Rest Timer Countdown Effect (resilient to background tab throttling & reloads)
  useEffect(() => {
    if (!setRestTimer || !setRestTimer.running) return;
    const id = setInterval(() => {
      setSetRestTimer(prev => {
        if (!prev || !prev.running) return prev;
        const nextRem = prev.endAtMs
          ? Math.ceil((prev.endAtMs - Date.now()) / 1000)
          : prev.remainingSec - 1;
        if (nextRem <= 0) {
          return { ...prev, remainingSec: 0, running: false, finished: true };
        }
        if (nextRem === prev.remainingSec) return prev;
        return { ...prev, remainingSec: nextRem };
      });
    }, 400);

    const handleVisibilityResume = () => {
      setSetRestTimer(prev => {
        if (!prev || !prev.running || !prev.endAtMs) return prev;
        const nextRem = Math.ceil((prev.endAtMs - Date.now()) / 1000);
        if (nextRem <= 0) {
          return { ...prev, remainingSec: 0, running: false, finished: true };
        }
        return { ...prev, remainingSec: nextRem };
      });
    };
    document.addEventListener('visibilitychange', handleVisibilityResume);
    window.addEventListener('focus', handleVisibilityResume);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibilityResume);
      window.removeEventListener('focus', handleVisibilityResume);
    };
  }, [setRestTimer?.running]);

  const scheduleBackendRestTimer = (timer: {
    timerKey: string;
    exerciseName: string;
    setNumber: number;
    totalSec: number;
    endAtMs: number;
  }) => {
    if (!hasTelegramUsernameRef.current) return;
    fetch('/api/rest-timer/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser,
        timerKey: timer.timerKey,
        exerciseName: timer.exerciseName,
        setNumber: timer.setNumber,
        totalSec: timer.totalSec,
        endAtMs: timer.endAtMs,
      }),
    }).catch(() => {});
  };

  const cancelBackendRestTimer = (timerKey?: string) => {
    fetch('/api/rest-timer/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser, timerKey }),
    }).catch(() => {});
  };

  // Play selected sound, trigger SW Notification & show dismissible alert when rest timer completes
  useEffect(() => {
    if (!setRestTimer?.finished) return;
    playRestFinishedChime(restSoundRef.current);
    cancelBackendRestTimer(setRestTimer.timerKey);
    triggerBrowserRestNotification(
      `Rest Complete (${setRestTimer.totalSec}s)`,
      `${setRestTimer.exerciseName} — Set ${setRestTimer.setNumber} ready!`,
      setRestTimer.timerKey
    );
    const bannerId = `${setRestTimer.timerKey}_${Date.now()}`;
    setRestAlertBanner({
      id: bannerId,
      timerKey: setRestTimer.timerKey,
      exerciseId: setRestTimer.exerciseId,
      exerciseName: setRestTimer.exerciseName,
      setNumber: setRestTimer.setNumber,
      totalSec: setRestTimer.totalSec,
    });
    const autoClear = setTimeout(() => {
      setRestAlertBanner(prev => (prev?.id === bannerId ? null : prev));
    }, 9000);
    return () => clearTimeout(autoClear);
  }, [setRestTimer?.finished, setRestTimer?.timerKey]);

  const persistRestPrefsToProfile = (nextSeconds: number, nextSound: RestSoundType) => {
    const baseAccount = matchedAccountRef.current;
    if (!baseAccount || baseAccount.username?.toLowerCase().trim() === 'admin' || !baseAccount.password) return;
    const nextAccount: UserAccount = {
      ...baseAccount,
      restTimerPrefs: {
        seconds: nextSeconds,
        sound: nextSound,
      },
    };
    setLocalAccountOverride(nextAccount);
    saveUserAccountDoc(nextAccount).catch(() => {});
  };

  const updateDefaultRestSeconds = (seconds: number) => {
    const clamped = Math.min(600, Math.max(10, Math.round(seconds)));
    setDefaultRestSeconds(clamped);
    setCustomRestInput(String(clamped));
    saveStoredRestSeconds(currentUser, clamped);
    persistRestPrefsToProfile(clamped, restSound);
  };

  const updateRestSound = (sound: RestSoundType) => {
    setRestSound(sound);
    saveStoredRestSound(currentUser, sound);
    persistRestPrefsToProfile(defaultRestSeconds, sound);
  };

  const startOrToggleSetRestTimer = (
    timerKey: string,
    ex: WorkoutExercise,
    setNumber: number,
    overrideSec?: number
  ) => {
    const totalSec = Math.min(600, Math.max(10, Math.round(overrideSec ?? defaultRestSeconds)));
    setRestAlertBanner(null);

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    const now = Date.now();
    if (setRestTimer && setRestTimer.timerKey === timerKey && overrideSec === undefined) {
      if (setRestTimer.remainingSec <= 0 || setRestTimer.finished) {
        const endAtMs = now + totalSec * 1000;
        const next: ActiveRestTimerState = {
          timerKey,
          exerciseId: ex.id,
          exerciseName: ex.name,
          setNumber,
          remainingSec: totalSec,
          totalSec,
          endAtMs,
          running: true,
          finished: false,
        };
        setSetRestTimer(next);
        scheduleBackendRestTimer({ timerKey, exerciseName: ex.name, setNumber, totalSec, endAtMs });
        return;
      }
      if (setRestTimer.running) {
        const rem = setRestTimer.endAtMs
          ? Math.max(1, Math.ceil((setRestTimer.endAtMs - now) / 1000))
          : setRestTimer.remainingSec;
        setSetRestTimer({ ...setRestTimer, remainingSec: rem, endAtMs: undefined, running: false, finished: false });
        cancelBackendRestTimer(timerKey);
        return;
      }
      const endAtMs = now + setRestTimer.remainingSec * 1000;
      setSetRestTimer({ ...setRestTimer, endAtMs, running: true, finished: false });
      scheduleBackendRestTimer({
        timerKey,
        exerciseName: ex.name,
        setNumber,
        totalSec: setRestTimer.totalSec,
        endAtMs,
      });
      return;
    }

    const endAtMs = now + totalSec * 1000;
    const next: ActiveRestTimerState = {
      timerKey,
      exerciseId: ex.id,
      exerciseName: ex.name,
      setNumber,
      remainingSec: totalSec,
      totalSec,
      endAtMs,
      running: true,
      finished: false,
    };
    setSetRestTimer(next);
    scheduleBackendRestTimer({ timerKey, exerciseName: ex.name, setNumber, totalSec, endAtMs });
  };

  const stopSetRestTimer = () => {
    if (setRestTimer?.timerKey) {
      cancelBackendRestTimer(setRestTimer.timerKey);
    }
    setSetRestTimer(null);
  };

  const addSecondsToActiveRestTimer = (extraSeconds: number) => {
    setRestAlertBanner(null);
    if (!setRestTimer) return;
    const now = Date.now();
    const curRem = setRestTimer.running && setRestTimer.endAtMs
      ? Math.max(0, Math.ceil((setRestTimer.endAtMs - now) / 1000))
      : setRestTimer.remainingSec;
    const nextRemaining = Math.min(600, Math.max(1, curRem + extraSeconds));
    const endAtMs = now + nextRemaining * 1000;
    const nextState: ActiveRestTimerState = {
      ...setRestTimer,
      remainingSec: nextRemaining,
      totalSec: Math.max(setRestTimer.totalSec, nextRemaining),
      endAtMs,
      running: true,
      finished: false,
    };
    setSetRestTimer(nextState);
    scheduleBackendRestTimer({
      timerKey: nextState.timerKey,
      exerciseName: nextState.exerciseName,
      setNumber: nextState.setNumber,
      totalSec: nextState.totalSec,
      endAtMs,
    });
  };

  const startOrToggleWarmupTimer = (wu: WarmupExercise) => {
    const mins = parseFloat((wu.minutes || '').trim());
    const totalSec = Number.isFinite(mins) && mins > 0 ? Math.round(mins * 60) : 300;
    setWarmupTimer(prev => {
      if (prev && prev.wuId === wu.id) {
        if (prev.remainingSec <= 0) {
          return { wuId: wu.id, remainingSec: totalSec, totalSec, running: true, finished: false };
        }
        return { ...prev, running: !prev.running, finished: false };
      }
      return { wuId: wu.id, remainingSec: totalSec, totalSec, running: true, finished: false };
    });
  };

  const resetWarmupTimer = (wu: WarmupExercise) => {
    const mins = parseFloat((wu.minutes || '').trim());
    const totalSec = Number.isFinite(mins) && mins > 0 ? Math.round(mins * 60) : 300;
    setWarmupTimer({ wuId: wu.id, remainingSec: totalSec, totalSec, running: false, finished: false });
  };

  // --- WARM-UP EXERCISES & SEPARATE WEEKLY WARM-UP SETS ---
  const warmupDraftKey = (planId: string, wk: number, wuId: string) => `${planId}__wu_w${wk}__${wuId}`;

  const getWarmupSetEntries = (plan: WorkoutPlan, wk: number, wu: WarmupExercise): SetLogEntry[] => {
    const key = warmupDraftKey(plan.id, wk, wu.id);
    if (warmupDraftSets[key]) return warmupDraftSets[key];
    const logged = plan.warmupLogs?.[weekKey(wk - 1)]?.[wu.id];
    const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
    if (logged?.setEntries && logged.setEntries.length > 0) {
      return logged.setEntries.map((s, idx) => ({
        setNumber: idx + 1,
        weight: s.weight ?? '',
        unit: s.unit || planUnit,
        reps: s.reps ?? '',
        rpe: s.rpe ?? '',
      }));
    }
    const parsedCount = wu.targetSets?.trim()
      ? parseSetsCount(wu.targetSets.trim())
      : parseSetsCount(wu.target || '2');
    const initialCount = Math.min(10, Math.max(1, parsedCount || 2));
    return Array.from({ length: initialCount }, (_, idx) => ({
      setNumber: idx + 1,
      weight: '',
      unit: planUnit,
      reps: '',
      rpe: '',
    }));
  };

  const handleAddWarmupExercise = async (plan: WorkoutPlan) => {
    if (!isOwnPlan(plan)) return;
    const cleanName = newWarmupDraft.name.trim();
    if (!cleanName) return;
    const cleanMinutes = newWarmupDraft.minutes.trim();
    const cleanSets = newWarmupDraft.targetSets.trim();
    const cleanTarget = newWarmupDraft.target.trim();
    const newItem: WarmupExercise = {
      id: `wu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      ...(cleanMinutes ? { minutes: cleanMinutes } : {}),
      ...(cleanSets ? { targetSets: cleanSets } : {}),
      ...(cleanTarget ? { target: cleanTarget } : {}),
      ...(newWarmupDraft.notes.trim() ? { notes: newWarmupDraft.notes.trim() } : {}),
    };
    const nextPlan: WorkoutPlan = {
      ...plan,
      warmupExercises: [...(plan.warmupExercises || []), newItem],
    };
    setNewWarmupDraft({ name: '', minutes: '5', targetSets: '2', target: '', notes: '' });
    setShowAddWarmupForm(false);
    setShowWarmupSection(true);
    try {
      await saveWorkoutPlanDoc(nextPlan);
      setSavedNoticeId(`wu_${plan.id}`);
      setTimeout(() => setSavedNoticeId(prev => (prev === `wu_${plan.id}` ? null : prev)), 2000);
    } catch (err) {
      console.warn('Failed to add warm-up exercise:', err);
    }
  };

  const startEditWarmup = (wu: WarmupExercise) => {
    setEditingWarmupId(wu.id);
    setEditWarmupDraft({
      name: wu.name || '',
      minutes: wu.minutes || '',
      targetSets: wu.targetSets || '',
      target: wu.target || '',
      notes: wu.notes || '',
    });
  };

  const saveEditWarmup = async (plan: WorkoutPlan, wu: WarmupExercise) => {
    if (!isOwnPlan(plan) || !editWarmupDraft) return;
    const cleanName = editWarmupDraft.name.trim() || wu.name;
    const cleanMinutes = editWarmupDraft.minutes.trim();
    const cleanSets = editWarmupDraft.targetSets.trim();
    const cleanTarget = editWarmupDraft.target.trim();
    const cleanNotes = editWarmupDraft.notes.trim();

    const updatedWu: WarmupExercise = {
      id: wu.id,
      name: cleanName,
      ...(cleanMinutes ? { minutes: cleanMinutes } : {}),
      ...(cleanSets ? { targetSets: cleanSets } : {}),
      ...(cleanTarget ? { target: cleanTarget } : {}),
      ...(cleanNotes ? { notes: cleanNotes } : {}),
    };

    const nextWarmups = (plan.warmupExercises || []).map(w => (w.id === wu.id ? updatedWu : w));
    const newCount = cleanSets ? Math.min(10, Math.max(1, parseSetsCount(cleanSets))) : null;
    const wKey = weekKey(selectedWeek - 1);
    const key = warmupDraftKey(plan.id, selectedWeek, wu.id);
    const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';

    let nextPlan: WorkoutPlan = {
      ...plan,
      warmupExercises: nextWarmups,
    };

    if (newCount !== null) {
      const curr = getWarmupSetEntries(plan, selectedWeek, wu);
      let resized = curr;
      if (curr.length < newCount) {
        const lastUnit = curr[curr.length - 1]?.unit || planUnit;
        resized = [
          ...curr,
          ...Array.from({ length: newCount - curr.length }, (_, i) => ({
            setNumber: curr.length + i + 1,
            weight: '',
            unit: lastUnit,
            reps: '',
            rpe: '',
          })),
        ];
      } else if (curr.length > newCount) {
        const copy = [...curr];
        while (copy.length > newCount) {
          const tail = copy[copy.length - 1];
          if (!tail.weight.trim() && !tail.reps.trim() && !(tail.rpe || '').trim()) {
            copy.pop();
          } else {
            break;
          }
        }
        resized = copy;
      }
      setWarmupDraftSets(prev => ({ ...prev, [key]: resized }));
      const existingLog = plan.warmupLogs?.[wKey]?.[wu.id];
      if (existingLog) {
        nextPlan = {
          ...nextPlan,
          warmupLogs: {
            ...(plan.warmupLogs || {}),
            [wKey]: {
              ...(plan.warmupLogs?.[wKey] || {}),
              [wu.id]: {
                ...existingLog,
                setEntries: resized,
                updatedAt: new Date().toISOString(),
              },
            },
          },
        };
      }
    }

    setEditingWarmupId(null);
    setEditWarmupDraft(null);
    try {
      await saveWorkoutPlanDoc(nextPlan);
      setSavedNoticeId(`wu_saved_${wu.id}`);
      setTimeout(() => setSavedNoticeId(prev => (prev === `wu_saved_${wu.id}` ? null : prev)), 2000);
    } catch (err) {
      console.warn('Failed to update warm-up exercise:', err);
    }
  };

  const handleDeleteWarmupExercise = async (plan: WorkoutPlan, wuId: string) => {
    if (!isOwnPlan(plan)) return;
    if (warmupTimer?.wuId === wuId) setWarmupTimer(null);
    const nextPlan: WorkoutPlan = {
      ...plan,
      warmupExercises: (plan.warmupExercises || []).filter(w => w.id !== wuId),
    };
    try {
      await saveWorkoutPlanDoc(nextPlan);
    } catch (err) {
      console.warn('Failed to delete warm-up exercise:', err);
    }
  };

  const toggleWarmupCompleted = async (plan: WorkoutPlan, wk: number, wu: WarmupExercise) => {
    if (!isOwnPlan(plan)) return;
    const wKey = weekKey(wk - 1);
    const existing: WarmupLogEntry = plan.warmupLogs?.[wKey]?.[wu.id] || {};
    const nextPlan: WorkoutPlan = {
      ...plan,
      warmupLogs: {
        ...(plan.warmupLogs || {}),
        [wKey]: {
          ...(plan.warmupLogs?.[wKey] || {}),
          [wu.id]: {
            ...existing,
            completed: !existing.completed,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    };
    try {
      await saveWorkoutPlanDoc(nextPlan);
    } catch (err) {
      console.warn('Failed to toggle warm-up completion:', err);
    }
  };

  const saveWarmupSets = async (
    plan: WorkoutPlan,
    wk: number,
    wu: WarmupExercise,
    overrideEntries?: SetLogEntry[]
  ) => {
    if (!isOwnPlan(plan)) return;
    const wKey = weekKey(wk - 1);
    const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
    const rawEntries = overrideEntries || getWarmupSetEntries(plan, wk, wu);
    const cleanedEntries: SetLogEntry[] = rawEntries.map((s, idx) => ({
      setNumber: idx + 1,
      weight: (s.weight || '').trim(),
      unit: s.unit || planUnit,
      reps: (s.reps || '').trim(),
      rpe: (s.rpe || '').trim(),
    }));
    const existing: WarmupLogEntry = plan.warmupLogs?.[wKey]?.[wu.id] || {};
    const prevNormalized = JSON.stringify(
      (existing.setEntries || []).map(s => ({
        w: (s.weight || '').trim(),
        u: s.unit || planUnit,
        r: (s.reps || '').trim(),
        e: (s.rpe || '').trim(),
      }))
    );
    const nextNormalized = JSON.stringify(
      cleanedEntries.map(s => ({ w: s.weight, u: s.unit || planUnit, r: s.reps, e: s.rpe }))
    );
    if (prevNormalized === nextNormalized && existing.setEntries) return;

    const nextPlan: WorkoutPlan = {
      ...plan,
      warmupLogs: {
        ...(plan.warmupLogs || {}),
        [wKey]: {
          ...(plan.warmupLogs?.[wKey] || {}),
          [wu.id]: {
            ...existing,
            setEntries: cleanedEntries,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    };
    try {
      await saveWorkoutPlanDoc(nextPlan);
      setSavedNoticeId(`wu_saved_${wu.id}`);
      setTimeout(() => setSavedNoticeId(prev => (prev === `wu_saved_${wu.id}` ? null : prev)), 2000);
    } catch (err) {
      console.warn('Failed to save warm-up sets:', err);
    }
  };

  const updateWarmupSetField = (
    plan: WorkoutPlan,
    wk: number,
    wu: WarmupExercise,
    setIdx: number,
    field: 'weight' | 'reps' | 'rpe' | 'unit',
    value: string
  ) => {
    const key = warmupDraftKey(plan.id, wk, wu.id);
    const current = getWarmupSetEntries(plan, wk, wu);
    const updated = current.map((s, idx) =>
      idx === setIdx ? { ...s, setNumber: idx + 1, [field]: value } : s
    );
    setWarmupDraftSets(prev => ({ ...prev, [key]: updated }));
    if (field === 'unit') {
      saveWarmupSets(plan, wk, wu, updated);
    }
  };

  const adjustWarmupSetCount = (plan: WorkoutPlan, wk: number, wu: WarmupExercise, delta: 1 | -1) => {
    if (!isOwnPlan(plan)) return;
    const key = warmupDraftKey(plan.id, wk, wu.id);
    const current = getWarmupSetEntries(plan, wk, wu);
    const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
    let next = current;
    if (delta === 1 && current.length < 10) {
      const lastUnit = current[current.length - 1]?.unit || planUnit;
      next = [...current, { setNumber: current.length + 1, weight: '', unit: lastUnit, reps: '', rpe: '' }];
    } else if (delta === -1 && current.length > 1) {
      next = current.slice(0, current.length - 1);
    } else {
      return;
    }
    setWarmupDraftSets(prev => ({ ...prev, [key]: next }));
    saveWarmupSets(plan, wk, wu, next);
  };

  const sessionNoteDraftKey = (planId: string, wk: number, dayFilter: string) =>
    `${planId}__w${wk}__${getSessionNoteKey(dayFilter)}`;

  const isSessionNoteEnabled = (plan: WorkoutPlan, wk: number, dayFilter: string): boolean => {
    const dKey = sessionNoteDraftKey(plan.id, wk, dayFilter);
    if (dKey in sessionNoteEnabledOverrides) return sessionNoteEnabledOverrides[dKey];
    const wKey = weekKey(wk - 1);
    const noteKey = getSessionNoteKey(dayFilter);
    const entry = plan.exerciseLogs?.[wKey]?.[noteKey];
    if (typeof entry?.noteEnabled === 'boolean') return entry.noteEnabled;
    return Boolean(entry?.notes?.trim());
  };

  const toggleSessionNoteEnabled = async (plan: WorkoutPlan, wk: number, dayFilter: string, enabled: boolean) => {
    if (!isOwnPlan(plan)) return;
    const dKey = sessionNoteDraftKey(plan.id, wk, dayFilter);
    setSessionNoteEnabledOverrides(prev => ({ ...prev, [dKey]: enabled }));
    const wKey = weekKey(wk - 1);
    const noteKey = getSessionNoteKey(dayFilter);
    const prevEntry = plan.exerciseLogs?.[wKey]?.[noteKey] || {};
    const updatedWeekLogs: Record<string, ExerciseLogEntry> = {
      ...(plan.exerciseLogs?.[wKey] || {}),
      [noteKey]: {
        ...prevEntry,
        noteEnabled: enabled,
        day: dayFilter === 'ALL' ? 'All Days' : dayFilter.trim(),
        updatedAt: new Date().toISOString(),
      },
    };
    try {
      await saveWorkoutPlanDoc({
        ...plan,
        exerciseLogs: {
          ...(plan.exerciseLogs || {}),
          [wKey]: updatedWeekLogs,
        },
      });
    } catch (err) {
      console.warn('Failed to toggle session notes:', err);
    }
  };

  const getCurrentSessionNote = (plan: WorkoutPlan, wk: number, dayFilter: string): string => {
    const dKey = sessionNoteDraftKey(plan.id, wk, dayFilter);
    if (dKey in sessionNoteDrafts) return sessionNoteDrafts[dKey];
    const wKey = weekKey(wk - 1);
    const noteKey = getSessionNoteKey(dayFilter);
    return plan.exerciseLogs?.[wKey]?.[noteKey]?.notes || '';
  };

  const updateSessionNoteDraft = (plan: WorkoutPlan, wk: number, dayFilter: string, value: string) => {
    const dKey = sessionNoteDraftKey(plan.id, wk, dayFilter);
    setSessionNoteDrafts(prev => ({ ...prev, [dKey]: value }));
  };

  const saveSessionNotes = async (
    plan: WorkoutPlan,
    wk: number,
    dayFilter: string,
    overrideText?: string
  ) => {
    if (!isOwnPlan(plan)) return;
    const wKey = weekKey(wk - 1);
    const noteKey = getSessionNoteKey(dayFilter);
    const dKey = sessionNoteDraftKey(plan.id, wk, dayFilter);
    const rawText = overrideText !== undefined ? overrideText : (dKey in sessionNoteDrafts ? sessionNoteDrafts[dKey] : getCurrentSessionNote(plan, wk, dayFilter));
    const cleanedNotes = rawText.trim();

    const prevEntry = plan.exerciseLogs?.[wKey]?.[noteKey];
    const prevNotes = (prevEntry?.notes || '').trim();
    const enabled = isSessionNoteEnabled(plan, wk, dayFilter);
    if (cleanedNotes === prevNotes && prevEntry?.noteEnabled === enabled) return;

    const updatedWeekLogs: Record<string, ExerciseLogEntry> = {
      ...(plan.exerciseLogs?.[wKey] || {}),
    };

    if (cleanedNotes === '' && !enabled) {
      delete updatedWeekLogs[noteKey];
    } else {
      updatedWeekLogs[noteKey] = {
        ...(prevEntry || {}),
        notes: cleanedNotes,
        noteEnabled: enabled,
        day: dayFilter === 'ALL' ? 'All Days' : dayFilter.trim(),
        updatedAt: new Date().toISOString(),
      };
    }

    const nextPlan: WorkoutPlan = {
      ...plan,
      exerciseLogs: {
        ...(plan.exerciseLogs || {}),
        [wKey]: updatedWeekLogs,
      },
    };

    try {
      await saveWorkoutPlanDoc(nextPlan);
      setSessionNoteDrafts(prev => {
        const next = { ...prev };
        delete next[dKey];
        return next;
      });
      const badgeId = `session_note_${plan.id}_${wKey}_${noteKey}`;
      setSavedNoticeId(badgeId);
      setTimeout(() => setSavedNoticeId(prev => (prev === badgeId ? null : prev)), 2500);
    } catch (err) {
      console.warn('Failed to save session notes:', err);
    }
  };

  const persistWaterToProfile = (
    nextCount: number,
    remEnabled = waterReminderEnabledRef.current,
    remInterval = waterReminderIntervalRef.current,
    updatedAtIso = new Date().toISOString(),
    goalOverride?: { targetGlasses: number; targetLiters: number }
  ) => {
    const todayKey = getTodayDateKey();
    const tzOffset = -new Date().getTimezoneOffset();
    const goalInfo = goalOverride || computeWaterGoalFromBodyWeightEntries(bodyWeightEntries);

    // Always sync live count & personalized target to backend server cache so /water & closed-tab reminders stay current immediately
    fetch('/api/water-intake/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser,
        date: todayKey,
        timezoneOffsetMinutes: tzOffset,
        glasses: nextCount,
        goalGlasses: goalInfo.targetGlasses,
        targetLiters: goalInfo.targetLiters,
        updatedAt: updatedAtIso,
        reminderEnabled: remEnabled,
        reminderIntervalMinutes: remInterval,
      }),
    }).catch(() => {});

    const baseAccount = matchedAccountRef.current;
    if (!baseAccount || baseAccount.username?.toLowerCase().trim() === 'admin') return;
    const nextAccount: UserAccount = {
      ...baseAccount,
      waterIntake: {
        date: todayKey,
        glasses: nextCount,
        goalGlasses: goalInfo.targetGlasses,
        targetLiters: goalInfo.targetLiters,
        updatedAt: updatedAtIso,
        timezoneOffsetMinutes: tzOffset,
        reminderEnabled: remEnabled,
        reminderIntervalMinutes: remInterval,
      },
    };
    setLocalAccountOverride(nextAccount);
    saveUserAccountDoc(nextAccount).catch((err) => {
      console.warn('Failed to persist water intake to profile:', err);
    });
  };

  const adjustWaterGlasses = (delta: 1 | -1) => {
    const next = Math.max(0, Math.min(40, waterGlassesRef.current + delta));
    const updatedAtIso = new Date().toISOString();
    waterGlassesRef.current = next;
    setWaterGlasses(next);
    try {
      localStorage.setItem(
        getWaterStorageKey(currentUser),
        JSON.stringify({ count: next, updatedAt: updatedAtIso })
      );
    } catch {
      // ignore storage quota errors
    }
    persistWaterToProfile(next, waterReminderEnabledRef.current, waterReminderIntervalRef.current, updatedAtIso);
  };

  const resetWaterGlasses = () => {
    const updatedAtIso = new Date().toISOString();
    waterGlassesRef.current = 0;
    setWaterGlasses(0);
    try {
      localStorage.setItem(
        getWaterStorageKey(currentUser),
        JSON.stringify({ count: 0, updatedAt: updatedAtIso })
      );
    } catch {
      // ignore
    }
    persistWaterToProfile(0, waterReminderEnabledRef.current, waterReminderIntervalRef.current, updatedAtIso);
  };

  const saveWaterReminderPrefs = (enabled: boolean, intervalMinutes: number) => {
    const clampedInterval = Math.min(1440, Math.max(1, Math.round(intervalMinutes || 30)));
    waterReminderEnabledRef.current = enabled;
    waterReminderIntervalRef.current = clampedInterval;
    setWaterReminderEnabled(enabled);
    setWaterReminderIntervalMinutes(clampedInterval);
    setCustomWaterIntervalInput(String(clampedInterval));
    saveStoredWaterReminder(currentUser, enabled, clampedInterval);
    persistWaterToProfile(waterGlassesRef.current, enabled, clampedInterval);
  };

  const handleSaveBodyWeight = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const numeric = parseFloat(bodyWeightValueInput.replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 600) {
      setBodyWeightNotice('Enter a valid positive weight.');
      setTimeout(() => setBodyWeightNotice(null), 3000);
      return;
    }
    const cleanDate = bodyWeightDateInput.trim() || getTodayDateKey();
    const rounded = Math.round(numeric * 10) / 10;
    const cleanNote = bodyWeightNoteInput.trim();
    const existingIdx = bodyWeightEntries.findIndex(item => item.date === cleanDate);
    const nextEntry: BodyWeightEntry = {
      id: existingIdx >= 0 ? bodyWeightEntries[existingIdx].id : `bw_${cleanDate}_${Date.now().toString(36)}`,
      date: cleanDate,
      weight: rounded,
      unit: bodyWeightUnitInput,
      ...(cleanNote ? { note: cleanNote } : {}),
      updatedAt: new Date().toISOString(),
    };
    const nextList = (
      existingIdx >= 0
        ? bodyWeightEntries.map((item, idx) => (idx === existingIdx ? nextEntry : item))
        : [...bodyWeightEntries, nextEntry]
    ).sort((a, b) => a.date.localeCompare(b.date));

    setBodyWeightEntries(nextList);
    saveStoredBodyWeight(currentUser, nextList);
    setBodyWeightValueInput('');
    setBodyWeightNoteInput('');
    setBodyWeightNotice(existingIdx >= 0 ? `Updated ${cleanDate} (${rounded} ${bodyWeightUnitInput})` : `Saved ${rounded} ${bodyWeightUnitInput} for ${cleanDate}`);
    setTimeout(() => setBodyWeightNotice(null), 3500);

    const updatedGoal = computeWaterGoalFromBodyWeightEntries(nextList);
    const todayKey = getTodayDateKey();
    const tzOffset = -new Date().getTimezoneOffset();
    const nowIso = new Date().toISOString();

    fetch('/api/water-intake/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser,
        date: todayKey,
        timezoneOffsetMinutes: tzOffset,
        glasses: waterGlassesRef.current,
        goalGlasses: updatedGoal.targetGlasses,
        targetLiters: updatedGoal.targetLiters,
        updatedAt: nowIso,
        reminderEnabled: waterReminderEnabledRef.current,
        reminderIntervalMinutes: waterReminderIntervalRef.current,
      }),
    }).catch(() => {});

    const baseBwAccount = matchedAccountRef.current;
    if (baseBwAccount && baseBwAccount.username?.toLowerCase().trim() !== 'admin') {
      const nextAccount: UserAccount = {
        ...baseBwAccount,
        bodyWeightHistory: nextList,
        waterIntake: {
          ...(baseBwAccount.waterIntake || {}),
          date: todayKey,
          glasses: waterGlassesRef.current,
          goalGlasses: updatedGoal.targetGlasses,
          targetLiters: updatedGoal.targetLiters,
          updatedAt: nowIso,
          timezoneOffsetMinutes: tzOffset,
          reminderEnabled: waterReminderEnabledRef.current,
          reminderIntervalMinutes: waterReminderIntervalRef.current,
        },
      };
      setLocalAccountOverride(nextAccount);
      saveUserAccountDoc(nextAccount).catch(() => {});
    }
  };

  const handleDeleteBodyWeight = (entryId: string) => {
    const nextList = bodyWeightEntries.filter(item => item.id !== entryId);
    setBodyWeightEntries(nextList);
    saveStoredBodyWeight(currentUser, nextList);
    const updatedGoal = computeWaterGoalFromBodyWeightEntries(nextList);
    const todayKey = getTodayDateKey();
    const tzOffset = -new Date().getTimezoneOffset();
    const nowIso = new Date().toISOString();

    const baseBwAccount = matchedAccountRef.current;
    if (baseBwAccount && baseBwAccount.username?.toLowerCase().trim() !== 'admin') {
      const nextAccount: UserAccount = {
        ...baseBwAccount,
        bodyWeightHistory: nextList,
        waterIntake: {
          ...(baseBwAccount.waterIntake || {}),
          date: todayKey,
          glasses: waterGlassesRef.current,
          goalGlasses: updatedGoal.targetGlasses,
          targetLiters: updatedGoal.targetLiters,
          updatedAt: nowIso,
          timezoneOffsetMinutes: tzOffset,
          reminderEnabled: waterReminderEnabledRef.current,
          reminderIntervalMinutes: waterReminderIntervalRef.current,
        },
      };
      setLocalAccountOverride(nextAccount);
      saveUserAccountDoc(nextAccount).catch(() => {});
    }
  };

  const waterGoalSummary = useMemo(
    () => computeWaterGoalFromBodyWeightEntries(bodyWeightEntries),
    [bodyWeightEntries]
  );

  const handleQuickWaterWeightSave = (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = parseFloat(quickWaterWeightInput.replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 600) return;
    const today = getTodayDateKey();
    const rounded = Math.round(numeric * 10) / 10;
    const existingIdx = bodyWeightEntries.findIndex(item => item.date === today);
    const nextEntry: BodyWeightEntry = {
      id: existingIdx >= 0 ? bodyWeightEntries[existingIdx].id : `bw_${today}_${Date.now().toString(36)}`,
      date: today,
      weight: rounded,
      unit: quickWaterWeightUnit,
      updatedAt: new Date().toISOString(),
    };
    const nextList = (
      existingIdx >= 0
        ? bodyWeightEntries.map((item, idx) => (idx === existingIdx ? nextEntry : item))
        : [...bodyWeightEntries, nextEntry]
    ).sort((a, b) => a.date.localeCompare(b.date));
    setBodyWeightEntries(nextList);
    saveStoredBodyWeight(currentUser, nextList);
    setQuickWaterWeightInput('');

    const updatedGoal = computeWaterGoalFromBodyWeightEntries(nextList);
    const tzOffset = -new Date().getTimezoneOffset();
    const nowIso = new Date().toISOString();

    fetch('/api/water-intake/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser,
        date: today,
        timezoneOffsetMinutes: tzOffset,
        glasses: waterGlassesRef.current,
        goalGlasses: updatedGoal.targetGlasses,
        targetLiters: updatedGoal.targetLiters,
        updatedAt: nowIso,
        reminderEnabled: waterReminderEnabledRef.current,
        reminderIntervalMinutes: waterReminderIntervalRef.current,
      }),
    }).catch(() => {});

    const baseBwAccount = matchedAccountRef.current;
    if (baseBwAccount && baseBwAccount.username?.toLowerCase().trim() !== 'admin') {
      const nextAccount: UserAccount = {
        ...baseBwAccount,
        bodyWeightHistory: nextList,
        waterIntake: {
          ...(baseBwAccount.waterIntake || {}),
          date: today,
          glasses: waterGlassesRef.current,
          goalGlasses: updatedGoal.targetGlasses,
          targetLiters: updatedGoal.targetLiters,
          updatedAt: nowIso,
          timezoneOffsetMinutes: tzOffset,
          reminderEnabled: waterReminderEnabledRef.current,
          reminderIntervalMinutes: waterReminderIntervalRef.current,
        },
      };
      setLocalAccountOverride(nextAccount);
      saveUserAccountDoc(nextAccount).catch(() => {});
    }
  };

  const handleUploadBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgFeedback(null);
    if (!file.type.startsWith('image/')) {
      setBgFeedback({ type: 'error', text: 'Please select an image file (PNG, JPG, WEBP, GIF).' });
      return;
    }
    setIsUploadingBg(true);
    try {
      const dataUrl = await compressBackgroundImageToDataUrl(file);
      const bgSettingId = getUserBgSettingId(currentUser);
      const clampedDim = Math.min(95, Math.max(20, Math.round(userBgDimPercent)));

      // Primary production persistence: Firestore adminSettings document (works across Vercel, Cloud Run & multi-device)
      await saveAdminSettingDoc({
        id: bgSettingId,
        username: currentUser,
        imageUrl: dataUrl,
        dimPercent: clampedDim,
        updatedAt: new Date().toISOString(),
      } as AdminSetting);

      setUserBgImageUrl(dataUrl);
      setUserBgDimPercent(clampedDim);
      saveStoredUserBg(currentUser, dataUrl, clampedDim);

      // Optional best-effort local Node Express mirror (never throws if absent on Vercel serverless)
      fetch('/api/profile/background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser,
          fileName: file.name,
          dataUrl,
          dimPercent: clampedDim,
        }),
      }).catch(() => {});

      setBgFeedback({ type: 'success', text: 'Your personal website background has been updated and synced!' });
      setTimeout(() => setBgFeedback(null), 4000);
    } catch (err: any) {
      setBgFeedback({ type: 'error', text: err?.message || 'Failed to upload background image.' });
    } finally {
      setIsUploadingBg(false);
      if (bgFileInputRef.current) bgFileInputRef.current.value = '';
    }
  };

  const handleBgDimChange = (nextDim: number) => {
    const clamped = Math.min(95, Math.max(20, Math.round(nextDim)));
    setUserBgDimPercent(clamped);
    saveStoredUserBg(currentUser, userBgImageUrl, clamped);
    if (bgDimSaveTimerRef.current) clearTimeout(bgDimSaveTimerRef.current);
    bgDimSaveTimerRef.current = setTimeout(() => {
      if (!userBgImageUrl) return;
      const bgSettingId = getUserBgSettingId(currentUser);
      saveAdminSettingDoc({
        id: bgSettingId,
        username: currentUser,
        imageUrl: userBgImageUrl,
        dimPercent: clamped,
        updatedAt: new Date().toISOString(),
      } as AdminSetting).catch(() => {});
      fetch('/api/profile/background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, dimPercent: clamped }),
      }).catch(() => {});
    }, 350);
  };

  const handleRemoveUserBg = async () => {
    setBgFeedback(null);
    setUserBgImageUrl('');
    saveStoredUserBg(currentUser, '', 72);
    try {
      const bgSettingId = getUserBgSettingId(currentUser);
      await saveAdminSettingDoc({
        id: bgSettingId,
        username: currentUser,
        imageUrl: '',
        dimPercent: 72,
        updatedAt: new Date().toISOString(),
      } as AdminSetting);
      fetch(`/api/profile/background?username=${encodeURIComponent(currentUser)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser }),
      }).catch(() => {});
      setBgFeedback({ type: 'success', text: 'Background reset to default dark theme.' });
      setTimeout(() => setBgFeedback(null), 3500);
    } catch (err: any) {
      setBgFeedback({ type: 'error', text: err?.message || 'Could not reset cloud background setting.' });
    }
  };

  const dispatchWaterTelegramAlert = async (manual = false) => {
    if (isSendingWaterAlert || !hasTelegramUsernameRef.current) return;
    const tgCfg = activeTelegramConfigRef.current || activeTelegramConfig;
    const wlStatus = memberWhitelistStatusRef.current;
    const targetChat = resolvedMemberChatIdRef.current || resolvedMemberChatId;
    const liveGlasses = waterGlassesRef.current;
    const displayName = resolvedDisplayNameRef.current || currentUser;

    if (!tgCfg.enabled || !tgCfg.botToken.trim()) {
      if (manual) {
        setWaterAlertNotice({ type: 'error', text: 'Telegram Bot is not enabled in Admin Panel.' });
        setTimeout(() => setWaterAlertNotice(null), 4000);
      }
      return;
    }
    if (tgCfg.notifyWater === false) {
      if (manual) {
        setWaterAlertNotice({ type: 'error', text: 'Water intake alerts are turned off in Admin Panel.' });
        setTimeout(() => setWaterAlertNotice(null), 4000);
      }
      return;
    }
    if (wlStatus !== 'active') {
      if (manual) {
        setWaterAlertNotice({ type: 'error', text: 'Your Telegram account must be whitelisted by Admin first.' });
        setTimeout(() => setWaterAlertNotice(null), 4500);
      }
      return;
    }
    if (!targetChat) {
      if (manual) {
        setWaterAlertNotice({ type: 'error', text: 'Save your Chat ID in Profile -> Telegram Bot first.' });
        setTimeout(() => setWaterAlertNotice(null), 4500);
      }
      return;
    }

    setIsSendingWaterAlert(true);
    try {
      const targetGlasses = waterGoalSummary.targetGlasses;
      const targetLiters = waterGoalSummary.targetLiters;
      const note =
        liveGlasses >= targetGlasses
          ? 'Great work staying hydrated!'
          : 'Time for another glass of water to fuel your recovery!';
      const msg = formatWaterIntakeTelegramMessage(
        displayName,
        liveGlasses,
        targetGlasses,
        note,
        targetLiters
      );
      const res = await sendDirectTelegramMessage(tgCfg.botToken, targetChat, msg);
      if (res.success) {
        fetch('/api/water-intake/mark-sent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser, sentAtMs: Date.now() }),
        }).catch(() => {});
        setWaterAlertNotice({
          type: 'success',
          text: manual ? 'Water alert sent to Telegram Bot!' : 'Scheduled hydration alert sent!',
        });
      } else if (manual) {
        setWaterAlertNotice({ type: 'error', text: res.error || 'Failed to send water alert' });
      }
    } catch (err: any) {
      if (manual) {
        setWaterAlertNotice({ type: 'error', text: err?.message || 'Failed to send water alert' });
      }
    } finally {
      setIsSendingWaterAlert(false);
      setTimeout(() => setWaterAlertNotice(null), 4000);
    }
  };

  const startEditExercise = (ex: WorkoutExercise) => {
    const { setsDisplay, repsDisplay } = getExerciseTargetDisplay(ex);
    setEditingExerciseId(ex.id);
    setEditDraft({
      name: ex.name || '',
      day: ex.day || '',
      sets: setsDisplay || '',
      reps: repsDisplay || '',
      targetRpe: ex.targetRpe || '',
      targetRir: ex.targetRir || '',
      notes: ex.notes || '',
      videoUrl: ex.videoUrl || '',
      isSuperset: !!ex.isSuperset,
      supersetGroup: ex.supersetGroup || '',
    });
  };

  const saveEditExercise = async (plan: WorkoutPlan, ex: WorkoutExercise) => {
    if (!editDraft || !isOwnPlan(plan)) return;
    let nextSets = editDraft.sets.trim();
    let nextReps = editDraft.reps.trim();
    const split = splitSetsAndReps(nextSets);
    if (split) {
      nextSets = split.sets;
      if (!nextReps) nextReps = split.reps;
    }

    const updatedEx: WorkoutExercise = {
      id: ex.id,
      name: editDraft.name.trim() || ex.name,
      ...(editDraft.day.trim() ? { day: editDraft.day.trim() } : {}),
      ...(nextSets ? { sets: nextSets } : {}),
      ...(nextReps ? { reps: nextReps } : {}),
      ...(editDraft.targetRpe.trim() ? { targetRpe: editDraft.targetRpe.trim() } : {}),
      ...(editDraft.targetRir.trim() ? { targetRir: editDraft.targetRir.trim() } : {}),
      ...(editDraft.notes.trim() ? { notes: editDraft.notes.trim() } : {}),
      ...(editDraft.videoUrl.trim() ? { videoUrl: editDraft.videoUrl.trim() } : {}),
      ...(editDraft.isSuperset ? { isSuperset: true } : {}),
      ...(editDraft.isSuperset && editDraft.supersetGroup.trim() ? { supersetGroup: editDraft.supersetGroup.trim() } : {}),
    };

    const nextExercises = plan.exercises.map(item => (item.id === ex.id ? updatedEx : item));
    const newTargetCount = parseSetsCount(updatedEx.sets);

    // Resize current week set rows if user changed target Sets count and no weights/reps have been dropped unexpectedly
    const dKey = draftKey(plan.id, selectedWeek, ex.id);
    const currEntries = getCurrentSetEntries(plan, selectedWeek, ex);
    const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
    let resizedEntries = currEntries;
    if (currEntries.length < newTargetCount) {
      resizedEntries = [
        ...currEntries,
        ...Array.from({ length: newTargetCount - currEntries.length }, (_, i) => ({
          setNumber: currEntries.length + i + 1,
          weight: '',
          unit: planUnit,
          reps: '',
          rpe: '',
          rir: '',
        })),
      ];
    } else if (currEntries.length > newTargetCount) {
      // Only shrink trailing empty sets so logged weights/reps/RPE/RIR are never lost
      const copy = [...currEntries];
      while (copy.length > newTargetCount) {
        const tail = copy[copy.length - 1];
        if (!tail.weight.trim() && !tail.reps.trim() && !(tail.rpe || '').trim() && !(tail.rir || '').trim()) {
          copy.pop();
        } else {
          break;
        }
      }
      resizedEntries = copy;
    }

    const wKey = weekKey(selectedWeek - 1);
    const updatedWeekLog: ExerciseLogEntry | undefined = plan.exerciseLogs?.[wKey]?.[ex.id]
      ? {
          ...plan.exerciseLogs[wKey][ex.id],
          sets: String(resizedEntries.length),
          setEntries: resizedEntries,
        }
      : undefined;

    const nextPlan: WorkoutPlan = {
      ...plan,
      exercises: nextExercises,
      ...(editDraft.targetRpe.trim() ? { hasRpeColumn: true } : {}),
      ...(editDraft.targetRir.trim() ? { hasRirColumn: true } : {}),
      ...(updatedWeekLog
        ? {
            exerciseLogs: {
              ...(plan.exerciseLogs || {}),
              [wKey]: {
                ...(plan.exerciseLogs?.[wKey] || {}),
                [ex.id]: updatedWeekLog,
              },
            },
          }
        : {}),
    };

    setDraftSets(prev => ({ ...prev, [dKey]: resizedEntries }));
    setEditingExerciseId(null);
    setEditDraft(null);

    try {
      await saveWorkoutPlanDoc(nextPlan);
      setSavedNoticeId(ex.id);
      setTimeout(() => setSavedNoticeId(prev => (prev === ex.id ? null : prev)), 2000);
    } catch (err) {
      console.warn('Failed to update exercise:', err);
    }
  };

  const toggleExercise = (plan: WorkoutPlan, weekIdx: number, exerciseId: string) => {
    if (!isOwnPlan(plan)) return;
    const key = weekKey(weekIdx);
    const dKey = draftKey(plan.id, weekIdx + 1, exerciseId);
    const current = plan.progress?.[key] || [];
    const wasChecked = current.includes(exerciseId);
    if (wasChecked) {
      manuallyUncheckedRef.current.add(dKey);
      manuallyCheckedRef.current.delete(dKey);
    } else {
      manuallyUncheckedRef.current.delete(dKey);
      manuallyCheckedRef.current.add(dKey);
    }
    const updated = wasChecked
      ? current.filter((id) => id !== exerciseId)
      : [...current, exerciseId];
    const next: WorkoutPlan = { ...plan, progress: { ...(plan.progress || {}), [key]: updated } };
    saveWorkoutPlanDoc(next).catch((err) => console.warn('Failed to save progress to Firestore:', err));
  };

  const confirmDeletePlan = async () => {
    if (!planToDelete || !isOwnPlan(planToDelete)) return;
    const id = planToDelete.id;
    setIsDeletingPlan(true);
    if (selectedPlanId === id) setSelectedPlanId(null);
    setPlans((prev) => prev.filter((p) => p.id !== id));
    try {
      await deleteWorkoutPlanDoc(id);
      setPlanToDelete(null);
    } catch (err) {
      console.warn('Failed to delete plan from Firestore:', err);
    } finally {
      setIsDeletingPlan(false);
    }
  };

  const handleExportPlanPdf = (plan: WorkoutPlan) => {
    if (!isOwnPlan(plan)) return;
    setOpenExportMenu(null);
    try {
      const filename = exportWorkoutPlanToPdf(plan, {
        ownerName: resolvedDisplayName,
        waterGlasses,
      });
      setExportNotice(`Exported ${filename}`);
      setTimeout(() => setExportNotice(prev => (prev === `Exported ${filename}` ? null : prev)), 3000);
    } catch (err) {
      console.warn('PDF export failed:', err);
    }
  };

  const handleExportPlanExcel = async (plan: WorkoutPlan) => {
    if (!isOwnPlan(plan) || isExportingExcel) return;
    setOpenExportMenu(null);
    setIsExportingExcel(true);
    try {
      const filename = await exportWorkoutPlanToExcel(plan, {
        ownerName: resolvedDisplayName,
        waterGlasses,
      });
      setExportNotice(`Exported ${filename}`);
      setTimeout(() => setExportNotice(prev => (prev === `Exported ${filename}` ? null : prev)), 3000);
    } catch (err) {
      console.warn('Excel export failed:', err);
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportAllPlansPdf = () => {
    const owned = myPlans.filter(p => isOwnPlan(p));
    if (owned.length === 0) return;
    setOpenExportMenu(null);
    const filename = exportAllWorkoutPlansToPdf(owned, {
      ownerName: resolvedDisplayName,
      waterGlasses,
    });
    setExportNotice(`Exported all ${owned.length} workouts -> ${filename}`);
    setTimeout(() => setExportNotice(prev => (prev?.includes(filename) ? null : prev)), 3500);
  };

  const handleExportAllPlansExcel = async () => {
    const owned = myPlans.filter(p => isOwnPlan(p));
    if (owned.length === 0 || isExportingExcel) return;
    setOpenExportMenu(null);
    setIsExportingExcel(true);
    try {
      const filename = await exportAllWorkoutPlansToExcel(owned, {
        ownerName: resolvedDisplayName,
        waterGlasses,
      });
      setExportNotice(`Exported all ${owned.length} workouts -> ${filename}`);
      setTimeout(() => setExportNotice(prev => (prev?.includes(filename) ? null : prev)), 3500);
    } catch (err) {
      console.warn('Multi-workout Excel export failed:', err);
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleSendSheetToTelegram = async (plan: WorkoutPlan, format: 'pdf' | 'excel') => {
    if (!isOwnPlan(plan) || isSendingSheetToBot || !hasTelegramUsername) return;
    setOpenExportMenu(null);
    const botToken = activeTelegramConfig.botToken?.trim();
    if (!botToken) {
      setExportNotice('Telegram Bot Token is not configured in Admin Panel yet.');
      setTimeout(() => setExportNotice(null), 4000);
      return;
    }
    if (memberWhitelistStatus !== 'active') {
      setExportNotice('Telegram account must be whitelisted by Admin to send sheets to Bot.');
      setTimeout(() => setExportNotice(null), 4500);
      return;
    }
    if (!resolvedMemberChatId) {
      setExportNotice('Save your personal Telegram Chat ID in Profile -> Telegram Bot first.');
      setTimeout(() => setExportNotice(null), 4500);
      return;
    }

    setIsSendingSheetToBot(format);
    try {
      if (format === 'pdf') {
        const { filename, buffer } = exportWorkoutPlanToPdfBuffer(plan, {
          ownerName: resolvedDisplayName,
          waterGlasses,
        });
        const caption = `📄 <b>${plan.title}</b> (PDF)\nAthlete: <b>${resolvedDisplayName}</b> • ${plan.exercises.length} exercises • ${plan.weeks}w`;
        const res = await sendTelegramDocumentFile({
          botToken,
          chatId: resolvedMemberChatId,
          bytes: buffer,
          filename,
          mimeType: 'application/pdf',
          caption,
        });
        setExportNotice(res.success ? `Sent ${filename} to Telegram Bot!` : (res.error || 'Failed to send PDF to Bot'));
      } else {
        const { filename, buffer } = await exportWorkoutPlanToExcelBuffer(plan, {
          ownerName: resolvedDisplayName,
          waterGlasses,
        });
        const caption = `📊 <b>${plan.title}</b> (Excel .xlsx)\nIncludes Workout Sheet, Daily Analytics, Set-by-Set Log, Warm-up & Hydration & Notes.`;
        const res = await sendTelegramDocumentFile({
          botToken,
          chatId: resolvedMemberChatId,
          bytes: buffer,
          filename,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          caption,
        });
        setExportNotice(res.success ? `Sent ${filename} to Telegram Bot!` : (res.error || 'Failed to send Excel sheet to Bot'));
      }
    } catch (err: any) {
      setExportNotice(err?.message || 'Failed to send sheet to Telegram Bot');
    } finally {
      setIsSendingSheetToBot(null);
      setTimeout(() => setExportNotice(null), 4000);
    }
  };

  const renderExportControl = (
    plan: WorkoutPlan,
    menuId: 'toolbar' | 'dashboard' | 'profile',
    variant: 'toolbar' | 'hero' | 'profile'
  ) => {
    const isOpen = openExportMenu === menuId;
    const buttonClasses =
      variant === 'hero'
        ? 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white text-xs font-bold shadow-lg shadow-red-950/50 transition-all cursor-pointer whitespace-nowrap shrink-0'
        : variant === 'profile'
        ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 cursor-pointer whitespace-nowrap shrink-0'
        : 'h-9 px-2.5 sm:px-3 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold border bg-red-600/20 hover:bg-red-600/35 text-red-200 border-red-500/35 cursor-pointer whitespace-nowrap';

    const busy = isExportingExcel || isSendingSheetToBot !== null;

    const dropdownMenu =
      isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="menu"
              data-export-menu-portal="true"
              style={
                exportMenuCoords
                  ? {
                      position: 'fixed',
                      left: `${exportMenuCoords.left}px`,
                      ...(exportMenuCoords.top !== undefined ? { top: `${exportMenuCoords.top}px` } : {}),
                      ...(exportMenuCoords.bottom !== undefined ? { bottom: `${exportMenuCoords.bottom}px` } : {}),
                      width: '264px',
                    }
                  : {
                      position: 'fixed',
                      top: '-9999px',
                      left: '-9999px',
                      width: '264px',
                    }
              }
              className="rounded-xl border border-white/20 bg-neutral-950/98 backdrop-blur-xl shadow-2xl shadow-black/80 p-1.5 z-[9999] space-y-1"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => handleExportPlanPdf(plan)}
                className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-red-500/15 text-left transition-colors cursor-pointer"
              >
                <FileText className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white">Export as PDF (.pdf)</div>
                  <div className="text-[11px] text-neutral-400 leading-snug">Combined by days, RPE &amp; weekly history</div>
                </div>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={isExportingExcel}
                onClick={() => handleExportPlanExcel(plan)}
                className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-emerald-500/15 disabled:opacity-50 text-left transition-colors cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white">Export as Excel (.xlsx)</div>
                  <div className="text-[11px] text-neutral-400 leading-snug">Full sheet, Previous, analytics &amp; weekly logs</div>
                </div>
              </button>

              {myPlans.filter(p => isOwnPlan(p)).length > 1 && (
                <div className="border-t border-white/10 my-1 pt-1 space-y-1">
                  <div className="px-3 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    All Workouts ({myPlans.filter(p => isOwnPlan(p)).length} Splits)
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleExportAllPlansPdf}
                    className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-amber-500/15 text-left transition-colors cursor-pointer"
                  >
                    <Layers className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white">Export All Workouts (.pdf)</div>
                      <div className="text-[11px] text-neutral-400 leading-snug">All uploaded splits combined in 1 PDF</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isExportingExcel}
                    onClick={handleExportAllPlansExcel}
                    className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-emerald-500/15 disabled:opacity-50 text-left transition-colors cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white">Export All Workouts (.xlsx)</div>
                      <div className="text-[11px] text-neutral-400 leading-snug">1 tab per split + combined analytics</div>
                    </div>
                  </button>
                </div>
              )}

              {hasTelegramUsername && (
                <div className="border-t border-white/10 my-1 pt-1 space-y-1">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isSendingSheetToBot !== null}
                    onClick={() => handleSendSheetToTelegram(plan, 'pdf')}
                    className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-sky-500/15 disabled:opacity-50 text-left transition-colors cursor-pointer"
                  >
                    <Send className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white">Send PDF to Telegram Bot</div>
                      <div className="text-[11px] text-neutral-400 leading-snug">Delivers .pdf file to your bot chat</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isSendingSheetToBot !== null}
                    onClick={() => handleSendSheetToTelegram(plan, 'excel')}
                    className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-sky-500/15 disabled:opacity-50 text-left transition-colors cursor-pointer"
                  >
                    <Send className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white">Send Excel to Telegram Bot</div>
                      <div className="text-[11px] text-neutral-400 leading-snug">Delivers .xlsx sheet to your bot chat</div>
                    </div>
                  </button>
                </div>
              )}
            </div>,
            document.body
          )
        : null;

    return (
      <div className="relative" data-export-menu-root="true">
        <button
          ref={(el) => {
            exportButtonRefs.current[menuId] = el;
          }}
          type="button"
          onClick={() => setOpenExportMenu(prev => (prev === menuId ? null : menuId))}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={`Export ${plan.title} as PDF or Excel`}
          className={buttonClasses}
          title={
            hasTelegramUsername
              ? 'Export workout plan as PDF or Excel (.xlsx), or send directly to Telegram Bot'
              : 'Export workout plan as PDF or Excel (.xlsx)'
          }
        >
          {busy ? (
            <Loader2 className={`w-3.5 h-3.5 animate-spin ${variant === 'hero' ? 'text-white' : 'text-red-400'}`} />
          ) : (
            <Download className={`w-3.5 h-3.5 ${variant === 'hero' ? 'text-white' : 'text-red-400'}`} />
          )}
          <span className={variant === 'toolbar' ? 'hidden sm:inline' : ''}>Export</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {dropdownMenu}
      </div>
    );
  };

  // Helper to resolve the canonical writable UserAccount document for currentUser
  const resolveWritableAccount = async (): Promise<UserAccount | null> => {
    if (matchedAccountRef.current) return { ...matchedAccountRef.current };
    const clean = (currentUser || '').toLowerCase().trim();
    if (!clean || clean === 'admin') return null;
    try {
      const fsUsers = await getFirestoreUserAccounts();
      const found = fsUsers.find(
        u =>
          u.username?.toLowerCase().trim() === clean ||
          u.id?.toLowerCase().trim() === clean ||
          u.id?.toLowerCase().trim() === `user_${clean}`
      );
      if (found) return { ...found };
    } catch {
      // ignore lookup error
    }
    return null;
  };

  const handleSaveProfileDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileFeedback(null);
    const trimmedName = profileDisplayName.trim();
    if (!trimmedName) {
      setProfileFeedback({ type: 'error', text: 'Display name cannot be empty.' });
      return;
    }
    setIsSavingProfile(true);
    try {
      const baseAccount = await resolveWritableAccount();
      if (!baseAccount) {
        setProfileFeedback({ type: 'error', text: 'Account profile is still syncing. Please wait a moment and try again.' });
        return;
      }
      const nextAccount: UserAccount = {
        ...baseAccount,
        displayName: trimmedName,
        gender: profileGender,
        weightUnitPreference: profileWeightUnit,
      };
      await saveUserAccountDoc(nextAccount);
      setLocalAccountOverride(nextAccount);
      await logActivity(currentUser, 'profile_updated', `Updated display name to "${trimmedName}" (${profileWeightUnit.toUpperCase()}).`).catch(() => {});
      setProfileFeedback({ type: 'success', text: 'Profile details saved and synchronized!' });
      setTimeout(() => setProfileFeedback(null), 4000);
    } catch (err: any) {
      setProfileFeedback({ type: 'error', text: `Failed to save profile: ${err?.message || String(err)}` });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (!oldPasswordInput) {
      setPasswordFeedback({ type: 'error', text: 'Please enter your current (old) password.' });
      return;
    }
    if (!newPasswordInput) {
      setPasswordFeedback({ type: 'error', text: 'Please enter a new password.' });
      return;
    }
    if (newPasswordInput.length < 6) {
      setPasswordFeedback({ type: 'error', text: 'New password must be at least 6 characters long.' });
      return;
    }
    if (newPasswordInput !== confirmPasswordInput) {
      setPasswordFeedback({ type: 'error', text: 'New password and Confirm New Password do not match.' });
      return;
    }
    if (oldPasswordInput === newPasswordInput) {
      setPasswordFeedback({ type: 'error', text: 'New password must be different from your current password.' });
      return;
    }

    const baseAccount = await resolveWritableAccount();
    if (!baseAccount) {
      setPasswordFeedback({ type: 'error', text: 'Account profile is still syncing. Please wait a moment and try again.' });
      return;
    }
    if (baseAccount.password) {
      const oldMatches = await verifyPassword(oldPasswordInput, baseAccount.password);
      if (!oldMatches) {
        setPasswordFeedback({ type: 'error', text: 'Current (old) password is incorrect.' });
        return;
      }
    }

    setIsChangingPassword(true);
    try {
      const hashedNew = await hashPassword(newPasswordInput);
      const updatedAccount: UserAccount = {
        ...baseAccount,
        password: hashedNew,
      };
      await saveUserAccountDoc(updatedAccount);
      setLocalAccountOverride(updatedAccount);
      setOldPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      await logActivity(currentUser, 'password_changed', `Member "${currentUser}" changed their account password.`).catch(() => {});
      if (hasTelegramUsername) {
        sendTelegramAlert(
          formatSecurityAlertTelegramMessage(currentUser, 'password_changed', `Password updated for member "${resolvedDisplayName}" (@${currentUser}).`),
          'security',
          { targetUsername: currentUser, adminSettings, userAccounts: [...userAccounts.filter(u => u.id !== updatedAccount.id), updatedAccount] }
        ).catch(() => {});
      }
      setPasswordFeedback({ type: 'success', text: 'Password updated securely!' });
      setTimeout(() => setPasswordFeedback(null), 5000);
    } catch (err: any) {
      setPasswordFeedback({ type: 'error', text: `Failed to update password: ${err?.message || String(err)}` });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const activeTelegramConfig = useMemo(() => getTelegramConfig(adminSettings), [adminSettings]);

  const memberWhitelistStatus = useMemo<'active' | 'paused' | 'not_whitelisted'>(() => {
    const cleanBareHandle = tgUsernameInput.trim().replace(/^@/, '').toLowerCase();
    const cleanChat = tgChatIdInput.trim();
    const cleanUserLower = currentUser.toLowerCase().trim();

    const matchingAuth = (activeTelegramConfig.authorizedUsers || []).filter((u) => {
      const uApp = (u.appUsername || '').trim().toLowerCase();
      const uBare = (u.telegramUsername || '').trim().replace(/^@/, '').toLowerCase();
      const uChat = (u.chatId || '').trim();
      return (
        (uApp && uApp === cleanUserLower) ||
        (cleanBareHandle && uBare === cleanBareHandle) ||
        (cleanChat && uChat === cleanChat)
      );
    });

    if (matchingAuth.some((u) => u.isActive === false)) return 'paused';
    if (matchingAuth.some((u) => u.isActive !== false)) return 'active';

    const inWhitelist =
      Boolean(cleanBareHandle) &&
      (activeTelegramConfig.whitelistedUsernames || []).some(
        (w) => (w || '').trim().replace(/^@/, '').toLowerCase() === cleanBareHandle
      );
    const isPrimaryChat =
      Boolean(cleanChat && activeTelegramConfig.chatId?.trim()) &&
      activeTelegramConfig.chatId!.trim() === cleanChat;

    return inWhitelist || isPrimaryChat ? 'active' : 'not_whitelisted';
  }, [activeTelegramConfig, tgUsernameInput, tgChatIdInput, currentUser]);

  const resolvedMemberChatId = useMemo(() => {
    const fromInput = tgChatIdInput.trim();
    if (fromInput) return fromInput;
    const fromAccount = matchedAccount?.telegramChatId?.trim();
    if (fromAccount) return fromAccount;

    const cleanUserLower = currentUser.toLowerCase().trim();
    const cleanBareHandle = tgUsernameInput.trim().replace(/^@/, '').toLowerCase();
    const matchingAuth = (activeTelegramConfig.authorizedUsers || []).find((u) => {
      if (u.isActive === false || !u.chatId?.trim()) return false;
      const uApp = (u.appUsername || '').trim().toLowerCase();
      const uBare = (u.telegramUsername || '').trim().replace(/^@/, '').toLowerCase();
      return (uApp && uApp === cleanUserLower) || (cleanBareHandle && uBare === cleanBareHandle);
    });
    return matchingAuth?.chatId?.trim() || '';
  }, [tgChatIdInput, matchedAccount?.telegramChatId, activeTelegramConfig.authorizedUsers, currentUser, tgUsernameInput]);

  const hasTelegramUsername = Boolean((matchedAccount?.telegramUsername || '').trim());

  activeTelegramConfigRef.current = activeTelegramConfig;
  memberWhitelistStatusRef.current = memberWhitelistStatus;
  resolvedMemberChatIdRef.current = resolvedMemberChatId;
  hasTelegramUsernameRef.current = hasTelegramUsername;

  useEffect(() => {
    if (!hasTelegramUsername || !waterReminderEnabled) return;
    if (memberWhitelistStatus !== 'active' || !resolvedMemberChatId) return;
    if (!activeTelegramConfig.enabled || activeTelegramConfig.notifyWater === false || !activeTelegramConfig.botToken.trim()) return;

    const intervalMs = Math.max(1, Math.min(1440, waterReminderIntervalMinutes || 30)) * 60 * 1000;
    const timer = window.setInterval(() => {
      dispatchWaterTelegramAlert(false);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [
    hasTelegramUsername,
    waterReminderEnabled,
    waterReminderIntervalMinutes,
    memberWhitelistStatus,
    resolvedMemberChatId,
    activeTelegramConfig.enabled,
    activeTelegramConfig.notifyWater,
    activeTelegramConfig.botToken,
  ]);

  const handleSaveMemberTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    setTelegramFeedback(null);
    const cleanHandle = tgUsernameInput.trim()
      ? (tgUsernameInput.trim().startsWith('@') ? tgUsernameInput.trim().toLowerCase() : `@${tgUsernameInput.trim().toLowerCase()}`)
      : '';
    const cleanChatId = tgChatIdInput.trim();

    setIsSavingTelegram(true);
    try {
      const baseAccount = await resolveWritableAccount();
      if (!baseAccount) {
        setTelegramFeedback({ type: 'error', text: 'Account profile is still syncing. Please wait a moment and try again.' });
        return;
      }
      const nextAccount: UserAccount = {
        ...baseAccount,
        telegramUsername: cleanHandle || undefined,
        telegramChatId: cleanChatId || undefined,
        telegramNotificationsEnabled: tgNotificationsEnabled,
      };
      await saveUserAccountDoc(nextAccount);
      setLocalAccountOverride(nextAccount);

      // Update ONLY an existing Admin-approved authorizedUsers entry for this member (never self-whitelist)
      const cleanUserLower = currentUser.toLowerCase().trim();
      const hasExistingEntry = (activeTelegramConfig.authorizedUsers || []).some(
        (u) =>
          (u.appUsername || '').trim().toLowerCase() === cleanUserLower ||
          (cleanHandle && u.telegramUsername.toLowerCase() === cleanHandle)
      );
      if (hasExistingEntry && activeTelegramConfig.botToken) {
        const updatedTgCfg = {
          ...activeTelegramConfig,
          authorizedUsers: (activeTelegramConfig.authorizedUsers || []).map((u) => {
            const matchesThisMember =
              (u.appUsername || '').trim().toLowerCase() === cleanUserLower ||
              (cleanHandle && u.telegramUsername.toLowerCase() === cleanHandle);
            if (!matchesThisMember) return u;
            return {
              ...u,
              chatId: cleanChatId || u.chatId,
              appUsername: u.appUsername || currentUser,
              confirmed: Boolean(cleanChatId || u.chatId),
            };
          }),
        };
        await persistTelegramConfig(updatedTgCfg, async (setting) => {
          await saveAdminSettingDoc(setting);
        }).catch(() => {});
      }

      await logActivity(currentUser, 'telegram_profile_updated', `Updated Telegram settings (${cleanHandle || 'no handle'}${cleanChatId ? `, Chat ID: ${cleanChatId}` : ''}).`).catch(() => {});
      setTelegramFeedback({ type: 'success', text: 'Telegram settings saved!' });
      setTimeout(() => setTelegramFeedback(null), 4000);
    } catch (err: any) {
      setTelegramFeedback({ type: 'error', text: `Failed to save Telegram settings: ${err?.message || String(err)}` });
    } finally {
      setIsSavingTelegram(false);
    }
  };

  const handleAutoDetectTelegramChatId = async () => {
    setTelegramFeedback(null);
    if (!activeTelegramConfig.botToken?.trim()) {
      setTelegramFeedback({ type: 'error', text: 'Bot token is not configured by Admin yet. Ask your coach/admin to set the Telegram Bot Token first.' });
      return;
    }
    const cleanInputHandle = tgUsernameInput.trim().toLowerCase();
    if (!cleanInputHandle) {
      setTelegramFeedback({ type: 'error', text: 'Enter your exact Telegram @username first, then click Auto-Detect.' });
      return;
    }
    setIsDetectingTelegram(true);
    try {
      const detailed = await fetchTelegramChatIdsDetailed(activeTelegramConfig.botToken);
      const candidates = [
        cleanInputHandle.startsWith('@') ? cleanInputHandle : `@${cleanInputHandle}`,
        cleanInputHandle.replace(/^@/, ''),
      ].filter(Boolean);

      let foundChatId = '';
      let foundHandle = '';
      for (const c of candidates) {
        if (detailed.mapped[c]?.chatId) {
          foundChatId = detailed.mapped[c].chatId;
          foundHandle = c.startsWith('@') ? c : `@${c}`;
          break;
        }
      }
      if (!foundChatId && detailed.senders.length > 0) {
        const matchingSender = detailed.senders.find(s =>
          candidates.some(c =>
            s.username?.toLowerCase() === c ||
            s.username?.replace(/^@/, '').toLowerCase() === c
          )
        );
        if (matchingSender) {
          foundChatId = matchingSender.chatId;
          foundHandle = matchingSender.username || foundHandle;
        }
      }

      if (foundChatId) {
        setTgChatIdInput(foundChatId);
        if (foundHandle && !tgUsernameInput.trim()) setTgUsernameInput(foundHandle);
        setTelegramFeedback({ type: 'success', text: `Detected Chat ID ${foundChatId}! Click Save Telegram Settings to lock it in.` });
      } else {
        setTelegramFeedback({
          type: 'error',
          text: 'No matching message found yet. Open the Telegram bot, send /start or /confirm, and click Auto-Detect again.',
        });
      }
    } catch (err: any) {
      setTelegramFeedback({ type: 'error', text: `Auto-detect failed: ${err?.message || String(err)}` });
    } finally {
      setIsDetectingTelegram(false);
    }
  };

  const handleSendTestTelegram = async () => {
    setTelegramFeedback(null);
    const token = activeTelegramConfig.botToken?.trim();
    const chatId = tgChatIdInput.trim();
    if (!token) {
      setTelegramFeedback({ type: 'error', text: 'Telegram Bot Token is not configured in Admin Settings yet.' });
      return;
    }
    if (!chatId) {
      setTelegramFeedback({ type: 'error', text: 'Please enter or Auto-Detect your Telegram Chat ID first.' });
      return;
    }
    setIsTestingTelegram(true);
    try {
      const msg =
        `🏋️ <b>Gym Workout Profile Test</b>\n\n` +
        `Hello <b>${resolvedDisplayName}</b> (@${currentUser})!\n` +
        `Your Telegram notifications are linked and working properly.`;
      const res = await sendDirectTelegramMessage(token, chatId, msg);
      if (res.success) {
        setTelegramFeedback({ type: 'success', text: 'Test alert sent to your Telegram!' });
      } else {
        setTelegramFeedback({ type: 'error', text: res.error || 'Telegram API rejected the message.' });
      }
    } catch (err: any) {
      setTelegramFeedback({ type: 'error', text: err?.message || 'Failed to send test alert.' });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleSaveMember2FA = async (secret: string, backupCodes: string[]) => {
    const baseAccount = await resolveWritableAccount();
    if (!baseAccount) {
      throw new Error('Account profile is still syncing. Please try again in a moment.');
    }
    const nextAccount: UserAccount = {
      ...baseAccount,
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorBackupCodes: backupCodes,
      twoFactorCreatedAt: new Date().toISOString(),
    };
    await saveUserAccountDoc(nextAccount);
    setLocalAccountOverride(nextAccount);
    await logActivity(currentUser, 'security_2fa_enabled', `Member "${currentUser}" enabled 2FA from Profile.`).catch(() => {});
  };

  const handleDisableMember2FA = async () => {
    const baseAccount = await resolveWritableAccount();
    if (!baseAccount) {
      throw new Error('Account profile is still syncing. Please try again in a moment.');
    }
    const nextAccount: UserAccount = {
      ...baseAccount,
      twoFactorEnabled: false,
      twoFactorSecret: '',
      twoFactorBackupCodes: [],
      twoFactorCreatedAt: '',
    };
    await saveUserAccountDoc(nextAccount);
    setLocalAccountOverride(nextAccount);
    await logActivity(currentUser, 'security_2fa_disabled', `Member "${currentUser}" disabled 2FA from Profile.`).catch(() => {});
  };

  const startModifyWorksheet = (plan: WorkoutPlan) => {
    setEditingExerciseId(null);
    setEditDraft(null);
    setWorksheetImportNotice(null);
    setWorksheetEditPlanId(plan.id);
    setWorksheetDraft({
      title: plan.title || '',
      description: plan.description || '',
      instructions: plan.instructions || '',
      weeks: Math.max(1, plan.weeks || 1),
      defaultWeightUnit: plan.defaultWeightUnit || 'kg',
      sourceFileName: plan.sourceFileName,
      hasRpeColumn: planHasRpeColumn(plan),
      hasRirColumn: planHasRirColumn(plan),
      exercises: (plan.exercises || []).map((ex) => {
        const { setsDisplay, repsDisplay } = getExerciseTargetDisplay(ex);
        return {
          id: ex.id,
          day: ex.day || '',
          name: ex.name || '',
          sets: setsDisplay || '',
          reps: repsDisplay || '',
          targetRpe: ex.targetRpe || '',
          targetRir: ex.targetRir || '',
          notes: ex.notes || '',
          videoUrl: ex.videoUrl || '',
          isSuperset: !!ex.isSuperset,
          supersetGroup: ex.supersetGroup || '',
        };
      }),
    });
  };

  const handleImportSheetIntoWorksheetDraft = async (file: File, plan: WorkoutPlan) => {
    if (!worksheetDraft) return;
    setWorksheetImportNotice('Scanning updated worksheet file...');
    try {
      const detected = await parseSheetFileAllSheets(file);
      const workoutTabs = detected.filter(s => s.suggestedRole === 'workout' && s.exercises.length > 0);
      const fallbackTab = detected.find(s => s.exercises.length > 0);
      const activeTabs = workoutTabs.length > 0 ? workoutTabs : fallbackTab ? [fallbackTab] : [];

      if (activeTabs.length === 0) {
        setWorksheetImportNotice('No exercise rows found in the uploaded file.');
        return;
      }

      // If this workbook splits days across separate tabs AND the target plan corresponds to one specific day tab,
      // match that specific tab; otherwise consolidate ALL workout tabs (including Week 1..N tabs & multi-day tabs).
      const matchingDayTab =
        activeTabs.length > 1
          ? activeTabs.find(
              s =>
                s.name.trim().toLowerCase() === plan.title.trim().toLowerCase() ||
                (plan.sheetName &&
                  !plan.sheetName.includes(',') &&
                  plan.sheetName.toLowerCase().includes(s.name.toLowerCase()) &&
                  !plan.exercises.some(e => e.day && e.day.trim().toLowerCase() !== plan.title.trim().toLowerCase()))
            )
          : undefined;

      const tabsToMerge = matchingDayTab ? [matchingDayTab] : activeTabs;
      const consolidated = consolidateMultiTabWorkoutSheets(
        tabsToMerge.map(t => ({
          name: t.name,
          exercises: t.exercises,
          hasRpeColumn: t.hasRpeColumn,
          hasRirColumn: t.hasRirColumn,
          detectedDataWeeks: t.detectedDataWeeks,
        }))
      );

      let importedExercises = consolidated.exercises;
      const importedDays = Array.from(
        new Set(importedExercises.map(ex => (ex.day || '').trim()).filter(Boolean))
      );

      // If this plan only covers ONE day out of a multi-day sheet, filter to that day; otherwise keep ALL days
      const existingPlanDays = new Set(
        (plan.exercises || []).map(e => normalizeExerciseMatchKey(e.day, false)).filter(Boolean)
      );
      if (importedDays.length > 1 && existingPlanDays.size === 1) {
        const planTitleKey = normalizeExerciseMatchKey(plan.title, false);
        const sheetNameSegments = (plan.sheetName || '')
          .split(/[·,]/)
          .map(seg => normalizeExerciseMatchKey(seg, false))
          .filter(Boolean);
        const matchingDay = importedDays.find(d => {
          const dayKey = normalizeExerciseMatchKey(d, false);
          return (
            Boolean(dayKey) &&
            (dayKey === planTitleKey ||
              existingPlanDays.has(dayKey) ||
              sheetNameSegments.some(seg => seg === dayKey))
          );
        });
        if (matchingDay) {
          const dayFiltered = importedExercises.filter(ex => !ex.day || ex.day === matchingDay);
          if (dayFiltered.length > 0) importedExercises = dayFiltered;
        }
      }

      // Preview matched existing IDs right inside the draft
      const usedExistingIds = new Set<string>();
      const mappedExercises = importedExercises.map((row) => {
        const strictName = normalizeExerciseMatchKey(row.name, false);
        const looseName = normalizeExerciseMatchKey(row.name, true);
        const normDay = normalizeExerciseMatchKey(row.day, false);
        const matched =
          (strictName && normDay
            ? plan.exercises.find(
                e =>
                  !usedExistingIds.has(e.id) &&
                  normalizeExerciseMatchKey(e.name, false) === strictName &&
                  normalizeExerciseMatchKey(e.day, false) === normDay
              )
            : undefined) ||
          (strictName && normDay
            ? plan.exercises.find(e => {
                if (usedExistingIds.has(e.id) || normalizeExerciseMatchKey(e.name, false) !== strictName) return false;
                const exDay = normalizeExerciseMatchKey(e.day, false);
                return exDay !== '' && (exDay.includes(normDay) || normDay.includes(exDay));
              })
            : undefined) ||
          (looseName && normDay
            ? plan.exercises.find(e => {
                if (usedExistingIds.has(e.id) || normalizeExerciseMatchKey(e.name, true) !== looseName) return false;
                const exDay = normalizeExerciseMatchKey(e.day, false);
                return exDay !== '' && (exDay === normDay || exDay.includes(normDay) || normDay.includes(exDay));
              })
            : undefined) ||
          (strictName
            ? plan.exercises.find(e => !usedExistingIds.has(e.id) && normalizeExerciseMatchKey(e.name, false) === strictName)
            : undefined) ||
          (looseName
            ? plan.exercises.find(e => !usedExistingIds.has(e.id) && normalizeExerciseMatchKey(e.name, true) === looseName)
            : undefined);

        if (matched) usedExistingIds.add(matched.id);

        return {
          ...(matched ? { id: matched.id } : {}),
          day: row.day || '',
          name: row.name || '',
          sets: row.sets || '',
          reps: row.reps || '',
          targetRpe: row.rpe || matched?.targetRpe || '',
          targetRir: row.rir || matched?.targetRir || '',
          notes: row.notes || '',
          videoUrl: row.video || '',
          isSuperset: !!row.isSuperset,
          supersetGroup: row.supersetGroup || '',
          ...(row.loggedWeight ? { loggedWeight: row.loggedWeight } : {}),
          ...(row.loggedUnit ? { loggedUnit: row.loggedUnit } : {}),
          ...(row.loggedReps ? { loggedReps: row.loggedReps } : {}),
          ...(row.weeklyLogs ? { weeklyLogs: row.weeklyLogs } : {}),
          ...(row.completed !== undefined ? { completed: row.completed } : {}),
        };
      });

      const infoText = detected
        .filter(s => s.suggestedRole === 'instructions' && s.textContent.trim() !== '')
        .map(s => s.textContent.trim())
        .join('\n\n');

      const detectedUnit = tabsToMerge.find(t => t.detectedWeightUnit)?.detectedWeightUnit;
      const prefilledCount = mappedExercises.filter(
        m => m.weeklyLogs || m.loggedWeight || m.loggedReps || m.targetRpe || m.targetRir || m.completed
      ).length;
      const detectedWeekNumbers = new Set<number>();
      mappedExercises.forEach(m => {
        Object.keys(m.weeklyLogs || {}).forEach(k => {
          const n = Number(k);
          if (n >= 1 && n <= 52) detectedWeekNumbers.add(n);
        });
      });
      const weekSummaryList = Array.from(detectedWeekNumbers)
        .sort((a, b) => a - b)
        .map(w => `W${w}`)
        .join(', ');

      setWorksheetDraft((prev) =>
        prev
          ? {
              ...prev,
              weeks: Math.max(prev.weeks, consolidated.highestWeek || 1),
              defaultWeightUnit: detectedUnit || prev.defaultWeightUnit,
              sourceFileName: file.name,
              hasRpeColumn: consolidated.hasRpeColumn,
              hasRirColumn: consolidated.hasRirColumn,
              replaceExistingWeekLogs: prefilledCount > 0 ? true : Boolean(prev.replaceExistingWeekLogs),
              instructions: infoText || prev.instructions,
              exercises: mappedExercises,
            }
          : prev
      );
      setWorksheetImportNotice(
        `Loaded ${mappedExercises.length} exercises from "${file.name}" (${usedExistingIds.size} matched${prefilledCount > 0 ? `, ${prefilledCount} rows with training data${weekSummaryList ? ` across ${weekSummaryList}` : ''}` : ''}). Click Save Worksheet to apply.`
      );
    } catch (err: any) {
      setWorksheetImportNotice(`Failed to read file: ${err?.message || String(err)}`);
    } finally {
      if (worksheetFileInputRef.current) worksheetFileInputRef.current.value = '';
    }
  };

  const saveModifiedWorksheet = async (plan: WorkoutPlan) => {
    if (!worksheetDraft || !isOwnPlan(plan)) return;
    setIsSavingWorksheet(true);
    try {
      const merged = mergeUpdatedWorksheetIntoPlan(plan, {
        title: worksheetDraft.title,
        description: worksheetDraft.description,
        instructions: worksheetDraft.instructions,
        weeks: worksheetDraft.weeks,
        defaultWeightUnit: worksheetDraft.defaultWeightUnit,
        sourceFileName: worksheetDraft.sourceFileName,
        hasRpeColumn: worksheetDraft.hasRpeColumn,
        hasRirColumn: worksheetDraft.hasRirColumn,
        replaceExistingWeekLogs: Boolean(worksheetDraft.replaceExistingWeekLogs),
        exercises: worksheetDraft.exercises.map(row => {
          const split = splitSetsAndReps(row.sets, false);
          return {
            id: row.id,
            day: row.day,
            name: row.name,
            sets: split ? split.sets : row.sets,
            reps: row.reps.trim() || (split ? split.reps : ''),
            targetRpe: row.targetRpe?.trim() || '',
            targetRir: row.targetRir?.trim() || '',
            notes: row.notes,
            videoUrl: row.videoUrl,
            isSuperset: row.isSuperset,
            supersetGroup: row.supersetGroup,
            loggedWeight: row.loggedWeight,
            loggedUnit: row.loggedUnit,
            loggedReps: row.loggedReps,
            weeklyLogs: row.weeklyLogs,
            completed: row.completed,
          };
        }),
      });

      await saveWorkoutPlanDoc(merged);

      // Clear cached drafts for this plan so normalized sets re-sync cleanly while keeping saved logs
      setDraftSets(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => {
          if (k.startsWith(`${plan.id}__`)) delete next[k];
        });
        return next;
      });

      setWorksheetEditPlanId(null);
      setWorksheetDraft(null);
      setWorksheetImportNotice(null);
      setSavedNoticeId(`plan_${plan.id}`);
      setTimeout(() => setSavedNoticeId(prev => (prev === `plan_${plan.id}` ? null : prev)), 2500);
    } catch (err: any) {
      setWorksheetImportNotice(`Failed to save worksheet changes: ${err?.message || String(err)}`);
    } finally {
      setIsSavingWorksheet(false);
    }
  };

  const openPlan = (id: string) => {
    setSelectedPlanId(id);
    setSelectedWeek(1);
    setSelectedDayFilter('ALL');
    setEditingExerciseId(null);
    setEditDraft(null);
    setInlineVideoExId(null);
    setWorksheetEditPlanId(null);
    setWorksheetDraft(null);
    setWorksheetImportNotice(null);
  };

  const renderWorkoutsWorkspace = (showEmptyState = true, allowModify = true) => {
    if (myPlans.length === 0) {
      if (!showEmptyState) return null;
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">My Workouts (0)</h2>
            {allowModify && (
              <button
                onClick={() => setActiveTab('upload')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" /> Upload
              </button>
            )}
          </div>
          <EmptyPlans onUpload={() => setActiveTab('upload')} />
        </div>
      );
    }

    const plan = activePlan!;
    const completion = planCompletion(plan);
    const weeks = Math.max(1, plan.weeks || 1);
    const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
    const doneIds = plan.progress?.[weekKey(selectedWeek - 1)] || [];
    const weekDone = doneIds.length;
    const weekPct = plan.exercises.length > 0 ? Math.round((weekDone / plan.exercises.length) * 100) : 0;
    const showRpe = planHasRpeColumn(plan);
    const showRir = planHasRirColumn(plan);

    const visibleExercises =
      selectedDayFilter === 'ALL' || activePlanDays.length === 0
        ? plan.exercises
        : plan.exercises.filter(e => e.day?.trim() === selectedDayFilter);

    return (
      <div className="space-y-4">
        {/* CHOOSE WORKOUT TITLE PICKER */}
        <div className="rounded-2xl border border-white/10 bg-neutral-900/70 p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-2">
              <Dumbbell className="w-4 h-4 text-red-500" /> Workouts ({myPlans.length})
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={plan.id}
                onChange={(e) => openPlan(e.target.value)}
                className="hidden sm:block bg-neutral-950 border border-white/15 rounded-xl px-3 py-1.5 text-xs font-semibold text-white max-w-[220px]"
              >
                {myPlans.map(p => <option key={p.id} value={p.id}>{p.title} ({p.exercises.length} ex)</option>)}
              </select>
              {allowModify && (
                <button
                  onClick={() => setActiveTab('upload')}
                  className="h-9 px-3 inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" /> Upload
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto no-scrollbar snap-x -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap">
            {myPlans.map(p => {
              const sel = p.id === plan.id;
              return (
                <button
                  key={p.id}
                  onClick={() => openPlan(p.id)}
                  className={`snap-start shrink-0 h-10 px-3.5 rounded-xl text-xs font-bold border inline-flex items-center gap-2 cursor-pointer ${
                    sel
                      ? 'bg-gradient-to-r from-red-600 to-red-500 text-white border-red-400 shadow-lg shadow-red-950/40'
                      : 'bg-neutral-950/70 text-neutral-300 border-white/10'
                  }`}
                >
                  <span className="truncate max-w-[150px]">{p.title}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${sel ? 'bg-black/25' : 'bg-white/5 text-neutral-400'}`}>
                    {p.exercises.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ACTIVE WORKOUT HEADER SUMMARY + WEIGHT UNIT SELECTOR */}
        <div className="rounded-2xl border border-white/10 bg-neutral-900/70 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">{plan.title}</h2>
              {plan.description && <p className="text-[13px] text-neutral-400 mt-1">{plan.description}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-neutral-500">
                <span className="inline-flex items-center gap-1"><Dumbbell className="w-3.5 h-3.5 text-red-500" /> {plan.exercises.length} exercises</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5 text-red-500" /> {weeks} week{weeks === 1 ? '' : 's'}</span>
                {plan.exercises.some(e => e.isSuperset) && (
                  <span className="inline-flex items-center gap-1 text-fuchsia-300 bg-fuchsia-500/15 border border-fuchsia-400/30 rounded-full px-2 py-0.5 font-semibold text-[10px]">
                    <Zap className="w-3 h-3" /> Includes Supersets
                  </span>
                )}
                {plan.sheetName && (
                  <span className="text-neutral-400 bg-white/5 border border-white/10 rounded-full px-2 py-0.5 font-mono text-[10px]">
                    Tab: {plan.sheetName}
                  </span>
                )}
                {plan.assignedByAdmin && (
                  <span className="text-red-300 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">Assigned by coach</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
              <div className="inline-flex items-center rounded-xl bg-neutral-950 border border-white/15 p-0.5 shrink-0" title="Workout default weight unit">
                {(['kg', 'lbs'] as WeightUnit[]).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => changePlanWeightUnit(plan, u)}
                    className={`h-8 px-2.5 rounded-lg text-[11px] font-bold uppercase transition-all cursor-pointer ${
                      planUnit === u ? 'bg-red-600 text-white shadow' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>

              {allowModify && (
                <button
                  type="button"
                  onClick={() => {
                    if (worksheetEditPlanId === plan.id) {
                      setWorksheetEditPlanId(null);
                      setWorksheetDraft(null);
                    } else {
                      startModifyWorksheet(plan);
                    }
                  }}
                  className={`flex-1 sm:flex-none min-w-0 h-9 inline-flex items-center justify-center gap-1.5 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    worksheetEditPlanId === plan.id
                      ? 'bg-emerald-600 text-white border-emerald-400 shadow'
                      : 'bg-neutral-950 hover:bg-neutral-800 text-neutral-200 border-white/15 hover:border-emerald-500/50'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate sm:hidden">{worksheetEditPlanId === plan.id ? 'Close' : 'Modify'}</span>
                  <span className="hidden sm:inline">{worksheetEditPlanId === plan.id ? 'Close Editor' : 'Modify Worksheet'}</span>
                </button>
              )}

              {renderExportControl(plan, 'toolbar', 'toolbar')}

              {allowModify && (
                <button
                  type="button"
                  onClick={() => setPlanToDelete(plan)}
                  aria-label="Delete plan"
                  className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-xl border border-white/10 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {savedNoticeId === `plan_${plan.id}` && (
            <div className="mt-3 flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Worksheet updated cleanly — all saved weights, reps, weekly history &amp; checkmarks were preserved!</span>
            </div>
          )}

          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
              <span>Overall progress</span>
              <span className="text-red-300 font-bold">{completion.pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-red-600 to-red-400" style={{ width: `${completion.pct}%` }} />
            </div>
          </div>
        </div>

        {/* FULL WORKSHEET MODIFIER PANEL (PRESERVES SAVED DATA — MY WORKOUTS ONLY) */}
        {allowModify && worksheetEditPlanId === plan.id && worksheetDraft && (
          <div className="rounded-2xl border border-emerald-500/35 bg-neutral-950/90 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  Modify Worksheet — {plan.title}
                </h3>
                <p className="text-[11px] text-emerald-300/90 mt-0.5 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  Saved data protection active: all existing weights, reps, weekly history, and completion checkmarks are preserved.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={worksheetFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,.txt,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImportSheetIntoWorksheetDraft(f, plan);
                  }}
                />
                <button
                  type="button"
                  onClick={() => worksheetFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600/25 hover:bg-sky-600/40 border border-sky-400/40 text-sky-200 text-xs font-bold cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" /> Import Updated File (.xlsx/.csv)
                </button>
              </div>
            </div>

            {worksheetImportNotice && (
              <div className="text-xs text-sky-200 bg-sky-950/40 border border-sky-500/30 rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                <span>{worksheetImportNotice}</span>
                {worksheetDraft.exercises.some(m => m.weeklyLogs || m.loggedWeight || m.loggedReps || m.completed) && (
                  <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-amber-200 bg-black/40 border border-amber-400/30 rounded-lg px-2.5 py-1 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(worksheetDraft.replaceExistingWeekLogs)}
                      onChange={(e) => setWorksheetDraft({ ...worksheetDraft, replaceExistingWeekLogs: e.target.checked })}
                      className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                    />
                    Overwrite existing week logs from file
                  </label>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Workout Title</span>
                <input
                  value={worksheetDraft.title}
                  onChange={(e) => setWorksheetDraft({ ...worksheetDraft, title: e.target.value })}
                  className="bg-neutral-900 border border-white/15 focus:border-emerald-500/60 rounded-xl px-3 py-2 text-xs text-white outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Weeks</span>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={worksheetDraft.weeks}
                  onChange={(e) => setWorksheetDraft({ ...worksheetDraft, weeks: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  className="bg-neutral-900 border border-white/15 focus:border-emerald-500/60 rounded-xl px-3 py-2 text-xs text-white outline-none"
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Default Weight Unit</span>
                <div className="inline-flex rounded-xl bg-neutral-900 border border-white/15 p-1 w-fit">
                  {(['kg', 'lbs'] as WeightUnit[]).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setWorksheetDraft({ ...worksheetDraft, defaultWeightUnit: u })}
                      className={`px-3 py-1 rounded-lg text-xs font-bold uppercase cursor-pointer ${
                        worksheetDraft.defaultWeightUnit === u ? 'bg-red-600 text-white' : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Information &amp; Instructions</span>
                <textarea
                  rows={2}
                  value={worksheetDraft.instructions}
                  onChange={(e) => setWorksheetDraft({ ...worksheetDraft, instructions: e.target.value })}
                  placeholder="Optional guidelines / warm-up notes..."
                  className="bg-neutral-900 border border-white/15 focus:border-emerald-500/60 rounded-xl px-3 py-2 text-xs text-white outline-none resize-y"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Description</span>
                <textarea
                  rows={2}
                  value={worksheetDraft.description}
                  onChange={(e) => setWorksheetDraft({ ...worksheetDraft, description: e.target.value })}
                  placeholder="Focus / coach notes..."
                  className="bg-neutral-900 border border-white/15 focus:border-emerald-500/60 rounded-xl px-3 py-2 text-xs text-white outline-none resize-y"
                />
              </label>
            </div>

            {/* Editable Worksheet Table */}
            <div className="rounded-xl border border-white/10 bg-black/40 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[960px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-900/80">
                    <th className="px-2 py-2 w-32">Day</th>
                    <th className="px-2 py-2 w-20">Type</th>
                    <th className="px-2 py-2">Exercise Name</th>
                    <th className="px-2 py-2 w-20">Sets</th>
                    <th className="px-2 py-2 w-24">Reps</th>
                    <th className="px-2 py-2 w-20">RPE</th>
                    <th className="px-2 py-2 w-20">RIR / RIP</th>
                    <th className="px-2 py-2">Notes</th>
                    <th className="px-2 py-2 w-56">Video URL</th>
                    <th className="px-2 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {worksheetDraft.exercises.map((row, rIdx) => (
                    <tr
                      key={row.id || `new-${rIdx}`}
                      className={`border-t border-white/5 ${row.isSuperset ? 'bg-fuchsia-950/25 border-l-4 border-l-fuchsia-400' : ''}`}
                    >
                      <td className="px-1.5 py-1">
                        <input
                          value={row.day}
                          onChange={(e) => {
                            const next = [...worksheetDraft.exercises];
                            next[rIdx] = { ...next[rIdx], day: e.target.value };
                            setWorksheetDraft({ ...worksheetDraft, exercises: next });
                          }}
                          placeholder="Day..."
                          className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-amber-200 outline-none"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <button
                          type="button"
                          onClick={() => {
                            const next = [...worksheetDraft.exercises];
                            next[rIdx] = { ...next[rIdx], isSuperset: !next[rIdx].isSuperset };
                            setWorksheetDraft({ ...worksheetDraft, exercises: next });
                          }}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold border inline-flex items-center gap-1 cursor-pointer ${
                            row.isSuperset
                              ? 'bg-fuchsia-500/25 border-fuchsia-400/60 text-fuchsia-200'
                              : 'bg-neutral-900 border-white/10 text-neutral-400'
                          }`}
                        >
                          <Zap className="w-3 h-3" /> {row.isSuperset ? (row.supersetGroup || 'SS') : 'Std'}
                        </button>
                      </td>
                      <td className="px-1.5 py-1">
                        <input
                          value={row.name}
                          onChange={(e) => {
                            const next = [...worksheetDraft.exercises];
                            next[rIdx] = { ...next[rIdx], name: e.target.value };
                            setWorksheetDraft({ ...worksheetDraft, exercises: next });
                          }}
                          className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <input
                          value={row.sets}
                          onChange={(e) => {
                            const val = e.target.value;
                            const sp = splitSetsAndReps(val);
                            const next = [...worksheetDraft.exercises];
                            next[rIdx] = sp
                              ? { ...next[rIdx], sets: sp.sets, reps: next[rIdx].reps || sp.reps }
                              : { ...next[rIdx], sets: val };
                            setWorksheetDraft({ ...worksheetDraft, exercises: next });
                          }}
                          placeholder="4"
                          className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono outline-none"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <input
                          value={row.reps}
                          onChange={(e) => {
                            const next = [...worksheetDraft.exercises];
                            next[rIdx] = { ...next[rIdx], reps: e.target.value };
                            setWorksheetDraft({ ...worksheetDraft, exercises: next });
                          }}
                          placeholder="5-12"
                          className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono outline-none"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <input
                          value={row.targetRpe || ''}
                          onChange={(e) => {
                            const next = [...worksheetDraft.exercises];
                            next[rIdx] = { ...next[rIdx], targetRpe: e.target.value };
                            setWorksheetDraft({ ...worksheetDraft, exercises: next });
                          }}
                          placeholder="8"
                          className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-amber-200 font-mono outline-none"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <span
                          title="RIR / RIP is read-only from the uploaded workout sheet"
                          className={`inline-flex items-center justify-center w-full rounded-lg px-2 py-1 text-xs font-mono border ${
                            row.targetRir?.trim()
                              ? 'bg-sky-500/10 border-sky-500/30 text-sky-200'
                              : 'bg-neutral-900/50 border-white/5 text-neutral-600'
                          }`}
                        >
                          {row.targetRir?.trim() || '—'}
                        </span>
                      </td>
                      <td className="px-1.5 py-1">
                        <input
                          value={row.notes}
                          onChange={(e) => {
                            const next = [...worksheetDraft.exercises];
                            next[rIdx] = { ...next[rIdx], notes: e.target.value };
                            setWorksheetDraft({ ...worksheetDraft, exercises: next });
                          }}
                          className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-neutral-300 outline-none"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <input
                          value={row.videoUrl}
                          onChange={(e) => {
                            const next = [...worksheetDraft.exercises];
                            next[rIdx] = { ...next[rIdx], videoUrl: e.target.value };
                            setWorksheetDraft({ ...worksheetDraft, exercises: next });
                          }}
                          placeholder="https://youtube.com/..."
                          className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-[11px] font-mono text-sky-300 outline-none"
                        />
                      </td>
                      <td className="px-1 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            const next = worksheetDraft.exercises.filter((_, i) => i !== rIdx);
                            setWorksheetDraft({ ...worksheetDraft, exercises: next });
                          }}
                          className="p-1.5 text-neutral-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 cursor-pointer"
                          title="Remove exercise"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setWorksheetDraft({
                    ...worksheetDraft,
                    exercises: [
                      ...worksheetDraft.exercises,
                      {
                        day: activePlanDays[0] || '',
                        name: '',
                        sets: '3',
                        reps: '8-12',
                        targetRpe: '',
                        targetRir: '',
                        notes: '',
                        videoUrl: '',
                        isSuperset: false,
                        supersetGroup: '',
                      },
                    ],
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Exercise Row
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setWorksheetEditPlanId(null);
                    setWorksheetDraft(null);
                    setWorksheetImportNotice(null);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-neutral-800 text-neutral-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingWorksheet}
                  onClick={() => saveModifiedWorksheet(plan)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow cursor-pointer"
                >
                  {isSavingWorksheet ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save Worksheet (Keep Saved Data)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* INFORMATION & INSTRUCTIONS CARD */}
        {plan.instructions && plan.instructions.trim() !== '' && (
          <div className="rounded-2xl border border-sky-500/30 bg-sky-950/15 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowInstructions(v => !v)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-sky-500/5 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-sky-300 uppercase tracking-wider">
                <FileText className="w-4 h-4 text-sky-400" />
                <span>Information & Instructions</span>
              </div>
              {showInstructions ? <ChevronUp className="w-4 h-4 text-sky-400" /> : <ChevronDown className="w-4 h-4 text-sky-400" />}
            </button>
            {showInstructions && (
              <div className="px-4 pb-4 pt-1 border-t border-sky-500/20 text-xs text-sky-100/90 whitespace-pre-wrap leading-relaxed">
                {plan.instructions}
              </div>
            )}
          </div>
        )}

        {/* WEEK SELECTOR & DAY FILTER */}
        <div className="space-y-2.5">
          {weeks > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold mr-1">Week:</span>
              {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => {
                const wkDone = (plan.progress?.[weekKey(w - 1)] || []).length;
                const complete = plan.exercises.length > 0 && wkDone === plan.exercises.length;
                return (
                  <button
                    key={w}
                    onClick={() => setSelectedWeek(w)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all inline-flex items-center gap-1.5 cursor-pointer ${
                      selectedWeek === w
                        ? 'bg-red-600 text-white border-red-400'
                        : 'bg-neutral-900 text-neutral-300 border-white/10 hover:border-red-500/40'
                    }`}
                  >
                    Week {w}
                    {complete && <CheckCircle2 className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>
          )}

          {activePlanDays.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-amber-400 font-bold mr-1">Day:</span>
              <button
                type="button"
                onClick={() => setSelectedDayFilter('ALL')}
                className={`px-3 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  selectedDayFilter === 'ALL'
                    ? 'bg-amber-500/25 text-amber-200 border-amber-400/60'
                    : 'bg-neutral-900 text-neutral-400 border-white/10 hover:text-white'
                }`}
              >
                All Days ({plan.exercises.length})
              </button>
              {activePlanDays.map(dayName => {
                const count = plan.exercises.filter(e => e.day?.trim() === dayName).length;
                const active = selectedDayFilter === dayName;
                return (
                  <button
                    key={dayName}
                    type="button"
                    onClick={() => setSelectedDayFilter(dayName)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      active
                        ? 'bg-amber-500/25 text-amber-200 border-amber-400/60'
                        : 'bg-neutral-900 text-neutral-400 border-white/10 hover:text-white'
                    }`}
                  >
                    {dayName} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Week progress bar */}
        <div>
          <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
            <span>Week {selectedWeek} — {weekDone}/{plan.exercises.length} done</span>
            <span className="text-red-300 font-bold">{weekPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
            <div className="h-full bg-red-500" style={{ width: `${weekPct}%` }} />
          </div>
        </div>

        {/* WARM-UP SECTION (TOP OF WORKOUT PLAN — SEPARATE WARM-UP SETS) */}
        {(() => {
          const warmupList = plan.warmupExercises || [];
          const wKey = weekKey(selectedWeek - 1);
          const warmupDoneCount = warmupList.filter(wu => Boolean(plan.warmupLogs?.[wKey]?.[wu.id]?.completed)).length;

          return (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-950/10 overflow-hidden">
              <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowWarmupSection(v => !v)}
                  className="flex items-center gap-2 text-left cursor-pointer min-w-0"
                >
                  <Flame className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-xs font-bold text-amber-200 uppercase tracking-wider">
                    Warm-up ({warmupList.length})
                  </span>
                  {warmupList.length > 0 && (
                    <span className="text-[11px] font-mono tabular-nums text-amber-300/90">
                      {warmupDoneCount}/{warmupList.length} done · Week {selectedWeek}
                    </span>
                  )}
                  {showWarmupSection ? (
                    <ChevronUp className="w-4 h-4 text-amber-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-amber-400" />
                  )}
                </button>

                {allowModify && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowWarmupSection(true);
                      setShowAddWarmupForm(v => !v);
                    }}
                    className="h-8 px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/35 text-amber-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Warm-up
                  </button>
                )}
              </div>

              {showWarmupSection && (
                <div className="px-4 pb-4 pt-2 border-t border-amber-500/20 space-y-3">
                  {allowModify && showAddWarmupForm && (
                    <div className="rounded-xl border border-amber-500/30 bg-neutral-950/80 p-3 space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <label className="flex flex-col gap-1 sm:col-span-5">
                          <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Warm-up Movement / Drill</span>
                          <input
                            value={newWarmupDraft.name}
                            onChange={(e) => setNewWarmupDraft({ ...newWarmupDraft, name: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddWarmupExercise(plan);
                              }
                            }}
                            placeholder="e.g. Incline Walk, Band Pull-Aparts, Ramp-up"
                            className="bg-neutral-900 border border-white/15 focus:border-amber-500/60 rounded-lg px-3 py-1.5 text-xs text-white outline-none"
                          />
                        </label>

                        <div className="flex flex-col gap-1 sm:col-span-3">
                          <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Minutes</span>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              max="120"
                              value={newWarmupDraft.minutes}
                              onChange={(e) => setNewWarmupDraft({ ...newWarmupDraft, minutes: e.target.value })}
                              placeholder="5"
                              aria-label="Warm-up duration in minutes"
                              className="w-full min-w-0 bg-neutral-900 border border-white/15 focus:border-amber-500/60 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono tabular-nums outline-none"
                            />
                            {['3', '5', '10'].map(preset => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setNewWarmupDraft(prev => ({ ...prev, minutes: preset }))}
                                className={`h-7 px-1.5 rounded text-[10px] font-mono font-bold border cursor-pointer shrink-0 ${
                                  newWarmupDraft.minutes === preset
                                    ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                                    : 'bg-neutral-900 border-white/10 text-neutral-400 hover:text-white'
                                }`}
                              >
                                {preset}m
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-col gap-1 sm:col-span-2">
                          <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Target Sets</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                const cur = parseInt(newWarmupDraft.targetSets || '2', 10) || 2;
                                setNewWarmupDraft(prev => ({ ...prev, targetSets: String(Math.max(1, cur - 1)) }));
                              }}
                              aria-label="Decrease target warm-up sets"
                              className="h-7 w-7 inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 cursor-pointer shrink-0"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min="1"
                              max="10"
                              value={newWarmupDraft.targetSets}
                              onChange={(e) => setNewWarmupDraft({ ...newWarmupDraft, targetSets: e.target.value })}
                              aria-label="Warm-up target sets"
                              className="w-full min-w-0 text-center bg-neutral-900 border border-white/15 focus:border-amber-500/60 rounded-lg px-1.5 py-1.5 text-xs text-white font-mono tabular-nums outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const cur = parseInt(newWarmupDraft.targetSets || '2', 10) || 2;
                                setNewWarmupDraft(prev => ({ ...prev, targetSets: String(Math.min(10, cur + 1)) }));
                              }}
                              aria-label="Increase target warm-up sets"
                              className="h-7 w-7 inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 cursor-pointer shrink-0"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <label className="flex flex-col gap-1 sm:col-span-2">
                          <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Reps / Pace</span>
                          <input
                            value={newWarmupDraft.target}
                            onChange={(e) => setNewWarmupDraft({ ...newWarmupDraft, target: e.target.value })}
                            placeholder="10-12 reps"
                            className="bg-neutral-900 border border-white/15 focus:border-amber-500/60 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono outline-none"
                          />
                        </label>
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Warm-up Cue (optional)</span>
                        <input
                          value={newWarmupDraft.notes}
                          onChange={(e) => setNewWarmupDraft({ ...newWarmupDraft, notes: e.target.value })}
                          placeholder="Light tempo, focus on mobility / shoulder prep..."
                          className="bg-neutral-900 border border-white/15 focus:border-amber-500/60 rounded-lg px-3 py-1.5 text-xs text-neutral-200 outline-none"
                        />
                      </label>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddWarmupForm(false);
                            setNewWarmupDraft({ name: '', minutes: '5', targetSets: '2', target: '', notes: '' });
                          }}
                          className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 text-xs font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={!newWarmupDraft.name.trim()}
                          onClick={() => handleAddWarmupExercise(plan)}
                          className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" /> Save Warm-up
                        </button>
                      </div>
                    </div>
                  )}

                  {warmupList.length === 0 ? (
                    <p className="text-xs text-neutral-400">
                      No warm-up drills added yet. Click <span className="text-amber-300 font-semibold">+ Add Warm-up</span> above to set minutes, target sets &amp; ramp-up sets.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {warmupList.map((wu, wuIdx) => {
                        const wuEntry = plan.warmupLogs?.[wKey]?.[wu.id];
                        const wuDone = Boolean(wuEntry?.completed);
                        const wuSetEntries = getWarmupSetEntries(plan, selectedWeek, wu);
                        const isWuSavedRecently = savedNoticeId === `wu_saved_${wu.id}`;
                        const isEditingWu = editingWarmupId === wu.id && editWarmupDraft !== null;
                        const activeTimer = warmupTimer?.wuId === wu.id ? warmupTimer : null;
                        const configuredMins = parseFloat((wu.minutes || '').trim());
                        const hasMinutes = Number.isFinite(configuredMins) && configuredMins > 0;
                        const targetSetsNum = wu.targetSets?.trim()
                          ? parseSetsCount(wu.targetSets.trim())
                          : null;

                        return (
                          <div
                            key={wu.id}
                            className={`rounded-xl border p-3 space-y-2.5 transition-colors ${
                              wuDone
                                ? 'border-amber-400/50 bg-amber-950/25'
                                : 'border-white/10 bg-neutral-900/75'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2.5 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => toggleWarmupCompleted(plan, selectedWeek, wu)}
                                  className="mt-0.5 text-amber-400 shrink-0 hover:scale-110 transition-transform cursor-pointer"
                                  title={wuDone ? 'Mark warm-up incomplete' : 'Mark warm-up done'}
                                >
                                  {wuDone ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5 text-neutral-600" />}
                                </button>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="text-[11px] font-mono text-amber-400/80">W#{wuIdx + 1}</span>
                                    <span className={`text-sm font-bold ${wuDone ? 'line-through opacity-75' : 'text-white'}`}>
                                      {wu.name}
                                    </span>
                                    {(hasMinutes || targetSetsNum || wu.target) && (
                                      <span className="text-[11px] font-mono tabular-nums text-amber-200/90 inline-flex items-center gap-1.5">
                                        {hasMinutes && (
                                          <span className="inline-flex items-center gap-1">
                                            <Clock className="w-3 h-3 text-amber-400" />
                                            {wu.minutes} min
                                          </span>
                                        )}
                                        {hasMinutes && (targetSetsNum || wu.target) && <span aria-hidden="true">·</span>}
                                        {targetSetsNum && <span>{targetSetsNum} sets</span>}
                                        {targetSetsNum && wu.target && <span aria-hidden="true">·</span>}
                                        {wu.target && <span>{wu.target}</span>}
                                      </span>
                                    )}
                                    {isWuSavedRecently && (
                                      <span className="text-[10px] font-mono text-emerald-300 inline-flex items-center gap-1">
                                        <Check className="w-3 h-3" /> Saved
                                      </span>
                                    )}
                                  </div>
                                  {wu.notes && !isEditingWu && (
                                    <p className="text-xs text-neutral-400 mt-0.5">{wu.notes}</p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {hasMinutes && (
                                  <div className="inline-flex items-center gap-1 mr-1">
                                    <button
                                      type="button"
                                      onClick={() => startOrToggleWarmupTimer(wu)}
                                      className={`h-7 px-2 rounded-lg border text-[11px] font-mono tabular-nums font-bold inline-flex items-center gap-1 cursor-pointer ${
                                        activeTimer?.finished
                                          ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                                          : activeTimer?.running
                                          ? 'bg-amber-500/25 border-amber-400/60 text-amber-100'
                                          : 'bg-white/5 hover:bg-white/10 border-white/10 text-amber-200'
                                      }`}
                                      title={activeTimer?.running ? 'Pause warm-up timer' : 'Start warm-up timer'}
                                    >
                                      {activeTimer?.running ? <Pause className="w-3 h-3" /> : <Timer className="w-3 h-3" />}
                                      {activeTimer
                                        ? activeTimer.finished
                                          ? 'Done!'
                                          : formatTimerClock(activeTimer.remainingSec)
                                        : formatTimerClock(Math.round(configuredMins * 60))}
                                    </button>
                                    {activeTimer && (
                                      <button
                                        type="button"
                                        onClick={() => resetWarmupTimer(wu)}
                                        aria-label="Reset warm-up timer"
                                        className="h-7 w-7 inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white cursor-pointer"
                                        title="Reset warm-up timer"
                                      >
                                        <RotateCcw className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                )}
                                {allowModify && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => (isEditingWu ? setEditingWarmupId(null) : startEditWarmup(wu))}
                                      aria-label={`Edit warm-up ${wu.name}`}
                                      className="p-1.5 text-neutral-400 hover:text-amber-300 rounded-lg hover:bg-white/5 cursor-pointer"
                                      title="Edit warm-up minutes & target sets"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteWarmupExercise(plan, wu.id)}
                                      aria-label={`Remove warm-up ${wu.name}`}
                                      className="p-1.5 text-neutral-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 cursor-pointer"
                                      title="Remove warm-up exercise"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {allowModify && isEditingWu && editWarmupDraft && (
                              <div className="rounded-xl border border-amber-500/30 bg-black/50 p-3 space-y-2 text-xs">
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                                  <label className="flex flex-col gap-1 sm:col-span-5">
                                    <span className="text-[10px] uppercase text-neutral-400 font-semibold">Warm-up Movement</span>
                                    <input
                                      value={editWarmupDraft.name}
                                      onChange={(e) => setEditWarmupDraft({ ...editWarmupDraft, name: e.target.value })}
                                      className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-white outline-none"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 sm:col-span-2">
                                    <span className="text-[10px] uppercase text-neutral-400 font-semibold">Minutes</span>
                                    <input
                                      type="number"
                                      min="0"
                                      max="120"
                                      value={editWarmupDraft.minutes}
                                      onChange={(e) => setEditWarmupDraft({ ...editWarmupDraft, minutes: e.target.value })}
                                      placeholder="5"
                                      className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-white font-mono tabular-nums outline-none"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 sm:col-span-2">
                                    <span className="text-[10px] uppercase text-neutral-400 font-semibold">Target Sets</span>
                                    <input
                                      type="number"
                                      min="1"
                                      max="10"
                                      value={editWarmupDraft.targetSets}
                                      onChange={(e) => setEditWarmupDraft({ ...editWarmupDraft, targetSets: e.target.value })}
                                      placeholder="2"
                                      className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-white font-mono tabular-nums outline-none"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 sm:col-span-3">
                                    <span className="text-[10px] uppercase text-neutral-400 font-semibold">Reps / Pace</span>
                                    <input
                                      value={editWarmupDraft.target}
                                      onChange={(e) => setEditWarmupDraft({ ...editWarmupDraft, target: e.target.value })}
                                      placeholder="10-12 reps"
                                      className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-white font-mono outline-none"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 sm:col-span-12">
                                    <span className="text-[10px] uppercase text-neutral-400 font-semibold">Notes</span>
                                    <input
                                      value={editWarmupDraft.notes}
                                      onChange={(e) => setEditWarmupDraft({ ...editWarmupDraft, notes: e.target.value })}
                                      className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-neutral-200 outline-none"
                                    />
                                  </label>
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => { setEditingWarmupId(null); setEditWarmupDraft(null); }}
                                    className="px-3 py-1 rounded-lg bg-neutral-800 text-neutral-300 text-xs font-semibold cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => saveEditWarmup(plan, wu)}
                                    className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Check className="w-3.5 h-3.5" /> Save Warm-up
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Warm-up separate set logging rows */}
                            <div className="rounded-lg border border-white/10 bg-neutral-950/70 p-2.5 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/90 font-mono tabular-nums">
                                  Warm-up Sets ({wuSetEntries.length}{targetSetsNum ? ` / Target ${targetSetsNum}` : ''})
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => adjustWarmupSetCount(plan, selectedWeek, wu, -1)}
                                    disabled={wuSetEntries.length <= 1}
                                    aria-label="Remove warm-up set"
                                    className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-30 text-neutral-300 cursor-pointer"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => adjustWarmupSetCount(plan, selectedWeek, wu, 1)}
                                    aria-label="Add warm-up set"
                                    className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-white/5 hover:bg-white/10 text-neutral-300 cursor-pointer"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => saveWarmupSets(plan, selectedWeek, wu)}
                                    className="h-7 px-2 rounded-md bg-amber-500/20 hover:bg-amber-500/35 border border-amber-500/35 text-amber-200 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Check className="w-3 h-3" /> Save
                                  </button>
                                </div>
                              </div>

                              <div
                                className={`grid ${
                                  showRpe
                                    ? 'grid-cols-[30px_minmax(0,1.35fr)_minmax(0,0.85fr)_minmax(0,0.75fr)]'
                                    : 'grid-cols-[34px_minmax(0,1.4fr)_minmax(0,1fr)]'
                                } gap-1.5 sm:hidden text-[9px] uppercase tracking-wider text-neutral-500 font-mono px-0.5`}
                              >
                                <span className="text-center">Set</span><span>Weight</span><span>Reps</span>{showRpe && <span>RPE</span>}
                              </div>

                              <div className="space-y-1.5">
                                {wuSetEntries.map((sRow, sIdx) => {
                                  const sUnit: WeightUnit = sRow.unit || planUnit;
                                  return (
                                    <div
                                      key={sIdx}
                                      className={`grid ${
                                        showRpe
                                          ? 'grid-cols-[30px_minmax(0,1.35fr)_minmax(0,0.85fr)_minmax(0,0.75fr)] sm:grid-cols-[60px_145px_110px_92px]'
                                          : 'grid-cols-[34px_minmax(0,1.4fr)_minmax(0,1fr)] sm:grid-cols-[60px_155px_125px]'
                                      } items-center gap-1.5 sm:gap-2`}
                                    >
                                      <span className="h-10 sm:h-auto flex items-center justify-center text-[11px] font-mono font-bold text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg sm:py-1">
                                        <span className="sm:hidden">W{sIdx + 1}</span>
                                        <span className="hidden sm:inline">Set {sIdx + 1}</span>
                                      </span>
                                      <div className="relative flex items-center min-w-0">
                                        <span className="hidden sm:block absolute left-2 text-[9px] uppercase font-mono text-neutral-500 pointer-events-none">Wt</span>
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          value={sRow.weight}
                                          onChange={(e) => updateWarmupSetField(plan, selectedWeek, wu, sIdx, 'weight', e.target.value)}
                                          onBlur={() => saveWarmupSets(plan, selectedWeek, wu)}
                                          placeholder="0"
                                          aria-label={`Warm-up ${wu.name} Set ${sIdx + 1} Weight (${sUnit})`}
                                          className="w-full min-w-0 h-10 sm:h-auto bg-neutral-900 border border-white/15 focus:border-amber-500/60 rounded-lg pl-2.5 pr-10 sm:pl-7 sm:pr-10 sm:py-1 text-sm sm:text-xs text-white font-mono outline-none"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => updateWarmupSetField(plan, selectedWeek, wu, sIdx, 'unit', sUnit === 'kg' ? 'lbs' : 'kg')}
                                          aria-label="Switch warm-up weight unit"
                                          className="absolute right-1 h-7 sm:h-auto px-1 sm:py-0.5 rounded bg-white/10 text-[9px] font-bold uppercase text-neutral-200 cursor-pointer"
                                        >
                                          {sUnit}
                                        </button>
                                      </div>
                                      <label className="relative flex items-center min-w-0">
                                        <span className="hidden sm:block absolute left-2 text-[9px] uppercase font-mono text-neutral-500 pointer-events-none">Reps</span>
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={sRow.reps}
                                          onChange={(e) => updateWarmupSetField(plan, selectedWeek, wu, sIdx, 'reps', e.target.value)}
                                          onBlur={() => saveWarmupSets(plan, selectedWeek, wu)}
                                          placeholder="0"
                                          aria-label={`Warm-up ${wu.name} Set ${sIdx + 1} Reps`}
                                          className="w-full min-w-0 h-10 sm:h-auto bg-neutral-900 border border-white/15 focus:border-amber-500/60 rounded-lg px-2.5 sm:pl-9 sm:pr-2 sm:py-1 text-sm sm:text-xs text-white font-mono outline-none"
                                        />
                                      </label>
                                      {showRpe && (
                                        <label className="relative flex items-center min-w-0">
                                          <span className="hidden sm:block absolute left-2 text-[9px] uppercase font-mono text-neutral-500 pointer-events-none">RPE</span>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            value={sRow.rpe || ''}
                                            onChange={(e) => updateWarmupSetField(plan, selectedWeek, wu, sIdx, 'rpe', e.target.value)}
                                            onBlur={() => saveWarmupSets(plan, selectedWeek, wu)}
                                            placeholder="-"
                                            aria-label={`Warm-up ${wu.name} Set ${sIdx + 1} RPE`}
                                            className="w-full min-w-0 h-10 sm:h-auto bg-neutral-900 border border-white/15 focus:border-amber-500/60 rounded-lg px-2.5 sm:pl-8 sm:pr-2 sm:py-1 text-sm sm:text-xs text-white font-mono outline-none"
                                          />
                                        </label>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* REST TIMER CONFIG BAR + ACTIVE COUNTDOWN STATUS */}
        <div className="rounded-xl border border-white/10 bg-neutral-900/75 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-neutral-300">
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              Rest Timer
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {REST_TIMER_PRESETS.map(sec => {
                const activePreset = defaultRestSeconds === sec;
                return (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => updateDefaultRestSeconds(sec)}
                    className={`h-7 px-2 rounded-lg text-[11px] font-mono tabular-nums font-bold border transition-all cursor-pointer ${
                      activePreset
                        ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                        : 'bg-neutral-950 border-white/10 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {sec}s
                  </button>
                );
              })}
              <div className="flex items-center gap-1 ml-1">
                <input
                  type="number"
                  min={10}
                  max={600}
                  step={5}
                  value={customRestInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setCustomRestInput(raw);
                    const n = parseInt(raw, 10);
                    if (Number.isFinite(n) && n >= 10 && n <= 600) {
                      setDefaultRestSeconds(n);
                      saveStoredRestSeconds(currentUser, n);
                    }
                  }}
                  onBlur={() => {
                    const n = parseInt(customRestInput, 10);
                    if (!Number.isFinite(n) || n < 10) {
                      updateDefaultRestSeconds(defaultRestSeconds);
                    } else {
                      updateDefaultRestSeconds(n);
                    }
                  }}
                  aria-label="Custom rest seconds"
                  className="w-14 h-7 bg-neutral-950 border border-white/15 focus:border-amber-500/70 rounded-lg px-1.5 text-[11px] font-mono tabular-nums text-amber-200 text-center outline-none"
                />
                <span className="text-[10px] font-mono text-neutral-500">sec</span>
              </div>

              {/* Sound Variety Selector + Preview */}
              <div className="flex items-center gap-1 ml-1">
                <Volume2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <select
                  value={restSound}
                  onChange={(e) => {
                    const nextSound = e.target.value as RestSoundType;
                    updateRestSound(nextSound);
                    playRestFinishedChime(nextSound);
                  }}
                  aria-label="Rest timer notification sound"
                  className="h-7 bg-neutral-950 border border-white/15 focus:border-amber-500/70 rounded-lg px-2 text-[11px] text-neutral-200 outline-none cursor-pointer"
                >
                  {REST_SOUND_OPTIONS.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => playRestFinishedChime(restSound)}
                  className="h-7 px-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-neutral-300 hover:text-white cursor-pointer"
                  title="Preview selected timer sound"
                >
                  Test
                </button>
              </div>
            </div>
          </div>

          {setRestTimer && (
            <div className="flex flex-wrap items-center gap-2 bg-black/50 border border-amber-500/35 rounded-xl px-2.5 py-1">
              <span className="text-[11px] text-neutral-300 truncate max-w-[170px]">
                {setRestTimer.exerciseName} · S{setRestTimer.setNumber}
              </span>
              <span
                className={`text-xs font-mono tabular-nums font-black ${
                  setRestTimer.finished
                    ? 'text-emerald-300'
                    : setRestTimer.running
                    ? 'text-amber-300'
                    : 'text-neutral-300'
                }`}
              >
                {setRestTimer.finished ? 'READY' : formatTimerClock(setRestTimer.remainingSec)}
              </span>
              <button
                type="button"
                onClick={() => addSecondsToActiveRestTimer(15)}
                className="h-6 px-1.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono text-neutral-200 cursor-pointer"
                title="Add 15 seconds"
              >
                +15s
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetEx =
                    plan.exercises.find(e => e.id === setRestTimer.exerciseId) ||
                    ({ id: setRestTimer.exerciseId, name: setRestTimer.exerciseName } as WorkoutExercise);
                  if (setRestTimer.finished) {
                    startOrToggleSetRestTimer(setRestTimer.timerKey, targetEx, setRestTimer.setNumber, setRestTimer.totalSec);
                  } else {
                    startOrToggleSetRestTimer(setRestTimer.timerKey, targetEx, setRestTimer.setNumber);
                  }
                }}
                aria-label={setRestTimer.running ? 'Pause active rest timer' : 'Resume rest timer'}
                className="h-6 w-6 inline-flex items-center justify-center rounded bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 cursor-pointer"
              >
                {setRestTimer.running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={stopSetRestTimer}
                aria-label="Dismiss rest timer"
                className="h-6 w-6 inline-flex items-center justify-center rounded bg-white/5 hover:bg-red-500/25 text-neutral-400 hover:text-red-300 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* EXERCISES LIST */}
        <div className="space-y-3">
          {visibleExercises.map((ex, idx) => {
            const checked = doneIds.includes(ex.id);
            const isSuperset = !!ex.isSuperset;
            const { setsDisplay, repsDisplay } = getExerciseTargetDisplay(ex);
            const setEntries = getCurrentSetEntries(plan, selectedWeek, ex);
            const prevWeekData = findPreviousWeekSets(plan, selectedWeek, ex, myPlans);
            const weeklyHistory = buildWeeklyHistory(plan, ex, myPlans);
            const videoInfo = getVideoThumbnailInfo(ex.videoUrl);
            const isSavedRecently = savedNoticeId === ex.id;
            const isEditingThis = editingExerciseId === ex.id && editDraft !== null;
            const exDKey = draftKey(plan.id, selectedWeek, ex.id);
            const isCelebrating = justCompletedExKey === exDKey;

            const cardClasses = isCelebrating
              ? 'border-emerald-400/70 bg-emerald-950/30 ring-2 ring-emerald-500/35 animate-exercise-complete'
              : checked
              ? isSuperset
                ? 'border-fuchsia-400/60 border-l-4 border-l-fuchsia-400 bg-fuchsia-950/35'
                : 'border-red-500/40 bg-red-950/20'
              : isSuperset
              ? 'border-fuchsia-500/60 border-l-4 border-l-fuchsia-400 bg-gradient-to-br from-fuchsia-950/35 via-purple-950/20 to-neutral-900/90 shadow-lg shadow-fuchsia-950/20'
              : 'border-white/10 bg-neutral-900/70';

            return (
              <div key={ex.id} className={`rounded-2xl border p-4 transition-all ${cardClasses}`}>
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  {/* Left: Checkbox + Details + Editable Target + Sets */}
                  <div className="flex items-start gap-3 flex-1 min-w-0 w-full">
                    <button
                      onClick={() => toggleExercise(plan, selectedWeek - 1, ex.id)}
                      className={`relative mt-0.5 shrink-0 hover:scale-110 transition-transform cursor-pointer ${
                        isCelebrating
                          ? 'text-emerald-400'
                          : isSuperset
                          ? 'text-fuchsia-400'
                          : 'text-red-500'
                      }`}
                      title={checked ? 'Mark as not done' : 'Mark as done'}
                    >
                      {isCelebrating && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-check-ring pointer-events-none"
                        />
                      )}
                      {checked ? (
                        <CheckCircle2 className={`w-6 h-6 ${isCelebrating ? 'animate-check-pop text-emerald-400' : ''}`} />
                      ) : (
                        <Circle className="w-6 h-6 text-neutral-600" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[11px] font-mono text-neutral-500">#{idx + 1}</span>
                        <span className={`font-bold text-[15px] ${checked ? 'line-through opacity-75' : ''} ${isSuperset ? 'text-fuchsia-100' : 'text-white'}`}>
                          {ex.name}
                        </span>
                        {isSuperset && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-200 bg-fuchsia-500/25 border border-fuchsia-400/50 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                            <Zap className="w-3 h-3 text-fuchsia-300" />
                            Superset{ex.supersetGroup && ex.supersetGroup.toUpperCase() !== 'SUPERSET' ? ` · ${ex.supersetGroup}` : ''}
                          </span>
                        )}
                        {ex.day && (
                          <span className="text-[10px] font-semibold text-amber-200 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                            {ex.day}
                          </span>
                        )}
                        {(setsDisplay || repsDisplay) && (
                          <span className="text-[11px] text-neutral-200 font-mono bg-white/5 border border-white/10 px-2 py-0.5 rounded-md">
                            Target: {[setsDisplay && `${setsDisplay} sets`, repsDisplay && `${repsDisplay} reps`].filter(Boolean).join(' × ')}
                          </span>
                        )}
                        {showRpe && ex.targetRpe && (
                          <span className="text-[11px] text-amber-200 font-mono font-semibold bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-md">
                            Target RPE: {ex.targetRpe}
                          </span>
                        )}
                        {ex.targetRir?.trim() && (
                          <span className="text-[11px] text-sky-200 font-mono font-semibold bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 rounded-md">
                            Target RIR: {ex.targetRir}
                          </span>
                        )}
                        {videoInfo && (
                          <button
                            type="button"
                            onClick={() => setInlineVideoExId(prev => (prev === ex.id ? null : ex.id))}
                            className="sm:hidden text-[11px] font-bold text-red-200 bg-red-600/25 border border-red-500/40 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 cursor-pointer"
                          >
                            {inlineVideoExId === ex.id ? <X className="w-3 h-3" /> : <Play className="w-3 h-3 fill-current" />} Demo
                          </button>
                        )}
                        {allowModify && (
                          <button
                            type="button"
                            onClick={() => (isEditingThis ? setEditingExerciseId(null) : startEditExercise(ex))}
                            className="text-[10px] font-semibold text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-2 py-0.5 inline-flex items-center gap-1 cursor-pointer"
                            title="Freely modify target sets, reps, superset or notes"
                          >
                            <Pencil className="w-3 h-3" /> {isEditingThis ? 'Close' : 'Edit'}
                          </button>
                        )}
                        {isSavedRecently && (
                          <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                            <Check className="w-3 h-3" /> Saved
                          </span>
                        )}
                      </div>

                      {isCelebrating && justCompletedMotivation && (
                        <div className="-ml-9 sm:ml-0 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-100 animate-motivation-slide">
                          <Trophy className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="font-bold text-emerald-300">Exercise Done!</span>
                          <span className="text-emerald-100/90">{justCompletedMotivation}</span>
                        </div>
                      )}

                      {ex.notes && !(allowModify && isEditingThis) && (
                        <p className="text-[12px] text-neutral-400 leading-relaxed">{ex.notes}</p>
                      )}

                      {/* FREE INLINE EXERCISE MODIFIER (MY WORKOUTS ONLY) */}
                      {allowModify && isEditingThis && editDraft && (
                        <div className="-ml-9 sm:ml-0 rounded-xl border border-amber-500/30 bg-black/50 p-3 space-y-2.5 text-xs">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] uppercase text-neutral-400 font-semibold">Exercise Name</span>
                              <input
                                value={editDraft.name}
                                onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                                className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-white outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] uppercase text-neutral-400 font-semibold">Day Header</span>
                              <input
                                value={editDraft.day}
                                onChange={(e) => setEditDraft({ ...editDraft, day: e.target.value })}
                                placeholder="e.g. Day 1 - Push"
                                className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-amber-200 outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] uppercase text-neutral-400 font-semibold">Target Sets (or e.g. 4 × 5–12)</span>
                              <input
                                value={editDraft.sets}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const sp = splitSetsAndReps(val);
                                  if (sp) {
                                    setEditDraft({ ...editDraft, sets: sp.sets, reps: sp.reps });
                                  } else {
                                    setEditDraft({ ...editDraft, sets: val });
                                  }
                                }}
                                placeholder="4"
                                className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-white font-mono outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] uppercase text-neutral-400 font-semibold">Target Reps Range</span>
                              <input
                                value={editDraft.reps}
                                onChange={(e) => setEditDraft({ ...editDraft, reps: e.target.value })}
                                placeholder="5-12"
                                className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-white font-mono outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] uppercase text-neutral-400 font-semibold">Target RPE (from sheet / goal)</span>
                              <input
                                value={editDraft.targetRpe}
                                onChange={(e) => setEditDraft({ ...editDraft, targetRpe: e.target.value })}
                                placeholder="e.g. 8 or 7.5-8.5"
                                className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-amber-200 font-mono outline-none"
                              />
                            </label>
                            {editDraft.targetRir?.trim() && (
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] uppercase text-neutral-400 font-semibold">Target RIR (from workout sheet)</span>
                                <div className="bg-neutral-900/60 border border-sky-500/25 rounded-lg px-2.5 py-1.5 text-sky-200 font-mono select-text">
                                  {editDraft.targetRir}
                                </div>
                              </div>
                            )}
                            <label className="flex flex-col gap-1 sm:col-span-2">
                              <span className="text-[10px] uppercase text-neutral-400 font-semibold">Video URL</span>
                              <input
                                value={editDraft.videoUrl}
                                onChange={(e) => setEditDraft({ ...editDraft, videoUrl: e.target.value })}
                                placeholder="https://..."
                                className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-sky-300 font-mono outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1 sm:col-span-2">
                              <span className="text-[10px] uppercase text-neutral-400 font-semibold">Notes</span>
                              <input
                                value={editDraft.notes}
                                onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                                className="bg-neutral-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-neutral-200 outline-none"
                              />
                            </label>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setEditDraft({ ...editDraft, isSuperset: !editDraft.isSuperset })}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border inline-flex items-center gap-1 cursor-pointer ${
                                  editDraft.isSuperset
                                    ? 'bg-fuchsia-500/25 border-fuchsia-400/60 text-fuchsia-200'
                                    : 'bg-neutral-900 border-white/15 text-neutral-400'
                                }`}
                              >
                                <Zap className="w-3.5 h-3.5" />
                                {editDraft.isSuperset ? 'Superset Enabled' : 'Mark as Superset'}
                              </button>
                              {editDraft.isSuperset && (
                                <input
                                  value={editDraft.supersetGroup}
                                  onChange={(e) => setEditDraft({ ...editDraft, supersetGroup: e.target.value })}
                                  placeholder="Group (e.g. A1)"
                                  className="w-28 bg-neutral-900 border border-fuchsia-500/40 rounded-lg px-2 py-1 text-[11px] text-fuchsia-200 outline-none"
                                />
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => { setEditingExerciseId(null); setEditDraft(null); }}
                                className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 text-xs font-semibold cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => saveEditExercise(plan, ex)}
                                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" /> Save Changes
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* SETS TABLE (Weight + Reps + RPE + Per-Set Rest Timer) */}
                      <div className={`-ml-9 sm:ml-0 rounded-xl border p-3 space-y-2 ${isSuperset ? 'border-fuchsia-500/30 bg-black/45' : 'border-white/10 bg-neutral-950/60'}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                            Week {selectedWeek} Sets ({setEntries.length})
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => adjustSetCount(plan, selectedWeek, ex, -1)}
                              disabled={setEntries.length <= 1}
                              aria-label="Remove last set"
                              className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-neutral-300 cursor-pointer"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustSetCount(plan, selectedWeek, ex, 1)}
                              aria-label="Add set"
                              className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => saveExerciseSets(plan, selectedWeek, ex)}
                              className={`h-8 px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                                isSuperset
                                  ? 'bg-fuchsia-600/25 hover:bg-fuchsia-600/40 border-fuchsia-400/40 text-fuchsia-200'
                                  : 'bg-red-600/25 hover:bg-red-600/40 border-red-500/30 text-red-200'
                              }`}
                            >
                              <Check className="w-3 h-3" /> Save
                            </button>
                          </div>
                        </div>

                        {(() => {
                          const hasSheetRirDisplay =
                            (showRir || Boolean(ex.targetRir?.trim())) &&
                            (Boolean(ex.targetRir?.trim()) || setEntries.some(s => (s.rir || '').trim() !== ''));
                          return (
                            <>
                              {/* column labels, phones only */}
                              <div
                                className={`grid ${
                                  showRpe && hasSheetRirDisplay
                                    ? 'grid-cols-[24px_minmax(0,1.2fr)_minmax(0,0.75fr)_minmax(0,0.6fr)_minmax(0,0.55fr)_auto]'
                                    : showRpe || hasSheetRirDisplay
                                    ? 'grid-cols-[26px_minmax(0,1.35fr)_minmax(0,0.8fr)_minmax(0,0.65fr)_auto]'
                                    : 'grid-cols-[28px_minmax(0,1.4fr)_minmax(0,0.9fr)_auto]'
                                } gap-1 sm:hidden text-[9px] uppercase tracking-wider text-neutral-500 font-mono px-0.5`}
                              >
                                <span className="text-center">Set</span>
                                <span>Weight</span>
                                <span>Reps</span>
                                {showRpe && <span>RPE</span>}
                                {hasSheetRirDisplay && <span>RIR</span>}
                                <span className="text-center">Rest</span>
                              </div>

                              <div className="space-y-1.5">
                                {setEntries.map((setRow, sIdx) => {
                                  const prevForThisSet = prevWeekData?.setEntries[sIdx];
                                  const setUnit: WeightUnit = setRow.unit || planUnit;
                                  const setTimerKey = `${plan.id}__w${selectedWeek}__${ex.id}__s${sIdx}`;
                                  const isThisTimer = setRestTimer?.timerKey === setTimerKey;
                                  const isTimerRunning = isThisTimer && !!setRestTimer?.running;
                                  const isTimerDone = isThisTimer && !!setRestTimer?.finished;
                                  const sheetRirDisplay = (setRow.rir || '').trim() || (ex.targetRir || '').trim();

                                  const rowGridClasses =
                                    showRpe && hasSheetRirDisplay
                                      ? 'grid-cols-[24px_minmax(0,1.2fr)_minmax(0,0.75fr)_minmax(0,0.6fr)_minmax(0,0.55fr)_auto] sm:grid-cols-[60px_140px_100px_84px_76px_auto]'
                                      : showRpe || hasSheetRirDisplay
                                      ? 'grid-cols-[26px_minmax(0,1.35fr)_minmax(0,0.8fr)_minmax(0,0.65fr)_auto] sm:grid-cols-[64px_150px_115px_88px_auto]'
                                      : 'grid-cols-[28px_minmax(0,1.4fr)_minmax(0,0.9fr)_auto] sm:grid-cols-[64px_165px_125px_auto]';

                                  return (
                                    <div
                                      key={sIdx}
                                      className={`grid ${rowGridClasses} items-center gap-1 sm:gap-2`}
                                    >
                                      <span
                                        className={`h-11 sm:h-auto flex items-center justify-center text-[11px] font-mono font-bold border rounded-lg sm:py-1.5 ${
                                          isSuperset
                                            ? 'text-fuchsia-200 bg-fuchsia-500/20 border-fuchsia-400/35'
                                            : 'text-red-300 bg-red-500/10 border-red-500/20'
                                        }`}
                                      >
                                        <span className="sm:hidden">{sIdx + 1}</span>
                                        <span className="hidden sm:inline">Set {sIdx + 1}</span>
                                      </span>

                                      {/* Weight */}
                                      <div className="relative flex items-center min-w-0">
                                        <span className="hidden sm:block absolute left-2.5 text-[9px] uppercase font-mono text-neutral-500 pointer-events-none">Wt</span>
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          value={setRow.weight}
                                          onChange={(e) => updateSetField(plan, selectedWeek, ex, sIdx, 'weight', e.target.value)}
                                          onBlur={() => saveExerciseSets(plan, selectedWeek, ex)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              (e.currentTarget as HTMLInputElement).blur();
                                            }
                                          }}
                                          placeholder={prevForThisSet?.weight || '0'}
                                          aria-label={`Set ${sIdx + 1} Weight (${setUnit})`}
                                          className="w-full min-w-0 h-11 sm:h-auto bg-neutral-900 border border-white/15 focus:border-red-500/70 rounded-lg pl-2 pr-10 sm:pl-8 sm:pr-11 sm:py-1.5 text-base sm:text-xs text-white font-mono outline-none"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => updateSetField(plan, selectedWeek, ex, sIdx, 'unit', setUnit === 'kg' ? 'lbs' : 'kg')}
                                          aria-label="Switch between kg and lbs"
                                          className="absolute right-1 h-8 sm:h-auto px-1.5 sm:py-0.5 rounded-md bg-white/10 active:bg-white/25 text-[10px] font-bold uppercase text-neutral-200 cursor-pointer"
                                        >
                                          {setUnit}
                                        </button>
                                      </div>

                                      {/* Reps */}
                                      <label className="relative flex items-center min-w-0">
                                        <span className="hidden sm:block absolute left-2 text-[9px] uppercase font-mono text-neutral-500 pointer-events-none">Reps</span>
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={setRow.reps}
                                          onChange={(e) => updateSetField(plan, selectedWeek, ex, sIdx, 'reps', e.target.value)}
                                          onBlur={() => saveExerciseSets(plan, selectedWeek, ex)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              (e.currentTarget as HTMLInputElement).blur();
                                            }
                                          }}
                                          placeholder={prevForThisSet?.reps || '0'}
                                          aria-label={`Set ${sIdx + 1} Reps`}
                                          className="w-full min-w-0 h-11 sm:h-auto bg-neutral-900 border border-white/15 focus:border-red-500/70 rounded-lg px-2 sm:pl-9 sm:pr-2 sm:py-1.5 text-base sm:text-xs text-white font-mono outline-none"
                                        />
                                      </label>

                                      {/* Conditional RPE (only if sheet/plan includes RPE column) */}
                                      {showRpe && (
                                        <label className="relative flex items-center min-w-0">
                                          <span className="hidden sm:block absolute left-2 text-[9px] uppercase font-mono text-neutral-500 pointer-events-none">RPE</span>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            value={setRow.rpe || ''}
                                            onChange={(e) => updateSetField(plan, selectedWeek, ex, sIdx, 'rpe', e.target.value)}
                                            onBlur={() => saveExerciseSets(plan, selectedWeek, ex)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                e.preventDefault();
                                                (e.currentTarget as HTMLInputElement).blur();
                                              }
                                            }}
                                            placeholder={ex.targetRpe || prevForThisSet?.rpe || 'RPE'}
                                            aria-label={`Set ${sIdx + 1} RPE`}
                                            className="w-full min-w-0 h-11 sm:h-auto bg-neutral-900 border border-white/15 focus:border-amber-500/70 rounded-lg px-1.5 sm:pl-8 sm:pr-2 sm:py-1.5 text-base sm:text-xs text-amber-200 font-mono outline-none"
                                          />
                                        </label>
                                      )}

                                      {/* Read-only RIR / RIP display (only rendered when RIR content exists in workout sheet) */}
                                      {hasSheetRirDisplay && (
                                        <div
                                          title={sheetRirDisplay ? `Sheet RIR: ${sheetRirDisplay}` : 'No RIR value on this set'}
                                          aria-label={`Set ${sIdx + 1} Sheet RIR`}
                                          className={`h-11 sm:h-auto sm:py-1.5 px-2 rounded-lg border font-mono text-xs flex items-center justify-center sm:justify-between gap-1 select-text ${
                                            sheetRirDisplay
                                              ? 'bg-sky-950/35 border-sky-500/30 text-sky-200'
                                              : 'bg-neutral-900/40 border-white/10 text-neutral-600'
                                          }`}
                                        >
                                          <span className="hidden sm:inline text-[9px] uppercase text-sky-400/80">RIR</span>
                                          <span className="truncate font-semibold">{sheetRirDisplay || '—'}</span>
                                        </div>
                                      )}

                                {/* User-Controlled Per-Set Rest Timer */}
                                <div className="flex items-center gap-1 justify-end shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => startOrToggleSetRestTimer(setTimerKey, ex, sIdx + 1)}
                                    aria-label={
                                      isThisTimer
                                        ? isTimerRunning
                                          ? `Pause rest timer (${formatTimerClock(setRestTimer.remainingSec)})`
                                          : isTimerDone
                                          ? `Restart ${defaultRestSeconds}s rest timer`
                                          : `Resume rest timer`
                                        : `Start ${defaultRestSeconds}s rest timer for Set ${sIdx + 1}`
                                    }
                                    title={
                                      isThisTimer
                                        ? isTimerRunning
                                          ? 'Pause rest timer'
                                          : 'Resume / Restart rest timer'
                                        : `Start ${defaultRestSeconds}s rest timer`
                                    }
                                    className={`h-11 sm:h-auto sm:py-1.5 px-2 sm:px-2.5 rounded-lg border text-[11px] font-mono tabular-nums font-bold inline-flex items-center justify-center gap-1 transition-all cursor-pointer whitespace-nowrap ${
                                      isTimerDone
                                        ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                                        : isTimerRunning
                                        ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                                        : isThisTimer
                                        ? 'bg-amber-500/15 border-amber-500/35 text-amber-300'
                                        : 'bg-white/5 hover:bg-amber-500/15 border-white/10 hover:border-amber-400/40 text-neutral-300 hover:text-amber-200'
                                    }`}
                                  >
                                    {isTimerRunning ? (
                                      <Pause className="w-3 h-3 shrink-0" />
                                    ) : isThisTimer && !isTimerDone ? (
                                      <Play className="w-3 h-3 shrink-0" />
                                    ) : (
                                      <Timer className="w-3.5 h-3.5 shrink-0" />
                                    )}
                                    {isThisTimer ? (
                                      <span>{isTimerDone ? 'Done!' : formatTimerClock(setRestTimer.remainingSec)}</span>
                                    ) : (
                                      <>
                                        <span className="hidden sm:inline">Rest {defaultRestSeconds}s</span>
                                        <span className="sm:hidden text-[10px]">{defaultRestSeconds}s</span>
                                      </>
                                    )}
                                  </button>

                                  {isThisTimer && (
                                    <button
                                      type="button"
                                      onClick={stopSetRestTimer}
                                      aria-label={`Reset Set ${sIdx + 1} rest timer`}
                                      title="Reset / Stop rest timer"
                                      className="h-11 sm:h-7 w-7 inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 text-neutral-400 hover:text-red-300 cursor-pointer shrink-0"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* PER-EXERCISE WEEK NOTE CHECKITEM (DISABLED BY DEFAULT UNTIL ENABLED) */}
                      {(() => {
                        const noteEnabled = isExerciseNoteEnabled(plan, selectedWeek, ex.id);
                        const exNoteVal = getCurrentExerciseWeekNote(plan, selectedWeek, ex.id);
                        const savedExNote = (plan.exerciseLogs?.[weekKey(selectedWeek - 1)]?.[ex.id]?.notes || '').trim();
                        const hasUnsavedExNote =
                          draftKey(plan.id, selectedWeek, ex.id) in exerciseNoteDrafts &&
                          exNoteVal.trim() !== savedExNote;
                        const isExNoteSaved = savedNoticeId === `exnote_${ex.id}`;

                        return (
                          <div className="-ml-9 sm:ml-0 rounded-xl border border-white/10 bg-neutral-950/50 px-3 py-2 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={noteEnabled}
                                  onChange={(e) => toggleExerciseWeekNote(plan, selectedWeek, ex, e.target.checked)}
                                  className="w-4 h-4 rounded accent-red-500 cursor-pointer"
                                />
                                <span className="text-xs font-semibold text-neutral-300">
                                  Note (Week {selectedWeek})
                                </span>
                              </label>

                              {noteEnabled && (
                                <div className="flex items-center gap-2">
                                  {isExNoteSaved && (
                                    <span className="text-[10px] font-mono text-emerald-300 inline-flex items-center gap-1">
                                      <Check className="w-3 h-3" /> Saved
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => saveExerciseWeekNote(plan, selectedWeek, ex)}
                                    className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border inline-flex items-center gap-1 cursor-pointer ${
                                      hasUnsavedExNote
                                        ? 'bg-red-600/80 hover:bg-red-500 border-red-400 text-white'
                                        : 'bg-white/5 hover:bg-white/10 border-white/15 text-neutral-200'
                                    }`}
                                  >
                                    <Check className="w-3 h-3" /> Save Note
                                  </button>
                                </div>
                              )}
                            </div>

                            {noteEnabled && (
                              <textarea
                                rows={2}
                                value={exNoteVal}
                                onChange={(e) => updateExerciseWeekNoteDraft(plan, selectedWeek, ex.id, e.target.value)}
                                onBlur={() => saveExerciseWeekNote(plan, selectedWeek, ex)}
                                placeholder={`Write a Week ${selectedWeek} note for ${ex.name} (tempo, soreness, form cue, weight adjustment)...`}
                                aria-label={`${ex.name} Week ${selectedWeek} Note`}
                                className="w-full bg-neutral-900 border border-white/15 focus:border-red-500/60 rounded-lg px-3 py-2 text-xs text-white placeholder:text-neutral-500 outline-none resize-y leading-relaxed"
                              />
                            )}
                          </div>
                        );
                      })()}

                      {/* WEEKLY HISTORY */}
                      {weeklyHistory.length > 0 && (() => {
                        const hasAnyHistoryRpe = weeklyHistory.some(rec =>
                          rec.setEntries.some(s => getRpeIntensityMeta(s.rpe) !== null)
                        );
                        return (
                          <div className="-ml-9 sm:ml-0 rounded-xl border border-indigo-500/20 bg-indigo-950/15 p-3 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-300">
                                <History className="w-3.5 h-3.5 text-indigo-400" />
                                <span>History by Weeks</span>
                              </div>
                              {hasAnyHistoryRpe && (
                                <div className="flex flex-wrap items-center gap-2 text-[9px] font-medium text-neutral-400">
                                  <span className="inline-flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Light (&lt;6.5)
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Mod (6.5–7.9)
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400" /> Hard (8–8.9)
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Max (9–10)
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              {weeklyHistory.map((rec, rIdx) => (
                                <div
                                  key={`${rec.weekLabel}-${rIdx}`}
                                  className="flex flex-col gap-1 text-[11px] bg-black/30 border border-white/5 rounded-lg px-2.5 py-1.5"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-bold text-indigo-200 min-w-[68px]">{rec.weekLabel}</span>
                                    <div className="flex flex-wrap gap-1.5 flex-1">
                                      {rec.setEntries.map((s) => {
                                        const rpeMeta = getRpeIntensityMeta(s.rpe);
                                        return (
                                          <span
                                            key={s.setNumber}
                                            title={rpeMeta ? `RPE ${s.rpe} — ${rpeMeta.level} Intensity` : undefined}
                                            className={`inline-flex items-center gap-1.5 font-mono text-[10px] px-2 py-0.5 rounded border ${
                                              rpeMeta
                                                ? rpeMeta.chipClass
                                                : 'bg-neutral-900 border-white/10 text-neutral-200'
                                            }`}
                                          >
                                            {rpeMeta && (
                                              <span
                                                className={`w-2 h-2 rounded-full shrink-0 ${rpeMeta.dotClass}`}
                                                aria-hidden="true"
                                              />
                                            )}
                                            <span>
                                              <span className="text-red-300 font-semibold">S{s.setNumber}:</span>{' '}
                                              {s.weight ? `${s.weight} ${s.unit || planUnit}` : '—'} × {s.reps || '—'}
                                              {s.rpe ? (
                                                <span className={`font-semibold ${rpeMeta ? rpeMeta.textClass : 'text-amber-300'}`}>
                                                  {' '}· RPE {s.rpe}
                                                </span>
                                              ) : null}
                                              {s.rir ? <span className="text-sky-300"> · RIR {s.rir}</span> : null}
                                            </span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  {rec.note && (
                                    <p className="text-[11px] text-neutral-300 pl-[76px] italic">
                                      Note: {rec.note}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                      </div>  
                   </div>

                  {/* Right: VIDEO THUMBNAIL CARD (Opens inline WebView player directly on page) */}
                  {videoInfo && (
                    <div className="hidden sm:block w-44 shrink-0 space-y-1.5">
                      <button
                        type="button"
                        onClick={() => setInlineVideoExId(prev => (prev === ex.id ? null : ex.id))}
                        className={`group relative w-full aspect-video rounded-xl overflow-hidden border transition-all cursor-pointer block text-left bg-neutral-950 shadow-md ${
                          inlineVideoExId === ex.id
                            ? 'border-red-500 ring-2 ring-red-500/40'
                            : 'border-white/15 hover:border-red-500/60'
                        }`}
                        title={inlineVideoExId === ex.id ? `Close ${ex.name} WebView player` : `Play ${ex.name} inside website`}
                      >
                        {videoInfo.thumbnailUrl ? (
                          <img
                            src={videoInfo.thumbnailUrl}
                            alt={`${ex.name} video thumbnail`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : videoInfo.provider === 'direct' ? (
                          <video
                            src={videoInfo.normalizedUrl}
                            muted
                            preload="metadata"
                            playsInline
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-neutral-900 via-red-950/30 to-black flex flex-col items-center justify-center p-2">
                            <Video className="w-6 h-6 text-red-400/80 mb-1" />
                            <span className="text-[10px] text-neutral-300 font-semibold truncate max-w-full">
                              {videoInfo.providerLabel}
                            </span>
                          </div>
                        )}

                        <div className="absolute inset-0 bg-black/35 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <div className="w-9 h-9 rounded-full bg-red-600/90 group-hover:bg-red-500 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                            {inlineVideoExId === ex.id ? (
                              <X className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4 fill-white ml-0.5" />
                            )}
                          </div>
                        </div>

                        <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 border border-white/10 text-[9px] font-mono text-white">
                          {inlineVideoExId === ex.id ? 'Playing Inline' : `${videoInfo.providerLabel} · Watch`}
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                {/* INLINE IN-PAGE WEBVIEW VIDEO PLAYER (YOUTUBE / VIMEO / DRIVE / DIRECT) */}
                {videoInfo && inlineVideoExId === ex.id && (
                  <div className="mt-3 rounded-xl border border-red-500/35 bg-black overflow-hidden shadow-xl">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-neutral-950 border-b border-white/10">
                      <div className="flex items-center gap-2 min-w-0">
                        <Video className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        <span className="text-xs font-bold text-white truncate">
                          {ex.name} — {videoInfo.providerLabel} WebView
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setActiveVideoModal({
                              exerciseName: ex.name,
                              url: videoInfo.normalizedUrl,
                              embedUrl: videoInfo.embedUrl,
                              provider: videoInfo.provider,
                            })
                          }
                          className="text-[11px] font-semibold text-neutral-200 hover:text-white inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer"
                          title="Expand in large modal view"
                        >
                          <Maximize2 className="w-3 h-3" /> Expand
                        </button>
                        <a
                          href={videoInfo.normalizedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-red-300 hover:text-red-200 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20"
                        >
                          Link <ExternalLink className="w-3 h-3" />
                        </a>
                        <button
                          type="button"
                          onClick={() => setInlineVideoExId(null)}
                          className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer"
                          title="Close video player"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="aspect-video max-h-[420px] w-full bg-black flex items-center justify-center">
                      {videoInfo.embedUrl ? (
                        <iframe
                          src={videoInfo.embedUrl}
                          title={`${ex.name} WebView`}
                          className="w-full h-full border-0"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                        />
                      ) : videoInfo.provider === 'direct' ? (
                        <video
                          src={videoInfo.normalizedUrl}
                          controls
                          autoPlay
                          playsInline
                          className="w-full h-full"
                        />
                      ) : (
                        <div className="text-center p-5 space-y-2.5">
                          <Video className="w-8 h-8 text-red-500 mx-auto" />
                          <p className="text-xs text-neutral-300">
                            {videoInfo.providerLabel} prevents inline iframe playback on third-party sites.
                          </p>
                          <a
                            href={videoInfo.normalizedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
                          >
                            Open {videoInfo.providerLabel} Video <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {visibleExercises.length === 0 && (
            <p className="text-sm text-neutral-500 text-center py-6">No exercises in this filter yet.</p>
          )}

          {/* SESSION NOTES (CHECKITEM DISABLED BY DEFAULT UNTIL ENABLED, SAVED UNDER plan.exerciseLogs FOR CURRENT WEEK & DAY) */}
          {(() => {
            const wKey = weekKey(selectedWeek - 1);
            const noteKey = getSessionNoteKey(selectedDayFilter);
            const sessionNoteValue = getCurrentSessionNote(plan, selectedWeek, selectedDayFilter);
            const savedEntry = plan.exerciseLogs?.[wKey]?.[noteKey];
            const savedBadgeKey = `session_note_${plan.id}_${wKey}_${noteKey}`;
            const isNoteSavedRecently = savedNoticeId === savedBadgeKey;
            const sessionEnabled = isSessionNoteEnabled(plan, selectedWeek, selectedDayFilter);
            const scopeLabel =
              selectedDayFilter === 'ALL'
                ? activePlanDays.length > 1
                  ? 'All Days'
                  : activePlanDays[0] || 'Full Session'
                : selectedDayFilter;
            const hasUnsavedChanges =
              sessionNoteDraftKey(plan.id, selectedWeek, selectedDayFilter) in sessionNoteDrafts &&
              sessionNoteValue.trim() !== (savedEntry?.notes || '').trim();

            return (
              <div className="rounded-2xl border border-white/10 bg-neutral-900/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2.5 min-w-0 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={sessionEnabled}
                      onChange={(e) => toggleSessionNoteEnabled(plan, selectedWeek, selectedDayFilter, e.target.checked)}
                      className="w-4 h-4 rounded accent-red-500 cursor-pointer shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-red-500 shrink-0" />
                        <h3 className="text-sm font-bold text-white">Session Notes</h3>
                      </div>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Week {selectedWeek} <span aria-hidden="true">·</span> {scopeLabel}
                        {savedEntry?.updatedAt && (
                          <>
                            {' '}
                            <span aria-hidden="true">·</span> Updated{' '}
                            {new Date(savedEntry.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </>
                        )}
                      </p>
                    </div>
                  </label>

                  {sessionEnabled && (
                    <div className="flex items-center gap-2 shrink-0">
                      {isNoteSavedRecently && (
                        <span className="text-[11px] font-mono text-emerald-300 inline-flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Saved
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => saveSessionNotes(plan, selectedWeek, selectedDayFilter)}
                        className={`h-9 px-3.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                          hasUnsavedChanges
                            ? 'bg-red-600 hover:bg-red-500 border-red-400 text-white shadow-sm'
                            : 'bg-white/5 hover:bg-white/10 border-white/15 text-neutral-200'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Save Notes
                      </button>
                    </div>
                  )}
                </div>

                {sessionEnabled && (
                  <textarea
                    rows={3}
                    value={sessionNoteValue}
                    onChange={(e) => updateSessionNoteDraft(plan, selectedWeek, selectedDayFilter, e.target.value)}
                    onBlur={() => saveSessionNotes(plan, selectedWeek, selectedDayFilter)}
                    placeholder={`How did your Week ${selectedWeek} (${scopeLabel}) workout feel? Note energy levels, PRs, fatigue, or adjustments for next week...`}
                    aria-label={`Session Notes for Week ${selectedWeek} ${scopeLabel}`}
                    className="w-full bg-neutral-950 border border-white/15 focus:border-red-500/60 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-neutral-500 outline-none resize-y leading-relaxed"
                  />
                )}
              </div>
            );
          })()}
        </div>
      </div>
    );
  };

  const renderDashboard = () => (
    <div className="space-y-5">
      <div className="rounded-2xl border border-red-500/20 bg-gradient-to-r from-red-950/50 via-neutral-900 to-neutral-900 p-5 sm:p-6 relative z-20">
        <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
          <div className="absolute -right-8 -top-8 w-40 h-40 bg-red-600/20 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[11px] uppercase tracking-[0.2em] text-red-400 font-bold">Training Dashboard</span>
            <h1 className="text-2xl sm:text-3xl font-black text-white mt-1 flex items-center gap-2">
              <Flame className="w-7 h-7 text-red-500" /> {resolvedDisplayName}
            </h1>
            <p className="text-sm text-neutral-400 mt-1">Select your workout title below and log weight (kg/lbs) &amp; reps right here while training.</p>
          </div>
          <div className="flex flex-col items-end gap-2.5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: 'Plans', value: stats.plans, icon: Dumbbell },
                { label: 'Exercises', value: stats.totalExercises, icon: ListChecks },
                { label: 'Weeks', value: stats.totalWeeks, icon: CalendarDays },
                { label: 'Done', value: `${stats.pct}%`, icon: Trophy },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 min-w-[78px]">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">
                    <s.icon className="w-3.5 h-3.5 text-red-500" /> {s.label}
                  </div>
                  <div className="text-lg font-black text-white mt-0.5">{s.value}</div>
                </div>
              ))}
            </div>
            {activePlan && (
              <div className="flex flex-wrap items-center gap-2">
                {exportNotice && (
                  <span className="text-[11px] font-mono text-emerald-300 inline-flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> {exportNotice}
                  </span>
                )}
                {renderExportControl(activePlan, 'dashboard', 'hero')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* WORKOUT HYDRATION / WATER INTAKE TRACKER + BODY-WEIGHT LITERS CALCULATION */}
      {(() => {
        const targetGlasses = waterGoalSummary.targetGlasses;
        const targetLiters = waterGoalSummary.targetLiters;
        const consumedLiters = Number((waterGlasses * 0.25).toFixed(2));
        const remainingLiters = Math.max(0, Number((targetLiters - consumedLiters).toFixed(2)));
        const pct = Math.min(100, Math.round((waterGlasses / Math.max(1, targetGlasses)) * 100));
        return (
      <div className="rounded-2xl border border-white/10 bg-neutral-900/75 backdrop-blur-sm p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-sky-500/15 border border-sky-500/25 text-sky-400 shrink-0">
              <Droplets className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-white">Water Intake</h2>
                <span className="text-xs font-mono font-bold text-sky-300 bg-sky-500/15 border border-sky-500/25 px-2 py-0.5 rounded-md tabular-nums">
                  {consumedLiters} / {targetLiters} L
                </span>
                <span className="text-xs text-neutral-400">
                  {waterGlasses >= targetGlasses ? 'Daily target reached!' : `${remainingLiters} L left`}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <div className="h-2 w-40 sm:w-56 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      waterGlasses >= targetGlasses ? 'bg-emerald-500' : 'bg-sky-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-mono tabular-nums text-sky-300 font-semibold">
                  {waterGlasses} / {targetGlasses} glasses <span className="text-neutral-500">(250ml)</span>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
                {waterGoalSummary.hasWeight ? (
                  <span className="inline-flex items-center gap-1.5 text-sky-200/90 bg-sky-950/40 border border-sky-500/25 rounded-lg px-2 py-0.5">
                    <Scale className="w-3 h-3 text-sky-400" />
                    Calculated from body weight ({waterGoalSummary.weightDisplay} × 35 ml/kg = <strong className="text-white">{targetLiters} L/day</strong>)
                  </span>
                ) : (
                  <form onSubmit={handleQuickWaterWeightSave} className="inline-flex flex-wrap items-center gap-1.5">
                    <span className="text-neutral-400">Enter weight to auto-calculate L/day:</span>
                    <input
                      type="number"
                      step="0.1"
                      min="20"
                      max="400"
                      value={quickWaterWeightInput}
                      onChange={(e) => setQuickWaterWeightInput(e.target.value)}
                      placeholder="e.g. 75"
                      className="w-20 h-7 bg-neutral-950 border border-white/15 focus:border-sky-500/60 rounded-lg px-2 text-xs text-white font-mono outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setQuickWaterWeightUnit(u => (u === 'kg' ? 'lbs' : 'kg'))}
                      className="h-7 px-2 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-bold uppercase text-neutral-200 cursor-pointer"
                    >
                      {quickWaterWeightUnit}
                    </button>
                    <button
                      type="submit"
                      className="h-7 px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold cursor-pointer"
                    >
                      Calculate
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-center shrink-0">
            <button
              type="button"
              onClick={() => adjustWaterGlasses(-1)}
              disabled={waterGlasses <= 0}
              aria-label="Decrease water glasses"
              className="h-10 w-10 inline-flex items-center justify-center rounded-xl bg-neutral-950 hover:bg-neutral-800 disabled:opacity-35 border border-white/15 text-neutral-200 cursor-pointer transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>

            <div
              className="min-w-[74px] h-10 px-3 rounded-xl bg-neutral-950 border border-sky-500/30 flex items-center justify-center gap-1.5 font-mono tabular-nums"
              aria-live="polite"
            >
              <span className="text-lg font-black text-white">{waterGlasses}</span>
              <span className="text-[11px] text-neutral-400">{waterGlasses === 1 ? 'glass' : 'glasses'}</span>
            </div>

            <button
              type="button"
              onClick={() => adjustWaterGlasses(1)}
              disabled={waterGlasses >= 40}
              aria-label="Increase water glasses"
              className="h-10 w-10 inline-flex items-center justify-center rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-35 border border-sky-400/50 text-white cursor-pointer transition-colors shadow"
            >
              <Plus className="w-4 h-4" />
            </button>

            {waterGlasses > 0 && (
              <button
                type="button"
                onClick={resetWaterGlasses}
                aria-label="Reset water intake counter"
                title="Reset today's water count"
                className="h-10 px-2.5 inline-flex items-center justify-center gap-1 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-400 hover:text-white cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Telegram Water Intake Alert Controls (only shown when member has a Telegram username) */}
        {hasTelegramUsername && (
          <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => saveWaterReminderPrefs(!waterReminderEnabled, waterReminderIntervalMinutes)}
                className={`h-8 px-3 rounded-lg border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  waterReminderEnabled
                    ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                    : 'bg-white/5 hover:bg-white/10 border-white/10 text-neutral-300'
                }`}
              >
                <Bell className={`w-3.5 h-3.5 ${waterReminderEnabled ? 'text-emerald-400' : 'text-sky-400'}`} />
                <span>Bot Reminder: {waterReminderEnabled ? 'ON' : 'OFF'}</span>
              </button>

              <div className="flex flex-wrap items-center gap-1">
                {WATER_REMINDER_PRESETS.map((mins) => {
                  const isSelected = waterReminderIntervalMinutes === mins;
                  return (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => saveWaterReminderPrefs(waterReminderEnabled, mins)}
                      className={`h-7 px-2 rounded-lg text-[11px] font-mono tabular-nums font-bold border cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-sky-500/25 border-sky-400/60 text-sky-200'
                          : 'bg-neutral-950 border-white/10 text-neutral-400 hover:text-white'
                      }`}
                    >
                      {mins}m
                    </button>
                  );
                })}

                <div className="flex items-center gap-1 ml-1">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={customWaterIntervalInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCustomWaterIntervalInput(raw);
                      const n = parseInt(raw, 10);
                      if (Number.isFinite(n) && n >= 1 && n <= 1440) {
                        saveWaterReminderPrefs(waterReminderEnabled, n);
                      }
                    }}
                    onBlur={() => {
                      const n = parseInt(customWaterIntervalInput, 10);
                      if (!Number.isFinite(n) || n < 1) {
                        setCustomWaterIntervalInput(String(waterReminderIntervalMinutes));
                      } else {
                        saveWaterReminderPrefs(waterReminderEnabled, n);
                      }
                    }}
                    aria-label="Custom water reminder interval in minutes"
                    className="w-14 h-7 bg-neutral-950 border border-white/15 focus:border-sky-500/70 rounded-lg px-1.5 text-[11px] font-mono tabular-nums text-sky-200 text-center outline-none"
                  />
                  <span className="text-[10px] font-mono text-neutral-500">min</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {waterReminderEnabled && (
                <span className="text-[10px] font-mono text-emerald-300/90">
                  Active every {waterReminderIntervalMinutes}m (even when closed)
                </span>
              )}
              {waterAlertNotice && (
                <span className={`text-[11px] font-mono ${waterAlertNotice.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {waterAlertNotice.text}
                </span>
              )}
              <button
                type="button"
                disabled={isSendingWaterAlert}
                onClick={() => dispatchWaterTelegramAlert(true)}
                className="h-8 px-3 rounded-lg bg-sky-600/20 hover:bg-sky-600/35 disabled:opacity-50 border border-sky-500/35 text-sky-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                title="Send your water intake progress & hydration reminder to your Telegram bot chat"
              >
                {isSendingWaterAlert ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Send Alert to Bot</span>
              </button>
            </div>
          </div>
        )}
      </div>
        );
      })()}

      {/* ACTIVE WORKOUT DIRECTLY IN DASHBOARD FOR EASY TRAINING (MODIFICATIONS HIDDEN — USE MY WORKOUTS TO EDIT) */}
      {myPlans.length === 0 ? (
        <EmptyPlans onUpload={() => setActiveTab('upload')} />
      ) : (
        renderWorkoutsWorkspace(false, false)
      )}
    </div>
  );

  const renderBodyWeight = () => {
    const toDisplayWeight = (w: number, u: WeightUnit): number => {
      if (u === bodyWeightChartUnit) return Math.round(w * 10) / 10;
      const converted = u === 'kg' ? w * 2.20462 : w / 2.20462;
      return Math.round(converted * 10) / 10;
    };

    const chartData = [...bodyWeightEntries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((entry) => ({
        date: entry.date,
        label: entry.date.slice(5),
        weight: toDisplayWeight(entry.weight, entry.unit),
        rawWeight: entry.weight,
        rawUnit: entry.unit,
        note: entry.note || '',
      }));

    const latest = chartData.length > 0 ? chartData[chartData.length - 1] : null;
    const first = chartData.length > 0 ? chartData[0] : null;
    const netChange = latest && first ? Math.round((latest.weight - first.weight) * 10) / 10 : null;
    const minVal = chartData.length > 0 ? Math.min(...chartData.map(d => d.weight)) : null;
    const maxVal = chartData.length > 0 ? Math.max(...chartData.map(d => d.weight)) : null;

    return (
      <div className="space-y-5">
        {/* Hero Header */}
        <div className="rounded-2xl border border-red-500/20 bg-gradient-to-r from-red-950/40 via-neutral-900 to-neutral-900 p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-white">Body Weight Tracker</h2>
              <p className="text-xs text-neutral-400 mt-0.5">Log daily scale check-ins and track your long-term weight trend</p>
            </div>
          </div>

          <div className="inline-flex items-center rounded-xl bg-neutral-950 border border-white/15 p-1">
            {(['kg', 'lbs'] as WeightUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setBodyWeightChartUnit(u)}
                className={`px-3 py-1 rounded-lg text-xs font-bold uppercase cursor-pointer ${
                  bodyWeightChartUnit === u ? 'bg-red-600 text-white shadow' : 'text-neutral-400 hover:text-white'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-white/10 bg-neutral-900/70 p-3.5">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Latest Weight</div>
            <div className="text-xl font-black text-white font-mono tabular-nums mt-1">
              {latest ? `${latest.weight} ${bodyWeightChartUnit}` : '—'}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-neutral-900/70 p-3.5">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Starting</div>
            <div className="text-xl font-black text-neutral-200 font-mono tabular-nums mt-1">
              {first ? `${first.weight} ${bodyWeightChartUnit}` : '—'}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-neutral-900/70 p-3.5">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Net Change</div>
            <div
              className={`text-xl font-black font-mono tabular-nums mt-1 ${
                netChange === null
                  ? 'text-neutral-400'
                  : netChange > 0
                  ? 'text-amber-300'
                  : netChange < 0
                  ? 'text-emerald-300'
                  : 'text-white'
              }`}
            >
              {netChange === null ? '—' : `${netChange > 0 ? '+' : ''}${netChange} ${bodyWeightChartUnit}`}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-neutral-900/70 p-3.5">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Range / Logs</div>
            <div className="text-sm font-bold text-white font-mono tabular-nums mt-1.5">
              {minVal !== null && maxVal !== null ? `${minVal}–${maxVal} ${bodyWeightChartUnit}` : 'No entries'}
            </div>
            <div className="text-[10px] text-neutral-500 mt-0.5">{chartData.length} check-in{chartData.length === 1 ? '' : 's'}</div>
          </div>
        </div>

        {/* Daily Hydration Target calculated from body weight */}
        <div className="rounded-2xl border border-sky-500/25 bg-sky-950/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 shrink-0">
              <Droplets className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Daily Water Target (Based on Body Weight)</div>
              <div className="text-[11px] text-neutral-400">
                {waterGoalSummary.hasWeight
                  ? `${waterGoalSummary.weightDisplay} × 35 ml/kg = ${waterGoalSummary.targetLiters} L/day (${waterGoalSummary.targetGlasses} × 250ml glasses)`
                  : `Default ${waterGoalSummary.targetLiters} L/day — log your body weight below to personalize your liter target`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono tabular-nums">
            <span className="text-base font-black text-sky-300">{waterGoalSummary.targetLiters} L</span>
            <span className="text-[11px] text-neutral-400">/ day</span>
          </div>
        </div>

        {/* Daily Input Form */}
        <form onSubmit={handleSaveBodyWeight} className="rounded-2xl border border-white/10 bg-neutral-900/70 p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Log Daily Weight</h3>
            {bodyWeightNotice && (
              <span className="text-xs font-mono text-emerald-300 inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> {bodyWeightNotice}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <label className="flex flex-col gap-1 sm:col-span-3">
              <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Date</span>
              <input
                type="date"
                value={bodyWeightDateInput}
                onChange={(e) => setBodyWeightDateInput(e.target.value)}
                required
                className="h-10 bg-neutral-950 border border-white/15 focus:border-red-500/60 rounded-xl px-3 text-xs text-white font-mono outline-none"
              />
            </label>

            <div className="flex flex-col gap-1 sm:col-span-3">
              <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Weight ({bodyWeightUnitInput})</span>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="600"
                  value={bodyWeightValueInput}
                  onChange={(e) => setBodyWeightValueInput(e.target.value)}
                  placeholder="e.g. 78.5"
                  required
                  className="w-full h-10 bg-neutral-950 border border-white/15 focus:border-red-500/60 rounded-xl pl-3 pr-14 text-sm text-white font-mono tabular-nums outline-none"
                />
                <button
                  type="button"
                  onClick={() => setBodyWeightUnitInput(u => (u === 'kg' ? 'lbs' : 'kg'))}
                  className="absolute right-1.5 h-7 px-2 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-bold uppercase text-neutral-200 cursor-pointer"
                >
                  {bodyWeightUnitInput}
                </button>
              </div>
            </div>

            <label className="flex flex-col gap-1 sm:col-span-4">
              <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Note (optional)</span>
              <input
                type="text"
                value={bodyWeightNoteInput}
                onChange={(e) => setBodyWeightNoteInput(e.target.value)}
                placeholder="Morning fasted, post-refeed..."
                className="h-10 bg-neutral-950 border border-white/15 focus:border-red-500/60 rounded-xl px-3 text-xs text-white outline-none"
              />
            </label>

            <div className="flex items-end sm:col-span-2">
              <button
                type="submit"
                className="w-full h-10 px-4 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-lg shadow-red-950/40 cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Log Weight
              </button>
            </div>
          </div>
        </form>

        {/* Trend Line Chart */}
        <div className="rounded-2xl border border-white/10 bg-neutral-900/70 p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-red-500" /> Weight Trend ({bodyWeightChartUnit})
            </h3>
            {chartData.length > 0 && (
              <span className="text-[11px] font-mono text-neutral-400">
                {chartData[0].date} → {chartData[chartData.length - 1].date}
              </span>
            )}
          </div>

          {chartData.length === 0 ? (
            <div className="h-56 rounded-xl border border-dashed border-white/10 bg-neutral-950/50 flex flex-col items-center justify-center text-center p-4">
              <Scale className="w-8 h-8 text-neutral-600 mb-2" />
              <p className="text-xs font-semibold text-neutral-300">No body weight entries logged yet</p>
              <p className="text-[11px] text-neutral-500 mt-1">Log your weight above to plot your daily trend chart.</p>
            </div>
          ) : (
            <div className="w-full h-64 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 16, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis
                    dataKey="label"
                    stroke="#737373"
                    tick={{ fill: '#a3a3a3', fontSize: 11 }}
                  />
                  <YAxis
                    stroke="#737373"
                    domain={['auto', 'auto']}
                    tick={{ fill: '#a3a3a3', fontSize: 11 }}
                    tickFormatter={(v) => `${v}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0a0a0a',
                      borderColor: 'rgba(255,255,255,0.15)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#fff',
                    }}
                    formatter={(val: unknown) => [`${val} ${bodyWeightChartUnit}`, 'Weight']}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''}
                  />
                  <Line
                    type="monotone"
                    dataKey="weight"
                    stroke="#ef4444"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#ef4444', strokeWidth: 2, stroke: '#171717' }}
                    activeDot={{ r: 6, fill: '#f87171', stroke: '#fff', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* History List */}
        {bodyWeightEntries.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-neutral-900/70 p-4 sm:p-5 space-y-2.5">
            <h3 className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Check-in History</h3>
            <div className="space-y-1.5">
              {[...bodyWeightEntries]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-950/70 px-3.5 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                      <span className="text-xs font-mono text-neutral-400">{entry.date}</span>
                      <span className="text-sm font-black text-white font-mono tabular-nums">
                        {entry.weight} {entry.unit}
                      </span>
                      {entry.unit !== bodyWeightChartUnit && (
                        <span className="text-[11px] font-mono text-neutral-500">
                          ({toDisplayWeight(entry.weight, entry.unit)} {bodyWeightChartUnit})
                        </span>
                      )}
                      {entry.note && <span className="text-xs text-neutral-400 truncate">{entry.note}</span>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setBodyWeightDateInput(entry.date);
                          setBodyWeightValueInput(String(entry.weight));
                          setBodyWeightUnitInput(entry.unit);
                          setBodyWeightNoteInput(entry.note || '');
                        }}
                        aria-label={`Edit weight entry for ${entry.date}`}
                        className="p-1.5 text-neutral-400 hover:text-amber-300 rounded-lg hover:bg-white/5 cursor-pointer"
                        title="Load into form to edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteBodyWeight(entry.id)}
                        aria-label={`Delete weight entry for ${entry.date}`}
                        className="p-1.5 text-neutral-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 cursor-pointer"
                        title="Delete entry"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderProgress = () => (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-white uppercase tracking-wider">Progress Overview</h2>
      {myPlans.length === 0 ? (
        <EmptyPlans onUpload={() => setActiveTab('upload')} />
      ) : (
        <div className="space-y-3">
          {myPlans.map((plan) => {
            const c = planCompletion(plan);
            const weeks = Math.max(1, plan.weeks || 1);
            return (
              <div key={plan.id} className="rounded-2xl border border-white/10 bg-neutral-900/70 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-white text-[14px]">{plan.title}</span>
                  <span className="text-red-300 font-black text-sm">{c.pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-neutral-800 overflow-hidden mb-3">
                  <div className="h-full bg-gradient-to-r from-red-600 to-red-400" style={{ width: `${c.pct}%` }} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => {
                    const wkDone = (plan.progress?.[weekKey(w - 1)] || []).length;
                    const complete = plan.exercises.length > 0 && wkDone === plan.exercises.length;
                    return (
                      <span
                        key={w}
                        className={`text-[10px] font-bold rounded-lg px-2 py-1 border ${
                          complete
                            ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                            : wkDone > 0
                              ? 'border-red-500/40 text-red-300 bg-red-500/10'
                              : 'border-white/10 text-neutral-500'
                        }`}
                      >
                        W{w} {complete ? '✓' : `${wkDone}/${plan.exercises.length}`}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderProfile = () => {
    const isBotTokenReady = !!activeTelegramConfig.botToken?.trim();
    const is2FAEnabled = !!matchedAccount?.twoFactorEnabled;

    return (
      <div className="space-y-5">
        {/* Profile Header Card */}
        <div className="rounded-2xl border border-red-500/20 bg-gradient-to-r from-red-950/40 via-neutral-900 to-neutral-900 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-600 to-rose-700 text-white font-black text-xl flex items-center justify-center shadow-lg shadow-red-950/50 uppercase">
                {resolvedDisplayName.charAt(0)}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-black text-white">{resolvedDisplayName}</h2>
                  <span className="text-[11px] font-mono text-neutral-400 bg-white/5 border border-white/10 rounded-md px-2 py-0.5">
                    @{currentUser}
                  </span>
                  {is2FAEnabled && (
                    <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded-full px-2 py-0.5 inline-flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> 2FA Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-400 mt-1">
                  Manage your display name, password, Telegram bot notifications, and account security.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activePlan && renderExportControl(activePlan, 'profile', 'profile')}
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600/20 hover:bg-red-600/35 border border-red-500/30 text-xs font-bold text-red-200 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 1. Profile Name & Preferences */}
          <form onSubmit={handleSaveProfileDetails} className="rounded-2xl border border-white/10 bg-neutral-900/70 p-5 space-y-4">
            <div className="flex items-center gap-2.5 border-b border-white/10 pb-3">
              <div className="p-2 rounded-xl bg-red-500/15 border border-red-500/25 text-red-400">
                <User className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Profile Information</h3>
                <p className="text-[11px] text-neutral-400">Your name &amp; training defaults</p>
              </div>
            </div>

            {profileFeedback && (
              <div className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                profileFeedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {profileFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{profileFeedback.text}</span>
              </div>
            )}

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Full / Display Name</span>
                <input
                  type="text"
                  value={profileDisplayName}
                  onChange={(e) => setProfileDisplayName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full bg-neutral-950 border border-white/15 focus:border-red-500/60 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none"
                  required
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Login Username</span>
                <input
                  type="text"
                  value={currentUser}
                  readOnly
                  className="w-full bg-neutral-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-neutral-400 font-mono outline-none cursor-not-allowed"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Gender</span>
                  <select
                    value={profileGender}
                    onChange={(e) => setProfileGender(e.target.value)}
                    className="w-full bg-neutral-950 border border-white/15 focus:border-red-500/60 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </label>

                <div className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold block">Default Unit</span>
                  <div className="inline-flex rounded-xl bg-neutral-950 border border-white/15 p-1 w-full">
                    {(['kg', 'lbs'] as WeightUnit[]).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setProfileWeightUnit(u)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase cursor-pointer ${
                          profileWeightUnit === u ? 'bg-red-600 text-white' : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSavingProfile}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-red-950/40"
            >
              {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save Profile Changes
            </button>
          </form>

          {/* 2. Change Password (Old -> New -> Confirm New) */}
          <form onSubmit={handleChangeOwnPassword} className="rounded-2xl border border-white/10 bg-neutral-900/70 p-5 space-y-4">
            <div className="flex items-center gap-2.5 border-b border-white/10 pb-3">
              <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-400">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Change Password</h3>
                <p className="text-[11px] text-neutral-400">Verify your old password before setting a new one</p>
              </div>
            </div>

            {passwordFeedback && (
              <div className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                passwordFeedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {passwordFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{passwordFeedback.text}</span>
              </div>
            )}

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Current (Old) Password</span>
                <div className="relative">
                  <input
                    type={showOldPass ? 'text' : 'password'}
                    value={oldPasswordInput}
                    onChange={(e) => setOldPasswordInput(e.target.value)}
                    placeholder="Enter current password"
                    autoComplete="current-password"
                    className="w-full bg-neutral-950 border border-white/15 focus:border-amber-500/60 rounded-xl px-3.5 py-2.5 pr-10 text-sm text-white outline-none"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowOldPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                    aria-label="Toggle old password visibility"
                  >
                    {showOldPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">New Password</span>
                <div className="relative">
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    placeholder="Minimum 6 characters"
                    autoComplete="new-password"
                    className="w-full bg-neutral-950 border border-white/15 focus:border-amber-500/60 rounded-xl px-3.5 py-2.5 pr-10 text-sm text-white outline-none"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                    aria-label="Toggle new password visibility"
                  >
                    {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Confirm New Password</span>
                <div className="relative">
                  <input
                    type={showConfirmPass ? 'text' : 'password'}
                    value={confirmPasswordInput}
                    onChange={(e) => setConfirmPasswordInput(e.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                    className="w-full bg-neutral-950 border border-white/15 focus:border-amber-500/60 rounded-xl px-3.5 py-2.5 pr-10 text-sm text-white outline-none"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                    aria-label="Toggle confirm password visibility"
                  >
                    {showConfirmPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>
            </div>

            <button
              type="submit"
              disabled={isChangingPassword}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              {isChangingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Update Password
            </button>
          </form>

          {/* 3. Telegram Bot Integration & Notifications */}
          <form onSubmit={handleSaveMemberTelegram} className="rounded-2xl border border-white/10 bg-neutral-900/70 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-sky-500/15 border border-sky-500/25 text-sky-400">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Telegram Bot &amp; Alerts</h3>
                  <p className="text-[11px] text-neutral-400">Connect your Telegram account for instant notifications</p>
                </div>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                memberWhitelistStatus === 'active'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : memberWhitelistStatus === 'paused'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}>
                {memberWhitelistStatus === 'active'
                  ? 'Whitelisted 🟢'
                  : memberWhitelistStatus === 'paused'
                    ? 'Paused by Admin ⏸️'
                    : 'Awaiting Admin Whitelist 🔒'}
              </span>
            </div>

            {memberWhitelistStatus !== 'active' && (
              <div className={`p-3 rounded-xl text-[11px] flex items-start gap-2 border ${
                memberWhitelistStatus === 'paused'
                  ? 'bg-rose-500/10 border-rose-500/25 text-rose-200'
                  : 'bg-amber-500/10 border-amber-500/25 text-amber-200'
              }`}>
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {memberWhitelistStatus === 'paused'
                    ? 'Your Telegram bot access is currently paused by the Admin. Contact your Coach/Admin to re-enable bot access.'
                    : 'Only users added to the Admin Panel Telegram Whitelist can query workout data from the Telegram bot. Save your @username here and ask your Admin to approve it.'}
                </span>
              </div>
            )}

            {telegramFeedback && (
              <div className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                telegramFeedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {telegramFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{telegramFeedback.text}</span>
              </div>
            )}

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Telegram Username</span>
                <input
                  type="text"
                  value={tgUsernameInput}
                  onChange={(e) => setTgUsernameInput(e.target.value)}
                  placeholder="@yourusername"
                  className="w-full bg-neutral-950 border border-white/15 focus:border-sky-500/60 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono outline-none"
                />
              </label>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Telegram Chat ID</span>
                  <button
                    type="button"
                    disabled={isDetectingTelegram || !isBotTokenReady}
                    onClick={handleAutoDetectTelegramChatId}
                    className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 disabled:opacity-40 cursor-pointer"
                  >
                    {isDetectingTelegram ? 'Scanning bot...' : '⚡ Auto-Detect from Bot'}
                  </button>
                </div>
                <input
                  type="text"
                  value={tgChatIdInput}
                  onChange={(e) => setTgChatIdInput(e.target.value)}
                  placeholder="Send /start in bot, then click Auto-Detect"
                  className="w-full bg-neutral-950 border border-white/15 focus:border-sky-500/60 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono outline-none"
                />
              </div>

              <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-950/70 border border-white/10 cursor-pointer">
                <div className="flex items-center gap-2 text-xs text-neutral-200">
                  <Bell className="w-4 h-4 text-sky-400" />
                  <span>Receive Telegram workout &amp; security alerts</span>
                </div>
                <input
                  type="checkbox"
                  checked={tgNotificationsEnabled}
                  onChange={(e) => setTgNotificationsEnabled(e.target.checked)}
                  className="w-4 h-4 accent-sky-500 cursor-pointer"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isSavingTelegram}
                className="flex-1 py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isSavingTelegram ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save Telegram Settings
              </button>
              <button
                type="button"
                disabled={isTestingTelegram || !isBotTokenReady || !tgChatIdInput.trim()}
                onClick={handleSendTestTelegram}
                className="py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/15 text-sky-300 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isTestingTelegram ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send Test
              </button>
            </div>
          </form>

          {/* 4. Two-Factor Authentication & Security */}
          <div className="rounded-2xl border border-white/10 bg-neutral-900/70 p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/25 text-indigo-400">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Two-Factor Authentication (2FA)</h3>
                    <p className="text-[11px] text-neutral-400">Protect your login with Google Authenticator or Authy</p>
                  </div>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  is2FAEnabled
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-neutral-800 border-white/10 text-neutral-400'
                }`}>
                  {is2FAEnabled ? 'Active' : 'Disabled'}
                </span>
              </div>

              <p className="text-xs text-neutral-300 leading-relaxed">
                {is2FAEnabled
                  ? `2FA is active on @${currentUser}. You have ${(matchedAccount?.twoFactorBackupCodes || []).length} emergency backup codes remaining.`
                  : 'Add an extra layer of account protection using TOTP authenticator codes and single-use backup recovery codes.'}
              </p>

              <div className="rounded-xl bg-neutral-950/70 border border-white/10 p-3.5 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] uppercase text-neutral-500 font-semibold">Plans</div>
                  <div className="text-base font-black text-white">{stats.plans}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-neutral-500 font-semibold">Exercises</div>
                  <div className="text-base font-black text-white">{stats.totalExercises}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-neutral-500 font-semibold">Progress</div>
                  <div className="text-base font-black text-red-400">{stats.pct}%</div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIs2FAModalOpen(true)}
              className={`w-full py-2.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-all ${
                is2FAEnabled
                  ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              {is2FAEnabled ? 'Manage 2FA & Backup Codes' : 'Enable Two-Factor Authentication'}
            </button>
          </div>

          {/* 5. Custom Website Background Image (Isolated Per User) */}
          <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-neutral-900/70 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/25 text-fuchsia-400">
                  <ImageIcon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Website Background Image</h3>
                  <p className="text-[11px] text-neutral-400">
                    Customize the website background exclusively for <span className="text-neutral-200 font-mono">@{currentUser}</span>
                  </p>
                </div>
              </div>
              {userBgImageUrl && (
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-200">
                  Custom Background Active
                </span>
              )}
            </div>

            {bgFeedback && (
              <div className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                bgFeedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {bgFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{bgFeedback.text}</span>
              </div>
            )}

            <input
              ref={bgFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/*"
              onChange={handleUploadBgFile}
              className="hidden"
            />

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              <div className="md:col-span-5">
                <div className="relative h-36 rounded-xl overflow-hidden border border-white/15 bg-neutral-950 flex items-center justify-center">
                  {userBgImageUrl ? (
                    <>
                      <div
                        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                        style={{ backgroundImage: `url("${userBgImageUrl}")` }}
                      />
                      <div
                        className="absolute inset-0 bg-black"
                        style={{ opacity: userBgDimPercent / 100 }}
                      />
                      <div className="relative z-10 px-3 py-1 rounded-lg bg-black/60 border border-white/15 text-[11px] font-semibold text-white">
                        Preview ({userBgDimPercent}% dim overlay)
                      </div>
                    </>
                  ) : (
                    <div className="text-center px-4 space-y-1">
                      <ImageIcon className="w-6 h-6 text-neutral-600 mx-auto" />
                      <p className="text-xs font-semibold text-neutral-400">Default Dark Theme</p>
                      <p className="text-[10px] text-neutral-500">Only visible to your account when uploaded</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="md:col-span-7 space-y-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isUploadingBg}
                    onClick={() => bgFileInputRef.current?.click()}
                    className="py-2.5 px-4 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer shadow-lg shadow-fuchsia-950/30"
                  >
                    {isUploadingBg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {userBgImageUrl ? 'Change Background Image' : 'Upload Background Image'}
                  </button>

                  {userBgImageUrl && (
                    <button
                      type="button"
                      disabled={isUploadingBg}
                      onClick={handleRemoveUserBg}
                      className="py-2.5 px-4 rounded-xl bg-white/5 hover:bg-red-500/20 border border-white/15 hover:border-red-500/40 text-neutral-300 hover:text-red-200 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove Background
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="uppercase tracking-wider text-neutral-400 font-semibold">
                      Background Dim / Readability Overlay
                    </span>
                    <span className="font-mono text-fuchsia-300 font-bold">{userBgDimPercent}%</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={95}
                    step={5}
                    value={userBgDimPercent}
                    onChange={(e) => handleBgDimChange(Number(e.target.value))}
                    aria-label="Background overlay darkness percentage"
                    className="w-full accent-fuchsia-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-neutral-500">
                    Supports PNG, JPG, WEBP, or GIF. Automatically optimized for crisp display while keeping cards easy to read.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative h-[100dvh] flex flex-col bg-black text-white overflow-hidden selection:bg-red-900 selection:text-red-100 font-sans">
      {userBgImageUrl && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-300"
            style={{ backgroundImage: `url("${userBgImageUrl}")` }}
          />
          <div
            className="absolute inset-0 bg-black transition-opacity duration-200"
            style={{ opacity: Math.min(0.95, Math.max(0.2, userBgDimPercent / 100)) }}
          />
        </div>
      )}
      {/* Header */}
        <header className="relative z-40 border-b border-red-500/20 bg-black/80 backdrop-blur-xl sticky top-0 shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          <button onClick={() => setActiveTab('dashboard')} className="flex items-center gap-2.5 group cursor-pointer min-w-0">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-red-700 to-red-500 text-white shadow-lg shadow-red-950/50 shrink-0">
              <Dumbbell className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="flex flex-col leading-tight text-left">
              <span className="font-black text-sm sm:text-base tracking-tight text-white">GYM WORKOUT</span>
              <span className="text-[8px] sm:text-[9px] uppercase tracking-[0.25em] text-red-500 font-bold">Train Hard</span>
            </div>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {/* phone: avatar */}
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              aria-label="Profile"
              className={`sm:hidden h-10 w-10 rounded-full font-black text-sm uppercase flex items-center justify-center border ${
                activeTab === 'profile' ? 'bg-red-600 border-red-400 text-white' : 'bg-neutral-900 border-white/15 text-red-300'
              }`}
            >
              {resolvedDisplayName.charAt(0)}
            </button>
            {/* desktop: name chip */}
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                activeTab === 'profile' ? 'bg-red-600/25 border-red-500/50 text-red-200' : 'bg-neutral-900 border-white/10 hover:border-red-500/40 text-neutral-300'
              }`}
            >
              <User className="w-3.5 h-3.5 text-red-400" />
              <span className="max-w-[120px] truncate">{resolvedDisplayName}</span>
            </button>
            <button
              onClick={onLogout}
              aria-label="Logout"
              className="h-10 w-10 sm:w-auto sm:px-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-neutral-900 border border-white/10 hover:border-red-500/40 text-xs font-semibold text-neutral-200 cursor-pointer"
            >
              <LogOut className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>

        {/* Desktop tabs */}
        <nav className="hidden sm:block border-t border-white/5">
          <div className="max-w-5xl mx-auto px-4 flex gap-1">
            {GYM_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
                  activeTab === tab.id
                    ? 'border-red-500 text-red-400'
                    : 'border-transparent text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <tab.icon className="w-4 h-4" /> {tab.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {/* Content */}
        <main className="relative z-10 flex-1 overflow-y-auto overscroll-contain">
          <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-8">
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'workouts' && renderWorkoutsWorkspace(true, true)}
          {activeTab === 'weight' && renderBodyWeight()}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-black text-white">Upload your workout sheet</h2>
                <p className="text-[13px] text-neutral-400 mt-0.5">
                  Upload a multi-sheet Excel, CSV, or PDF file. Supports combined &ldquo;Sets × Reps&rdquo; (e.g. 4 × 5–12), Day headers, Supersets, RPE/RIR columns, and auto-fetched video URLs.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-neutral-900/40 p-4">
                <SheetUploader
                  mode="user"
                  currentUser={currentUser}
                  existingPlans={myPlans}
                  activePlanId={activePlan?.id || ''}
                  onSaved={(_, firstPlanId) => {
                    if (firstPlanId) {
                      clearPlanDraftCaches(firstPlanId);
                      openPlan(firstPlanId);
                    }
                    setActiveTab('dashboard');
                  }}
                />
              </div>
            </div>
          )}
          {activeTab === 'progress' && renderProgress()}
          {activeTab === 'profile' && renderProfile()}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-black/85 backdrop-blur-xl border-t border-red-500/20 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-6 px-1">
          {GYM_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex flex-col items-center gap-0.5 pt-2.5 pb-1.5 text-[10px] font-bold tracking-wide active:scale-95 transition-transform cursor-pointer"
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-red-500" />}
                <tab.icon className={`w-5 h-5 ${active ? 'text-red-400' : 'text-neutral-500'}`} />
                <span className={active ? 'text-red-300' : 'text-neutral-500'}>{tab.short}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Video Player / Preview Modal */}
      {activeVideoModal && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActiveVideoModal(null)}
        >
          <div
            className="w-full max-w-2xl bg-neutral-950 border border-white/15 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2 min-w-0">
                <Video className="w-4 h-4 text-red-500 shrink-0" />
                <h3 className="text-sm font-bold text-white truncate">{activeVideoModal.exerciseName}</h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={activeVideoModal.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-red-300 hover:text-red-200 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20"
                >
                  Open Link <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  type="button"
                  onClick={() => setActiveVideoModal(null)}
                  className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="aspect-video bg-black flex items-center justify-center">
              {activeVideoModal.embedUrl ? (
                <iframe
                  src={activeVideoModal.embedUrl}
                  title={activeVideoModal.exerciseName}
                  className="w-full h-full border-0"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : activeVideoModal.provider === 'direct' ? (
                <video
                  src={activeVideoModal.url}
                  controls
                  autoPlay
                  playsInline
                  className="w-full h-full"
                />
              ) : (
                <div className="text-center p-6 space-y-3">
                  <Video className="w-10 h-10 text-red-500 mx-auto" />
                  <p className="text-xs text-neutral-300">
                    This video host cannot be embedded directly inside the modal.
                  </p>
                  <a
                    href={activeVideoModal.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
                  >
                    Watch Demo Video <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Delete Workout Plan Confirmation Modal */}
      {planToDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !isDeletingPlan && setPlanToDelete(null)}
        >
          <div
            className="w-full max-w-md bg-neutral-900 border border-white/15 rounded-3xl p-6 shadow-2xl relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-red-500 to-rose-600" />
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/25 text-red-400">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Delete Workout Plan?</h3>
                <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">Irreversible Action</p>
              </div>
            </div>
            <p className="text-sm text-neutral-300 leading-relaxed mb-6">
              Are you sure you want to delete{' '}
              <span className="text-white font-semibold">&ldquo;{planToDelete.title}&rdquo;</span> ({planToDelete.exercises.length} exercises)?
              All logged sets, weights, and weekly history for this plan will be permanently removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={isDeletingPlan}
                onClick={() => setPlanToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider text-neutral-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingPlan}
                onClick={confirmDeletePlan}
                className="px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white shadow cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeletingPlan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rest Timer Finished In-App Alert Banner */}
      {restAlertBanner && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:bottom-5 right-3 sm:right-5 left-3 sm:left-auto sm:w-96 z-[9990] rounded-2xl border border-emerald-400/50 bg-neutral-950/95 backdrop-blur-xl shadow-2xl shadow-black/75 p-3.5 flex items-start gap-3 animate-motivation-slide"
        >
          <div className="p-2 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 shrink-0">
            <Volume2 className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-extrabold text-emerald-300 uppercase tracking-wider">
              Rest Complete ({restAlertBanner.totalSec}s)
            </div>
            <p className="text-xs text-white font-semibold truncate mt-0.5">
              {restAlertBanner.exerciseName} — Set {restAlertBanner.setNumber}
            </p>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              Ready for your next set. Stay focused!
            </p>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  startOrToggleSetRestTimer(
                    restAlertBanner.timerKey,
                    { id: restAlertBanner.exerciseId, name: restAlertBanner.exerciseName } as WorkoutExercise,
                    restAlertBanner.setNumber,
                    defaultRestSeconds
                  );
                }}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-amber-200 text-[11px] font-bold cursor-pointer inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Restart {defaultRestSeconds}s
              </button>
              <button
                type="button"
                onClick={() => setRestAlertBanner(null)}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-neutral-200 text-[11px] font-semibold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRestAlertBanner(null)}
            aria-label="Close rest complete alert"
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Member 2FA Setup Modal */}
      {is2FAModalOpen && (
        <TwoFactorSetupModal
          isOpen={is2FAModalOpen}
          onClose={() => setIs2FAModalOpen(false)}
          username={currentUser}
          isAlreadyEnabled={!!matchedAccount?.twoFactorEnabled}
          currentSecret={matchedAccount?.twoFactorSecret || ''}
          currentBackupCodes={matchedAccount?.twoFactorBackupCodes || []}
          onSave2FA={handleSaveMember2FA}
          onDisable2FA={handleDisableMember2FA}
        />
      )}
    </div>
  );
};

const EmptyPlans: React.FC<{ onUpload: () => void }> = ({ onUpload }) => (
  <div className="rounded-2xl border border-dashed border-white/15 bg-neutral-900/40 p-8 text-center">
    <div className="mx-auto w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-3">
      <Play className="w-6 h-6" />
    </div>
    <p className="text-sm font-bold text-white">No workout plans yet</p>
    <p className="text-[12px] text-neutral-500 mt-1 mb-4">Upload a sheet to get started, or wait for your coach to assign one.</p>
    <button
      onClick={onUpload}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white text-sm font-bold shadow-lg shadow-red-950/40 cursor-pointer"
    >
      <Upload className="w-4 h-4" /> Upload a sheet
    </button>
  </div>
);

export default GymApp;
