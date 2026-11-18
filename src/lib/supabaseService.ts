import { supabase, isSupabaseConfigured } from './supabase';
import { 
  UserAccount, 
  AdminSetting, 
  AdminAccount,
  UserActivityLog
} from '../types';
import { 
  subscribeToFirestoreActivityLogs, 
  saveActivityLogDoc,
  getFirestoreActivityLogs,
  subscribeToFirestoreUserAccounts,
  saveFirestoreUserAccountDoc,
  deleteFirestoreUserAccountDoc,
  getFirestoreUserAccounts,
  subscribeToFirestoreAdminSettings,
  saveFirestoreAdminSettingDoc,
  getFirestoreAdminSettings,
  getFirestoreWorkoutPlans,
  verifyFirestoreConnection,
  sanitizeForFirestore
} from './firebaseService';

// Helper to convert snake_case Supabase DB record to camelCase TS object
export function mapFromDb<T>(record: any): T {
  if (!record) return record;
  const result: any = {};
  Object.keys(record).forEach(key => {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = record[key];
  });
  return result as T;
}

// Helper to convert camelCase TS object to snake_case Supabase DB record
export function mapToDb(obj: any): any {
  if (!obj) return obj;
  const result: any = {};
  const transientKeys = ['isFromDatabase', 'is_from_database', 'isLocal', 'is_local'];
  Object.keys(obj).forEach(key => {
    if (transientKeys.includes(key)) return;
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    result[snakeKey] = obj[key];
  });
  return result;
}

// Graceful handler for Supabase table/schema errors to prevent dev overlay popups & repeated log noise
const warnedContexts = new Set<string>();

function handleSupabaseError(context: string, error: any) {
  if (!error) return;
  const msg = typeof error === 'string' ? error : (error.message || String(error));
  if (msg.includes('schema cache') || msg.includes('Could not find the table') || msg.includes('PGRST301')) {
    if (!warnedContexts.has(context)) {
      warnedContexts.add(context);
      console.debug(`[Supabase] Table not initialized for ${context}, fallback active.`);
    }
  } else {
    console.debug(`[Supabase] ${context}:`, msg);
  }
}

export async function verifySupabaseConnection(): Promise<{
  online: boolean;
  configured: boolean;
  latencyMs: number;
  details: string;
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      online: false,
      configured: false,
      latencyMs: 0,
      details: 'Not Configured (Local Fallback Mode)'
    };
  }

  const start = performance.now();
  try {
    const { error } = await supabase.from('admin_settings').select('id').limit(1);
    const latencyMs = Math.round(performance.now() - start);

    if (error && (error.message?.includes('FetchError') || error.message?.includes('Failed to fetch') || error.message?.includes('network'))) {
      return {
        online: false,
        configured: true,
        latencyMs,
        details: 'Network Unreachable',
        error: error.message
      };
    }

    return {
      online: true,
      configured: true,
      latencyMs,
      details: `Connected (${latencyMs}ms)`
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      online: false,
      configured: true,
      latencyMs,
      details: 'Connection Failed',
      error: err?.message || String(err)
    };
  }
}

export interface TableDiagnosticStatus {
  tableName: string;
  displayName: string;
  status: 'active' | 'missing' | 'error' | 'unconfigured';
  message: string;
}

export async function checkSupabaseTablesStatus(): Promise<{
  configured: boolean;
  tables: TableDiagnosticStatus[];
  allCriticalTablesExist: boolean;
  checkedAt: string;
}> {
  const criticalTables = [
    { tableName: 'user_accounts', displayName: 'User Accounts' },
    { tableName: 'profiles', displayName: 'User Profiles' },
    { tableName: 'activity_logs', displayName: 'Activity Logs' },
    { tableName: 'admin_settings', displayName: 'Admin Settings' },
    { tableName: 'workout_plans', displayName: 'Workout Plans' }
  ];

  if (!isSupabaseConfigured || !supabase) {
    return {
      configured: false,
      tables: criticalTables.map(t => ({
        tableName: t.tableName,
        displayName: t.displayName,
        status: 'unconfigured' as const,
        message: 'Supabase URL/Key not configured (using local fallback)'
      })),
      allCriticalTablesExist: false,
      checkedAt: new Date().toLocaleTimeString()
    };
  }

  const results: TableDiagnosticStatus[] = await Promise.all(
    criticalTables.map(async ({ tableName, displayName }) => {
      try {
        const { error } = await supabase.from(tableName).select('id').limit(1);
        if (!error) {
          return {
            tableName,
            displayName,
            status: 'active' as const,
            message: 'Table active & synchronized'
          };
        }

        const msg = error.message || String(error);
        if (
          msg.includes('schema cache') ||
          msg.includes('Could not find the table') ||
          msg.includes('relation') ||
          msg.includes('PGRST301') ||
          (error as any).code === '42P01'
        ) {
          return {
            tableName,
            displayName,
            status: 'missing' as const,
            message: `Table missing in schema (public.${tableName})`
          };
        }

        return {
          tableName,
          displayName,
          status: 'error' as const,
          message: msg
        };
      } catch (err: any) {
        return {
          tableName,
          displayName,
          status: 'error' as const,
          message: err?.message || String(err)
        };
      }
    })
  );

  const allExist = results.every(r => r.status === 'active');

  return {
    configured: true,
    tables: results,
    allCriticalTablesExist: allExist,
    checkedAt: new Date().toLocaleTimeString()
  };
}

// ==========================================
// USER ACCOUNTS & PROFILES
// ==========================================

const userAccountListeners: Array<(data: UserAccount[]) => void> = [];

// In-memory cache — user accounts are sourced from Firestore + Supabase only.
let cachedUserAccounts: UserAccount[] = [];

function notifyUserAccountListeners(accounts: UserAccount[]) {
  cachedUserAccounts = accounts;
  userAccountListeners.forEach(cb => {
    try { cb(accounts); } catch (e) { console.warn("Listener error:", e); }
  });
}

export function subscribeToUserAccounts(callback: (data: UserAccount[]) => void) {
  callback(cachedUserAccounts);
  userAccountListeners.push(callback);

  const unsubFirestore = subscribeToFirestoreUserAccounts((fsAccounts) => {
    if (fsAccounts) {
      notifyUserAccountListeners(fsAccounts);
    }
  });

  if (isSupabaseConfigured && supabase) {
    const fetchAccounts = async () => {
      const { data, error } = await supabase
        .from('user_accounts')
        .select('*');

      if (!error && data) {
        const mapped = data.map(item => mapFromDb<UserAccount>(item));
        notifyUserAccountListeners(mapped);
      } else if (error) {
        handleSupabaseError("subscribeToUserAccounts", error);
      }
    };

    fetchAccounts();

    const channelName = `accounts_${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_accounts' }, () => {
        fetchAccounts();
      })
      .subscribe();

    return () => {
      const idx = userAccountListeners.indexOf(callback);
      if (idx !== -1) userAccountListeners.splice(idx, 1);
      if (unsubFirestore) unsubFirestore();
      supabase.removeChannel(channel);
    };
  }

  return () => {
    const idx = userAccountListeners.indexOf(callback);
    if (idx !== -1) userAccountListeners.splice(idx, 1);
    if (unsubFirestore) unsubFirestore();
  };
}

export async function saveUserAccountDoc(user: UserAccount) {
  const savedUser: UserAccount = sanitizeForFirestore({ ...user });

  // Persist to Firestore first so failed writes never poison in-memory cache
  await saveFirestoreUserAccountDoc(savedUser);

  const existingIdx = cachedUserAccounts.findIndex(u => u.id === savedUser.id || u.username.toLowerCase() === savedUser.username.toLowerCase());
  const updatedList = existingIdx >= 0
    ? cachedUserAccounts.map((u, i) => (i === existingIdx ? savedUser : u))
    : [...cachedUserAccounts, savedUser];

  notifyUserAccountListeners(updatedList);

  if (isSupabaseConfigured && supabase) {
    const dbPayload = mapToDb(savedUser);
    const res = await safeUpsert('user_accounts', dbPayload, 'id');
    if (!res.success) {
      handleSupabaseError("saveUserAccountDoc", res.error);
    }

    // Automatically sync profiles table as well so foreign key references work seamlessly
    const profilePayload = {
      id: savedUser.id,
      username: savedUser.username,
      display_name: savedUser.username
    };
    await safeUpsert('profiles', profilePayload, 'id');
  }
}

export async function deleteUserAccountDoc(id: string) {
  await deleteFirestoreUserAccountDoc(id);

  const updatedList = cachedUserAccounts.filter(u => u.id !== id && u.username.toLowerCase() !== id.toLowerCase());
  notifyUserAccountListeners(updatedList);

  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from('user_accounts')
      .delete()
      .eq('id', id);

    await supabase
      .from('profiles')
      .delete()
      .eq('id', id);

    if (error) {
      handleSupabaseError("deleteUserAccountDoc", error);
    }
  }
}

// ==========================================
// ADMIN SETTINGS
// ==========================================

const adminSettingListeners: Array<(data: AdminSetting[]) => void> = [];

function notifyAdminSettingListeners(settings: AdminSetting[]) {
  adminSettingListeners.forEach(cb => {
    try { cb(settings); } catch (e) { console.warn("Listener error:", e); }
  });
}

/**
  * Intelligently merges admin settings from multiple sources (Firestore, Supabase)
  * ensuring credentials, admin accounts, and configuration documents are never lost or overwritten by empty states.
  */
export function mergeAdminSettings(sources: (AdminSetting[] | null | undefined)[]): AdminSetting[] {
  const map = new Map<string, AdminSetting>();

  for (const list of sources) {
    if (!list) continue;
    for (const doc of list) {
      if (!doc || !doc.id) continue;
      const existing = map.get(doc.id);
      if (!existing) {
        map.set(doc.id, JSON.parse(JSON.stringify(doc)));
      } else {
        if (doc.id === 'adminAccounts') {
          const accs1 = existing.adminAccounts || [];
          const accs2 = doc.adminAccounts || [];
          const accsMap = new Map<string, AdminAccount>();

          [...accs1, ...accs2].forEach(acc => {
            if (acc && acc.username) {
              const key = acc.username.toLowerCase().trim();
              const prev = accsMap.get(key);
              if (!prev) {
                accsMap.set(key, { ...acc });
              } else {
                accsMap.set(key, {
                  ...prev,
                  ...acc,
                  password: acc.password || prev.password,
                  role: acc.role || prev.role
                });
              }
            }
          });

          map.set(doc.id, {
            ...existing,
            ...doc,
            adminAccounts: Array.from(accsMap.values())
          });
        } else if (doc.id === 'credentials') {
          map.set(doc.id, {
            ...existing,
            ...doc,
            username: doc.username || existing.username,
            password: doc.password || existing.password
          });
        } else {
          map.set(doc.id, {
            ...existing,
            ...doc
          });
        }
      }
    }
  }

  return Array.from(map.values());
}

let cachedFirestoreAdminSettings: AdminSetting[] = [];
let cachedSupabaseAdminSettings: AdminSetting[] = [];

export function subscribeToAdminSettings(callback: (data: AdminSetting[]) => void) {
  // Firestore is authoritative; Supabase contributes any docs it holds.
  callback(mergeAdminSettings([cachedSupabaseAdminSettings, cachedFirestoreAdminSettings]));
  adminSettingListeners.push(callback);

  const updateAndSync = () => {
    const merged = mergeAdminSettings([cachedSupabaseAdminSettings, cachedFirestoreAdminSettings]);
    notifyAdminSettingListeners(merged);
  };

  const unsubFirestore = subscribeToFirestoreAdminSettings((fsSettings) => {
    if (fsSettings) {
      cachedFirestoreAdminSettings = fsSettings;
      updateAndSync();
    }
  });

  if (isSupabaseConfigured && supabase) {
    const fetchSettings = async () => {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('*');

      if (!error && data) {
        const mapped = data.map(item => {
          const parsed = mapFromDb<AdminSetting>(item);
          if (parsed.id === 'adminAccounts' && (!parsed.adminAccounts || parsed.adminAccounts.length === 0)) {
            if (parsed.password) {
              try {
                parsed.adminAccounts = JSON.parse(parsed.password);
              } catch (e) {
                // Ignore json parse error
              }
            }
          }
          return parsed;
        });
        cachedSupabaseAdminSettings = mapped;
        updateAndSync();
      }
    };

    fetchSettings();

    const channelName = `settings_${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_settings' }, () => {
        fetchSettings();
      })
      .subscribe();

    return () => {
      const idx = adminSettingListeners.indexOf(callback);
      if (idx !== -1) adminSettingListeners.splice(idx, 1);
      if (unsubFirestore) unsubFirestore();
      supabase.removeChannel(channel);
    };
  }

  return () => {
    const idx = adminSettingListeners.indexOf(callback);
    if (idx !== -1) adminSettingListeners.splice(idx, 1);
    if (unsubFirestore) unsubFirestore();
  };
}

export async function saveAdminSettingDoc(setting: AdminSetting) {
  const cleanSetting = sanitizeForFirestore(setting);

  // ALWAYS save to Firestore first (source of truth)
  await saveFirestoreAdminSettingDoc(cleanSetting);

  // Reflect the change in the in-memory Firestore cache and notify listeners
  const existingIdx = cachedFirestoreAdminSettings.findIndex(s => s.id === cleanSetting.id);
  cachedFirestoreAdminSettings = existingIdx >= 0
    ? cachedFirestoreAdminSettings.map((s, i) => (i === existingIdx ? cleanSetting : s))
    : [...cachedFirestoreAdminSettings, cleanSetting];

  notifyAdminSettingListeners(mergeAdminSettings([cachedSupabaseAdminSettings, cachedFirestoreAdminSettings]));

  // ALSO mirror to Supabase when configured
  if (isSupabaseConfigured && supabase) {
    try {
      const dbPayload = mapToDb(cleanSetting);
      const res = await safeUpsert('admin_settings', dbPayload);

      if (!res.success) {
        if (cleanSetting.id === 'adminAccounts' && cleanSetting.adminAccounts) {
          const fallbackPayload: any = {
            id: 'adminAccounts',
            password: JSON.stringify(cleanSetting.adminAccounts),
            visible_tabs: { adminAccounts: cleanSetting.adminAccounts }
          };
          const fallbackRes = await safeUpsert('admin_settings', fallbackPayload);
          if (!fallbackRes.success) {
            handleSupabaseError("saveAdminSettingDoc (fallback)", fallbackRes.error);
          }
        } else {
          handleSupabaseError("saveAdminSettingDoc", res.error);
        }
      }
    } catch (err) {
      handleSupabaseError("saveAdminSettingDoc", err);
    }
  }
}

// ==========================================
// ACTIVITY LOGS
// ==========================================

const activityLogListeners: Array<(data: UserActivityLog[]) => void> = [];

function notifyActivityLogListeners(logs: UserActivityLog[]) {
  activityLogListeners.forEach(cb => {
    try { cb(logs); } catch (e) { console.warn("Listener error:", e); }
  });
}

export function subscribeToActivityLogs(callback: (data: UserActivityLog[]) => void) {
  let firestoreLogs: UserActivityLog[] = [];
  let supabaseLogs: UserActivityLog[] = [];

  const emitCombinedLogs = () => {
    const map = new Map<string, UserActivityLog>();
    // Merge firestore and supabase logs by ID
    firestoreLogs.forEach(l => { if (l && l.id) map.set(l.id, l); });
    supabaseLogs.forEach(l => { if (l && l.id) map.set(l.id, l); });

    const merged = Array.from(map.values()).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    notifyActivityLogListeners(merged);
  };

  callback([]);
  activityLogListeners.push(callback);

  // Subscribe to Firestore Activity Logs (for retrieving existing/historical logs)
  const unsubscribeFirestore = subscribeToFirestoreActivityLogs((fLogs) => {
    firestoreLogs = fLogs;
    emitCombinedLogs();
  });

  // Subscribe to Supabase Activity Logs if configured
  let unsubscribeSupabase = () => {};
  if (isSupabaseConfigured && supabase) {
    const fetchSupabaseLogs = async () => {
      try {
        const { data, error } = await supabase
          .from('activity_logs')
          .select('*')
          .order('timestamp', { ascending: false });

        if (!error && data) {
          supabaseLogs = data.map(item => mapFromDb<UserActivityLog>(item));
          emitCombinedLogs();
        } else if (error) {
          handleSupabaseError("fetchSupabaseLogs", error);
        }
      } catch (err) {
        handleSupabaseError("fetchSupabaseLogs", err);
      }
    };

    fetchSupabaseLogs();

    try {
      const channelName = `logs_${Math.random().toString(36).substring(2, 9)}`;
      const channel = supabase
        .channel(channelName)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs' }, () => {
          fetchSupabaseLogs();
        })
        .subscribe();

      unsubscribeSupabase = () => {
        supabase.removeChannel(channel);
      };
    } catch (err) {
      handleSupabaseError("subscribeToActivityLogs channel", err);
    }
  }

  return () => {
    const idx = activityLogListeners.indexOf(callback);
    if (idx !== -1) activityLogListeners.splice(idx, 1);
    if (typeof unsubscribeFirestore === 'function') unsubscribeFirestore();
    if (typeof unsubscribeSupabase === 'function') unsubscribeSupabase();
  };
}

export async function logActivity(username: string, action: string, details: string) {
  const id = `log_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const newLog: UserActivityLog = {
    id,
    username: (username || 'Unknown User').slice(0, 100),
    action: (action || 'event').slice(0, 100),
    details: (details || '').slice(0, 1000),
    timestamp: new Date().toISOString()
  };

  // 1. Immediate in-memory listener notification
  notifyActivityLogListeners([newLog]);

  let savedInSupabase = false;

  // 2. Save exclusively to Supabase when active
  if (isSupabaseConfigured && supabase) {
    try {
      const dbPayload = mapToDb(newLog);
      const { error } = await supabase
        .from('activity_logs')
        .insert(dbPayload);

      if (!error) {
        savedInSupabase = true;
      } else {
        handleSupabaseError("logActivity Supabase insert", error);
      }
    } catch (err) {
      handleSupabaseError("logActivity Supabase exception", err);
    }
  }

  // 3. Fallback to Firestore ONLY if Supabase is NOT active/configured or Supabase insert failed
  if (!savedInSupabase) {
    await saveActivityLogDoc(newLog);
  }
}

/**
 * Helper to upsert a record with safe foreign key fallback and schema cache handling
 */
export async function safeUpsert(table: string, payload: any, onConflict: string = 'id'): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Supabase client not initialized' };
  try {
    const currentPayload: any = {};
    Object.keys(payload || {}).forEach(k => {
      if (payload[k] !== undefined) {
        currentPayload[k] = payload[k];
      }
    });

    // Intelligent retry loop: strips missing schema cache columns or foreign key constraints automatically
    for (let attempt = 0; attempt < 15; attempt++) {
      const { error } = await supabase.from(table).upsert(currentPayload, { onConflict });
      if (!error) return { success: true };

      const msg = error.message || String(error);

      // 1. Check if a specific column is missing in Supabase schema cache or Postgres
      const colMatch =
        msg.match(/Could not find the '([^']+)' column/i) ||
        msg.match(/column "([^"]+)" of relation/i);
      if (colMatch && colMatch[1] && colMatch[1] in currentPayload) {
        delete currentPayload[colMatch[1]];
        continue;
      }

      // 2. Foreign key constraint fallback (e.g. created_by missing in public.profiles)
      if ((msg.includes('foreign key constraint') || msg.includes('fkey') || (error as any).code === '23503') && 'created_by' in currentPayload && currentPayload.created_by !== null) {
        currentPayload.created_by = null;
        continue;
      }

      // 3. Fallback for missing couple_id column or schema cache issue
      if (msg.includes('couple_id') && 'couple_id' in currentPayload) {
        delete currentPayload.couple_id;
        continue;
      }

      // 4. Fallback for unique constraint conflicts on username or profiles_username_key
      if (msg.includes('profiles_username_key') || msg.includes('username_key') || (msg.includes('duplicate key') && msg.includes('username'))) {
        const { error: retryErr } = await supabase.from(table).upsert(currentPayload, { onConflict: 'username' });
        if (!retryErr) return { success: true };
      }

      // 5. Friendly, actionable message for uncreated tables in Supabase schema cache
      if (msg.includes('schema cache') && (msg.includes('Could not find the table') || msg.includes('relation') || msg.includes('PGRST301'))) {
        return { 
          success: false, 
          error: `Table 'public.${table}' does not exist in Supabase yet. Please execute the SQL setup script from Admin Panel → "Fix DB / SQL Script" in your Supabase SQL Editor.` 
        };
      }

      // If no recognizable strip rule matched, break and return the error
      return { success: false, error: msg };
    }

    return { success: false, error: 'Max upsert retries exceeded' };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export interface SupabaseSyncSummary {
  mode: 'firestore_and_supabase' | 'firestore_only';
  firestoreOnline: boolean;
  supabaseConfigured: boolean;
  userAccountsSynced: number;
  adminSettingsSynced: number;
  workoutPlansSynced: number;
  activityLogsSynced: number;
  errors: string[];
}

/**
 * Explicitly verifies & syncs all app collections across Firestore and (when configured) Supabase.
 */
export async function syncAllDataToSupabase(seedData?: {
  userAccounts?: UserAccount[];
  adminSettings?: AdminSetting[];
}): Promise<SupabaseSyncSummary> {
  const summary: SupabaseSyncSummary = {
    mode: isSupabaseConfigured && supabase ? 'firestore_and_supabase' : 'firestore_only',
    firestoreOnline: false,
    supabaseConfigured: !!(isSupabaseConfigured && supabase),
    userAccountsSynced: 0,
    adminSettingsSynced: 0,
    workoutPlansSynced: 0,
    activityLogsSynced: 0,
    errors: []
  };

  try {
    // 1. Verify Firestore connection
    const fsHealth = await verifyFirestoreConnection();
    summary.firestoreOnline = fsHealth.online;
    if (!fsHealth.online) {
      summary.errors.push(`Firestore: ${fsHealth.error || fsHealth.details}`);
    }

    // 2. Push any in-memory/seeded user accounts & admin settings to Firestore so both DBs match
    if (seedData?.userAccounts && seedData.userAccounts.length > 0) {
      for (const u of seedData.userAccounts) {
        if (!u?.id || !u?.username) continue;
        try {
          await saveFirestoreUserAccountDoc(u);
        } catch (err: any) {
          summary.errors.push(`Firestore user (${u.username}): ${err?.message || String(err)}`);
        }
      }
    }

    if (seedData?.adminSettings && seedData.adminSettings.length > 0) {
      for (const s of seedData.adminSettings) {
        if (!s?.id) continue;
        try {
          await saveFirestoreAdminSettingDoc(s);
        } catch (err: any) {
          summary.errors.push(`Firestore setting (${s.id}): ${err?.message || String(err)}`);
        }
      }
    }

    // 3. Pull canonical collections from Firestore
    const [fsUsers, fsSettings, fsWorkouts, fsLogs] = await Promise.all([
      getFirestoreUserAccounts(),
      getFirestoreAdminSettings(),
      getFirestoreWorkoutPlans(),
      getFirestoreActivityLogs()
    ]);

    if (!isSupabaseConfigured || !supabase) {
      // Firestore-only active cloud mode: report verified Firestore collections cleanly without false errors
      summary.userAccountsSynced = fsUsers.length;
      summary.adminSettingsSynced = fsSettings.length;
      summary.workoutPlansSynced = fsWorkouts.length;
      summary.activityLogsSynced = fsLogs.length;
      return summary;
    }

    // 4. Dual-cloud mode: mirror all 4 collections (+ profiles) to Supabase PostgreSQL
    for (const u of fsUsers) {
      const res = await safeUpsert('user_accounts', mapToDb(u), 'id');
      if (res.success) {
        summary.userAccountsSynced++;
        await safeUpsert('profiles', {
          id: u.id,
          username: u.username,
          display_name: u.username
        }, 'id');
      } else {
        summary.errors.push(`user_accounts (${u.id}): ${res.error}`);
      }
    }

    for (const s of fsSettings) {
      let res = await safeUpsert('admin_settings', mapToDb(s));
      if (!res.success && (res.error?.includes('admin_accounts') || s.id === 'adminAccounts')) {
        const fallbackPayload: any = {
          id: s.id,
          password: s.adminAccounts ? JSON.stringify(s.adminAccounts) : (s.password || null),
          username: s.username || null,
          visible_tabs: s.adminAccounts ? { adminAccounts: s.adminAccounts } : null
        };
        res = await safeUpsert('admin_settings', fallbackPayload);
      }
      if (res.success) summary.adminSettingsSynced++;
      else summary.errors.push(`admin_settings (${s.id}): ${res.error}`);
    }

    for (const w of fsWorkouts) {
      const res = await safeUpsert('workout_plans', mapToDb(w), 'id');
      if (res.success) summary.workoutPlansSynced++;
      else summary.errors.push(`workout_plans (${w.id}): ${res.error}`);
    }

    for (const log of fsLogs) {
      const res = await safeUpsert('activity_logs', mapToDb(log), 'id');
      if (res.success) summary.activityLogsSynced++;
      else summary.errors.push(`activity_logs (${log.id}): ${res.error}`);
    }
  } catch (err: any) {
    summary.errors.push(`Global sync error: ${err?.message || String(err)}`);
  }

  return summary;
}
