import { handleSupabaseProxyAction } from '../server/supabaseProxy';

export default async function handler(req: any, res: any) {
  try {
    if (req.method === 'GET') {
      const result = await handleSupabaseProxyAction({ action: 'status' });
      return res.status(result.status).json(result.json);
    }

    if (req.method === 'POST') {
      const result = await handleSupabaseProxyAction(req.body || {});
      return res.status(result.status).json(result.json);
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err: any) {
    console.error('Supabase proxy API error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Internal Supabase proxy error',
    });
  }
}
