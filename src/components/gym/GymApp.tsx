import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dumbbell, LayoutDashboard, ListChecks, Upload, TrendingUp, LogOut,
  Play, CheckCircle2, Circle, Video, Flame, CalendarDays,
  Trash2, Trophy, FileText, History, Check, X, ExternalLink,
  ChevronDown, ChevronUp, Plus, Minus, Zap, Pencil,
  FileSpreadsheet, Maximize2, ShieldCheck, Loader2, Download,
  User, KeyRound, Eye, EyeOff, Send, ShieldAlert, AlertCircle, Bell
} from 'lucide-react';
import {
  WorkoutPlan, WorkoutExercise, ExerciseLogEntry, SetLogEntry, WeightUnit,
  UserAccount, AdminSetting
} from '../../types';
import {
  subscribeToWorkoutPlans,
  saveWorkoutPlanDoc,
  deleteWorkoutPlanDoc,
  mergeUpdatedWorksheetIntoPlan,
} from '../../lib/gymService';
import { saveUserAccountDoc, saveAdminSettingDoc, logActivity } from '../../lib/syncService';
import { hashPassword, verifyPassword } from '../../utils/crypto';
import {
  getTelegramConfig,
  saveTelegramConfig as persistTelegramConfig,
  fetchTelegramChatIdsDetailed,
  addAuthorizedTelegramUser,
  sendDirectTelegramMessage,
  sendTelegramAlert,
  formatSecurityAlertTelegramMessage,
} from '../../lib/telegramService';
import {
  getVideoThumbnailInfo,
  parseSetsCount,
  splitSetsAndReps,
  parseSheetFileAllSheets,
  ParsedWeekData,
} from '../../lib/sheetParser';
import { exportWorkoutPlanToPdf } from '../../lib/workoutPdfExport';
import { TwoFactorSetupModal } from '../TwoFactorSetupModal';
import { SheetUploader } from './SheetUploader';

interface GymAppProps {
  currentUser: string;
  userAccounts?: UserAccount[];
  adminSettings?: AdminSetting[];
  onLogout: () => void;
}

type GymTab = 'dashboard' | 'workouts' | 'upload' | 'progress' | 'profile';

const GYM_TABS: { id: GymTab; label: string;  short: string; icon: React.ComponentType<{ className?: string }>; }[] = [
  { id: 'dashboard', label: 'Dashboard',    short: 'Home',     icon: LayoutDashboard },
  { id: 'workouts',  label: 'My Workouts',  short: 'Workouts', icon: ListChecks },
  { id: 'upload',    label: 'Upload Sheet', short: 'Upload',   icon: Upload },
  { id: 'progress',  label: 'Progress',     short: 'Progress', icon: TrendingUp },
  { id: 'profile',   label: 'Profile',      short: 'Profile',  icon: User },
];

const weekKey = (weekIdx: number) => `w${weekIdx + 1}`;

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

  // Respect user-customized setEntries length if already saved
  if (logged?.setEntries && logged.setEntries.length > 0) {
    return logged.setEntries.map((existing, idx) => ({
      setNumber: idx + 1,
      weight: existing?.weight ?? '',
      unit: existing?.unit || logged.unit || defaultUnit,
      reps: existing?.reps ?? '',
    }));
  }

  // Backward-compatible hydration for legacy single sets/reps entries
  if (logged && (logged.sets?.trim() || logged.reps?.trim() || logged.weight?.trim())) {
    const count = Math.max(targetCount, parseSetsCount(logged.sets));
    return Array.from({ length: count }, (_, idx) => ({
      setNumber: idx + 1,
      weight: logged.weight ?? '',
      unit: logged.unit || defaultUnit,
      reps: logged.reps ?? '',
    }));
  }

  return Array.from({ length: targetCount }, (_, idx) => ({
    setNumber: idx + 1,
    weight: '',
    unit: defaultUnit,
    reps: '',
  }));
}

function entryHasLoggedData(entry?: ExerciseLogEntry): boolean {
  if (!entry) return false;
  if (entry.setEntries && entry.setEntries.some(s => s.weight.trim() !== '' || s.reps.trim() !== '')) {
    return true;
  }
  return Boolean(entry.weight?.trim() || entry.reps?.trim() || entry.sets?.trim());
}

interface WeekHistoryRecord {
  weekLabel: string;
  weekNum: number;
  planTitle?: string;
  updatedAt?: string;
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
      if (!entryHasLoggedData(entry)) return;
      const setsList =
        entry?.setEntries && entry.setEntries.length > 0
          ? entry.setEntries
              .filter(s => s.weight.trim() !== '' || s.reps.trim() !== '')
              .map(s => ({ ...s, unit: s.unit || entry.unit || planUnit }))
          : [{ setNumber: 1, weight: entry?.weight || '', unit: entry?.unit || planUnit, reps: entry?.reps || '' }];
      if (setsList.length === 0) return;
      records.push({
        weekLabel: `Week ${w}`,
        weekNum: w,
        updatedAt: entry?.updatedAt,
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
        if (!entryHasLoggedData(entry)) continue;
        const setsList =
          entry?.setEntries && entry.setEntries.length > 0
            ? entry.setEntries
                .filter(s => s.weight.trim() !== '' || s.reps.trim() !== '')
                .map(s => ({ ...s, unit: s.unit || entry.unit || otherUnit }))
            : [{ setNumber: 1, weight: entry?.weight || '', unit: entry?.unit || otherUnit, reps: entry?.reps || '' }];
        if (setsList.length === 0) continue;
        records.push({
          weekLabel: `${other.title} · W${wk.num}`,
          weekNum: wk.num,
          planTitle: other.title,
          updatedAt: entry?.updatedAt,
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
  const [savedNoticeId, setSavedNoticeId] = useState<string | null>(null);

  // Inline exercise metadata editor (to freely modify sets/reps/superset/notes/video later)
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    day: string;
    sets: string;
    reps: string;
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
    exercises: Array<{
      id?: string;
      day: string;
      name: string;
      sets: string;
      reps: string;
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

  const updateSetField = (
    plan: WorkoutPlan,
    wk: number,
    ex: WorkoutExercise,
    setIdx: number,
    field: 'weight' | 'reps' | 'unit',
    value: string
  ) => {
    const dKey = draftKey(plan.id, wk, ex.id);
    const current = getCurrentSetEntries(plan, wk, ex);
    const updated = current.map((s, idx) =>
      idx === setIdx ? { ...s, setNumber: idx + 1, [field]: value } : s
    );
    setDraftSets(prev => ({ ...prev, [dKey]: updated }));
    if (field === 'unit') {
      saveExerciseSets(plan, wk, ex, updated);
    }
  };

  const adjustSetCount = (plan: WorkoutPlan, wk: number, ex: WorkoutExercise, delta: 1 | -1) => {
    const dKey = draftKey(plan.id, wk, ex.id);
    const current = getCurrentSetEntries(plan, wk, ex);
    const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
    let next = current;
    if (delta === 1 && current.length < 20) {
      const lastUnit = current[current.length - 1]?.unit || planUnit;
      next = [...current, { setNumber: current.length + 1, weight: '', unit: lastUnit, reps: '' }];
    } else if (delta === -1 && current.length > 1) {
      next = current.slice(0, current.length - 1);
    } else {
      return;
    }
    setDraftSets(prev => ({ ...prev, [dKey]: next }));
    saveExerciseSets(plan, wk, ex, next);
  };

  const changePlanWeightUnit = async (plan: WorkoutPlan, unit: WeightUnit) => {
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
    const wKey = weekKey(wk - 1);
    const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
    const rawEntries = overrideEntries || getCurrentSetEntries(plan, wk, ex);
    const cleanedEntries: SetLogEntry[] = rawEntries.map((s, idx) => ({
      setNumber: idx + 1,
      weight: (s.weight || '').trim(),
      unit: s.unit || planUnit,
      reps: (s.reps || '').trim(),
    }));

    const prevLogged = plan.exerciseLogs?.[wKey]?.[ex.id];
    const prevNormalized = JSON.stringify(
      (prevLogged?.setEntries || []).map(s => ({
        w: (s.weight || '').trim(),
        u: s.unit || prevLogged?.unit || planUnit,
        r: (s.reps || '').trim(),
      }))
    );
    const nextNormalized = JSON.stringify(
      cleanedEntries.map(s => ({ w: s.weight, u: s.unit || planUnit, r: s.reps }))
    );

    if (prevNormalized === nextNormalized && prevLogged?.setEntries) {
      return;
    }

    const firstPopulated = cleanedEntries.find(s => s.weight || s.reps);
    const updatedWeekLogs: Record<string, ExerciseLogEntry> = {
      ...(plan.exerciseLogs?.[wKey] || {}),
      [ex.id]: {
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

    const nextPlan: WorkoutPlan = {
      ...plan,
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
    } catch (err) {
      console.warn('Failed to save exercise sets:', err);
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
      notes: ex.notes || '',
      videoUrl: ex.videoUrl || '',
      isSuperset: !!ex.isSuperset,
      supersetGroup: ex.supersetGroup || '',
    });
  };

  const saveEditExercise = async (plan: WorkoutPlan, ex: WorkoutExercise) => {
    if (!editDraft) return;
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
        })),
      ];
    } else if (currEntries.length > newTargetCount) {
      // Only shrink trailing empty sets so logged weights/reps are never lost
      const copy = [...currEntries];
      while (copy.length > newTargetCount) {
        const tail = copy[copy.length - 1];
        if (!tail.weight.trim() && !tail.reps.trim()) {
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
    const key = weekKey(weekIdx);
    const current = plan.progress?.[key] || [];
    const updated = current.includes(exerciseId)
      ? current.filter((id) => id !== exerciseId)
      : [...current, exerciseId];
    const next: WorkoutPlan = { ...plan, progress: { ...(plan.progress || {}), [key]: updated } };
    saveWorkoutPlanDoc(next).catch((err) => console.warn('Failed to save progress to Firestore:', err));
  };

  const confirmDeletePlan = async () => {
    if (!planToDelete) return;
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
    try {
      const filename = exportWorkoutPlanToPdf(plan, { ownerName: resolvedDisplayName });
      setExportNotice(`Exported ${filename}`);
      setTimeout(() => setExportNotice(prev => (prev === `Exported ${filename}` ? null : prev)), 3000);
    } catch (err) {
      console.warn('PDF export failed:', err);
    }
  };

  // Helper to get or build the writable UserAccount document for currentUser
  const getWritableAccount = (): UserAccount => {
    if (matchedAccount) return { ...matchedAccount };
    return {
      id: `user_${currentUser.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '_')}`,
      username: currentUser,
      displayName: resolvedDisplayName,
      role: 'user',
      gender: profileGender,
    };
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
      const nextAccount: UserAccount = {
        ...getWritableAccount(),
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

    const baseAccount = getWritableAccount();
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
      sendTelegramAlert(
        formatSecurityAlertTelegramMessage(currentUser, 'password_changed', `Password updated for member "${resolvedDisplayName}" (@${currentUser}).`),
        'security',
        { targetUsername: currentUser, adminSettings, userAccounts: [...userAccounts.filter(u => u.id !== updatedAccount.id), updatedAccount] }
      ).catch(() => {});
      setPasswordFeedback({ type: 'success', text: 'Password updated securely!' });
      setTimeout(() => setPasswordFeedback(null), 5000);
    } catch (err: any) {
      setPasswordFeedback({ type: 'error', text: `Failed to update password: ${err?.message || String(err)}` });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const activeTelegramConfig = useMemo(() => getTelegramConfig(adminSettings), [adminSettings]);

  const handleSaveMemberTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    setTelegramFeedback(null);
    const cleanHandle = tgUsernameInput.trim()
      ? (tgUsernameInput.trim().startsWith('@') ? tgUsernameInput.trim().toLowerCase() : `@${tgUsernameInput.trim().toLowerCase()}`)
      : '';
    const cleanChatId = tgChatIdInput.trim();

    setIsSavingTelegram(true);
    try {
      const nextAccount: UserAccount = {
        ...getWritableAccount(),
        telegramUsername: cleanHandle || undefined,
        telegramChatId: cleanChatId || undefined,
        telegramNotificationsEnabled: tgNotificationsEnabled,
      };
      await saveUserAccountDoc(nextAccount);
      setLocalAccountOverride(nextAccount);

      // Sync with global Telegram authorizedUsers registry when handle + chatId are available
      if (cleanHandle && activeTelegramConfig.botToken) {
        const addedTgCfg = addAuthorizedTelegramUser(activeTelegramConfig, {
          telegramUsername: cleanHandle,
          chatId: cleanChatId || undefined,
          appUsername: currentUser,
          role: 'partner',
          confirmed: !!cleanChatId,
        });
        const updatedTgCfg = {
          ...addedTgCfg,
          authorizedUsers: (addedTgCfg.authorizedUsers || []).map((u) =>
            u.telegramUsername.toLowerCase() === cleanHandle
              ? { ...u, isActive: tgNotificationsEnabled }
              : u
          ),
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
    setIsDetectingTelegram(true);
    try {
      const detailed = await fetchTelegramChatIdsDetailed(activeTelegramConfig.botToken);
      const candidates = [
        tgUsernameInput.trim().toLowerCase(),
        tgUsernameInput.trim().replace(/^@/, '').toLowerCase(),
        `@${currentUser.toLowerCase().trim()}`,
        currentUser.toLowerCase().trim(),
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
            s.username?.replace(/^@/, '').toLowerCase() === c ||
            s.firstName?.toLowerCase() === c
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
        `🏋️ <b>Iron House Profile Test</b>\n\n` +
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
    const nextAccount: UserAccount = {
      ...getWritableAccount(),
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
    const nextAccount: UserAccount = {
      ...getWritableAccount(),
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
      exercises: (plan.exercises || []).map((ex) => {
        const { setsDisplay, repsDisplay } = getExerciseTargetDisplay(ex);
        return {
          id: ex.id,
          day: ex.day || '',
          name: ex.name || '',
          sets: setsDisplay || '',
          reps: repsDisplay || '',
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
      const bestWorkoutTab =
        workoutTabs.find(s => plan.sheetName && plan.sheetName.toLowerCase().includes(s.name.toLowerCase())) ||
        workoutTabs.find(s => s.name.trim().toLowerCase() === plan.title.trim().toLowerCase()) ||
        workoutTabs[0] ||
        detected.find(s => s.exercises.length > 0);

      if (!bestWorkoutTab || bestWorkoutTab.exercises.length === 0) {
        setWorksheetImportNotice('No exercise rows found in the uploaded file.');
        return;
      }

      // If plan only targets a specific day extracted in sheetName (e.g. "Workouts · Day 1"), filter if possible
      let importedExercises = bestWorkoutTab.exercises;
      if (bestWorkoutTab.detectedDays.length > 1) {
        const matchingDay = bestWorkoutTab.detectedDays.find(
          d =>
            d.trim().toLowerCase() === plan.title.trim().toLowerCase() ||
            (plan.sheetName && plan.sheetName.toLowerCase().includes(d.toLowerCase()))
        );
        if (matchingDay) {
          const dayFiltered = importedExercises.filter(ex => !ex.day || ex.day === matchingDay);
          if (dayFiltered.length > 0) importedExercises = dayFiltered;
        }
      }

      // Preview matched existing IDs right inside the draft
      const usedExistingIds = new Set<string>();
      const mappedExercises = importedExercises.map((row) => {
        const normName = (row.name || '').trim().toLowerCase();
        const normDay = (row.day || '').trim().toLowerCase();
        const matched =
          (normName && normDay
            ? plan.exercises.find(
                e =>
                  !usedExistingIds.has(e.id) &&
                  e.name.trim().toLowerCase() === normName &&
                  (e.day || '').trim().toLowerCase() === normDay
              )
            : undefined) ||
          (normName
            ? plan.exercises.find(e => !usedExistingIds.has(e.id) && e.name.trim().toLowerCase() === normName)
            : undefined);

        if (matched) usedExistingIds.add(matched.id);

        return {
          ...(matched ? { id: matched.id } : {}),
          day: row.day || '',
          name: row.name || '',
          sets: row.sets || '',
          reps: row.reps || '',
          notes: row.notes || '',
          videoUrl: row.video || '',
          isSuperset: !!row.isSuperset,
          supersetGroup: row.supersetGroup || '',
          ...(row.loggedWeight ? { loggedWeight: row.loggedWeight } : {}),
          ...(row.loggedUnit ? { loggedUnit: row.loggedUnit } : {}),
          ...(row.loggedReps ? { loggedReps: row.loggedReps } : {}),
          ...(row.weeklyLogs ? { weeklyLogs: row.weeklyLogs } : {}),
          ...(row.completed ? { completed: row.completed } : {}),
        };
      });

      const infoText = detected
        .filter(s => s.suggestedRole === 'instructions' && s.textContent.trim() !== '')
        .map(s => s.textContent.trim())
        .join('\n\n');

      const prefilledCount = mappedExercises.filter(
        m => m.weeklyLogs || m.loggedWeight || m.loggedReps || m.completed
      ).length;

      setWorksheetDraft((prev) =>
        prev
          ? {
              ...prev,
              weeks: Math.max(prev.weeks, bestWorkoutTab.detectedDataWeeks || 0),
              defaultWeightUnit: bestWorkoutTab.detectedWeightUnit || prev.defaultWeightUnit,
              sourceFileName: file.name,
              instructions: infoText || prev.instructions,
              exercises: mappedExercises,
            }
          : prev
      );
      setWorksheetImportNotice(
        `Loaded ${mappedExercises.length} exercises from "${file.name}" (${usedExistingIds.size} matched to keep saved data${prefilledCount > 0 ? `, ${prefilledCount} rows with sheet data ready to fill empty slots` : ''}). Click Save Worksheet to apply.`
      );
    } catch (err: any) {
      setWorksheetImportNotice(`Failed to read file: ${err?.message || String(err)}`);
    } finally {
      if (worksheetFileInputRef.current) worksheetFileInputRef.current.value = '';
    }
  };

  const saveModifiedWorksheet = async (plan: WorkoutPlan) => {
    if (!worksheetDraft) return;
    setIsSavingWorksheet(true);
    try {
      const merged = mergeUpdatedWorksheetIntoPlan(plan, {
        title: worksheetDraft.title,
        description: worksheetDraft.description,
        instructions: worksheetDraft.instructions,
        weeks: worksheetDraft.weeks,
        defaultWeightUnit: worksheetDraft.defaultWeightUnit,
        sourceFileName: worksheetDraft.sourceFileName,
        exercises: worksheetDraft.exercises.map(row => {
          const split = splitSetsAndReps(row.sets);
          return {
            id: row.id,
            day: row.day,
            name: row.name,
            sets: split ? split.sets : row.sets,
            reps: row.reps.trim() || (split ? split.reps : ''),
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

  const renderWorkoutsWorkspace = (showEmptyState = true) => {
    if (myPlans.length === 0) {
      if (!showEmptyState) return null;
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">My Workouts (0)</h2>
            <button
              onClick={() => setActiveTab('upload')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" /> Upload
            </button>
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
              <button
                onClick={() => setActiveTab('upload')}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" /> Upload
              </button>
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

  <button
    type="button"
    onClick={() => handleExportPlanPdf(plan)}
    aria-label="Export PDF"
    className="h-9 w-9 sm:w-auto sm:px-3 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold border bg-red-600/20 hover:bg-red-600/35 text-red-200 border-red-500/35 cursor-pointer"
  >
    <Download className="w-3.5 h-3.5 text-red-400" />
    <span className="hidden sm:inline">Export</span>
  </button>

  <button
    type="button"
    onClick={() => setPlanToDelete(plan)}
    aria-label="Delete plan"
    className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-xl border border-white/10 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
  >
    <Trash2 className="w-4 h-4" />
  </button>
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

        {/* FULL WORKSHEET MODIFIER PANEL (PRESERVES SAVED DATA) */}
        {worksheetEditPlanId === plan.id && worksheetDraft && (
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
              <div className="text-xs text-sky-200 bg-sky-950/40 border border-sky-500/30 rounded-xl px-3 py-2">
                {worksheetImportNotice}
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
              <table className="w-full text-left border-collapse min-w-[820px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-900/80">
                    <th className="px-2 py-2 w-32">Day</th>
                    <th className="px-2 py-2 w-20">Type</th>
                    <th className="px-2 py-2">Exercise Name</th>
                    <th className="px-2 py-2 w-24">Sets</th>
                    <th className="px-2 py-2 w-24">Reps</th>
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

            const cardClasses = checked
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
                      className={`mt-0.5 shrink-0 hover:scale-110 transition-transform cursor-pointer ${
                        isSuperset ? 'text-fuchsia-400' : 'text-red-500'
                      }`}
                      title={checked ? 'Mark as not done' : 'Mark as done'}
                    >
                      {checked ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6 text-neutral-600" />}
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
                        {videoInfo && (
                          <button
                            type="button"
                            onClick={() => setInlineVideoExId(prev => (prev === ex.id ? null : ex.id))}
                            className="sm:hidden text-[11px] font-bold text-red-200 bg-red-600/25 border border-red-500/40 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 cursor-pointer"
                          >
                            {inlineVideoExId === ex.id ? <X className="w-3 h-3" /> : <Play className="w-3 h-3 fill-current" />} Demo
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => (isEditingThis ? setEditingExerciseId(null) : startEditExercise(ex))}
                          className="text-[10px] font-semibold text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-2 py-0.5 inline-flex items-center gap-1 cursor-pointer"
                          title="Freely modify target sets, reps, superset or notes"
                        >
                          <Pencil className="w-3 h-3" /> {isEditingThis ? 'Close' : 'Edit'}
                        </button>
                        {isSavedRecently && (
                          <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                            <Check className="w-3 h-3" /> Saved
                          </span>
                        )}
                      </div>

                      {ex.notes && !isEditingThis && (
                        <p className="text-[12px] text-neutral-400 leading-relaxed">{ex.notes}</p>
                      )}

                      {/* FREE INLINE EXERCISE MODIFIER */}
                      {isEditingThis && editDraft && (
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

                      {/* PREVIOUS SESSION REFERENCE (READ-ONLY) */}
                      {prevWeekData && (
                        <div className="-ml-9 sm:ml-0 flex flex-wrap items-center gap-2 bg-indigo-500/10 border border-indigo-500/25 rounded-xl px-3 py-1.5 text-[11px]">
                          <span className="inline-flex items-center gap-1 text-indigo-300 font-semibold">
                            <History className="w-3.5 h-3.5 text-indigo-400" />
                            Previous ({prevWeekData.sourceLabel}):
                          </span>
                          <span className="font-mono text-neutral-200 flex flex-wrap gap-2">
                            {prevWeekData.setEntries
                              .filter(s => s.weight || s.reps)
                              .map(s => (
                                <span key={s.setNumber} className="bg-black/30 px-1.5 py-0.5 rounded">
                                  S{s.setNumber}: {s.weight ? `${s.weight} ${s.unit || planUnit}` : '—'} × {s.reps || '—'}
                                </span>
                              ))}
                          </span>
                        </div>
                      )}

                      {/* SETS TABLE */}
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

                        {/* column labels, phones only */}
                        <div className="grid grid-cols-[34px_minmax(0,1.4fr)_minmax(0,1fr)] gap-2 sm:hidden text-[9px] uppercase tracking-wider text-neutral-500 font-mono px-0.5">
                          <span className="text-center">Set</span><span>Weight</span><span>Reps</span>
                        </div>

                        <div className="space-y-1.5">
                          {setEntries.map((setRow, sIdx) => {
                            const prevForThisSet = prevWeekData?.setEntries[sIdx];
                            const setUnit: WeightUnit = setRow.unit || planUnit;
                            return (
                              <div
                                key={sIdx}
                                className="grid grid-cols-[34px_minmax(0,1.4fr)_minmax(0,1fr)] sm:grid-cols-[68px_170px_135px_auto] items-center gap-2"
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
                                    placeholder={prevForThisSet?.weight || '0'}
                                    aria-label={`Set ${sIdx + 1} Weight (${setUnit})`}
                                    className="w-full min-w-0 h-11 sm:h-auto bg-neutral-900 border border-white/15 focus:border-red-500/70 rounded-lg pl-3 pr-12 sm:pl-8 sm:pr-11 sm:py-1.5 text-base sm:text-xs text-white font-mono outline-none"
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
                                  <span className="hidden sm:block absolute left-2.5 text-[9px] uppercase font-mono text-neutral-500 pointer-events-none">Reps</span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={setRow.reps}
                                    onChange={(e) => updateSetField(plan, selectedWeek, ex, sIdx, 'reps', e.target.value)}
                                    onBlur={() => saveExerciseSets(plan, selectedWeek, ex)}
                                    placeholder={prevForThisSet?.reps || '0'}
                                    aria-label={`Set ${sIdx + 1} Reps`}
                                    className="w-full min-w-0 h-11 sm:h-auto bg-neutral-900 border border-white/15 focus:border-red-500/70 rounded-lg px-3 sm:pl-10 sm:pr-2.5 sm:py-1.5 text-base sm:text-xs text-white font-mono outline-none"
                                  />
                                </label>

                                {prevForThisSet && (prevForThisSet.weight || prevForThisSet.reps) && (
                                  <span className="hidden sm:inline text-[10px] font-mono text-indigo-300/80 truncate">
                                    Prev: {prevForThisSet.weight ? `${prevForThisSet.weight} ${prevForThisSet.unit || planUnit}` : '—'} × {prevForThisSet.reps || '—'}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* WEEKLY HISTORY */}
                      {weeklyHistory.length > 0 && (
                        <div className="-ml-9 sm:ml-0 rounded-xl border border-indigo-500/20 bg-indigo-950/15 p-3 space-y-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-300">
                            <History className="w-3.5 h-3.5 text-indigo-400" />
                            <span>History by Weeks</span>
                          </div>
                          <div className="space-y-1.5">
                            {weeklyHistory.map((rec, rIdx) => (
                              <div
                                key={`${rec.weekLabel}-${rIdx}`}
                                className="flex flex-wrap items-center gap-2 text-[11px] bg-black/30 border border-white/5 rounded-lg px-2.5 py-1.5"
                              >
                                <span className="font-bold text-indigo-200 min-w-[68px]">{rec.weekLabel}</span>
                                <div className="flex flex-wrap gap-1.5 flex-1">
                                  {rec.setEntries.map((s) => (
                                    <span
                                      key={s.setNumber}
                                      className="font-mono text-[10px] px-2 py-0.5 rounded bg-neutral-900 border border-white/10 text-neutral-200"
                                    >
                                      <span className="text-red-300 font-semibold">S{s.setNumber}:</span>{' '}
                                      {s.weight ? `${s.weight} ${s.unit || planUnit}` : '—'} × {s.reps || '—'}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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
        </div>
      </div>
    );
  };

  const renderDashboard = () => (
    <div className="space-y-5">
      <div className="rounded-2xl border border-red-500/20 bg-gradient-to-r from-red-950/50 via-neutral-900 to-neutral-900 p-5 sm:p-6 relative overflow-hidden">
        <div className="absolute -right-8 -top-8 w-40 h-40 bg-red-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
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
                  <span className="text-[11px] font-mono text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded-lg px-2.5 py-1 inline-flex items-center gap-1">
                    <Check className="w-3 h-3" /> {exportNotice}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleExportPlanPdf(activePlan)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white text-xs font-bold shadow-lg shadow-red-950/50 transition-all cursor-pointer"
                  title={`Export ${activePlan.title} PDF summary with progress & weekly history`}
                >
                  <Download className="w-3.5 h-3.5" /> Export PDF
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ACTIVE WORKOUT DIRECTLY IN DASHBOARD FOR EASY TRAINING */}
      {myPlans.length === 0 ? (
        <EmptyPlans onUpload={() => setActiveTab('upload')} />
      ) : (
        renderWorkoutsWorkspace(false)
      )}
    </div>
  );

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
              {activePlan && (
                <button
                  type="button"
                  onClick={() => handleExportPlanPdf(activePlan)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-red-400" /> Export Active PDF
                </button>
              )}
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
                isBotTokenReady
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-neutral-800 border-white/10 text-neutral-400'
              }`}>
                {isBotTokenReady ? 'Bot Online' : 'Bot Unconfigured'}
              </span>
            </div>

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
        </div>
      </div>
    );
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-black text-white overflow-hidden selection:bg-red-900 selection:text-red-100 font-sans">
      {/* Header */}
        <header className="border-b border-red-500/20 bg-black/90 backdrop-blur-xl sticky top-0 z-40 shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          <button onClick={() => setActiveTab('dashboard')} className="flex items-center gap-2.5 group cursor-pointer min-w-0">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-red-700 to-red-500 text-white shadow-lg shadow-red-950/50 shrink-0">
              <Dumbbell className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="flex flex-col leading-tight text-left">
              <span className="font-black text-sm sm:text-base tracking-tight text-white">IRON HOUSE</span>
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
        <main className="flex-1 overflow-y-auto overscroll-contain">
          <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-8">
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'workouts' && renderWorkoutsWorkspace(true)}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-black text-white">Upload your workout sheet</h2>
                <p className="text-[13px] text-neutral-400 mt-0.5">
                  Upload a multi-sheet Excel, CSV, or PDF file. Supports combined &ldquo;Sets × Reps&rdquo; (e.g. 4 × 5–12), Day headers, Supersets, and auto-fetched video URLs.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-neutral-900/40 p-4">
                <SheetUploader
                  mode="user"
                  currentUser={currentUser}
                  existingPlans={myPlans}
                  onSaved={(_, firstPlanId) => {
                    if (firstPlanId) openPlan(firstPlanId);
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
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-black/90 backdrop-blur-xl border-t border-red-500/20 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 px-1">
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
