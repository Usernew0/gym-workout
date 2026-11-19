import { createClient } from '@supabase/supabase-js';

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('https://') &&
  !supabaseUrl.includes('YOUR_SUPABASE_URL')
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;

// Tracks whether server-side private env vars (SUPABASE_URL + SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY without VITE_) are configured
let serverSupabaseConfigured = false;

export function isServerSupabaseConfigured(): boolean {
  return serverSupabaseConfigured;
}

export function setServerSupabaseConfigured(val: boolean): void {
  serverSupabaseConfigured = Boolean(val);
}

export function isAnySupabaseConfigured(): boolean {
  return Boolean((isSupabaseConfigured && supabase) || serverSupabaseConfigured);
}

export async function callSupabaseProxy(payload: Record<string, any>): Promise<any> {
  const response = await fetch('/api/supabase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  if (typeof json?.configured === 'boolean') {
    setServerSupabaseConfigured(json.configured);
  }
  return json;
}
