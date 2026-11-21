import { handleSupabaseProxyAction } from '../server/supabaseProxy.js';

export default async function handler(req: any, res: any) {
  try {
    const action = req.method === 'GET' ? 'status' : String(req.body?.action || 'status');

    if (action !== 'status') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const result = await handleSupabaseProxyAction({ action: 'status' });
    return res.status(result.status).json(result.json);
  } catch (err: any) {
    console.error('Supabase proxy API error:', err);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}