/**
 * Gym workout plan persistence.
 * Firestore is the single source of truth: all reads and writes go directly
 * to Firestore with no local cache.
 */

import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import { cleanUndefined } from './firebaseService';
import { WorkoutPlan, WorkoutExercise } from '../types';
import { ParsedExerciseRow } from './sheetParser';

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
  const stamped: WorkoutPlan = {
    ...plan,
    createdAt: plan.createdAt || now,
    updatedAt: now,
    weeks: Math.max(1, Number(plan.weeks) || 1),
    exercises: Array.isArray(plan.exercises) ? plan.exercises : [],
  };

  await setDoc(doc(db, 'workoutPlans', stamped.id), cleanUndefined(stamped));
}

export async function deleteWorkoutPlanDoc(id: string): Promise<void> {
  await deleteDoc(doc(db, 'workoutPlans', id));
}

export interface NewWorkoutPlanInput {
  ownerUsername: string;
  title: string;
  description?: string;
  weeks: number;
  exercises: ParsedExerciseRow[];
  sourceFileName?: string;
  createdBy: string;
  assignedByAdmin?: boolean;
}

export function buildWorkoutPlan(input: NewWorkoutPlanInput): WorkoutPlan {
  const exercises: WorkoutExercise[] = input.exercises
    .filter((e) => e.name || e.sets || e.reps || e.notes || e.video)
    .map((e) => ({
      id: newId('ex'),
      name: e.name || 'Exercise',
      sets: e.sets,
      reps: e.reps,
      notes: e.notes,
      videoUrl: e.video,
    }));

  return {
    id: newId('plan'),
    ownerUsername: input.ownerUsername.trim(),
    title: input.title.trim() || 'Workout Plan',
    description: input.description?.trim() || undefined,
    weeks: Math.max(1, Number(input.weeks) || 1),
    exercises,
    sourceFileName: input.sourceFileName,
    createdBy: input.createdBy,
    assignedByAdmin: !!input.assignedByAdmin,
    progress: {},
    createdAt: new Date().toISOString(),
  };
}
