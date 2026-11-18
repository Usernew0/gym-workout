/**
 * Iron House - Hybrid Architecture Sync Service
 * Strategy A: Functional Data Partitioning
 *
 * - Structured App Data & Settings -> Supabase PostgreSQL (supabaseService.ts)
 * - Audit Logs & Settings Backups -> Firebase Firestore (firebaseService.ts)
 * - Media & Attachments -> Supabase Storage (storageService.ts)
 */

export * from './firebaseService';
export * from './supabaseService';
export * from './storageService';

import { useState, useEffect, useCallback } from 'react';
import {
  verifyFirestoreConnection,
  getFirestoreActivityLogs,
  deleteFirestoreActivityLogDoc,
  getFirestoreAdminSettings,
  deleteFirestoreAdminSettingDoc,
  getFirestoreUserAccounts,
  saveFirestoreUserAccountDoc,
  saveFirestoreAdminSettingDoc,
  saveFirestoreActivityLogDocStrict,
  getFirestoreWorkoutPlans,
  saveFirestoreWorkoutPlanDoc,
  sanitizeForFirestore
} from './firebaseService';
import {
  verifySupabaseConnection,
  saveAdminSettingDoc,
  checkSupabaseTablesStatus,
  TableDiagnosticStatus,
  mapToDb,
  mapFromDb,
  safeUpsert
} from './supabaseService';
import { isSupabaseConfigured, supabase } from './supabase';
import {
  UserAccount,
  AdminSetting,
  UserActivityLog,
  WorkoutPlan
} from '../types';

export interface DatabaseConnectionStatus {
  firebase: {
    online: boolean;
    latencyMs: number;
    details: string;
    error?: string;
  };
  supabase: {
    online: boolean;
    configured: boolean;
    latencyMs: number;
    details: string;
    error?: string;
  };
  lastChecked: string;
}

export async function checkDatabaseStatuses(): Promise<DatabaseConnectionStatus> {
  const [fb, sb] = await Promise.all([
    verifyFirestoreConnection(),
    verifySupabaseConnection()
  ]);

  return {
    firebase: fb,
    supabase: sb,
    lastChecked: new Date().toLocaleTimeString()
  };
}

export function useDatabaseStatus(intervalMs = 30000) {
  const [status, setStatus] = useState<DatabaseConnectionStatus>({
    firebase: { online: true, latencyMs: 0, details: 'Checking...' },
    supabase: { online: isSupabaseConfigured, configured: isSupabaseConfigured, latencyMs: 0, details: 'Checking...' },
    lastChecked: 'Initializing...'
  });
  const [isChecking, setIsChecking] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    setIsChecking(true);
    try {
      const res = await checkDatabaseStatuses();
      setStatus(res);
    } catch (err) {
      console.warn("Failed to check database connection status:", err);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, intervalMs);
    return () => clearInterval(interval);
  }, [refresh, intervalMs]);

  return { status, isChecking, refresh };
}

export function useSupabaseTableDiagnostics(autoCheckOnMount = true) {
  const [diagnostics, setDiagnostics] = useState<{
    configured: boolean;
    tables: TableDiagnosticStatus[];
    allCriticalTablesExist: boolean;
    checkedAt: string;
  } | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);

  const runDiagnostics = useCallback(async () => {
    setIsChecking(true);
    try {
      const res = await checkSupabaseTablesStatus();
      setDiagnostics(res);
    } catch (err) {
      console.warn("Table diagnostics check failed:", err);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    if (autoCheckOnMount) {
      runDiagnostics();
    }
  }, [autoCheckOnMount, runDiagnostics]);

  return { diagnostics, isChecking, runDiagnostics };
}

export interface MigrationResult {
  logsProcessed: number;
  logsMigrated: number;
  logsPurgedFromFirestore: number;
  settingsProcessed: number;
  settingsMigrated: number;
  settingsPurgedFromFirestore: number;
  errors: string[];
  timestamp: string;
}

/**
 * Migration & Deduplication Routine:
 * Checks for duplicated logs or settings between Firestore and Supabase.
 * Ensures old Firestore data is safely migrated to Supabase tables and then purged from Firestore.
 */
export async function migrateAndDeduplicateFirestoreToSupabase(): Promise<MigrationResult> {
  const result: MigrationResult = {
    logsProcessed: 0,
    logsMigrated: 0,
    logsPurgedFromFirestore: 0,
    settingsProcessed: 0,
    settingsMigrated: 0,
    settingsPurgedFromFirestore: 0,
    errors: [],
    timestamp: new Date().toLocaleString()
  };

  try {
    // 1. Fetch old items from Firestore
    const [fsLogs, fsSettings] = await Promise.all([
      getFirestoreActivityLogs(),
      getFirestoreAdminSettings()
    ]);

    result.logsProcessed = fsLogs.length;
    result.settingsProcessed = fsSettings.length;

    // 2. Process Activity Logs Migration & Deduplication
    if (fsLogs.length > 0) {
      let existingSupabaseLogIds = new Set<string>();
      if (isSupabaseConfigured && supabase) {
        try {
          const { data, error } = await supabase.from('activity_logs').select('id');
          if (!error && data) {
            data.forEach((row: any) => existingSupabaseLogIds.add(row.id));
          }
        } catch (e: any) {
          result.errors.push(`Supabase fetch activity_logs check: ${e?.message || String(e)}`);
        }
      }

      for (const log of fsLogs) {
        let migratedSuccessfully = false;

        // If log is not yet in Supabase, insert it
        if (!existingSupabaseLogIds.has(log.id)) {
          if (isSupabaseConfigured && supabase) {
            try {
              const snakeLog = {
                id: log.id,
                username: log.username,
                action: log.action,
                details: log.details,
                timestamp: log.timestamp
              };
              const { error } = await supabase.from('activity_logs').insert(snakeLog);
              if (!error) {
                migratedSuccessfully = true;
                result.logsMigrated++;
              } else {
                result.errors.push(`Log ${log.id} insert info: ${error.message}`);
              }
            } catch (err: any) {
              result.errors.push(`Log ${log.id} exception: ${err?.message || String(err)}`);
            }
          } else {
            result.errors.push(`Log ${log.id}: Supabase is not configured; skipping migration.`);
          }
        } else {
          // Log was already present / duplicated in Supabase
          migratedSuccessfully = true;
        }

        // Purge old Firestore doc after verifying it is in Supabase / migrated
        if (migratedSuccessfully) {
          const purged = await deleteFirestoreActivityLogDoc(log.id);
          if (purged) {
            result.logsPurgedFromFirestore++;
          }
        }
      }
    }

    // 3. Process Admin Settings Synchronization (Keep credentials preserved in both Firestore & Supabase)
    if (fsSettings.length > 0) {
      for (const setting of fsSettings) {
        await saveAdminSettingDoc(setting);
        result.settingsMigrated++;
      }
    }
  } catch (globalErr: any) {
    result.errors.push(`Migration routine error: ${globalErr?.message || String(globalErr)}`);
  }

  return result;
}

// ==========================================
// SEPARATE TABLE-BY-TABLE BIDIRECTIONAL SYNC
// ==========================================

export type SyncTableKey =
  | 'user_accounts'
  | 'admin_settings'
  | 'workout_plans'
  | 'activity_logs';

export interface TableSyncMeta {
  key: SyncTableKey;
  label: string;
  supabaseTable: string;
  firestoreCollection: string;
  description: string;
}

export const SYNC_TABLES_LIST: TableSyncMeta[] = [
  { key: 'user_accounts', label: 'User Accounts', supabaseTable: 'user_accounts', firestoreCollection: 'userAccounts', description: 'Registered account credentials and profiles' },
  { key: 'admin_settings', label: 'Admin Settings', supabaseTable: 'admin_settings', firestoreCollection: 'adminSettings', description: 'Admin panel configs and access permissions' },
  { key: 'workout_plans', label: 'Workout Plans', supabaseTable: 'workout_plans', firestoreCollection: 'workoutPlans', description: 'Gym workout sheets, exercises, and progress tracking' },
  { key: 'activity_logs', label: 'Activity Logs', supabaseTable: 'activity_logs', firestoreCollection: 'activityLogs', description: 'System audit logs and user activity tracking' },
];

export interface TableSyncResult {
  tableKey: SyncTableKey;
  direction: 'firestore_to_supabase' | 'supabase_to_firestore';
  processedCount: number;
  syncedCount: number;
  errors: string[];
}

export async function syncSingleTableFirestoreToSupabase(tableKey: SyncTableKey): Promise<TableSyncResult> {
  const result: TableSyncResult = {
    tableKey,
    direction: 'firestore_to_supabase',
    processedCount: 0,
    syncedCount: 0,
    errors: []
  };

  if (!isSupabaseConfigured || !supabase) {
    result.errors.push('Supabase is not configured or offline.');
    return result;
  }

  try {
    switch (tableKey) {
      case 'user_accounts': {
        const fs = await getFirestoreUserAccounts();
        result.processedCount = fs.length;
        for (const u of fs) {
          const dbPayload = mapToDb(u);
          const res = await safeUpsert('user_accounts', dbPayload, 'id');
          if (res.success) {
            result.syncedCount++;
            await safeUpsert('profiles', { id: u.id, username: u.username, display_name: u.username }, 'id');
          } else {
            result.errors.push(`user_account (${u.id}): ${res.error}`);
          }
        }
        break;
      }
      case 'admin_settings': {
        const settings = await getFirestoreAdminSettings();
        result.processedCount = settings.length;
        for (const s of settings) {
          const dbPayload = mapToDb(s);
          const res = await safeUpsert('admin_settings', dbPayload, 'id');
          if (res.success) result.syncedCount++;
          else result.errors.push(`admin_setting (${s.id}): ${res.error}`);
        }
        break;
      }
      case 'workout_plans': {
        const plans = await getFirestoreWorkoutPlans();
        result.processedCount = plans.length;
        for (const p of plans) {
          const dbPayload = mapToDb(p);
          const res = await safeUpsert('workout_plans', dbPayload, 'id');
          if (res.success) result.syncedCount++;
          else result.errors.push(`workout_plan (${p.id}): ${res.error}`);
        }
        break;
      }
      case 'activity_logs': {
        const fs = await getFirestoreActivityLogs();
        result.processedCount = fs.length;
        for (const log of fs) {
          const dbPayload = mapToDb(log);
          const res = await safeUpsert('activity_logs', dbPayload, 'id');
          if (res.success) result.syncedCount++;
          else result.errors.push(`activity_log (${log.id}): ${res.error}`);
        }
        break;
      }
    }
  } catch (err: any) {
    result.errors.push(`Sync ${tableKey} error: ${err?.message || String(err)}`);
  }

  return result;
}

export async function syncSingleTableSupabaseToFirestore(tableKey: SyncTableKey): Promise<TableSyncResult> {
  const result: TableSyncResult = {
    tableKey,
    direction: 'supabase_to_firestore',
    processedCount: 0,
    syncedCount: 0,
    errors: []
  };

  if (!isSupabaseConfigured || !supabase) {
    result.errors.push('Supabase is not configured or offline.');
    return result;
  }

  try {
    const meta = SYNC_TABLES_LIST.find(t => t.key === tableKey);
    const tableName = meta ? meta.supabaseTable : tableKey;

    const { data, error } = await supabase.from(tableName).select('*');
    if (error) {
      result.errors.push(`Supabase query ${tableName} error: ${error.message}`);
      return result;
    }

    if (!data || data.length === 0) {
      result.processedCount = 0;
      result.syncedCount = 0;
      return result;
    }

    result.processedCount = data.length;

    switch (tableKey) {
      case 'user_accounts': {
        const items = data.map(row => sanitizeForFirestore(mapFromDb<UserAccount>(row)));

        for (const item of items) {
          try {
            await saveFirestoreUserAccountDoc(item);
            result.syncedCount++;
          } catch (err: any) {
            result.errors.push(`user_account (${item.id}): ${err?.message || String(err)}`);
          }
        }
        break;
      }
      case 'admin_settings': {
        const items = data.map(row => sanitizeForFirestore(mapFromDb<AdminSetting>(row)));

        for (const item of items) {
          try {
            await saveFirestoreAdminSettingDoc(item);
            result.syncedCount++;
          } catch (err: any) {
            result.errors.push(`admin_setting (${item.id}): ${err?.message || String(err)}`);
          }
        }
        break;
      }
      case 'workout_plans': {
        const items = data.map(row => sanitizeForFirestore(mapFromDb<WorkoutPlan>(row)));

        for (const item of items) {
          try {
            await saveFirestoreWorkoutPlanDoc(item);
            result.syncedCount++;
          } catch (err: any) {
            result.errors.push(`workout_plan (${item.id}): ${err?.message || String(err)}`);
          }
        }
        break;
      }
      case 'activity_logs': {
        const items = data.map(row => sanitizeForFirestore(mapFromDb<UserActivityLog>(row)));

        for (const item of items) {
          try {
            await saveFirestoreActivityLogDocStrict(item);
            result.syncedCount++;
          } catch (err: any) {
            result.errors.push(`activity_log (${item.id}): ${err?.message || String(err)}`);
          }
        }
        break;
      }
    }
  } catch (err: any) {
    result.errors.push(`Sync ${tableKey} from Supabase error: ${err?.message || String(err)}`);
  }

  return result;
}

export async function syncAllTablesFirestoreToSupabase(): Promise<{ totalSynced: number; results: TableSyncResult[]; errors: string[] }> {
  const results: TableSyncResult[] = [];
  const errors: string[] = [];
  let totalSynced = 0;

  for (const table of SYNC_TABLES_LIST) {
    const res = await syncSingleTableFirestoreToSupabase(table.key);
    results.push(res);
    totalSynced += res.syncedCount;
    if (res.errors.length > 0) {
      errors.push(...res.errors);
    }
  }

  return { totalSynced, results, errors };
}

export async function syncAllTablesSupabaseToFirestore(): Promise<{ totalSynced: number; results: TableSyncResult[]; errors: string[] }> {
  const results: TableSyncResult[] = [];
  const errors: string[] = [];
  let totalSynced = 0;

  for (const table of SYNC_TABLES_LIST) {
    const res = await syncSingleTableSupabaseToFirestore(table.key);
    results.push(res);
    totalSynced += res.syncedCount;
    if (res.errors.length > 0) {
      errors.push(...res.errors);
    }
  }

  return { totalSynced, results, errors };
}
