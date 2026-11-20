/**
 * Gym workout plan persistence.
 * Firestore is the single source of truth: all reads and writes go directly
 * to Firestore with no local cache.
 */

import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import { sanitizeForFirestore } from './firebaseService';
import {
  mapToDb,
  safeUpsert,
  ensureSupabaseConfigured,
  supabaseDelete,
} from './supabaseService';
import { WorkoutPlan, WorkoutExercise, ExerciseLogEntry, SetLogEntry, WeightUnit } from '../types';
import { ParsedExerciseRow, parseSetsCount } from './sheetParser';

export function newId(prefix = 'wp'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function subscribeToWorkoutPlans(callback: (plans: WorkoutPlan[]) => void): () => void {
  let unsubscribe = () => {};
  try {
    unsubscribe = onSnapshot(
      collection(db, 'workoutPlans'),
      (snapshot) => {
        const list: WorkoutPlan[] = [];
        snapshot.forEach((d) => list.push(d.data() as WorkoutPlan));
        callback(list);
      },
      (error) => {
        console.warn('Workout plans realtime sync unavailable:', error?.message || error);
      }
    );
  } catch (error: any) {
    console.warn('Workout plans subscription failed:', error?.message || error);
  }

  return () => unsubscribe();
}

export async function saveWorkoutPlanDoc(plan: WorkoutPlan): Promise<void> {
  const now = new Date().toISOString();
  const stamped: WorkoutPlan = sanitizeForFirestore({
    ...plan,
    createdAt: plan.createdAt || now,
    updatedAt: now,
    weeks: Math.max(1, Number(plan.weeks) || 1),
    exercises: Array.isArray(plan.exercises) ? plan.exercises : [],
  });

  await setDoc(doc(db, 'workoutPlans', stamped.id), stamped);

  try {
    if (await ensureSupabaseConfigured()) {
      await safeUpsert('workout_plans', mapToDb(stamped), 'id');
    }
  } catch (err) {
    console.warn('Optional Supabase workout_plans mirror warning:', err);
  }
}

export async function deleteWorkoutPlanDoc(id: string): Promise<void> {
  await deleteDoc(doc(db, 'workoutPlans', id));

  try {
    if (await ensureSupabaseConfigured()) {
      await supabaseDelete('workout_plans', 'id', id);
    }
  } catch (err) {
    console.warn('Optional Supabase workout_plans delete mirror warning:', err);
  }
}

export interface NewWorkoutPlanInput {
  ownerUsername: string;
  title: string;
  description?: string;
  instructions?: string;
  sheetName?: string;
  defaultWeightUnit?: WeightUnit;
  weeks: number;
  hasRpeColumn?: boolean;
  hasRirColumn?: boolean;
  exercises: ParsedExerciseRow[];
  importSheetData?: boolean; // Defaults to true: import pre-filled weights/reps/weeks/done if present
  sourceFileName?: string;
  createdBy: string;
  assignedByAdmin?: boolean;
}

function anyLogMapHasField(
  logsMap: { [weekKey: string]: { [exerciseId: string]: ExerciseLogEntry } } | undefined,
  field: 'rpe' | 'rir'
): boolean {
  if (!logsMap) return false;
  return Object.values(logsMap).some((weekMap) =>
    Object.values(weekMap || {}).some((entry) =>
      Boolean(entry?.setEntries?.some((s) => (s?.[field] || '').trim() !== ''))
    )
  );
}

function previousLogsHaveField(
  previousLogs: { [exerciseId: string]: ExerciseLogEntry } | undefined,
  field: 'rpe' | 'rir'
): boolean {
  if (!previousLogs) return false;
  return Object.values(previousLogs).some((entry) =>
    Boolean(entry?.setEntries?.some((s) => (s?.[field] || '').trim() !== ''))
  );
}

function warmupLogsHaveField(
  warmupLogs: WorkoutPlan['warmupLogs'],
  field: 'rpe' | 'rir'
): boolean {
  if (!warmupLogs) return false;
  return Object.values(warmupLogs).some((weekMap) =>
    Object.values(weekMap || {}).some((entry) =>
      Boolean(entry?.setEntries?.some((s) => (s?.[field] || '').trim() !== ''))
    )
  );
}

export function planHasRpeColumn(plan?: WorkoutPlan | null): boolean {
  if (!plan) return false;
  if (typeof plan.hasRpeColumn === 'boolean') {
    if (plan.hasRpeColumn) return true;
    // Even if sheet didn't originally declare RPE, show if user logged RPE values or exercise has targetRpe
    if ((plan.exercises || []).some((e) => Boolean(e.targetRpe?.trim()))) return true;
    if (anyLogMapHasField(plan.exerciseLogs, 'rpe') || previousLogsHaveField(plan.previousLogs, 'rpe') || warmupLogsHaveField(plan.warmupLogs, 'rpe')) {
      return true;
    }
    return false;
  }
  return (
    (plan.exercises || []).some((e) => Boolean(e.targetRpe?.trim())) ||
    anyLogMapHasField(plan.exerciseLogs, 'rpe') ||
    previousLogsHaveField(plan.previousLogs, 'rpe') ||
    warmupLogsHaveField(plan.warmupLogs, 'rpe')
  );
}

export function planHasRirColumn(plan?: WorkoutPlan | null): boolean {
  if (!plan) return false;
  if (typeof plan.hasRirColumn === 'boolean') {
    if (plan.hasRirColumn) return true;
    if ((plan.exercises || []).some((e) => Boolean(e.targetRir?.trim()))) return true;
    if (anyLogMapHasField(plan.exerciseLogs, 'rir') || previousLogsHaveField(plan.previousLogs, 'rir') || warmupLogsHaveField(plan.warmupLogs, 'rir')) {
      return true;
    }
    return false;
  }
  return (
    (plan.exercises || []).some((e) => Boolean(e.targetRir?.trim())) ||
    anyLogMapHasField(plan.exerciseLogs, 'rir') ||
    previousLogsHaveField(plan.previousLogs, 'rir') ||
    warmupLogsHaveField(plan.warmupLogs, 'rir')
  );
}

function buildEntryFromSheetEntries(
  rawEntries: Array<{ setNumber: number; weight: string; unit?: WeightUnit; reps: string; rpe?: string; rir?: string }>,
  targetSetCount: number,
  fallbackUnit: WeightUnit,
  nowIso: string,
  weekNote?: string
): ExerciseLogEntry {
  const count = Math.max(targetSetCount, rawEntries.length, 1);
  const setEntries: SetLogEntry[] = Array.from({ length: count }, (_, idx) => {
    const src = rawEntries[idx];
    return {
      setNumber: idx + 1,
      weight: (src?.weight || '').trim(),
      unit: src?.unit || fallbackUnit,
      reps: (src?.reps || '').trim(),
      ...(src?.rpe?.trim() ? { rpe: src.rpe.trim() } : {}),
      ...(src?.rir?.trim() ? { rir: src.rir.trim() } : {}),
    };
  });
  const firstPopulated = setEntries.find(s => s.weight || s.reps || s.rpe || s.rir);
  const cleanNote = (weekNote || '').trim();
  return {
    sets: String(setEntries.length),
    weight: firstPopulated?.weight || '',
    unit: firstPopulated?.unit || fallbackUnit,
    reps: firstPopulated?.reps || '',
    setEntries,
    ...(cleanNote ? { notes: cleanNote, noteEnabled: true } : {}),
    updatedAt: nowIso,
  };
}

function entryHasData(entry?: ExerciseLogEntry): boolean {
  if (!entry) return false;
  if (
    entry.setEntries?.some(
      s =>
        (s.weight || '').trim() !== '' ||
        (s.reps || '').trim() !== '' ||
        (s.rpe || '').trim() !== '' ||
        (s.rir || '').trim() !== ''
    )
  ) {
    return true;
  }
  return Boolean(entry.weight?.trim() || entry.reps?.trim() || entry.notes?.trim());
}

function applyParsedSheetDataForExercise(
  exId: string,
  row: Partial<ParsedExerciseRow>,
  defaultUnit: WeightUnit,
  exerciseLogs: { [weekKey: string]: { [exerciseId: string]: ExerciseLogEntry } },
  previousLogs: { [exerciseId: string]: ExerciseLogEntry },
  progress: { [weekKey: string]: string[] },
  nowIso: string,
  overwriteExisting: boolean
): number {
  let highestWeek = 0;
  const targetCount = parseSetsCount(row.sets);
  const rowUnit: WeightUnit = row.loggedUnit || defaultUnit;

  if (row.weeklyLogs) {
    for (const [k, weekData] of Object.entries(row.weeklyLogs)) {
      const wk = Number(k);
      const wkUnit: WeightUnit = weekData.unit || rowUnit;
      const populated = (weekData.entries || []).filter(
        e => e.weight.trim() !== '' || e.reps.trim() !== '' || (e.rpe || '').trim() !== '' || (e.rir || '').trim() !== ''
      );
      const hasWeekNote = Boolean(weekData.weekNote?.trim());

      if (wk === 0) {
        if ((populated.length > 0 || hasWeekNote) && (overwriteExisting || !entryHasData(previousLogs[exId]))) {
          previousLogs[exId] = buildEntryFromSheetEntries(weekData.entries, targetCount, wkUnit, nowIso, weekData.weekNote);
        }
        continue;
      }

      if (wk >= 1 && wk <= 52) {
        highestWeek = Math.max(highestWeek, wk);
        const wKey = `w${wk}`;
        if (!exerciseLogs[wKey]) exerciseLogs[wKey] = {};
        if ((populated.length > 0 || hasWeekNote) && (overwriteExisting || !entryHasData(exerciseLogs[wKey][exId]))) {
          exerciseLogs[wKey][exId] = buildEntryFromSheetEntries(weekData.entries, targetCount, wkUnit, nowIso, weekData.weekNote);
        }
        if (weekData.completed) {
          const list = progress[wKey] || [];
          if (!list.includes(exId)) progress[wKey] = [...list, exId];
        }
      }
    }
  } else if (row.loggedWeight?.trim() || row.loggedReps?.trim()) {
    highestWeek = Math.max(highestWeek, 1);
    const wKey = 'w1';
    if (!exerciseLogs[wKey]) exerciseLogs[wKey] = {};
    if (overwriteExisting || !entryHasData(exerciseLogs[wKey][exId])) {
      const synth = Array.from({ length: targetCount }, (_, idx) => ({
        setNumber: idx + 1,
        weight: (row.loggedWeight || '').trim(),
        unit: rowUnit,
        reps: (row.loggedReps || '').trim(),
      }));
      exerciseLogs[wKey][exId] = buildEntryFromSheetEntries(synth, targetCount, rowUnit, nowIso);
    }
  }

  if (row.completed) {
    highestWeek = Math.max(highestWeek, 1);
    const list = progress.w1 || [];
    if (!list.includes(exId)) progress.w1 = [...list, exId];
  }

  return highestWeek;
}

export function buildWorkoutPlan(input: NewWorkoutPlanInput): WorkoutPlan {
  const now = new Date().toISOString();
  const defaultUnit: WeightUnit = input.defaultWeightUnit || 'kg';
  const shouldImportData = input.importSheetData !== false;

  const progress: { [weekKey: string]: string[] } = {};
  const exerciseLogs: { [weekKey: string]: { [exerciseId: string]: ExerciseLogEntry } } = {};
  const previousLogs: { [exerciseId: string]: ExerciseLogEntry } = {};
  let maxSheetWeek = 1;

  const exercises: WorkoutExercise[] = input.exercises
    .filter((e) => e.name || e.sets || e.reps || e.rpe || e.rir || e.notes || e.video || e.loggedWeight || e.weeklyLogs)
    .map((e) => {
      const id = newId('ex');
      if (shouldImportData) {
        const wk = applyParsedSheetDataForExercise(
          id,
          e,
          defaultUnit,
          exerciseLogs,
          previousLogs,
          progress,
          now,
          true
        );
        if (wk > maxSheetWeek) maxSheetWeek = wk;
      }

      const resolvedTargetRpe = (e.rpe || '').trim();
      const resolvedTargetRir = (e.rir || '').trim();
      return {
        id,
        name: e.name || 'Exercise',
        ...(e.day?.trim() ? { day: e.day.trim() } : {}),
        sets: e.sets,
        reps: e.reps,
        ...(resolvedTargetRpe ? { targetRpe: resolvedTargetRpe } : {}),
        ...(resolvedTargetRir ? { targetRir: resolvedTargetRir } : {}),
        notes: e.notes,
        videoUrl: e.video,
        ...(e.isSuperset ? { isSuperset: true } : {}),
        ...(e.supersetGroup?.trim() ? { supersetGroup: e.supersetGroup.trim() } : {}),
      };
    });

  const hasRpeColumn = Boolean(
    input.hasRpeColumn ||
      exercises.some(ex => Boolean(ex.targetRpe)) ||
      anyLogMapHasField(exerciseLogs, 'rpe') ||
      previousLogsHaveField(previousLogs, 'rpe')
  );
  const hasRirColumn = Boolean(
    input.hasRirColumn ||
      exercises.some(ex => Boolean(ex.targetRir)) ||
      anyLogMapHasField(exerciseLogs, 'rir') ||
      previousLogsHaveField(previousLogs, 'rir')
  );

  return {
    id: newId('plan'),
    ownerUsername: input.ownerUsername.trim(),
    title: input.title.trim() || 'Workout Plan',
    description: input.description?.trim() || undefined,
    instructions: input.instructions?.trim() || undefined,
    sheetName: input.sheetName?.trim() || undefined,
    defaultWeightUnit: defaultUnit,
    weeks: Math.max(1, Number(input.weeks) || 1, maxSheetWeek),
    hasRpeColumn,
    hasRirColumn,
    exercises,
    sourceFileName: input.sourceFileName,
    createdBy: input.createdBy,
    assignedByAdmin: !!input.assignedByAdmin,
    progress,
    exerciseLogs,
    previousLogs,
    createdAt: now,
  };
}

export interface MergeWorksheetUpdatesInput {
  title?: string;
  description?: string;
  instructions?: string;
  sheetName?: string;
  defaultWeightUnit?: WeightUnit;
  weeks?: number;
  hasRpeColumn?: boolean;
  hasRirColumn?: boolean;
  sourceFileName?: string;
  importSheetData?: boolean; // Defaults to true: fills missing week/exercise logs from sheet without overwriting saved logs
  exercises: Array<
    Partial<WorkoutExercise> &
      Partial<ParsedExerciseRow> & {
        name: string;
        video?: string;
      }
  >;
}

/**
 * Merge modified worksheet rows or edited plan data into an existing WorkoutPlan
 * WITHOUT losing saved exerciseLogs (per-week weights/reps), previousLogs, or progress.
 * If the incoming sheet also brings pre-filled weights/reps/weeks for empty/new slots, imports them cleanly.
 */
export function mergeUpdatedWorksheetIntoPlan(
  existing: WorkoutPlan,
  updates: MergeWorksheetUpdatesInput
): WorkoutPlan {
  const now = new Date().toISOString();
  const usedIds = new Set<string>();
  const defaultUnit: WeightUnit = updates.defaultWeightUnit || existing.defaultWeightUnit || 'kg';
  const shouldImportSheetData = updates.importSheetData !== false;

  const nextExerciseLogs: { [weekKey: string]: { [exerciseId: string]: ExerciseLogEntry } } = {};
  Object.entries(existing.exerciseLogs || {}).forEach(([wk, map]) => {
    nextExerciseLogs[wk] = { ...map };
  });
  const nextPreviousLogs: { [exerciseId: string]: ExerciseLogEntry } = { ...(existing.previousLogs || {}) };
  const nextProgress: { [weekKey: string]: string[] } = {};
  Object.entries(existing.progress || {}).forEach(([wk, ids]) => {
    nextProgress[wk] = [...ids];
  });

  let maxSheetWeek = 1;

  const mergedExercises: WorkoutExercise[] = updates.exercises
    .filter((e) => e.name || e.sets || e.reps || e.targetRpe || e.rpe || e.targetRir || e.rir || e.notes || e.videoUrl || e.video || e.loggedWeight || e.weeklyLogs)
    .map((e) => {
      const normName = (e.name || '').trim().toLowerCase();
      const normDay = (e.day || '').trim().toLowerCase();

      let matchedExisting: WorkoutExercise | undefined;

      // 1. Direct ID match
      if (e.id && !usedIds.has(e.id)) {
        matchedExisting = existing.exercises.find((ex) => ex.id === e.id);
      }

      // 2. Match by normalized name + same day header
      if (!matchedExisting && normName && normDay) {
        matchedExisting = existing.exercises.find(
          (ex) =>
            !usedIds.has(ex.id) &&
            (ex.name || '').trim().toLowerCase() === normName &&
            (ex.day || '').trim().toLowerCase() === normDay
        );
      }

      // 3. Match by normalized name alone
      if (!matchedExisting && normName) {
        matchedExisting = existing.exercises.find(
          (ex) => !usedIds.has(ex.id) && (ex.name || '').trim().toLowerCase() === normName
        );
      }

      const resolvedId = matchedExisting ? matchedExisting.id : (e.id || newId('ex'));
      usedIds.add(resolvedId);

      if (shouldImportSheetData) {
        const wk = applyParsedSheetDataForExercise(
          resolvedId,
          e,
          defaultUnit,
          nextExerciseLogs,
          nextPreviousLogs,
          nextProgress,
          now,
          false // NEVER overwrite already-saved app logs!
        );
        if (wk > maxSheetWeek) maxSheetWeek = wk;
      }

      const resolvedVideo = (e.videoUrl ?? e.video ?? '').trim();
      const resolvedTargetRpe = (e.targetRpe ?? e.rpe ?? '').trim();
      const resolvedTargetRir = (e.targetRir ?? e.rir ?? '').trim();

      return {
        id: resolvedId,
        name: (e.name || 'Exercise').trim(),
        ...(e.day?.trim() ? { day: e.day.trim() } : {}),
        ...(e.sets?.trim() ? { sets: e.sets.trim() } : {}),
        ...(e.reps?.trim() ? { reps: e.reps.trim() } : {}),
        ...(resolvedTargetRpe ? { targetRpe: resolvedTargetRpe } : {}),
        ...(resolvedTargetRir ? { targetRir: resolvedTargetRir } : {}),
        ...(e.notes?.trim() ? { notes: e.notes.trim() } : {}),
        ...(resolvedVideo ? { videoUrl: resolvedVideo } : {}),
        ...(e.isSuperset ? { isSuperset: true } : {}),
        ...(e.isSuperset && e.supersetGroup?.trim() ? { supersetGroup: e.supersetGroup.trim() } : {}),
      };
    });

  const resolvedHasRpeColumn =
    typeof updates.hasRpeColumn === 'boolean'
      ? Boolean(
          updates.hasRpeColumn ||
            mergedExercises.some(ex => Boolean(ex.targetRpe)) ||
            anyLogMapHasField(nextExerciseLogs, 'rpe') ||
            previousLogsHaveField(nextPreviousLogs, 'rpe')
        )
      : Boolean(
          existing.hasRpeColumn ||
            mergedExercises.some(ex => Boolean(ex.targetRpe)) ||
            anyLogMapHasField(nextExerciseLogs, 'rpe') ||
            previousLogsHaveField(nextPreviousLogs, 'rpe')
        );

  const resolvedHasRirColumn =
    typeof updates.hasRirColumn === 'boolean'
      ? Boolean(
          updates.hasRirColumn ||
            mergedExercises.some(ex => Boolean(ex.targetRir)) ||
            anyLogMapHasField(nextExerciseLogs, 'rir') ||
            previousLogsHaveField(nextPreviousLogs, 'rir')
        )
      : Boolean(
          existing.hasRirColumn ||
            mergedExercises.some(ex => Boolean(ex.targetRir)) ||
            anyLogMapHasField(nextExerciseLogs, 'rir') ||
            previousLogsHaveField(nextPreviousLogs, 'rir')
        );

  return {
    ...existing,
    title: updates.title !== undefined ? (updates.title.trim() || existing.title) : existing.title,
    description: updates.description !== undefined ? (updates.description.trim() || undefined) : existing.description,
    instructions: updates.instructions !== undefined ? (updates.instructions.trim() || undefined) : existing.instructions,
    sheetName: updates.sheetName !== undefined ? (updates.sheetName.trim() || existing.sheetName) : existing.sheetName,
    defaultWeightUnit: defaultUnit,
    weeks: Math.max(
      1,
      updates.weeks !== undefined ? (Number(updates.weeks) || 1) : existing.weeks,
      maxSheetWeek
    ),
    hasRpeColumn: resolvedHasRpeColumn,
    hasRirColumn: resolvedHasRirColumn,
    sourceFileName: updates.sourceFileName || existing.sourceFileName,
    exercises: mergedExercises,
    // Strictly preserve all saved workout data, warmups, & history + merge new prefilled slots
    warmupExercises: existing.warmupExercises || [],
    warmupLogs: existing.warmupLogs || {},
    progress: nextProgress,
    exerciseLogs: nextExerciseLogs,
    previousLogs: nextPreviousLogs,
    createdAt: existing.createdAt,
  };
}
