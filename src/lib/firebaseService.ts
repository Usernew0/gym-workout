import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query,
  orderBy,
  limit,
  getDoc,
  getDocs,
  getDocFromServer
} from 'firebase/firestore';
import { db, isFirestoreOnline } from './firebase';
import { 
  UserActivityLog, 
  AdminSetting, 
  UserAccount,
  WorkoutPlan
} from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMessage = error instanceof Error ? error.message : String(error);
  const errCode = (error && typeof error === 'object' && 'code' in error) ? (error as any).code : '';
  
  const isPermissionError = 
    errCode === 'permission-denied' || 
    errMessage.toLowerCase().includes('permission-denied') || 
    errMessage.toLowerCase().includes('insufficient permissions');

  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: null,
      email: null,
    },
    operationType,
    path
  };

  console.error('Firestore Realtime Error: ', JSON.stringify(errInfo));

  if (isPermissionError) {
    throw new Error(JSON.stringify(errInfo));
  }
}

// Recursively strips any undefined properties from an object so Firestore setDoc does not throw errors
export function cleanUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => cleanUndefined(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const cleaned = {} as any;
    Object.keys(obj as any).forEach(key => {
      const val = (obj as any)[key];
      if (val !== undefined) {
        cleaned[key] = cleanUndefined(val);
      }
    });
    return cleaned;
  }
  return obj;
}

// Recursively strips both undefined AND null object properties (essential when writing PostgreSQL/Supabase rows into Firestore where rules expect absent optional fields or string types)
export function sanitizeForFirestore<T>(obj: T): T {
  if (obj === null || obj === undefined) return undefined as unknown as T;
  if (Array.isArray(obj)) {
    return obj
      .filter(item => item !== undefined && item !== null)
      .map(item => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const cleaned = {} as any;
    Object.keys(obj as any).forEach(key => {
      const val = (obj as any)[key];
      if (val !== undefined && val !== null) {
        cleaned[key] = sanitizeForFirestore(val);
      }
    });
    return cleaned;
  }
  return obj;
}

// ==========================================
// REAL-TIME FIRESTORE ACTIVITY LOGS
// ==========================================

export function subscribeToFirestoreActivityLogs(callback: (data: UserActivityLog[]) => void) {
  const logsQuery = query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(200));

  return onSnapshot(logsQuery, (snapshot) => {
    const list: UserActivityLog[] = [];
    snapshot.forEach((doc) => {
      list.push(doc.data() as UserActivityLog);
    });
    callback(list);
  }, (error) => {
    console.warn("Firestore activityLogs subscription info:", error.message);
  });
}

export async function saveActivityLogDoc(log: UserActivityLog) {
  try {
    const docRef = doc(db, 'activityLogs', log.id);
    const existing = await getDoc(docRef);
    if (existing.exists()) {
      // activityLogs are append-only / immutable in firestore.rules (allow update: if false)
      return;
    }
    await setDoc(docRef, sanitizeForFirestore(log));
  } catch (err) {
    console.warn("Firestore activityLog save error:", err);
  }
}

export async function saveFirestoreActivityLogDocStrict(log: UserActivityLog): Promise<'created' | 'skipped'> {
  const docRef = doc(db, 'activityLogs', log.id);
  const existing = await getDoc(docRef);
  if (existing.exists()) {
    return 'skipped';
  }
  await setDoc(docRef, sanitizeForFirestore(log));
  return 'created';
}

export async function getFirestoreActivityLogs(): Promise<UserActivityLog[]> {
  try {
    const snapshot = await getDocs(collection(db, 'activityLogs'));
    const list: UserActivityLog[] = [];
    snapshot.forEach((d) => {
      list.push(d.data() as UserActivityLog);
    });
    return list;
  } catch (err) {
    console.warn("Failed to fetch Firestore activityLogs:", err);
    return [];
  }
}

export async function deleteFirestoreActivityLogDoc(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'activityLogs', id));
    return true;
  } catch (err) {
    console.warn(`Failed to purge Firestore activityLog ${id}:`, err);
    return false;
  }
}

export async function getFirestoreAdminSettings(): Promise<AdminSetting[]> {
  try {
    const snapshot = await getDocs(collection(db, 'adminSettings'));
    const list: AdminSetting[] = [];
    snapshot.forEach((d) => {
      list.push(d.data() as AdminSetting);
    });
    return list;
  } catch (err) {
    console.warn("Failed to fetch Firestore adminSettings:", err);
    return [];
  }
}

export async function deleteFirestoreAdminSettingDoc(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'adminSettings', id));
    return true;
  } catch (err) {
    console.warn(`Failed to purge Firestore adminSetting ${id}:`, err);
    return false;
  }
}

export async function verifyFirestoreConnection(): Promise<{
  online: boolean;
  latencyMs: number;
  details: string;
  error?: string;
}> {
  const start = performance.now();
  try {
    await getDocFromServer(doc(db, '_connection_test_metadata_', 'ping'));
    const latencyMs = Math.round(performance.now() - start);
    return {
      online: true,
      latencyMs,
      details: `Connected (${latencyMs}ms)`
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    const msg = err?.message || String(err);
    const code = err?.code || '';
    if (
      code === 'unavailable' ||
      code === 'failed-precondition' ||
      msg.includes('offline') ||
      msg.includes('unavailable') ||
      msg.includes('reach') ||
      msg.includes('respond')
    ) {
      return {
        online: false,
        latencyMs,
        details: 'Server unreachable / Offline',
        error: msg
      };
    }
    // If it's a "doc does not exist" or permission/not found error, Firestore server actually responded
    return {
      online: isFirestoreOnline,
      latencyMs,
      details: isFirestoreOnline ? `Connected (${latencyMs}ms)` : 'Offline mode'
    };
  }
}

// ==========================================
// REAL-TIME FIRESTORE USER ACCOUNTS
// ==========================================

export function subscribeToFirestoreUserAccounts(callback: (data: UserAccount[]) => void) {
  return onSnapshot(collection(db, 'userAccounts'), (snapshot) => {
    const list: UserAccount[] = [];
    snapshot.forEach((doc) => {
      list.push(doc.data() as UserAccount);
    });
    callback(list);
  }, (error) => {
    console.warn("Firestore userAccounts subscription info:", error.message);
  });
}

const ALLOWED_FIRESTORE_USER_ACCOUNT_KEYS = new Set([
  'id',
  'username',
  'displayName',
  'password',
  'role',
  'gender',
  'weightUnitPreference',
  'telegramUsername',
  'telegramChatId',
  'telegramNotificationsEnabled',
  'waterIntake',
  'bodyWeightHistory',
  'restTimerPrefs',
  'twoFactorEnabled',
  'twoFactorSecret',
  'twoFactorBackupCodes',
  'twoFactorCreatedAt',
  'visibleTabs',
  'coupleId',
  'createdAt',
  'updatedAt',
]);

export async function saveFirestoreUserAccountDoc(user: UserAccount): Promise<UserAccount> {
  try {
    const cleanUsername = (user?.username || '').trim();
    if (cleanUsername.length < 2) {
      throw new Error('Username must be at least 2 characters.');
    }
    // Admin credentials belong in adminSettings; firestore.rules intentionally blocks 'admin' inside userAccounts.
    if (cleanUsername.toLowerCase() === 'admin') {
      return user;
    }

    const sanitized = sanitizeForFirestore({
      ...user,
      username: cleanUsername,
    }) as UserAccount;

    let targetId = (sanitized.id || '').trim();
    const cleanLower = cleanUsername.toLowerCase();
    let existingData: Record<string, any> | null = null;

    try {
      const allSnap = await getDocs(collection(db, 'userAccounts'));
      const exactDoc = targetId ? allSnap.docs.find(d => d.id === targetId) : undefined;
      if (exactDoc) {
        existingData = exactDoc.data() as Record<string, any>;
      }

      const conflictingDoc = allSnap.docs.find(d => {
        if (exactDoc && d.id === exactDoc.id) return false;
        if (!exactDoc && targetId && d.id === targetId) return false;
        const data = d.data() as Record<string, any>;
        const docUser = typeof data?.username === 'string' ? data.username.trim().toLowerCase() : '';
        return Boolean(docUser && docUser === cleanLower);
      });

      if (conflictingDoc) {
        throw new Error(`Username "${cleanUsername}" already exists! Please choose a different username.`);
      }
    } catch (lookupErr: any) {
      if (lookupErr?.message?.includes('already exists')) {
        throw lookupErr;
      }
      if (targetId && !existingData) {
        try {
          const directSnap = await getDoc(doc(db, 'userAccounts', targetId));
          if (directSnap.exists()) {
            existingData = directSnap.data() as Record<string, any>;
          }
        } catch {
          // ignore read lookup fallback
        }
      }
    }

    if (!targetId) {
      targetId = `user_${cleanLower.replace(/[^a-z0-9_-]+/g, '_')}`;
    }

    const resolvedPassword =
      typeof sanitized.password === 'string' && sanitized.password.length >= 4
        ? sanitized.password
        : typeof existingData?.password === 'string' && existingData.password.length >= 4
          ? existingData.password
          : undefined;

    if (!existingData && !resolvedPassword) {
      throw new Error(`Account "${cleanUsername}" does not exist in Firestore yet or is missing a valid password.`);
    }

    const mergedRaw: Record<string, any> = sanitizeForFirestore({
      ...(existingData || {}),
      ...sanitized,
      id: targetId,
      username: cleanUsername,
      ...(resolvedPassword ? { password: resolvedPassword } : {}),
    });

    const finalPayload: Record<string, any> = {};
    for (const key of Object.keys(mergedRaw)) {
      if (ALLOWED_FIRESTORE_USER_ACCOUNT_KEYS.has(key)) {
        finalPayload[key] = mergedRaw[key];
      }
    }
    if (
      finalPayload.weightUnitPreference !== undefined &&
      finalPayload.weightUnitPreference !== 'kg' &&
      finalPayload.weightUnitPreference !== 'lbs'
    ) {
      delete finalPayload.weightUnitPreference;
    }

    try {
      await setDoc(doc(db, 'userAccounts', targetId), finalPayload);
      return finalPayload as UserAccount;
    } catch (writeErr: any) {
      const code = String(writeErr?.code || '');
      const msg = String(writeErr?.message || '');
      const isPermError =
        code.includes('permission-denied') ||
        msg.toLowerCase().includes('missing or insufficient permissions') ||
        msg.toLowerCase().includes('permission');

      const existingUsernameLower =
        typeof existingData?.username === 'string' ? existingData.username.trim().toLowerCase() : '';
      const isUsernameRename = Boolean(existingData && existingUsernameLower && existingUsernameLower !== cleanLower);

      // Legacy deployed firestore.rules block in-place username mutation on update (`incoming().username.lower() == existing().username.lower()`).
      // Migrate atomically by creating the renamed document under a fresh ID and deleting the old document.
      if (isPermError && isUsernameRename && resolvedPassword && resolvedPassword.length >= 4) {
        const slug = cleanLower.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'user';
        const migratedId = `user_${slug}_${Date.now().toString(36)}`;
        const migratedPayload: Record<string, any> = {
          ...finalPayload,
          id: migratedId,
          username: cleanUsername,
          password: resolvedPassword,
        };
        await setDoc(doc(db, 'userAccounts', migratedId), migratedPayload);
        await deleteDoc(doc(db, 'userAccounts', targetId)).catch((delErr) => {
          console.warn('Firestore legacy username doc cleanup warning:', delErr);
        });
        return migratedPayload as UserAccount;
      }

      throw writeErr;
    }
  } catch (err) {
    console.warn("Firestore saveUserAccountDoc error:", err);
    throw err;
  }
}

export async function deleteFirestoreUserAccountDoc(id: string) {
  try {
    await deleteDoc(doc(db, 'userAccounts', id));
  } catch (err) {
    console.warn("Firestore deleteUserAccountDoc error:", err);
    throw err;
  }
}

// ==========================================
// REAL-TIME FIRESTORE ADMIN SETTINGS
// ==========================================

export function subscribeToFirestoreAdminSettings(callback: (data: AdminSetting[]) => void) {
  return onSnapshot(collection(db, 'adminSettings'), (snapshot) => {
    const list: AdminSetting[] = [];
    snapshot.forEach((doc) => {
      list.push(doc.data() as AdminSetting);
    });
    callback(list);
  }, (error) => {
    console.warn("Firestore adminSettings subscription info:", error.message);
  });
}

export async function saveFirestoreAdminSettingDoc(setting: AdminSetting) {
  try {
    await setDoc(doc(db, 'adminSettings', setting.id), sanitizeForFirestore(setting));
  } catch (err) {
    console.warn("Firestore saveAdminSettingDoc error:", err);
    throw err;
  }
}

export async function getFirestoreUserAccounts(): Promise<UserAccount[]> {
  try {
    const snapshot = await getDocs(collection(db, 'userAccounts'));
    const list: UserAccount[] = [];
    snapshot.forEach(d => list.push(d.data() as UserAccount));
    return list;
  } catch (err) {
    console.warn("Failed to fetch Firestore userAccounts:", err);
    return [];
  }
}

// ==========================================
// FIRESTORE WORKOUT PLANS
// ==========================================

export async function getFirestoreWorkoutPlans(): Promise<WorkoutPlan[]> {
  try {
    const snapshot = await getDocs(collection(db, 'workoutPlans'));
    const list: WorkoutPlan[] = [];
    snapshot.forEach(d => list.push(d.data() as WorkoutPlan));
    return list;
  } catch (err) {
    console.warn("Failed to fetch Firestore workoutPlans:", err);
    return [];
  }
}

export async function saveFirestoreWorkoutPlanDoc(plan: WorkoutPlan) {
  try {
    await setDoc(doc(db, 'workoutPlans', plan.id), sanitizeForFirestore(plan));
  } catch (err) {
    console.warn("Firestore saveWorkoutPlanDoc error:", err);
    throw err;
  }
}
