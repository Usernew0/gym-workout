import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query,
  orderBy,
  limit,
  getDocs,
  getDocFromServer
} from 'firebase/firestore';
import { db, isFirestoreOnline } from './firebase';
import { 
  UserActivityLog, 
  AdminSetting, 
  UserAccount 
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
    await setDoc(doc(db, 'activityLogs', log.id), cleanUndefined(log));
  } catch (err) {
    console.warn("Firestore activityLog save error:", err);
  }
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
    if (msg.includes('offline') || msg.includes('reach') || msg.includes('respond')) {
      return {
        online: false,
        latencyMs,
        details: 'Server unreachable / Offline',
        error: msg
      };
    }
    // If it's a "doc does not exist" or permission/not found error, Firestore is connected!
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

export async function saveFirestoreUserAccountDoc(user: UserAccount) {
  try {
    await setDoc(doc(db, 'userAccounts', user.id), cleanUndefined(user));
  } catch (err) {
    console.warn("Firestore saveUserAccountDoc error:", err);
  }
}

export async function deleteFirestoreUserAccountDoc(id: string) {
  try {
    await deleteDoc(doc(db, 'userAccounts', id));
  } catch (err) {
    console.warn("Firestore deleteUserAccountDoc error:", err);
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
    await setDoc(doc(db, 'adminSettings', setting.id), cleanUndefined(setting));
  } catch (err) {
    console.warn("Firestore saveAdminSettingDoc error:", err);
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
