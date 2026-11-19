import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const ALLOWED_SUPABASE_TABLES = new Set([
  'user_accounts',
  'profiles',
  'activity_logs',
  'admin_settings',
  'workout_plans',
]);

let cachedClient: SupabaseClient | null = null;
let cachedSignature = '';

function resolveServerSupabaseEnv(): {
  url: string;
  key: string;
  keySource: string;
  configured: boolean;
} {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).trim();

  let key = '';
  let keySource = 'none';
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    key = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
    keySource = 'SUPABASE_SERVICE_ROLE_KEY';
  } else if (process.env.SUPABASE_SECRET_KEY?.trim()) {
    key = process.env.SUPABASE_SECRET_KEY.trim();
    keySource = 'SUPABASE_SECRET_KEY';
  } else if (process.env.SUPABASE_ANON_KEY?.trim()) {
    key = process.env.SUPABASE_ANON_KEY.trim();
    keySource = 'SUPABASE_ANON_KEY';
  } else if (process.env.SUPABASE_PUBLISHABLE_KEY?.trim()) {
    key = process.env.SUPABASE_PUBLISHABLE_KEY.trim();
    keySource = 'SUPABASE_PUBLISHABLE_KEY';
  } else if (process.env.SUPABASE_KEY?.trim()) {
    key = process.env.SUPABASE_KEY.trim();
    keySource = 'SUPABASE_KEY';
  } else if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim();
    keySource = 'NEXT_PUBLIC_SUPABASE_ANON_KEY';
  } else if (process.env.VITE_SUPABASE_ANON_KEY?.trim()) {
    key = process.env.VITE_SUPABASE_ANON_KEY.trim();
    keySource = 'VITE_SUPABASE_ANON_KEY';
  }

  const configured = Boolean(
    url &&
      key &&
      (url.startsWith('https://') || url.startsWith('http://')) &&
      !url.includes('YOUR_SUPABASE_URL')
  );

  return { url, key, keySource, configured };
}

export function getServerSupabaseClient(): {
  client: SupabaseClient | null;
  configured: boolean;
  keySource: string;
  hasUrl: boolean;
  hasKey: boolean;
} {
  const { url, key, keySource, configured } = resolveServerSupabaseEnv();
  if (!configured) {
    return {
      client: null,
      configured: false,
      keySource,
      hasUrl: Boolean(url),
      hasKey: Boolean(key),
    };
  }

  const sig = `${url}|${key.slice(0, 12)}|${key.length}`;
  if (!cachedClient || cachedSignature !== sig) {
    cachedClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    cachedSignature = sig;
  }

  return {
    client: cachedClient,
    configured: true,
    keySource,
    hasUrl: true,
    hasKey: true,
  };
}

function assertAllowedTable(table: unknown): string {
  const t = String(table || '').trim();
  if (!ALLOWED_SUPABASE_TABLES.has(t)) {
    throw new Error(`Unauthorized or unknown Supabase table: "${t}"`);
  }
  return t;
}

async function serverSafeUpsert(
  client: SupabaseClient,
  table: string,
  payload: Record<string, any>,
  onConflict = 'id'
): Promise<{ success: boolean; error?: string }> {
  const currentPayload: Record<string, any> = {};
  Object.keys(payload || {}).forEach((k) => {
    if (payload[k] !== undefined) {
      currentPayload[k] = payload[k];
    }
  });

  for (let attempt = 0; attempt < 15; attempt++) {
    const { error } = await client.from(table).upsert(currentPayload, { onConflict });
    if (!error) return { success: true };

    const msg = error.message || String(error);

    const colMatch =
      msg.match(/Could not find the '([^']+)' column/i) ||
      msg.match(/column "([^"]+)" of relation/i);
    if (colMatch && colMatch[1] && colMatch[1] in currentPayload) {
      delete currentPayload[colMatch[1]];
      continue;
    }

    if (
      (msg.includes('foreign key constraint') ||
        msg.includes('fkey') ||
        (error as any).code === '23503') &&
      'created_by' in currentPayload &&
      currentPayload.created_by !== null
    ) {
      currentPayload.created_by = null;
      continue;
    }

    if (msg.includes('couple_id') && 'couple_id' in currentPayload) {
      delete currentPayload.couple_id;
      continue;
    }

    if (
      msg.includes('profiles_username_key') ||
      msg.includes('username_key') ||
      (msg.includes('duplicate key') && msg.includes('username'))
    ) {
      const { error: retryErr } = await client
        .from(table)
        .upsert(currentPayload, { onConflict: 'username' });
      if (!retryErr) return { success: true };
    }

    if (
      msg.includes('schema cache') &&
      (msg.includes('Could not find the table') ||
        msg.includes('relation') ||
        msg.includes('PGRST301'))
    ) {
      return {
        success: false,
        error: `Table 'public.${table}' does not exist in Supabase yet. Execute Admin Panel → "Fix DB / SQL Script" in Supabase SQL Editor.`,
      };
    }

    return { success: false, error: msg };
  }

  return { success: false, error: 'Max upsert retries exceeded' };
}

export async function handleSupabaseProxyAction(body: any): Promise<{ status: number; json: any }> {
  const action = String(body?.action || 'status').trim();
  const { client, configured, keySource, hasUrl, hasKey } = getServerSupabaseClient();

  if (action === 'status') {
    if (!configured || !client) {
      return {
        status: 200,
        json: {
          online: false,
          configured: false,
          latencyMs: 0,
          hasUrl,
          hasKey,
          details: !hasUrl && !hasKey
            ? 'Server env SUPABASE_URL & key not set (Firestore active)'
            : !hasUrl
            ? 'Missing SUPABASE_URL on server'
            : 'Missing SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY on server',
        },
      };
    }

    const start = Date.now();
    try {
      const { error } = await client.from('admin_settings').select('id').limit(1);
      const latencyMs = Date.now() - start;

      if (
        error &&
        (error.message?.includes('FetchError') ||
          error.message?.includes('Failed to fetch') ||
          error.message?.includes('network'))
      ) {
        return {
          status: 200,
          json: {
            online: false,
            configured: true,
            latencyMs,
            keySource,
            details: 'Network Unreachable',
            error: error.message,
          },
        };
      }

      return {
        status: 200,
        json: {
          online: true,
          configured: true,
          latencyMs,
          keySource,
          details: `Connected (${latencyMs}ms via private server env)`,
        },
      };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      return {
        status: 200,
        json: {
          online: false,
          configured: true,
          latencyMs,
          keySource,
          details: 'Connection Failed',
          error: err?.message || String(err),
        },
      };
    }
  }

  if (action === 'check_tables') {
    const criticalTables = [
      { tableName: 'user_accounts', displayName: 'User Accounts' },
      { tableName: 'profiles', displayName: 'User Profiles' },
      { tableName: 'activity_logs', displayName: 'Activity Logs' },
      { tableName: 'admin_settings', displayName: 'Admin Settings' },
      { tableName: 'workout_plans', displayName: 'Workout Plans' },
    ];

    if (!configured || !client) {
      return {
        status: 200,
        json: {
          configured: false,
          tables: criticalTables.map((t) => ({
            tableName: t.tableName,
            displayName: t.displayName,
            status: 'unconfigured',
            message: 'Server env SUPABASE_URL / key not configured (using Firestore)',
          })),
          allCriticalTablesExist: false,
          checkedAt: new Date().toLocaleTimeString(),
        },
      };
    }

    const tables = await Promise.all(
      criticalTables.map(async ({ tableName, displayName }) => {
        try {
          const { error } = await client.from(tableName).select('id').limit(1);
          if (!error) {
            return {
              tableName,
              displayName,
              status: 'active',
              message: 'Table active & synchronized',
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
              status: 'missing',
              message: `Table missing in schema (public.${tableName})`,
            };
          }
          return { tableName, displayName, status: 'error', message: msg };
        } catch (err: any) {
          return {
            tableName,
            displayName,
            status: 'error',
            message: err?.message || String(err),
          };
        }
      })
    );

    return {
      status: 200,
      json: {
        configured: true,
        tables,
        allCriticalTablesExist: tables.every((t) => t.status === 'active'),
        checkedAt: new Date().toLocaleTimeString(),
      },
    };
  }

  if (!configured || !client) {
    return {
      status: 200,
      json: {
        success: false,
        configured: false,
        error: 'Supabase server environment variables are not configured.',
      },
    };
  }

  try {
    const table = assertAllowedTable(body?.table);

    if (action === 'select') {
      let query = client.from(table).select(typeof body?.select === 'string' ? body.select : '*');
      if (body?.orderBy) {
        query = query.order(String(body.orderBy), { ascending: Boolean(body?.ascending) });
      }
      if (typeof body?.limit === 'number' && body.limit > 0) {
        query = query.limit(body.limit);
      }
      const { data, error } = await query;
      if (error) {
        return { status: 200, json: { success: false, configured: true, error: error.message } };
      }
      return { status: 200, json: { success: true, configured: true, data: data || [] } };
    }

    if (action === 'upsert') {
      const res = await serverSafeUpsert(
        client,
        table,
        body?.payload || {},
        typeof body?.onConflict === 'string' ? body.onConflict : 'id'
      );
      return { status: 200, json: { ...res, configured: true } };
    }

    if (action === 'insert') {
      const { error } = await client.from(table).insert(body?.payload || {});
      if (error) {
        return { status: 200, json: { success: false, configured: true, error: error.message } };
      }
      return { status: 200, json: { success: true, configured: true } };
    }

    if (action === 'delete') {
      const col = typeof body?.column === 'string' && body.column.trim() ? body.column.trim() : 'id';
      const val = body?.value;
      if (val === undefined || val === null || val === '') {
        return { status: 400, json: { success: false, configured: true, error: 'Delete value is required' } };
      }
      const { error } = await (client.from(table) as any).delete().eq(col, String(val));
      if (error) {
        return { status: 200, json: { success: false, configured: true, error: error.message } };
      }
      return { status: 200, json: { success: true, configured: true } };
    }

    return { status: 400, json: { success: false, error: `Unsupported action: ${action}` } };
  } catch (err: any) {
    return { status: 400, json: { success: false, error: err?.message || String(err) } };
  }
}
