/**
 * Gym workout plan persistence.
 * Firestore is the single source of truth: all reads and writes go directly
 * to Firestore with no local cache.
 */

import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import { sanitizeForFirestore } from './firebaseService';
import { supabase, isSupabaseConfigured } from './supabase';
import { mapToDb, safeUpsert } from './supabaseService';
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

  if (isSupabaseConfigured && supabase) {
    try {
      await safeUpsert('workout_plans', mapToDb(stamped), 'id');
    } catch (err) {
      console.warn('Optional Supabase workout_plans mirror warning:', err);
    }
  }
}

export async function deleteWorkoutPlanDoc(id: string): Promise<void> {
  await deleteDoc(doc(db, 'workoutPlans', id));

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase.from('workout_plans').delete().eq('id', id);
    } catch (err) {
      console.warn('Optional Supabase workout_plans delete mirror warning:', err);
    }
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
  exercises: ParsedExerciseRow[];
  importSheetData?: boolean; // Defaults to true: import pre-filled weights/reps/weeks/done if present
  sourceFileName?: string;
  createdBy: string;
  assignedByAdmin?: boolean;
}

function buildEntryFromSheetEntries(
  rawEntries: Array<{ setNumber: number; weight: string; unit?: WeightUnit; reps: string }>,
  targetSetCount: number,
  fallbackUnit: WeightUnit,
  nowIso: string
): ExerciseLogEntry {
  const count = Math.max(targetSetCount, rawEntries.length, 1);
  const setEntries: SetLogEntry[] = Array.from({ length: count }, (_, idx) => {
    const src = rawEntries[idx];
    return {
      setNumber: idx + 1,
      weight: (src?.weight || '').trim(),
      unit: src?.unit || fallbackUnit,
      reps: (src?.reps || '').trim(),
    };
  });
  const firstPopulated = setEntries.find(s => s.weight || s.reps);
  return {
    sets: String(setEntries.length),
    weight: firstPopulated?.weight || '',
    unit: firstPopulated?.unit || fallbackUnit,
    reps: firstPopulated?.reps || '',
    setEntries,
    updatedAt: nowIso,
  };
}

function entryHasData(entry?: ExerciseLogEntry): boolean {
  if (!entry) return false;
  if (entry.setEntries?.some(s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '')) return true;
  return Boolean(entry.weight?.trim() || entry.reps?.trim());
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
      const populated = (weekData.entries || []).filter(e => e.weight.trim() !== '' || e.reps.trim() !== '');

      if (wk === 0) {
        if (populated.length > 0 && (overwriteExisting || !entryHasData(previousLogs[exId]))) {
          previousLogs[exId] = buildEntryFromSheetEntries(weekData.entries, targetCount, wkUnit, nowIso);
        }
        continue;
      }

      if (wk >= 1 && wk <= 52) {
        highestWeek = Math.max(highestWeek, wk);
        const wKey = `w${wk}`;
        if (!exerciseLogs[wKey]) exerciseLogs[wKey] = {};
        if (populated.length > 0 && (overwriteExisting || !entryHasData(exerciseLogs[wKey][exId]))) {
          exerciseLogs[wKey][exId] = buildEntryFromSheetEntries(weekData.entries, targetCount, wkUnit, nowIso);
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
    .filter((e) => e.name || e.sets || e.reps || e.notes || e.video || e.loggedWeight || e.weeklyLogs)
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

      return {
        id,
        name: e.name || 'Exercise',
        ...(e.day?.trim() ? { day: e.day.trim() } : {}),
        sets: e.sets,
        reps: e.reps,
        notes: e.notes,
        videoUrl: e.video,
        ...(e.isSuperset ? { isSuperset: true } : {}),
        ...(e.supersetGroup?.trim() ? { supersetGroup: e.supersetGroup.trim() } : {}),
      };
    });

  return {
    id: newId('plan'),
    ownerUsername: input.ownerUsername.trim(),
    title: input.title.trim() || 'Workout Plan',
    description: input.description?.trim() || undefined,
    instructions: input.instructions?.trim() || undefined,
    sheetName: input.sheetName?.trim() || undefined,
    defaultWeightUnit: defaultUnit,
    weeks: Math.max(1, Number(input.weeks) || 1, maxSheetWeek),
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
    .filter((e) => e.name || e.sets || e.reps || e.notes || e.videoUrl || e.video || e.loggedWeight || e.weeklyLogs)
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

      return {
        id: resolvedId,
        name: (e.name || 'Exercise').trim(),
        ...(e.day?.trim() ? { day: e.day.trim() } : {}),
        ...(e.sets?.trim() ? { sets: e.sets.trim() } : {}),
        ...(e.reps?.trim() ? { reps: e.reps.trim() } : {}),
        ...(e.notes?.trim() ? { notes: e.notes.trim() } : {}),
        ...(resolvedVideo ? { videoUrl: resolvedVideo } : {}),
        ...(e.isSuperset ? { isSuperset: true } : {}),
        ...(e.isSuperset && e.supersetGroup?.trim() ? { supersetGroup: e.supersetGroup.trim() } : {}),
      };
    });

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
    sourceFileName: updates.sourceFileName || existing.sourceFileName,
    exercises: mergedExercises,
    // Strictly preserve all saved workout data & history + merge new prefilled slots
    progress: nextProgress,
    exerciseLogs: nextExerciseLogs,
    previousLogs: nextPreviousLogs,
    createdAt: existing.createdAt,
  };
}
